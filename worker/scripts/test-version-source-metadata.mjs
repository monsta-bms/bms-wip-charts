import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { build } from "esbuild";
import wrangler from "wrangler";

const { createTestHarness, unstable_splitSqlQuery: splitSqlQuery } = wrangler;
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationFiles = [
  "0001_initial.sql",
  "0002_file_delete_and_rejected_rules.sql",
  "0003_progress_graph_fields.sql",
  "0004_origin_url.sql",
  "0005_version_chart_name.sql",
  "0006_append_policy.sql",
  "0007_version_withdrawals.sql",
  "0008_withdrawal_handling.sql",
  "0009_version_source_metadata.sql",
  "0010_security_hash_key_versions.sql",
  "0011_version_comments.sql"
];
const TEST_SECRET = "isolated-source-metadata-secret";
const TEST_PASSWORD = "isolated-source-metadata-password";
const textEncoder = new TextEncoder();

let sequence = 0;
let passed = 0;

async function importBundled(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    absWorkingDir: workerRoot,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    logLevel: "silent"
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const [
  chartsModule,
  chartVersionsModule,
  uploadAnalysisModule,
  sourceMetadataModule,
  versionListModule,
  difficultyTablesModule,
  filesModule
] = await Promise.all([
  importBundled("src/routes/charts.ts"),
  importBundled("src/routes/chartVersions.ts"),
  importBundled("src/utils/bmsUploadAnalysis.ts"),
  importBundled("src/utils/versionSourceMetadata.ts"),
  importBundled("src/routes/versionList.ts"),
  importBundled("src/routes/difficultyTables.ts"),
  importBundled("src/routes/files.ts")
]);

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function readMigration(name) {
  return readFile(resolve(workerRoot, "migrations", name), "utf8");
}

async function applySqliteMigrations(database, firstIndex = 0, lastIndex = migrationFiles.length) {
  for (const name of migrationFiles.slice(firstIndex, lastIndex)) {
    database.exec(await readMigration(name));
  }
}

function seedSqliteVersion(database, suffix) {
  database.prepare(`
    INSERT OR IGNORE INTO songs (id, title, artist, normalized_title, normalized_artist)
    VALUES (?, ?, 'Tester', ?, 'tester')
  `).run(`song_${suffix}`, `Song ${suffix}`, `song ${suffix}`);
  database.prepare(`
    INSERT OR IGNORE INTO charts (id, song_id, chart_name, normalized_chart_name)
    VALUES (?, ?, ?, ?)
  `).run(`chart_${suffix}`, `song_${suffix}`, `Chart ${suffix}`, `chart ${suffix}`);
  database.prepare(`
    INSERT INTO versions (
      id, chart_id, version_number, branch_path, author, progress,
      title, artist, file_id, file_name, file_size, file_sha256, r2_key, password_hash
    ) VALUES (?, ?, 1, ?, 'Tester', 50, ?, 'Tester', ?, 'chart.bms', 1, ?, ?, 'hash')
  `).run(
    `version_${suffix}`,
    `chart_${suffix}`,
    `root_${suffix}`,
    `Song ${suffix}`,
    `file_${suffix}`,
    `sha_${suffix}`,
    `r2_${suffix}`
  );
  return `version_${suffix}`;
}

function insertSqliteMetadata(database, versionId, values = {}) {
  database.prepare(`
    INSERT INTO version_source_metadata (
      version_id, source_title, source_subtitle, source_artist, source_subartist,
      encoding, status, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    versionId,
    values.sourceTitle ?? null,
    values.sourceSubtitle ?? null,
    values.sourceArtist ?? null,
    values.sourceSubartist ?? null,
    values.encoding ?? null,
    values.status ?? "succeeded",
    values.errorCode ?? null
  );
}

async function testMigrationAndConstraints() {
  await check("0009 applies after 0001-0008 without backfilling existing versions", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      await applySqliteMigrations(database, 0, 8);
      seedSqliteVersion(database, "existing");
      await applySqliteMigrations(database, 8, 9);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM version_source_metadata").get().count, 0);
    } finally {
      database.close();
    }
  });

  await check("fresh database accepts 0001-0009 and creates the metadata index", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      await applySqliteMigrations(database);
      assert.equal(
        database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='version_source_metadata'").get().count,
        1
      );
      assert.equal(
        database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='index' AND name='idx_version_source_metadata_status_updated'").get().count,
        1
      );
    } finally {
      database.close();
    }
  });

  await check("status and error_code CHECK constraints enforce their pairing", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      await applySqliteMigrations(database);
      const succeededVersion = seedSqliteVersion(database, "status_succeeded");
      const failedVersion = seedSqliteVersion(database, "status_failed");
      const unavailableVersion = seedSqliteVersion(database, "status_unavailable");
      const invalidVersion = seedSqliteVersion(database, "status_invalid");
      assert.throws(
        () => insertSqliteMetadata(database, succeededVersion, { status: "succeeded", errorCode: "UNEXPECTED" }),
        /CHECK constraint failed/u
      );
      assert.throws(
        () => insertSqliteMetadata(database, failedVersion, { status: "failed" }),
        /CHECK constraint failed/u
      );
      assert.throws(
        () => insertSqliteMetadata(database, invalidVersion, { status: "unknown", errorCode: "UNKNOWN" }),
        /CHECK constraint failed/u
      );
      insertSqliteMetadata(database, failedVersion, { status: "failed", errorCode: "BMS_METADATA_PARSE_FAILED" });
      insertSqliteMetadata(database, unavailableVersion, { status: "unavailable", errorCode: "SOURCE_FILE_NOT_FOUND" });
    } finally {
      database.close();
    }
  });

  await check("source and encoding boundaries accept 4096/64 and reject 4097/65", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      await applySqliteMigrations(database);
      insertSqliteMetadata(database, seedSqliteVersion(database, "boundary_ok"), {
        sourceTitle: "界".repeat(4096),
        encoding: "e".repeat(64)
      });
      assert.throws(
        () => insertSqliteMetadata(database, seedSqliteVersion(database, "source_too_long"), {
          sourceTitle: "界".repeat(4097)
        }),
        /CHECK constraint failed/u
      );
      assert.throws(
        () => insertSqliteMetadata(database, seedSqliteVersion(database, "encoding_too_long"), {
          encoding: "e".repeat(65)
        }),
        /CHECK constraint failed/u
      );
    } finally {
      database.close();
    }
  });

  await check("version deletion cascades metadata and reverse deletion leaves version intact", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON;");
      await applySqliteMigrations(database);
      const cascadeVersion = seedSqliteVersion(database, "cascade");
      insertSqliteMetadata(database, cascadeVersion, { sourceTitle: "Cascade" });
      database.prepare("DELETE FROM versions WHERE id = ?").run(cascadeVersion);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM version_source_metadata WHERE version_id = ?").get(cascadeVersion).count, 0);

      const reverseVersion = seedSqliteVersion(database, "reverse");
      insertSqliteMetadata(database, reverseVersion, { sourceTitle: "Reverse" });
      database.prepare("DELETE FROM version_source_metadata WHERE version_id = ?").run(reverseVersion);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM versions WHERE id = ?").get(reverseVersion).count, 1);
    } finally {
      database.close();
    }
  });
}

const harness = createTestHarness({
  root: workerRoot,
  workers: [{
    configPath: "wrangler.toml",
    vars: {
      ALLOWED_ORIGINS: "http://localhost",
      TURNSTILE_MODE: "observe"
    },
    secrets: {
      PASSWORD_HASH_SECRET: TEST_SECRET,
      ABUSE_HASH_SECRET: TEST_SECRET,
      WITHDRAWAL_IDEMPOTENCY_SECRET: TEST_SECRET,
      ADMIN_TOKEN: "isolated-source-metadata-admin"
    }
  }]
});

let env;

async function applyHarnessMigrations() {
  for (const name of migrationFiles) {
    const executableSql = (await readMigration(name))
      .replace(/\r\n/g, "\n")
      .replace(/^\s*--.*$/gm, "")
      .trim();
    for (const statement of splitSqlQuery(executableSql)) {
      await env.DB.prepare(statement).run();
    }
  }
}

async function first(sql, ...bindings) {
  return env.DB.prepare(sql).bind(...bindings).first();
}

async function all(sql, ...bindings) {
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  return result.results ?? [];
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function utf8Bms({
  title,
  subtitle = null,
  artist,
  subartist = null,
  suffix = ""
}) {
  const lines = [
    "#PLAYER 1",
    `#TITLE ${title}`,
    ...(subtitle === null ? [] : [`#SUBTITLE ${subtitle}`]),
    `#ARTIST ${artist}`,
    ...(subartist === null ? [] : [`#SUBARTIST ${subartist}`]),
    "#BPM 120",
    "#PLAYLEVEL 1",
    "#00111:0100",
    "#00411:0001",
    `#COMMENT ${suffix}`
  ];
  return Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8");
}

function cp932Bms(suffix) {
  return Buffer.concat([
    Buffer.from("#PLAYER 1\r\n#TITLE ", "ascii"),
    Buffer.from([0x82, 0xa0, 0x82, 0xa2]),
    Buffer.from(`\r\n#ARTIST CP932 Artist ${suffix}\r\n#BPM 120\r\n#00111:01\r\n`, "ascii")
  ]);
}

async function zipBms(bytes, fileName = "inside/chart.bms") {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add(fileName, new BlobReader(new Blob([bytes])));
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
}

function makeInitialRequest(bytes, options = {}) {
  sequence += 1;
  const suffix = String(sequence);
  const form = new FormData();
  const fileName = options.fileName ?? `source-${suffix}.bms`;
  form.set("file", new File([bytes], fileName, { type: options.contentType ?? "application/octet-stream" }));
  form.set("title", options.title ?? `Display Title ${suffix}`);
  form.set("subtitle", options.subtitle ?? `Display Subtitle ${suffix}`);
  form.set("artist", options.artist ?? `Display Artist ${suffix}`);
  form.set("subartist", options.subartist ?? `Display Subartist ${suffix}`);
  form.set("chartName", options.chartName ?? `Chart ${suffix}`);
  form.set("difficulty", options.difficulty ?? "★1");
  form.set("author", options.author ?? "Metadata Tester");
  form.set("progress", options.progress ?? "50");
  form.set("comment", options.comment ?? "source metadata isolation test");
  form.set("password", TEST_PASSWORD);
  form.set("allowAppend", options.allowAppend ?? "true");
  return new Request("http://localhost/api/charts", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "CF-Connecting-IP": `192.0.2.${(sequence % 200) + 1}`,
      "User-Agent": "source-metadata-isolation-test"
    },
    body: form
  });
}

