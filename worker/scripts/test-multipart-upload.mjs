import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function load(path) {
  const result = await build({ entryPoints: [resolve(root, path)], bundle: true, format: "esm", platform: "node", target: "node22", write: false, logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { parseMultipartUpload, MAX_MULTIPART_UPLOAD_BYTES: MAX } = await load("src/utils/multipartUpload.ts");
const { parseOptionalProgressImage } = await load("src/routes/progressImages.ts");
const { validateUploadFile } = await load("src/utils/fileValidation.ts");
const { analyzeBmsBuffer } = await load("src/utils/bms.ts");
const worker = (await load("src/index.ts")).default;
let passed = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++passed} - ${name}`); }

function exactMultipart(bytes) {
  const start = '--audit\r\nContent-Disposition: form-data; name="padding"\r\n\r\n';
  const end = "\r\n--audit--\r\n";
  return new TextEncoder().encode(start + "x".repeat(bytes - start.length - end.length) + end);
}
function rawRequest(bytes, declaredLength) {
  const state = { read: 0, cancelled: false };
  const stream = new ReadableStream({
    pull(controller) {
      if (state.read === bytes.length) return controller.close();
      const end = Math.min(state.read + 64 * 1024, bytes.length);
      controller.enqueue(bytes.slice(state.read, end));
      state.read = end;
    },
    cancel() { state.cancelled = true; }
  }, { highWaterMark: 0 });
  const headers = { "Content-Type": "multipart/form-data; boundary=audit" };
  if (declaredLength !== undefined) headers["Content-Length"] = String(declaredLength);
  return { request: new Request("http://localhost/api/charts", { method: "POST", headers, body: stream, duplex: "half" }), state };
}
const nativeParse = Response.prototype.formData;
let parserCalls = 0;
Response.prototype.formData = function (...args) { parserCalls++; return nativeParse.apply(this, args); };
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Unexpected external network request in local upload test"); };

const db = new DatabaseSync(":memory:");
for (const name of (await readdir(resolve(root, "migrations"))).filter(name => name.endsWith(".sql")).sort()) db.exec(await readFile(resolve(root, "migrations", name), "utf8"));
function prepare(sql) {
  const statement = db.prepare(sql);
  let values = [];
  const query = {
    bind(...args) { values = args; return query; },
    async first(column) { const row = statement.get(...values); return column ? row?.[column] ?? null : row ?? null; },
    async all() { return { success: true, results: statement.all(...values) }; },
    async run() { const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; }
  };
  return query;
}
const objects = new Map();
const env = {
  DB: { prepare, async batch(queries) { db.exec("BEGIN"); try { const results = []; for (const q of queries) results.push(await q.run()); db.exec("COMMIT"); return results; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
  FILES: { async put(key, bytes) { objects.set(key, bytes); return {}; }, async delete(key) { objects.delete(key); } },
  ALLOWED_ORIGINS: "http://localhost", TURNSTILE_MODE: "observe",
  ABUSE_HASH_SECRET: "local-upload-dummy-abuse-secret", PASSWORD_HASH_SECRET: "local-upload-dummy-password-secret"
};
const bms = "#TITLE Upload Test\n#ARTIST Audit\n#BPM 120\n#00111:01\n#00211:01\n#00311:01\n#00411:01\n";
const analysis = analyzeBmsBuffer(new TextEncoder().encode(bms).buffer);
function progressMap(parentId = "client-placeholder", child = false) {
  const layers = [{ versionId: parentId, color: "#2E8B57", kind: "initial", ranges: [[0, 0]] }];
  if (child) layers.push({ versionId: "child-placeholder", color: "#E39D3C", kind: "followup", ranges: [[1, 1]] });
  return JSON.stringify({ schemaVersion: 2, blockMode: "standardized_measure", firstMeasure: analysis.displayFirstMeasure, lastMeasure: analysis.displayLastMeasure, targetBlockCount: analysis.standardBlocks.length, blocks: analysis.standardBlocks, layers, progress: Math.round((child ? 2 : 1) / analysis.standardBlocks.length * 100) });
}
let sequence = 0;
function formRequest({ image = false, parent, file, fields = {} } = {}) {
  const form = new FormData();
  form.set("file", file ?? new File([bms + `\n*COMMENT ${++sequence}\n`], "audit.bms"));
  for (const [key, value] of Object.entries({ title: "Upload Test", artist: "Audit", chartName: `Audit ${sequence}`, author: "Audit", progress: "25", password: "dummy-password", allowAppend: "true", progressMap: progressMap(parent?.versionId, Boolean(parent)), ...fields })) form.set(key, value);
  if (parent) form.set("parentVersionId", parent.versionId);
  if (image) form.set("progressImage", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "progress.png", { type: "image/png" }));
  const request = new Request(parent ? `http://localhost/api/charts/${parent.chartId}/versions` : "http://localhost/api/charts", { method: "POST", body: form, headers: { Origin: "http://localhost", "CF-Connecting-IP": `192.0.2.${++sequence}`, "User-Agent": "multipart-regression" } });
  request.clone = () => { throw new Error("Upload body must not be cloned"); };
  request.formData = () => { throw new Error("Upload routes must share the bounded FormData"); };
  return request;
}
async function call(request) { const before = parserCalls; const response = await worker.fetch(request, env); return { status: response.status, body: await response.json(), parses: parserCalls - before }; }

try {
  await check("accepts an exact 8 MiB multipart body without Content-Length", async () => {
    const { request } = rawRequest(exactMultipart(MAX));
    const result = await parseMultipartUpload(request);
    assert.equal(result.ok, true);
    assert.ok(result.form.get("padding").length > 6 * 1024 * 1024);
    assert.equal(request.bodyUsed, true);
  });
  await check("actual stream limit rejects missing or forged small Content-Length before parsing", async () => {
    for (const declared of [undefined, 1]) {
      const { request, state } = rawRequest(exactMultipart(MAX + 1), declared);
      const before = parserCalls;
      const result = await parseMultipartUpload(request);
      assert.equal(result.ok, false);
      assert.equal(result.failure.status, 413);
      assert.equal(result.failure.code, "REQUEST_TOO_LARGE");
      assert.equal(parserCalls, before);
      assert.equal(state.cancelled, true);
    }
  });
  await check("declared oversize cancels without reading the body", async () => {
    const { request, state } = rawRequest(exactMultipart(128), MAX + 1);
    const result = await parseMultipartUpload(request);
    assert.equal(result.failure.status, 413);
    assert.equal(state.read, 0);
    assert.equal(state.cancelled, true);
  });
  await check("invalid media type, missing body, and malformed multipart retain INVALID_FORM", async () => {
    for (const request of [new Request("http://localhost", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }), new Request("http://localhost", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=audit" } }), new Request("http://localhost", { method: "POST", body: "malformed", headers: { "Content-Type": "multipart/form-data; boundary=audit" } })]) {
      const result = await parseMultipartUpload(request);
      assert.equal(result.failure.status, 400);
      assert.equal(result.failure.code, "INVALID_FORM");
      for (const key of ["code", "message", "detail"]) assert.equal(typeof result.failure[key], "string");
    }
  });
  await check("individual single-chart and ZIP limits are unchanged", async () => {
    for (const [name, max] of [["chart.bms", 2 * 1024 * 1024], ["chart.zip", 5 * 1024 * 1024]]) {
      assert.equal(validateUploadFile(new File([new Uint8Array(max)], name)).ok, true);
      assert.equal(validateUploadFile(new File([new Uint8Array(max + 1)], name)).code, "FILE_TOO_LARGE");
    }
  });
  await check("optional progress image keeps its one MiB boundary and absence behavior", async () => {
    assert.equal((await parseOptionalProgressImage(new FormData())).value, null);
    const form = new FormData();
    form.set("progressImage", new File([new Uint8Array(1024 * 1024)], "p.png", { type: "image/png" }));
    assert.equal((await parseOptionalProgressImage(form)).ok, true);
    form.set("progressImage", new File([new Uint8Array(1024 * 1024 + 1)], "p.png", { type: "image/png" }));
    assert.equal((await parseOptionalProgressImage(form)).failure.code, "PROGRESS_IMAGE_TOO_LARGE");
  });
  let parent;
  await check("normal create without image writes D1/R2 after exactly one parse", async () => {
    const result = await call(formRequest());
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.parses, 1);
    parent = result.body;
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM versions").get().n, 1);
    assert.equal(objects.size, 1);
  });
  await check("normal create with image writes both files after exactly one parse", async () => {
    const result = await call(formRequest({ image: true, fields: { title: "Another Upload Test" } }));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.parses, 1);
    assert.ok(result.body.progressImage?.url);
    assert.equal(objects.size, 3);
  });
  await check("normal append with image preserves its parent and uses one parse", async () => {
    const result = await call(formRequest({ parent, image: true }));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.parses, 1);
    assert.equal(db.prepare("SELECT parent_version_id FROM versions WHERE id = ?").get(result.body.versionId).parent_version_id, parent.versionId);
    assert.ok(result.body.progressImage?.url);
  });
  await check("oversized multipart is rejected at dispatch with no D1 version or R2 writes", async () => {
    const beforeVersions = db.prepare("SELECT COUNT(*) AS n FROM versions").get().n;
    const beforeObjects = objects.size;
    const { request } = rawRequest(exactMultipart(MAX + 1), 1);
    request.headers.set("Origin", "http://localhost");
    request.headers.set("CF-Connecting-IP", "192.0.2.210");
    const result = await call(request);
    assert.equal(result.status, 413, JSON.stringify(result.body));
    assert.equal(result.body.code, "REQUEST_TOO_LARGE");
    assert.equal(result.parses, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM versions").get().n, beforeVersions);
    assert.equal(objects.size, beforeObjects);
  });
  await check("single-chart oversize under total cap still returns existing FILE_TOO_LARGE", async () => {
    const result = await call(formRequest({ file: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.bms") }));
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.code, "FILE_TOO_LARGE");
    assert.equal(result.parses, 1);
  });
  console.log(`PASS: ${passed} multipart upload checks; in-memory SQLite/R2 only; external requests 0`);
} finally {
  Response.prototype.formData = nativeParse;
  globalThis.fetch = nativeFetch;
  db.close();
}
