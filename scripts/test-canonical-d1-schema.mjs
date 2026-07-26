import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(repositoryRoot, "worker", "migrations");
const canonicalSchemaPath = resolve(repositoryRoot, "schema", "d1.sql");
const migrationFilePattern = /^(\d{4})_.+\.sql$/;
const internalTables = new Set(["d1_migrations", "_cf_KV"]);
const temporaryDirectoryPrefix = "bms-canonical-schema-";

const errorCodes = Object.freeze({
  discovery: "CANONICAL_SCHEMA_MIGRATION_DISCOVERY_FAILED",
  migrationApply: "CANONICAL_SCHEMA_MIGRATION_APPLY_FAILED",
  canonicalApply: "CANONICAL_SCHEMA_APPLY_FAILED",
  objectMissing: "CANONICAL_SCHEMA_OBJECT_MISSING",
  objectExtra: "CANONICAL_SCHEMA_OBJECT_EXTRA",
  columnMismatch: "CANONICAL_SCHEMA_COLUMN_MISMATCH",
  foreignKeyMismatch: "CANONICAL_SCHEMA_FOREIGN_KEY_MISMATCH",
  indexMismatch: "CANONICAL_SCHEMA_INDEX_MISMATCH",
  sqlMismatch: "CANONICAL_SCHEMA_SQL_MISMATCH",
  testFailed: "CANONICAL_SCHEMA_TEST_FAILED"
});

class CanonicalSchemaTestError extends Error {
  constructor(code, stage, message, details = {}) {
    super(message);
    this.name = "CanonicalSchemaTestError";
    this.code = code;
    this.stage = stage;
    this.details = Object.freeze({ ...details });
  }
}

