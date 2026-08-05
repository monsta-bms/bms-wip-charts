"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isVisible } = require("../docs/progress-map-drag-hint.js");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
let passed = 0;

function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const visibleState = {
  editable: true,
  mapAvailable: true,
  analysisComplete: true,
  paintedCount: 0,
  isDragging: false,
  isRejected: false,
  isCompletionLocked: false,
  hasFailure: false
};

check("hint is visible for an analyzed editable zero-block map", () => {
  assert.equal(isVisible(visibleState), true);
});
check("hint hides after one painted block", () => {
  assert.equal(isVisible({ ...visibleState, paintedCount: 1 }), false);
});
check("hint hides after multiple painted blocks", () => {
  assert.equal(isVisible({ ...visibleState, paintedCount: 20 }), false);
});
check("hint reappears when clearing back to zero", () => {
  assert.equal(isVisible({ ...visibleState, paintedCount: 1 }), false);
  assert.equal(isVisible({ ...visibleState, paintedCount: 0 }), true);
});
check("hint hides while dragging", () => {
  assert.equal(isVisible({ ...visibleState, isDragging: true }), false);
});
check("hint hides for rejected charts", () => {
  assert.equal(isVisible({ ...visibleState, isRejected: true }), false);
});
check("hint hides while completion fill is locked", () => {
  assert.equal(isVisible({ ...visibleState, isCompletionLocked: true }), false);
});
check("hint hides during analysis", () => {
  assert.equal(isVisible({ ...visibleState, analysisComplete: false }), false);
});
check("hint hides when map is unavailable", () => {
  assert.equal(isVisible({ ...visibleState, mapAvailable: false }), false);
});
check("hint hides after analysis failure", () => {
  assert.equal(isVisible({ ...visibleState, hasFailure: true }), false);
});
check("hint hides outside editable mode", () => {
  assert.equal(isVisible({ ...visibleState, editable: false }), false);
});

const index = read("docs/index.html");
const app = read("docs/app.js");
const append = read("docs/branch-append-ui.js");
const style = read("docs/style.css");
const commentUi = read("docs/version-comment-ui.js");
const commentCss = read("docs/version-comment-ui.css");
const tree = read("docs/branch-tree-list.js");
const compact = read("docs/list.js");
const compactHtml = read("docs/list.html");
const compactCss = read("docs/list.css");
const workerRoute = read("worker/src/routes/versionComments.ts");

