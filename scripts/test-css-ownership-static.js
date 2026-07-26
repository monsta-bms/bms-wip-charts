"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const productionJsFiles = fs.readdirSync(path.join(root, "docs"))
  .filter((name) => name.endsWith(".js"))
  .sort();
const productionJsAggregate = productionJsFiles
  .map((name) => `${name}\0${read(`docs/${name}`)}`)
  .join("\0");

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

function declarationBlocks(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, "g"))]
    .map((match) => declarations(match[1]));
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

function contrastRatio(first, second) {
  const luminance = (value) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4);
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  };
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
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

check("only the changed R4B2c stylesheet cache keys change", () => {
  assert.match(sources.index, /\.\/branch-tree-list\.css\?v=append-disabled-theme-r4b2c-01/);
  assert.match(sources.index, /\.\/theme\.css\?v=append-disabled-theme-r4b2c-01/);
  assert.equal((sources.index.match(/append-disabled-theme-r4b2c-01/g) || []).length, 2);
  assert.match(sources.index, /\.\/list-ui-refresh\.css\?v=css-cleanup-r4b2a-01/);
  assert.equal((sources.index.match(/css-cleanup-r4b2a-01/g) || []).length, 1);
  assert.doesNotMatch(sources.listHtml, /append-disabled-theme-r4b2c-01|css-cleanup-r4b2a-01/);
});

check("runtime style hashes remain stable", () => {
  assert.equal(sha256(runtimeStyle(sources.favorites)), "ff8f76306c520d22e15244067ec7470568278a20fcf9ac9e4f60cc63210ad6b8");
  assert.equal(sha256(runtimeStyle(sources.progressThumbnail)), "280a1c0a18e3500bfda2f2e45ff58f8f0afcec26467192968f18a3036e2ac1e6");
});

check("protected CSS hashes remain stable", () => {
  const expected = new Map([
    [sources.style, "2cb373b2344a61706e314fcca197939c0a03c864ef93c8e87fcec638b38bd49e"],
    [sources.list, "68f757317cf1b75819a2cbb3589e1563f2e87a7eaffe10cd103c46335e1b3f23"],
    [sources.treePolish, "e0d1cf234c249070294491982088d34812c602e92ccdca7377011d7292e9f4ad"],
    [sources.chartMiniview, "e92980af2dde81ce2051a9216d744d62ee9fbed18e8423f6461296f65791d49c"],
    [sources.management, "d0b09e7e107d9dcaf5830f243761357462e27765bf3d24bfa78aad0a1b81bcb7"],
    [sources.chartDetail, "bcbe6bfe1a77fc0117184b3d5acbd25d8e4c9fc51af990da941b09ded8346b2f"]
  ]);
  expected.forEach((hash, source) => assert.equal(sha256(source), hash));
});