async function createInitial(bytes, options = {}) {
  const response = await chartsModule.handleChartsRoute(makeInitialRequest(bytes, options), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

async function metadataFor(versionId) {
  return first(`
    SELECT version_id, source_title, source_subtitle, source_artist, source_subartist,
           encoding, status, error_code
    FROM version_source_metadata
    WHERE version_id = ?
  `, versionId);
}

async function testPreparationHelper() {
  await check("helper preserves raw values and converts only undefined/empty fields to NULL", async () => {
    const prepared = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: {
        title: "ＦＵＬＬ（原曲）",
        subtitle: "",
        artist: "obj:Creator",
        subartist: undefined,
        encoding: "utf-8"
      },
      metadataWarning: null
    });
    assert.deepEqual(prepared, {
      sourceTitle: "ＦＵＬＬ（原曲）",
      sourceSubtitle: null,
      sourceArtist: "obj:Creator",
      sourceSubartist: null,
      encoding: "utf-8",
      status: "succeeded",
      errorCode: null
    });
  });

  await check("helper distinguishes metadata warnings, safe codes, and invalid-code fallback", async () => {
    const safe = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: { title: "discarded", encoding: "shift_jis" },
      metadataWarning: { code: "BMS_METADATA_PARSE_FAILED" }
    });
    assert.equal(safe.status, "failed");
    assert.equal(safe.sourceTitle, null);
    assert.equal(safe.encoding, "shift_jis");
    assert.equal(safe.errorCode, "BMS_METADATA_PARSE_FAILED");
    const unsafe = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: {},
      metadataWarning: { code: "bad-code with detail" }
    });
    assert.equal(unsafe.errorCode, "SOURCE_METADATA_PARSE_FAILED");
  });

  await check("helper uses code-point boundaries and fails closed without truncation", async () => {
    const accepted = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: { title: "😀".repeat(4096), encoding: "e".repeat(64) },
      metadataWarning: null
    });
    assert.equal(accepted.status, "succeeded");
    assert.equal(Array.from(accepted.sourceTitle).length, 4096);
    const rejected = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: { title: "😀".repeat(4097), encoding: "utf-8" },
      metadataWarning: null
    });
    assert.deepEqual(rejected, {
      sourceTitle: null,
      sourceSubtitle: null,
      sourceArtist: null,
      sourceSubartist: null,
      encoding: null,
      status: "failed",
      errorCode: "SOURCE_METADATA_VALUE_TOO_LONG"
    });
    const longEncoding = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: { title: "valid", encoding: "e".repeat(65) },
      metadataWarning: null
    });
    assert.equal(longEncoding.status, "failed");
    assert.equal(longEncoding.errorCode, "SOURCE_METADATA_VALUE_TOO_LONG");
    assert.equal(longEncoding.sourceTitle, null);
  });
}

