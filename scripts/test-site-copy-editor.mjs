import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  applyEditedCopies,
  assertManifest,
  buildExport,
  canonicalJson,
  GUIDE_SECTION_IDS,
  initializeManifest,
  loadManifest,
  parseChangelogTxt,
  parseGuideTxt,
  parseUiTxt,
  SiteCopyError,
  validateEditedCopies
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

function guideHtml() {
  return `<!doctype html>
<html lang="ja"><body><main>
  <section data-copy-section="GUIDE_INTRO"><h1>利用ガイド</h1><p>サイトの使い方を案内します。</p></section>
  <section data-copy-section="GUIDE_QUICK_USE"><p class="work-ticket-label">最短手順</p><h2 id="quick-use">すぐに使う</h2><div class="quick-use-grid"><article class="quick-use-item"><h3>新規投稿</h3><ol><li>ファイルを選ぶ</li></ol><a href="./index.html#post">投稿フォーム</a></article><article class="quick-use-item"><h3>続きを作る</h3><ol><li>追記元を選ぶ</li></ol><a href="./list.html">投稿一覧</a></article><article class="quick-use-item"><h3>投稿を探す</h3><ol><li>条件を指定する</li></ol><a href="./list.html">投稿を探す</a></article></div></section>
  <section data-copy-section="GUIDE_FEATURE_INDEX"><h2 id="feature-index">機能索引</h2><nav class="guide-index"><a href="#posting">投稿</a><a href="#progress">進捗</a><a href="#difficulty">難易度表</a><a href="#management">管理</a><a href="#safety">安全性</a></nav></section>
  <section data-copy-section="GUIDE_POSTING"><h2 id="posting">投稿</h2><p><a href="./index.html#post">投稿フォーム</a>から投稿します。</p><ul><li>ファイルを選ぶ</li><li>内容を確認する</li></ul></section>
  <section data-copy-section="GUIDE_PROGRESS"><h2 id="progress">進捗</h2><p><a href="./list.html">投稿一覧</a>で進捗を確認します。</p><ol><li>一覧を開く</li><li>状態を見る</li></ol></section>
  <section data-copy-section="GUIDE_DIFFICULTY"><h2 id="difficulty">難易度表</h2><p><a href="https://bms-wip-charts-worker.monsta3228gsl.workers.dev/difficulty-tables/rc-star">RC★</a>と<a href="https://bms-wip-charts-worker.monsta3228gsl.workers.dev/difficulty-tables/rc-double-star">RC★★</a>を確認できます。</p></section>
  <section data-copy-section="GUIDE_MANAGEMENT"><p class="work-ticket-label">版の管理</p><h2 id="management">管理</h2><div class="guide-info-grid"><article class="guide-info-block"><h3>取り下げ</h3><p>公開を停止します。</p></article><article class="guide-info-block"><h3>削除申請</h3><p>管理者が確認します。</p></article></div><p class="guide-callout">管理用パスワードを保管してください。</p></section>
  <section data-copy-section="GUIDE_SAFETY"><p class="work-ticket-label">安全案内</p><h2 id="safety">安全性</h2><div class="guide-safety-list"><section aria-labelledby="passwordSafetyTitle"><h3 id="passwordSafetyTitle">管理パスワード</h3><p>秘密情報を文章へ入力しないでください。</p></section><section aria-labelledby="sourceInfoTitle"><h3 id="sourceInfoTitle">投稿元情報</h3><p>情報は一般公開しません。</p></section><section aria-labelledby="postingProtectionTitle"><h3 id="postingProtectionTitle">投稿対策</h3><p>連続投稿を制限します。</p></section></div></section>
</main></body></html>
`;
}

