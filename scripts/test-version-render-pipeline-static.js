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

function traversalCount(source) {
  return (source.match(/querySelector(?:All)?\(|\.closest\(/g) || []).length;
}

function occurrenceCount(source, pattern) {
  return (source.match(pattern) || []).length;
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
const pipelineSource = read("docs/chart-render-pipeline.js");
const versionManagement = read("docs/version-management-ui.js");
const modelSource = read("docs/version-ui-model.js");
const linkSource = read("docs/version-link-ui.js");
const actionSource = read("docs/version-action-ui.js");
const indexScripts = scriptTags(indexHtml);
const listScripts = scriptTags(listHtml);
const indexSources = indexScripts.map((item) => item.src);
const listSources = listScripts.map((item) => item.src);

check("model, link, action, pipeline, and app load in contract order", () => {
  const ordered = [
    "./version-ui-model.js?v=completed-parent-access-01",
    "./version-link-ui.js?v=public-ui-refinement-01",
    "./version-action-ui.js?v=public-ui-refinement-01",
    "./chart-render-pipeline.js?v=chart-render-pipeline-r4a-01",
    "./app.js?v=submission-status-admin-correction-01"
  ].map((src) => indexSources.indexOf(src));
  assert.ok(ordered.every((index) => index >= 0));
  assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
});
check("version model loads before compact list", () => {
  const modelIndex = listSources.indexOf("./version-ui-model.js?v=completed-parent-access-01");
  const linkIndex = listSources.indexOf("./version-link-ui.js?v=public-ui-refinement-01");
  const actionIndex = listSources.indexOf("./version-action-ui.js?v=public-ui-refinement-01");
  const commentIndex = listSources.indexOf("./version-comment-ui.js?v=version-comment-progress-01");
  assert.equal(linkIndex, modelIndex + 1);
  assert.equal(actionIndex, linkIndex + 1);
  assert.equal(commentIndex, actionIndex + 1);
  assert.ok(commentIndex < listSources.indexOf("./list.js?v=public-ui-refinement-01"));
});
check("model, link UI, and Action UI precede every index renderer consumer", () => {
  const modelIndex = indexSources.indexOf("./version-ui-model.js?v=completed-parent-access-01");
  const linkIndex = indexSources.indexOf("./version-link-ui.js?v=public-ui-refinement-01");
  const actionIndex = indexSources.indexOf("./version-action-ui.js?v=public-ui-refinement-01");
  const consumers = [
    "./chart-render-pipeline.js?v=chart-render-pipeline-r4a-01",
    "./app.js?v=submission-status-admin-correction-01",
    "./progress-thumbnail-list.js?v=progress-style-r4b2f-01",
    "./branch-append-ui.js?v=version-comment-progress-01",
    "./branch-tree-list.js?v=completed-parent-access-01",
    "./favorites-list.js?v=completed-parent-access-01",
    "./version-management-ui.js?v=withdrawal-lifecycle-16r",
    "./chart-detail-link.js?v=chart-render-pipeline-r4a-01"
  ];
  assert.equal(linkIndex, modelIndex + 1);
  assert.equal(actionIndex, linkIndex + 1);
  consumers.forEach((src) => {
    assert.ok(modelIndex < indexSources.indexOf(src), `${src} must follow model`);
    assert.ok(linkIndex < indexSources.indexOf(src), `${src} must follow link UI`);
    assert.ok(actionIndex < indexSources.indexOf(src), `${src} must follow Action UI`);
  });
});
check("renderer scripts remain classic and synchronous", () => {
  [...indexScripts, ...listScripts]
    .filter((item) => /version-ui-model|version-link-ui|version-action-ui|chart-render-pipeline|app\.js|progress-thumbnail-list|branch-append-ui|branch-tree-list|favorites-list|version-management-ui|chart-detail-link|list\.js/.test(item.src))
    .forEach((item) => assert.doesNotMatch(item.attributes, /\b(?:type\s*=\s*["']module|defer|async)\b/i));
});
check("renderCharts facade is assigned exactly once and only by pipeline", () => {
  const assignments = fs.readdirSync(path.join(root, "docs"))
    .filter((name) => name.endsWith(".js"))
    .flatMap((name) => [...read(`docs/${name}`).matchAll(/(?:^|[^.\w])renderCharts\s*=|(?:window|browserWindow)\.renderCharts\s*=/gm)]
      .map(() => name));
  assert.deepEqual(assignments, ["chart-render-pipeline.js"]);
  assert.match(pipelineSource, /browserWindow\.renderCharts = function renderCharts\(data, options\)/);
});
check("renderer capture and wrapper registration are absent", () => {
  const rendererSources = [app, progressThumbnail, branchAppend, branchTree, favorites, chartDetail].join("\n");
  assert.doesNotMatch(rendererSources, /(?:previous|original|base|wrapped|final)RenderCharts\s*=\s*renderCharts/i);
  assert.doesNotMatch(rendererSources, /renderChartsWith(?:SelectedSection|FinalProgressThumbnails)|renderChartsAsTree|renderWithFavorites/);
  assert.doesNotMatch(progressThumbnail, /installFinalProgressThumbnailBridge|setTimeout\([^\n]*ProgressThumbnailBridge/);
  assert.doesNotMatch(rendererSources, /renderChartsLegacy|renderChartsWithProgressThumbnailsLegacy/);
});
check("base and ordered stages are explicitly registered", () => {
  assert.match(branchAppend, /setBaseRenderer\(\{\s*name: "branch-append-base"/);
  assert.match(branchTree, /registerPostRenderStage\(\{\s*name: "tree",\s*order: 100/);
  assert.match(favorites, /registerDataStage\(\{\s*name: "favorites-filter",\s*order: 100/);
  assert.match(favorites, /registerPostRenderStage\(\{\s*name: "favorites",\s*order: 200/);
  assert.match(progressThumbnail, /registerPostRenderStage\(\{\s*name: "stored-progress-thumbnails",\s*order: 300/);
  assert.match(app, /registerMountStage\(\{\s*name: "common-mount",\s*order: 400/);
});
check("chart detail renders directly into its dedicated target", () => {
  assert.match(chartDetail, /BmsChartRenderPipeline\.renderInto\(data, cardSlot/);
  assert.match(chartDetail, /mode: "detail"/);
  assert.match(chartDetail, /suppressFavorites: true/);
  assert.doesNotMatch(chartDetail, /preserveCurrentList|chartList\.replaceChildren|cardSlot\.appendChild\(renderedCard\)/);
});
check("favorites local rerender returns to the full pipeline without duplicate mount", () => {
  const rerender = favorites.match(/function rerenderLatest\(\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  assert.match(rerender, /BmsChartRenderPipeline\.render\(latestData/);
  assert.match(rerender, /source: "favorite-filter"/);
  assert.doesNotMatch(rerender, /mountChartUi|mountFavorites/);
});
check("mount, observer, and animation scheduling remain", () => {
  assert.match(app, /function mountChartUi\(data, root = chartList, options = \{\}\)/);
  assert.match(progressThumbnail, /new MutationObserver\(\(\) =>/);
  assert.match(progressThumbnail, /window\.requestAnimationFrame\(run\)/);
});
check("delegated listeners and observers remain at the R3 counts", () => {
  const expectedListeners = new Map([
    [app, 27],
    [branchAppend, 13],
    [branchTree, 1],
    [favorites, 2],
    [progressThumbnail, 3],
    [chartDetail, 3]
  ]);
  expectedListeners.forEach((count, source) => {
    assert.equal(occurrenceCount(source, /addEventListener\(/g), count);
  });
  assert.equal(occurrenceCount(progressThumbnail, /new MutationObserver\(/g), 1);
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
check("public Action UI global has only the requested API", () => {
  assert.match(actionSource, /window\.BmsVersionActionUi = api/);
  const apiMatch = actionSource.match(/return Object\.freeze\(\{\s*createAppendControl,\s*createManagementControl,\s*createCommentControl,\s*createLifecycleIndicator,\s*replaceControlIfChanged\s*\}\);/);
  assert.ok(apiMatch);
});
check("public pipeline global has only the requested API", () => {
  assert.match(pipelineSource, /browserWindow\.BmsChartRenderPipeline = api/);
  assert.match(pipelineSource, /return Object\.freeze\(\{\s*setBaseRenderer,\s*registerDataStage,\s*registerPostRenderStage,\s*registerMountStage,\s*render,\s*renderInto,\s*getRegisteredStages\s*\}\);/);
});
check("pipeline fixes modes, sources, registration lock, and reentrancy", () => {
  assert.match(pipelineSource, /new Set\(\["replace", "append", "detail"\]\)/);
  ["initial", "reload", "favorite-filter", "append-success", "management-refresh", "load-more", "detail"]
    .forEach((sourceName) => assert.match(pipelineSource, new RegExp(`"${sourceName}"`)));
  assert.match(pipelineSource, /CHART_RENDER_REGISTRATION_LOCKED/);
  assert.match(pipelineSource, /CHART_RENDER_REENTRANT/);
  assert.match(pipelineSource, /activeTargets\.delete\(target\)/);
});
check("load-more uses append mode without moving existing cards", () => {
  const appendBlock = app.slice(app.indexOf("function appendRenderedCharts("), app.indexOf("function rerenderCurrentChartList("));
  assert.match(appendBlock, /mode: "append"/);
  assert.match(appendBlock, /source: "load-more"/);
  assert.match(appendBlock, /renderContext\.renderedNodes/);
  assert.doesNotMatch(appendBlock, /createDocumentFragment|appendChild\(preserved\)|while \(chartList\.firstChild\)/);
  assert.match(branchAppend, /target\.insertAdjacentHTML\("beforeend", markup\)/);
});
check("shared mount disables duplicate favorite and stored-thumbnail work", () => {
  assert.match(app, /mountChartUi\(context\.data, context\.target, \{[\s\S]*applyStoredThumbnails: false,[\s\S]*mountFavorites: false/);
  assert.match(progressThumbnail, /scheduleMount: false/);
  assert.doesNotMatch(chartDetail, /mountChartUi|scheduleProgressImageThumbnailMount|scheduleChartMiniViewMount/);
});
check("existing render events and payload names remain", () => {
  assert.match(app, /new CustomEvent\("chart-ui:mounted"/);
  assert.match(app, /new CustomEvent\("chart-list-load-settled"/);
  assert.match(chartDetail, /new CustomEvent\("chart-detail:rendered"/);
  assert.match(app, /detail: \{\s*root,\s*data: data \|\| null,\s*reason:/);
});
check("unreachable legacy full renderers and their private helpers are removed", () => {
  [app, progressThumbnail].forEach((source) => {
    assert.doesNotMatch(source, /renderChartsLegacy|renderChartsWithProgressThumbnailsLegacy/);
  });
  assert.doesNotMatch(app, /function renderEmpty\(|versionActionUiUnavailableWarned/);
  assert.doesNotMatch(progressThumbnail, /function renderEmptyList\(|function makeVersionUiModel\(/);
});
check("every active model consumer uses the shared model", () => {
  [app, branchAppend, branchTree, favorites, compactList]
    .forEach((source) => assert.match(source, /buildVersionUiModel|buildSharedVersionUiModel/));
});
check("every active link renderer consumes the shared link UI", () => {
  [branchAppend, branchTree, compactList]
    .forEach((source) => assert.match(source, /BmsVersionLinkUi/));
});
check("every active Action renderer consumes the shared Action UI", () => {
  [branchAppend, branchTree, favorites]
    .forEach((source) => assert.match(source, /BmsVersionActionUi/));
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
  assert.match(branchAppend, /<div class="version-actions">/);
  assert.match(linkSource, /originClass: "version-origin-link"/);
  assert.match(linkSource, /downloadClass: "version-download-control"/);
  assert.match(linkSource, /downloadUnavailableClass: "version-download-control download-disabled"/);
  assert.match(actionSource, /button\.className = "secondary append-version-button"/);
  assert.match(actionSource, /button\.className = "secondary version-management-button"/);
  assert.match(favorites, /button\.className = "favorite-version-button"/);
});
check("origin then download action order remains", () => {
  assert.match(branchAppend, /\$\{originControl\}[\s\S]*\$\{downloadControl\}/);
});
check("renderers no longer build independent origin or download anchors", () => {
  [app, branchAppend, progressThumbnail, branchTree, compactList].forEach((source) => {
    assert.doesNotMatch(source, /<a\s+class="(?:version-origin-link|version-download-control|compact-link-control compact-(?:origin|download)-link)/);
  });
});
check("renderers no longer build normal append or management controls independently", () => {
  [app, branchAppend, progressThumbnail, branchTree, favorites].forEach((source) => {
    assert.doesNotMatch(source, /class="secondary append-version-button"/);
    assert.doesNotMatch(source, /className = "secondary version-management-button"/);
  });
  assert.match(branchAppend, /createAppendControl\(uiModel, \{ chartId \}\)/);
  assert.match(branchTree, /createManagementControl\(uiModel, \{/);
});
check("tree lifecycle labels come from Action UI", () => {
  assert.match(branchTree, /createLifecycleIndicator\(uiModel\)/);
  assert.match(branchTree, /createLifecycleIndicator\(uiModel, \{ variant: "detail" \}\)/);
  assert.doesNotMatch(branchTree, /class="withdrawal-pending-badge"/);
  assert.doesNotMatch(branchTree, /class="withdrawal-processing-badge"/);
  assert.doesNotMatch(branchTree, /class="withdrawal-tombstone-badge"/);
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
check("tree Action enhancement is idempotent and state replaceable", () => {
  const reconcileBlock = branchTree.slice(
    branchTree.indexOf("function reconcileActionControls("),
    branchTree.indexOf("function ensureGroupGutter(")
  );
  assert.match(branchTree, /function reconcileActionControls\(/);
  assert.match(branchTree, /actionUi\.replaceControlIfChanged\(existingAppend, desiredAppend/);
  assert.match(branchTree, /actions\.querySelector\("\.version-management-button"\)/);
  assert.match(actionSource, /existing\.outerHTML === next\.outerHTML/);
  assert.ok(reconcileBlock.indexOf("const desiredAppend") < reconcileBlock.indexOf("const desiredManagement"));
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
check("changed scripts use their reviewed release cache keys", () => {
  assert.ok(indexSources.includes("./app.js?v=submission-status-admin-correction-01"), "app.js cache key mismatch");
  assert.ok(indexSources.includes("./progress-thumbnail-list.js?v=progress-style-r4b2f-01"), "progress-thumbnail-list.js cache key mismatch");
  const unchangedR4aScripts = [
    "chart-render-pipeline.js",
    "chart-detail-link.js"
  ];
  unchangedR4aScripts.forEach((name) => {
    assert.ok(indexSources.includes(`./${name}?v=chart-render-pipeline-r4a-01`), `${name} cache key mismatch`);
  });
  ["version-comment-ui.js", "progress-map-drag-hint.js", "branch-append-ui.js"].forEach((name) => {
    assert.ok(indexSources.includes(`./${name}?v=version-comment-progress-01`), `${name} cache key mismatch`);
  });
  ["version-link-ui.js", "version-action-ui.js"].forEach((name) => {
    assert.ok(indexSources.includes(`./${name}?v=public-ui-refinement-01`), `${name} cache key mismatch`);
  });
  ["version-ui-model.js", "branch-tree-list.js", "favorites-list.js"].forEach((name) => {
    assert.ok(indexSources.includes(`./${name}?v=completed-parent-access-01`), `${name} cache key mismatch`);
  });
  ["version-ui-model.js", "version-link-ui.js", "version-action-ui.js", "version-comment-ui.js", "list.js"].forEach((name) => {
    const cacheKey = name === "version-ui-model.js"
        ? "completed-parent-access-01"
        : name === "version-comment-ui.js"
          ? "version-comment-progress-01"
          : "public-ui-refinement-01";
    assert.ok(listSources.includes(`./${name}?v=${cacheKey}`), `${name} compact cache key mismatch`);
  });
});
check("CSS files match the reviewed public UI state", () => {
  const expected = new Map([
    ["docs/style.css", "e098f16d091b1f56e6ac6fac1a1c52e880d79c3d3f38eff746b6755f605e01db"],
    ["docs/branch-tree-list.css", "ed19601843f967502a35490617f9f1f31b4f53ae774856ca1bcaca26556f17ea"],
    ["docs/list-ui-refresh.css", "f630206e0a7ce75150b2305414ff85c6657244bfa0d58965594e29fb372b1d81"],
    ["docs/list.css", "295873bfe249e3ebe39d786258ad389a224c0655702586c6349089382e1e524c"],
    ["docs/theme.css", "32963e73d0ae0a29f6fd3ef4014a2b194bc94686170020e9622504e408c81f95"],
    ["docs/chart-detail-link.css", "c45722a66d547ecb51825e67dc3e65cc31413f7820a5d34db8b45eb23dbe0882"],
    ["docs/favorites-list.css", "f9498bc2128e06da0a1de3a41e19949a3ee8afebfc46f266600026288d20cf7b"],
    ["docs/progress-thumbnail-list.css", "24d5a258fb4b737584cd54700544f6c496a8065639120d047ccc80135e1e3304"],
    ["docs/tree-progress-polish.css", "e0d1cf234c249070294491982088d34812c602e92ccdca7377011d7292e9f4ad"],
    ["docs/chart-miniview.css", "e92980af2dde81ce2051a9216d744d62ee9fbed18e8423f6461296f65791d49c"]
  ]);
  expected.forEach((hash, relativePath) => {
    assert.equal(sha256(fs.readFileSync(path.join(root, relativePath))), hash, relativePath);
  });
});
check("favorite and progress runtime styles are removed", () => {
  assert.doesNotMatch(favorites, /injectStyles|favoriteListStyles|createElement\(["']style["']\)|style\.textContent/);
  assert.doesNotMatch(progressThumbnail, /ensureProgressImageThumbnailStyle|progress-image-thumbnail-style|createElement\(["']style["']\)|style\.textContent|document\.head\.appendChild\(style\)/);
  assert.equal(sha256(progressThumbnail), "e2dbcee8975d7b95341875d1c4962fd2904a81873fd4cf7dbdbe757004a58bb6");
});
check("R4A keeps DOM traversal growth bounded", () => {
  const r1Baseline = new Map([
    [app, 69],
    [branchAppend, 60],
    [progressThumbnail, 24],
    [branchTree, 44],
    [favorites, 18],
    [compactList, 11],
    [chartDetail, 8]
  ]);
  r1Baseline.forEach((count, source) => assert.ok(traversalCount(source) <= count));
  assert.ok(traversalCount(branchTree) <= 44);
  assert.ok(traversalCount(favorites) <= 18);
  assert.ok(traversalCount(compactList) <= 11);
});
check("normal action strings remain unchanged", () => {
  assert.match(actionSource, /button\.textContent = "追記投稿"/);
  assert.match(actionSource, /"追記停止"/);
  assert.match(actionSource, /"旧形式"/);
  assert.match(actionSource, /"追記不可"/);
  assert.match(linkSource, /control\.textContent = "DL"/);
  assert.match(linkSource, /control\.textContent = "DL不可"/);
});
check("missing shared model paths fail closed", () => {
  assert.match(app, /buildVersionUiModel\?\.[\s\S]*\|\| null/);
  assert.match(compactList, /buildVersionUiModel\?\.[\s\S]*\|\| null/);
  assert.match(branchTree, /uiModel\?\.canShowActions !== true/);
  assert.match(favorites, /\?\.favorite\.available === true/);
  [branchAppend, compactList].forEach((source) => {
    assert.match(source, /canBuildLinks/);
    assert.match(source, /DL不可<\/span>/);
  });
  assert.match(branchTree, /if \(!canBuildLinks\)[\s\S]*existingOrigin\?\.remove\(\)[\s\S]*DL不可/);
  assert.match(branchAppend, /BmsVersionActionUi/);
  assert.match(branchAppend, /追記不可<\/button>/);
  assert.match(branchTree, /existingManagement\?\.remove\(\)/);
});

assert.ok(passed >= 20, `expected at least 20 checks, got ${passed}`);
console.log(`version render pipeline static tests: ${passed} checks passed`);