async function testInitialSubmissions() {
  await check("initial UTF-8 submission stores all source fields separately from form values", async () => {
    const bytes = utf8Bms({
      title: "Raw Ｔitle（原曲）",
      subtitle: "Raw [SUBTITLE]",
      artist: "obj:Raw Artist",
      subartist: "Raw Subartist",
      suffix: "utf8"
    });
    const created = await createInitial(bytes, {
      title: "Edited Display Title",
      subtitle: "Edited Display Subtitle",
      artist: "Edited Display Artist",
      subartist: "Edited Display Subartist"
    });
    const metadata = await metadataFor(created.versionId);
    assert.deepEqual(metadata, {
      version_id: created.versionId,
      source_title: "Raw Ｔitle（原曲）",
      source_subtitle: "Raw [SUBTITLE]",
      source_artist: "obj:Raw Artist",
      source_subartist: "Raw Subartist",
      encoding: "utf-8",
      status: "succeeded",
      error_code: null
    });
    const version = await first("SELECT title, subtitle, artist, subartist, r2_key FROM versions WHERE id = ?", created.versionId);
    assert.deepEqual(
      { title: version.title, subtitle: version.subtitle, artist: version.artist, subartist: version.subartist },
      {
        title: "Edited Display Title",
        subtitle: "Edited Display Subtitle",
        artist: "Edited Display Artist",
        subartist: "Edited Display Subartist"
      }
    );
    assert.notEqual(await env.FILES.head(version.r2_key), null);
    assert.equal((await first("SELECT COUNT(*) AS count FROM post_logs WHERE version_id = ? AND result = 'accepted'", created.versionId)).count, 1);

    const listResponse = await versionListModule.handlePublicVersionListRoute(
      new Request("http://localhost/api/versions?pageSize=200"),
      env,
      false
    );
    const listText = JSON.stringify(await listResponse.json());
    assert.doesNotMatch(listText, /Raw Ｔitle（原曲）|obj:Raw Artist/u);
  });

  await check("initial UTF-8 BOM stores optional missing headers as NULL", async () => {
    const content = utf8Bms({ title: "BOM Source", artist: "BOM Artist", suffix: "bom" });
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]);
    const created = await createInitial(bytes);
    const metadata = await metadataFor(created.versionId);
    assert.equal(metadata.source_title, "BOM Source");
    assert.equal(metadata.source_subtitle, null);
    assert.equal(metadata.source_subartist, null);
    assert.equal(metadata.encoding, "utf-8");
  });

  await check("initial CP932 submission stores decoded source text and encoding", async () => {
    const bytes = cp932Bms(++sequence);
    const created = await createInitial(bytes, { title: `CP932 Display ${sequence}`, artist: `CP932 Display Artist ${sequence}` });
    const metadata = await metadataFor(created.versionId);
    assert.equal(metadata.source_title, "あい");
    assert.match(metadata.source_artist, /^CP932 Artist/u);
    assert.equal(metadata.encoding, "shift_jis");
    assert.equal(metadata.status, "succeeded");
  });

  await check("initial ZIP stores the final parsed metadata from its internal BMS", async () => {
    const internalBytes = utf8Bms({
      title: "ZIP Source Title",
      subtitle: "ZIP Source Subtitle",
      artist: "ZIP Source Artist",
      subartist: "ZIP Source Subartist",
      suffix: "zip"
    });
    const created = await createInitial(await zipBms(internalBytes), {
      fileName: `source-${++sequence}.zip`,
      title: "ZIP Display Title",
      artist: "ZIP Display Artist"
    });
    const metadata = await metadataFor(created.versionId);
    assert.equal(metadata.source_title, "ZIP Source Title");
    assert.equal(metadata.source_subtitle, "ZIP Source Subtitle");
    assert.equal(metadata.source_artist, "ZIP Source Artist");
    assert.equal(metadata.source_subartist, "ZIP Source Subartist");
    assert.equal(metadata.status, "succeeded");
  });

  await check("4097-character metadata keeps the post successful and stores failed status", async () => {
    const bytes = utf8Bms({ title: "長".repeat(4097), artist: "Long Source Artist", suffix: "too-long" });
    const created = await createInitial(bytes, { title: `Long Display ${++sequence}`, artist: `Long Display Artist ${sequence}` });
    const metadata = await metadataFor(created.versionId);
    assert.equal(metadata.status, "failed");
    assert.equal(metadata.error_code, "SOURCE_METADATA_VALUE_TOO_LONG");
    assert.equal(metadata.source_title, null);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE id = ?", created.versionId)).count, 1);
  });

  await check("measure analysis failure alone leaves source metadata succeeded", async () => {
    const bytes = Buffer.from([
      "#PLAYER 1",
      "#TITLE Analysis Failure Source",
      "#ARTIST Analysis Failure Artist",
      "#BPM 120",
      "#00111:01",
      "#99902:6000",
      "#99911:01",
      `#COMMENT ${++sequence}`
    ].join("\r\n"), "utf8");
    const created = await createInitial(bytes, { title: `Analysis Display ${sequence}`, artist: `Analysis Display Artist ${sequence}` });
    const metadata = await metadataFor(created.versionId);
    assert.equal(metadata.status, "succeeded");
    assert.equal(metadata.source_title, "Analysis Failure Source");
    assert.equal(metadata.error_code, null);
    const version = await first("SELECT measure_notes_json FROM versions WHERE id = ?", created.versionId);
    assert.equal(version.measure_notes_json, null);
  });
}

