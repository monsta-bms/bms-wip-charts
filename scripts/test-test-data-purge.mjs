import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PURGE_ERROR_CODES,
  TestDataPurgeError,
  applySqlBatchLocally,
  assertSafeLogText,
  assertSqlSafety,
  buildD1Batch,
  computeVersionDeleteOrder,
  deleteExactR2Objects,
  encodeR2ObjectKey,
  inspectLocalSnapshot,
  runGuardedLocalD1Apply,
  validateManifest
} from "./admin/test-data-purge-lib.mjs";

const ids = Object.freeze({
  targetSong: "song_11111111-1111-4111-8111-111111111111",
  keepSong: "song_22222222-2222-4222-8222-222222222222",
  targetChart: "chart_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  keepChart: "chart_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  rootVersion: "version_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  childVersion: "version_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  keepVersion: "version_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  withdrawal: "withdrawal_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  deleteRequest: "request_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  postLog: "post_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  adminLog: "admin_ffffffff-ffff-4fff-8fff-ffffffffffff"
});

const candidateBytes = Buffer.from("approved candidate fixture", "utf8");
const candidateHash = createHash("sha256").update(candidateBytes).digest("hex");

function makeManifest(overrides = {}) {
  const manifest = {
    schemaVersion: 1,
    manifestId: "test-data-bulk-purge-11111111-1111-4111-8111-111111111111",
    approvedAt: "2026-08-02T00:00:00.000Z",
    approvedCandidateFileSha256: candidateHash,
    approvalState: "APPROVED",
    chartIds: [ids.targetChart],
    versionIds: [ids.rootVersion, ids.childVersion],
    songIds: [ids.targetSong],
    keepChartIds: [ids.keepChart],
    keepVersionIds: [ids.keepVersion],
    relatedRowIdsByTable: {
      charts: [ids.targetChart],
      versions: [ids.rootVersion, ids.childVersion],
      songs: [ids.targetSong],
      version_withdrawals: [ids.withdrawal],
      delete_requests: [ids.deleteRequest],
      post_logs: [ids.postLog],
      version_source_metadata: [ids.rootVersion, ids.childVersion],
      admin_logs: [ids.adminLog],
      bans: []
    },
    expectedRowCountsByTable: {
      charts: 1,
      versions: 2,
      songs: 1,
      version_withdrawals: 1,
      delete_requests: 1,
      post_logs: 1,
      version_source_metadata: 2,
      admin_logs: 1,
      bans: 0
    },
    r2ExactObjectKeys: [
      `charts/${ids.targetChart}/versions/root/file_11111111-1111-4111-8111-111111111111.bms`,
      `charts/${ids.targetChart}/versions/${ids.childVersion}/progress/progress.png`
    ],
    expectedObjectCount: 2,
    expectedChartObjectCount: 1,
    expectedProgressImageObjectCount: 1,
    guards: { exactIdsOnly: true, wildcardDeleteAllowed: false },
    ...overrides
  };
  return manifest;
}

