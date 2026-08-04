import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import wrangler from "wrangler";

const { createTestHarness, unstable_splitSqlQuery: splitSqlQuery } = wrangler;
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_TOKEN = "isolated-admin-version-status-token";
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

const bundled = await build({
  entryPoints: ["src/index.ts"],
  absWorkingDir: workerRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
  logLevel: "silent"
});
const worker = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const harness = createTestHarness({
  root: workerRoot,
  workers: [{
    configPath: "wrangler.toml",
    vars: { ALLOWED_ORIGINS: "http://localhost" },
    secrets: {
      ADMIN_TOKEN,
      PASSWORD_HASH_SECRET: "isolated-password-secret",
      ABUSE_HASH_SECRET: "isolated-abuse-secret",
      WITHDRAWAL_IDEMPOTENCY_SECRET: "isolated-withdrawal-secret"
    }
  }]
});

let env;
let passed = 0;
let sequence = 0;

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function applyMigrations() {
  for (const name of migrations) {
    const sql = (await readFile(resolve(workerRoot, "migrations", name), "utf8"))
      .replace(/\r\n/g, "\n")
      .replace(/^\s*--.*$/gm, "")
      .trim();
    for (const statement of splitSqlQuery(sql)) await env.DB.prepare(statement).run();
  }
}

function progressMap(progress, kind = "initial", versionId = "pending") {
  const count = Math.max(0, Math.min(4, Math.round(progress / 25)));
  return JSON.stringify({
    schemaVersion: 2,
    blockMode: "standardized_measure",
    firstMeasure: 0,
    lastMeasure: 3,
    targetBlockCount: 4,
    blocks: Array.from({ length: 4 }, (_, index) => ({
      index,
      startMeasure: index,
      endMeasure: index,
      startPosition: index,
      endPosition: index + 1,
      startTimeSec: index,
      endTimeSec: index + 1,
      playNotes: 1
    })),
    layers: [{
      versionId,
      color: "#1f7a5c",
      kind,
      ranges: count > 0 ? [[0, count - 1]] : []
    }],
    progress
  });
}

async function createChart(title = "Status Song", artist = "Status Artist") {
  sequence += 1;
  const suffix = String(sequence);
  const songId = `status_song_${suffix}`;
  const chartId = `status_chart_${suffix}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO songs (id, title, artist, normalized_title, normalized_artist) VALUES (?, ?, ?, ?, ?)`)
      .bind(songId, title, artist, title.toLowerCase(), artist.toLowerCase()),
    env.DB.prepare(`INSERT INTO charts (id, song_id, chart_name, normalized_chart_name) VALUES (?, ?, ?, ?)`)
      .bind(chartId, songId, `Status Chart ${suffix}`, `status chart ${suffix}`)
  ]);
  return { songId, chartId };
}