function progressMapFromAnalysis(analysis, parentVersionId, childRange = null) {
  assert.ok(analysis);
  assert.ok(analysis.standardBlocks.length >= 2);
  const layers = [{
    versionId: parentVersionId,
    color: "#1f7a5c",
    kind: "initial",
    ranges: [[0, 0]]
  }];
  if (childRange) {
    layers.push({
      versionId: "client-child-placeholder",
      color: "#2468a2",
      kind: "followup",
      ranges: [childRange]
    });
  }
  const paintedCount = childRange ? 2 : 1;
  return {
    schemaVersion: 2,
    blockMode: "standardized_measure",
    firstMeasure: analysis.displayFirstMeasure,
    lastMeasure: analysis.displayLastMeasure,
    targetBlockCount: analysis.standardBlocks.length,
    blocks: analysis.standardBlocks,
    layers,
    progress: Math.round((paintedCount / analysis.standardBlocks.length) * 100)
  };
}

async function seedAppendParent(bytes, options = {}) {
  sequence += 1;
  const suffix = String(sequence);
  const analyzed = uploadAnalysisModule.analyzeUploadedBmsBytes(asArrayBuffer(bytes), `append-${suffix}.bms`);
  assert.ok(analyzed.analysis);
  const songId = `append_song_${suffix}`;
  const chartId = `append_chart_${suffix}`;
  const versionId = `append_parent_${suffix}`;
  const fileId = `append_parent_file_${suffix}`;
  const r2Key = `append/parent-${suffix}.bms`;
  const sourceTitle = options.sourceTitle ?? `Parent Source ${suffix}`;
  const displaySubtitle = `Parent Display Subtitle ${suffix}`;
  const displaySubartist = `Parent Display Subartist ${suffix}`;
  const parentMap = progressMapFromAnalysis(analyzed.analysis, versionId);
  await env.DB.prepare(`
    INSERT INTO songs (id, title, subtitle, artist, subartist, normalized_title, normalized_subtitle, normalized_artist, normalized_subartist)
    VALUES (?, 'Append Song', ?, 'Append Artist', ?, 'append song', ?, 'append artist', ?)
  `).bind(
    songId,
    displaySubtitle,
    displaySubartist,
    displaySubtitle.toLowerCase(),
    displaySubartist.toLowerCase()
  ).run();
  await env.DB.prepare(`
    INSERT INTO charts (id, song_id, chart_name, normalized_chart_name)
    VALUES (?, ?, ?, ?)
  `).bind(chartId, songId, `Append Chart ${suffix}`, `append chart ${suffix}`).run();
  const passwordHash = await sha256Hex(`${TEST_SECRET}:password:${TEST_PASSWORD}`);
  await env.DB.prepare(`
    INSERT INTO versions (
      id, chart_id, version_number, branch_path, chart_name, normalized_chart_name,
      author, progress, progress_map_json, title, subtitle, artist, subartist,
      file_id, file_name, file_size, file_sha256, r2_key, password_hash, allow_append
    ) VALUES (?, ?, 1, 'root', ?, ?, 'Parent Author', ?, ?, 'Append Song',
      ?, 'Append Artist', ?, ?, 'parent.bms', 1, ?, ?, ?, ?)
  `).bind(
    versionId,
    chartId,
    `Append Chart ${suffix}`,
    `append chart ${suffix}`,
    parentMap.progress,
    JSON.stringify(parentMap),
    displaySubtitle,
    displaySubartist,
    fileId,
    `append_parent_sha_${suffix}`,
    r2Key,
    passwordHash,
    options.allowAppend === false ? 0 : 1
  ).run();
  await env.DB.prepare(`
    INSERT INTO version_source_metadata (
      version_id, source_title, source_subtitle, source_artist, source_subartist,
      encoding, status, error_code
    ) VALUES (?, ?, 'Parent Source Subtitle', 'Parent Source Artist', 'Parent Source Subartist', 'utf-8', 'succeeded', NULL)
  `).bind(versionId, sourceTitle).run();
  return { songId, chartId, versionId, fileId, r2Key, analyzed, parentMap, displaySubtitle, displaySubartist };
}