function isUserTable(name) {
  return !name.startsWith("sqlite_") && !internalTables.has(name);
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeSql(value) {
  const source = String(value ?? "");
  let result = "";
  let outside = "";
  let quote = null;

  const flushOutside = () => {
    if (!outside) {
      return;
    }
    result += outside
      .toLowerCase()
      .replace(/\bif\s+not\s+exists\b/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*([(),;=])\s*/g, "$1");
    outside = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      result += character;
      if (quote === "[") {
        if (character === "]") {
          quote = null;
        }
      } else if (character === quote) {
        if (source[index + 1] === quote) {
          result += source[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`" || character === "[") {
      flushOutside();
      quote = character;
      result += character;
    } else {
      outside += character;
    }
  }
  flushOutside();

  return result.trim().replace(/;$/, "").trim();
}

function normalizeColumnType(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

function extractPartialIndexCondition(sql) {
  const normalized = normalizeSql(sql);
  const match = normalized.match(/\bwhere\b([\s\S]*)$/);
  return match ? match[1].trim() : null;
}

function queryAll(database, sql, ...parameters) {
  return database.prepare(sql).all(...parameters);
}

function querySchemaSql(database, type, name) {
  const row = database
    .prepare("SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?")
    .get(type, name);
  return row?.sql === null || row?.sql === undefined ? null : String(row.sql);
}

function inspectIndexes(database, table) {
  return queryAll(database, `PRAGMA index_list(${quoteIdentifier(table)})`)
    .map((index) => {
      const indexName = String(index.name);
      const sql = querySchemaSql(database, "index", indexName);
      const automatic = sql === null || indexName.startsWith("sqlite_autoindex_");
      const columns = queryAll(database, `PRAGMA index_xinfo(${quoteIdentifier(indexName)})`)
        .filter((column) => Number(column.key) === 1)
        .map((column) => ({
          sequence: Number(column.seqno),
          name: column.name === null ? null : String(column.name),
          descending: Number(column.desc),
          collation: column.coll === null ? null : String(column.coll).toUpperCase()
        }))
        .sort((left, right) => left.sequence - right.sequence);

      return {
        name: automatic ? null : indexName,
        automatic,
        unique: Number(index.unique),
        origin: String(index.origin),
        partial: Number(index.partial),
        where: Number(index.partial) === 1 && sql !== null
          ? extractPartialIndexCondition(sql)
          : null,
        columns
      };
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function inspectSqlObjects(database, type) {
  return queryAll(
    database,
    "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    type
  )
    .map((row) => ({
      name: String(row.name),
      table: String(row.tbl_name),
      sql: normalizeSql(row.sql)
    }));
}

function inspectSchema(database) {
  const tables = queryAll(
    database,
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"
  )
    .map((row) => String(row.name))
    .filter(isUserTable);

  const tableDetails = {};
  for (const table of tables) {
    const quotedTable = quoteIdentifier(table);
    const columns = queryAll(database, `PRAGMA table_info(${quotedTable})`)
      .map((column) => ({
        name: String(column.name),
        type: normalizeColumnType(column.type),
        notNull: Number(column.notnull),
        defaultValue: column.dflt_value === null ? null : normalizeSql(column.dflt_value),
        primaryKey: Number(column.pk)
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    const foreignKeys = queryAll(database, `PRAGMA foreign_key_list(${quotedTable})`)
      .map((foreignKey) => ({
        id: Number(foreignKey.id),
        sequence: Number(foreignKey.seq),
        table: String(foreignKey.table),
        from: String(foreignKey.from),
        to: foreignKey.to === null ? null : String(foreignKey.to),
        onUpdate: String(foreignKey.on_update).toUpperCase(),
        onDelete: String(foreignKey.on_delete).toUpperCase(),
        match: String(foreignKey.match).toUpperCase()
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

    tableDetails[table] = {
      columns,
      foreignKeys,
      indexes: inspectIndexes(database, table)
    };
  }

  return {
    tables,
    tableDetails,
    views: inspectSqlObjects(database, "view"),
    triggers: inspectSqlObjects(database, "trigger")
  };
}

function makeDifference(code, objectType, objectName, migrationValue, canonicalValue) {
  return {
    code,
    stage: "compare",
    objectType,
    objectName,
    migration: migrationValue,
    canonical: canonicalValue
  };
}

function compareSqlObjects(migrationObjects, canonicalObjects, objectType) {
  const differences = [];
  const migrationByName = new Map(migrationObjects.map((object) => [object.name, object]));
  const canonicalByName = new Map(canonicalObjects.map((object) => [object.name, object]));

  for (const [name, canonicalObject] of canonicalByName) {
    const migrationObject = migrationByName.get(name);
    if (!migrationObject) {
      differences.push(makeDifference(
        errorCodes.objectMissing,
        objectType,
        name,
        null,
        canonicalObject
      ));
    } else if (migrationObject.table !== canonicalObject.table
      || migrationObject.sql !== canonicalObject.sql) {
      differences.push(makeDifference(
        errorCodes.sqlMismatch,
        objectType,
        name,
        migrationObject,
        canonicalObject
      ));
    }
  }

  for (const [name, migrationObject] of migrationByName) {
    if (!canonicalByName.has(name)) {
      differences.push(makeDifference(
        errorCodes.objectExtra,
        objectType,
        name,
        migrationObject,
        null
      ));
    }
  }
  return differences;
}

function compareSchemaSnapshots(migrationSchema, canonicalSchema) {
  const differences = [];
  const migrationTables = new Set(migrationSchema.tables);
  const canonicalTables = new Set(canonicalSchema.tables);

  for (const table of canonicalSchema.tables) {
    if (!migrationTables.has(table)) {
      differences.push(makeDifference(
        errorCodes.objectMissing,
        "table",
        table,
        null,
        { exists: true }
      ));
    }
  }
  for (const table of migrationSchema.tables) {
    if (!canonicalTables.has(table)) {
      differences.push(makeDifference(
        errorCodes.objectExtra,
        "table",
        table,
        { exists: true },
        null
      ));
    }
  }

  for (const table of migrationSchema.tables.filter((name) => canonicalTables.has(name))) {
    const migrationDetails = migrationSchema.tableDetails[table];
    const canonicalDetails = canonicalSchema.tableDetails[table];
    const migrationColumns = new Map(migrationDetails.columns.map((column) => [column.name, column]));
    const canonicalColumns = new Map(canonicalDetails.columns.map((column) => [column.name, column]));
    const columnNames = new Set([...migrationColumns.keys(), ...canonicalColumns.keys()]);

    for (const columnName of [...columnNames].sort()) {
      const migrationColumn = migrationColumns.get(columnName) ?? null;
      const canonicalColumn = canonicalColumns.get(columnName) ?? null;
      if (JSON.stringify(migrationColumn) !== JSON.stringify(canonicalColumn)) {
        differences.push(makeDifference(
          errorCodes.columnMismatch,
          "column",
          `${table}.${columnName}`,
          migrationColumn,
          canonicalColumn
        ));
      }
    }

    if (JSON.stringify(migrationDetails.foreignKeys) !== JSON.stringify(canonicalDetails.foreignKeys)) {
      differences.push(makeDifference(
        errorCodes.foreignKeyMismatch,
        "foreign_key",
        table,
        migrationDetails.foreignKeys,
        canonicalDetails.foreignKeys
      ));
    }

    if (JSON.stringify(migrationDetails.indexes) !== JSON.stringify(canonicalDetails.indexes)) {
      differences.push(makeDifference(
        errorCodes.indexMismatch,
        "index",
        table,
        migrationDetails.indexes,
        canonicalDetails.indexes
      ));
    }
  }

  differences.push(...compareSqlObjects(migrationSchema.views, canonicalSchema.views, "view"));
  differences.push(...compareSqlObjects(migrationSchema.triggers, canonicalSchema.triggers, "trigger"));
  return differences;
}

function assertSchemasMatch(migrationSchema, canonicalSchema, migrationFiles = []) {
  const differences = compareSchemaSnapshots(migrationSchema, canonicalSchema);
  if (differences.length > 0) {
    throw new CanonicalSchemaTestError(
      differences[0].code,
      "compare",
      `Canonical schema has ${differences.length} semantic difference(s).`,
      { differences, migrationFiles }
    );
  }
}

function createDiscoveryError(message, details = {}) {
  return new CanonicalSchemaTestError(
    errorCodes.discovery,
    "migration-discovery",
    message,
    details
  );
}

async function discoverMigrations(directory, options = {}) {
  const readdirImpl = options.readdirImpl ?? readdir;
  const readFileImpl = options.readFileImpl ?? readFile;
  let entries;
  try {
    entries = await readdirImpl(directory, { withFileTypes: true });
  } catch (error) {
    throw createDiscoveryError("Unable to read the migration directory.", {
      reasonCode: error?.code ?? "READ_DIRECTORY_FAILED"
    });
  }

  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(migrationFilePattern);
      return match
        ? { name: entry.name, number: Number.parseInt(match[1], 10) }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));

  const numbers = new Set();
  for (const candidate of candidates) {
    if (numbers.has(candidate.number)) {
      throw createDiscoveryError("Duplicate migration number detected.", {
        migrationFile: candidate.name,
        migrationNumber: candidate.number
      });
    }
    numbers.add(candidate.number);
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const expectedNumber = index + 1;
    if (candidates[index].number !== expectedNumber) {
      throw createDiscoveryError("Migration numbers must remain consecutive from 0001.", {
        migrationFile: candidates[index].name,
        expectedNumber,
        actualNumber: candidates[index].number
      });
    }
  }

  const migrations = [];
  for (const candidate of candidates) {
    let sql;
    try {
      sql = await readFileImpl(resolve(directory, candidate.name), "utf8");
    } catch (error) {
      throw createDiscoveryError("Unable to read a migration file.", {
        migrationFile: candidate.name,
        reasonCode: error?.code ?? "READ_FILE_FAILED"
      });
    }
    if (sql.trim().length === 0) {
      throw createDiscoveryError("Empty migration files are not allowed.", {
        migrationFile: candidate.name
      });
    }
    migrations.push(Object.freeze({ ...candidate, sql }));
  }

  if (migrations.length === 0) {
    throw createDiscoveryError("No migration files were found.");
  }
  return Object.freeze(migrations);
}

async function applyMigrations(database, migrations) {
  for (const migration of migrations) {
    try {
      database.exec(migration.sql);
    } catch (error) {
      throw new CanonicalSchemaTestError(
        errorCodes.migrationApply,
        "migration-apply",
        "A migration could not be applied to the isolated database.",
        {
          migrationFile: migration.name,
          reasonCode: error?.code ?? "SQLITE_EXEC_FAILED"
        }
      );
    }
  }
}

function applyCanonicalSchema(database, sql) {
  try {
    if (sql.trim().length === 0) {
      throw new Error("EMPTY_CANONICAL_SCHEMA");
    }
    database.exec(sql);
  } catch (error) {
    throw new CanonicalSchemaTestError(
      errorCodes.canonicalApply,
      "canonical-apply",
      "schema/d1.sql could not be applied to the isolated database.",
      { reasonCode: error?.code ?? error?.message ?? "SQLITE_EXEC_FAILED" }
    );
  }
}

function inspectRowCounts(database, schema) {
  return Object.fromEntries(schema.tables.map((table) => {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get();
    return [table, Number(row.count)];
  }));
}

function validateTemporaryDirectory(path) {
  const expectedParent = resolve(tmpdir());
  if (resolve(dirname(path)) !== expectedParent || !basename(path).startsWith(temporaryDirectoryPrefix)) {
    throw new CanonicalSchemaTestError(
      errorCodes.testFailed,
      "temporary-directory",
      "Refusing to clean an unexpected temporary directory."
    );
  }
}

async function runCanonicalComparison(migrations) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), temporaryDirectoryPrefix));
  validateTemporaryDirectory(temporaryRoot);
  const migrationDatabasePath = join(temporaryRoot, "migrations.sqlite");
  const canonicalDatabasePath = join(temporaryRoot, "canonical.sqlite");
  let migrationDatabase;
  let canonicalDatabase;
  let result;

  try {
    migrationDatabase = new DatabaseSync(migrationDatabasePath);
    canonicalDatabase = new DatabaseSync(canonicalDatabasePath);
    migrationDatabase.exec("PRAGMA foreign_keys = ON;");
    canonicalDatabase.exec("PRAGMA foreign_keys = ON;");

    await applyMigrations(migrationDatabase, migrations);
    applyCanonicalSchema(canonicalDatabase, await readFile(canonicalSchemaPath, "utf8"));

    const migrationSchema = inspectSchema(migrationDatabase);
    const canonicalSchema = inspectSchema(canonicalDatabase);
    assertSchemasMatch(
      migrationSchema,
      canonicalSchema,
      migrations.map((migration) => migration.name)
    );
    result = {
      temporaryRoot,
      databasePaths: [migrationDatabasePath, canonicalDatabasePath],
      executionMode: "local-node-sqlite",
      remoteOperationCount: 0,
      migrationSchema,
      canonicalSchema,
      migrationRowCounts: inspectRowCounts(migrationDatabase, migrationSchema),
      canonicalRowCounts: inspectRowCounts(canonicalDatabase, canonicalSchema)
    };
  } finally {
    migrationDatabase?.close();
    canonicalDatabase?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return result;
}

function inspectSchemaFromSql(sql) {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    if (sql.trim()) {
      database.exec(sql);
    }
    return inspectSchema(database);
  } finally {
    database.close();
  }
}

function schemaDifferences(migrationSql, canonicalSql) {
  return compareSchemaSnapshots(
    inspectSchemaFromSql(migrationSql),
    inspectSchemaFromSql(canonicalSql)
  );
}

async function withMigrationFixture(files, callback) {
  const root = await mkdtemp(join(tmpdir(), "bms-canonical-discovery-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(root, name), content, "utf8");
    }
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function expectErrorCode(callback, expectedCode) {
  let receivedError = null;
  try {
    await callback();
  } catch (error) {
    receivedError = error;
  }
  assert.ok(receivedError, `Expected ${expectedCode}.`);
  assert.equal(receivedError.code, expectedCode);
  return receivedError;
}

function expectDifferenceCode(migrationSql, canonicalSql, expectedCode) {
  const differences = schemaDifferences(migrationSql, canonicalSql);
  assert.ok(differences.some((difference) => difference.code === expectedCode));
}

function formatDiagnostic(error) {
  const code = error instanceof CanonicalSchemaTestError ? error.code : errorCodes.testFailed;
  const stage = error instanceof CanonicalSchemaTestError ? error.stage : "test";
  const lines = [
    `[canonical-schema-test] stage=${stage} code=${code}`,
    `message=${error instanceof Error ? error.message : "Canonical schema test failed."}`,
    "diagnostic_output=stderr"
  ];

  if (error instanceof CanonicalSchemaTestError) {
    const { migrationFile, migrationFiles, reasonCode, differences } = error.details;
    if (migrationFile) {
      lines.push(`migration_file=${migrationFile}`);
    }
    if (migrationFiles?.length) {
      lines.push(`migration_files=${migrationFiles.join(",")}`);
    }
    if (reasonCode) {
      lines.push(`reason_code=${reasonCode}`);
    }
    for (const difference of differences ?? []) {
      lines.push(
        `difference code=${difference.code} object_type=${difference.objectType} object_name=${difference.objectName}`,
        `migration=${JSON.stringify(difference.migration)}`,
        `canonical=${JSON.stringify(difference.canonical)}`
      );
    }
  }
  return lines.join("\n");
}

function validateArguments(argumentsList) {
  if (argumentsList.length > 1 || (argumentsList.length === 1 && !/^\d+$/.test(argumentsList[0]))) {
    throw createDiscoveryError(
      "Usage: node scripts/test-canonical-d1-schema.mjs (legacy numeric argument is optional and ignored)."
    );
  }
  if (argumentsList.length === 1) {
    console.warn(
      "[canonical-schema-test] stage=migration-discovery code=LEGACY_MIGRATION_ARGUMENT_IGNORED"
    );
  }
}

async function run() {
  validateArguments(process.argv.slice(2));
  let checkCount = 0;
  const check = async (name, callback) => {
    await callback();
    checkCount += 1;
    console.log(`ok ${checkCount} - ${name}`);
  };

  const migrations = await discoverMigrations(migrationsDirectory);
  const migrationNames = migrations.map((migration) => migration.name);
  const eligibleDiskNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && migrationFilePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));

  await check("all migration files are discovered", async () => {
    assert.deepEqual(migrationNames, eligibleDiskNames);
  });
  await check("0009 version source metadata is included", async () => {
    assert.ok(migrationNames.includes("0009_version_source_metadata.sql"));
  });
  await check("migrations are sorted by their four-digit prefix", async () => {
    assert.deepEqual(
      migrations.map((migration) => migration.number),
      migrations.map((migration) => migration.number).toSorted((left, right) => left - right)
    );
  });
  await check("duplicate migration numbers are rejected", async () => {
    await withMigrationFixture({
      "0001_first.sql": "SELECT 1;",
      "0001_second.sql": "SELECT 2;"
    }, async (root) => {
      await expectErrorCode(() => discoverMigrations(root), errorCodes.discovery);
    });
  });
  await check("invalid migration filenames are ignored", async () => {
    await withMigrationFixture({
      "0001_valid.sql": "SELECT 1;",
      "1_invalid.sql": "SELECT 1;",
      "0002.sql": "SELECT 1;"
    }, async (root) => {
      assert.deepEqual((await discoverMigrations(root)).map((migration) => migration.name), ["0001_valid.sql"]);
    });
  });
  await check("non-SQL files are ignored", async () => {
    await withMigrationFixture({
      "0001_valid.sql": "SELECT 1;",
      "0002_notes.txt": "not SQL"
    }, async (root) => {
      assert.deepEqual((await discoverMigrations(root)).map((migration) => migration.name), ["0001_valid.sql"]);
    });
  });
  await check("a future consecutive migration is discovered without test edits", async () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
      const number = String(index + 1).padStart(4, "0");
      return [`${number}_fixture.sql`, `SELECT ${index + 1};`];
    }));
    await withMigrationFixture(files, async (root) => {
      const discovered = await discoverMigrations(root);
      assert.equal(discovered.at(-1).name, "0010_fixture.sql");
      assert.equal(discovered.length, 10);
    });
  });
  await check("no manually maintained migration list or upper-bound variable remains", async () => {
    const source = await readFile(fileURLToPath(import.meta.url), "utf8");
    const legacyUpperBoundNames = [
      ["requested", "LastMigration"].join(""),
      ["lastMigration", "Number"].join("")
    ];
    assert.ok(legacyUpperBoundNames.every((name) => !source.includes(name)));
    assert.doesNotMatch(source, /const\s+migrationNames\s*=\s*\[/);
  });
  await check("unreadable migration files fail discovery", async () => {
    await withMigrationFixture({ "0001_unreadable.sql": "SELECT 1;" }, async (root) => {
      await expectErrorCode(
        () => discoverMigrations(root, {
          readFileImpl: async () => {
            const error = new Error("fixture read failure");
            error.code = "EACCES";
            throw error;
          }
        }),
        errorCodes.discovery
      );
    });
  });
  await check("empty migration files fail discovery", async () => {
    await withMigrationFixture({ "0001_empty.sql": " \r\n" }, async (root) => {
      await expectErrorCode(() => discoverMigrations(root), errorCodes.discovery);
    });
  });
  await check("the existing consecutive numbering convention is enforced", async () => {
    await withMigrationFixture({
      "0001_first.sql": "SELECT 1;",
      "0003_gap.sql": "SELECT 3;"
    }, async (root) => {
      await expectErrorCode(() => discoverMigrations(root), errorCodes.discovery);
    });
  });
  await check("migration apply failures use a fixed diagnostic code", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await expectErrorCode(
        () => applyMigrations(database, [{ name: "0001_broken.sql", sql: "NOT VALID SQL;" }]),
        errorCodes.migrationApply
      );
    } finally {
      database.close();
    }
  });
  await check("canonical apply failures use a fixed diagnostic code", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      await expectErrorCode(
        () => applyCanonicalSchema(database, "NOT VALID SQL;"),
        errorCodes.canonicalApply
      );
    } finally {
      database.close();
    }
  });

  const simpleTable = "CREATE TABLE sample (id TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT 'same');";
  await check("identical semantic schemas match", async () => {
    assert.deepEqual(schemaDifferences(simpleTable, simpleTable), []);
  });
  await check("a missing table is detected", async () => {
    expectDifferenceCode("", simpleTable, errorCodes.objectMissing);
  });
  await check("an extra table is detected", async () => {
    expectDifferenceCode(simpleTable, "", errorCodes.objectExtra);
  });
  await check("a missing column is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (id TEXT PRIMARY KEY);",
      simpleTable,
      errorCodes.columnMismatch
    );
  });
  await check("a column type difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (id INTEGER PRIMARY KEY);",
      "CREATE TABLE sample (id TEXT PRIMARY KEY);",
      errorCodes.columnMismatch
    );
  });
  await check("a NOT NULL difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (id TEXT);",
      "CREATE TABLE sample (id TEXT NOT NULL);",
      errorCodes.columnMismatch
    );
  });
  await check("a default value difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (id TEXT DEFAULT 'left');",
      "CREATE TABLE sample (id TEXT DEFAULT 'right');",
      errorCodes.columnMismatch
    );
  });
  await check("a primary-key difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (id TEXT);",
      "CREATE TABLE sample (id TEXT PRIMARY KEY);",
      errorCodes.columnMismatch
    );
  });
  await check("a foreign-key difference is detected", async () => {
    const parent = "CREATE TABLE parent (id TEXT PRIMARY KEY);";
    expectDifferenceCode(
      `${parent} CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT);`,
      `${parent} CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE);`,
      errorCodes.foreignKeyMismatch
    );
  });
  await check("a unique-index difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE INDEX idx_sample ON sample (a, b);",
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE UNIQUE INDEX idx_sample ON sample (a, b);",
      errorCodes.indexMismatch
    );
  });
  await check("an index column-order difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE INDEX idx_sample ON sample (a, b);",
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE INDEX idx_sample ON sample (b, a);",
      errorCodes.indexMismatch
    );
  });
  await check("a partial-index predicate difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE INDEX idx_sample ON sample (a) WHERE b IS NULL;",
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE INDEX idx_sample ON sample (a) WHERE b IS NOT NULL;",
      errorCodes.indexMismatch
    );
  });
  await check("a view SQL difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE VIEW sample_view AS SELECT a FROM sample;",
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE VIEW sample_view AS SELECT b FROM sample;",
      errorCodes.sqlMismatch
    );
  });
  await check("a trigger SQL difference is detected", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE TRIGGER sample_trigger AFTER UPDATE ON sample BEGIN UPDATE sample SET b = NEW.a; END;",
      "CREATE TABLE sample (a TEXT, b TEXT); CREATE TRIGGER sample_trigger AFTER UPDATE ON sample BEGIN UPDATE sample SET b = OLD.a; END;",
      errorCodes.sqlMismatch
    );
  });
  await check("SQL keyword case and whitespace-only differences are ignored", async () => {
    assert.deepEqual(
      schemaDifferences(
        "CREATE TABLE sample (a TEXT); CREATE VIEW sample_view AS SELECT a FROM sample;",
        "create table if not exists sample(a text);\nCREATE   VIEW sample_view AS\nSELECT a FROM sample ;"
      ),
      []
    );
  });
  await check("meaningful SQL expression differences remain visible", async () => {
    expectDifferenceCode(
      "CREATE TABLE sample (a TEXT); CREATE VIEW sample_view AS SELECT a FROM sample WHERE a = 'A';",
      "CREATE TABLE sample (a TEXT); CREATE VIEW sample_view AS SELECT a FROM sample WHERE a = 'a';",
      errorCodes.sqlMismatch
    );
  });

  const comparisonResult = await runCanonicalComparison(migrations);
  await check("all discovered migrations match schema/d1.sql", async () => {
    assert.deepEqual(
      compareSchemaSnapshots(comparisonResult.migrationSchema, comparisonResult.canonicalSchema),
      []
    );
  });

  const metadataTable = "version_source_metadata";
  const migrationMetadata = comparisonResult.migrationSchema.tableDetails[metadataTable];
  const canonicalMetadata = comparisonResult.canonicalSchema.tableDetails[metadataTable];
  await check("version_source_metadata exists on both schema paths", async () => {
    assert.ok(migrationMetadata);
    assert.ok(canonicalMetadata);
  });
  await check("version_source_metadata columns, nullability, and defaults match", async () => {
    assert.deepEqual(migrationMetadata.columns, canonicalMetadata.columns);
  });
  await check("version_source_metadata keeps its one-to-one primary-key contract", async () => {
    const versionId = migrationMetadata.columns.find((column) => column.name === "version_id");
    assert.equal(versionId.primaryKey, 1);
    assert.ok(migrationMetadata.indexes.some((index) => index.automatic
      && index.unique === 1
      && index.origin === "pk"
      && index.columns.map((column) => column.name).join(",") === "version_id"));
  });
  await check("version_source_metadata foreign key matches", async () => {
    assert.deepEqual(migrationMetadata.foreignKeys, canonicalMetadata.foreignKeys);
    assert.ok(migrationMetadata.foreignKeys.some((foreignKey) => foreignKey.from === "version_id"
      && foreignKey.table === "versions"
      && foreignKey.to === "id"
      && foreignKey.onDelete === "CASCADE"));
  });
  await check("version_source_metadata explicit index matches", async () => {
    assert.deepEqual(migrationMetadata.indexes, canonicalMetadata.indexes);
    assert.ok(migrationMetadata.indexes.some((index) => index.name === "idx_version_source_metadata_status_updated"
      && index.columns.map((column) => column.name).join(",") === "status,updated_at,version_id"));
  });
  await check("excluding 0009 fails the canonical comparison", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      await applyMigrations(database, migrations.filter((migration) => migration.number < 9));
      const differences = compareSchemaSnapshots(
        inspectSchema(database),
        comparisonResult.canonicalSchema
      );
      assert.ok(differences.some((difference) => difference.code === errorCodes.objectMissing
        && difference.objectName === metadataTable));
    } finally {
      database.close();
    }
  });

  await check("only local Node SQLite databases are used", async () => {
    assert.equal(comparisonResult.executionMode, "local-node-sqlite");
    assert.equal(comparisonResult.remoteOperationCount, 0);
    assert.ok(comparisonResult.databasePaths.every((path) => dirname(path) === comparisonResult.temporaryRoot));
  });
  await check("temporary comparison databases are removed", async () => {
    await assert.rejects(access(comparisonResult.temporaryRoot), { code: "ENOENT" });
  });
  await check("isolated databases contain no production rows", async () => {
    assert.ok(Object.values(comparisonResult.migrationRowCounts).every((count) => count === 0));
    assert.ok(Object.values(comparisonResult.canonicalRowCounts).every((count) => count === 0));
  });
  await check("diagnostics expose schema metadata only", async () => {
    const diagnosticError = new CanonicalSchemaTestError(
      errorCodes.columnMismatch,
      "compare",
      "fixture",
      {
        password: "do-not-log-password",
        token: "do-not-log-token",
        rowContent: "do-not-log-row",
        differences: [makeDifference(
          errorCodes.columnMismatch,
          "column",
          "sample.id",
          { type: "TEXT" },
          { type: "INTEGER" }
        )]
      }
    );
    const output = formatDiagnostic(diagnosticError);
    assert.doesNotMatch(output, /do-not-log|password|token|rowContent/);
    assert.match(output, /CANONICAL_SCHEMA_COLUMN_MISMATCH/);
  });

  console.log(
    `canonical D1 schema tests: ${checkCount} checks passed; migrations=${migrationNames.join(",")}`
  );
}

run().catch((error) => {
  console.error(formatDiagnostic(error));
  process.exitCode = 1;
});
