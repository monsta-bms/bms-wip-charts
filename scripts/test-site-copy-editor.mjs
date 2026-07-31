import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  applyChanges,
  assertManifest,
  buildExport,
  canonicalJson,
  ENTRY_SEPARATOR,
  inventoryRepository,
  loadManifest,
  parseEditedTxt,
  planApply,
  safeDiagnostic,
  sha256,
  SiteCopyError,
  validateEditedTxt
} from "./site-copy/site-copy-core.mjs";

const CATALOG_ID = "12345678-1234-4abc-8def-1234567890ab";
const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

function write(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bms-site-copy-test-"));
  write(root, "docs/index.html", `<!doctype html>
<html lang="ja"><head><title>BMS文章編集テスト</title></head><body>
<main><h1 id="welcome">ようこそ</h1><label for="query">検索</label><input id="query" placeholder="曲名を入力" aria-label="検索語"></main>
</body></html>
`);
  write(root, "docs/app.js", `const count = 2;
const heading = "最近の投稿";
const status = "読み込み中…";
const summary = \`${"${count}"}件を表示しています\`;
function showError() { return "再試行してください。"; }
`);
  write(root, "worker/src/routes/api.ts", `function route(request, env) {
  return apiError(request, env, 400, "BAD_REQUEST", "入力内容を確認してください。", "Internal detail must stay protected.");
}
`);
  write(root, "worker/src/services/empty.ts", "export const noop = true;\n");
  write(root, "worker/src/utils/difficultyTableHtml.ts", `export const html = \`<main><h1>難易度表</h1><p>全${"${count}"}譜面</p></main>\`;\n`);
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Site Copy Test"], { cwd: root, windowsHide: true });
  execFileSync("git", ["config", "user.email", "site-copy@example.invalid"], { cwd: root, windowsHide: true });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root, windowsHide: true });
  execFileSync("git", ["add", "."], { cwd: root, windowsHide: true });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, windowsHide: true, stdio: "ignore" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const manifest = inventoryRepository(root, CATALOG_ID, head);
  const exported = buildExport(root, manifest, "2026-07-31T00:00:00.000Z");
  return { root, manifest, exported };
}

function removeFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function editEntry(txt, id, edited) {
  const idIndex = txt.indexOf(`ID: ${id}\n`);
  assert.notEqual(idIndex, -1, `missing fixture ID ${id}`);
  const marker = "【編集後】\n";
  const editStart = txt.indexOf(marker, idIndex) + marker.length;
  const editEnd = txt.indexOf(`\n${ENTRY_SEPARATOR}`, editStart);
  assert.ok(editStart >= marker.length && editEnd >= editStart);
  return `${txt.slice(0, editStart)}${edited}${txt.slice(editEnd)}`;
}

function removeEntry(txt, id) {
  const idIndex = txt.indexOf(`ID: ${id}\n`);
  const start = txt.lastIndexOf(`${ENTRY_SEPARATOR}\n`, idIndex);
  const editMarker = txt.indexOf("【編集後】\n", idIndex);
  const endSeparator = txt.indexOf(`\n${ENTRY_SEPARATOR}`, editMarker) + 1;
  const end = endSeparator + ENTRY_SEPARATOR.length + (txt[endSeparator + ENTRY_SEPARATOR.length] === "\n" ? 1 : 0);
  return `${txt.slice(0, start)}${txt.slice(end)}`;
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => error instanceof SiteCopyError && error.code === code);
}

function validate(fixture, txt = fixture.exported.txt, snapshot = fixture.exported.snapshot, rootDir = fixture.root) {
  return validateEditedTxt(txt, snapshot, sha256(canonicalJson(snapshot)), { rootDir });
}

test("export succeeds and excludes API detail", () => {
  const fixture = createFixture();
  try {
    assert.ok(fixture.manifest.entries.length >= 10);
    assert.match(fixture.exported.txt, /入力内容を確認してください。/u);
    assert.doesNotMatch(fixture.exported.txt, /Internal detail must stay protected/u);
  } finally { removeFixture(fixture); }
});

test("unmodified round trip has zero changes", () => {
  const fixture = createFixture();
  try { assert.equal(validate(fixture).changeCount, 0); } finally { removeFixture(fixture); }
});

test("one edited entry applies to one source target", () => {
  const fixture = createFixture();
  try {
    const manifestPath = path.join(fixture.root, "site-copy", "site-copy-manifest.json");
    write(fixture.root, "site-copy/site-copy-manifest.json", canonicalJson(fixture.manifest));
    const entry = fixture.exported.snapshot.entries.find((item) => item.currentValue === "ようこそ");
    const txt = editEntry(fixture.exported.txt, entry.id, "こんにちは");
    const result = validate(fixture, txt);
    assert.equal(result.changeCount, 1);
    applyChanges(fixture.root, result, { manifestPath });
    assert.match(fs.readFileSync(path.join(fixture.root, "docs/index.html"), "utf8"), />こんにちは</u);
    assert.doesNotMatch(fs.readFileSync(path.join(fixture.root, "docs/index.html"), "utf8"), />ようこそ</u);
    const updatedManifest = loadManifest(manifestPath);
    const updatedEntry = updatedManifest.entries.find((item) => item.id === entry.id);
    assert.equal(updatedEntry.sourceValueSha256, sha256("こんにちは"));
    assert.doesNotThrow(() => assertManifest(updatedManifest, fixture.root));
  } finally { removeFixture(fixture); }
});