function createDatabase({ sharedSong = false } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE songs (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE charts (id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE RESTRICT);
    CREATE TABLE versions (
      id TEXT PRIMARY KEY,
      chart_id TEXT NOT NULL REFERENCES charts(id) ON DELETE RESTRICT,
      parent_version_id TEXT REFERENCES versions(id) ON DELETE RESTRICT,
      collapsed_by_version_id TEXT
    );
    CREATE TABLE version_withdrawals (id TEXT PRIMARY KEY, version_id TEXT, chart_id TEXT, status TEXT);
    CREATE TABLE delete_requests (
      id TEXT PRIMARY KEY,
      version_id TEXT REFERENCES versions(id) ON DELETE RESTRICT,
      chart_id TEXT REFERENCES charts(id) ON DELETE RESTRICT
    );
    CREATE TABLE post_logs (id TEXT PRIMARY KEY, chart_id TEXT, version_id TEXT);
    CREATE TABLE version_source_metadata (
      version_id TEXT PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,
      status TEXT
    );
    CREATE TABLE admin_logs (id TEXT PRIMARY KEY, target_id TEXT);
    CREATE TABLE bans (id TEXT PRIMARY KEY);
  `);
  const insert = (sql, ...params) => database.prepare(sql).run(...params);
  insert("INSERT INTO songs (id,title) VALUES (?,?)", ids.targetSong, "target");
  insert("INSERT INTO songs (id,title) VALUES (?,?)", ids.keepSong, "keep");
  insert("INSERT INTO charts (id,song_id) VALUES (?,?)", ids.targetChart, ids.targetSong);
  insert("INSERT INTO charts (id,song_id) VALUES (?,?)", ids.keepChart, sharedSong ? ids.targetSong : ids.keepSong);
  insert("INSERT INTO versions (id,chart_id,parent_version_id,collapsed_by_version_id) VALUES (?,?,NULL,NULL)", ids.rootVersion, ids.targetChart);
  insert("INSERT INTO versions (id,chart_id,parent_version_id,collapsed_by_version_id) VALUES (?,?,?,NULL)", ids.childVersion, ids.targetChart, ids.rootVersion);
  insert("INSERT INTO versions (id,chart_id,parent_version_id,collapsed_by_version_id) VALUES (?,?,NULL,NULL)", ids.keepVersion, ids.keepChart);
  insert("INSERT INTO version_withdrawals (id,version_id,chart_id,status) VALUES (?,?,?,'canceled')", ids.withdrawal, ids.rootVersion, ids.targetChart);
  insert("INSERT INTO delete_requests (id,version_id,chart_id) VALUES (?,?,?)", ids.deleteRequest, ids.rootVersion, ids.targetChart);
  insert("INSERT INTO post_logs (id,chart_id,version_id) VALUES (?,?,?)", ids.postLog, ids.targetChart, ids.childVersion);
  insert("INSERT INTO version_source_metadata (version_id,status) VALUES (?,'succeeded')", ids.rootVersion);
  insert("INSERT INTO version_source_metadata (version_id,status) VALUES (?,'succeeded')", ids.childVersion);
  insert("INSERT INTO admin_logs (id,target_id) VALUES (?,?)", ids.adminLog, ids.targetChart);
  return database;
}

async function expectCode(callback, code) {
  let received;
  try {
    await callback();
  } catch (error) {
    received = error;
  }
  assert.ok(received, `Expected ${code}`);
  assert.equal(received instanceof TestDataPurgeError ? received.code : received.message, code);
}

let checkCount = 0;
async function check(name, callback) {
  await callback();
  checkCount += 1;
  console.log(`ok ${checkCount} - ${name}`);
}

await check("approved exact-ID manifest is accepted", () => {
  assert.equal(validateManifest(makeManifest(), { candidateBytes }).manifestId.length > 0, true);
});

await check("whole chart and all dependent rows are deleted", () => {
  const database = createDatabase();
  try {
    runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: true });
    for (const table of ["versions", "charts", "version_withdrawals", "delete_requests", "post_logs", "version_source_metadata", "admin_logs"]) {
      assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === "version_source_metadata" ? "version_id" : "id"} IN (?,?)`).get(ids.rootVersion, ids.childVersion)?.count ?? 0, 0);
    }
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM songs WHERE id = ?").get(ids.targetSong).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM charts WHERE id = ?").get(ids.keepChart).count, 1);
  } finally {
    database.close();
  }
});

await check("multiple versions are ordered leaf before parent", () => {
  assert.deepEqual(computeVersionDeleteOrder([
    { id: ids.rootVersion, parent_version_id: null },
    { id: ids.childVersion, parent_version_id: ids.rootVersion }
  ]), [ids.childVersion, ids.rootVersion]);
});

await check("shared song is retained when omitted from exact song targets", () => {
  const database = createDatabase({ sharedSong: true });
  const base = makeManifest();
  const manifest = makeManifest({
    songIds: [],
    relatedRowIdsByTable: { ...base.relatedRowIdsByTable, songs: [] },
    expectedRowCountsByTable: { ...base.expectedRowCountsByTable, songs: 0 }
  });
  try {
    runGuardedLocalD1Apply({ database, manifest, backupReady: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM songs WHERE id = ?").get(ids.targetSong).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM charts WHERE song_id = ?").get(ids.targetSong).count, 1);
  } finally {
    database.close();
  }
});

await check("manifest-outside version in target chart rejects with write zero", async () => {
  const database = createDatabase();
  const extra = "version_33333333-3333-4333-8333-333333333333";
  database.prepare("INSERT INTO versions (id,chart_id,parent_version_id) VALUES (?,?,?)").run(extra, ids.targetChart, ids.childVersion);
  try {
    await expectCode(() => runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: true }), PURGE_ERROR_CODES.targetChanged);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM versions WHERE chart_id = ?").get(ids.targetChart).count, 3);
  } finally {
    database.close();
  }
});

await check("outside child reference rejects with write zero", async () => {
  const database = createDatabase();
  database.prepare("UPDATE versions SET parent_version_id = ? WHERE id = ?").run(ids.childVersion, ids.keepVersion);
  try {
    await expectCode(() => runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: true }), PURGE_ERROR_CODES.targetChanged);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM versions WHERE id = ?").get(ids.rootVersion).count, 1);
  } finally {
    database.close();
  }
});

await check("outside collapsed reference rejects with write zero", async () => {
  const database = createDatabase();
  database.prepare("UPDATE versions SET collapsed_by_version_id = ? WHERE id = ?").run(ids.childVersion, ids.keepVersion);
  try {
    await expectCode(() => runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: true }), PURGE_ERROR_CODES.targetChanged);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM versions WHERE id = ?").get(ids.childVersion).count, 1);
  } finally {
    database.close();
  }
});

