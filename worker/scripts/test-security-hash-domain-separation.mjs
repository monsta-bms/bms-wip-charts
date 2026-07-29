import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  REQUIRED_SECRET_NAMES,
  evaluateCutoverSnapshot,
  inspectLocalDatabase,
  parseVersionSecretNames
} from "./security-hash-cutover-preflight.mjs";

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workerRoot, "..");
let passed = 0;

async function check(name, callback) {
  await callback();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function importBundled(entryPoint) {
  const result = await build({
    entryPoints: [resolve(workerRoot, entryPoint)],
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

const securityHash = await importBundled("src/utils/securityHash.ts");
const fingerprintModule = await importBundled("src/utils/requestFingerprint.ts");
const source = async (path) => readFile(resolve(workerRoot, path), "utf8");

await check("HMAC is deterministic", async () => {
  const left = await securityHash.hmacSha256Hex("secret-a", "password", "password:value", 2);
  const right = await securityHash.hmacSha256Hex("secret-a", "password", "password:value", 2);
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/u);
});

await check("secret, domain, and key version change the HMAC", async () => {
  const base = await securityHash.hmacSha256Hex("secret-a", "password", "value", 2);
  assert.notEqual(base, await securityHash.hmacSha256Hex("secret-b", "password", "value", 2));
  assert.notEqual(base, await securityHash.hmacSha256Hex("secret-a", "abuse-subject", "value", 2));
  assert.notEqual(base, await securityHash.hmacSha256Hex("secret-a", "password", "value", 3));
});

await check("empty secrets fail without exposing input", async () => {
  await assert.rejects(
    securityHash.hmacSha256Hex("  ", "password", "do-not-log-this", 2),
    (error) => !String(error).includes("do-not-log-this")
  );
});

await check("timing-safe comparison handles matches and mismatches", async () => {
  assert.equal(securityHash.timingSafeEqual("a".repeat(64), "a".repeat(64)), true);
  assert.equal(securityHash.timingSafeEqual("a".repeat(64), `${"a".repeat(63)}b`), false);
  assert.equal(securityHash.timingSafeEqual("short", "longer"), false);
});

await check("password version 2 creates and verifies while wrong values fail", async () => {
  const hash = await securityHash.hashPassword("password-secret", "correct");
  assert.equal(await securityHash.verifyPasswordHash("password-secret", "correct", hash, 2), "verified");
  assert.equal(await securityHash.verifyPasswordHash("password-secret", "wrong", hash, 2), "invalid");
});

await check("legacy password versions are invalidated without old-secret fallback", async () => {
  assert.equal(await securityHash.verifyPasswordHash("new-secret", "value", "legacy", 1), "legacy");
  for (const path of ["src/routes/versionLifecycle.ts", "src/routes/versionWithdrawal.ts"]) {
    assert.match(await source(path), /MANAGEMENT_PASSWORD_EXPIRED/u);
  }
});

await check("request fingerprints are deterministic and marker-sensitive", async () => {
  const request = new Request("https://example.test", {
    headers: { "CF-Connecting-IP": "192.0.2.1", "User-Agent": "fixture-agent" }
  });
  const first = await fingerprintModule.buildRequestFingerprint(request, "abuse-secret");
  const second = await fingerprintModule.buildRequestFingerprint(request, "abuse-secret");
  assert.deepEqual(first, second);
  const changedIp = await fingerprintModule.buildRequestFingerprint(new Request("https://example.test", {
    headers: { "CF-Connecting-IP": "192.0.2.2", "User-Agent": "fixture-agent" }
  }), "abuse-secret");
  const changedUa = await fingerprintModule.buildRequestFingerprint(new Request("https://example.test", {
    headers: { "CF-Connecting-IP": "192.0.2.1", "User-Agent": "other-agent" }
  }), "abuse-secret");
  assert.notEqual(first.ipHash, changedIp.ipHash);
  assert.notEqual(first.uaHash, changedUa.uaHash);
});

await check("BAN creation and matching share abuse hash version 2", async () => {
  const bans = await source("src/routes/bans.ts");
  assert.match(bans, /ban_hash_version = 2/u);
  assert.match(bans, /fingerprint_hash_version\) !== 2/u);
  assert.match(bans, /INSERT INTO bans[\s\S]*ban_hash_version/u);
});

await check("rate-limit queries and writes use fingerprint version 2 only", async () => {
  const rateLimit = await source("src/routes/postingRateLimit.ts");
  assert.match(rateLimit, /AND fingerprint_hash_version = 2/u);
  assert.match(rateLimit, /fingerprint_hash_version,[\s\S]*VALUES[\s\S]*2/u);
});

await check("withdrawal idempotency uses only its dedicated secret and version 2", async () => {
  const withdrawal = await source("src/routes/versionWithdrawal.ts");
  assert.match(withdrawal, /hashWithdrawalIdempotency/u);
  assert.match(withdrawal, /WITHDRAWAL_IDEMPOTENCY_SECRET/u);
  assert.match(withdrawal, /idempotency_hash_version = 2/u);
  assert.doesNotMatch(withdrawal, /\bHASH_SECRET\b/u);
});

await check("ADMIN_TOKEN admin recovery authentication remains present", async () => {
  const admin = await source("src/routes/admin.ts");
  assert.match(admin, /env\.ADMIN_TOKEN/u);
  assert.match(admin, /Authorization/u);
});

await check("production TypeScript has zero legacy secret references", async () => {
  const files = [];
  const visit = async (directory) => {
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  await visit(resolve(workerRoot, "src"));
  for (const path of files) assert.doesNotMatch(await readFile(path, "utf8"), /\bHASH_SECRET\b/u, path);
});

await check("Wrangler latest-version output parsing keeps secret names only", async () => {
  const names = parseVersionSecretNames(`-- Version fixture (0%) secrets --\nSecret Name: ADMIN_TOKEN\nSecret Name: ABUSE_HASH_SECRET\n`);
  assert.deepEqual(names, ["ADMIN_TOKEN", "ABUSE_HASH_SECRET"]);
});

await check("every production persistent security hash write stores its version", async () => {
  const routeFiles = [
    "src/routes/bans.ts",
    "src/routes/charts.ts",
    "src/routes/chartVersions.ts",
    "src/routes/postingRateLimit.ts",
    "src/routes/turnstile.ts",
    "src/routes/versionLifecycle.ts",
    "src/routes/versionWithdrawal.ts"
  ];
  for (const path of routeFiles) {
    const text = await source(path);
    for (const match of text.matchAll(/INSERT INTO post_logs\s*\(([\s\S]*?)\)/gu)) {
      assert.match(match[1], /fingerprint_hash_version/u, path);
    }
  }
  const charts = await source("src/routes/charts.ts");
  const versions = await source("src/routes/chartVersions.ts");
  assert.match(charts, /password_hash,\s*password_hash_version/u);
  assert.match(versions, /password_hash,\s*password_hash_version/u);
  const lifecycle = await source("src/routes/versionLifecycle.ts");
  assert.match(lifecycle, /requester_ua_hash,\s*fingerprint_hash_version/u);
  const withdrawal = await source("src/routes/versionWithdrawal.ts");
  assert.match(withdrawal, /idempotency_hash_version[\s\S]*fingerprint_hash_version/u);
});

await check("dedicated secrets are passed only to their matching hash helpers", async () => {
  for (const path of ["src/routes/charts.ts", "src/routes/chartVersions.ts"]) {
    const text = await source(path);
    assert.match(text, /hashPassword\(secret, password\)/u);
    assert.doesNotMatch(text, /hashPassword\(abuseSecret/u);
  }
  const withdrawal = await source("src/routes/versionWithdrawal.ts");
  assert.match(withdrawal, /hashWithdrawalIdempotency\(\s*idempotencySecret!/u);
  assert.doesNotMatch(withdrawal, /hashWithdrawalIdempotency\(\s*passwordSecret/u);
});

const temporaryRoot = await mkdtemp(join(tmpdir(), "bms-security-hash-"));
try {
  const migrationDatabase = new DatabaseSync(join(temporaryRoot, "migration.sqlite"));
  for (let number = 1; number <= 9; number += 1) {
    const prefix = String(number).padStart(4, "0");
    const { readdir } = await import("node:fs/promises");
    const name = (await readdir(resolve(workerRoot, "migrations"))).find((candidate) => candidate.startsWith(`${prefix}_`));
    migrationDatabase.exec(await readFile(resolve(workerRoot, "migrations", name), "utf8"));
  }
  migrationDatabase.exec(`
    INSERT INTO songs (id, title, artist, normalized_title, normalized_artist)
    VALUES ('legacy-song', 'Legacy', 'Tester', 'legacy', 'tester');
    INSERT INTO charts (id, song_id, chart_name, normalized_chart_name)
    VALUES ('legacy-chart', 'legacy-song', 'Legacy', 'legacy');
    INSERT INTO versions (
      id, chart_id, version_number, branch_path, author, progress, title, artist,
      file_id, file_name, file_size, file_sha256, r2_key, password_hash
    ) VALUES (
      'legacy-version', 'legacy-chart', 1, 'root', 'Tester', 50, 'Legacy', 'Tester',
      'legacy-file', 'legacy.bms', 1, 'legacy-file-sha', 'legacy/r2', 'legacy-password-hash'
    );
    INSERT INTO post_logs (id, action, ip_hash, ua_hash, result)
    VALUES ('legacy-log', 'create_chart', 'legacy-ip', 'legacy-ua', 'accepted');
    INSERT INTO bans (id, ban_type, ban_value, reason, active)
    VALUES
      ('legacy-hash-ban', 'ip_hash', 'legacy-ip', 'legacy', 1),
      ('legacy-file-ban', 'file_sha256', 'legacy-file-sha', 'legacy', 1);
    INSERT INTO delete_requests (
      id, version_id, chart_id, requester_ip_hash, requester_ua_hash, status
    ) VALUES (
      'legacy-delete', 'legacy-version', 'legacy-chart', 'legacy-ip', 'legacy-ua', 'rejected'
    );
    INSERT INTO version_withdrawals (
      id, version_id, chart_id, status, request_mode, requested_at, scheduled_at,
      idempotency_key_hash, requester_ip_hash, requester_ua_hash
    ) VALUES (
      'legacy-withdrawal', 'legacy-version', 'legacy-chart', 'canceled', 'deferred',
      '2026-07-01 00:00:00', '2026-07-08 00:00:00',
      'legacy-idempotency', 'legacy-ip', 'legacy-ua'
    );
  `);
  migrationDatabase.exec(await readFile(
    resolve(workerRoot, "migrations", "0010_security_hash_key_versions.sql"),
    "utf8"
  ));

  try {
    await check("migration labels legacy rows version 1 and disables only legacy hash bans", async () => {
      assert.equal(migrationDatabase.prepare("SELECT password_hash_version AS version FROM versions").get().version, 1);
      assert.equal(migrationDatabase.prepare("SELECT fingerprint_hash_version AS version FROM post_logs").get().version, 1);
      assert.equal(migrationDatabase.prepare("SELECT fingerprint_hash_version AS version FROM delete_requests").get().version, 1);
      const withdrawal = migrationDatabase.prepare("SELECT idempotency_hash_version, fingerprint_hash_version FROM version_withdrawals").get();
      assert.equal(withdrawal.idempotency_hash_version, 1);
      assert.equal(withdrawal.fingerprint_hash_version, 1);
      const hashBan = migrationDatabase.prepare("SELECT active, disabled_at, ban_hash_version FROM bans WHERE id = 'legacy-hash-ban'").get();
      assert.equal(hashBan.active, 0);
      assert.notEqual(hashBan.disabled_at, null);
      assert.equal(hashBan.ban_hash_version, 1);
      const fileBan = migrationDatabase.prepare("SELECT active, ban_hash_version FROM bans WHERE id = 'legacy-file-ban'").get();
      assert.equal(fileBan.active, 1);
      assert.equal(fileBan.ban_hash_version, null);
    });
  } finally {
    migrationDatabase.close();
  }

  const databasePath = join(temporaryRoot, "fixture.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(await readFile(resolve(repositoryRoot, "schema", "d1.sql"), "utf8"));

  await check("canonical schema exposes all key-version columns and indexes", async () => {
    const columns = (table) => new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    assert.ok(columns("versions").has("password_hash_version"));
    assert.ok(columns("post_logs").has("fingerprint_hash_version"));
    assert.ok(columns("bans").has("ban_hash_version"));
    assert.ok(columns("version_withdrawals").has("idempotency_hash_version"));
    assert.ok(columns("version_withdrawals").has("fingerprint_hash_version"));
    assert.ok(columns("delete_requests").has("fingerprint_hash_version"));
    const indexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
    assert.ok(indexes.has("idx_post_logs_fingerprint_version_ip_created"));
    assert.ok(indexes.has("idx_bans_hash_version_type_value_active"));
    assert.ok(indexes.has("idx_version_withdrawals_idempotency_version_hash"));
  });

  await check("legacy rate history is ignored and version 2 history is counted", async () => {
    database.exec("INSERT INTO post_logs (id, action, ip_hash, ua_hash, result, fingerprint_hash_version) VALUES ('legacy', 'create_chart', 'same', 'same', 'accepted', 1), ('current', 'create_chart', 'same', 'same', 'accepted', 2)");
    const row = database.prepare("SELECT COUNT(*) AS count FROM post_logs WHERE ip_hash = 'same' AND fingerprint_hash_version = 2").get();
    assert.equal(Number(row.count), 1);
  });

  await check("legacy hash BAN does not match while version 2 BAN does", async () => {
    database.exec("INSERT INTO bans (id, ban_type, ban_value, reason, active, ban_hash_version) VALUES ('legacy-ban', 'ip_hash', 'legacy-value', 'fixture', 1, 1), ('current-ban', 'ip_hash', 'current-value', 'fixture', 1, 2)");
    const legacy = database.prepare("SELECT COUNT(*) AS count FROM bans WHERE active = 1 AND ban_hash_version = 2 AND ban_value = 'legacy-value'").get();
    const current = database.prepare("SELECT COUNT(*) AS count FROM bans WHERE active = 1 AND ban_hash_version = 2 AND ban_value = 'current-value'").get();
    assert.equal(Number(legacy.count), 0);
    assert.equal(Number(current.count), 1);
  });

  await check("preflight blocks legacy pending and processing withdrawals", async () => {
    for (const status of ["pending", "processing"]) {
      const result = evaluateCutoverSnapshot({
        schemaReady: true,
        counts: {
          legacy_withdrawal_pending_count: status === "pending" ? 1 : 0,
          legacy_withdrawal_processing_count: status === "processing" ? 1 : 0
        },
        secretNames: REQUIRED_SECRET_NAMES,
        legacySecretReferenceCount: 0
      });
      assert.equal(result.outcome, "SECURITY_HASH_CUTOVER_BLOCKED_ACTIVE_WITHDRAWALS");
    }
  });

  await check("preflight returns fixed schema, secret, and legacy-reference outcomes", async () => {
    const base = {
      counts: { legacy_withdrawal_pending_count: 0, legacy_withdrawal_processing_count: 0 },
      secretNames: REQUIRED_SECRET_NAMES,
      legacySecretReferenceCount: 0
    };
    assert.equal(evaluateCutoverSnapshot({ ...base, schemaReady: false }).outcome, "SECURITY_HASH_CUTOVER_SCHEMA_NOT_READY");
    assert.equal(evaluateCutoverSnapshot({ ...base, schemaReady: true, secretNames: [] }).outcome, "SECURITY_HASH_CUTOVER_SCHEMA_NOT_READY");
    assert.equal(evaluateCutoverSnapshot({ ...base, schemaReady: true, legacySecretReferenceCount: 1 }).outcome, "SECURITY_HASH_CUTOVER_LEGACY_SECRET_REFERENCE");
  });

  await check("terminal legacy withdrawals do not block a ready preflight", async () => {
    const result = evaluateCutoverSnapshot({
      schemaReady: true,
      counts: {
        legacy_withdrawal_terminal_count: 4,
        legacy_withdrawal_pending_count: 0,
        legacy_withdrawal_processing_count: 0,
        version2_withdrawal_count: 1
      },
      secretNames: REQUIRED_SECRET_NAMES,
      legacySecretReferenceCount: 0
    });
    assert.equal(result.outcome, "SECURITY_HASH_CUTOVER_READY");
  });

  await check("local preflight prints counts without reading hash values", async () => {
    const result = inspectLocalDatabase(databasePath, REQUIRED_SECRET_NAMES);
    assert.equal(result.outcome, "SECURITY_HASH_CUTOVER_READY");
    assert.equal(typeof result.summary.legacy_password_count, "number");
    assert.equal("password_hash" in result.summary, false);
  });

  database.close();
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`security hash domain separation tests: ${passed} checks passed`);