function makeAppendRequest(parent, bytes, options = {}) {
  sequence += 1;
  const form = new FormData();
  form.set("file", new File([bytes], options.fileName ?? `append-${sequence}.bms`, { type: "application/octet-stream" }));
  form.set("parentVersionId", parent.versionId);
  form.set("author", "Child Author");
  form.set(
    "progressMap",
    JSON.stringify(options.progressMap ?? progressMapFromAnalysis(parent.analyzed.analysis, parent.versionId, [1, 1]))
  );
  form.set("comment", "append source metadata test");
  form.set("password", TEST_PASSWORD);
  form.set("allowAppend", "true");
  return new Request(`http://localhost/api/charts/${parent.chartId}/versions`, {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "CF-Connecting-IP": `198.51.100.${(sequence % 200) + 1}`,
      "User-Agent": "source-metadata-append-test"
    },
    body: form
  });
}

async function testAppendSubmissions() {
  const makeChildBytes = () => utf8Bms({
    title: "Append Song",
    subtitle: "Child Raw Subtitle（追記）",
    artist: "Append Artist",
    subartist: "obj:Child Raw Subartist",
    suffix: `append-${++sequence}`
  });

  await check("single-BMS append stores the child file metadata without copying parent metadata", async () => {
    const childBytes = makeChildBytes();
    const parent = await seedAppendParent(childBytes, { sourceTitle: "Distinct Parent Source" });
    const response = await chartVersionsModule.handleChartVersionsRoute(
      makeAppendRequest(parent, childBytes),
      env,
      parent.chartId
    );
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    const childMetadata = await metadataFor(body.versionId);
    assert.equal(childMetadata.source_title, "Append Song");
    assert.equal(childMetadata.source_subtitle, "Child Raw Subtitle（追記）");
    assert.equal(childMetadata.source_artist, "Append Artist");
    assert.equal(childMetadata.source_subartist, "obj:Child Raw Subartist");
    assert.notEqual(childMetadata.source_title, "Distinct Parent Source");
    const parentMetadata = await metadataFor(parent.versionId);
    assert.equal(parentMetadata.source_title, "Distinct Parent Source");
    const version = await first("SELECT title, subtitle, artist, subartist, r2_key FROM versions WHERE id = ?", body.versionId);
    assert.equal(version.title, "Append Song");
    assert.equal(version.subtitle, parent.displaySubtitle);
    assert.equal(version.artist, "Append Artist");
    assert.equal(version.subartist, parent.displaySubartist);
    assert.notEqual(await env.FILES.head(version.r2_key), null);
    assert.equal((await first("SELECT COUNT(*) AS count FROM post_logs WHERE version_id = ? AND result = 'accepted'", body.versionId)).count, 1);
  });

  await check("ZIP append stores metadata parsed from the uploaded ZIP child", async () => {
    const childBytes = makeChildBytes();
    const parent = await seedAppendParent(childBytes);
    const response = await chartVersionsModule.handleChartVersionsRoute(
      makeAppendRequest(parent, await zipBms(childBytes), { fileName: `append-${++sequence}.zip` }),
      env,
      parent.chartId
    );
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    const metadata = await metadataFor(body.versionId);
    assert.equal(metadata.source_subtitle, "Child Raw Subtitle（追記）");
    assert.equal(metadata.encoding, "utf-8");
  });

  await check("completed append keeps completion updates and saves child source metadata", async () => {
    const completionBytes = Buffer.from([
      "#PLAYER 1",
      "#TITLE Append Song",
      "#SUBTITLE Completion Raw Subtitle",
      "#ARTIST Append Artist",
      "#SUBARTIST Completion Raw Subartist",
      "#BPM 120",
      "#00111:01",
      "#00611:01",
      `#COMMENT completion-${++sequence}`
    ].join("\r\n"), "utf8");
    const parent = await seedAppendParent(completionBytes);
    const blockCount = parent.analyzed.analysis.standardBlocks.length;
    assert.ok(blockCount >= 5);
    const parentMap = progressMapFromAnalysis(parent.analyzed.analysis, parent.versionId);
    parentMap.layers[0].ranges = [[0, blockCount - 2]];
    parentMap.progress = Math.round(((blockCount - 1) / blockCount) * 100);
    assert.ok(parentMap.progress >= 80 && parentMap.progress < 100);
    await env.DB.prepare(`
      UPDATE versions
      SET progress = ?, progress_map_json = ?
      WHERE id = ?
    `).bind(parentMap.progress, JSON.stringify(parentMap), parent.versionId).run();
    const completionMap = {
      ...parentMap,
      layers: [
        ...parentMap.layers,
        {
          versionId: "client-completion-placeholder",
          color: "#2468a2",
          kind: "completion_fill",
          ranges: [[blockCount - 1, blockCount - 1]]
        }
      ],
      completionBaseRanges: [],
      progress: 100
    };
    const response = await chartVersionsModule.handleChartVersionsRoute(
      makeAppendRequest(parent, completionBytes, { progressMap: completionMap }),
      env,
      parent.chartId
    );
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body.completed, true);
    const child = await first("SELECT progress, completed_at FROM versions WHERE id = ?", body.versionId);
    assert.equal(child.progress, 100);
    assert.notEqual(child.completed_at, null);
    const metadata = await metadataFor(body.versionId);
    assert.equal(metadata.source_subtitle, "Completion Raw Subtitle");
    assert.equal(metadata.status, "succeeded");

    const parentAfterCompletion = await first(`
      SELECT download_blocked, download_block_reason, collapsed_by_completion, collapsed_reason
      FROM versions
      WHERE id = ?
    `, parent.versionId);
    assert.deepEqual(parentAfterCompletion, {
      download_blocked: 0,
      download_block_reason: null,
      collapsed_by_completion: 0,
      collapsed_reason: null
    });

    await env.DB.prepare(`
      UPDATE versions
      SET download_blocked = 1,
          download_block_reason = 'superseded_by_completed_descendant',
          download_blocked_at = CURRENT_TIMESTAMP,
          collapsed_by_completion = 1,
          collapsed_reason = 'superseded_by_completed_descendant',
          collapsed_at = CURRENT_TIMESTAMP,
          collapsed_by_version_id = ?
      WHERE id = ?
    `).bind(body.versionId, parent.versionId).run();
    await env.FILES.put(parent.r2Key, new Uint8Array([0x31]));

    const chartListResponse = await chartsModule.handleChartsRoute(
      new Request("http://localhost/api/charts?pageSize=200"),
      env
    );
    const chartListBody = await chartListResponse.json();
    const listParent = chartListBody.charts
      .flatMap((entry) => entry.versions)
      .find((version) => version.id === parent.versionId);
    assert.equal(listParent.downloadBlocked, false);
    assert.equal(listParent.downloadBlockReason, null);
    assert.equal(listParent.collapsedByCompletion, false);
    assert.match(listParent.file.downloadUrl, /^\/api\/files\//u);

    const chartDetailResponse = await chartsModule.handleChartDetailRoute(
      new Request(`http://localhost/api/charts/${parent.chartId}`),
      env,
      parent.chartId
    );
    const chartDetailBody = await chartDetailResponse.json();
    const detailParent = chartDetailBody.charts[0].versions.find((version) => version.id === parent.versionId);
    assert.equal(detailParent.downloadBlocked, false);
    assert.equal(detailParent.collapsedByCompletion, false);

    const versionListResponse = await versionListModule.handlePublicVersionListRoute(
      new Request("http://localhost/api/versions?pageSize=100"),
      env,
      false
    );
    const versionListBody = await versionListResponse.json();
    const standaloneParent = versionListBody.items.find((version) => version.versionId === parent.versionId);
    assert.equal(standaloneParent.downloadBlocked, false);
    assert.match(standaloneParent.file.downloadUrl, /^\/api\/files\//u);

    const downloadResponse = await filesModule.handleFileRoute(
      new Request(`http://localhost/api/files/${parent.fileId}`),
      env,
      parent.fileId
    );
    assert.equal(downloadResponse.status, 200);

    const siblingBytes = Buffer.concat([
      completionBytes,
      Buffer.from(`\r\n#COMMENT sibling-${++sequence}`, "utf8")
    ]);
    const siblingResponse = await chartVersionsModule.handleChartVersionsRoute(
      makeAppendRequest(parent, siblingBytes, { progressMap: completionMap }),
      env,
      parent.chartId
    );
    assert.equal(siblingResponse.status, 201, await siblingResponse.text());
  });

  await check("append-disabled parent rejects before creating version or metadata", async () => {
    const childBytes = makeChildBytes();
    const parent = await seedAppendParent(childBytes, { allowAppend: false });
    const r2Before = (await env.FILES.list()).objects.length;
    const response = await chartVersionsModule.handleChartVersionsRoute(
      makeAppendRequest(parent, childBytes),
      env,
      parent.chartId
    );
    assert.equal(response.status, 409);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE parent_version_id = ?", parent.versionId)).count, 0);
    assert.equal((await all(`
      SELECT metadata.version_id
      FROM version_source_metadata AS metadata
      LEFT JOIN versions ON versions.id = metadata.version_id
      WHERE versions.id IS NULL
    `)).length, 0);
    assert.equal((await env.FILES.list()).objects.length, r2Before);
  });

  await check("parent race leaves batch result index 0 authoritative, no metadata row, and cleans R2", async () => {
    const childBytes = makeChildBytes();
    const parent = await seedAppendParent(childBytes);
    const r2Before = (await env.FILES.list()).objects.length;
    const realDatabase = env.DB;
    let intercepted = false;
    const raceDatabase = {
      prepare(query) {
        return realDatabase.prepare(query);
      },
      async batch(statements) {
        if (!intercepted) {
          intercepted = true;
          await realDatabase.prepare("UPDATE versions SET allow_append = 0 WHERE id = ?").bind(parent.versionId).run();
        }
        return realDatabase.batch(statements);
      },
      exec(query) {
        return realDatabase.exec(query);
      },
      withSession(constraint) {
        return realDatabase.withSession(constraint);
      }
    };
    const raceEnv = { ...env, DB: raceDatabase };
    const response = await chartVersionsModule.handleChartVersionsRoute(
      makeAppendRequest(parent, childBytes),
      raceEnv,
      parent.chartId
    );
    assert.equal(response.status, 409);
    assert.equal(intercepted, true);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE parent_version_id = ?", parent.versionId)).count, 0);
    assert.equal((await all(`
      SELECT metadata.version_id
      FROM version_source_metadata AS metadata
      LEFT JOIN versions ON versions.id = metadata.version_id
      WHERE versions.id IS NULL
    `)).length, 0);
    assert.equal((await env.FILES.list()).objects.length, r2Before);
  });
}

async function testWarningInsertAndPublicRegression() {
  await check("metadata-warning preparation saves failed state while the version remains available", async () => {
    const bytes = utf8Bms({ title: "Warning Host", artist: "Warning Host Artist", suffix: "warning" });
    const created = await createInitial(bytes);
    await env.DB.prepare("DELETE FROM version_source_metadata WHERE version_id = ?").bind(created.versionId).run();
    const prepared = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: { title: "must not persist", encoding: "utf-8" },
      metadataWarning: { code: "BMS_METADATA_PARSE_FAILED" }
    });
    await sourceMetadataModule.buildVersionSourceMetadataInsertStatement(env.DB, created.versionId, prepared).run();
    const metadata = await metadataFor(created.versionId);
    assert.equal(metadata.status, "failed");
    assert.equal(metadata.error_code, "BMS_METADATA_PARSE_FAILED");
    assert.equal(metadata.source_title, null);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE id = ?", created.versionId)).count, 1);
  });

  await check("difficulty table legacy fields stay unchanged when source metadata becomes the display source", async () => {
    sequence += 1;
    const suffix = String(sequence);
    const songId = `difficulty_song_${suffix}`;
    const chartId = `difficulty_chart_${suffix}`;
    const versionId = `difficulty_version_${suffix}`;
    const md5 = suffix.padStart(32, "0").slice(-32);
    await env.DB.prepare(`
      INSERT INTO songs (id, title, artist, normalized_title, normalized_artist)
      VALUES (?, 'Difficulty Snapshot', 'Snapshot Artist', 'difficulty snapshot', 'snapshot artist')
    `).bind(songId).run();
    await env.DB.prepare(`
      INSERT INTO charts (id, song_id, chart_name, normalized_chart_name)
      VALUES (?, ?, 'Snapshot Chart', 'snapshot chart')
    `).bind(chartId, songId).run();
    await env.DB.prepare(`
      INSERT INTO versions (
        id, chart_id, version_number, branch_path, chart_name, normalized_chart_name,
        author, progress, difficulty, level, title, artist, md5,
        file_id, file_name, file_size, file_sha256, r2_key, password_hash, completed_at,
        download_blocked, download_block_reason, collapsed_by_completion, collapsed_reason
      ) VALUES (?, ?, 1, ?, 'Snapshot Chart', 'snapshot chart', 'Snapshot Author', 100,
        '★1', '1', 'Difficulty Snapshot', 'Snapshot Artist', ?, ?, 'snapshot.bms', 1, ?, ?, 'hash', CURRENT_TIMESTAMP,
        1, 'superseded_by_completed_descendant', 1, 'superseded_by_completed_descendant')
    `).bind(
      versionId,
      chartId,
      `snapshot_${suffix}`,
      md5,
      `difficulty_file_${suffix}`,
      `difficulty_sha_${suffix}`,
      `difficulty/r2-${suffix}.bms`
    ).run();
    const request = new Request("http://localhost/api/difficulty-tables/rc-star/data.json");
    const beforeResponse = await difficultyTablesModule.handleDifficultyTableRoute(
      request,
      env,
      "/api/difficulty-tables/rc-star/data.json"
    );
    assert.equal(beforeResponse.status, 200);
    const before = await beforeResponse.text();
    assert.match(before, /Difficulty Snapshot/u);
    await env.DB.prepare(`
      INSERT INTO version_source_metadata (
        version_id, source_title, source_artist, encoding, status, error_code
      ) VALUES (?, 'Internal Snapshot Source', 'Internal Snapshot Artist', 'utf-8', 'succeeded', NULL)
    `).bind(versionId).run();
    const afterRequest = new Request("http://localhost/api/difficulty-tables/rc-star/data.json");
    const afterResponse = await difficultyTablesModule.handleDifficultyTableRoute(
      afterRequest,
      env,
      "/api/difficulty-tables/rc-star/data.json"
    );
    assert.equal(afterResponse.status, 200);
    const [beforeItem] = JSON.parse(before);
    const [afterItem] = await afterResponse.json();
    const legacyKeys = [
      "md5", "level", "title", "artist", "url", "url_diff", "name_diff",
      "bms_wip_original_difficulty", "bms_wip_chart_name", "bms_wip_version",
      "bms_wip_author", "bms_wip_completed_at", "bms_wip_subtitle", "bms_wip_subartist"
    ];
    for (const key of legacyKeys) {
      assert.deepEqual(afterItem[key], beforeItem[key], `legacy difficulty-table field changed: ${key}`);
    }
    assert.equal(afterItem.bms_wip_display_title, "Internal Snapshot Source Snapshot Chart");
    assert.equal(afterItem.bms_wip_display_artist, "Internal Snapshot Artist");
    assert.equal(afterItem.bms_wip_source_title, "Internal Snapshot Source");
    assert.equal(afterItem.bms_wip_source_artist, "Internal Snapshot Artist");
  });
}

