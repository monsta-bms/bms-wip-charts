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
const NOW = new Date("2026-07-22T03:00:00.000Z");
const PAST_SQL = "2026-07-22 02:00:00";
const FUTURE_SQL = "2026-07-29 03:00:00";
const TEST_SECRET = "isolated-test-secret";
const TEST_PASSWORD = "isolated-password";
const TEST_ADMIN_TOKEN = "isolated-admin-token";

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

const [indexModule, finalizerModule, activeRunnerModule] = await Promise.all([
  importBundled("src/index.ts"),
  importBundled("src/services/versionWithdrawalFinalizer.ts"),
  importBundled("src/services/versionWithdrawalActiveRunner.ts")
]);

const harness = createTestHarness({
  root: workerRoot,
  workers: [{
    configPath: "wrangler.toml",
    vars: {
      ALLOWED_ORIGINS: "http://localhost",
      WITHDRAWAL_CRON_MODE: "active"
    },
    secrets: {
      HASH_SECRET: TEST_SECRET,
      ADMIN_TOKEN: TEST_ADMIN_TOKEN
    }
  }]
});

let env;
let workerHandle;
let sequence = 0;
let passed = 0;

async function applyMigrations() {
  for (const file of migrationFiles) {
    const sql = await readFile(resolve(workerRoot, "migrations", file), "utf8");
    const executableSql = sql
      .replace(/\r\n/g, "\n")
      .replace(/^\s*--.*$/gm, "")
      .trim();
    for (const statement of splitSqlQuery(executableSql)) {
      await env.DB.prepare(statement).run();
    }
  }
}

async function resetIsolation() {
  await harness.reset();
  await harness.listen();
  workerHandle = harness.getWorker();
  env = await workerHandle.getEnv();
  await applyMigrations();
}

async function first(sql, ...bindings) {
  return env.DB.prepare(sql).bind(...bindings).first();
}

