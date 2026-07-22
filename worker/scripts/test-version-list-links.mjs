import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  "0008_withdrawal_handling.sql"
];

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

const { handlePublicVersionListRoute } = await importBundled("src/routes/versionList.ts");
const harness = createTestHarness({
  root: workerRoot,
  workers: [{
    configPath: "wrangler.toml",
    vars: { ALLOWED_ORIGINS: "http://localhost" },
    secrets: { HASH_SECRET: "isolated-list-secret", ADMIN_TOKEN: "isolated-list-admin" }
  }]
});

let env;
let sequence = 0;
let passed = 0;

async function applyMigrations() {
  for (const file of migrationFiles) {
    const sql = await readFile(resolve(workerRoot, "migrations", file), "utf8");
    const executableSql = sql.replace(/\r\n/g, "\n").replace(/^\s*--.*$/gm, "").trim();
    for (const statement of splitSqlQuery(executableSql)) {
      await env.DB.prepare(statement).run();
    }
  }
}

async function createVersion(options = {}) {
  sequence += 1;
  const suffix = String(sequence);
  const songId = `list_song_${suffix}`;
  const chartId = `list_chart_${suffix}`;
  const versionId = options.versionId ?? `list_version_${suffix}`;
  const title = options.title ?? `Visible Song ${suffix}`;
  const chartName = options.chartName ?? `Chart ${suffix}`;
  const fileId = options.fileId ?? `list_file_${suffix}`;
  const createdAt = options.createdAt ?? `2026-07-${String(10 + sequence).padStart(2, "0")} 00:00:00`;
  await env.DB.prepare(`
    INSERT INTO songs (id, title, artist, normalized_title, normalized_artist)
    VALUES (?, ?, 'Tester', ?, 'tester')
  `).bind(songId, title, title.toLowerCase()).run();
  await env.DB.prepare(`
    INSERT INTO charts (id, song_id, chart_name, normalized_chart_name, is_hidden, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    chartId,
    songId,
    chartName,
    chartName.toLowerCase(),
    options.chartHidden ? 1 : 0,
    createdAt,
    options.chartUpdatedAt ?? createdAt
  ).run();
  await env.DB.prepare(`
    INSERT INTO versions (
      id, chart_id, version_number, branch_path, author, progress, comment,
      title, artist, is_rejected, file_id, file_name, file_size, file_sha256,
      r2_key, password_hash, download_blocked, download_block_reason, is_hidden,
      created_at, updated_at, completed_at, collapsed_by_completion,
      origin_url, chart_name, normalized_chart_name, withdrawal_download_blocked
    ) VALUES (
      ?, ?, 1, ?, 'Tester', ?, ?,
      ?, 'Tester', ?, ?, 'chart.bms', 8, ?,
      ?, 'isolated-hash', ?, ?, ?,
      ?, ?, ?, 0,
      ?, ?, ?, ?
    )
  `).bind(
    versionId,
    chartId,
    `root/${suffix}`,
    options.progress ?? 50,
    options.comment ?? "",
    title,
    options.rejected ? 1 : 0,
    fileId,
    `sha_${suffix}`,
    options.r2Key ?? `private/test-${suffix}.bms`,
    options.downloadBlocked ? 1 : 0,
    options.downloadBlocked ? "admin_blocked" : null,
    options.hidden ? 1 : 0,
    createdAt,
    createdAt,
    options.completed ? createdAt : null,
    options.originUrl ?? null,
    chartName,
    chartName.toLowerCase(),
    options.withdrawalBlocked ? 1 : 0
  ).run();
  return { songId, chartId, versionId, fileId };
}

async function createProcessingWithdrawal(version) {
  await env.DB.prepare(`
    INSERT INTO version_withdrawals (
      id, version_id, chart_id, status, request_mode, requested_at, scheduled_at,
      processing_at, processing_mode, lease_token, lease_expires_at, attempt_count,
      idempotency_key_hash, requester_ip_hash, requester_ua_hash, created_at, updated_at,
      handling_mode, request_reason
    ) VALUES (
      ?, ?, ?, 'processing', 'deferred', '2026-07-01 00:00:00', '2026-07-08 00:00:00',
      '2026-07-08 00:00:00', 'delete', 'isolated-lease', '2026-07-08 00:05:00', 1,
      ?, 'isolated-ip', 'isolated-ua', '2026-07-01 00:00:00', '2026-07-08 00:00:00',
      'grace_auto_delete', '隔離テスト用の取り下げ理由です。'
    )
  `).bind(
    `withdrawal_${version.versionId}`,
    version.versionId,
    version.chartId,
    `idempotency_${version.versionId}`
  ).run();
}

async function requestList(path = "/api/versions", options = {}) {
  const request = new Request(`http://localhost${path}`, options);
  const response = await handlePublicVersionListRoute(request, env, options.method === "POST");
  return { response, body: await response.json() };
}

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

try {
  await harness.listen();
  env = await harness.getWorker().getEnv();
  await applyMigrations();

  const availableWithOrigin = await createVersion({
    versionId: "available_origin",
    title: "Visible Alpha",
    chartName: "ANOTHER <&>",
    originUrl: "https://example.com/song?a=1&b=2",
    fileId: "file /?#%あ",
    createdAt: "2026-07-20 00:00:00",
    comment: "public comment"
  });
  const availableWithoutOrigin = await createVersion({ versionId: "available_no_origin" });
  const blockedWithOrigin = await createVersion({
    versionId: "blocked_origin",
    originUrl: "http://example.net/song",
    downloadBlocked: true,
    completed: true,
    progress: 100
  });
  const blockedWithoutOrigin = await createVersion({
    versionId: "blocked_no_origin",
    withdrawalBlocked: true,
    rejected: true
  });
  await createVersion({ versionId: "hidden_version", hidden: true, originUrl: "https://hidden.example/" });
  const processing = await createVersion({ versionId: "processing_version", originUrl: "https://processing.example/" });
  await createProcessingWithdrawal(processing);

  await check("GET exposes safe origin/download projections for all public link states", async () => {
    const { response, body } = await requestList("/api/versions?pageSize=100");
    assert.equal(response.status, 200);
    assert.equal(body.pagination.total, 4);
    const items = new Map(body.items.map((item) => [item.versionId, item]));
    assert.equal(items.get("available_origin").originUrl, "https://example.com/song?a=1&b=2");
    assert.equal(items.get("available_origin").file.downloadUrl, "/api/files/file%20%2F%3F%23%25%E3%81%82");
    assert.equal(items.get("available_no_origin").originUrl, null);
    assert.match(items.get("available_no_origin").file.downloadUrl, /^\/api\/files\//);
    assert.equal(items.get("blocked_origin").originUrl, "http://example.net/song");
    assert.equal(items.get("blocked_origin").file.downloadUrl, null);
    assert.equal(items.get("blocked_no_origin").originUrl, null);
    assert.equal(items.get("blocked_no_origin").file.downloadUrl, null);
    assert.equal(items.has("hidden_version"), false);
    assert.equal(items.has("processing_version"), false);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /r2_key|private\/test-/i);
  });

  await check("pagination, search, status, and date filters retain list behavior", async () => {
    const paged = await requestList("/api/versions?page=1&pageSize=2");
    assert.equal(paged.body.items.length, 2);
    assert.equal(paged.body.pagination.total, 4);
    assert.equal(paged.body.pagination.hasNext, true);
    const searched = await requestList("/api/versions?q=Visible%20Alpha&pageSize=100");
    assert.deepEqual(searched.body.items.map((item) => item.versionId), [availableWithOrigin.versionId]);
    const complete = await requestList("/api/versions?status=complete&pageSize=100");
    assert.deepEqual(complete.body.items.map((item) => item.versionId), [blockedWithOrigin.versionId]);
    const rejected = await requestList("/api/versions?status=rejected&pageSize=100");
    assert.deepEqual(rejected.body.items.map((item) => item.versionId), [blockedWithoutOrigin.versionId]);
    const dated = await requestList("/api/versions?dateFrom=2026-07-20&dateTo=2026-07-20&pageSize=100");
    assert.deepEqual(dated.body.items.map((item) => item.versionId), [availableWithOrigin.versionId]);
  });

  await check("favorites POST uses the same shape and preserves unavailable counts without duplicates", async () => {
    const { response, body } = await requestList("/api/versions/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        favoriteVersionIds: [availableWithOrigin.versionId, blockedWithOrigin.versionId, availableWithOrigin.versionId, "missing"],
        page: 1,
        pageSize: 100
      })
    });
    assert.equal(response.status, 200);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.unavailableFavoriteCount, 1);
    assert.equal(new Set(body.items.map((item) => item.versionId)).size, body.items.length);
    for (const item of body.items) {
      assert.equal(Object.hasOwn(item, "originUrl"), true);
      assert.equal(Object.hasOwn(item, "file"), true);
      assert.equal(Object.hasOwn(item.file, "downloadUrl"), true);
    }
  });

  await check("favorites accepts 200 unique IDs and rejects 201", async () => {
    const twoHundred = Array.from({ length: 200 }, (_, index) => `missing_${index}`);
    const accepted = await requestList("/api/versions/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favoriteVersionIds: twoHundred })
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.unavailableFavoriteCount, 200);
    const rejected = await requestList("/api/versions/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favoriteVersionIds: [...twoHundred, "missing_200"] })
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.code, "INVALID_FAVORITE_QUERY");
  });

  console.log(`version list link tests: ${passed} checks passed`);
} finally {
  await harness.close();
}