function changelogHtml() {
  return `<!doctype html><html lang="ja"><body><main>
  <article class="changelog-entry" data-copy-entry="CHANGELOG_20260802"><p class="changelog-date"><time datetime="2026-08-02">2026/08/02</time></p><div><h2>正式公開</h2><ul><li>サイトを正式公開しました。</li><li>公開前に内容を確認しました。</li></ul></div></article>
  <article class="changelog-entry" data-copy-entry="CHANGELOG_20260731"><p class="changelog-date"><time datetime="2026-07-31">2026/07/31</time></p><div><h2>文章編集</h2><ul><li>案内文を編集しやすくしました。</li></ul></div></article>
</main></body></html>\n`;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bms-site-copy-block-test-"));
  write(root, "docs/index.html", `<!doctype html><html lang="ja"><body><h1 data-copy-key="home-title">BMS差分共有サイト</h1><p data-copy-key="home-description">差分を投稿できます。</p></body></html>\n`);
  write(root, "docs/app.js", `const loadingMessage = "読み込み中…";\n`);
  write(root, "docs/guide.html", guideHtml());
  write(root, "docs/changelog.html", changelogHtml());
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, windowsHide: true, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Site Copy Test"], { cwd: root, windowsHide: true });
  execFileSync("git", ["config", "user.email", "site-copy@example.invalid"], { cwd: root, windowsHide: true });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root, windowsHide: true });
  execFileSync("git", ["add", "."], { cwd: root, windowsHide: true });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, windowsHide: true, stdio: "ignore" });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const definition = {
    manifestVersion: 2,
    catalogId: CATALOG_ID,
    baseCommit: head,
    uiBlocks: [{
      id: "HOME_OVERVIEW",
      title: "トップページ概要",
      fields: [
        { key: "TITLE", label: "見出し", sourcePath: "docs/index.html", sourceType: "HTML_TEXT", locator: { copyKey: "home-title", mode: "INNER_TEXT" }, allowEmpty: false, deploymentTarget: "PAGES" },
        { key: "DESCRIPTION", label: "説明", sourcePath: "docs/index.html", sourceType: "HTML_TEXT", locator: { copyKey: "home-description", mode: "INNER_TEXT" }, allowEmpty: false, deploymentTarget: "PAGES" },
        { key: "LOADING", label: "読込表示", sourcePath: "docs/app.js", sourceType: "JS_LITERAL", matchValue: "読み込み中…", allowEmpty: false, deploymentTarget: "PAGES" }
      ]
    }],
    guideSections: GUIDE_SECTION_IDS.map((id) => ({
      id,
      title: id,
      sourcePath: "docs/guide.html",
      headingId: {
        GUIDE_QUICK_USE: "quick-use",
        GUIDE_FEATURE_INDEX: "feature-index",
        GUIDE_POSTING: "posting",
        GUIDE_PROGRESS: "progress",
        GUIDE_DIFFICULTY: "difficulty",
        GUIDE_MANAGEMENT: "management",
        GUIDE_SAFETY: "safety"
      }[id] ?? null
    })),
    changelogEntries: ["CHANGELOG_20260802", "CHANGELOG_20260731"].map((id) => ({
      id,
      sourcePath: "docs/changelog.html",
      deploymentTarget: "PAGES",
      allowEmpty: false
    })),
    manualReview: []
  };
  const manifest = initializeManifest(root, definition);
  const manifestPath = path.join(root, "site-copy", "site-copy-manifest.json");
  write(root, "site-copy/site-copy-manifest.json", canonicalJson(manifest));
  const exported = buildExport(root, manifest, "2026-07-31T00:00:00.000Z");
  return { root, manifest, manifestPath, exported };
}

function removeFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function editUiField(text, blockId, label, value) {
  const blockStart = text.indexOf(`<!-- BLOCK: ${blockId} -->`);
  assert.notEqual(blockStart, -1);
  const valueStartMarker = `[${label}]\n`;
  const valueStart = text.indexOf(valueStartMarker, blockStart) + valueStartMarker.length;
  const valueEnd = text.indexOf(`\n[/${label}]`, valueStart);
  assert.ok(valueStart >= valueStartMarker.length && valueEnd >= valueStart);
  return `${text.slice(0, valueStart)}${value}${text.slice(valueEnd)}`;
}

function editGuideSection(text, sectionId, markdown) {
  const startMarker = `<!-- SECTION: ${sectionId} -->`;
  const endMarker = `<!-- END SECTION: ${sectionId} -->`;
  const markerStart = text.indexOf(startMarker);
  const contentStart = text.indexOf("\n", markerStart) + 1;
  const contentEnd = text.indexOf(endMarker, contentStart);
  assert.ok(markerStart >= 0 && contentEnd >= contentStart);
  return `${text.slice(0, contentStart)}\n${markdown.trim()}\n\n${text.slice(contentEnd)}`;
}