async function testR2CleanupOnDatabaseFailure() {
  await check("metadata-table configuration failure rolls back D1 and cleans the uploaded R2 object", async () => {
    await env.DB.prepare("DROP TABLE version_source_metadata").run();
    const beforeObjects = (await env.FILES.list()).objects.length;
    const bytes = utf8Bms({ title: "Cleanup Source", artist: "Cleanup Artist", suffix: `cleanup-${++sequence}` });
    const response = await chartsModule.handleChartsRoute(
      makeInitialRequest(bytes, { title: `Cleanup Display ${sequence}`, artist: `Cleanup Display Artist ${sequence}` }),
      env
    );
    assert.equal(response.status, 500);
    assert.equal((await env.FILES.list()).objects.length, beforeObjects);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE title = ?", `Cleanup Display ${sequence}`)).count, 0);
  });
}

await testMigrationAndConstraints();
await testPreparationHelper();

try {
  await harness.listen();
  env = await harness.getWorker().getEnv();
  await applyHarnessMigrations();
  await testInitialSubmissions();
  await testAppendSubmissions();
  await testWarningInsertAndPublicRegression();
  await testR2CleanupOnDatabaseFailure();
  console.log(`version source metadata isolated tests: ${passed} checks passed`);
} finally {
  await harness.close();
}
