import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function load(entry) {
  const built = await build({ entryPoints: [resolve(root, entry)], bundle: true,
    format: "esm", platform: "node", target: "node24", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
}
const worker = (await load("src/index.ts")).default;
const { hashPassword, hashAbuseSubject } = await load("src/utils/securityHash.ts");
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
for (const name of (await readdir(resolve(root, "migrations"))).filter(n => n.endsWith(".sql")).sort()) {
  db.exec(await readFile(resolve(root, "migrations", name), "utf8"));
}
let failFinalization = false;
let failReservation = false;
function prepare(sql) {
  const statement = db.prepare(sql);
  let values = [];
  const query = {
    bind(...args) { values = args; return query; },
    async first(column) { const row = statement.get(...values); return column ? row?.[column] ?? null : row ?? null; },
    async all() { return { results: statement.all(...values), success: true }; },
    async run() {
      if (failFinalization && /SET error_code = 'INVALID_PASSWORD'/u.test(sql)) throw new Error("isolated audit-log failure");
      if (failReservation && /Management password verification is pending/u.test(sql)) throw new Error("isolated password reservation failure");
      const value = statement.run(...values);
      return { success: true, meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } };
    }
  };
  return query;
}
const env = { DB: { prepare, async batch(queries) { return Promise.all(queries.map(q => q.run())); } }, FILES: {},
  ALLOWED_ORIGINS: "http://localhost", ABUSE_HASH_SECRET: "isolated-abuse-key",
  PASSWORD_HASH_SECRET: "isolated-password-key", WITHDRAWAL_IDEMPOTENCY_SECRET: "isolated-idempotency-key" };
const validPassword = "isolated-correct-management-password";
const passwordHash = await hashPassword(env.PASSWORD_HASH_SECRET, validPassword);
db.exec("INSERT INTO songs(id,title,artist,normalized_title,normalized_artist) VALUES('rate_song','Rate Test','Tester','rate test','tester'); INSERT INTO charts(id,song_id,chart_name,normalized_chart_name) VALUES('rate_chart','rate_song','Test','test');");
for (const id of ["rate_a", "rate_b", "rate_legacy"]) {
  db.prepare(`INSERT INTO versions(id,chart_id,version_number,branch_path,author,progress,title,artist,file_id,file_name,file_size,file_sha256,r2_key,password_hash,password_hash_version,allow_append,chart_name,normalized_chart_name)
    VALUES(?,'rate_chart',1,?,'Tester',50,'Rate Test','Tester',?,'test.bms',8,?,?,?,?,1,'Test','test')`)
    .run(id, id, `file_${id}`, `sha_${id}`, `test/${id}`, passwordHash, id === "rate_legacy" ? 1 : 2);
}
let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error("External network is forbidden in this test"); };
async function call(path, body, ip = "192.0.2.10", ua = "rate-a") {
  const response = await worker.fetch(new Request(`http://localhost${path}`, { method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json", "CF-Connecting-IP": ip, "User-Agent": ua },
    body: JSON.stringify(body) }), env);
  return { response, status: response.status, body: await response.json() };
}
const wrong = { password: "isolated-wrong-password", idempotencyKey: "isolated-idempotency-key-0001", reason: "isolated reason for local tests" };
function clear() { db.exec("DELETE FROM post_logs; DELETE FROM version_comments;"); }
let passed = 0;
async function check(name, run) { clear(); await run(); passed += 1; console.log(`ok ${passed} - ${name}`); }
try {
  for (const action of ["withdraw", "delete-request", "withdrawal", "withdrawal/cancel"]) {
    await check(`${action}: changing UA cannot reset five failed-password attempts`, async () => {
      for (let i = 0; i < 5; i++) assert.equal((await call(`/api/versions/rate_a/${action}`, wrong, "192.0.2.10", `ua-${i}`)).status, 401);
      const denied = await call(`/api/versions/rate_a/${action}`, wrong, "192.0.2.10", "another-ua");
      assert.equal(denied.status, 429); assert.equal(denied.body.code, "RATE_LIMITED");
      assert.equal(db.prepare("SELECT COUNT(*) n FROM post_logs WHERE error_code = 'INVALID_PASSWORD'").get().n, 5);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM post_logs WHERE error_code = 'PASSWORD_CHECK_PENDING'").get().n, 0);
    });
  }
  await check("password limits are shared across all management endpoints", async () => {
    const routes = ["withdraw", "delete-request", "withdrawal", "withdrawal/cancel", "withdraw"];
    for (const action of routes) assert.equal((await call(`/api/versions/rate_a/${action}`, wrong)).status, 401);
    assert.equal((await call("/api/versions/rate_a/withdrawal/cancel", wrong, "192.0.2.10", "rotated")).status, 429);
  });
  await check("concurrent password checks reserve slots before crypto and admit only five", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call("/api/versions/rate_a/withdraw", wrong, "192.0.2.10", `concurrent-${i}`)));
    assert.equal(results.filter(r => r.status === 401).length, 5);
    assert.equal(results.filter(r => r.status === 429).length, 7);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM post_logs WHERE error_code='INVALID_PASSWORD'").get().n, 5);
  });
  await check("distributed addresses are capped at twenty failures for the same version", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await call("/api/versions/rate_a/withdraw", wrong, `192.0.2.${i + 20}`)).status, 401);
    assert.equal((await call("/api/versions/rate_a/withdraw", wrong, "192.0.2.100")).status, 429);
    assert.equal((await call("/api/versions/rate_b/withdraw", wrong, "192.0.2.100")).status, 401);
  });
  await check("concurrent distributed password checks atomically enforce the target cap", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => call("/api/versions/rate_a/withdraw", wrong, `192.0.2.${i + 20}`, `ua-${i}`)));
    assert.equal(results.filter(r => r.status === 401).length, 20);
    assert.equal(results.filter(r => r.status === 429).length, 10);
  });
  await check("IP failures also count across distinct target versions", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await call(`/api/versions/${i % 2 ? "rate_a" : "rate_b"}/withdraw`, wrong)).status, 401);
    assert.equal((await call("/api/versions/rate_b/withdraw", wrong, "192.0.2.10", "rotated")).status, 429);
  });
  await check("existing audit failures remain enforced regardless of their UA", async () => {
    const ip = await hashAbuseSubject(env.ABUSE_HASH_SECRET, "ip", "192.0.2.10");
    for (let i = 0; i < 5; i++) db.prepare("INSERT INTO post_logs(id,action,version_id,ip_hash,ua_hash,fingerprint_hash_version,result,error_code) VALUES(?,'withdraw_version','rate_a',?,'old-ua',2,'rejected','INVALID_PASSWORD')").run(`old_${i}`, ip);
    assert.equal((await call("/api/versions/rate_a/withdraw", wrong)).status, 429);
  });
  await check("expired failures stop counting", async () => {
    for (let i = 0; i < 5; i++) await call("/api/versions/rate_a/withdraw", wrong);
    db.exec("UPDATE post_logs SET created_at=datetime('now','-11 minutes')");
    assert.equal((await call("/api/versions/rate_a/withdraw", wrong)).status, 401);
  });
  await check("correct and retired passwords release reservations without consuming failure slots", async () => {
    for (let i = 0; i < 7; i++) {
      const correct = await call("/api/versions/rate_a/withdrawal/cancel", { password: validPassword });
      assert.equal(correct.status, 409); assert.equal(correct.body.code, "WITHDRAWAL_NOT_PENDING");
      const legacy = await call("/api/versions/rate_legacy/withdraw", wrong);
      assert.equal(legacy.status, 409); assert.equal(legacy.body.code, "MANAGEMENT_PASSWORD_EXPIRED");
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM post_logs WHERE error_code IN ('INVALID_PASSWORD','PASSWORD_CHECK_PENDING')").get().n, 0);
    assert.equal((await call("/api/versions/rate_a/withdraw", wrong)).status, 401);
  });
  await check("missing versions do not consume password verification reservations", async () => {
    assert.equal((await call("/api/versions/missing/withdraw", wrong)).status, 404);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM post_logs WHERE error_code='PASSWORD_CHECK_PENDING'").get().n, 0);
  });
  await check("failed audit finalization leaves a counted reservation and fails closed", async () => {
    const error = console.error;
    failFinalization = true; console.error = () => {};
    try {
      for (let i = 0; i < 5; i++) assert.equal((await call("/api/versions/rate_a/withdraw", wrong)).status, 401);
      assert.equal((await call("/api/versions/rate_a/withdraw", wrong, "192.0.2.10", "rotated")).status, 429);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM post_logs WHERE error_code='PASSWORD_CHECK_PENDING'").get().n, 5);
    } finally { failFinalization = false; console.error = error; }
  });
  await check("password reservation errors fail closed on both route implementations", async () => {
    const error = console.error;
    failReservation = true; console.error = () => {};
    try {
      for (const action of ["withdraw", "withdrawal/cancel"]) {
        const failed = await call(`/api/versions/rate_a/${action}`, { password: validPassword });
        assert.equal(failed.status, 500);
        assert.equal(failed.body.code, action === "withdraw" ? "WITHDRAW_FAILED" : "WITHDRAWAL_FAILED");
      }
      assert.equal(db.prepare("SELECT COUNT(*) n FROM post_logs WHERE error_code IN ('INVALID_PASSWORD','PASSWORD_CHECK_PENDING')").get().n, 0);
    } finally { failReservation = false; console.error = error; }
  });
  await check("comment limit survives UA changes and target changes, while another IP can post", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await call("/api/versions/rate_a/comments", { body: `comment ${i}` }, "192.0.2.10", `ua-${i}`)).status, 201);
    const denied = await call("/api/versions/rate_b/comments", { body: "fourth" }, "192.0.2.10", "new-ua");
    assert.equal(denied.status, 429); assert.equal(denied.body.code, "VERSION_COMMENT_RATE_LIMITED");
    assert.ok(Number(denied.response.headers.get("Retry-After")) > 0);
    assert.equal((await call("/api/versions/rate_a/comments", { body: "other user" }, "192.0.2.11")).status, 201);
  });
  await check("concurrent comments atomically admit only three", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call("/api/versions/rate_a/comments", { body: `concurrent ${i}` }, "192.0.2.10", `ua-${i}`)));
    assert.equal(results.filter(r => r.status === 201).length, 3);
    assert.equal(results.filter(r => r.status === 429).length, 9);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM version_comments").get().n, 3);
  });
  await check("hourly comment cap survives UA changes and expired ten-minute buckets", async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await call("/api/versions/rate_a/comments", { body: `hourly ${i}` }, "192.0.2.10", `ua-${i}`)).status, 201);
      db.exec("UPDATE version_comments SET created_at=datetime('now','-11 minutes')");
    }
    const denied = await call("/api/versions/rate_a/comments", { body: "eleventh" }, "192.0.2.10", "new-ua");
    assert.equal(denied.status, 429); assert.equal(denied.response.headers.get("Retry-After"), "3600");
    db.exec("UPDATE version_comments SET created_at=datetime('now','-61 minutes')");
    assert.equal((await call("/api/versions/rate_a/comments", { body: "after expiry" })).status, 201);
  });
  assert.equal(networkRequests, 0);
  console.log(`PASS: ${passed} security rate-limit cases; external network requests: ${networkRequests}`);
} finally { globalThis.fetch = originalFetch; db.close(); }