async function all(sql, ...bindings) {
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  return result.results ?? [];
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createVersion(options = {}) {
  sequence += 1;
  const suffix = `${sequence}`;
  const songId = options.songId ?? `song_${suffix}`;
  const chartId = options.chartId ?? `chart_${suffix}`;
  const versionId = options.versionId ?? `version_${suffix}`;
  const fileId = `file_${suffix}`;
  const r2Key = `charts/${suffix}.bms`;
  const progressImageKey = options.withProgressImage === false ? null : `progress/${suffix}.png`;
  if (!options.chartId) {
    await env.DB.prepare(`
      INSERT INTO songs (
        id, title, artist, normalized_title, normalized_artist
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(songId, `Song ${suffix}`, "Tester", `song ${suffix}`, "tester").run();
    await env.DB.prepare(`
      INSERT INTO charts (id, song_id, chart_name, normalized_chart_name)
      VALUES (?, ?, ?, ?)
    `).bind(chartId, songId, `Chart ${suffix}`, `chart ${suffix}`).run();
  }
  const passwordHash = await sha256Hex(`${TEST_SECRET}:password:${TEST_PASSWORD}`);
  const versionNumber = options.versionNumber ?? (options.parentVersionId ? 2 : 1);
  await env.DB.prepare(`
    INSERT INTO versions (
      id, chart_id, parent_version_id, version_number, branch_label, branch_path,
      author, progress, comment, difficulty, level,
      title, artist, file_id, file_name, file_size, file_sha256, r2_key,
      password_hash, download_blocked, download_block_reason, is_hidden,
      created_at, updated_at, completed_at, progress_map_json,
      progress_image_key, progress_image_mime, progress_image_size,
      chart_name, normalized_chart_name, allow_append, withdrawal_download_blocked
    ) VALUES (
      ?, ?, ?, ?, '', ?,
      'Tester', ?, '', ?, ?,
      ?, 'Tester', ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `).bind(
    versionId,
    chartId,
    options.parentVersionId ?? null,
    versionNumber,
    `branch_${suffix}`,
    options.progress ?? 50,
    options.difficulty ?? "★1",
    options.level ?? "1",
    `Song ${suffix}`,
    fileId,
    `${suffix}.bms`,
    8,
    `sha256_${suffix}`,
    r2Key,
    passwordHash,
    options.downloadBlocked ? 1 : 0,
    options.downloadBlocked ? "admin_blocked" : null,
    options.hidden ? 1 : 0,
    options.createdAt ?? "2026-07-01 00:00:00",
    options.createdAt ?? "2026-07-01 00:00:00",
    options.progress === 100 ? "2026-07-02 00:00:00" : null,
    options.progressMapJson ?? "{\"1\":100}",
    progressImageKey,
    progressImageKey ? "image/png" : null,
    progressImageKey ? 3 : null,
    `Chart ${suffix}`,
    `chart ${suffix}`,
    options.allowAppend === false ? 0 : 1,
    options.withdrawalBlocked ? 1 : 0
  ).run();
  if (options.putR2 !== false) {
    await env.FILES.put(r2Key, "bms-data");
    if (progressImageKey) await env.FILES.put(progressImageKey, "png");
  }
  return { songId, chartId, versionId, fileId, r2Key, progressImageKey };
}

async function createWithdrawal(version, options = {}) {
  sequence += 1;
  const withdrawalId = options.withdrawalId ?? `withdrawal_${sequence}`;
  const handlingMode = options.handlingMode ?? "grace_auto_delete";
  const status = options.status ?? "pending";
  const requestMode = handlingMode === "immediate_delete" ? "immediate" : "deferred";
  await env.DB.prepare(`
    INSERT INTO version_withdrawals (
      id, version_id, chart_id, status, request_mode,
      requested_at, scheduled_at, handling_mode, request_reason,
      processing_at, processing_mode, lease_token, lease_expires_at,
      attempt_count, idempotency_key_hash, requester_ip_hash, requester_ua_hash,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      '2026-07-15 00:00:00', ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, 'test-ip-hash', 'test-ua-hash',
      '2026-07-15 00:00:00', '2026-07-15 00:00:00'
    )
  `).bind(
    withdrawalId,
    version.versionId,
    version.chartId,
    status,
    requestMode,
    options.scheduledAt ?? PAST_SQL,
    handlingMode,
    handlingMode === "immediate_delete" ? null : (options.reason ?? "隔離テスト用の取り下げ理由です。"),
    status === "processing" ? "2026-07-22 01:00:00" : null,
    status === "processing" ? "delete" : null,
    options.leaseToken ?? null,
    options.leaseExpiresAt ?? null,
    options.attemptCount ?? 0,
    `idempotency_${withdrawalId}`
  ).run();
  if (["grace_auto_delete", "manual_review"].includes(handlingMode)) {
    await env.DB.prepare(`
      UPDATE versions SET withdrawal_download_blocked = 1 WHERE id = ?
    `).bind(version.versionId).run();
  }
  return { withdrawalId, ...version };
}

async function addDependency(target, kind) {
  if (kind === "direct_child" || kind === "hidden_child") {
    return createVersion({
      songId: target.songId,
      chartId: target.chartId,
      parentVersionId: target.versionId,
      versionNumber: 2,
      hidden: kind === "hidden_child"
    });
  }
  if (kind === "collapsed_reference") {
    const reference = await createVersion({ songId: target.songId, chartId: target.chartId });
    await env.DB.prepare(`
      UPDATE versions SET collapsed_by_version_id = ? WHERE id = ?
    `).bind(target.versionId, reference.versionId).run();
    return reference;
  }
  sequence += 1;
  await env.DB.prepare(`
    INSERT INTO delete_requests (
      id, version_id, chart_id, requester_ip_hash, requester_ua_hash
    ) VALUES (?, ?, ?, 'test-ip-hash', 'test-ua-hash')
  `).bind(`delete_request_${sequence}`, target.versionId, target.chartId).run();
  return null;
}

function makeR2Spy(bucket, options = {}) {
  const deleteCalls = [];
  const failOnce = new Set(options.failDeleteOnce ?? []);
  return {
    deleteCalls,
    binding: {
      head: (key) => bucket.head(key),
      get: (key, getOptions) => bucket.get(key, getOptions),
      put: (key, value, putOptions) => bucket.put(key, value, putOptions),
      list: (listOptions) => bucket.list(listOptions),
      async delete(key) {
        const keys = Array.isArray(key) ? key : [key];
        deleteCalls.push(...keys);
        const failure = keys.find((item) => failOnce.has(item));
        if (failure) {
          failOnce.delete(failure);
          throw new Error("injected isolated R2 delete failure");
        }
        return bucket.delete(key);
      }
    }
  };
}

function scheduledController(cron = "0 * * * *", time = NOW) {
  return {
    cron,
    scheduledTime: time.getTime(),
    noRetry() {}
  };
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {}
  };
}

async function runIndexScheduled(mode, targetEnv = env, cron = "0 * * * *", time = NOW) {
  await indexModule.default.scheduled(
    scheduledController(cron, time),
    { ...targetEnv, WITHDRAWAL_CRON_MODE: mode },
    executionContext()
  );
}

async function latestSystemSummary(operation) {
  const rows = await all(`
    SELECT detail
    FROM admin_logs
    WHERE target_type = 'system'
    ORDER BY rowid DESC
  `);
  return rows
    .map((row) => JSON.parse(row.detail))
    .find((detail) => detail.operation === operation) ?? null;
}

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

try {
  await harness.listen();

  await check("off/observe/invalid/active mode separation and basic deletion", async () => {
    await resetIsolation();
    const target = await createVersion();
    const withdrawal = await createWithdrawal(target);
    const immediateTarget = await createVersion();
    const immediateWithdrawal = await createWithdrawal(immediateTarget, {
      handlingMode: "immediate_delete"
    });
    const spy = makeR2Spy(env.FILES);
    const isolatedEnv = { ...env, FILES: spy.binding };
    await runIndexScheduled("off", isolatedEnv);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", withdrawal.withdrawalId)).status, "pending");
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", immediateWithdrawal.withdrawalId)).status, "pending");
    assert.equal(spy.deleteCalls.length, 0);
    assert.equal((await first("SELECT COUNT(*) AS count FROM admin_logs")).count, 0);

    await runIndexScheduled("observe", isolatedEnv);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE id = ?", target.versionId)).count, 1);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE id = ?", immediateTarget.versionId)).count, 1);
    assert.equal(spy.deleteCalls.length, 0);
    assert.equal((await latestSystemSummary("withdrawal_cron_observe")).mode, "observe");
    const logsAfterObserve = (await first("SELECT COUNT(*) AS count FROM admin_logs")).count;

    await runIndexScheduled("ACTIVE", isolatedEnv);
    assert.equal((await first("SELECT COUNT(*) AS count FROM admin_logs")).count, logsAfterObserve);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", withdrawal.withdrawalId)).status, "pending");
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", immediateWithdrawal.withdrawalId)).status, "pending");

    await runIndexScheduled("active", isolatedEnv);
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE id = ?", target.versionId)).count, 0);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", withdrawal.withdrawalId)).status, "deleted");
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE id = ?", immediateTarget.versionId)).count, 0);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", immediateWithdrawal.withdrawalId)).status, "deleted");
    assert.equal(await env.FILES.head(target.r2Key), null);
    assert.equal(await env.FILES.head(target.progressImageKey), null);
    assert.equal(await env.FILES.head(immediateTarget.r2Key), null);
    assert.equal(await env.FILES.head(immediateTarget.progressImageKey), null);
    assert.equal((await first("SELECT COUNT(*) AS count FROM charts WHERE id = ?", target.chartId)).count, 0);
    assert.equal((await first("SELECT COUNT(*) AS count FROM songs WHERE id = ?", target.songId)).count, 0);
    const summary = await latestSystemSummary("withdrawal_cron_active");
    assert.equal(summary.deleted_count, 2);
    assert.equal(summary.immediate_recovery_selected_count, 1);
    assert.equal(summary.tombstoned_count, 0);
  });

  await check("Wrangler workerd scheduled dispatch uses active runner", async () => {
    await resetIsolation();
    const target = await createVersion();
    const withdrawal = await createWithdrawal(target);
    await workerHandle.scheduled({ cron: "0 * * * *", scheduledTime: NOW });
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", withdrawal.withdrawalId)).status, "deleted");
    assert.equal((await latestSystemSummary("withdrawal_cron_active")).mode, "active");
  });

  await check("all dependency kinds move due grace to manual review", async () => {
    await resetIsolation();
    const fixtures = [];
    for (const kind of ["direct_child", "hidden_child", "collapsed_reference", "legacy_delete_request"]) {
      const target = await createVersion();
      const withdrawal = await createWithdrawal(target, { reason: `保持される申請理由-${kind}` });
      await addDependency(target, kind);
      fixtures.push({ kind, target, withdrawal });
    }
    const summary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, { now: NOW });
    assert.equal(summary.manualReviewCount, 4);
    assert.equal(summary.tombstonedCount, 0);
    for (const fixture of fixtures) {
      const row = await first(`
        SELECT status, handling_mode, request_reason, processing_mode, lease_token
        FROM version_withdrawals WHERE id = ?
      `, fixture.withdrawal.withdrawalId);
      assert.equal(row.status, "pending");
      assert.equal(row.handling_mode, "manual_review");
      assert.equal(row.request_reason, `保持される申請理由-${fixture.kind}`);
      assert.equal(row.processing_mode, null);
      assert.equal(row.lease_token, null);
      assert.notEqual(await env.FILES.head(fixture.target.r2Key), null);
    }
  });

  await check("future/manual/leased rows are excluded while incomplete immediate rows recover", async () => {
    await resetIsolation();
    const future = await createVersion();
    const futureWithdrawal = await createWithdrawal(future, { scheduledAt: FUTURE_SQL });
    const manual = await createVersion();
    const manualWithdrawal = await createWithdrawal(manual, { handlingMode: "manual_review" });
    const immediatePending = await createVersion();
    const immediatePendingWithdrawal = await createWithdrawal(immediatePending, { handlingMode: "immediate_delete" });
    const immediateProcessing = await createVersion();
    const immediateProcessingWithdrawal = await createWithdrawal(immediateProcessing, {
      handlingMode: "immediate_delete",
      status: "processing",
      leaseExpiresAt: "2026-07-22 01:00:00"
    });
    const immediateLeaseNull = await createVersion();
    const immediateLeaseNullWithdrawal = await createWithdrawal(immediateLeaseNull, {
      handlingMode: "immediate_delete",
      status: "processing"
    });
    const immediateLeased = await createVersion();
    const immediateLeasedWithdrawal = await createWithdrawal(immediateLeased, {
      handlingMode: "immediate_delete",
      status: "processing",
      leaseToken: "valid-immediate-lease",
      leaseExpiresAt: "2026-07-22 04:00:00"
    });
    const leased = await createVersion();
    const leasedWithdrawal = await createWithdrawal(leased, {
      status: "processing",
      leaseToken: "valid-lease",
      leaseExpiresAt: "2026-07-22 04:00:00"
    });
    const summary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, { now: NOW });
    assert.equal(summary.selectedCount, 3);
    assert.equal(summary.deletedCount, 3);
    assert.equal(summary.immediateRecoverySelectedCount, 3);
    assert.equal(summary.tombstonedCount, 0);
    for (const id of [
      futureWithdrawal.withdrawalId,
      manualWithdrawal.withdrawalId,
      immediateLeasedWithdrawal.withdrawalId,
      leasedWithdrawal.withdrawalId
    ]) {
      assert.notEqual((await first("SELECT status FROM version_withdrawals WHERE id = ?", id)).status, "deleted");
    }
    for (const id of [
      immediatePendingWithdrawal.withdrawalId,
      immediateProcessingWithdrawal.withdrawalId,
      immediateLeaseNullWithdrawal.withdrawalId
    ]) {
      assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", id)).status, "deleted");
    }
  });

  await check("expired grace lease is reclaimed while immediate synchronous finalizer remains available", async () => {
    await resetIsolation();
    const expired = await createVersion();
    const expiredWithdrawal = await createWithdrawal(expired, {
      status: "processing",
      leaseToken: "expired-lease",
      leaseExpiresAt: "2026-07-22 02:00:00"
    });
    const activeSummary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, { now: NOW });
    assert.equal(activeSummary.deletedCount, 1);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", expiredWithdrawal.withdrawalId)).status, "deleted");

    const immediate = await createVersion();
    const immediateWithdrawal = await createWithdrawal(immediate, { handlingMode: "immediate_delete" });
    const immediateResult = await finalizerModule.finalizeVersionWithdrawal(env, immediateWithdrawal.withdrawalId, { now: NOW });
    assert.equal(immediateResult.outcome, "deleted");
  });

  await check("immediate R2 retryable failure is recovered by active after retry delay", async () => {
    await resetIsolation();
    const target = await createVersion();
    const withdrawal = await createWithdrawal(target, { handlingMode: "immediate_delete" });
    const spy = makeR2Spy(env.FILES, { failDeleteOnce: [target.progressImageKey] });
    const retryEnv = { ...env, FILES: spy.binding };
    const firstSummary = await activeRunnerModule.runActiveDueVersionWithdrawals(retryEnv, { now: NOW });
    assert.equal(firstSummary.immediateRecoverySelectedCount, 1);
    assert.equal(firstSummary.processingCount, 1);
    const processing = await first(`
      SELECT status, handling_mode, lease_token, lease_expires_at, last_error_code
      FROM version_withdrawals WHERE id = ?
    `, withdrawal.withdrawalId);
    assert.equal(processing.status, "processing");
    assert.equal(processing.handling_mode, "immediate_delete");
    assert.equal(processing.lease_token, null);
    assert.ok(processing.lease_expires_at > PAST_SQL);
    assert.equal(processing.last_error_code, "WITHDRAWAL_R2_DELETE_FAILED");
    assert.equal(await env.FILES.head(target.r2Key), null);
    assert.notEqual(await env.FILES.head(target.progressImageKey), null);

    const earlySummary = await activeRunnerModule.runActiveDueVersionWithdrawals(retryEnv, {
      now: new Date(NOW.getTime() + 4 * 60_000)
    });
    assert.equal(earlySummary.selectedCount, 0);
    assert.equal(earlySummary.immediateRecoverySelectedCount, 0);
    assert.equal((await first(
      "SELECT attempt_count FROM version_withdrawals WHERE id = ?",
      withdrawal.withdrawalId
    )).attempt_count, 1);

    const retrySummary = await activeRunnerModule.runActiveDueVersionWithdrawals(retryEnv, {
      now: new Date(NOW.getTime() + 6 * 60_000)
    });
    assert.equal(retrySummary.immediateRecoverySelectedCount, 1);
    assert.equal(retrySummary.deletedCount, 1);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", withdrawal.withdrawalId)).status, "deleted");
    assert.equal(await env.FILES.head(target.progressImageKey), null);
  });

  await check("immediate D1 retryable failure is recovered after already-missing R2 objects", async () => {
    await resetIsolation();
    const target = await createVersion();
    const withdrawal = await createWithdrawal(target, { handlingMode: "immediate_delete" });
    const firstSummary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, {
      now: NOW,
      finalizeCandidate(candidateEnv, withdrawalId, now, handlingMode) {
        return finalizerModule.finalizeVersionWithdrawal(candidateEnv, withdrawalId, {
          now,
          expectedHandlingMode: handlingMode,
          hooks: {
            beforeD1Finalize() {
              throw new Error("injected immediate D1 terminal failure");
            }
          }
        });
      }
    });
    assert.equal(firstSummary.immediateRecoverySelectedCount, 1);
    assert.equal(firstSummary.processingCount, 1);
    assert.equal(await env.FILES.head(target.r2Key), null);
    assert.equal(await env.FILES.head(target.progressImageKey), null);

    const retrySummary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, {
      now: new Date(NOW.getTime() + 6 * 60_000)
    });
    assert.equal(retrySummary.immediateRecoverySelectedCount, 1);
    assert.equal(retrySummary.deletedCount, 1);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", withdrawal.withdrawalId)).status, "deleted");
  });

  await check("immediate recovery dependencies move to manual review without R2 deletion", async () => {
    await resetIsolation();
    const fixtures = [];
    for (const kind of ["direct_child", "collapsed_reference", "legacy_delete_request"]) {
      const target = await createVersion();
      const withdrawal = await createWithdrawal(target, { handlingMode: "immediate_delete" });
      await addDependency(target, kind);
      fixtures.push({ kind, target, withdrawal });
    }
    const spy = makeR2Spy(env.FILES);
    const summary = await activeRunnerModule.runActiveDueVersionWithdrawals(
      { ...env, FILES: spy.binding },
      { now: NOW }
    );
    assert.equal(summary.immediateRecoverySelectedCount, 3);
    assert.equal(summary.manualReviewCount, 3);
    assert.equal(summary.tombstonedCount, 0);
    assert.equal(spy.deleteCalls.length, 0);
    for (const fixture of fixtures) {
      const row = await first(`
        SELECT withdrawals.status, withdrawals.handling_mode, withdrawals.request_reason,
               withdrawals.processing_mode, withdrawals.lease_token,
               versions.withdrawal_download_blocked
        FROM version_withdrawals AS withdrawals
        INNER JOIN versions ON versions.id = withdrawals.version_id
        WHERE withdrawals.id = ?
      `, fixture.withdrawal.withdrawalId);
      assert.equal(row.status, "pending", fixture.kind);
      assert.equal(row.handling_mode, "manual_review", fixture.kind);
      assert.ok(row.request_reason, fixture.kind);
      assert.equal(row.processing_mode, null, fixture.kind);
      assert.equal(row.lease_token, null, fixture.kind);
      assert.equal(row.withdrawal_download_blocked, 1, fixture.kind);
      assert.notEqual(await env.FILES.head(fixture.target.r2Key), null, fixture.kind);
    }
  });

  await check("immediate recovery completes with missing R2 and shares one claim with synchronous finalizer", async () => {
    await resetIsolation();
    const missing = await createVersion({ putR2: false });
    const missingWithdrawal = await createWithdrawal(missing, { handlingMode: "immediate_delete" });
    const missingSummary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, { now: NOW });
    assert.equal(missingSummary.immediateRecoverySelectedCount, 1);
    assert.equal(missingSummary.deletedCount, 1);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", missingWithdrawal.withdrawalId)).status, "deleted");

    await resetIsolation();
    const concurrent = await createVersion();
    const concurrentWithdrawal = await createWithdrawal(concurrent, { handlingMode: "immediate_delete" });
    const [synchronousResult, activeSummary] = await Promise.all([
      finalizerModule.finalizeVersionWithdrawal(env, concurrentWithdrawal.withdrawalId, { now: NOW }),
      activeRunnerModule.runActiveDueVersionWithdrawals(env, { now: NOW })
    ]);
    const row = await first(
      "SELECT status, attempt_count FROM version_withdrawals WHERE id = ?",
      concurrentWithdrawal.withdrawalId
    );
    assert.equal(row.status, "deleted");
    assert.equal(row.attempt_count, 1);
    assert.equal(
      Number(synchronousResult.outcome === "deleted") + activeSummary.deletedCount,
      1
    );
    assert.equal(activeSummary.tombstonedCount, 0);
  });

  await check("concurrent finalizers claim a grace withdrawal once", async () => {
    await resetIsolation();
    const target = await createVersion();
    const withdrawal = await createWithdrawal(target);
    const results = await Promise.all([
      finalizerModule.finalizeVersionWithdrawal(env, withdrawal.withdrawalId, {
        now: NOW,
        expectedHandlingMode: "grace_auto_delete"
      }),
      finalizerModule.finalizeVersionWithdrawal(env, withdrawal.withdrawalId, {
        now: NOW,
        expectedHandlingMode: "grace_auto_delete"
      })
    ]);
    const row = await first("SELECT status, attempt_count FROM version_withdrawals WHERE id = ?", withdrawal.withdrawalId);
    assert.equal(row.status, "deleted");
    assert.equal(row.attempt_count, 1);
    assert.deepEqual(results.map((result) => result.outcome).sort(), ["deleted", "not_claimed"]);
  });

  await check("partial R2 failure retries idempotently", async () => {
    await resetIsolation();
    const target = await createVersion();
    const withdrawal = await createWithdrawal(target);
    const spy = makeR2Spy(env.FILES, { failDeleteOnce: [target.progressImageKey] });
    const retryEnv = { ...env, FILES: spy.binding };
    const firstResult = await finalizerModule.finalizeVersionWithdrawal(retryEnv, withdrawal.withdrawalId, {
      now: NOW,
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.equal(firstResult.outcome, "processing");
    assert.equal(firstResult.retryable, true);
    assert.equal(firstResult.errorCode, "WITHDRAWAL_R2_DELETE_FAILED");
    assert.equal(await env.FILES.head(target.r2Key), null);
    assert.notEqual(await env.FILES.head(target.progressImageKey), null);
    const retryResult = await finalizerModule.finalizeVersionWithdrawal(retryEnv, withdrawal.withdrawalId, {
      now: new Date(NOW.getTime() + 6 * 60_000),
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.equal(retryResult.outcome, "deleted");
    assert.equal(await env.FILES.head(target.progressImageKey), null);
  });

  await check("D1 terminal-stage failure retries after already-missing R2 objects", async () => {
    await resetIsolation();
    const target = await createVersion();
    const withdrawal = await createWithdrawal(target);
    const firstResult = await finalizerModule.finalizeVersionWithdrawal(env, withdrawal.withdrawalId, {
      now: NOW,
      expectedHandlingMode: "grace_auto_delete",
      hooks: {
        beforeD1Finalize() {
          throw new Error("injected isolated D1 terminal failure");
        }
      }
    });
    assert.equal(firstResult.outcome, "processing");
    assert.equal(firstResult.retryable, true);
    assert.equal(await env.FILES.head(target.r2Key), null);
    const retryResult = await finalizerModule.finalizeVersionWithdrawal(env, withdrawal.withdrawalId, {
      now: new Date(NOW.getTime() + 6 * 60_000),
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.equal(retryResult.outcome, "deleted");
  });

  await check("dependency races at every stage end in manual review without tombstones", async () => {
    const scenarios = [
      { hook: "afterClaim", kind: "direct_child", r2Deleted: false, raceCode: false },
      { hook: "afterProcessingMode", kind: "collapsed_reference", r2Deleted: false, raceCode: false },
      { hook: "beforeR2Delete", kind: "legacy_delete_request", r2Deleted: false, raceCode: false },
      { hook: "afterR2Delete", kind: "direct_child", r2Deleted: true, raceCode: true },
      { hook: "beforeD1Finalize", kind: "hidden_child", r2Deleted: true, raceCode: true }
    ];
    for (const scenario of scenarios) {
      await resetIsolation();
      const target = await createVersion();
      const withdrawal = await createWithdrawal(target);
      let injected = false;
      const hooks = {
        [scenario.hook]: async () => {
          if (injected) return;
          injected = true;
          await addDependency(target, scenario.kind);
        }
      };
      const spy = makeR2Spy(env.FILES);
      const result = await finalizerModule.finalizeVersionWithdrawal(
        { ...env, FILES: spy.binding },
        withdrawal.withdrawalId,
        {
          now: NOW,
          expectedHandlingMode: "grace_auto_delete",
          hooks
        }
      );
      const row = await first(`
        SELECT status, handling_mode, processing_mode, lease_token, last_error_code
        FROM version_withdrawals WHERE id = ?
      `, withdrawal.withdrawalId);
      assert.equal(result.outcome, "manual_review", scenario.hook);
      assert.equal(row.status, "pending", scenario.hook);
      assert.equal(row.handling_mode, "manual_review", scenario.hook);
      assert.equal(row.processing_mode, null, scenario.hook);
      assert.equal(row.lease_token, null, scenario.hook);
      assert.equal(
        row.last_error_code === "WITHDRAWAL_DEPENDENCY_RACE_AFTER_R2",
        scenario.raceCode,
        scenario.hook
      );
      assert.equal(await env.FILES.head(target.r2Key) === null, scenario.r2Deleted, scenario.hook);
      assert.equal((await first("SELECT COUNT(*) AS count FROM version_withdrawals WHERE status = 'tombstoned'")).count, 0);
    }
  });

  await check("non-retryable conflict and missing version terminate in manual review", async () => {
    await resetIsolation();
    const conflicted = await createVersion();
    const conflictedWithdrawal = await createWithdrawal(conflicted);
    await env.DB.prepare("UPDATE versions SET withdrawn_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(conflicted.versionId).run();
    const conflictResult = await finalizerModule.finalizeVersionWithdrawal(env, conflictedWithdrawal.withdrawalId, {
      now: NOW,
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.equal(conflictResult.outcome, "manual_review");
    assert.equal(conflictResult.errorCode, "LEGACY_LIFECYCLE_CONFLICT");

    const missing = await createVersion();
    const missingWithdrawal = await createWithdrawal(missing);
    await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(missing.versionId).run();
    const missingResult = await finalizerModule.finalizeVersionWithdrawal(env, missingWithdrawal.withdrawalId, {
      now: NOW,
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.equal(missingResult.outcome, "manual_review");
    assert.equal(missingResult.errorCode, "WITHDRAWAL_VERSION_MISSING");
    const row = await first("SELECT status, handling_mode, attempt_count FROM version_withdrawals WHERE id = ?", missingWithdrawal.withdrawalId);
    assert.equal(row.status, "pending");
    assert.equal(row.handling_mode, "manual_review");
    assert.equal(row.attempt_count, 1);
    const repeated = await finalizerModule.finalizeVersionWithdrawal(env, missingWithdrawal.withdrawalId, {
      now: new Date(NOW.getTime() + 60 * 60_000),
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.notEqual(repeated.outcome, "deleted");
    assert.equal((await first("SELECT attempt_count FROM version_withdrawals WHERE id = ?", missingWithdrawal.withdrawalId)).attempt_count, 1);
  });

  await check("candidate errors continue, fatal summaries are safe, and limit+1 detects truncation", async () => {
    await resetIsolation();
    const firstTarget = await createVersion();
    const firstWithdrawal = await createWithdrawal(firstTarget);
    const secondTarget = await createVersion();
    const secondWithdrawal = await createWithdrawal(secondTarget);
    const changedTarget = await createVersion();
    const changedWithdrawal = await createWithdrawal(changedTarget);
    const isolatedSummary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, {
      now: NOW,
      async finalizeCandidate(candidateEnv, withdrawalId, now, handlingMode) {
        if (withdrawalId === firstWithdrawal.withdrawalId) {
          throw new Error("injected isolated candidate failure");
        }
        if (withdrawalId === changedWithdrawal.withdrawalId) {
          await candidateEnv.DB.prepare(`
            UPDATE version_withdrawals SET handling_mode = 'manual_review' WHERE id = ?
          `).bind(withdrawalId).run();
        }
        return finalizerModule.finalizeVersionWithdrawal(candidateEnv, withdrawalId, {
          now,
          expectedHandlingMode: handlingMode
        });
      }
    });
    assert.equal(isolatedSummary.deletedCount, 1);
    assert.equal(isolatedSummary.skippedCount, 2);
    assert.equal(isolatedSummary.errorCount, 1);
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", firstWithdrawal.withdrawalId)).status, "pending");
    assert.equal((await first("SELECT status FROM version_withdrawals WHERE id = ?", secondWithdrawal.withdrawalId)).status, "deleted");
    const changed = await first("SELECT status, handling_mode, attempt_count FROM version_withdrawals WHERE id = ?", changedWithdrawal.withdrawalId);
    assert.equal(changed.status, "pending");
    assert.equal(changed.handling_mode, "manual_review");
    assert.equal(changed.attempt_count, 0);

    const fatalSummary = await activeRunnerModule.runActiveDueVersionWithdrawals(env, {
      now: NOW,
      async selectCandidates() {
        throw new Error("injected isolated candidate selection failure");
      }
    });
    assert.equal(fatalSummary.fatalErrorCode, "WITHDRAWAL_ACTIVE_FAILED");
    assert.equal(fatalSummary.errorCount, 1);

    await resetIsolation();
    for (let index = 0; index < 3; index += 1) {
      const target = await createVersion();
      await createWithdrawal(target);
    }
    const truncated = await activeRunnerModule.runActiveDueVersionWithdrawals(env, { now: NOW, limit: 2 });
    assert.equal(truncated.selectedCount, 2);
    assert.equal(truncated.deletedCount, 2);
    assert.equal(truncated.truncated, true);
    assert.equal((await first("SELECT COUNT(*) AS count FROM version_withdrawals WHERE status = 'pending'")).count, 1);
  });

  await check("missing R2 objects are idempotent and non-orphan chart/song remain", async () => {
    await resetIsolation();
    const missingObjects = await createVersion({ putR2: false });
    const missingWithdrawal = await createWithdrawal(missingObjects);
    const missingResult = await finalizerModule.finalizeVersionWithdrawal(env, missingWithdrawal.withdrawalId, {
      now: NOW,
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.equal(missingResult.outcome, "deleted");

    const parent = await createVersion();
    const child = await createVersion({
      songId: parent.songId,
      chartId: parent.chartId,
      parentVersionId: parent.versionId,
      versionNumber: 2
    });
    const childWithdrawal = await createWithdrawal(child);
    const childResult = await finalizerModule.finalizeVersionWithdrawal(env, childWithdrawal.withdrawalId, {
      now: NOW,
      expectedHandlingMode: "grace_auto_delete"
    });
    assert.equal(childResult.outcome, "deleted");
    assert.equal((await first("SELECT COUNT(*) AS count FROM versions WHERE id = ?", parent.versionId)).count, 1);
    assert.equal((await first("SELECT COUNT(*) AS count FROM charts WHERE id = ?", parent.chartId)).count, 1);
    assert.equal((await first("SELECT COUNT(*) AS count FROM songs WHERE id = ?", parent.songId)).count, 1);
  });

  await check("pending/manual public, download, RC, admin, lifecycle, and cancellation regressions", async () => {
    await resetIsolation();
    const manual = await createVersion({ progress: 100 });
    const manualWithdrawal = await createWithdrawal(manual, {
      handlingMode: "manual_review",
      reason: "管理画面に表示する隔離テスト理由です。"
    });
    const publicEnv = { ...env, HASH_SECRET: TEST_SECRET, ADMIN_TOKEN: TEST_ADMIN_TOKEN };
    const fileResponse = await indexModule.default.fetch(
      new Request(`http://localhost/api/files/${manual.fileId}`),
      publicEnv
    );
    assert.equal(fileResponse.status, 404);
    assert.equal((await fileResponse.json()).code, "FILE_NOT_FOUND");

    const lifecycleResponse = await indexModule.default.fetch(
      new Request(`http://localhost/api/versions/${manual.versionId}/lifecycle`),
      publicEnv
    );
    assert.equal(lifecycleResponse.status, 200);
    const lifecycle = await lifecycleResponse.json();
    assert.equal(lifecycle.handlingMode, "manual_review");

    const listResponse = await indexModule.default.fetch(
      new Request("http://localhost/api/versions"),
      publicEnv
    );
    assert.equal(listResponse.status, 200);
    assert.match(JSON.stringify(await listResponse.json()), new RegExp(manual.versionId));

    const rcResponse = await indexModule.default.fetch(
      new Request("http://localhost/api/difficulty-tables/rc-star/data.json"),
      publicEnv
    );
    assert.equal(rcResponse.status, 200);
    assert.doesNotMatch(await rcResponse.text(), new RegExp(manual.versionId));

    const adminResponse = await indexModule.default.fetch(
      new Request("http://localhost/api/admin/version-withdrawals", {
        headers: { Authorization: `Bearer ${TEST_ADMIN_TOKEN}` }
      }),
      publicEnv
    );
    assert.equal(adminResponse.status, 200);
    const adminBody = JSON.stringify(await adminResponse.json());
    assert.match(adminBody, new RegExp(manualWithdrawal.withdrawalId));
    assert.match(adminBody, /管理画面に表示する隔離テスト理由です。/);

    const cancelTarget = await createVersion({ downloadBlocked: true });
    const cancelWithdrawal = await createWithdrawal(cancelTarget, { scheduledAt: FUTURE_SQL });
    const cancelResponse = await indexModule.default.fetch(
      new Request(`http://localhost/api/versions/${cancelTarget.versionId}/withdrawal/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: TEST_PASSWORD })
      }),
      publicEnv
    );
    assert.equal(cancelResponse.status, 200);
    const canceled = await first(`
      SELECT withdrawals.status, versions.withdrawal_download_blocked, versions.download_blocked
      FROM version_withdrawals AS withdrawals
      INNER JOIN versions ON versions.id = withdrawals.version_id
      WHERE withdrawals.id = ?
    `, cancelWithdrawal.withdrawalId);
    assert.equal(canceled.status, "canceled");
    assert.equal(canceled.withdrawal_download_blocked, 0);
    assert.equal(canceled.download_blocked, 1);
  });

  await check("daily R2 cleanup cron remains independent", async () => {
    await resetIsolation();
    await runIndexScheduled("active", env, "0 18 * * *", NOW);
    assert.equal((await first("SELECT COUNT(*) AS count FROM admin_logs WHERE action = 'r2_cleanup_cron_run'")).count, 1);
    assert.equal(await latestSystemSummary("withdrawal_cron_active"), null);
  });

  console.log(`version withdrawal active isolated tests: ${passed} passed`);
} finally {
  await harness.close();
}
