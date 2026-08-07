"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildVersionUiModel } = require("../docs/version-ui-model.js");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sources = {
  branchCss: read("docs/branch-tree-list.css"),
  branchJs: read("docs/branch-tree-list.js"),
  commentCss: read("docs/version-comment-ui.css"),
  index: read("docs/index.html"),
  listCss: read("docs/list.css"),
  listHtml: read("docs/list.html"),
  listJs: read("docs/list.js"),
  model: read("docs/version-ui-model.js"),
  sharedCss: read("docs/style.css"),
  changelog: read("docs/changelog.html")
};
let passed = 0;

function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function progress(overrides) {
  const model = buildVersionUiModel({
    id: "version_progress",
    lifecycleStatus: "active",
    handlingMode: null,
    hidden: false,
    downloadBlocked: false,
    allowAppend: true,
    ...overrides
  }, { hasProgressMap: true });
  return model.progress;
}

check("author comment is fourteen-pixel medium text", () => {
  assert.match(sources.commentCss, /\.author-comment-preview-text\s*\{[\s\S]*font-size:\s*0\.875rem;[\s\S]*font-weight:\s*500;[\s\S]*line-height:\s*1\.5;/u);
});
check("author comment remains a two-line clamp", () => assert.match(sources.commentCss, /\.author-comment-preview-text\s*\{[\s\S]*-webkit-line-clamp:\s*2;/u));
check("quote accent is calmer", () => assert.match(sources.commentCss, /\.author-comment-preview\s*\{[\s\S]*border-left:\s*2px solid/u));
check("99 percent never gets the completed tone", () => assert.equal(progress({ progress: 99, completed: true, completedAt: "2026-08-07T00:00:00Z" }).completedTone, false));
check("confirmed completion at 100 gets the completed tone", () => assert.equal(progress({ progress: 100, completed: true, completedAt: "2026-08-07T00:00:00Z" }).completedTone, true));
check("rejected completion at 100 gets the completed tone", () => assert.deepEqual(progress({ progress: 100, isRejected: true }), { value: 100, state: "rejected_completed", completedTone: true }));
check("unconfirmed 100 percent stays incomplete", () => assert.deepEqual(progress({ progress: 100, completed: false, completedAt: null }), { value: 100, state: "incomplete", completedTone: false }));
check("the shared model owns progress presentation", () => assert.match(sources.model, /function getProgressPresentation\(version\)[\s\S]*progress,\s*\n\s*lifecycle,/u));
check("branch tree consumes the shared completion tone", () => assert.match(sources.branchJs, /uiModel\?\.progress\?\.completedTone === true[\s\S]*classList\.toggle\("is-completed", completedProgressTone\)/u));
check("compact list consumes the shared completion tone", () => assert.match(sources.listJs, /uiModel\?\.progress\?\.completedTone === true[\s\S]*progress-pill\$\{completedProgressTone/u));
check("unfinished progress uses the subdued shared tone", () => assert.match(sources.sharedCss, /\.progress-pill\s*\{[\s\S]*color-mix\(in srgb, var\(--primary\) 7%, var\(--surface\)\)[\s\S]*color:\s*var\(--muted\);/u));
check("completed badge uses the shared warning tone", () => assert.match(sources.sharedCss, /\.progress-pill\.is-completed\s*\{[\s\S]*background:\s*var\(--warning-bg\);[\s\S]*color:\s*var\(--warning\);/u));
check("progress heading centers over its pill", () => assert.match(sources.branchCss, /\.version-list-heading-progress\s*\{\s*text-align:\s*center;/u));
check("actions heading is visually centered over the two-row group", () => assert.match(sources.branchCss, /\.version-list-heading-actions\s*\{[\s\S]*padding-inline-end:\s*32px;[\s\S]*text-align:\s*center;/u));
check("semantic heading classes remain explicit", () => assert.doesNotMatch(sources.branchCss, /\.version-list-header\s*>\s*:nth-child/u));
check("compact headings expose six semantic columns", () => {
  for (const suffix of ["date", "chart", "meta", "progress", "comment", "actions"]) {
    assert.match(sources.listHtml, new RegExp(`class="list-heading-${suffix}"`, "u"));
  }
});
check("compact progress and comment are sibling columns", () => {
  assert.doesNotMatch(sources.listJs, /compact-activity-cell/u);
  assert.match(sources.listJs, /<div class="compact-progress"[^\n]*>[\s\S]*<div class="compact-comment"><\/div>/u);
});
check("compact comments receive the expanded flexible track", () => assert.match(sources.listCss, /70px minmax\(360px, 2\.1fr\) minmax\(154px, max-content\)/u));
check("compact actions fill only the narrow shared desktop track", () => assert.match(sources.listCss, /minmax\(154px, max-content\)[\s\S]*\.compact-actions-cell\s*\{[\s\S]*width:\s*100%;/u));
check("compact actions retain exactly two desktop rows", () => assert.match(sources.listCss, /"origin download append"\s*\n\s*"comment comment delete"[\s\S]*grid-template-rows:\s*repeat\(2, 32px\)/u));
check("mobile actions remain two columns and 44 pixels tall", () => assert.match(sources.listCss, /@media \(max-width: 820px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)[\s\S]*min-height:\s*44px;[\s\S]*width:\s*100%;/u));
check("all changed top assets use the touchup cache key", () => {
  for (const asset of ["style.css", "branch-tree-list.css", "version-management-ui.css", "version-comment-ui.css", "version-ui-model.js", "version-comment-ui.js", "branch-tree-list.js"]) {
    assert.match(sources.index, new RegExp(`\\./${asset.replaceAll(".", "\\.")}\\?v=public-ui-touchup-03-patch1`, "u"));
  }
});
check("all changed list assets use the touchup cache key", () => {
  for (const asset of ["style.css", "list.css", "version-management-ui.css", "version-comment-ui.css", "version-ui-model.js", "version-comment-ui.js", "list.js"]) {
    assert.match(sources.listHtml, new RegExp(`\\./${asset.replaceAll(".", "\\.")}\\?v=public-ui-touchup-03-patch1`, "u"));
  }
});
check("changelog records the public touchup without operational details", () => {
  assert.match(sources.changelog, /CHANGELOG_20260807[\s\S]*投稿者コメント[\s\S]*進捗率の色[\s\S]*コメントを広く、操作をコンパクト/u);
  assert.doesNotMatch(sources.changelog, /Pages.*(?:遅延|失敗)|GitHub.*更新され/u);
});

assert.ok(passed >= 24, `expected at least 24 checks, got ${passed}`);
console.log(`PUBLIC_UI_TOUCHUP_TESTS ${passed}/${passed}`);