test("multiple edited entries produce multiple planned targets", () => {
  const fixture = createFixture();
  try {
    const first = fixture.exported.snapshot.entries.find((item) => item.currentValue === "ようこそ");
    const second = fixture.exported.snapshot.entries.find((item) => item.currentValue === "最近の投稿");
    const txt = editEntry(editEntry(fixture.exported.txt, first.id, "こんにちは"), second.id, "新着投稿");
    const result = validate(fixture, txt);
    assert.equal(result.changeCount, 2);
    assert.equal(planApply(fixture.root, result).plannedByFile.size, 2);
  } finally { removeFixture(fixture); }
});

test("LF input is accepted", () => {
  const fixture = createFixture();
  try { assert.equal(validate(fixture, fixture.exported.txt).changeCount, 0); } finally { removeFixture(fixture); }
});

test("CRLF input is accepted", () => {
  const fixture = createFixture();
  try { assert.equal(validate(fixture, fixture.exported.txt.replace(/\n/gu, "\r\n")).changeCount, 0); } finally { removeFixture(fixture); }
});

test("UTF-8 BOM input is accepted", () => {
  const fixture = createFixture();
  try { assert.equal(validate(fixture, `\uFEFF${fixture.exported.txt}`).changeCount, 0); } finally { removeFixture(fixture); }
});