check("R4B2c CSS files match the reviewed semantic-color change", () => {
  assert.equal(sha256(sources.branch), "a88fd0f3003d06540675d8aec54899af4d624d22a3ea7f4f10bf71c87b0add2b");
  assert.equal(sha256(sources.theme), "f65605da3b8e663a29ac089e64248fc875d0420f9e2b453ffcefe4022547d8a3");
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

check("fixed color counts match the reviewed R4B2c totals", () => {
  const expected = new Map([
    ["style", 65], ["branch", 73], ["refresh", 21], ["treePolish", 17],
    ["chartMiniview", 40], ["management", 17], ["chartDetail", 18], ["theme", 180],
    ["favorites", 14], ["progressThumbnail", 7]
  ]);
  expected.forEach((count, name) => assert.equal(fixedColorCount(sources[name]), count, name));
});

check("append-stopped component selector is narrowly owned by branch-tree-list", () => {
  const selector = "button.secondary.append-policy-disabled-button:disabled";
  const rules = rulesFor(sources.branch, selector);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, [
    selector,
    `${selector}:hover`,
    `${selector}:focus-visible`,
    `${selector}:active`
  ]);
  assert.ok(rules[0].selectors.every((value) => value.includes(".append-policy-disabled-button")));
  assert.equal(rules[0].declarations.background, "var(--append-disabled-bg, #eef3f1)");
  assert.equal(rules[0].declarations["border-color"], "var(--append-disabled-border, var(--line, #cfd8d5))");
  assert.equal(rules[0].declarations["box-shadow"], "var(--append-disabled-shadow, none)");
  assert.equal(rules[0].declarations.color, "var(--append-disabled-text, #65716e)");
  assert.equal(rules[0].declarations.cursor, "not-allowed");
  assert.equal(rules[0].declarations.opacity, "1");
  assert.doesNotMatch(JSON.stringify(rules[0].declarations), /#2b3934|#76978b|#9caaa5/i);
  assert.equal(sources.theme.includes(".append-policy-disabled-button"), false);
});

check("append-stopped semantic tokens exist for every theme and meet contrast targets", () => {
  const expectations = [
    ["html[data-theme=\"white\"]", "#eef3f1", "#cfd8d5", "#65716e", "none", "#ffffff"],
    ["html[data-theme=\"default\"]", "#eef3f1", "#aab9b4", "#65716e", "none", "#f0f3f2"],
    ["html[data-theme=\"dark\"]", "#2b3934", "#76978b", "#9caaa5", "inset 0 0 0 1px var(--append-disabled-border)", "#18211e"]
  ];
  for (const [selector, background, border, textColor, shadow, surrounding] of expectations) {
    const rule = rulesFor(sources.theme, selector)[0];
    assert.ok(rule, `${selector} theme rule missing`);
    assert.equal(rule.declarations["--append-disabled-bg"], background);
    assert.equal(rule.declarations["--append-disabled-border"], border);
    assert.equal(rule.declarations["--append-disabled-text"], textColor);
    assert.equal(rule.declarations["--append-disabled-shadow"], shadow);
    assert.ok(contrastRatio(textColor, background) >= 4.5, `${selector} text contrast is below 4.5`);
    if (selector.includes("dark")) {
      assert.notEqual(background, "#eef3f1");
      assert.ok(contrastRatio(border, surrounding) >= 3, "dark append border contrast is below 3");
    }
  }
  for (const token of ["bg", "border", "text", "shadow"]) {
    assert.equal((sources.theme.match(new RegExp(`--append-disabled-${token}:`, "g")) || []).length, 3);
  }
});

check("mobile lifecycle layout belongs to branch-tree-list only", () => {
  const titleBlocks = declarationBlocks(sources.branch, ".version-title-line");
  const badgeGroupBlocks = declarationBlocks(sources.branch, ".version-state-badges");
  assert.equal(titleBlocks.length, 2);
  assert.equal(badgeGroupBlocks.length, 2);
  assert.equal(titleBlocks[0]["align-items"], "center");
  assert.equal(titleBlocks[0]["flex-wrap"], "nowrap");
  assert.equal(titleBlocks[1]["align-items"], "flex-start");
  assert.equal(titleBlocks[1]["flex-wrap"], "wrap");
  assert.equal(badgeGroupBlocks[0].flex, "0 0 auto");
  assert.equal(badgeGroupBlocks[0]["flex-wrap"], "nowrap");
  assert.equal(badgeGroupBlocks[1].flex, "1 1 100%");
  assert.equal(badgeGroupBlocks[1]["flex-wrap"], "wrap");
  assert.equal(badgeGroupBlocks[1]["min-width"], "0");
  const mobileIndex = sources.branch.indexOf("@media (max-width: 640px)");
  assert.ok(mobileIndex >= 0);
  assert.ok(sources.branch.indexOf(".version-title-line", mobileIndex) > mobileIndex);
  assert.ok(sources.branch.indexOf(".version-state-badges", mobileIndex) > mobileIndex);
});

check("lifecycle badge visual ownership remains in version-management-ui", () => {
  const badgeRule = rulesFor(sources.management, ".withdrawal-pending-badge")
    .find((rule) => rule.selectors.includes(".withdrawal-processing-badge") && rule.selectors.includes(".withdrawal-tombstone-badge"));
  assert.ok(badgeRule);
  assert.equal(badgeRule.declarations["font-size"], "0.68rem");
  assert.equal(badgeRule.declarations.padding, "2px 7px");
  assert.equal(badgeRule.declarations["white-space"], "nowrap");
  assert.equal(badgeRule.declarations["border-radius"], "999px");
  const mobileRules = declarationBlocks(sources.branch.slice(sources.branch.indexOf("@media (max-width: 640px)")), ".version-state-badges");
  assert.equal(mobileRules.length, 1);
  assert.deepEqual(Object.keys(mobileRules[0]).sort(), ["flex", "flex-wrap", "min-width"]);
});

check("R4B2b does not use clipping or visual workarounds", () => {
  const mobileSource = sources.branch.slice(sources.branch.indexOf("@media (max-width: 640px)"));
  assert.doesNotMatch(mobileSource, /font-size\s*:|position\s*:\s*absolute|transform\s*:|margin-left\s*:\s*-|overflow\s*:\s*hidden|text-overflow\s*:|white-space\s*:\s*normal/);
});

check("production JavaScript remains byte-for-byte unchanged", () => {
  assert.equal(productionJsFiles.length, 30);
  assert.equal(sha256(productionJsAggregate), "ae1031cf14736bf72464b5a46c41a9175e0ae6cac58c05b412b96c2ed8691f9a");
});

check("resolved and remaining CSS issues are documented accurately", () => {
  for (let index = 1; index <= 3; index += 1) {
    const id = `KNOWN-CSS-00${index}`;
    assert.match(sources.spec, new RegExp(`${id}[^\\n]*修正済み`));
    assert.match(sources.test, new RegExp(`${id}[^\\n]*修正済み`));
  }
  for (let index = 4; index <= 5; index += 1) {
    const id = `KNOWN-CSS-00${index}`;
    assert.match(sources.spec, new RegExp(id));
    assert.match(sources.test, new RegExp(id));
  }
  assert.match(sources.spec, /KNOWN-CSS-004[\s\S]*KNOWN-CSS-005/);
  assert.match(sources.test, /KNOWN-CSS-004[\s\S]*KNOWN-CSS-005/);
});

check("public HTML IDs remain unique", () => {
  duplicateHtmlIds(sources.index, "index.html");
  duplicateHtmlIds(sources.listHtml, "list.html");
});

console.log(`css ownership static tests: ${checks} checks passed`);
