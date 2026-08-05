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
  favoriteCss: read("docs/favorites-list.css"),
  progressThumbnail: read("docs/progress-thumbnail-list.js"),
  progressCss: read("docs/progress-thumbnail-list.css"),
  commentCss: read("docs/version-comment-ui.css"),
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

check("R4B2a removal remains intact after the reviewed density patch", () => {
  const currentBlock = `.thumbnail-cell .progress-thumbnail,\n.progress-thumbnail-block .progress-thumbnail {\n  min-width: 0;\n}\n`;
  const beforeBlock = `.thumbnail-cell .progress-thumbnail,\r\n.progress-thumbnail-block .progress-thumbnail {\r\n  max-width: 100%;\r\n  min-width: 0;\r\n  width: 100%;\r\n}\r\n`;
  assert.ok(sources.refresh.includes(currentBlock));
  assert.equal(sha256(sources.refresh.replace(currentBlock, beforeBlock)), "b86d846dc28da3aa5e200f9e5acedb785eaeccae971e54f900788388d6e3cfad");
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

check("progress image CSS does not take over thumbnail sizing ownership", () => {
  assert.equal(rulesFor(sources.progressCss, selector).some((rule) => (
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
    "theme.css",
    "favorites-list.css",
    "progress-thumbnail-list.css",
    "version-comment-ui.css"
  ]);
  const themeIndex = sources.index.indexOf("./theme.css?v=public-ui-refinement-patch-02");
  const favoriteCssIndex = sources.index.indexOf("./favorites-list.css?v=version-comment-progress-01");
  const progressCssIndex = sources.index.indexOf("./progress-thumbnail-list.css?v=progress-style-r4b2f-01");
  const progressScriptIndex = sources.index.indexOf("./progress-thumbnail-list.js?v=progress-style-r4b2f-01");
  const favoriteScriptIndex = sources.index.indexOf("./favorites-list.js?v=completed-parent-access-01");
  assert.ok(themeIndex >= 0 && themeIndex < favoriteCssIndex);
  assert.ok(favoriteCssIndex < progressCssIndex);
  assert.ok(progressCssIndex < sources.index.indexOf("</head>"));
  assert.ok(progressCssIndex < progressScriptIndex);
  assert.ok(favoriteCssIndex < favoriteScriptIndex);
});

check("compact-list stylesheet order includes deletion and comment components", () => {
  assert.deepEqual(stylesheetNames(sources.listHtml), ["style.css", "site-header.css", "list.css", "version-management-ui.css", "theme.css", "version-comment-ui.css"]);
});

check("changed public UI, comment, and progress assets use their release cache keys", () => {
  assert.match(sources.index, /\.\/branch-tree-list\.css\?v=public-list-density-patch-01/);
  assert.match(sources.index, /\.\/chart-detail-link\.css\?v=detail-theme-r4b2e-01/);
  assert.equal((sources.index.match(/detail-theme-r4b2e-01/g) || []).length, 1);
  assert.match(sources.index, /\.\/theme\.css\?v=public-ui-refinement-patch-02/);
  assert.match(sources.index, /\.\/post-form-ui\.css\?v=progress-tooltip-radio-inset-01/);
  assert.match(sources.index, /\.\/progress-thumbnail-list\.css\?v=progress-style-r4b2f-01/);
  assert.match(sources.index, /\.\/progress-thumbnail-list\.js\?v=progress-style-r4b2f-01/);
  assert.equal((sources.index.match(/progress-style-r4b2f-01/g) || []).length, 2);
  assert.match(sources.index, /\.\/favorites-list\.css\?v=version-comment-progress-01/);
  assert.match(sources.index, /\.\/favorites-list\.js\?v=completed-parent-access-01/);
  assert.match(sources.index, /\.\/list-ui-refresh\.css\?v=public-list-density-patch-01/);
  assert.doesNotMatch(sources.listHtml, /progress-style-r4b2f-01|detail-theme-r4b2e-01|favorite-theme-r4b2d-01|css-cleanup-r4b2a-01/);
  assert.equal((sources.index.match(/version-comment-progress-01/g) || []).length, 2);
  assert.equal((sources.index.match(/completed-parent-access-01/g) || []).length, 2);
  assert.match(sources.index, /\.\/app\.js\?v=public-ui-refinement-patch-02/);
  assert.equal((sources.listHtml.match(/version-comment-progress-01/g) || []).length, 0);
  assert.equal((sources.listHtml.match(/completed-parent-access-01/g) || []).length, 1);
  assert.ok((sources.index.match(/public-ui-refinement-patch-02/g) || []).length >= 8);
  assert.ok((sources.listHtml.match(/public-ui-refinement-patch-02/g) || []).length >= 3);
  assert.equal((sources.index.match(/public-list-density-patch-01/g) || []).length, 5);
  assert.equal((sources.listHtml.match(/public-list-density-patch-01/g) || []).length, 5);
});

check("favorite and progress runtime styles are completely removed", () => {
  assert.doesNotMatch(sources.favorites, /injectStyles|favoriteListStyles|createElement\(["']style["']\)|style\.textContent|document\.head\.appendChild\(style\)/);
  assert.doesNotMatch(sources.progressThumbnail, /ensureProgressImageThumbnailStyle|progress-image-thumbnail-style|createElement\(["']style["']\)|style\.textContent|document\.head\.appendChild\(style\)/);
  assert.doesNotMatch(productionJsAggregate, /favoriteListStyles|progress-image-thumbnail-style|createElement\(["']style["']\)|document\.head\.appendChild\(style\)/);
});

check("reviewed CSS hashes remain stable", () => {
  const expected = new Map([
    [sources.style, "e098f16d091b1f56e6ac6fac1a1c52e880d79c3d3f38eff746b6755f605e01db"],
    [sources.list, "8c3ea0fe8aac1353de6de3bfcfe92e74db9644e0ad8375084f5bee8fa230026b"],
    [sources.treePolish, "e0d1cf234c249070294491982088d34812c602e92ccdca7377011d7292e9f4ad"],
    [sources.chartMiniview, "e92980af2dde81ce2051a9216d744d62ee9fbed18e8423f6461296f65791d49c"],
    [sources.management, "3aee0089beb883940c4606974f13842bead6ca4d5e786920e77902e22d5274e2"],
    [sources.commentCss, "677b0820dcf82e4943d4a0927f23e9abfd3a4a75d50656e8794f92af9fee5e3a"]
  ]);
  expected.forEach((hash, source) => assert.equal(sha256(source), hash));
});

check("branch CSS includes the reviewed density action grid", () => {
  assert.equal(sha256(sources.branch), "b95d8b4ea25ed7a76dd51fa19433524fd264b586bff30e60968701022bc2f06c");
});

check("list-ui-refresh has the reviewed density hash", () => {
  assert.equal(sha256(sources.refresh), "b8da58683c9e52c20e0e01c27b070fbedf768c622be564dc7a42fa5dfd5a06ad");
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

check("version comment component owns its dialog and preview styles", () => {
  for (const selector of [
    ".version-comment-dialog",
    ".author-comment-preview",
    ".version-comment-latest-preview",
    ".version-comment-button"
  ]) assert.ok(rulesFor(sources.commentCss, selector).length >= 1, selector);
  assert.match(sources.commentCss, /var\(--surface/);
  assert.match(sources.commentCss, /var\(--text/);
});

check("fixed color counts isolate detail colors in theme tokens", () => {
  const expected = new Map([
    ["style", 68], ["branch", 73], ["refresh", 21], ["treePolish", 17],
    ["chartMiniview", 40], ["management", 12], ["chartDetail", 4], ["theme", 252],
    ["favorites", 0], ["favoriteCss", 0], ["progressThumbnail", 4], ["progressCss", 0]
  ]);
  expected.forEach((count, name) => assert.equal(fixedColorCount(sources[name]), count, name));
});

check("favorite selectors and responsive ownership moved to static CSS", () => {
  for (const selector of [
    "button.favorite-filter-toggle",
    "button.favorite-filter-toggle:hover",
    "button.favorite-filter-toggle:focus-visible",
    "button.favorite-filter-toggle.is-active",
    "button.favorite-version-button",
    "button.favorite-version-button:hover",
    "button.favorite-version-button:focus-visible",
    "button.favorite-version-button.is-favorite",
    ".version-row.is-favorite-version .version-main-label"
  ]) {
    assert.match(sources.favoriteCss, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(rulesFor(sources.favoriteCss, ".list-toolbar").length, 0);
  assert.doesNotMatch(sources.favoriteCss, /\.list-toolbar\s*\{[^}]*\b(?:display|align-items|gap|justify-content)\s*:/s);
  assert.match(sources.favoriteCss, /@media \(max-width: 640px\)[\s\S]*\.list-toolbar button\.favorite-filter-toggle\s*\{\s*width: 100%;\s*\}/);
});

check("favorite static CSS consumes semantic colors only", () => {
  assert.equal(fixedColorCount(sources.favoriteCss), 0);
  const colorDeclarations = leafRules(sources.favoriteCss).flatMap((rule) => Object.entries(rule.declarations)
    .filter(([property]) => /^(?:background|border(?:-color)?|color|outline-color)$/.test(property))
    .map(([, value]) => value));
  assert.ok(colorDeclarations.length >= 12);
  colorDeclarations.forEach((value) => assert.match(value, /^(?:transparent|var\(--[a-z0-9-]+\)|1px solid (?:transparent|var\(--[a-z0-9-]+\)))$/));
});

check("favorite semantic tokens exist for every theme and meet contrast targets", () => {
  const tokens = [
    "filter-bg", "filter-hover-bg", "filter-hover-border", "filter-hover-text",
    "filter-active-bg", "filter-active-border", "filter-active-text", "star-idle-text",
    "star-hover-bg", "star-hover-border", "star-hover-text", "star-active-bg",
    "star-active-border", "star-active-text"
  ];
  tokens.forEach((token) => {
    assert.equal((sources.theme.match(new RegExp(`--favorite-${token}:`, "g")) || []).length, 3, token);
  });
  const expectations = [
    ["html[data-theme=\"white\"]", "#ffffff", "#5a6864", "#fff8e6", "#8a5a00", "#fff4d6", "#7a4b00", "#77838e", "#fff7df"],
    ["html[data-theme=\"default\"]", "#ffffff", "#52635e", "#fff8e6", "#8a5a00", "#fff4d6", "#7a4b00", "#77838e", "#fff7df"],
    ["html[data-theme=\"dark\"]", "#202b27", "#b3c0bb", "#3d321b", "#f2c66d", "#4a3b1d", "#ffe0a0", "#93a29d", "#18211e"]
  ];
  for (const [selector, filterBg, filterText, hoverBg, hoverText, activeBg, activeText, idleStar, starIdleBg] of expectations) {
    const rule = rulesFor(sources.theme, selector)[0];
    assert.ok(rule, `${selector} theme rule missing`);
    assert.equal(rule.declarations["--favorite-filter-bg"], filterBg);
    assert.ok(contrastRatio(filterText, filterBg) >= 4.5, `${selector} filter idle contrast is below 4.5`);
    assert.ok(contrastRatio(hoverText, hoverBg) >= 4.5, `${selector} filter hover contrast is below 4.5`);
    assert.ok(contrastRatio(activeText, activeBg) >= 4.5, `${selector} filter active contrast is below 4.5`);
    assert.ok(contrastRatio(idleStar, starIdleBg) >= 3, `${selector} star idle contrast is below 3`);
    assert.ok(contrastRatio(rule.declarations["--favorite-star-hover-text"], rule.declarations["--favorite-star-hover-bg"]) >= 3);
    assert.ok(contrastRatio(rule.declarations["--favorite-star-active-text"], rule.declarations["--favorite-star-active-bg"]) >= 3);
    if (selector.includes("dark")) {
      assert.notEqual(filterBg, "#ffffff");
      assert.notEqual(idleStar, "#b6c0c9");
    }
  }
});

check("progress image selectors and responsive ownership moved to static CSS", () => {
  const wrapBlocks = declarationBlocks(sources.progressCss, ".progress-thumbnail-image-wrap");
  assert.equal(wrapBlocks.length, 3);
  assert.deepEqual(wrapBlocks[0], {
    "align-items": "center",
    background: "var(--progress-image-bg)",
    border: "1px solid var(--progress-image-border)",
    "border-radius": "6px",
    display: "flex",
    height: "38px",
    "justify-content": "center",
    "max-width": "220px",
    "min-width": "96px",
    overflow: "hidden",
    width: "100%"
  });
  assert.deepEqual(wrapBlocks[1], { "max-width": "100%" });
  assert.deepEqual(wrapBlocks[2], { "max-width": "none", width: "100%" });
  assert.match(sources.progressCss, /@media \(max-width: 640px\)[\s\S]*\.progress-thumbnail-image-wrap/);
  assert.deepEqual(declarationBlocks(sources.progressCss, ".progress-thumbnail-image"), [{
    display: "block",
    height: "100%",
    "object-fit": "contain",
    width: "100%"
  }]);
  assert.deepEqual(declarationBlocks(sources.progressCss, ".thumbnail-cell .progress-thumbnail-image-wrap"), [{
    "max-width": "100%"
  }]);
  assert.deepEqual(declarationBlocks(sources.progressCss, ".progress-thumbnail.is-empty .progress-thumbnail-value"), [{
    color: "var(--progress-image-empty-text)"
  }]);
});

check("progress image CSS consumes semantic colors only", () => {
  assert.equal(fixedColorCount(sources.progressCss), 0);
  assert.equal(rulesFor(sources.progressCss, ".progress-thumbnail-image-wrap")[0].declarations.background, "var(--progress-image-bg)");
  assert.equal(rulesFor(sources.progressCss, ".progress-thumbnail-image-wrap")[0].declarations.border, "1px solid var(--progress-image-border)");
  assert.equal(rulesFor(sources.progressCss, ".progress-thumbnail.is-empty .progress-thumbnail-value")[0].declarations.color, "var(--progress-image-empty-text)");
});

check("progress image semantic tokens exist for every theme and meet contrast targets", () => {
  for (const token of ["bg", "border", "empty-text"]) {
    assert.equal((sources.theme.match(new RegExp(`--progress-image-${token}:`, "g")) || []).length, 3, token);
  }
  const expectations = [
    ["html[data-theme=\"white\"]", "#f4f7f9", "#dfe6ec", "#66727f"],
    ["html[data-theme=\"default\"]", "#f4f7f9", "#dfe6ec", "#66727f"],
    ["html[data-theme=\"dark\"]", "#17231f", "#587168", "#b8c7c1"]
  ];
  for (const [selector, background, border, emptyText] of expectations) {
    const themeRule = rulesFor(sources.theme, selector)[0].declarations;
    assert.equal(themeRule["--progress-image-bg"], background);
    assert.equal(themeRule["--progress-image-border"], border);
    assert.equal(themeRule["--progress-image-empty-text"], emptyText);
    assert.ok(contrastRatio(emptyText, background) >= 4.5, `${selector} empty text contrast is below 4.5`);
    if (selector.includes("dark")) {
      assert.notEqual(background, "#f4f7f9");
      assert.ok(contrastRatio(border, background) >= 3, "dark progress image border contrast is below 3");
    }
  }
});

check("detail presentation selectors consume semantic colors", () => {
  const section = rulesFor(sources.chartDetail, ".selected-chart-section")[0].declarations;
  assert.equal(section.background, "var(--detail-section-bg)");
  assert.equal(section["border-block"], "1px solid var(--detail-section-border)");
  assert.equal(rulesFor(sources.chartDetail, ".selected-chart-heading a")[0].declarations.color, "var(--primary-hover)");
  assert.equal(rulesFor(sources.chartDetail, ".recent-chart-all-link")[0].declarations.color, "var(--primary-hover)");
  assert.equal(rulesFor(sources.chartDetail, ".selected-chart-status")[0].declarations.color, "var(--muted)");
  assert.equal(rulesFor(sources.chartDetail, ".selected-chart-status.is-error")[0].declarations.color, "var(--danger)");
  assert.equal(rulesFor(sources.chartDetail, ".selected-chart-status.is-success")[0].declarations.color, "var(--success)");
  assert.equal(rulesFor(sources.chartDetail, ".selected-chart-section .version-row:focus")[0].declarations.outline, "2px solid var(--primary)");
  const target = rulesFor(sources.chartDetail, ".selected-chart-section .version-row.is-detail-target")[0].declarations;
  assert.equal(target.background, "var(--detail-target-bg)");
  assert.equal(target["box-shadow"], "inset 4px 0 0 var(--detail-target-accent), inset 0 0 0 1px var(--detail-target-border)");
  const badge = rulesFor(sources.chartDetail, ".selected-chart-section .version-row.is-detail-target::after")[0].declarations;
  assert.equal(badge.background, "var(--detail-target-badge-bg)");
  assert.equal(badge.border, "1px solid var(--detail-target-border)");
  assert.equal(badge.color, "var(--detail-target-badge-text)");
  assert.equal(sources.theme.includes(".selected-chart-section"), false);
  assert.equal(fixedColorCount(sources.chartDetail), 4);
});

check("detail semantic tokens exist for every theme and meet contrast targets", () => {
  const tokenNames = [
    "section-bg", "section-border", "target-bg", "target-accent", "target-border",
    "target-badge-bg", "target-badge-text"
  ];
  tokenNames.forEach((token) => {
    assert.equal((sources.theme.match(new RegExp(`--detail-${token}:`, "g")) || []).length, 3, token);
  });
  const expectations = [
    ["html[data-theme=\"white\"]", "#f3f8f6", "#b7cbc5", "#e9f6f1", "#23806f", "#6a948a", "#ffffff", "#155f51"],
    ["html[data-theme=\"default\"]", "#f3f8f6", "#b7cbc5", "#e9f6f1", "#23806f", "#6a948a", "#ffffff", "#155f51"],
    ["html[data-theme=\"dark\"]", "#17231f", "#587168", "#203c33", "#63b99b", "#76978b", "#26342f", "#d4e4de"]
  ];
  for (const [selector, sectionBg, sectionBorder, targetBg, targetAccent, targetBorder, badgeBg, badgeText] of expectations) {
    const themeRule = rulesFor(sources.theme, selector)[0].declarations;
    assert.equal(themeRule["--detail-section-bg"], sectionBg);
    assert.equal(themeRule["--detail-section-border"], sectionBorder);
    assert.equal(themeRule["--detail-target-bg"], targetBg);
    assert.equal(themeRule["--detail-target-accent"], targetAccent);
    assert.equal(themeRule["--detail-target-border"], targetBorder);
    assert.equal(themeRule["--detail-target-badge-bg"], badgeBg);
    assert.equal(themeRule["--detail-target-badge-text"], badgeText);
    assert.ok(contrastRatio(themeRule["--primary-hover"], sectionBg) >= 4.5, `${selector} detail link contrast is below 4.5`);
    assert.ok(contrastRatio(themeRule["--muted"], sectionBg) >= 4.5, `${selector} detail status contrast is below 4.5`);
    assert.ok(contrastRatio(themeRule["--danger"], sectionBg) >= 4.5, `${selector} detail error contrast is below 4.5`);
    assert.ok(contrastRatio(themeRule["--success"], sectionBg) >= 4.5, `${selector} detail success contrast is below 4.5`);
    assert.ok(contrastRatio(themeRule["--primary"], targetBg) >= 3, `${selector} detail focus contrast is below 3`);
    assert.ok(contrastRatio(targetAccent, targetBg) >= 3, `${selector} detail accent contrast is below 3`);
    assert.ok(contrastRatio(targetBorder, targetBg) >= 3, `${selector} detail target border contrast is below 3`);
    assert.ok(contrastRatio(badgeText, badgeBg) >= 4.5, `${selector} detail badge text contrast is below 4.5`);
    assert.ok(contrastRatio(targetBorder, badgeBg) >= 3, `${selector} detail badge border contrast is below 3`);
    if (selector.includes("dark")) {
      assert.notEqual(sectionBg, "#f3f8f6");
      assert.notEqual(targetBg, "#e9f6f1");
      assert.notEqual(badgeBg, "#ffffff");
    }
  }
});

check("detail mobile target badge avoids controls without changing row geometry", () => {
  const blocks = declarationBlocks(sources.chartDetail, ".selected-chart-section .version-row.is-detail-target::after");
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].top, "7px");
  assert.equal(blocks[0].right, "8px");
  assert.equal(blocks[1].top, "4px");
  assert.equal(blocks[1].right, "5px");
  assert.deepEqual(blocks[2], { top: "44px" });
  assert.match(sources.chartDetail, /@media \(max-width: 640px\)[\s\S]*\.version-row\.is-detail-target::after\s*\{\s*top: 44px;\s*\}/);
});

check("appended batch boundary remains outside R4B2e", () => {
  assert.equal(rulesFor(sources.chartDetail, ".appended-batch-boundary")[0].declarations.color, "#6f9f93");
  const line = rulesFor(sources.chartDetail, ".appended-batch-boundary::before")[0];
  assert.ok(line.selectors.includes(".appended-batch-boundary::after"));
  assert.equal(line.declarations.background, "#b7d0ca");
  const mark = rulesFor(sources.chartDetail, ".appended-batch-boundary-mark")[0].declarations;
  assert.equal(mark.border, "1px solid #6f9f93");
  assert.equal(mark.background, "#f4f9f7");
});

check("protected CSS hashes match the reviewed implementation", () => {
  assert.equal(sha256(sources.chartDetail), "c45722a66d547ecb51825e67dc3e65cc31413f7820a5d34db8b45eb23dbe0882");
  assert.equal(sha256(sources.theme), "83bc78944b289b21d22131af91c7e78deaa04808f1c62628221194566ba1ef34");
  assert.equal(sha256(sources.progressCss), "24d5a258fb4b737584cd54700544f6c496a8065639120d047ccc80135e1e3304");
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
    ["html[data-theme=\"default\"]", "#eef3f1", "#aab9b4", "#65716e", "none", "#fafbfb"],
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

check("reviewed production JavaScript set includes public review, comment, and progress helpers", () => {
  assert.equal(productionJsFiles.length, 35);
  assert.equal(sha256(sources.progressThumbnail), "e2dbcee8975d7b95341875d1c4962fd2904a81873fd4cf7dbdbe757004a58bb6");
  assert.equal(sha256(productionJsAggregate), "3e9dd13b1cac512b207e770d44d881ca79b4ba3369e49c240a21624db5965294");
});

check("all known CSS issues are documented as resolved", () => {
  for (let index = 1; index <= 5; index += 1) {
    const id = `KNOWN-CSS-00${index}`;
    assert.match(sources.spec, new RegExp(`${id}[^\\n]*修正済み`));
    assert.match(sources.test, new RegExp(`${id}[^\\n]*修正済み`));
  }
  assert.doesNotMatch(sources.spec, /未修正[^\n]*KNOWN-CSS-005|KNOWN-CSS-005[^\n]*未修正/);
  assert.doesNotMatch(sources.test, /未修正[^\n]*KNOWN-CSS-005|KNOWN-CSS-005[^\n]*未修正/);
});

check("public HTML IDs remain unique", () => {
  duplicateHtmlIds(sources.index, "index.html");
  duplicateHtmlIds(sources.listHtml, "list.html");
});

console.log(`css ownership static tests: ${checks} checks passed`);