check("initial and append forms share one hint element and decision helper", () => {
  assert.equal((index.match(/id="progressMapDragHint"/g) || []).length, 1);
  assert.match(app, /BmsProgressMapDragHint\?\.isVisible/);
  assert.match(append, /BmsProgressMapDragHint\?\.isVisible/);
});
check("hint overlay cannot intercept drag coordinates", () => {
  assert.match(style, /\.progress-map-drag-hint\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(style, /\.progress-block-interaction\s*\{[^}]*position:\s*relative/s);
});
check("comment dialog uses native dialog semantics and one shared instance", () => {
  assert.match(commentUi, /createElement\("dialog", "version-comment-dialog"\)/);
  assert.match(commentUi, /aria-labelledby/);
  assert.match(commentUi, /state\.dialog\?\.isConnected/);
  assert.equal((index.match(/version-comment-ui\.js/g) || []).length, 1);
});
check("comment dialog supports Escape, backdrop, focus trap, and focus return", () => {
  assert.match(commentUi, /addEventListener\("cancel"/);
  assert.match(commentUi, /event\.target === dialog/);
  assert.match(commentUi, /trapFocus/);
  assert.match(commentUi, /source\?\.isConnected/);
});
check("comment form enforces 500 code points and blocks duplicate submit", () => {
  assert.match(commentUi, /MAX_BODY_CODE_POINTS = 500/);
  assert.match(commentUi, /if \(state\.submitting \|\| !state\.versionId\) return/);
  assert.match(commentUi, /points\.slice\(0, MAX_BODY_CODE_POINTS\)/);
  assert.match(commentUi, /submit\.disabled = state\.submitting/);
});
check("successful post updates list, count, and latest preview in place", () => {
  assert.match(commentUi, /state\.items\.push\(comment\)/);
  assert.match(commentUi, /updatePublicCommentSummaries\(comment, state\.total\)/);
  assert.match(commentUi, /\.version-comment-count/);
  assert.match(commentUi, /\.version-comment-latest-preview/);
});
check("author comments preserve newlines and long words without HTML execution", () => {
  assert.match(commentCss, /white-space:\s*pre-wrap/);
  assert.match(commentCss, /overflow-wrap:\s*anywhere/);
  assert.match(commentUi, /text\.textContent = body/);
  assert.doesNotMatch(commentUi, /authorComment[^\n]*innerHTML/);
});
check("author comments clamp to two lines and latest previews to one", () => {
  assert.match(commentCss, /\.author-comment-preview-text[\s\S]*-webkit-line-clamp:\s*2/);
  assert.match(commentCss, /\.version-comment-latest-text[\s\S]*-webkit-line-clamp:\s*1/);
  assert.match(commentUi, /container\.hidden = !hasAuthorComment && !hasLatestComment/);
  assert.match(commentUi, /const empty = createElement\("span", "author-comment-empty", "—"\);[\s\S]*empty\.hidden = true/);
  assert.match(commentUi, /scrollHeight > text\.clientHeight/);
});
check("tree and compact rerenders remount the same author-comment component", () => {
  assert.match(tree, /commentUi\.mountAuthorComment/);
  assert.match(compact, /commentUi\.mountAuthorComment/);
  assert.match(tree, /createCommentControl/);
  assert.match(compact, /createCommentControl/);
});
check("compact list exposes the two-stage completed and rejected filters", () => {
  assert.match(compactHtml, /name="compactStatusGroup" value="finished"[^>]*><span>完成済み<\/span>/u);
  assert.match(compactHtml, /name="compactFinishedStatus" value="finished"[^>]*><span data-copy-key="list-status-finished">完成＋没譜面<\/span>/u);
  assert.match(compactHtml, /name="compactFinishedStatus" value="complete"[^>]*><span data-copy-key="list-status-complete">通常完成<\/span>/u);
  assert.match(compactHtml, /name="compactFinishedStatus" value="rejected"[^>]*><span data-copy-key="list-status-rejected">没譜面<\/span>/u);
  assert.match(compact, /validStatuses = new Set\(\["all", "incomplete", "complete", "rejected", "finished"\]\)/u);
});
check("compact list reserves enough desktop width for comment actions", () => {
  assert.match(compactCss, /grid-template-columns:[\s\S]*?64px\s+180px;/u);
  assert.match(commentCss, /\.author-comment-preview,[\s\S]*?max-width:\s*100%[\s\S]*?min-width:\s*0[\s\S]*?width:\s*100%/u);
});
check("comment API maps every required fixed error code", () => {
  for (const code of [
    "VERSION_COMMENT_INVALID_REQUEST",
    "VERSION_COMMENT_BODY_REQUIRED",
    "VERSION_COMMENT_BODY_TOO_LONG",
    "VERSION_COMMENT_VERSION_NOT_FOUND",
    "VERSION_COMMENT_VERSION_UNAVAILABLE",
    "VERSION_COMMENT_RATE_LIMITED",
    "VERSION_COMMENT_POSTING_BLOCKED",
    "VERSION_COMMENT_DB_FAILED"
  ]) assert.match(workerRoute, new RegExp(code));
});
check("comment API never returns fingerprint fields", () => {
  assert.doesNotMatch(workerRoute, /mapComment[\s\S]{0,300}(ipHash|uaHash|fingerprint)/);
  assert.match(workerRoute, /\{ id: string; body: string; createdAt: string \}/);
});
check("comment styling has no runtime style injection", () => {
  assert.doesNotMatch(commentUi, /createElement\(["']style["']\)|\.style\.|setAttribute\(["']style/);
  assert.equal((index.match(/version-comment-ui\.css/g) || []).length, 1);
});

assert.ok(passed >= 23, `expected at least 23 checks, got ${passed}`);
console.log(`version comment and progress hint tests: ${passed} checks passed`);
