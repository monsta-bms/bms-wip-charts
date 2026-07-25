"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const sources = {
  branch: read("docs/branch-tree-list.css"),
  refresh: read("docs/list-ui-refresh.css"),
  theme: read("docs/theme.css"),
  treePolish: read("docs/tree-progress-polish.css"),
  chartMiniview: read("docs/chart-miniview.css"),
  management: read("docs/version-management-ui.css"),
  chartDetail: read("docs/chart-detail-link.css"),
  style: read("docs/style.css"),
  list: read("docs/list.css"),
  favorites: read("docs/favorites-list.js"),
  progressThumbnail: read("docs/progress-thumbnail-list.js"),
  index: read("docs/index.html"),
  listHtml: read("docs/list.html"),
  spec: read("project-docs/SPEC.md"),
  test: read("project-docs/TEST.md")
};

function declarations(source) {
  return Object.fromEntries(source
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      return separator < 0
        ? [entry, ""]
        : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
    }));
}

function leafRules(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((selector) => selector.trim()).filter(Boolean),
    declarations: declarations(match[2])
  }));
}

function rulesFor(source, selector) {
  return leafRules(source).filter((rule) => rule.selectors.includes(selector));
}

function runtimeStyle(source) {
  const match = source.match(/style\.textContent = `([\s\S]*?)`;\s*document\.head\.appendChild\(style\);/);
  assert.ok(match, "runtime style block must exist");
  return match[1];
}

function stylesheetNames(html) {
  return [...html.matchAll(/<link\s+rel="stylesheet"\s+href="\.\/([^"?]+)(?:\?[^\"]*)?">/g)]
    .map((match) => match[1]);
}

function duplicateHtmlIds(html, label) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], `${label} contains duplicate HTML IDs`);
}

function fixedColorCount(source) {
  return (source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) || []).length;
}