test("duplicate ID is rejected", () => {
  const fixture = createFixture();
  try {
    const [first, second] = fixture.exported.snapshot.entries;
    const txt = fixture.exported.txt.replace(`ID: ${second.id}\n`, `ID: ${first.id}\n`);
    expectCode("SITE_COPY_TXT_DUPLICATE_ID", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("missing ID is rejected", () => {
  const fixture = createFixture();
  try {
    const txt = removeEntry(fixture.exported.txt, fixture.exported.snapshot.entries[0].id);
    expectCode("SITE_COPY_TXT_ENTRY_MISSING", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("unknown ID is rejected", () => {
  const fixture = createFixture();
  try {
    const entry = fixture.exported.snapshot.entries[0];
    const idIndex = fixture.exported.txt.indexOf(`ID: ${entry.id}\n`);
    const blockStart = fixture.exported.txt.lastIndexOf(`${ENTRY_SEPARATOR}\n`, idIndex);
    const editMarker = fixture.exported.txt.indexOf("【編集後】\n", idIndex);
    const blockEnd = fixture.exported.txt.indexOf(`\n${ENTRY_SEPARATOR}`, editMarker) + 1 + ENTRY_SEPARATOR.length;
    const unknownBlock = fixture.exported.txt.slice(blockStart, blockEnd).replace(`ID: ${entry.id}\n`, "ID: UNKNOWN.ENTRY\n");
    const txt = `${fixture.exported.txt}${unknownBlock}\n`;
    expectCode("SITE_COPY_TXT_UNKNOWN_ENTRY", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("metadata change is rejected", () => {
  const fixture = createFixture();
  try {
    const txt = fixture.exported.txt.replace("反映先: PAGES", "反映先: WORKER");
    expectCode("SITE_COPY_TXT_METADATA_CHANGED", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("missing protected token is rejected", () => {
  const fixture = createFixture();
  try {
    const entry = fixture.exported.snapshot.entries.find((item) => item.currentValue.includes("{COUNT}"));
    const txt = editEntry(fixture.exported.txt, entry.id, entry.currentValue.replace("{COUNT}", "件数"));
    expectCode("SITE_COPY_TXT_PROTECTED_TOKEN_MISMATCH", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("extra protected token is rejected", () => {
  const fixture = createFixture();
  try {
    const entry = fixture.exported.snapshot.entries.find((item) => item.currentValue.includes("{COUNT}"));
    const txt = editEntry(fixture.exported.txt, entry.id, `${entry.currentValue}{EXTRA}`);
    expectCode("SITE_COPY_TXT_PROTECTED_TOKEN_MISMATCH", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("empty prohibited entry is rejected", () => {
  const fixture = createFixture();
  try {
    const entry = fixture.exported.snapshot.entries[0];
    expectCode("SITE_COPY_TXT_EMPTY_NOT_ALLOWED", () => validate(fixture, editEntry(fixture.exported.txt, entry.id, "")));
  } finally { removeFixture(fixture); }
});

test("maximum length is enforced", () => {
  const fixture = createFixture();
  try {
    const manifest = structuredClone(fixture.manifest);
    const target = manifest.entries.find((item) => item.sourcePath === "docs/index.html");
    target.maxLength = 3;
    const exported = buildExport(fixture.root, manifest, "2026-07-31T00:00:00.000Z");
    const txt = editEntry(exported.txt, target.id, "四文字です");
    expectCode("SITE_COPY_TXT_LENGTH_EXCEEDED", () => validateEditedTxt(txt, exported.snapshot, sha256(canonicalJson(exported.snapshot)), { rootDir: fixture.root }));
  } finally { removeFixture(fixture); }
});

test("source hash mismatch is rejected", () => {
  const fixture = createFixture();
  try {
    const htmlPath = path.join(fixture.root, "docs/index.html");
    fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, "utf8").replace("ようこそ", "変更済み"), "utf8");
    expectCode("SITE_COPY_SOURCE_BASELINE_MISMATCH", () => validate(fixture));
  } finally { removeFixture(fixture); }
});

test("ambiguous locator is rejected", () => {
  const fixture = createFixture();
  try {
    const entry = fixture.exported.snapshot.entries.find((item) => item.sourcePath === "docs/app.js" && item.locator.role === "string");
    const txt = editEntry(fixture.exported.txt, entry.id, `${entry.currentValue}変更`);
    const result = validate(fixture, txt);
    result.changes[0].entry.locator = {};
    expectCode("SITE_COPY_APPLY_AMBIGUOUS_TARGET", () => planApply(fixture.root, result));
  } finally { removeFixture(fixture); }
});

test("secret candidate export is rejected", () => {
  const fixture = createFixture();
  try {
    const htmlPath = path.join(fixture.root, "docs/index.html");
    fs.appendFileSync(htmlPath, "<p>token=abcdefghijklmnopqrstuvwxyz123456</p>\n", "utf8");
    expectCode("SITE_COPY_EXPORT_SECRET_CANDIDATE", () => inventoryRepository(fixture.root, CATALOG_ID, fixture.manifest.baseCommit));
  } finally { removeFixture(fixture); }
});

test("diagnostic output does not contain sensitive or copy bodies", () => {
  const value = safeDiagnostic({ mode: "dry-run", ids: ["HOME.TEST"], secret: "token=abcdefghijklmnopqrstuvwxyz123456", before: "秘密本文", after: "編集本文" });
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /abcdefghijklmnopqrstuvwxyz|秘密本文|編集本文/u);
});

test("invalid header is rejected", () => {
  const fixture = createFixture();
  try { expectCode("SITE_COPY_TXT_INVALID_HEADER", () => parseEditedTxt(fixture.exported.txt.replace("SITE COPY EDIT v1", "SITE COPY EDIT v2"))); } finally { removeFixture(fixture); }
});

test("catalog mismatch is rejected", () => {
  const fixture = createFixture();
  try {
    const txt = fixture.exported.txt.replace(`CATALOG_ID: ${CATALOG_ID}`, "CATALOG_ID: 00000000-0000-4000-8000-000000000000");
    expectCode("SITE_COPY_TXT_CATALOG_MISMATCH", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("manifest hash mismatch is rejected", () => {
  const fixture = createFixture();
  try {
    const txt = fixture.exported.txt.replace(`MANIFEST_SHA256: ${fixture.exported.manifestSha256}`, `MANIFEST_SHA256: ${"0".repeat(64)}`);
    expectCode("SITE_COPY_TXT_MANIFEST_MISMATCH", () => validate(fixture, txt));
  } finally { removeFixture(fixture); }
});

test("repository manifest has unique fixed IDs and resolvable locators", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = loadManifest(path.join(root, "site-copy", "site-copy-manifest.json"));
  assert.equal(manifest.manualReview.length, 0);
  assert.equal(new Set(manifest.entries.map((entry) => entry.id)).size, manifest.entries.length);
  assert.ok(manifest.entries.every((entry) => /^[A-Z0-9._]+$/u.test(entry.id)));
  assert.doesNotThrow(() => assertManifest(manifest, root));
});

test("repository manifest stores locators and hashes but no copy body", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = loadManifest(path.join(root, "site-copy", "site-copy-manifest.json"));
  assert.ok(manifest.entries.every((entry) => entry.locator && /^[0-9a-f]{64}$/u.test(entry.sourceValueSha256)));
  assert.ok(manifest.entries.every((entry) => !Object.hasOwn(entry, "currentValue") && !Object.hasOwn(entry, "editedValue")));
});

test("public HTML files have no duplicate IDs", () => {
  const root = path.resolve(import.meta.dirname, "..");
  for (const name of fs.readdirSync(path.join(root, "docs")).filter((item) => item.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, "docs", name), "utf8");
    const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gu)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${name} contains a duplicate id`);
  }
});

let passed = 0;
for (const { name, callback } of tests) {
  try {
    await callback();
    passed += 1;
    process.stdout.write(`ok ${passed} - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok ${passed + 1} - ${name}\n${error?.stack ?? error}\n${JSON.stringify(error?.detail ?? {})}\n`);
    process.exitCode = 1;
    break;
  }
}
process.stdout.write(`SITE_COPY_EDITOR_TESTS ${passed}/${tests.length}\n`);