await check("canceled withdrawal is included and deleted", () => {
  const database = createDatabase();
  try {
    runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM version_withdrawals WHERE id = ?").get(ids.withdrawal).count, 0);
  } finally {
    database.close();
  }
});

await check("legacy delete request is included and deleted", () => {
  const database = createDatabase();
  try {
    runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM delete_requests WHERE id = ?").get(ids.deleteRequest).count, 0);
  } finally {
    database.close();
  }
});

await check("progress image exact object is enumerated", () => {
  const manifest = validateManifest(makeManifest());
  assert.equal(manifest.r2ExactObjectKeys.filter((key) => key.includes("/progress/")).length, 1);
  assert.equal(manifest.expectedProgressImageObjectCount, 1);
});

await check("R2 object key preserves slashes and encodes each path segment", () => {
  assert.equal(
    encodeR2ObjectKey("charts/chart_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/versions/a b/progress/progress.png"),
    "charts/chart_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/versions/a%20b/progress/progress.png"
  );
});

await check("backup failure blocks all D1 writes", async () => {
  const database = createDatabase();
  try {
    await expectCode(() => runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: false }), PURGE_ERROR_CODES.backupFailed);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM versions WHERE chart_id = ?").get(ids.targetChart).count, 2);
  } finally {
    database.close();
  }
});

await check("target change in related rows blocks all D1 writes", async () => {
  const database = createDatabase();
  const extraLog = "post_44444444-4444-4444-8444-444444444444";
  database.prepare("INSERT INTO post_logs (id,chart_id,version_id) VALUES (?,?,?)").run(extraLog, ids.targetChart, ids.rootVersion);
  try {
    await expectCode(() => runGuardedLocalD1Apply({ database, manifest: makeManifest(), backupReady: true }), PURGE_ERROR_CODES.targetChanged);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM versions WHERE chart_id = ?").get(ids.targetChart).count, 2);
  } finally {
    database.close();
  }
});

await check("D1 transaction rolls back when a later statement fails", async () => {
  const database = createDatabase();
  try {
    const snapshot = inspectLocalSnapshot(database, makeManifest());
    const batch = buildD1Batch(makeManifest(), snapshot);
    const firstDelete = batch.findIndex((statement) => statement.kind === "delete");
    batch.splice(firstDelete + 1, 0, { kind: "guard", table: "fixture", sql: "SELECT missing_column FROM versions", params: [] });
    assert.throws(() => applySqlBatchLocally(database, batch));
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM version_source_metadata").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM versions WHERE chart_id = ?").get(ids.targetChart).count, 2);
  } finally {
    database.close();
  }
});

await check("R2 partial failure returns exact orphan cleanup plan", async () => {
  const keys = ["charts/chart_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.bms", "charts/chart_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/b.png"];
  const existing = new Set(keys);
  const result = await deleteExactR2Objects({
    keys,
    maxAttempts: 2,
    deleteObject: async (key) => {
      if (key.endsWith("b.png")) throw new Error("R2_DELETE_FAILED");
      existing.delete(key);
    },
    objectExists: async (key) => existing.has(key)
  });
  assert.equal(result.deleted.length, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.attemptCount, 3);
  assert.deepEqual(result.orphanPlan, [{ key: keys[1], action: "RETRY_EXACT_DELETE", code: "R2_DELETE_FAILED" }]);
});

await check("LIKE deletion is rejected", async () => {
  await expectCode(() => assertSqlSafety([{ sql: "DELETE FROM versions WHERE author LIKE ?", params: ["test"] }]), PURGE_ERROR_CODES.manifestInvalid);
});

await check("empty manifest is rejected", async () => {
  await expectCode(() => validateManifest(makeManifest({ chartIds: [] })), PURGE_ERROR_CODES.manifestInvalid);
});

await check("DELETE without WHERE is rejected", async () => {
  await expectCode(() => assertSqlSafety([{ sql: "DELETE FROM versions", params: [] }]), PURGE_ERROR_CODES.manifestInvalid);
});

await check("KEEP target overlap is rejected", async () => {
  await expectCode(() => validateManifest(makeManifest({ keepChartIds: [ids.targetChart] })), PURGE_ERROR_CODES.manifestInvalid);
});

await check("safe logs exclude secret, password, hashes, and bearer values", async () => {
  assert.equal(assertSafeLogText("stage=verify code=OK target_count=2"), true);
  for (const unsafe of [
    "Authorization: Bearer secret-value",
    "password_hash=secret-value",
    "ADMIN_TOKEN=secret-value",
    `file_hash=${"a".repeat(64)}`
  ]) {
    await expectCode(() => assertSafeLogText(unsafe), PURGE_ERROR_CODES.verifyFailed);
  }
});

console.log(`test data purge safety tests: ${checkCount} checks passed`);