let checks = 0;
function check(name, callback) {
  callback();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

const selector = ".thumbnail-cell .progress-thumbnail";
const branchRules = rulesFor(sources.branch, selector);
const refreshRules = rulesFor(sources.refresh, selector);

check("branch-tree-list is the sole width owner", () => {
  assert.equal(branchRules.length, 1);
  assert.equal(branchRules[0].declarations.width, "100%");
  assert.equal(refreshRules.some((rule) => Object.hasOwn(rule.declarations, "width")), false);
});

check("branch-tree-list is the sole max-width owner", () => {
  assert.equal(branchRules[0].declarations["max-width"], "100%");
  assert.equal(refreshRules.some((rule) => Object.hasOwn(rule.declarations, "max-width")), false);
});

check("the formal selector remains in both ownership layers", () => {
  assert.equal(branchRules.length, 1);
  assert.equal(refreshRules.length, 1);
  assert.equal(refreshRules[0].declarations["min-width"], "0");
});

check("branch sizing values and importance remain stable", () => {
  assert.equal(branchRules[0].declarations.width, "100%");
  assert.equal(branchRules[0].declarations["max-width"], "100%");
  assert.doesNotMatch(branchRules[0].declarations.width, /!important/i);
  assert.doesNotMatch(branchRules[0].declarations["max-width"], /!important/i);
});

check("R4B2a is exactly the reviewed two-declaration removal", () => {
  const currentBlock = `.thumbnail-cell .progress-thumbnail,\n.progress-thumbnail-block .progress-thumbnail {\n  min-width: 0;\n}\n`;
  const beforeBlock = `.thumbnail-cell .progress-thumbnail,\r\n.progress-thumbnail-block .progress-thumbnail {\r\n  max-width: 100%;\r\n  min-width: 0;\r\n  width: 100%;\r\n}\r\n`;
  assert.ok(sources.refresh.includes(currentBlock));
  assert.equal(sha256(sources.refresh.replace(currentBlock, beforeBlock)), "ac0a64bafe535c350302ffa166012f32d03280efe3fe82b6b6148d873ef0f708");
});

check("theme does not override thumbnail width", () => {
  assert.equal(rulesFor(sources.theme, selector).some((rule) => (
    Object.hasOwn(rule.declarations, "width") || Object.hasOwn(rule.declarations, "max-width")
  )), false);
});

check("no media-query duplicate was introduced", () => {
  assert.equal(branchRules.filter((rule) => Object.hasOwn(rule.declarations, "width")).length, 1);
  assert.equal(refreshRules.filter((rule) => Object.hasOwn(rule.declarations, "width")).length, 0);
  assert.equal(refreshRules.filter((rule) => Object.hasOwn(rule.declarations, "max-width")).length, 0);
});

check("runtime styles do not take over thumbnail sizing ownership", () => {
  const runtime = `${runtimeStyle(sources.favorites)}\n${runtimeStyle(sources.progressThumbnail)}`;
  assert.equal(rulesFor(runtime, selector).some((rule) => (
    Object.hasOwn(rule.declarations, "width") || Object.hasOwn(rule.declarations, "max-width")
  )), false);
});

check("index stylesheet order remains stable", () => {
  assert.deepEqual(stylesheetNames(sources.index), [
    "style.css",
    "site-header.css",
    "branch-tree-list.css",
    "list-ui-refresh.css",
    "chart-miniview.css",
    "tree-progress-polish.css",
    "version-management-ui.css",
    "post-form-ui.css",
    "chart-detail-link.css",
    "theme.css"
  ]);
});

check("compact-list stylesheet order remains stable", () => {
  assert.deepEqual(stylesheetNames(sources.listHtml), ["style.css", "site-header.css", "list.css", "theme.css"]);
});

check("only the R4B2a stylesheet cache key changes", () => {
  assert.match(sources.index, /\.\/list-ui-refresh\.css\?v=css-cleanup-r4b2a-01/);
  assert.equal((sources.index.match(/css-cleanup-r4b2a-01/g) || []).length, 1);
  assert.doesNotMatch(sources.listHtml, /css-cleanup-r4b2a-01/);
});

check("runtime style hashes remain stable", () => {
  assert.equal(sha256(runtimeStyle(sources.favorites)), "ff8f76306c520d22e15244067ec7470568278a20fcf9ac9e4f60cc63210ad6b8");
  assert.equal(sha256(runtimeStyle(sources.progressThumbnail)), "280a1c0a18e3500bfda2f2e45ff58f8f0afcec26467192968f18a3036e2ac1e6");
});

check("protected CSS hashes remain stable", () => {
  const expected = new Map([
    [sources.style, "2cb373b2344a61706e314fcca197939c0a03c864ef93c8e87fcec638b38bd49e"],
    [sources.branch, "a0b721e0f55381dfd6f9374ac5ea18363a764b27c76954251132406e061e4968"],
    [sources.list, "68f757317cf1b75819a2cbb3589e1563f2e87a7eaffe10cd103c46335e1b3f23"],
    [sources.theme, "1ad383052779391c123b9a51109514285d224fe2e1edd9c6e321419f35f5b1e5"],
    [sources.treePolish, "e0d1cf234c249070294491982088d34812c602e92ccdca7377011d7292e9f4ad"],
    [sources.chartMiniview, "e92980af2dde81ce2051a9216d744d62ee9fbed18e8423f6461296f65791d49c"]
  ]);
  expected.forEach((hash, source) => assert.equal(sha256(source), hash));
});

check("list-ui-refresh has the reviewed R4B2a hash", () => {
  assert.equal(sha256(sources.refresh), "f630206e0a7ce75150b2305414ff85c6657244bfa0d58965594e29fb372b1d81");
});

check("grid column definitions remain stable", () => {
  assert.equal((sources.branch.match(/--version-grid-columns:/g) || []).length, 2);
  assert.equal((sources.refresh.match(/--version-grid-columns:/g) || []).length, 3);
  assert.equal((sources.treePolish.match(/--version-grid-columns:/g) || []).length, 2);
  assert.equal((sources.management.match(/--version-grid-columns:/g) || []).length, 2);
});

check("action and thumbnail gap values remain stable", () => {
  assert.equal(rulesFor(sources.style, ".version-actions")[0].declarations.gap, "8px");
  assert.equal(rulesFor(sources.branch, ".version-actions")[0].declarations.gap, "6px");
  assert.equal(rulesFor(sources.style, ".progress-thumbnail")[0].declarations.gap, "3px");
  assert.equal(rulesFor(sources.refresh, ".progress-thumbnail")[0].declarations.gap, "5px");
  assert.equal(rulesFor(sources.refresh, ".progress-thumbnail-graph")[0].declarations.gap, "4px");
  assert.equal(rulesFor(sources.treePolish, ".progress-thumbnail-graph")[0].declarations.gap, "14px");
});

check("fixed color counts have not increased", () => {
  const expected = new Map([
    ["style", 65], ["branch", 70], ["refresh", 21], ["treePolish", 17],
    ["chartMiniview", 40], ["management", 17], ["chartDetail", 18], ["theme", 171],
    ["favorites", 14], ["progressThumbnail", 7]
  ]);
  expected.forEach((count, name) => assert.equal(fixedColorCount(sources[name]), count, name));
});

check("all five known CSS issues are documented without being accepted as normal", () => {
  for (let index = 1; index <= 5; index += 1) {
    const id = `KNOWN-CSS-00${index}`;
    assert.match(sources.spec, new RegExp(id));
    assert.match(sources.test, new RegExp(id));
  }
  assert.match(sources.spec, /既知問題を正常仕様として固定しない/);
  assert.match(sources.test, /既知問題を正常仕様として固定しない/);
});

check("public HTML IDs remain unique", () => {
  duplicateHtmlIds(sources.index, "index.html");
  duplicateHtmlIds(sources.listHtml, "list.html");
});

console.log(`css ownership static tests: ${checks} checks passed`);