function removeGuideSection(text, sectionId) {
  const start = text.indexOf(`<!-- SECTION: ${sectionId} -->`);
  const endMarker = `<!-- END SECTION: ${sectionId} -->`;
  const end = text.indexOf(endMarker, start) + endMarker.length;
  return `${text.slice(0, start)}${text.slice(end)}`;
}

function editChangelogEntry(text, entryId, markdown) {
  const startMarker = `<!-- ENTRY: ${entryId} -->`;
  const endMarker = `<!-- END ENTRY: ${entryId} -->`;
  const markerStart = text.indexOf(startMarker);
  const contentStart = text.indexOf("\n", markerStart) + 1;
  const contentEnd = text.indexOf(endMarker, contentStart);
  assert.ok(markerStart >= 0 && contentEnd >= contentStart);
  return `${text.slice(0, contentStart)}\n${markdown.trim()}\n\n${text.slice(contentEnd)}`;
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => error instanceof SiteCopyError && error.code === code);
}

function validate(fixture, uiText = fixture.exported.uiTxt, guideText = fixture.exported.guideTxt, rootDir = fixture.root, changelogText = fixture.exported.changelogTxt) {
  return validateEditedCopies(uiText, guideText, fixture.exported.snapshot, { rootDir, changelogText });
}

