"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const branchCss = read("docs/branch-tree-list.css");
const managementCss = read("docs/version-management-ui.css");
const listCss = read("docs/list.css");
const commentCss = read("docs/version-comment-ui.css");
const commentUi = read("docs/version-comment-ui.js");
const treeUi = read("docs/branch-tree-list.js");
const indexHtml = read("docs/index.html");
const listHtml = read("docs/list.html");
const spec = read("project-docs/SPEC.md");
const testDoc = read("project-docs/TEST.md");

let passed = 0;
function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const desktopActions = branchCss.slice(branchCss.indexOf("/* VERSION-ROW-LAYOUT-PATCH-02"));
const compactActions = listCss.slice(listCss.indexOf("/* PUBLIC-COMMENT-ACTION-BALANCE-01 */"));

check("version headings use seven explicit semantic classes", () => {
  for (const suffix of ["version", "difficulty", "author", "progress", "thumbnail", "comment", "actions"]) {
    assert.match(treeUi, new RegExp(`class="version-list-heading-${suffix}"`));
  }
});

check("version headings no longer depend on nth-child placement", () => {
  assert.doesNotMatch(branchCss, /\.version-list-header\s*>\s*:nth-child/);
});

check("header and row share sizing and horizontal geometry", () => {
  assert.match(branchCss, /\.version-list-header,\s*\n\.version-row\.version-tree-row\s*\{[\s\S]*box-sizing:\s*border-box;[\s\S]*column-gap:\s*10px;[\s\S]*grid-template-columns:\s*var\(--version-grid-columns\);[\s\S]*width:\s*100%;/);
  assert.match(branchCss, /\.version-list-header\s*\{[\s\S]*padding:\s*8px 12px;/);
});

check("desktop version actions are a fixed two-row grid", () => {
  assert.match(desktopActions, /display:\s*grid;/);
  assert.match(desktopActions, /"origin download append"\s*\n\s*"comment comment delete"/);
  assert.match(desktopActions, /grid-template-rows:\s*repeat\(2, 32px\);/);
});

check("desktop version actions map every control to a stable area", () => {
  for (const area of ["origin", "download", "append", "comment", "delete"]) {
    assert.match(desktopActions, new RegExp(`grid-area:\\s*${area};`));
  }
});

check("desktop action track has a stable minimum instead of max-content", () => {
  assert.match(managementCss, /minmax\(185px, 0\.8fr\)/);
  assert.doesNotMatch(managementCss.split("\n").slice(0, 5).join("\n"), /max-content/);
});

check("1024 layout reserves thumbnail and comment width", () => {
  assert.match(managementCss, /minmax\(94px, 1fr\) 44px minmax\(52px, \.58fr\) 44px minmax\(170px, \.9fr\) minmax\(220px, 1\.35fr\) minmax\(185px, \.9fr\)/);
});

check("mobile version actions retain the explicit two-column card grid", () => {
  assert.match(desktopActions, /@media \(max-width: 760px\)[\s\S]*"origin download"[\s\S]*"append append"[\s\S]*"comment delete"/);
  assert.match(desktopActions, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

check("compact desktop actions also use the fixed two-row grid", () => {
  assert.match(compactActions, /display:\s*grid;/);
  assert.match(compactActions, /"origin download append"\s*\n\s*"comment comment delete"/);
  assert.match(compactActions, /grid-template-rows:\s*repeat\(2, 32px\);/);
});

check("compact action column is bounded and its field label is removed", () => {
  assert.match(compactActions, /minmax\(185px, 215px\)/);
  assert.match(compactActions, /> \.compact-field-label \{ display: none; \}/);
});

check("compact mobile actions retain 44px two-column controls", () => {
  assert.match(compactActions, /@media \(max-width: 820px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[\s\S]*min-height:\s*44px;/);
});

check("author comment keeps a hidden semantic label", () => {
  assert.match(commentUi, /author-comment-preview-label visually-hidden/);
  assert.match(commentUi, /"投稿者コメント"/);
});

check("latest comment keeps a hidden semantic label", () => {
  assert.match(commentUi, /version-comment-latest-label visually-hidden/);
  assert.match(commentUi, /"最新コメント"/);
});

check("comment decorations are explicitly hidden from assistive technology", () => {
  assert.match(commentUi, /author-comment-preview-icon[\s\S]*quote\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(commentUi, /version-comment-latest-icon[\s\S]*latestIcon\.setAttribute\("aria-hidden", "true"\)/);
});

check("author comment uses quote styling with two fifteen-pixel lines", () => {
  assert.match(commentCss, /\.author-comment-preview\s*\{[\s\S]*border-left:\s*3px solid/);
  assert.match(commentCss, /\.author-comment-preview-text\s*\{[\s\S]*-webkit-line-clamp:\s*2;[\s\S]*font-size:\s*0\.9375rem;[\s\S]*line-height:\s*1\.55;/);
});

check("latest comment uses a bubble and one muted line", () => {
  assert.match(commentCss, /\.version-comment-latest-preview\s*\{[\s\S]*border-top:\s*1px solid/);
  assert.match(commentCss, /\.version-comment-latest-text\s*\{[\s\S]*-webkit-line-clamp:\s*1;[\s\S]*font-size:\s*0\.85rem;[\s\S]*line-height:\s*1\.45;/);
  assert.match(commentCss, /\.version-comment-latest-icon\s*\{/);
});

check("empty comment regions remain collapsed", () => {
  assert.match(commentUi, /container\.hidden = !hasAuthorComment && !hasLatestComment/);
  assert.match(commentCss, /\.author-comment-empty\s*\{\s*display:\s*none;/);
});

check("changed index assets share the patch cache key", () => {
  for (const asset of ["branch-tree-list.css", "version-management-ui.css", "version-comment-ui.css", "version-comment-ui.js", "branch-tree-list.js"]) {
    assert.match(indexHtml, new RegExp(`\\./${asset.replaceAll(".", "\\.")}\\?v=version-row-layout-patch-02`));
  }
});

check("changed list assets share the patch cache key", () => {
  for (const asset of ["list.css", "version-management-ui.css", "version-comment-ui.css", "version-comment-ui.js"]) {
    assert.match(listHtml, new RegExp(`\\./${asset.replaceAll(".", "\\.")}\\?v=version-row-layout-patch-02`));
  }
});

check("specification and test plan record the layout patch", () => {
  assert.match(spec, /## VERSION-ROW-LAYOUT-PATCH-02/);
  assert.match(testDoc, /## VERSION-ROW-LAYOUT-PATCH-02 回帰/);
});

assert.ok(passed >= 20, `expected at least 20 checks, got ${passed}`);
console.log(`VERSION_ROW_LAYOUT_PATCH_TESTS ${passed}/${passed}`);
