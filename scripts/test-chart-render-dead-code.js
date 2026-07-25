"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const docsDirectory = path.join(root, "docs");
const docsSources = fs.readdirSync(docsDirectory)
  .filter((name) => /\.(?:html|js)$/.test(name))
  .map((name) => ({ name, source: read(`docs/${name}`) }));
const sourceFor = (name) => docsSources.find((item) => item.name === name)?.source || "";
const allDocsSource = docsSources.map((item) => item.source).join("\n");
const count = (source, pattern) => (source.match(pattern) || []).length;
let passed = 0;

function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const app = sourceFor("app.js");
const progressThumbnail = sourceFor("progress-thumbnail-list.js");
const branchAppend = sourceFor("branch-append-ui.js");
const branchTree = sourceFor("branch-tree-list.js");
const favorites = sourceFor("favorites-list.js");
const chartDetail = sourceFor("chart-detail-link.js");
const pipeline = sourceFor("chart-render-pipeline.js");
const indexHtml = sourceFor("index.html");
const rendererSources = [app, progressThumbnail, branchAppend, branchTree, favorites, chartDetail].join("\n");

check("legacy renderer symbols are absent from public documents", () => {
  assert.doesNotMatch(allDocsSource, /renderChartsLegacy|renderChartsWithProgressThumbnailsLegacy/);
});

check("app-only legacy helpers are absent", () => {
  assert.doesNotMatch(app, /function renderEmpty\(|versionActionUiUnavailableWarned/);
});

check("progress-only legacy helpers are absent", () => {
  assert.doesNotMatch(progressThumbnail, /function renderEmptyList\(|function makeVersionUiModel\(/);
});

check("app no longer contains chart or version row markup", () => {
  assert.doesNotMatch(app, /<(?:article|div) class="(?:chart-group|version-row|version-actions)"/);
});

check("progress enhancer no longer contains chart or version row markup", () => {
  assert.doesNotMatch(progressThumbnail, /<(?:article|div) class="(?:chart-group|version-row|version-actions)"/);
});

check("renderCharts facade assignment exists only in the pipeline", () => {
  const assignments = docsSources
    .filter((item) => item.name.endsWith(".js"))
    .flatMap((item) => [...item.source.matchAll(/(?:^|[^.\w])renderCharts\s*=|(?:window|browserWindow)\.renderCharts\s*=/gm)]
      .map(() => item.name));
  assert.deepEqual(assignments, ["chart-render-pipeline.js"]);
  assert.match(pipeline, /browserWindow\.renderCharts = function renderCharts\(data, options\)/);
});

check("renderer capture variables are absent", () => {
  assert.doesNotMatch(rendererSources, /(?:previous|original|base|wrapped|final)RenderCharts\s*=\s*renderCharts/i);
});

check("renderer wrapper function names are absent", () => {
  assert.doesNotMatch(rendererSources, /renderChartsWith(?:Append|SelectedSection|ProgressThumbnails|FinalProgressThumbnails)|renderChartsAsTree|renderWithFavorites/);
});

check("timer-based renderer bridge is absent", () => {
  assert.doesNotMatch(rendererSources, /installFinalProgressThumbnailBridge|setTimeout\([^\n]*(?:renderCharts|Renderer|Bridge)/i);
});

check("branch append remains the sole base renderer", () => {
  assert.equal(count(allDocsSource, /\.setBaseRenderer\(\{/g), 1);
  assert.match(branchAppend, /setBaseRenderer\(\{\s*name: "branch-append-base"/);
});

check("favorites remains the sole data stage", () => {
  assert.equal(count(allDocsSource, /\.registerDataStage\(\{/g), 1);
  assert.match(favorites, /name: "favorites-filter",\s*order: 100/);
});

check("tree, favorites, and thumbnails remain the only post-render stages", () => {
  assert.equal(count(allDocsSource, /\.registerPostRenderStage\(\{/g), 3);
  assert.equal(count(allDocsSource, /name: "tree",\s*order: 100/g), 1);
  assert.equal(count(allDocsSource, /name: "favorites",\s*order: 200/g), 1);
  assert.equal(count(allDocsSource, /name: "stored-progress-thumbnails",\s*order: 300/g), 1);
});

check("common mount remains the sole mount stage", () => {
  assert.equal(count(allDocsSource, /\.registerMountStage\(\{/g), 1);
  assert.match(app, /name: "common-mount",\s*order: 400/);
});

check("progress thumbnail model and apply path remain", () => {
  assert.match(progressThumbnail, /function renderProgressThumbnail\(version, context = \{\}\)/);
  assert.match(progressThumbnail, /function applyStoredProgressThumbnails\(data, root = listElement, options = \{\}\)/);
  assert.match(progressThumbnail, /renderProgressThumbnail\(version, context\)/);
});

check("progress thumbnail mount scheduler remains", () => {
  assert.match(progressThumbnail, /function scheduleProgressImageThumbnailMount\(root = listElement \|\| document\)/);
  assert.match(progressThumbnail, /window\.requestAnimationFrame\(run\)/);
});

check("progress observer remains singular", () => {
  assert.equal(count(progressThumbnail, /new MutationObserver\(/g), 1);
  assert.match(progressThumbnail, /progressThumbnailObserver\.observe\(listElement/);
});

check("required application globals remain", () => {
  assert.match(app, /window\.mountChartUi = mountChartUi/);
  assert.match(app, /window\.loadCharts = loadCharts/);
  assert.match(app, /window\.rerenderCurrentChartList = rerenderCurrentChartList/);
  assert.match(pipeline, /browserWindow\.BmsChartRenderPipeline = api/);
});

check("required detail globals remain", () => {
  assert.match(chartDetail, /window\.BmsChartDetail = \{/);
  assert.match(chartDetail, /window\.chartDetailInitialRenderPromise =/);
});

check("required favorite and progress globals remain", () => {
  assert.match(favorites, /window\.mountFavoriteButtons = mountFavorites/);
  assert.match(progressThumbnail, /window\.applyStoredProgressThumbnails = applyStoredProgressThumbnails/);
  assert.match(progressThumbnail, /window\.scheduleProgressImageThumbnailMount = scheduleProgressImageThumbnailMount/);
});

check("render lifecycle events remain", () => {
  assert.match(app, /new CustomEvent\("chart-ui:mounted"/);
  assert.match(app, /new CustomEvent\("chart-list-load-settled"/);
  assert.match(chartDetail, /new CustomEvent\("chart-detail:rendered"/);
});

check("modified scripts keep their order and use the R4B1 cache key", () => {
  const appIndex = indexHtml.indexOf("./app.js?v=chart-render-cleanup-r4b1-01");
  const progressIndex = indexHtml.indexOf("./progress-thumbnail-list.js?v=chart-render-cleanup-r4b1-01");
  const pipelineIndex = indexHtml.indexOf("./chart-render-pipeline.js?v=chart-render-pipeline-r4a-01");
  const branchAppendIndex = indexHtml.indexOf("./branch-append-ui.js?v=chart-render-pipeline-r4a-01");
  assert.ok(pipelineIndex >= 0 && pipelineIndex < appIndex);
  assert.ok(appIndex < progressIndex && progressIndex < branchAppendIndex);
});

assert.ok(passed >= 20, `expected at least 20 checks, got ${passed}`);
console.log(`chart render dead code tests: ${passed} checks passed`);
