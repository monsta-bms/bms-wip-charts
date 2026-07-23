import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(repositoryRoot, "worker", "migrations");
const canonicalSchemaPath = resolve(repositoryRoot, "schema", "d1.sql");
const internalTables = new Set(["d1_migrations", "_cf_KV"]);

function isUserTable(name) {
  return !name.startsWith("sqlite_") && !internalTables.has(name);
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function queryAll(database, sql) {
  return database.prepare(sql).all();
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
        type: String(column.type),
        notNull: Number(column.notnull),
        defaultValue: column.dflt_value === null ? null : String(column.dflt_value),
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
        onUpdate: String(foreignKey.on_update),
        onDelete: String(foreignKey.on_delete),
        match: String(foreignKey.match)
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

    const indexes = queryAll(database, `PRAGMA index_list(${quotedTable})`)
      .map((index) => {
        const indexName = String(index.name);
        const columnsForIndex = queryAll(
          database,
          `PRAGMA index_xinfo(${quoteIdentifier(indexName)})`
        )
          .filter((column) => Number(column.key) === 1)
          .map((column) => ({
            sequence: Number(column.seqno),
            name: column.name === null ? null : String(column.name),
            descending: Number(column.desc),
            collation: column.coll === null ? null : String(column.coll)
          }))
          .sort((left, right) => left.sequence - right.sequence);

        return {
          name: indexName,
          unique: Number(index.unique),
          origin: String(index.origin),
          partial: Number(index.partial),
          columns: columnsForIndex
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    tableDetails[table] = { columns, foreignKeys, indexes };
  }

  return { tables, tableDetails };
}

async function applyMigrations(database, lastMigrationNumber) {
  for (let migrationNumber = 1; migrationNumber <= lastMigrationNumber; migrationNumber += 1) {
    const prefix = String(migrationNumber).padStart(4, "0");
    const migrationNames = [
      "0001_initial.sql",
      "0002_file_delete_and_rejected_rules.sql",
      "0003_progress_graph_fields.sql",
      "0004_origin_url.sql",
      "0005_version_chart_name.sql",
      "0006_append_policy.sql",
      "0007_version_withdrawals.sql",
      "0008_withdrawal_handling.sql",
      "0009_version_source_metadata.sql"
    ];
    const migrationName = migrationNames.find((name) => name.startsWith(prefix));
    if (!migrationName) {
      throw new Error(`Migration ${prefix} is not registered in the canonical schema test.`);
    }
    database.exec(await readFile(resolve(migrationsDirectory, migrationName), "utf8"));
  }
}

const requestedLastMigration = Number.parseInt(process.argv[2] ?? "8", 10);
if (!Number.isInteger(requestedLastMigration) || requestedLastMigration < 1 || requestedLastMigration > 9) {
  throw new Error("Usage: node scripts/test-canonical-d1-schema.mjs [1-9]");
}

const migrationDatabase = new DatabaseSync(":memory:");
const canonicalDatabase = new DatabaseSync(":memory:");
try {
  migrationDatabase.exec("PRAGMA foreign_keys = ON;");
  canonicalDatabase.exec("PRAGMA foreign_keys = ON;");
  await applyMigrations(migrationDatabase, requestedLastMigration);
  canonicalDatabase.exec(await readFile(canonicalSchemaPath, "utf8"));

  assert.deepEqual(
    inspectSchema(canonicalDatabase),
    inspectSchema(migrationDatabase),
    `schema/d1.sql differs from migrations 0001-${String(requestedLastMigration).padStart(4, "0")}`
  );
  console.log(
    `ok - canonical D1 schema matches migrations 0001-${String(requestedLastMigration).padStart(4, "0")}`
  );
} finally {
  migrationDatabase.close();
  canonicalDatabase.close();
}