async function createVersion(chartId, options = {}) {
  sequence += 1;
  const suffix = String(sequence);
  const versionId = options.versionId ?? `status_version_${suffix}`;
  const parentVersionId = options.parentVersionId ?? null;
  const versionNumber = options.versionNumber ?? (parentVersionId ? 2 : 1);
  const branchPath = options.branchPath ?? (parentVersionId ? `root/${suffix}` : "root");
  const progress = options.progress ?? 50;
  const completedAt = options.completedAt === undefined ? null : options.completedAt;
  await env.DB.prepare(`
    INSERT INTO versions (
      id, chart_id, parent_version_id, version_number, branch_label, branch_path,
      chart_name, normalized_chart_name, author, progress, progress_map_json,
      comment, title, artist, is_rejected, allow_append,
      file_id, file_name, file_size, file_sha256, r2_key,
      password_hash, password_hash_version, is_hidden, file_deleted_at,
      created_at, updated_at, completed_at, download_blocked, download_block_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    versionId,
    chartId,
    parentVersionId,
    versionNumber,
    options.branchLabel ?? (versionNumber === 1 ? "" : `v${versionNumber}`),
    branchPath,
    options.chartName ?? "Status Chart",
    "status chart",
    options.author ?? "Status Author",
    progress,
    options.progressMapJson === undefined ? progressMap(progress, options.mapKind, versionId) : options.progressMapJson,
    options.title ?? "Status Song",
    options.artist ?? "Status Artist",
    options.isRejected ? 1 : 0,
    options.allowAppend === false ? 0 : 1,
    `file_${suffix}`,
    `${suffix}.bms`,
    `sha_${suffix}`,
    `charts/${suffix}.bms`,
    `password_${suffix}`,
    options.hidden ? 1 : 0,
    options.fileDeleted ? "2026-08-04 00:00:00" : null,
    options.createdAt ?? `2026-08-04 00:00:${String(sequence).padStart(2, "0")}`,
    options.updatedAt ?? `2026-08-04 00:00:${String(sequence).padStart(2, "0")}`,
    completedAt,
    options.downloadBlocked ? 1 : 0,
    options.downloadBlocked ? (options.downloadBlockReason ?? "admin_blocked") : null
  ).run();
  return versionId;
}

async function call(path, options = {}, token = ADMIN_TOKEN) {
  const headers = new Headers(options.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  return worker.default.fetch(new Request(`http://localhost${path}`, { ...options, headers }), env);
}

async function json(response) {
  const body = await response.json();
  return { response, body };
}

async function getRow(versionId) {
  return env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first();
}

async function patch(versionId, updatedAt, values = {}) {
  return call(`/api/admin/versions/${versionId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      targetState: "incomplete",
      progress: 50,
      allowAppend: true,
      reason: "test correction reason",
      expectedUpdatedAt: updatedAt,
      ...values
    })
  });
}

try {
  await harness.listen();
  const handle = harness.getWorker();
  env = await handle.getEnv();
  await applyMigrations();

  const main = await createChart("Searchable Status Song", "Searchable Artist");
  const normalIncomplete = await createVersion(main.chartId, { progress: 50 });
  const normalCompleted = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/1",
    progress: 100,
    completedAt: "2026-08-04 00:01:00",
    mapKind: "completion_fill"
  });
  const normalRejected = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/2",
    progress: 100,
    isRejected: true,
    mapKind: "rejected_auto_fill"
  });
  const badRejectedMap = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/3",
    progress: 100,
    isRejected: true,
    progressMapJson: progressMap(50, "initial")
  });
  const badIncomplete = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/4",
    progress: 100
  });
  const badCompleted = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/5",
    progress: 75,
    completedAt: "2026-08-04 00:02:00"
  });
  const duplicateState = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/6",
    progress: 100,
    completedAt: "2026-08-04 00:03:00",
    isRejected: true
  });
  const legacyMap = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/7",
    progress: 35,
    progressMapJson: "{\"1\":35}"
  });
  const hidden = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/8",
    progress: 45,
    hidden: true
  });
  const pending = await createVersion(main.chartId, {
    parentVersionId: normalIncomplete,
    branchPath: "root/9",
    progress: 45
  });
  await env.DB.prepare(`
    INSERT INTO version_withdrawals (
      id, version_id, chart_id, status, request_mode, handling_mode,
      requested_at, scheduled_at, idempotency_key_hash, requester_ip_hash,
      requester_ua_hash, idempotency_hash_version, fingerprint_hash_version
    ) VALUES (?, ?, ?, 'pending', 'deferred', 'manual_review', CURRENT_TIMESTAMP,
      datetime('now', '+1 day'), ?, ?, ?, 2, 2)
  `).bind("withdrawal_status_pending", pending, main.chartId, "idem", "ip", "ua").run();

  await check("ADMIN_TOKENなしは401", async () => {
    assert.equal((await call("/api/admin/versions/status-review", {}, null)).status, 401);
  });
  await check("dummy tokenは401", async () => {
    assert.equal((await call("/api/admin/versions/status-review", {}, "dummy")).status, 401);
  });
  await check("認証済み一覧は200", async () => {
    assert.equal((await call("/api/admin/versions/status-review")).status, 200);
  });
  await check("要確認のみは不整合だけを返す", async () => {
    const { body } = await json(await call("/api/admin/versions/status-review?suspiciousOnly=true&pageSize=100"));
    const ids = new Set(body.items.map((item) => item.versionId));
    for (const id of [badRejectedMap, badIncomplete, badCompleted, duplicateState]) assert.ok(ids.has(id));
    for (const id of [normalIncomplete, normalCompleted, normalRejected]) assert.ok(!ids.has(id));
  });
  await check("候補理由A-Fを検出する", async () => {
    const { body } = await json(await call("/api/admin/versions/status-review?suspiciousOnly=true&pageSize=100"));
    const reasons = new Set(body.items.flatMap((item) => item.suspiciousReasons));
    for (const reason of [
      "REJECTED_WITH_INCOMPLETE_PROGRESS_MAP",
      "INCOMPLETE_WITH_FULL_PROGRESS",
      "COMPLETED_WITH_NON_FULL_PROGRESS",
      "REJECTED_WITH_COMPLETED_AT",
      "PROGRESS_MAP_MISMATCH"
    ]) assert.ok(reasons.has(reason), reason);
  });
  await check("旧形式mapは判定不可で断定しない", async () => {
    const { body } = await json(await call("/api/admin/versions/status-review?suspiciousOnly=false&pageSize=100"));
    const item = body.items.find((candidate) => candidate.versionId === legacyMap);
    assert.equal(item.mapProgressAvailable, false);
    assert.ok(!item.suspiciousReasons.includes("PROGRESS_MAP_MISMATCH"));
  });
  await check("hiddenとwithdrawal pendingは修正不可", async () => {
    const { body } = await json(await call("/api/admin/versions/status-review?suspiciousOnly=false&pageSize=100"));
    assert.equal(body.items.find((item) => item.versionId === hidden).canCorrect, false);
    assert.equal(body.items.find((item) => item.versionId === pending).canCorrect, false);
  });
  await check("検索とstate filterが機能する", async () => {
    const { body } = await json(await call("/api/admin/versions/status-review?q=Searchable&state=completed&suspiciousOnly=false&pageSize=100"));
    assert.ok(body.items.some((item) => item.versionId === normalCompleted));
    assert.ok(body.items.every((item) => item.currentState === "completed"));
  });
  await check("paginationが機能する", async () => {
    const { body } = await json(await call("/api/admin/versions/status-review?suspiciousOnly=false&page=2&pageSize=2"));
    assert.equal(body.page, 2);
    assert.equal(body.items.length, 2);
    assert.ok(body.total > 2);
  });
  await check("一覧にpasswordやhash本文を返さない", async () => {
    const text = await (await call("/api/admin/versions/status-review?suspiciousOnly=false&pageSize=100")).text();
    assert.doesNotMatch(text, /password_|requester_(?:ip|ua)_hash|password_hash/);
  });

  const correctionChart = await createChart("Correction Tree", "Tree Artist");
  const root = await createVersion(correctionChart.chartId, { progress: 50, branchPath: "root" });
  const child = await createVersion(correctionChart.chartId, {
    parentVersionId: root,
    branchPath: "root/1",
    progress: 75,
    progressMapJson: progressMap(75)
  });

  await check("descendantを完成版へ修正できる", async () => {
    const before = await getRow(child);
    const { response, body } = await json(await patch(child, before.updated_at, {
      targetState: "completed",
      progress: 100,
      allowAppend: false
    }));
    assert.equal(response.status, 200);
    assert.equal(body.after.state, "completed");
    const after = await getRow(child);
    assert.equal(after.progress, 100);
    assert.equal(after.is_rejected, 0);
    assert.equal(after.allow_append, 0);
    assert.ok(after.completed_at);
  });
  await check("完成正規化はprogress mapを100にする", async () => {
    const after = await getRow(child);
    const map = JSON.parse(after.progress_map_json);
    assert.equal(map.progress, 100);
    assert.equal(map.layers.at(-1).kind, "completion_fill");
    assert.deepEqual(map.layers.at(-1).ranges, [[0, 3]]);
  });
  await check("完成descendantでancestorをcollapseする", async () => {
    const after = await getRow(root);
    assert.equal(after.collapsed_by_completion, 1);
    assert.equal(after.collapsed_by_version_id, child);
    assert.equal(after.download_block_reason, "superseded_by_completed_descendant");
  });
  await check("admin logへ修正内容と理由を保存する", async () => {
    const log = await env.DB.prepare("SELECT * FROM admin_logs WHERE target_id = ? ORDER BY rowid DESC LIMIT 1").bind(child).first();
    assert.equal(log.action, "correct_version_submission_state");
    assert.equal(log.target_type, "version");
    assert.equal(log.reason, "test correction reason");
    const detail = JSON.parse(log.detail);
    assert.equal(detail.completionReconciled, true);
    assert.equal(detail.afterState, "completed");
    assert.equal(detail.reasonLength, 22);
  });
  await check("完成版から制作途中へ戻せる", async () => {
    const before = await getRow(child);
    const response = await patch(child, before.updated_at, { progress: 75, targetState: "incomplete", allowAppend: true });
    assert.equal(response.status, 200);
    const after = await getRow(child);
    assert.equal(after.completed_at, null);
    assert.equal(after.progress, 75);
    assert.equal(after.allow_append, 1);
  });
  await check("completion由来collapseをchart全体で解除する", async () => {
    const after = await getRow(root);
    assert.equal(after.collapsed_by_completion, 0);
    assert.equal(after.collapsed_by_version_id, null);
    assert.equal(after.download_blocked, 0);
    assert.equal(after.download_block_reason, null);
  });
  await check("別の完成descendantがあればcollapseを維持する", async () => {
    const other = await createVersion(correctionChart.chartId, {
      parentVersionId: root,
      branchPath: "root/2",
      progress: 100,
      completedAt: "2026-08-04 01:00:00",
      mapKind: "completion_fill"
    });
    const current = await getRow(child);
    assert.equal((await patch(child, current.updated_at, { progress: 50 })).status, 200);
    const ancestor = await getRow(root);
    assert.equal(ancestor.collapsed_by_completion, 1);
    assert.equal(ancestor.collapsed_by_version_id, other);
  });
  await check("完成済み没譜面は通常completion collapseを起こさない", async () => {
    const before = await getRow(child);
    assert.equal((await patch(child, before.updated_at, {
      targetState: "rejected_completed",
      progress: 100,
      allowAppend: false
    })).status, 200);
    const after = await getRow(child);
    assert.equal(after.is_rejected, 1);
    assert.equal(after.completed_at, null);
    assert.equal(JSON.parse(after.progress_map_json).layers.at(-1).kind, "rejected_auto_fill");
  });
  await check("admin_blockedはreconcileで壊さない", async () => {
    const blocked = await createVersion(correctionChart.chartId, {
      parentVersionId: root,
      branchPath: "root/3",
      progress: 40,
      downloadBlocked: true
    });
    const before = await getRow(child);
    await patch(child, before.updated_at, { progress: 50 });
    const after = await getRow(blocked);
    assert.equal(after.download_blocked, 1);
    assert.equal(after.download_block_reason, "admin_blocked");
  });

  await check("expectedUpdatedAt競合は409で書込み0", async () => {
    const before = await getRow(child);
    const response = await patch(child, "2000-01-01 00:00:00", { progress: 44 });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "ADMIN_VERSION_STATE_CONFLICT");
    assert.equal((await getRow(child)).updated_at, before.updated_at);
  });
  await check("hidden更新は409で拒否", async () => {
    const before = await getRow(hidden);
    const response = await patch(hidden, before.updated_at);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "ADMIN_VERSION_STATUS_UNAVAILABLE");
  });
  await check("withdrawal pending更新は409で拒否", async () => {
    const before = await getRow(pending);
    const response = await patch(pending, before.updated_at);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "ADMIN_VERSION_STATUS_UNAVAILABLE");
  });
  await check("存在しないversionは404", async () => {
    const response = await patch("version_missing", "2026-08-04 00:00:00");
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "ADMIN_VERSION_STATUS_NOT_FOUND");
  });
  await check("進捗範囲とallowAppend規則を検証する", async () => {
    const before = await getRow(child);
    for (const values of [
      { progress: 100 },
      { progress: -1 },
      { allowAppend: false }
    ]) {
      const response = await patch(child, before.updated_at, values);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "ADMIN_VERSION_STATUS_PROGRESS_INVALID");
    }
  });
  await check("理由必須と文字数を検証する", async () => {
    const before = await getRow(child);
    const missing = await patch(child, before.updated_at, { reason: "" });
    assert.equal((await missing.json()).code, "ADMIN_VERSION_STATUS_REASON_REQUIRED");
    const short = await patch(child, before.updated_at, { reason: "abcd" });
    assert.equal((await short.json()).code, "ADMIN_VERSION_STATUS_REASON_INVALID");
  });
  await check("invalid targetを400で拒否", async () => {
    const before = await getRow(child);
    const response = await patch(child, before.updated_at, { targetState: "other" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "ADMIN_VERSION_STATUS_INVALID_TARGET");
  });
  await check("batch失敗時はversion更新とadmin logをrollbackする", async () => {
    const before = await getRow(child);
    const logCount = (await env.DB.prepare("SELECT COUNT(*) AS count FROM admin_logs").first()).count;
    await env.DB.prepare(`
      CREATE TRIGGER fail_status_admin_log BEFORE INSERT ON admin_logs
      WHEN NEW.action = 'correct_version_submission_state'
      BEGIN SELECT RAISE(ABORT, 'forced rollback'); END
    `).run();
    const response = await patch(child, before.updated_at, { progress: 33 });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, "ADMIN_VERSION_STATUS_RECONCILE_FAILED");
    assert.equal((await getRow(child)).progress, before.progress);
    assert.equal((await env.DB.prepare("SELECT COUNT(*) AS count FROM admin_logs").first()).count, logCount);
    await env.DB.prepare("DROP TRIGGER fail_status_admin_log").run();
  });
  await check("PATCHをCORS preflightが許可する", async () => {
    const response = await worker.default.fetch(new Request("http://localhost/api/admin/versions/status-review", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost" }
    }), env);
    assert.match(response.headers.get("Access-Control-Allow-Methods"), /PATCH/);
  });

  console.log(`admin version status isolated tests: ${passed} passed`);
} finally {
  await harness.close();
}