test("three practical edit files export without locator or hash metadata", () => {
  const fixture = createFixture();
  try {
    assert.match(fixture.exported.uiTxt, /^# BMS-WIP UI COPY EDIT v1/mu);
    assert.match(fixture.exported.guideTxt, /^# BMS-WIP GUIDE EDIT v1/mu);
    assert.match(fixture.exported.changelogTxt, /^# BMS-WIP CHANGELOG EDIT v1/mu);
    assert.doesNotMatch(`${fixture.exported.uiTxt}${fixture.exported.guideTxt}${fixture.exported.changelogTxt}`, /locator|SHA256|sourcePath|deploymentTarget/iu);
    assert.equal(parseUiTxt(fixture.exported.uiTxt).blocks.length, 1);
    assert.equal(parseGuideTxt(fixture.exported.guideTxt).sections.length, 8);
    assert.equal(parseChangelogTxt(fixture.exported.changelogTxt).entries.length, 2);
  } finally { removeFixture(fixture); }
});

test("unmodified round trip has zero changes", () => {
  const fixture = createFixture();
  try {
    const result = validate(fixture);
    assert.equal(result.uiChangeCount, 0);
    assert.equal(result.guideChangeCount, 0);
    assert.equal(result.changelogChangeCount, 0);
  } finally { removeFixture(fixture); }
});

test("whole changelog entry can be edited", () => {
  const fixture = createFixture();
  try {
    const markdown = "## 2026/08/02\n\n### 正式公開を開始しました\n\n- サイトを正式公開しました。\n- 現在、公開終了の予定はありません。";
    const result = validate(fixture, fixture.exported.uiTxt, fixture.exported.guideTxt, fixture.root, editChangelogEntry(fixture.exported.changelogTxt, "CHANGELOG_20260802", markdown));
    assert.equal(result.changelogChangeCount, 1);
    assert.equal(result.changelogChanges[0].after, `${markdown}\n`);
  } finally { removeFixture(fixture); }
});

test("changelog bullet items can be added and deleted", () => {
  const fixture = createFixture();
  try {
    const before = fixture.exported.snapshot.changelogEntries[0].currentMarkdown;
    const added = editChangelogEntry(fixture.exported.changelogTxt, "CHANGELOG_20260802", `${before.trim()}\n- 追加項目です。`);
    assert.equal(validate(fixture, fixture.exported.uiTxt, fixture.exported.guideTxt, fixture.root, added).changelogChangeCount, 1);
    const deleted = editChangelogEntry(fixture.exported.changelogTxt, "CHANGELOG_20260802", before.replace("\n- 公開前に内容を確認しました。", ""));
    assert.equal(validate(fixture, fixture.exported.uiTxt, fixture.exported.guideTxt, fixture.root, deleted).changelogChangeCount, 1);
  } finally { removeFixture(fixture); }
});

test("changelog ENTRY marker changes are rejected", () => {
  const fixture = createFixture();
  try {
    const edited = fixture.exported.changelogTxt.replaceAll("CHANGELOG_20260802", "CHANGELOG_20260803");
    expectCode("SITE_COPY_GUIDE_SECTION_MISSING", () => validate(fixture, fixture.exported.uiTxt, fixture.exported.guideTxt, fixture.root, edited));
  } finally { removeFixture(fixture); }
});

test("HTML and arbitrary URLs in changelog entries are rejected", () => {
  const fixture = createFixture();
  try {
    const html = editChangelogEntry(fixture.exported.changelogTxt, "CHANGELOG_20260802", "## 2026/08/02\n\n### 正式公開\n\n<script>alert(1)</script>");
    expectCode("SITE_COPY_GUIDE_HTML_FORBIDDEN", () => validate(fixture, fixture.exported.uiTxt, fixture.exported.guideTxt, fixture.root, html));
    const url = editChangelogEntry(fixture.exported.changelogTxt, "CHANGELOG_20260802", "## 2026/08/02\n\n### 正式公開\n\nhttps://example.invalid を参照します。");
    expectCode("SITE_COPY_GUIDE_URL_FORBIDDEN", () => validate(fixture, fixture.exported.uiTxt, fixture.exported.guideTxt, fixture.root, url));
  } finally { removeFixture(fixture); }
});

test("UI block count metadata cannot be changed", () => {
  const fixture = createFixture();
  try {
    const edited = fixture.exported.uiTxt.replace("BLOCK_COUNT: 1", "BLOCK_COUNT: 2");
    expectCode("SITE_COPY_GUIDE_INVALID_HEADER", () => validate(fixture, edited));
  } finally { removeFixture(fixture); }
});

test("UI logical block field can be edited", () => {
  const fixture = createFixture();
  try {
    const result = validate(fixture, editUiField(fixture.exported.uiTxt, "HOME_OVERVIEW", "見出し", "新しい見出し"));
    assert.equal(result.uiChangeCount, 1);
    assert.equal(result.uiFieldChangeCount, 1);
  } finally { removeFixture(fixture); }
});

test("whole guide section can be edited", () => {
  const fixture = createFixture();
  try {
    const markdown = "# 新しい利用ガイド\n\n新しい説明です。\n\n## 補足\n\n- 項目A\n- 項目B";
    const result = validate(fixture, fixture.exported.uiTxt, editGuideSection(fixture.exported.guideTxt, "GUIDE_INTRO", markdown));
    assert.equal(result.guideChangeCount, 1);
    assert.equal(result.guideChanges[0].after, `${markdown}\n`);
  } finally { removeFixture(fixture); }
});

test("guide paragraph can be added", () => {
  const fixture = createFixture();
  try {
    const before = fixture.exported.snapshot.guideSections.find((item) => item.id === "GUIDE_INTRO").currentMarkdown.trim();
    assert.equal(validate(fixture, fixture.exported.uiTxt, editGuideSection(fixture.exported.guideTxt, "GUIDE_INTRO", `${before}\n\n追加の段落です。`)).guideChangeCount, 1);
  } finally { removeFixture(fixture); }
});

test("guide paragraph can be deleted", () => {
  const fixture = createFixture();
  try {
    assert.equal(validate(fixture, fixture.exported.uiTxt, editGuideSection(fixture.exported.guideTxt, "GUIDE_INTRO", "# 利用ガイド")).guideChangeCount, 1);
  } finally { removeFixture(fixture); }
});

test("unordered list item can be added and deleted", () => {
  const fixture = createFixture();
  try {
    const before = fixture.exported.snapshot.guideSections.find((item) => item.id === "GUIDE_POSTING").currentMarkdown;
    const added = editGuideSection(fixture.exported.guideTxt, "GUIDE_POSTING", before.replace("- 内容を確認する", "- 内容を確認する\n- 投稿する"));
    assert.equal(validate(fixture, fixture.exported.uiTxt, added).guideChangeCount, 1);
    const deleted = editGuideSection(fixture.exported.guideTxt, "GUIDE_POSTING", before.replace("\n- 内容を確認する", ""));
    assert.equal(validate(fixture, fixture.exported.uiTxt, deleted).guideChangeCount, 1);
  } finally { removeFixture(fixture); }
});

test("ordered list item can be added and deleted", () => {
  const fixture = createFixture();
  try {
    const before = fixture.exported.snapshot.guideSections.find((item) => item.id === "GUIDE_PROGRESS").currentMarkdown;
    const added = editGuideSection(fixture.exported.guideTxt, "GUIDE_PROGRESS", `${before.trim()}\n1. 詳細を開く`);
    assert.equal(validate(fixture, fixture.exported.uiTxt, added).guideChangeCount, 1);
    const deleted = editGuideSection(fixture.exported.guideTxt, "GUIDE_PROGRESS", before.replace("\n1. 状態を見る", ""));
    assert.equal(validate(fixture, fixture.exported.uiTxt, deleted).guideChangeCount, 1);
  } finally { removeFixture(fixture); }
});

test("small heading can be changed", () => {
  const fixture = createFixture();
  try {
    const before = fixture.exported.snapshot.guideSections.find((item) => item.id === "GUIDE_MANAGEMENT").currentMarkdown;
    const edited = editGuideSection(fixture.exported.guideTxt, "GUIDE_MANAGEMENT", before.replace("## 管理", "### 投稿の管理"));
    assert.equal(validate(fixture, fixture.exported.uiTxt, edited).guideChangeCount, 1);
  } finally { removeFixture(fixture); }
});

test("LINK identifier changes are rejected", () => {
  const fixture = createFixture();
  try {
    const edited = fixture.exported.guideTxt.replace("LINK:LIST", "LINK:POST_FORM");
    expectCode("SITE_COPY_GUIDE_LINK_INVALID", () => validate(fixture, fixture.exported.uiTxt, edited));
  } finally { removeFixture(fixture); }
});

test("missing guide section is rejected", () => {
  const fixture = createFixture();
  try { expectCode("SITE_COPY_GUIDE_SECTION_MISSING", () => validate(fixture, fixture.exported.uiTxt, removeGuideSection(fixture.exported.guideTxt, "GUIDE_SAFETY"))); }
  finally { removeFixture(fixture); }
});

test("unknown guide section is rejected", () => {
  const fixture = createFixture();
  try {
    const extra = "\n<!-- SECTION: GUIDE_UNKNOWN -->\n\n# Unknown\n\n<!-- END SECTION: GUIDE_UNKNOWN -->\n";
    expectCode("SITE_COPY_GUIDE_SECTION_UNKNOWN", () => validate(fixture, fixture.exported.uiTxt, `${fixture.exported.guideTxt}${extra}`));
  } finally { removeFixture(fixture); }
});

test("duplicate guide section is rejected", () => {
  const fixture = createFixture();
  try {
    const parsed = parseGuideTxt(fixture.exported.guideTxt);
    const duplicate = `\n<!-- SECTION: GUIDE_INTRO -->\n\n${parsed.sections[0].markdown}\n<!-- END SECTION: GUIDE_INTRO -->\n`;
    expectCode("SITE_COPY_GUIDE_SECTION_DUPLICATE", () => validate(fixture, fixture.exported.uiTxt, `${fixture.exported.guideTxt}${duplicate}`));
  } finally { removeFixture(fixture); }
});

test("unterminated guide section is rejected", () => {
  const fixture = createFixture();
  try {
    const edited = fixture.exported.guideTxt.replace("<!-- END SECTION: GUIDE_SAFETY -->", "");
    expectCode("SITE_COPY_GUIDE_SECTION_UNTERMINATED", () => validate(fixture, fixture.exported.uiTxt, edited));
  } finally { removeFixture(fixture); }
});

test("HTML in edited copy is rejected", () => {
  const fixture = createFixture();
  try {
    const edited = editGuideSection(fixture.exported.guideTxt, "GUIDE_INTRO", "# 利用ガイド\n\n<script>alert(1)</script>");
    expectCode("SITE_COPY_GUIDE_HTML_FORBIDDEN", () => validate(fixture, fixture.exported.uiTxt, edited));
  } finally { removeFixture(fixture); }
});

test("arbitrary URL in edited copy is rejected", () => {
  const fixture = createFixture();
  try {
    const edited = editGuideSection(fixture.exported.guideTxt, "GUIDE_INTRO", "# 利用ガイド\n\nhttps://example.invalid を開く");
    expectCode("SITE_COPY_GUIDE_URL_FORBIDDEN", () => validate(fixture, fixture.exported.uiTxt, edited));
  } finally { removeFixture(fixture); }
});

test("source baseline mismatch is rejected", () => {
  const fixture = createFixture();
  try {
    const filePath = path.join(fixture.root, "docs", "index.html");
    fs.writeFileSync(filePath, fs.readFileSync(filePath, "utf8").replace("差分を投稿できます。", "別の文章です。"), "utf8");
    expectCode("SITE_COPY_GUIDE_BASELINE_MISMATCH", () => validate(fixture));
  } finally { removeFixture(fixture); }
});

test("changelog source baseline mismatch is rejected", () => {
  const fixture = createFixture();
  try {
    const filePath = path.join(fixture.root, "docs", "changelog.html");
    fs.writeFileSync(filePath, fs.readFileSync(filePath, "utf8").replace("サイトを正式公開しました。", "別の文章です。"), "utf8");
    expectCode("SITE_COPY_GUIDE_BASELINE_MISMATCH", () => validate(fixture));
  } finally { removeFixture(fixture); }
});

test("LF CRLF and UTF-8 BOM inputs are accepted", () => {
  const fixture = createFixture();
  try {
    assert.equal(validate(fixture).guideChangeCount, 0);
    assert.equal(validate(fixture, fixture.exported.uiTxt.replace(/\n/gu, "\r\n"), fixture.exported.guideTxt.replace(/\n/gu, "\r\n")).guideChangeCount, 0);
    assert.equal(validate(fixture, `\uFEFF${fixture.exported.uiTxt}`, `\uFEFF${fixture.exported.guideTxt}`).guideChangeCount, 0);
  } finally { removeFixture(fixture); }
});

test("apply updates UI and guide then refreshes manifest baselines", () => {
  const fixture = createFixture();
  try {
    const ui = editUiField(fixture.exported.uiTxt, "HOME_OVERVIEW", "見出し", "新しい見出し");
    const guide = editGuideSection(fixture.exported.guideTxt, "GUIDE_INTRO", "# 新しい利用ガイド\n\n新しい説明です。");
    const result = validate(fixture, ui, guide);
    const applied = applyEditedCopies(fixture.root, fixture.manifestPath, result);
    assert.equal(applied.uiBlockCount, 1);
    assert.equal(applied.guideSectionCount, 1);
    assert.match(fs.readFileSync(path.join(fixture.root, "docs", "index.html"), "utf8"), /新しい見出し/u);
    assert.match(fs.readFileSync(path.join(fixture.root, "docs", "guide.html"), "utf8"), /新しい利用ガイド/u);
    assert.doesNotThrow(() => assertManifest(fixture.root, loadManifest(fixture.manifestPath)));
  } finally { removeFixture(fixture); }
});

test("apply updates only the selected changelog entry and refreshes its baseline", () => {
  const fixture = createFixture();
  try {
    const beforeOther = fixture.exported.snapshot.changelogEntries[1].currentMarkdown;
    const markdown = "## 2026/08/02\n\n### 正式公開を開始しました\n\n- サイトを正式公開しました。\n- 現在、公開終了の予定はありません。";
    const edited = editChangelogEntry(fixture.exported.changelogTxt, "CHANGELOG_20260802", markdown);
    const result = validate(fixture, fixture.exported.uiTxt, fixture.exported.guideTxt, fixture.root, edited);
    const applied = applyEditedCopies(fixture.root, fixture.manifestPath, result);
    assert.equal(applied.changelogEntryCount, 1);
    const html = fs.readFileSync(path.join(fixture.root, "docs", "changelog.html"), "utf8");
    assert.match(html, /正式公開を開始しました/u);
    assert.match(html, /data-copy-entry="CHANGELOG_20260731"/u);
    const refreshed = loadManifest(fixture.manifestPath);
    assert.doesNotThrow(() => assertManifest(fixture.root, refreshed));
    const exported = buildExport(fixture.root, refreshed);
    assert.equal(exported.snapshot.changelogEntries[1].currentMarkdown, beforeOther);
  } finally { removeFixture(fixture); }
});

test("guide apply preserves quick-use, management, and safety wrappers", () => {
  const fixture = createFixture();
  try {
    let guide = fixture.exported.guideTxt.replace("### 新規投稿", "### 新しい投稿");
    guide = guide.replace("### 取り下げ", "### 取り下げ手順");
    guide = guide.replace("### 管理パスワード", "### パスワード管理");
    const result = validate(fixture, fixture.exported.uiTxt, guide);
    assert.equal(result.guideChangeCount, 3);
    applyEditedCopies(fixture.root, fixture.manifestPath, result);
    const html = fs.readFileSync(path.join(fixture.root, "docs", "guide.html"), "utf8");
    assert.equal((html.match(/class="quick-use-item"/gu) ?? []).length, 3);
    assert.equal((html.match(/class="guide-info-block"/gu) ?? []).length, 2);
    assert.equal((html.match(/class="guide-safety-list"/gu) ?? []).length, 1);
    assert.equal((html.match(/<section aria-labelledby=/gu) ?? []).length, 3);
    assert.equal((html.match(/href="\.\/index\.html#post"|href="\.\/list\.html"/gu) ?? []).length, 5);
    assert.doesNotThrow(() => assertManifest(fixture.root, loadManifest(fixture.manifestPath)));
  } finally { removeFixture(fixture); }
});

test("write failure rolls every file back and removes temporary backup", () => {
  const fixture = createFixture();
  try {
    const uiPath = path.join(fixture.root, "docs", "index.html");
    const guidePath = path.join(fixture.root, "docs", "guide.html");
    const originals = [uiPath, guidePath, fixture.manifestPath].map((item) => fs.readFileSync(item, "utf8"));
    const beforeBackups = new Set(fs.readdirSync(os.tmpdir()).filter((item) => item.startsWith("bms-site-copy-backup-")));
    const ui = editUiField(fixture.exported.uiTxt, "HOME_OVERVIEW", "見出し", "新しい見出し");
    const guide = editGuideSection(fixture.exported.guideTxt, "GUIDE_INTRO", "# 新しい利用ガイド\n\n新しい説明です。");
    const result = validate(fixture, ui, guide);
    expectCode("SITE_COPY_GUIDE_APPLY_FAILED", () => applyEditedCopies(fixture.root, fixture.manifestPath, result, { failAfterWrites: 1 }));
    assert.deepEqual([uiPath, guidePath, fixture.manifestPath].map((item) => fs.readFileSync(item, "utf8")), originals);
    const afterBackups = fs.readdirSync(os.tmpdir()).filter((item) => item.startsWith("bms-site-copy-backup-") && !beforeBackups.has(item));
    assert.deepEqual(afterBackups, []);
  } finally { removeFixture(fixture); }
});

test("repository manifest resolves UI, guide, and changelog definitions", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const manifest = loadManifest(path.join(root, "site-copy", "site-copy-manifest.json"));
  assert.equal(manifest.uiBlocks.length, 15);
  assert.equal(manifest.uiBlocks.reduce((sum, block) => sum + block.fields.length, 0), 85);
  assert.equal(manifest.guideSections.length, 8);
  assert.ok(Array.isArray(manifest.changelogEntries));
  assert.equal(manifest.manualReview.length, 0);
  assert.ok(manifest.uiBlocks.flatMap((block) => block.fields).every((field) => field.deploymentTarget === "PAGES"));
  assert.doesNotThrow(() => assertManifest(root, manifest));
  const exported = buildExport(root, manifest, "2026-07-31T00:00:00.000Z");
  assert.equal(parseChangelogTxt(exported.changelogTxt).entries.length, manifest.changelogEntries.length);
  assert.equal((exported.guideTxt.match(/\(LINK:[A-Z][A-Z0-9_]*\)/gu) ?? []).length, 7);
  for (const id of ["POST_FORM", "LIST", "RC_STAR", "RC_DOUBLE_STAR"]) assert.match(exported.guideTxt, new RegExp(`LINK:${id}`, "u"));
});

test("guide has each data-copy-section exactly once", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const html = fs.readFileSync(path.join(root, "docs", "guide.html"), "utf8");
  const ids = [...html.matchAll(/\bdata-copy-section\s*=\s*["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.deepEqual(ids.sort(), [...GUIDE_SECTION_IDS].sort());
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
process.stdout.write(`SITE_COPY_EDITOR_BLOCK_TESTS ${passed}/${tests.length}\n`);
