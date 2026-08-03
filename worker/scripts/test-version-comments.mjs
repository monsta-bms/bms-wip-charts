import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import wrangler from "wrangler";

const { createTestHarness, unstable_splitSqlQuery: splitSqlQuery } = wrangler;
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = [
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
const TEST_SECRET = "isolated-version-comment-secret";

async function importWorker() {
  const result = await build({
    entryPoints: ["src/index.ts"],
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

const workerModule = await importWorker();
const harness = createTestHarness({
  root: workerRoot,
  workers: [{
    configPath: "wrangler.toml",
    vars: { ALLOWED_ORIGINS: "http://localhost" },
    secrets: { ABUSE_HASH_SECRET: TEST_SECRET }
  }]
});

let env;
let sequence = 0;
let passed = 0;

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function applyMigrations() {
  for (const file of migrations) {
    const sql = (await readFile(resolve(workerRoot, "migrations", file), "utf8"))
      .replace(/\r\n/g, "\n")
      .replace(/^\s*--.*$/gm, "")
      .trim();
    for (const statement of splitSqlQuery(sql)) {
      await env.DB.prepare(statement).run();
    }
  }
}

async function createVersion(options = {}) {
  sequence += 1;
  const suffix = String(sequence);
  const songId = `comment_song_${suffix}`;
  const chartId = `comment_chart_${suffix}`;
  const versionId = `comment_version_${suffix}`;
  await env.DB.prepare(`
    INSERT INTO songs (id, title, artist, normalized_title, normalized_artist)
    VALUES (?, ?, 'Comment Artist', ?, 'comment artist')
  `).bind(songId, `Comment Song ${suffix}`, `comment song ${suffix}`).run();
  await env.DB.prepare(`
    INSERT INTO charts (id, song_id, chart_name, normalized_chart_name, is_hidden)
    VALUES (?, ?, ?, ?, ?)
  `).bind(chartId, songId, `Comment Chart ${suffix}`, `comment chart ${suffix}`, options.chartHidden ? 1 : 0).run();
  await env.DB.prepare(`
    INSERT INTO versions (
      id, chart_id, version_number, branch_path, author, progress, comment,
      title, artist, file_id, file_name, file_size, file_sha256, r2_key,
      password_hash, password_hash_version, is_hidden, allow_append,
      chart_name, normalized_chart_name
    ) VALUES (?, ?, 1, 'root', 'Comment Author', 50, ?, ?, 'Comment Artist', ?, ?, 8, ?, ?, ?, 2, ?, 1, ?, ?)
  `).bind(
    versionId,
    chartId,
    options.authorComment ?? "Author comment",
    `Comment Song ${suffix}`,
    `comment_file_${suffix}`,
    `${suffix}.bms`,
    `comment_sha_${suffix}`,
    `comments/${suffix}.bms`,
    `password_hash_${suffix}`,
    options.versionHidden ? 1 : 0,
    `Comment Chart ${suffix}`,
    `comment chart ${suffix}`
  ).run();
  if (options.withdrawalStatus) {
    await env.DB.prepare(`
      INSERT INTO version_withdrawals (
        id, version_id, chart_id, status, request_mode, requested_at, scheduled_at,
        idempotency_key_hash, requester_ip_hash, requester_ua_hash,
        idempotency_hash_version, fingerprint_hash_version
      ) VALUES (?, ?, ?, ?, 'immediate', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 'ip', 'ua', 2, 2)
    `).bind(
      `comment_withdrawal_${suffix}`,
      versionId,
      chartId,
      options.withdrawalStatus,
      `comment_idempotency_${suffix}`
    ).run();
  }
  return { songId, chartId, versionId };
}

function request(path, options = {}, envOverrides = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Origin")) headers.set("Origin", "http://localhost");
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", "192.0.2.10");
  if (!headers.has("User-Agent")) headers.set("User-Agent", "version-comment-test");
  return workerModule.default.fetch(
    new Request(`http://localhost${path}`, { ...options, headers }),
    { DB: env.DB, FILES: env.FILES, ALLOWED_ORIGINS: "http://localhost", ABUSE_HASH_SECRET: TEST_SECRET, ...envOverrides }
  );
}

async function jsonRequest(path, options = {}, envOverrides = {}) {
  const response = await request(path, options, envOverrides);
  return { response, body: await response.json() };
}

function postOptions(body, ip = "192.0.2.10", ua = "version-comment-test") {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      "User-Agent": ua
    },
    body: JSON.stringify(body)
  };
}

await harness.listen();
env = await harness.getWorker().getEnv();
await applyMigrations();

const target = await createVersion();
const path = `/api/versions/${target.versionId}/comments`;

await check("migration creates version_comments and three indexes", async () => {
  const table = await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'version_comments'").first();
  const indexes = await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'version_comments' AND sql IS NOT NULL ORDER BY name").all();
  assert.equal(table.name, "version_comments");
  assert.deepEqual(indexes.results.map((row) => row.name), [
    "idx_version_comments_fingerprint_created_at",
    "idx_version_comments_hidden_created_at",
    "idx_version_comments_version_created_at"
  ]);
});

await check("empty comment list returns zero items", async () => {
  const { response, body } = await jsonRequest(path);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { versionId: target.versionId, items: [], page: 1, pageSize: 20, total: 0 });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

await check("invalid pagination is rejected", async () => {
  const { response, body } = await jsonRequest(`${path}?page=0&pageSize=101`);
  assert.equal(response.status, 400);
  assert.equal(body.code, "VERSION_COMMENT_INVALID_REQUEST");
});

await check("non-object JSON is rejected", async () => {
  const { response, body } = await jsonRequest(path, postOptions("comment"));
  assert.equal(response.status, 400);
  assert.equal(body.code, "VERSION_COMMENT_INVALID_REQUEST");
});

await check("empty body is rejected", async () => {
  const { response, body } = await jsonRequest(path, postOptions({ body: "" }));
  assert.equal(response.status, 400);
  assert.equal(body.code, "VERSION_COMMENT_BODY_REQUIRED");
});

await check("whitespace-only body is rejected", async () => {
  const { response, body } = await jsonRequest(path, postOptions({ body: " \n\t " }));
  assert.equal(response.status, 400);
  assert.equal(body.code, "VERSION_COMMENT_BODY_REQUIRED");
});

await check("500 Unicode code points are accepted", async () => {
  const text = "あ".repeat(500);
  const { response, body } = await jsonRequest(path, postOptions({ body: text }, "192.0.2.11", "limit-500"));
  assert.equal(response.status, 201);
  assert.equal(body.comment.body, text);
  assert.equal(body.total, 1);
});

await check("501 Unicode code points are rejected", async () => {
  const { response, body } = await jsonRequest(path, postOptions({ body: "😀".repeat(501) }, "192.0.2.12", "limit-501"));
  assert.equal(response.status, 400);
  assert.equal(body.code, "VERSION_COMMENT_BODY_TOO_LONG");
});

await check("unsupported control characters are rejected", async () => {
  const { response, body } = await jsonRequest(path, postOptions({ body: "bad\u0000body" }, "192.0.2.13", "control"));
  assert.equal(response.status, 400);
  assert.equal(body.code, "VERSION_COMMENT_INVALID_REQUEST");
});

await check("HTML-looking text is stored and returned as plain text", async () => {
  const text = '<img src=x onerror="alert(1)"> & text';
  const { response, body } = await jsonRequest(path, postOptions({ body: text }, "192.0.2.14", "html"));
  assert.equal(response.status, 201);
  assert.equal(body.comment.body, text);
});

await check("multiple comments are returned oldest first with pagination", async () => {
  await jsonRequest(path, postOptions({ body: "third" }, "192.0.2.15", "third"));
  await env.DB.prepare(`
    UPDATE version_comments
    SET created_at = CASE body
      WHEN ? THEN '2026-08-03 00:00:01'
      WHEN ? THEN '2026-08-03 00:00:02'
      WHEN 'third' THEN '2026-08-03 00:00:03'
      ELSE created_at
    END
    WHERE version_id = ?
  `).bind("あ".repeat(500), '<img src=x onerror="alert(1)"> & text', target.versionId).run();
  const { body } = await jsonRequest(`${path}?page=2&pageSize=2`);
  assert.equal(body.total, 3);
  assert.equal(body.page, 2);
  assert.equal(body.pageSize, 2);
  assert.deepEqual(body.items.map((item) => item.body), ["third"]);
});

await check("hidden comments are excluded from list and total", async () => {
  await env.DB.prepare("UPDATE version_comments SET is_hidden = 1, hidden_at = CURRENT_TIMESTAMP WHERE body = 'third'").run();
  const { body } = await jsonRequest(path);
  assert.equal(body.total, 2);
  assert.equal(body.items.some((item) => item.body === "third"), false);
});

await check("stored fingerprint fields are versioned hashes", async () => {
  const row = await env.DB.prepare(`
    SELECT ip_hash, ua_hash, fingerprint_hash_version
    FROM version_comments
    WHERE version_id = ?
    LIMIT 1
  `).bind(target.versionId).first();
  assert.equal(row.fingerprint_hash_version, 2);
  assert.notEqual(row.ip_hash, "192.0.2.11");
  assert.notEqual(row.ua_hash, "limit-500");
});

await check("public responses do not expose fingerprint or moderation fields", async () => {
  const { body } = await jsonRequest(path);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /ip_hash|ua_hash|fingerprint|is_hidden|hidden_reason/i);
});

await check("missing version returns fixed not-found code", async () => {
  const { response, body } = await jsonRequest("/api/versions/missing/comments");
  assert.equal(response.status, 404);
  assert.equal(body.code, "VERSION_COMMENT_VERSION_NOT_FOUND");
});

for (const [name, options] of [
  ["hidden version", { versionHidden: true }],
  ["hidden chart", { chartHidden: true }],
  ["processing withdrawal", { withdrawalStatus: "processing" }]
]) {
  await check(`${name} is unavailable`, async () => {
    const unavailable = await createVersion(options);
    const { response, body } = await jsonRequest(`/api/versions/${unavailable.versionId}/comments`);
    assert.equal(response.status, 409);
    assert.equal(body.code, "VERSION_COMMENT_VERSION_UNAVAILABLE");
  });
}

await check("active fingerprint ban blocks comment posting", async () => {
  const bannedTarget = await createVersion();
  const bannedPath = `/api/versions/${bannedTarget.versionId}/comments`;
  await jsonRequest(bannedPath, postOptions({ body: "seed for ban" }, "192.0.2.20", "banned-agent"));
  const fingerprint = await env.DB.prepare(`
    SELECT ip_hash, ua_hash FROM version_comments WHERE version_id = ? LIMIT 1
  `).bind(bannedTarget.versionId).first();
  await env.DB.prepare(`
    INSERT INTO bans (id, ban_type, ban_value, reason, active, ban_hash_version)
    VALUES ('version_comment_ban', 'ip_hash', ?, 'isolated test', 1, 2)
  `).bind(fingerprint.ip_hash).run();
  const { response, body } = await jsonRequest(bannedPath, postOptions({ body: "blocked" }, "192.0.2.20", "banned-agent"));
  assert.equal(response.status, 403);
  assert.equal(body.code, "VERSION_COMMENT_POSTING_BLOCKED");
});

await check("fourth comment in ten minutes is rate limited", async () => {
  const rateTarget = await createVersion();
  const ratePath = `/api/versions/${rateTarget.versionId}/comments`;
  for (let index = 0; index < 3; index += 1) {
    const { response } = await jsonRequest(ratePath, postOptions({ body: `rate ${index}` }, "192.0.2.21", "rate-agent"));
    assert.equal(response.status, 201);
  }
  const { response, body } = await jsonRequest(ratePath, postOptions({ body: "rate blocked" }, "192.0.2.21", "rate-agent"));
  assert.equal(response.status, 429);
  assert.equal(body.code, "VERSION_COMMENT_RATE_LIMITED");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
});

await check("missing abuse secret fails closed without writing", async () => {
  const safeTarget = await createVersion();
  const safePath = `/api/versions/${safeTarget.versionId}/comments`;
  const { response, body } = await jsonRequest(safePath, postOptions({ body: "must not write" }, "192.0.2.22", "no-secret"), { ABUSE_HASH_SECRET: undefined });
  assert.equal(response.status, 503);
  assert.equal(body.code, "VERSION_COMMENT_DB_FAILED");
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM version_comments WHERE version_id = ?").bind(safeTarget.versionId).first();
  assert.equal(count.total, 0);
});

await check("chart list payload includes visible count and latest comment", async () => {
  const { response, body } = await jsonRequest("/api/charts?page=1&pageSize=100");
  assert.equal(response.status, 200);
  const version = body.charts.flatMap((entry) => entry.versions).find((item) => item.id === target.versionId);
  assert.equal(version.commentCount, 2);
  assert.equal(version.latestComment.body, '<img src=x onerror="alert(1)"> & text');
});

await check("chart detail payload includes visible count and latest comment", async () => {
  const { response, body } = await jsonRequest(`/api/charts/${target.chartId}`);
  assert.equal(response.status, 200);
  const version = body.charts[0].versions.find((item) => item.id === target.versionId);
  assert.equal(version.commentCount, 2);
  assert.equal(version.latestComment.createdAt, "2026-08-03 00:00:02");
});

await check("version list payload includes visible count and latest comment", async () => {
  const { response, body } = await jsonRequest("/api/versions?page=1&pageSize=100");
  assert.equal(response.status, 200);
  const version = body.items.find((item) => item.versionId === target.versionId);
  assert.equal(version.commentCount, 2);
  assert.equal(version.latestComment.body, '<img src=x onerror="alert(1)"> & text');
});

await check("public list payloads never expose stored hashes", async () => {
  for (const endpoint of ["/api/charts?pageSize=100", `/api/charts/${target.chartId}`, "/api/versions?pageSize=100"]) {
    const response = await request(endpoint);
    const serialized = await response.text();
    assert.doesNotMatch(serialized, /ip_hash|ua_hash|fingerprint_hash_version/i);
  }
});

await check("comment summary is computed inside existing SQL queries", async () => {
  const chartSource = await readFile(resolve(workerRoot, "src", "routes", "charts.ts"), "utf8");
  const listSource = await readFile(resolve(workerRoot, "src", "routes", "versionList.ts"), "utf8");
  assert.match(chartSource, /FROM version_comments AS public_comments/);
  assert.match(listSource, /FROM version_comments AS public_comments/);
  assert.doesNotMatch(chartSource, /fetch\([^)]*comments/);
  assert.doesNotMatch(listSource, /fetch\([^)]*comments/);
});

await check("deleting a version cascades its comments", async () => {
  const deleted = await createVersion();
  await jsonRequest(`/api/versions/${deleted.versionId}/comments`, postOptions({ body: "cascade" }, "192.0.2.30", "cascade"));
  await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(deleted.versionId).run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM version_comments WHERE version_id = ?").bind(deleted.versionId).first();
  assert.equal(count.total, 0);
});

await check("unsupported method is rejected", async () => {
  const { response, body } = await jsonRequest(path, { method: "DELETE" });
  assert.equal(response.status, 405);
  assert.equal(body.code, "METHOD_NOT_ALLOWED");
});

console.log(`version comments: ${passed}/${passed} passed`);
await harness.close();
