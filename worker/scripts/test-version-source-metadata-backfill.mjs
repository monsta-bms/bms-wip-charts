import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { build } from "esbuild";
import wrangler from "wrangler";

const { createTestHarness, unstable_splitSqlQuery: splitSqlQuery } = wrangler;
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workerRoot, "..");
const migrationFiles = [
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
const ADMIN_TOKEN = "isolated-backfill-admin-token";
const textEncoder = new TextEncoder();

let env;
let sequence = 0;
let passed = 0;
let lastNumber = 0;
const trackedR2Keys = new Set();
const performanceRows = [];
const testFrom = Number.parseInt(process.env.BACKFILL_TEST_FROM ?? "1", 10);
const testTo = Number.parseInt(process.env.BACKFILL_TEST_TO ?? "87", 10);

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
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const [adminModule, sourceMetadataModule] = await Promise.all([
  importBundled("src/routes/admin.ts"),
  importBundled("src/utils/versionSourceMetadata.ts")
]);

async function check(number, name, action) {
  assert.equal(number, lastNumber + 1, `test numbering drift before ${name}`);
  lastNumber = number;
  if (number < testFrom || number > testTo) return;
  console.log(`run ${number} - ${name}`);
  await action();
  passed += 1;
  console.log(`ok ${number} - ${name}`);
}

async function readMigration(name) {
  return readFile(resolve(workerRoot, "migrations", name), "utf8");
}

const harness = createTestHarness({
  root: workerRoot,
  workers: [{
    configPath: "wrangler.toml",
    vars: { ALLOWED_ORIGINS: "http://localhost" },
    secrets: {
      ADMIN_TOKEN,
      HASH_SECRET: "isolated-backfill-hash-secret"
    }
  }]
});

async function applyMigrations() {
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
  return (await env.DB.prepare(sql).bind(...bindings).all()).results ?? [];
}

async function resetIsolation() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_logs"),
    env.DB.prepare("DELETE FROM version_source_metadata"),
    env.DB.prepare("DELETE FROM versions"),
    env.DB.prepare("DELETE FROM charts"),
    env.DB.prepare("DELETE FROM songs")
  ]);
  for (const key of trackedR2Keys) {
    await env.FILES.delete(key);
  }
  trackedR2Keys.clear();
}

function utf8Bms({
  title = "Backfill Title",
  subtitle = "Backfill Subtitle",
  artist = "Backfill Artist",
  subartist = "Backfill Subartist",
  bom = false
} = {}) {
  const body = Buffer.from([
    "#PLAYER 1",
    `#TITLE ${title}`,
    ...(subtitle === null ? [] : [`#SUBTITLE ${subtitle}`]),
    `#ARTIST ${artist}`,
    ...(subartist === null ? [] : [`#SUBARTIST ${subartist}`]),
    "#BPM 120",
    "#00111:01"
  ].join("\r\n") + "\r\n", "utf8");
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

function cp932Bms() {
  return Buffer.concat([
    Buffer.from("#PLAYER 1\r\n#TITLE ", "ascii"),
    Buffer.from([0x82, 0xa0, 0x82, 0xa2]),
    Buffer.from("\r\n#ARTIST CP932 Artist\r\n#BPM 120\r\n#00111:01\r\n", "ascii")
  ]);
}

async function zipEntries(entries) {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [name, bytes] of entries) {
    await writer.add(name, new BlobReader(new Blob([bytes])));
  }
  return Buffer.from(await (await writer.close()).arrayBuffer());
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function seedVersion({
  id,
  fileName = "source.bms",
  bytes = utf8Bms(),
  putObject = true,
  fileDeleted = false,
  metadata = null
} = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(5, "0");
  const versionId = id ?? `version_${suffix}`;
  const songId = `song_${suffix}`;
  const chartId = `chart_${suffix}`;
  const r2Key = `backfill/${suffix}/source`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO songs (id, title, artist, normalized_title, normalized_artist)
      VALUES (?, ?, 'Tester', ?, 'tester')
    `).bind(songId, `Song ${suffix}`, `song ${suffix}`),
    env.DB.prepare(`
      INSERT INTO charts (id, song_id, chart_name, normalized_chart_name)
      VALUES (?, ?, ?, ?)
    `).bind(chartId, songId, `Chart ${suffix}`, `chart ${suffix}`),
    env.DB.prepare(`
      INSERT INTO versions (
        id, chart_id, version_number, branch_path, author, progress,
        title, artist, file_id, file_name, file_size, file_sha256,
        r2_key, file_deleted_at, password_hash
      ) VALUES (?, ?, 1, ?, 'Tester', 50, ?, 'Tester', ?, ?, ?, ?, ?, ?, 'hash')
    `).bind(
      versionId,
      chartId,
      `root_${suffix}`,
      `Song ${suffix}`,
      `file_${suffix}`,
      fileName,
      bytes.byteLength,
      await sha256Hex(`sha:${suffix}`),
      r2Key,
      fileDeleted ? "2026-07-01T00:00:00.000Z" : null
    )
  ]);
  if (putObject) {
    await env.FILES.put(r2Key, bytes);
    trackedR2Keys.add(r2Key);
  }
  if (metadata) {
    await env.DB.prepare(`
      INSERT INTO version_source_metadata (
        version_id, source_title, source_artist, encoding, status, error_code
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      versionId,
      metadata.sourceTitle ?? null,
      metadata.sourceArtist ?? null,
      metadata.encoding ?? null,
      metadata.status,
      metadata.errorCode ?? null
    ).run();
  }
  return { versionId, r2Key, bytes };
}

