"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let passed = 0;

function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function scriptTags(html) {
  return [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)]
    .map((match) => ({ attributes: `${match[1]} ${match[3]}`, src: match[2] }));
}

function duplicateIds(html) {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  return ids.filter((id, index) => ids.indexOf(id) !== index);
}

function runtimeStyle(source) {
  const match = source.match(/style\.textContent = `([\s\S]*?)`;/);
  assert.ok(match, "runtime style block must exist");
  return match[1];
}

function traversalCount(source) {
  return (source.match(/querySelector(?:All)?\(|\.closest\(/g) || []).length;
}

const indexHtml = read("docs/index.html");
const listHtml = read("docs/list.html");
const app = read("docs/app.js");
const branchAppend = read("docs/branch-append-ui.js");
const progressThumbnail = read("docs/progress-thumbnail-list.js");
const branchTree = read("docs/branch-tree-list.js");
const favorites = read("docs/favorites-list.js");
const compactList = read("docs/list.js");
const chartDetail = read("docs/chart-detail-link.js");
const versionManagement = read("docs/version-management-ui.js");
const modelSource = read("docs/version-ui-model.js");
const linkSource = read("docs/version-link-ui.js");
const indexScripts = scriptTags(indexHtml);
const listScripts = scriptTags(listHtml);
const indexSources = indexScripts.map((item) => item.src);
const listSources = listScripts.map((item) => item.src);

check("version model loads before app on index", () => {
  assert.ok(indexSources.indexOf("./version-ui-model.js?v=version-link-ui-r2-01") < indexSources.indexOf("./app.js?v=version-link-ui-r2-01"));
});
check("version model loads before compact list", () => {
  const modelIndex = listSources.indexOf("./version-ui-model.js?v=version-link-ui-r2-01");
  const linkIndex = listSources.indexOf("./version-link-ui.js?v=version-link-ui-r2-01");
  assert.equal(linkIndex, modelIndex + 1);
  assert.ok(linkIndex < listSources.indexOf("./list.js?v=version-link-ui-r2-01"));
});
check("model and link UI precede every index renderer consumer", () => {
  const modelIndex = indexSources.indexOf("./version-ui-model.js?v=version-link-ui-r2-01");
  const linkIndex = indexSources.indexOf("./version-link-ui.js?v=version-link-ui-r2-01");
  const consumers = [
    "./app.js?v=version-link-ui-r2-01",
    "./progress-thumbnail-list.js?v=version-link-ui-r2-01",
    "./branch-append-ui.js?v=version-link-ui-r2-01",
    "./branch-tree-list.js?v=version-link-ui-r2-01",
    "./favorites-list.js?v=version-ui-model-r1-01",
    "./version-management-ui.js?v=withdrawal-lifecycle-16r",
    "./chart-detail-link.js?v=version-ui-model-r1-01"
  ];
  assert.equal(linkIndex, modelIndex + 1);
  consumers.forEach((src) => {
    assert.ok(modelIndex < indexSources.indexOf(src), `${src} must follow model`);
    assert.ok(linkIndex < indexSources.indexOf(src), `${src} must follow link UI`);
  });
});
check("renderer scripts remain classic and synchronous", () => {
  [...indexScripts, ...listScripts]
    .filter((item) => /version-ui-model|version-link-ui|app\.js|progress-thumbnail-list|branch-append-ui|branch-tree-list|favorites-list|version-management-ui|chart-detail-link|list\.js/.test(item.src))
    .forEach((item) => assert.doesNotMatch(item.attributes, /\b(?:type\s*=\s*["']module|defer|async)\b/i));
});
check("renderer capture order remains unchanged", () => {
  const ordered = [
    "./app.js?v=version-link-ui-r2-01",
    "./progress-thumbnail-list.js?v=version-link-ui-r2-01",
    "./branch-append-ui.js?v=version-link-ui-r2-01",
    "./branch-tree-list.js?v=version-link-ui-r2-01",
    "./favorites-list.js?v=version-ui-model-r1-01",
    "./version-management-ui.js?v=withdrawal-lifecycle-16r",
    "./chart-detail-link.js?v=version-ui-model-r1-01"
  ].map((src) => indexSources.indexOf(src));
  assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
});
check("progress final wrapper and zero-delay bridge remain", () => {
  assert.match(progressThumbnail, /const renderChartsWithFinalProgressThumbnails = \(data\) =>/);
  assert.match(progressThumbnail, /window\.setTimeout\(installFinalProgressThumbnailBridge, 0\)/);
});
check("all existing renderCharts assignments remain", () => {
  assert.match(progressThumbnail, /renderCharts = renderChartsWithProgressThumbnails/);
  assert.match(branchAppend, /renderCharts = renderChartsWithAppend/);
  assert.match(branchTree, /renderCharts = renderChartsAsTree/);
  assert.match(favorites, /renderCharts = renderWithFavorites/);
  assert.match(chartDetail, /renderCharts = renderChartsWithSelectedSection/);
});
check("chart detail still captures and temporarily moves shared output", () => {
  assert.match(chartDetail, /const baseRenderCharts = renderCharts/);
  assert.match(chartDetail, /const preservedList = preserveCurrentList\(\)/);
  assert.match(chartDetail, /cardSlot\.appendChild\(renderedCard\)/);
  assert.match(chartDetail, /chartList\.replaceChildren\(preservedList\)/);
});
check("favorites local rerender path remains unchanged", () => {
  assert.match(favorites, /function rerenderLatest\(\)[\s\S]*renderWithFavorites\(latestData\)/);
});
check("mount, observer, and animation scheduling remain", () => {
  assert.match(app, /function mountChartUi\(data, root = chartList, options = \{\}\)/);
  assert.match(progressThumbnail, /new MutationObserver\(\(\) =>/);
  assert.match(progressThumbnail, /window\.requestAnimationFrame\(run\)/);
});
check("public model global has only the requested API", () => {
  assert.match(modelSource, /window\.BmsVersionUiModel = api/);
  const apiMatch = modelSource.match(/return freezeRecord\(\{\s*buildVersionUiModel,\s*normalizeExternalHttpUrl,\s*normalizeWorkerDownloadUrl,\s*normalizeLifecycleState\s*\}\);/);
  assert.ok(apiMatch);
});
check("public link UI global has only the requested API", () => {
  assert.match(linkSource, /window\.BmsVersionLinkUi = api/);
  const apiMatch = linkSource.match(/return Object\.freeze\(\{\s*createOriginLink,\s*createDownloadControl,\s*serializeControl\s*\}\);/);
  assert.ok(apiMatch);
});
check("every requested renderer consumes the shared model", () => {
  [app, branchAppend, progressThumbnail, branchTree, favorites, compactList]
    .forEach((source) => assert.match(source, /buildVersionUiModel|buildSharedVersionUiModel/));
});
check("every link renderer consumes the shared link UI", () => {
  [app, branchAppend, progressThumbnail, branchTree, compactList]
    .forEach((source) => assert.match(source, /BmsVersionLinkUi/));
});
check("URL parser implementations exist only in the shared model", () => {
  assert.match(modelSource, /function normalizeExternalHttpUrl\(value\)/);
  assert.match(modelSource, /function normalizeWorkerDownloadUrl\(value, workerBaseUrl\)/);
  [app, branchAppend, progressThumbnail, compactList]
    .forEach((source) => {
      assert.doesNotMatch(source, /function (?:makeOriginUrl|originUrl|normalizeExternalHttpUrl)\(/);
      assert.doesNotMatch(source, /function (?:makeDownloadUrl|downloadUrl|buildDownloadUrl|buildWorkerDownloadUrl)\(/);
    });
  assert.doesNotMatch(linkSource, /new URL\(|normalizeExternalHttpUrl|normalizeWorkerDownloadUrl/);
});
check("version action class contract remains", () => {
  [app, branchAppend, progressThumbnail].forEach((source) => assert.match(source, /<div class="version-actions">/));
  assert.match(linkSource, /originClass: "version-origin-link"/);
  assert.match(linkSource, /downloadClass: "version-download-control"/);
  assert.match(linkSource, /downloadUnavailableClass: "version-download-control download-disabled"/);
  assert.match(branchAppend, /class="secondary append-version-button"/);
  assert.match(branchTree, /button\.className = "secondary version-management-button"/);
  assert.match(favorites, /button\.className = "favorite-version-button"/);
});
check("origin then download action order remains", () => {
  [app, branchAppend, progressThumbnail].forEach((source) => {
    assert.match(source, /\$\{originControl\}[\s\S]*\$\{downloadControl\}/);
  });
});
check("renderers no longer build independent origin or download anchors", () => {
  [app, branchAppend, progressThumbnail, branchTree, compactList].forEach((source) => {
    assert.doesNotMatch(source, /<a\s+class="(?:version-origin-link|version-download-control|compact-link-control compact-(?:origin|download)-link)/);
  });
});
check("tree link enhancement is idempotent and state replaceable", () => {
  assert.match(branchTree, /function reconcileLinkControl\(/);
  assert.match(branchTree, /existing\?\.outerHTML === desiredHtml/);
  assert.match(branchTree, /existing\.replaceWith\(desired\)/);
  assert.match(branchTree, /actions\.insertBefore\(desired, insertionPoint \|\| null\)/);
  assert.match(branchTree, /existing\?\.remove\(\)/);
  assert.match(branchTree, /enhanceLinkControls\(actions, uiModel, displayVersionLabel\)/);
  assert.match(branchTree, /if \(uiModel\?\.canShowActions !== true\) \{\s*actions\?\.replaceChildren\(\);\s*return;/);
});
check("compact rerender replaces its row markup instead of appending controls", () => {
  assert.match(compactList, /list\.innerHTML = state\.items\.map\(renderRow\)\.join\(""\)/);
});
check("thumbnail and tree selector contract remains", () => {
  assert.match(progressThumbnail, /progress-thumbnail-slot/);
  assert.match(progressThumbnail, /:scope > \.thumbnail-cell, :scope > \.progress-thumbnail-block/);
  assert.match(branchTree, /\.version-row\.version-tree-row/);
  assert.match(branchTree, /:scope > \.version-actions/);
});
check("compact list columns and link classes remain", () => {
  assert.match(compactList, /compact-version-row/);
  assert.match(linkSource, /compact-link-control compact-origin-link/);
  assert.match(linkSource, /compact-link-control compact-download-link/);
  assert.match(linkSource, /compact-link-control compact-download-disabled/);
  assert.match(compactList, /compact-links/);
});
check("HTML IDs remain unique", () => {
  assert.deepEqual(duplicateIds(indexHtml), []);
  assert.deepEqual(duplicateIds(listHtml), []);
});
check("changed renderer cache keys use the R2 version", () => {
  const changedIndexScripts = ["version-ui-model.js", "version-link-ui.js", "app.js", "progress-thumbnail-list.js", "branch-append-ui.js", "branch-tree-list.js"];
  changedIndexScripts.forEach((name) => {
    assert.ok(indexSources.includes(`./${name}?v=version-link-ui-r2-01`), `${name} cache key mismatch`);
  });
  ["version-ui-model.js", "version-link-ui.js", "list.js"].forEach((name) => {
    assert.ok(listSources.includes(`./${name}?v=version-link-ui-r2-01`), `${name} compact cache key mismatch`);
  });
});
check("protected CSS files are byte-for-byte unchanged", () => {
  const expected = new Map([
    ["docs/style.css", "2cb373b2344a61706e314fcca197939c0a03c864ef93c8e87fcec638b38bd49e"],
    ["docs/branch-tree-list.css", "a0b721e0f55381dfd6f9374ac5ea18363a764b27c76954251132406e061e4968"],
    ["docs/list.css", "68f757317cf1b75819a2cbb3589e1563f2e87a7eaffe10cd103c46335e1b3f23"],
    ["docs/theme.css", "1ad383052779391c123b9a51109514285d224fe2e1edd9c6e321419f35f5b1e5"]
  ]);
  expected.forEach((hash, relativePath) => {
    assert.equal(sha256(fs.readFileSync(path.join(root, relativePath))), hash, relativePath);
  });
});
check("runtime style blocks are unchanged", () => {
  assert.equal(sha256(runtimeStyle(favorites)), "ff8f76306c520d22e15244067ec7470568278a20fcf9ac9e4f60cc63210ad6b8");
  assert.equal(sha256(runtimeStyle(progressThumbnail)), "280a1c0a18e3500bfda2f2e45ff58f8f0afcec26467192968f18a3036e2ac1e6");
});
check("R2 does not increase DOM traversal in existing renderers", () => {
  const r1Baseline = new Map([
    [app, 69],
    [branchAppend, 59],
    [progressThumbnail, 24],
    [branchTree, 40],
    [favorites, 16],
    [compactList, 9],
    [chartDetail, 8]
  ]);
  r1Baseline.forEach((count, source) => assert.ok(traversalCount(source) <= count));
  assert.equal(traversalCount(branchTree), 39);
});
check("normal action strings remain unchanged", () => {
  assert.match(branchAppend, />追記投稿<\/button>/);
  assert.match(branchAppend, />追記停止<\/button>/);
  assert.match(branchAppend, />旧形式<\/button>/);
  assert.match(branchAppend, />追記不可<\/button>/);
  assert.match(linkSource, /control\.textContent = "DL"/);
  assert.match(linkSource, /control\.textContent = "DL不可"/);
});
check("missing shared model paths fail closed", () => {
  assert.match(app, /buildVersionUiModel\?\.[\s\S]*\|\| null/);
  assert.match(compactList, /buildVersionUiModel\?\.[\s\S]*\|\| null/);
  assert.match(branchTree, /uiModel\?\.canShowActions !== true/);
  assert.match(favorites, /\?\.favorite\.available === true/);
  [app, branchAppend, progressThumbnail, compactList].forEach((source) => {
    assert.match(source, /canBuildLinks/);
    assert.match(source, /DL不可<\/span>/);
  });
  assert.match(branchTree, /if \(!canBuildLinks\)[\s\S]*existingOrigin\?\.remove\(\)[\s\S]*DL不可/);
});

assert.ok(passed >= 20, `expected at least 20 checks, got ${passed}`);
console.log(`version render pipeline static tests: ${passed} checks passed`);