function instrumentEnvironment(options = {}) {
  const counters = {
    d1Queries: 0,
    d1Writes: 0,
    r2Get: 0,
    r2Head: 0,
    r2Put: 0,
    r2Delete: 0
  };

  function wrapStatement(statement, sql) {
    return {
      bind(...values) {
        return wrapStatement(statement.bind(...values), sql);
      },
      async all() {
        counters.d1Queries += 1;
        if (options.failCandidateSelect && /FROM versions\s+LEFT JOIN version_source_metadata/u.test(sql)) {
          throw new Error("isolated candidate select failure");
        }
        return statement.all();
      },
      async first() {
        counters.d1Queries += 1;
        return statement.first();
      },
      async run() {
        counters.d1Queries += 1;
        if (/^\s*(INSERT|UPDATE|DELETE)/iu.test(sql)) counters.d1Writes += 1;
        return statement.run();
      },
      async raw(...values) {
        counters.d1Queries += 1;
        return statement.raw(...values);
      }
    };
  }

  const database = {
    prepare(sql) {
      return wrapStatement(env.DB.prepare(sql), sql);
    },
    batch(statements) {
      counters.d1Queries += statements.length;
      return env.DB.batch(statements);
    },
    exec(sql) {
      counters.d1Queries += 1;
      return env.DB.exec(sql);
    },
    withSession(constraint) {
      return env.DB.withSession(constraint);
    },
    dump() {
      return env.DB.dump();
    }
  };

  const files = {
    async get(key, getOptions) {
      counters.r2Get += 1;
      if (options.getError) throw new Error("isolated R2 get failure");
      const object = await env.FILES.get(key, getOptions);
      if (options.deleteVersionOnGet) {
        await env.DB.prepare("DELETE FROM versions WHERE r2_key = ?").bind(key).run();
      }
      if (object && options.bodyError) {
        return new Proxy(object, {
          get(target, property) {
            if (property === "arrayBuffer") {
              return async () => { throw new Error("isolated R2 body failure"); };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
      }
      return object;
    },
    async head(key) {
      counters.r2Head += 1;
      return env.FILES.head(key);
    },
    async put(key, value, putOptions) {
      counters.r2Put += 1;
      return env.FILES.put(key, value, putOptions);
    },
    async delete(keys) {
      counters.r2Delete += 1;
      return env.FILES.delete(keys);
    },
    list(listOptions) {
      return env.FILES.list(listOptions);
    },
    createMultipartUpload(key, multipartOptions) {
      return env.FILES.createMultipartUpload(key, multipartOptions);
    },
    resumeMultipartUpload(key, uploadId) {
      return env.FILES.resumeMultipartUpload(key, uploadId);
    }
  };

  return {
    wrapped: { ...env, DB: database, FILES: files },
    counters
  };
}

function makeRequest(body = {}, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (!options.omitAuthorization) headers.set("Authorization", `Bearer ${options.token ?? ADMIN_TOKEN}`);
  if (!options.omitContentType) headers.set("Content-Type", options.contentType ?? "application/json");
  return new Request("http://localhost/api/admin/version-source-metadata/backfill", {
    method: options.method ?? "POST",
    headers,
    body: (options.method ?? "POST") === "GET"
      ? undefined
      : options.rawBody ?? JSON.stringify(body)
  });
}

async function callBackfill(body = {}, options = {}) {
  const targetEnv = options.targetEnv ?? env;
  const response = await adminModule.handleAdminRoute(
    makeRequest(body, options),
    targetEnv,
    ["version-source-metadata", "backfill"]
  );
  return { response, body: await response.json() };
}

async function metadataFor(versionId) {
  return first(`
    SELECT source_title, source_subtitle, source_artist, source_subartist,
           encoding, status, error_code
    FROM version_source_metadata
    WHERE version_id = ?
  `, versionId);
}

async function runTests() {
  await check(1, "ADMIN_TOKEN未設定は共通認証で拒否", async () => {
    const targetEnv = { ...env, ADMIN_TOKEN: undefined };
    const result = await callBackfill({}, { targetEnv });
    assert.equal(result.response.status, 500);
    assert.equal(result.body.code, "CONFIG_MISSING");
  });
  await check(2, "Authorizationなしは401", async () => {
    const result = await callBackfill({}, { omitAuthorization: true });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.code, "ADMIN_AUTH_REQUIRED");
  });
  await check(3, "不正tokenは401", async () => {
    const result = await callBackfill({}, { token: "invalid" });
    assert.equal(result.response.status, 401);
  });
  await check(4, "正しいtokenで管理APIへ到達", async () => {
    await resetIsolation();
    const result = await callBackfill({});
    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
  });
  await check(5, "GETは405", async () => {
    const result = await callBackfill({}, { method: "GET" });
    assert.equal(result.response.status, 405);
    assert.equal(result.body.code, "METHOD_NOT_ALLOWED");
  });
  await check(6, "Content-Type不正は400", async () => {
    const result = await callBackfill({}, { contentType: "text/plain" });
    assert.equal(result.response.status, 400);
  });
  await check(7, "JSON不正は400", async () => {
    const result = await callBackfill({}, { rawBody: "{" });
    assert.equal(result.response.status, 400);
  });
  await check(8, "limit省略時は5", async () => {
    await resetIsolation();
    for (let index = 0; index < 6; index += 1) await seedVersion({ fileDeleted: true });
    const result = await callBackfill({});
    assert.equal(result.body.limit, 5);
    assert.equal(result.body.selectedCount, 5);
  });
  await check(9, "limit=1を受理", async () => {
    const result = await callBackfill({ limit: 1 });
    assert.equal(result.body.limit, 1);
  });
  await check(10, "limit=20を受理", async () => {
    const result = await callBackfill({ limit: 20 });
    assert.equal(result.body.limit, 20);
  });
  for (const [number, value, label] of [
    [11, 0, "limit=0"],
    [12, 21, "limit=21"],
    [13, 1.5, "limit小数"]
  ]) {
    await check(number, `${label}を拒否`, async () => {
      const result = await callBackfill({ limit: value });
      assert.equal(result.response.status, 400);
    });
  }
  await check(14, "afterVersionId 161文字を拒否", async () => {
    const result = await callBackfill({ afterVersionId: "v".repeat(161) });
    assert.equal(result.response.status, 400);
  });
  await check(15, "dryRun非booleanを拒否", async () => {
    const result = await callBackfill({ dryRun: "false" });
    assert.equal(result.response.status, 400);
  });
  await check(16, "retryFailed非booleanを拒否", async () => {
    const result = await callBackfill({ retryFailed: 1 });
    assert.equal(result.response.status, 400);
  });

  await check(17, "dry-runでmetadataなし単体BMSを解析", async () => {
    await resetIsolation();
    await seedVersion();
    const result = await callBackfill({});
    assert.equal(result.body.results[0].status, "succeeded");
  });
  await check(18, "dry-runでmetadataなしZIPを解析", async () => {
    await resetIsolation();
    await seedVersion({ fileName: "source.ZIP", bytes: await zipEntries([["inside/chart.bms", utf8Bms()]]) });
    const result = await callBackfill({});
    assert.equal(result.body.results[0].status, "succeeded");
  });
  await check(19, "dry-run後metadata行は0", async () => {
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata")).count, 0);
  });
  await check(20, "dry-run後admin_logs増加は0", async () => {
    assert.equal((await first("SELECT COUNT(*) AS count FROM admin_logs")).count, 0);
  });
  await check(21, "dry-runはR2を変更しない", async () => {
    await resetIsolation();
    await seedVersion();
    const instrumented = instrumentEnvironment();
    await callBackfill({}, { targetEnv: instrumented.wrapped });
    assert.equal(instrumented.counters.r2Put, 0);
    assert.equal(instrumented.counters.r2Delete, 0);
    assert.equal(instrumented.counters.r2Get, 1);
  });
  await check(22, "新規dry-runはwould_insert", async () => {
    const result = await callBackfill({});
    assert.equal(result.body.results[0].action, "would_insert");
  });
  await check(23, "retry対象dry-runはwould_update", async () => {
    await resetIsolation();
    await seedVersion({ metadata: { status: "failed", errorCode: "OLD_FAILURE" } });
    const result = await callBackfill({ retryFailed: true });
    assert.equal(result.body.results[0].action, "would_update");
  });
  await check(24, "dry-run responseは本文・encoding・内部情報を返さない", async () => {
    const result = await callBackfill({ retryFailed: true });
    const text = JSON.stringify(result.body);
    assert.doesNotMatch(text, /Backfill Title|Backfill Artist|encoding|r2_key|file_name/u);
  });

  await check(25, "単体UTF-8を保存", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ bytes: utf8Bms({ title: "UTF8 Source", artist: "UTF8 Artist" }) });
    const result = await callBackfill({ dryRun: false });
    assert.equal(result.body.results[0].action, "inserted");
    assert.equal((await metadataFor(seeded.versionId)).source_title, "UTF8 Source");
  });
  await check(26, "UTF-8 BOMを保存", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ bytes: utf8Bms({ title: "BOM Source", artist: "BOM Artist", bom: true }) });
    await callBackfill({ dryRun: false });
    const metadata = await metadataFor(seeded.versionId);
    assert.equal(metadata.source_title, "BOM Source");
    assert.equal(metadata.encoding, "utf-8");
  });
  await check(27, "CP932を保存", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ bytes: cp932Bms() });
    await callBackfill({ dryRun: false });
    const metadata = await metadataFor(seeded.versionId);
    assert.equal(metadata.encoding, "shift_jis");
    assert.equal(metadata.source_title, "あい");
  });
  await check(28, "ZIP内の単一BMSを保存", async () => {
    await resetIsolation();
    const bytes = await zipEntries([["inside/chart.bms", utf8Bms({ title: "ZIP Source", artist: "ZIP Artist" })]]);
    const seeded = await seedVersion({ fileName: "archive.zip", bytes });
    await callBackfill({ dryRun: false });
    assert.equal((await metadataFor(seeded.versionId)).source_title, "ZIP Source");
  });
  await check(29, "source4項目を生値のまま保存", async () => {
    await resetIsolation();
    const seeded = await seedVersion({
      bytes: utf8Bms({ title: "Raw [Title]", subtitle: "Raw -- Subtitle", artist: "OBJ:Artist", subartist: "obj.Subartist" })
    });
    await callBackfill({ dryRun: false });
    assert.deepEqual(await metadataFor(seeded.versionId), {
      source_title: "Raw [Title]",
      source_subtitle: "Raw -- Subtitle",
      source_artist: "OBJ:Artist",
      source_subartist: "obj.Subartist",
      encoding: "utf-8",
      status: "succeeded",
      error_code: null
    });
  });
  await check(30, "encodingを保存", async () => {
    const row = await first("SELECT encoding FROM version_source_metadata LIMIT 1");
    assert.equal(row.encoding, "utf-8");
  });
  await check(31, "metadataなしから1行insert", async () => {
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata")).count, 1);
  });
  await check(32, "2回目はsucceededを候補外にする", async () => {
    const second = await callBackfill({ dryRun: false, retryFailed: true });
    assert.equal(second.body.selectedCount, 0);
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata")).count, 1);
  });
  await check(33, "succeededを再解析で上書きしない", async () => {
    const version = await first("SELECT id, r2_key FROM versions LIMIT 1");
    await env.FILES.put(version.r2_key, utf8Bms({ title: "Changed", artist: "Changed" }));
    await callBackfill({ dryRun: false, retryFailed: true });
    assert.equal((await metadataFor(version.id)).source_title, "Raw [Title]");
  });

  await check(34, "file_deleted_atありはGETせずunavailable", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ fileDeleted: true, putObject: false });
    const instrumented = instrumentEnvironment();
    const result = await callBackfill({ dryRun: false }, { targetEnv: instrumented.wrapped });
    assert.equal(result.body.results[0].errorCode, "SOURCE_FILE_DELETED");
    assert.equal(instrumented.counters.r2Get, 0);
    assert.equal((await metadataFor(seeded.versionId)).status, "unavailable");
  });
  await check(35, "R2オブジェクトなしはunavailable", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ putObject: false });
    const result = await callBackfill({ dryRun: false });
    assert.equal(result.body.results[0].errorCode, "SOURCE_R2_OBJECT_MISSING");
    assert.equal((await metadataFor(seeded.versionId)).status, "unavailable");
  });
  await check(36, "R2 get例外はSOURCE_FILE_READ_FAILED", async () => {
    await resetIsolation();
    const seeded = await seedVersion();
    const instrumented = instrumentEnvironment({ getError: true });
    const result = await callBackfill({ dryRun: false }, { targetEnv: instrumented.wrapped });
    assert.equal(result.body.results[0].errorCode, "SOURCE_FILE_READ_FAILED");
    assert.equal((await metadataFor(seeded.versionId)).status, "failed");
  });
  await check(37, "壊れたZIPをfailedへ分類", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ fileName: "broken.zip", bytes: Buffer.from("not-a-zip") });
    await callBackfill({ dryRun: false });
    assert.equal((await metadataFor(seeded.versionId)).status, "failed");
  });
  await check(38, "複数BMS ZIPを拒否", async () => {
    await resetIsolation();
    const bytes = await zipEntries([["a.bms", utf8Bms()], ["b.bme", utf8Bms()]]);
    const seeded = await seedVersion({ fileName: "multiple.zip", bytes });
    await callBackfill({ dryRun: false });
    assert.equal((await metadataFor(seeded.versionId)).error_code, "ZIP_MULTIPLE_CHART_FILES");
  });
  await check(39, "譜面なしZIPを拒否", async () => {
    await resetIsolation();
    const bytes = await zipEntries([["readme.txt", Buffer.from("readme")]]);
    const seeded = await seedVersion({ fileName: "empty.zip", bytes });
    await callBackfill({ dryRun: false });
    assert.equal((await metadataFor(seeded.versionId)).error_code, "ZIP_CHART_NOT_FOUND");
  });
  await check(40, "不明拡張子はGETせずfailed", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ fileName: "source.txt" });
    const instrumented = instrumentEnvironment();
    await callBackfill({ dryRun: false }, { targetEnv: instrumented.wrapped });
    assert.equal((await metadataFor(seeded.versionId)).error_code, "SOURCE_FILE_TYPE_UNSUPPORTED");
    assert.equal(instrumented.counters.r2Get, 0);
  });
  await check(41, "metadata parse警告は安全なfailedへ変換", async () => {
    const prepared = sourceMetadataModule.prepareVersionSourceMetadata({
      parsedMetadata: {},
      metadataWarning: { code: "BMS_METADATA_PARSE_FAILED" }
    });
    assert.equal(prepared.status, "failed");
    assert.equal(prepared.errorCode, "BMS_METADATA_PARSE_FAILED");
  });
  await check(42, "4097文字を切り詰めずfailed", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ bytes: utf8Bms({ title: "長".repeat(4097), artist: "Artist" }) });
    await callBackfill({ dryRun: false });
    const metadata = await metadataFor(seeded.versionId);
    assert.equal(metadata.error_code, "SOURCE_METADATA_VALUE_TOO_LONG");
    assert.equal(metadata.source_title, null);
  });
  await check(43, "1件失敗後も次候補を処理", async () => {
    await resetIsolation();
    await seedVersion({ id: "version_a", fileName: "unsupported.txt" });
    const valid = await seedVersion({ id: "version_b" });
    const result = await callBackfill({ dryRun: false, limit: 2 });
    assert.equal(result.body.processedCount, 2);
    assert.equal((await metadataFor(valid.versionId)).status, "succeeded");
  });

  await check(44, "retryFailed=falseはfailedを除外", async () => {
    await resetIsolation();
    await seedVersion({ metadata: { status: "failed", errorCode: "OLD_FAILURE" } });
    assert.equal((await callBackfill({})).body.selectedCount, 0);
  });
  await check(45, "retryFailed=falseはunavailableを除外", async () => {
    await resetIsolation();
    await seedVersion({ metadata: { status: "unavailable", errorCode: "SOURCE_R2_OBJECT_MISSING" } });
    assert.equal((await callBackfill({})).body.selectedCount, 0);
  });
  await check(46, "retryFailed=trueはfailedを再処理", async () => {
    const result = await callBackfill({ retryFailed: true });
    assert.equal(result.body.selectedCount, 1);
    assert.equal(result.body.results[0].status, "succeeded");
  });
  await check(47, "retryFailed=trueはunavailableを再処理", async () => {
    await resetIsolation();
    await seedVersion({ metadata: { status: "unavailable", errorCode: "SOURCE_R2_OBJECT_MISSING" } });
    const result = await callBackfill({ retryFailed: true });
    assert.equal(result.body.results[0].action, "would_update");
  });
  await check(48, "failedをsucceededへ更新", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ metadata: { status: "failed", errorCode: "OLD_FAILURE" } });
    const result = await callBackfill({ dryRun: false, retryFailed: true });
    assert.equal(result.body.results[0].action, "updated");
    assert.equal((await metadataFor(seeded.versionId)).status, "succeeded");
  });
  await check(49, "unavailableをsucceededへ更新", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ metadata: { status: "unavailable", errorCode: "SOURCE_FILE_DELETED" } });
    await callBackfill({ dryRun: false, retryFailed: true });
    assert.equal((await metadataFor(seeded.versionId)).status, "succeeded");
  });
  await check(50, "succeededはretryFailed=trueでも候補外", async () => {
    await resetIsolation();
    await seedVersion({ metadata: { status: "succeeded", sourceTitle: "Stable", encoding: "utf-8" } });
    const result = await callBackfill({ retryFailed: true });
    assert.equal(result.body.selectedCount, 0);
  });

  await check(51, "候補はversion ID昇順", async () => {
    await resetIsolation();
    await seedVersion({ id: "version_c" });
    await seedVersion({ id: "version_a" });
    await seedVersion({ id: "version_b" });
    const result = await callBackfill({ limit: 3 });
    assert.deepEqual(result.body.results.map((row) => row.versionId), ["version_a", "version_b", "version_c"]);
  });
  await check(52, "limit+1でhasMoreを判定", async () => {
    const result = await callBackfill({ limit: 2 });
    assert.equal(result.body.selectedCount, 2);
    assert.equal(result.body.hasMore, true);
  });
  await check(53, "nextAfterVersionIdは最後に走査したID", async () => {
    const result = await callBackfill({ limit: 2 });
    assert.equal(result.body.nextAfterVersionId, "version_b");
  });
  await check(54, "次ページに重複しない", async () => {
    const firstPage = await callBackfill({ limit: 2 });
    const secondPage = await callBackfill({ limit: 2, afterVersionId: firstPage.body.nextAfterVersionId });
    assert.deepEqual(secondPage.body.results.map((row) => row.versionId), ["version_c"]);
  });
  await check(55, "最終ページはhasMore=false", async () => {
    const result = await callBackfill({ limit: 2, afterVersionId: "version_b" });
    assert.equal(result.body.hasMore, false);
  });
  await check(56, "候補0件はcursor=null", async () => {
    await resetIsolation();
    const result = await callBackfill({});
    assert.equal(result.body.selectedCount, 0);
    assert.equal(result.body.nextAfterVersionId, null);
    assert.equal(result.body.hasMore, false);
  });
  await check(57, "失敗行があってもcursorは進む", async () => {
    await seedVersion({ id: "version_a", fileName: "bad.txt" });
    await seedVersion({ id: "version_b" });
    const firstPage = await callBackfill({ limit: 1 });
    const secondPage = await callBackfill({ limit: 1, afterVersionId: firstPage.body.nextAfterVersionId });
    assert.equal(firstPage.body.nextAfterVersionId, "version_a");
    assert.equal(secondPage.body.results[0].versionId, "version_b");
  });

  await check(58, "同じ候補への2回同時実行が両方完了", async () => {
    await resetIsolation();
    await seedVersion();
    const [left, right] = await Promise.all([
      callBackfill({ dryRun: false }),
      callBackfill({ dryRun: false })
    ]);
    assert.equal(left.response.status, 200);
    assert.equal(right.response.status, 200);
  });
  await check(59, "同時実行でもmetadataは1行", async () => {
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata")).count, 1);
  });
  await check(60, "version削除後に孤立metadataを残さない", async () => {
    const version = await first("SELECT id FROM versions LIMIT 1");
    await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(version.id).run();
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata WHERE version_id = ?", version.id)).count, 0);
  });
  await check(61, "R2解析中のversion削除はstate changedでskip", async () => {
    await resetIsolation();
    const seeded = await seedVersion();
    const instrumented = instrumentEnvironment({ deleteVersionOnGet: true });
    const result = await callBackfill({ dryRun: false }, { targetEnv: instrumented.wrapped });
    assert.equal(result.body.results[0].action, "skipped");
    assert.equal(result.body.results[0].errorCode, "SOURCE_VERSION_STATE_CHANGED");
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata WHERE version_id = ?", seeded.versionId)).count, 0);
  });
  await check(62, "16D相当の物理削除と競合しても削除側を妨害しない", async () => {
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions")).count, 0);
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata")).count, 0);
  });
  await check(63, "version削除時CASCADEを維持", async () => {
    await resetIsolation();
    const seeded = await seedVersion({ metadata: { status: "succeeded", sourceTitle: "Cascade", encoding: "utf-8" } });
    await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(seeded.versionId).run();
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_source_metadata WHERE version_id = ?", seeded.versionId)).count, 0);
  });

  await check(64, "write runはsummaryを1件保存", async () => {
    await resetIsolation();
    await seedVersion();
    await callBackfill({ dryRun: false });
    assert.equal((await first(`
      SELECT COUNT(*) AS count FROM admin_logs
      WHERE action = 'version_source_metadata_backfill' AND target_type = 'system'
    `)).count, 1);
  });
  await check(65, "dry-runはadmin logを0件に保つ", async () => {
    await resetIsolation();
    await seedVersion();
    await callBackfill({});
    assert.equal((await first("SELECT COUNT(*) AS count FROM admin_logs")).count, 0);
  });
  await check(66, "成功runはinfo/completed", async () => {
    await callBackfill({ dryRun: false });
    const log = await first("SELECT level, reason FROM admin_logs WHERE target_type = 'system' LIMIT 1");
    assert.deepEqual(log, { level: "info", reason: "completed" });
  });
  await check(67, "個別失敗runはwarning/completed_with_errors", async () => {
    await resetIsolation();
    await seedVersion({ fileName: "unsupported.txt" });
    await callBackfill({ dryRun: false });
    const log = await first("SELECT level, reason FROM admin_logs WHERE target_type = 'system' LIMIT 1");
    assert.deepEqual(log, { level: "warning", reason: "completed_with_errors" });
  });
  await check(68, "fatal selectは500とerror/failed summary", async () => {
    await resetIsolation();
    await seedVersion();
    const instrumented = instrumentEnvironment({ failCandidateSelect: true });
    const result = await callBackfill({ dryRun: false }, { targetEnv: instrumented.wrapped });
    assert.equal(result.response.status, 500);
    assert.equal(result.body.code, "SOURCE_METADATA_BACKFILL_FAILED");
    const log = await first("SELECT level, reason FROM admin_logs WHERE target_type = 'system' LIMIT 1");
    assert.deepEqual(log, { level: "error", reason: "failed" });
  });
  await check(69, "個別診断ログは最大10件", async () => {
    await resetIsolation();
    for (let index = 0; index < 12; index += 1) await seedVersion({ fileName: "unsupported.txt" });
    await callBackfill({ dryRun: false, limit: 20 });
    assert.equal((await first(`
      SELECT COUNT(*) AS count FROM admin_logs
      WHERE action = 'version_source_metadata_backfill' AND target_type = 'version'
    `)).count, 10);
  });
  await check(70, "admin_logsにR2 keyを含めない", async () => {
    const text = JSON.stringify(await all("SELECT target_id, detail FROM admin_logs"));
    for (const key of trackedR2Keys) assert.equal(text.includes(key), false);
  });
  await check(71, "admin_logsにsource本文を含めない", async () => {
    const text = JSON.stringify(await all("SELECT detail FROM admin_logs"));
    assert.doesNotMatch(text, /Backfill Title|Backfill Artist/u);
  });
  await check(72, "admin_logsにADMIN_TOKENを含めない", async () => {
    const text = JSON.stringify(await all("SELECT detail FROM admin_logs"));
    assert.equal(text.includes(ADMIN_TOKEN), false);
  });
  await check(73, "admin_logsにURL全文を含めない", async () => {
    const text = JSON.stringify(await all("SELECT detail FROM admin_logs"));
    assert.doesNotMatch(text, /https?:\/\//u);
  });

  await check(74, "初回投稿のPhase A metadata保存接続を維持", async () => {
    const source = await readFile(resolve(workerRoot, "src/routes/charts.ts"), "utf8");
    assert.match(source, /buildVersionSourceMetadataInsertStatement/u);
    assert.match(source, /prepareVersionSourceMetadata/u);
  });
  await check(75, "追記投稿のPhase A metadata保存接続を維持", async () => {
    const source = await readFile(resolve(workerRoot, "src/routes/chartVersions.ts"), "utf8");
    assert.match(source, /buildVersionSourceMetadataInsertStatement/u);
    assert.match(source, /prepareVersionSourceMetadata/u);
  });
  await check(76, "canonical schemaと0009のCASCADE定義を維持", async () => {
    const [schema, migration] = await Promise.all([
      readFile(resolve(repositoryRoot, "schema/d1.sql"), "utf8"),
      readMigration("0009_version_source_metadata.sql")
    ]);
    assert.match(schema, /version_source_metadata[\s\S]+ON DELETE CASCADE/u);
    assert.match(migration, /version_source_metadata[\s\S]+ON DELETE CASCADE/u);
  });
  await check(77, "Phase C難易度表は承認済みsource表示項目だけを公開する", async () => {
    const source = await readFile(resolve(workerRoot, "src/routes/difficultyTables.ts"), "utf8");
    assert.match(source, /LEFT JOIN version_source_metadata/u);
    assert.match(source, /bms_wip_source_title/u);
    assert.match(source, /bms_wip_source_artist/u);
    assert.doesNotMatch(source, /error_code AS|r2_key AS|password_hash AS|bms_wip_source_metadata_status/u);
  });
  await check(78, "曲・DLリンク回帰テスト入口を維持", async () => {
    const source = await readFile(resolve(workerRoot, "scripts/test-version-list-links.mjs"), "utf8");
    assert.match(source, /originUrl/u);
    assert.match(source, /downloadUrl/u);
  });
  await check(79, "withdrawal active 18件の回帰テスト入口を維持", async () => {
    const source = await readFile(resolve(workerRoot, "scripts/test-version-withdrawal-active.mjs"), "utf8");
    assert.match(source, /version withdrawal active isolated tests/u);
  });
  await check(80, "Cron式を従来どおり維持", async () => {
    const config = await readFile(resolve(workerRoot, "wrangler.toml"), "utf8");
    assert.match(config, /crons = \["0 18 \* \* \*", "0 \* \* \* \*"\]/u);
  });
  await check(81, "WITHDRAWAL_CRON_MODE=activeを維持", async () => {
    const config = await readFile(resolve(workerRoot, "wrangler.toml"), "utf8");
    assert.match(config, /WITHDRAWAL_CRON_MODE = "active"/u);
  });
  await check(82, "PagesへPhase B runtime依存を追加しない", async () => {
    const adminSource = await readFile(resolve(workerRoot, "src/routes/admin.ts"), "utf8");
    assert.doesNotMatch(adminSource, /\.\.\/\.\.\/docs/u);
  });

  async function measure(label, limit, seed) {
    await resetIsolation();
    await seed();
    const instrumented = instrumentEnvironment();
    const startedAt = performance.now();
    const result = await callBackfill({ limit }, { targetEnv: instrumented.wrapped });
    const durationMs = Number((performance.now() - startedAt).toFixed(2));
    const responseBytes = Buffer.byteLength(JSON.stringify(result.body));
    assert.equal(instrumented.counters.r2Put, 0);
    assert.equal(instrumented.counters.r2Delete, 0);
    performanceRows.push({
      label,
      limit,
      selectedCount: result.body.selectedCount,
      durationMs,
      d1QueryCount: instrumented.counters.d1Queries,
      r2GetCount: instrumented.counters.r2Get,
      r2PutCount: instrumented.counters.r2Put,
      r2DeleteCount: instrumented.counters.r2Delete,
      responseBytes
    });
    return { result, counters: instrumented.counters };
  }

  await check(83, "性能計測 limit=5 単体BMS", async () => {
    const measured = await measure("single-bms-limit-5", 5, async () => {
      for (let index = 0; index < 5; index += 1) await seedVersion();
    });
    assert.equal(measured.counters.r2Get, 5);
    assert.equal(measured.counters.d1Queries, 1);
  });
  await check(84, "性能計測 limit=20 単体BMS", async () => {
    const measured = await measure("single-bms-limit-20", 20, async () => {
      for (let index = 0; index < 20; index += 1) await seedVersion();
    });
    assert.equal(measured.counters.r2Get, 20);
    assert.equal(measured.counters.d1Queries, 1);
  });
  await check(85, "性能計測 ZIP", async () => {
    const zipBytes = await zipEntries([["inside/chart.bms", utf8Bms()]]);
    const measured = await measure("zip-limit-5", 5, async () => {
      for (let index = 0; index < 5; index += 1) await seedVersion({ fileName: "source.zip", bytes: zipBytes });
    });
    assert.equal(measured.counters.r2Get, 5);
  });
  await check(86, "性能計測 混在で削除済みはGETしない", async () => {
    const measured = await measure("mixed-limit-20", 20, async () => {
      for (let index = 0; index < 5; index += 1) await seedVersion();
      for (let index = 0; index < 5; index += 1) await seedVersion({ fileDeleted: true, putObject: false });
      for (let index = 0; index < 5; index += 1) {
        await seedVersion({ metadata: { status: "unavailable", errorCode: "SOURCE_R2_OBJECT_MISSING" }, putObject: false });
      }
    });
    assert.equal(measured.result.body.selectedCount, 10);
    assert.equal(measured.counters.r2Get, 5);
  });
  await check(87, "性能計測はR2 PUT/DELETE 0件", async () => {
    assert.ok(performanceRows.length >= 4);
    assert.ok(performanceRows.every((row) => row.r2PutCount === 0 && row.r2DeleteCount === 0));
  });
}

try {
  await harness.listen();
  env = await harness.getWorker().getEnv();
  await applyMigrations();
  await runTests();
  console.log(`version source metadata backfill tests passed: ${passed}`);
  if (performanceRows.length > 0) console.log(JSON.stringify({ performance: performanceRows }));
} finally {
  await resetIsolation().catch(() => undefined);
  await harness.close();
}
