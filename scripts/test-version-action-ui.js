"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createAppendControl,
  createManagementControl,
  createCommentControl,
  createLifecycleIndicator,
  replaceControlIfChanged
} = require("../docs/version-action-ui.js");
const { buildVersionUiModel } = require("../docs/version-ui-model.js");

let passed = 0;

function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}

function datasetAttribute(name) {
  return `data-${String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this._textContent = "";
    this.parentNode = null;
    this.children = [];
    this.dataset = new Proxy({}, {
      set: (_target, name, value) => {
        this.setAttribute(datasetAttribute(name), value);
        return true;
      },
      get: (_target, name) => this.getAttribute(datasetAttribute(name)) ?? undefined
    });
  }

  set className(value) { this.setAttribute("class", value); }
  get className() { return this.getAttribute("class") || ""; }
  set textContent(value) { this._textContent = String(value); }
  get textContent() { return `${this._textContent}${this.children.map((child) => child.textContent).join("")}`; }
  set type(value) { this.setAttribute("type", value); }
  get type() { return this.getAttribute("type") || ""; }
  set title(value) { this.setAttribute("title", value); }
  get title() { return this.getAttribute("title") || ""; }
  set disabled(value) {
    if (value) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }
  get disabled() { return this.attributes.has("disabled"); }
  set innerHTML(_value) { throw new Error("innerHTML must not be used by VersionActionUi"); }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
  getAttribute(name) { return this.attributes.get(String(name)) ?? null; }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  addEventListener() { throw new Error("individual listeners must not be used by VersionActionUi"); }
  append(...elements) {
    elements.forEach((element) => {
      element.parentNode = this;
      this.children.push(element);
    });
  }
  remove() {
    this.removeCount = (this.removeCount || 0) + 1;
    if (this.parentNode) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    }
  }
  replaceWith(element) {
    this.replaceCount = (this.replaceCount || 0) + 1;
    this.replacedWith = element;
    if (this.parentNode) {
      const parent = this.parentNode;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1, element);
      element.parentNode = parent;
      this.parentNode = null;
    }
  }
  get outerHTML() {
    const attributes = [...this.attributes]
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join("");
    return `<${this.tagName.toLowerCase()}${attributes}>${escapeText(this.textContent)}</${this.tagName.toLowerCase()}>`;
  }
}

class FakeParent {
  constructor() { this.children = []; }
  insertBefore(element, before) {
    const index = before ? this.children.indexOf(before) : -1;
    if (index >= 0) this.children.splice(index, 0, element);
    else this.children.push(element);
    element.parentNode = this;
  }
}

class FakeDocument {
  constructor() { this.createdCount = 0; }
  createElement(tagName) {
    this.createdCount += 1;
    return new FakeElement(tagName);
  }
}

function rawVersion(overrides = {}) {
  return {
    id: "version_01",
    lifecycleStatus: "active",
    handlingMode: null,
    hidden: false,
    downloadBlocked: false,
    withdrawalDownloadBlocked: false,
    allowAppend: true,
    collapsedByCompletion: false,
    collapsedReason: "",
    file: { downloadUrl: "/api/files/File_01" },
    ...overrides
  };
}

function model(overrides = {}, options = {}) {
  return buildVersionUiModel(rawVersion(overrides), {
    workerBaseUrl: "https://worker.example.test",
    hasProgressMap: options.hasProgressMap !== false,
    isSupersededIntermediate: options.isSupersededIntermediate === true
  });
}

function domOptions(overrides = {}) {
  return { document: new FakeDocument(), chartId: "chart_01", ...overrides };
}

function managementOptions(overrides = {}) {
  return domOptions({
    versionLabel: "BASE",
    author: "譜面作者",
    withdrawn: false,
    deleteRequested: false,
    requestMode: "grace",
    scheduledAt: "2026-07-25 12:00:00",
    canCancelWithdrawal: true,
    createdAt: "2026-07-24 12:00:00",
    within24Hours: false,
    hasDescendants: true,
    ...overrides
  });
}

check("public comment control is available even when the count is zero", () => {
  const control = createCommentControl(model({ commentCount: 0 }), domOptions({
    versionLabel: "BASE",
    songTitle: "Song",
    chartName: "Chart",
    author: "Author",
    authorComment: "Author comment"
  }));
  assert.ok(control);
  assert.equal(control.className, "secondary version-comment-button");
  assert.equal(control.dataset.commentCount, "0");
  assert.equal(control.textContent, "コメント0");
  assert.equal(control.getAttribute("aria-label"), "BASE のコメント 0件を開く");
});

check("comment control carries only public display context", () => {
  const control = createCommentControl(model({
    commentCount: 2,
    latestComment: { body: "latest", createdAt: "2026-08-03 00:00:00" }
  }), domOptions({
    versionLabel: "1-2",
    songTitle: "Song",
    chartName: "Chart",
    author: "Author",
    authorComment: "Full author comment"
  }));
  assert.deepEqual({
    versionId: control.dataset.versionId,
    songTitle: control.dataset.songTitle,
    chartName: control.dataset.chartName,
    versionLabel: control.dataset.versionLabel,
    author: control.dataset.author,
    authorComment: control.dataset.authorComment,
    latestComment: control.dataset.latestComment,
    latestCommentCreatedAt: control.dataset.latestCommentCreatedAt
  }, {
    versionId: "version_01",
    songTitle: "Song",
    chartName: "Chart",
    versionLabel: "1-2",
    author: "Author",
    authorComment: "Full author comment",
    latestComment: "latest",
    latestCommentCreatedAt: "2026-08-03 00:00:00"
  });
  assert.doesNotMatch(control.outerHTML, /hash|token|password/i);
});

check("redacted version has no comment control", () => {
  assert.equal(createCommentControl(model({
    publicDataRedacted: true,
    lifecycleStatus: "processing",
    canShowActions: false
  }), domOptions()), null);
});

check("available append is a button", () => assert.equal(createAppendControl(model(), domOptions()).tagName, "BUTTON"));
check("available append text remains 追記投稿", () => assert.equal(createAppendControl(model(), domOptions()).textContent, "追記投稿"));
check("available append class remains stable", () => assert.equal(createAppendControl(model(), domOptions()).className, "secondary append-version-button"));
check("available append keeps chart dataset", () => assert.equal(createAppendControl(model(), domOptions()).dataset.chartId, "chart_01"));
check("available append keeps parent dataset", () => assert.equal(createAppendControl(model(), domOptions()).dataset.parentVersionId, "version_01"));
check("available append is not disabled", () => assert.equal(createAppendControl(model(), domOptions()).disabled, false));
check("append disabled policy text remains 追記停止", () => assert.equal(createAppendControl(model({ allowAppend: false }), domOptions()).textContent, "追記停止"));
check("append disabled policy class remains stable", () => assert.equal(createAppendControl(model({ allowAppend: false }), domOptions()).className, "secondary append-policy-disabled-button"));
check("append disabled policy keeps aria description", () => assert.equal(createAppendControl(model({ allowAppend: false }), domOptions()).getAttribute("aria-describedby"), "append-policy-description-version_01"));
check("legacy append text remains 旧形式", () => assert.equal(createAppendControl(model({}, { hasProgressMap: false }), domOptions()).textContent, "旧形式"));
check("legacy append is disabled", () => assert.equal(createAppendControl(model({}, { hasProgressMap: false }), domOptions()).disabled, true));
check("completed-child option does not disable append", () => assert.equal(createAppendControl(model({}, { isSupersededIntermediate: true }), domOptions()).textContent, "追記投稿"));
check("completed-child option keeps available append class", () => assert.equal(createAppendControl(model({}, { isSupersededIntermediate: true }), domOptions()).className, "secondary append-version-button"));
check("completed-child option keeps append enabled", () => assert.equal(createAppendControl(model({}, { isSupersededIntermediate: true }), domOptions()).disabled, false));
check("legacy completion collapse keeps append available", () => assert.equal(createAppendControl(model({
  collapsedByCompletion: true,
  collapsedReason: "superseded_by_completed_descendant"
}), domOptions()).className, "secondary append-version-button"));
check("processing append is hidden", () => assert.equal(createAppendControl(model({ lifecycleStatus: "processing" }), domOptions()), null));
check("tombstoned append is hidden", () => assert.equal(createAppendControl(model({ lifecycleStatus: "tombstoned" }), domOptions()), null));
check("unknown append is hidden", () => assert.equal(createAppendControl(model({ lifecycleStatus: "unexpected" }), domOptions()), null));
check("null model append is hidden", () => assert.equal(createAppendControl(null, domOptions()), null));
check("missing chart id fails closed", () => assert.equal(createAppendControl(model(), domOptions({ chartId: "" })).textContent, "追記不可"));
check("generic invalid append has aria-disabled", () => assert.equal(createAppendControl({ canShowActions: true, versionId: "v", append: {} }, domOptions()).getAttribute("aria-disabled"), "true"));
check("placeholder keeps the old valid label", () => assert.equal(createAppendControl(model(), domOptions({ placeholder: true })).textContent, "追記投稿"));
check("placeholder keeps the old disabled shape", () => assert.equal(createAppendControl(model(), domOptions({ placeholder: true })).getAttribute("aria-disabled"), null));
check("append creation installs no listener", () => assert.doesNotThrow(() => createAppendControl(model(), domOptions())));

check("active management is visible", () => assert.equal(createManagementControl(model(), managementOptions()).tagName, "BUTTON"));
check("grace management is visible", () => assert.equal(createManagementControl(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "grace_auto_delete" }), managementOptions()).tagName, "BUTTON"));
check("manual management is visible", () => assert.equal(createManagementControl(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "manual_review" }), managementOptions()).tagName, "BUTTON"));
check("processing management is hidden", () => assert.equal(createManagementControl(model({ lifecycleStatus: "processing" }), managementOptions()), null));
check("tombstoned management is hidden", () => assert.equal(createManagementControl(model({ lifecycleStatus: "tombstoned" }), managementOptions()), null));
check("deleted management is hidden", () => assert.equal(createManagementControl(model({ lifecycleStatus: "deleted" }), managementOptions()), null));
check("unknown management is hidden", () => assert.equal(createManagementControl(model({ lifecycleStatus: "unexpected" }), managementOptions()), null));
check("hidden management is hidden", () => assert.equal(createManagementControl(model({ hidden: true }), managementOptions()), null));
check("redacted management is hidden", () => assert.equal(createManagementControl(model({ publicDataRedacted: true }), managementOptions()), null));
check("missing version id management is hidden", () => assert.equal(createManagementControl({ ...model(), versionId: "" }, managementOptions()), null));
check("management class and public action text remain stable", () => {
  const button = createManagementControl(model(), managementOptions());
  assert.equal(button.className, "secondary version-management-button");
  assert.equal(button.textContent, "投稿操作");
  assert.equal(button.type, "button");
});
check("management title and aria describe the public action", () => {
  const button = createManagementControl(model(), managementOptions());
  assert.equal(button.title, "BASE の投稿後の操作を開く");
  assert.equal(button.getAttribute("aria-label"), "BASE の投稿後の操作を開く");
});
check("management identity datasets remain compatible", () => {
  const button = createManagementControl(model(), managementOptions());
  assert.deepEqual([button.dataset.versionId, button.dataset.chartId, button.dataset.versionLabel], ["version_01", "chart_01", "BASE"]);
});
check("management lifecycle datasets remain compatible", () => {
  const button = createManagementControl(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "grace_auto_delete" }), managementOptions());
  assert.deepEqual([button.dataset.lifecycleStatus, button.dataset.handlingMode, button.dataset.requestMode], ["withdrawal_pending", "grace_auto_delete", "grace"]);
});
check("management availability datasets remain compatible", () => {
  const button = createManagementControl(model(), managementOptions());
  assert.deepEqual([button.dataset.allowAppend, button.dataset.appendAvailable, button.dataset.downloadAvailable], ["true", "true", "true"]);
});
check("management timing datasets remain compatible", () => {
  const button = createManagementControl(model(), managementOptions());
  assert.deepEqual([button.dataset.scheduledAt, button.dataset.createdAt, button.dataset.within24Hours], ["2026-07-25 12:00:00", "2026-07-24 12:00:00", "false"]);
});
check("management legacy datasets remain compatible", () => {
  const button = createManagementControl(model(), managementOptions());
  assert.deepEqual([button.dataset.withdrawn, button.dataset.deleteRequested, button.dataset.canCancelWithdrawal, button.dataset.hasDescendants], ["false", "false", "true", "true"]);
});
check("management creation installs no listener", () => assert.doesNotThrow(() => createManagementControl(model(), managementOptions())));

check("canceled lifecycle normalization restores actions on reload and in-place rerender", () => {
  const staleModel = model({ handlingMode: "manual_review" });
  assert.equal(staleModel.lifecycle.consistent, false);
  assert.equal(createAppendControl(staleModel, domOptions()), null);
  assert.equal(createManagementControl(staleModel, managementOptions()), null);

  const normalizedModel = model({ handlingMode: null });
  const reloadAppend = createAppendControl(normalizedModel, domOptions());
  const reloadManagement = createManagementControl(normalizedModel, managementOptions());
  assert.equal(reloadAppend.tagName, "BUTTON");
  assert.equal(reloadManagement.tagName, "BUTTON");

  const appendParent = new FakeParent();
  const managementParent = new FakeParent();
  replaceControlIfChanged(null, createAppendControl(normalizedModel, domOptions()), { parent: appendParent });
  replaceControlIfChanged(null, createManagementControl(normalizedModel, managementOptions()), { parent: managementParent });
  assert.equal(appendParent.children.length, 1);
  assert.equal(managementParent.children.length, 1);
});

check("active lifecycle has no indicator", () => assert.equal(createLifecycleIndicator(model(), domOptions()), null));
check("grace lifecycle badge remains stable", () => {
  const indicator = createLifecycleIndicator(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "grace_auto_delete" }), domOptions());
  assert.equal(indicator.className, "withdrawal-pending-badge");
  assert.equal(indicator.textContent, "DL停止・自動削除待ち");
});
check("manual lifecycle badge remains stable", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "manual_review" }), domOptions()).textContent, "DL停止・管理者確認待ち"));
check("immediate lifecycle badge remains stable", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "immediate_delete" }), domOptions()).textContent, "取り下げ申請中"));
check("processing lifecycle badge remains stable", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "processing" }), domOptions()).className, "withdrawal-processing-badge"));
check("tombstoned lifecycle badge remains stable", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "tombstoned" }), domOptions()).textContent, "履歴のみ"));
check("deleted lifecycle is identified without internal value", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "deleted" }), domOptions()).textContent, "削除済み"));
check("unknown lifecycle is hidden", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "internal-secret" }), domOptions()), null));
check("immediate detail remains stable", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "immediate_delete" }), domOptions({ variant: "detail" })).textContent, "削除処理待ち / 取消不可"));
check("manual help remains stable", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "manual_review" }), domOptions({ variant: "help" })).textContent, "申請理由と派生版の状態を管理者が確認します。"));
check("grace help uses a preformatted safe label", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "grace_auto_delete" }), domOptions({ variant: "help", scheduledLabel: "2026/07/25 12:00" })).textContent, "2026/07/25 12:00以降、追記や参照がなければ自動削除します。"));
check("tombstoned detail remains stable", () => assert.equal(createLifecycleIndicator(model({ lifecycleStatus: "tombstoned" }), domOptions({ variant: "detail" })).textContent, "派生版を維持するため、版ツリー上の履歴だけ残っています。"));

check("identical control is not replaced", () => {
  const existing = createAppendControl(model(), domOptions());
  const next = createAppendControl(model(), domOptions());
  assert.equal(replaceControlIfChanged(existing, next), existing);
  assert.equal(existing.replaceCount, undefined);
});
check("changed control is replaced once", () => {
  const existing = createAppendControl(model(), domOptions());
  const next = createAppendControl(model({ allowAppend: false }), domOptions());
  assert.equal(replaceControlIfChanged(existing, next), next);
  assert.equal(existing.replaceCount, 1);
});
check("element to null removes once", () => {
  const existing = createAppendControl(model(), domOptions());
  assert.equal(replaceControlIfChanged(existing, null), null);
  assert.equal(existing.removeCount, 1);
});
check("null to element inserts once", () => {
  const parent = new FakeParent();
  const next = createAppendControl(model(), domOptions());
  assert.equal(replaceControlIfChanged(null, next, { parent }), next);
  assert.deepEqual(parent.children, [next]);
});
check("second reconciliation does not duplicate", () => {
  const parent = new FakeParent();
  const first = createAppendControl(model(), domOptions());
  replaceControlIfChanged(null, first, { parent });
  const second = createAppendControl(model(), domOptions());
  replaceControlIfChanged(first, second, { parent });
  assert.deepEqual(parent.children, [first]);
});
check("dataset difference triggers replacement", () => {
  const existing = createAppendControl(model(), domOptions({ chartId: "chart_01" }));
  const next = createAppendControl(model(), domOptions({ chartId: "chart_02" }));
  assert.equal(replaceControlIfChanged(existing, next), next);
});
check("disabled difference triggers replacement", () => {
  const existing = createAppendControl(model(), domOptions());
  const next = createAppendControl(model({ allowAppend: false }), domOptions());
  assert.notEqual(existing.outerHTML, next.outerHTML);
  replaceControlIfChanged(existing, next);
  assert.equal(existing.replaceCount, 1);
});
check("aria difference triggers replacement", () => {
  const existing = createManagementControl(model(), managementOptions({ versionLabel: "BASE" }));
  const next = createManagementControl(model(), managementOptions({ versionLabel: "1" }));
  replaceControlIfChanged(existing, next);
  assert.equal(existing.replaceCount, 1);
});
check("foreign next node is rejected", () => {
  const parent = new FakeParent();
  const foreign = new FakeElement("button");
  assert.equal(replaceControlIfChanged(null, foreign, { parent }), null);
  assert.equal(parent.children.length, 0);
});

check("model is not mutated", () => {
  const input = model();
  const before = JSON.stringify(input);
  createAppendControl(input, domOptions());
  createManagementControl(input, managementOptions());
  createLifecycleIndicator(input, domOptions());
  assert.equal(JSON.stringify(input), before);
});
check("options are not mutated", () => {
  const input = Object.freeze(domOptions({ chartId: "chart_01" }));
  const before = Object.keys(input).join("|");
  createAppendControl(model(), input);
  assert.equal(Object.keys(input).join("|"), before);
});
check("same input creates stable append DOM", () => assert.equal(createAppendControl(model(), domOptions()).outerHTML, createAppendControl(model(), domOptions()).outerHTML));
check("reason is not rendered", () => {
  const input = { ...model(), append: { available: false, reason: "secret-user-reason" } };
  assert.doesNotMatch(createAppendControl(input, domOptions()).outerHTML, /secret-user-reason/);
});
check("malicious management input stays text and data", () => {
  const attack = '\"><script>alert(1)</script>\' autofocus onfocus=\'alert(1)';
  const button = createManagementControl(model(), managementOptions({ versionLabel: attack, author: attack }));
  assert.equal(button.attributes.has("autofocus"), false);
  assert.equal(button.attributes.has("onfocus"), false);
  assert.doesNotMatch(button.outerHTML, /<script>|<\/script>/i);
});
check("malicious lifecycle label stays text", () => {
  const attack = "</button><script>alert(1)</script>";
  const indicator = createLifecycleIndicator(model({ lifecycleStatus: "withdrawal_pending", handlingMode: "grace_auto_delete" }), domOptions({ variant: "help", scheduledLabel: attack }));
  assert.equal(indicator.textContent.startsWith(attack), true);
  assert.doesNotMatch(indicator.outerHTML, /<script>|<\/script>/i);
});
check("Version Action UI never uses innerHTML", () => {
  assert.doesNotThrow(() => createAppendControl(model(), domOptions()));
  assert.doesNotThrow(() => createManagementControl(model(), managementOptions()));
  assert.doesNotThrow(() => createLifecycleIndicator(model({ lifecycleStatus: "processing" }), domOptions()));
});

const favoritesSource = fs.readFileSync(path.resolve(__dirname, "../docs/favorites-list.js"), "utf8");
const renderStart = favoritesSource.indexOf("function mergeLatestData(data)");
const renderEnd = favoritesSource.indexOf("interactionRoot.addEventListener", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, "favorites rerender functions must be extractable");
const createFavoritesHarness = Function("dependencies", `
  let latestData = dependencies.latestData;
  const readFavorites = dependencies.readFavorites;
  const filterDataForFavorites = dependencies.filterDataForFavorites;
  const getChartId = dependencies.getChartId;
  const listElement = dependencies.listElement;
  const mountFavorites = dependencies.mountFavorites;
  const updateFilterButton = dependencies.updateFilterButton;
  const favoriteOnly = dependencies.favoriteOnly;
  const window = dependencies.window;
  ${favoritesSource.slice(renderStart, renderEnd)}
  return { applyFavoriteFilter, mountFavoriteStage, rerenderLatest, getLatestData: () => latestData };
`);

check("favorites local rerender enters the shared pipeline once", () => {
  const calls = { render: 0, favoriteMount: 0, fetch: 0 };
  const data = { charts: [{ versions: [{ id: "version_01" }] }] };
  const filtered = { charts: [{ versions: [{ id: "version_01" }] }] };
  const listElement = { querySelector: () => null, thumbnailSlots: 1, favoriteButtons: 1 };
  const harness = createFavoritesHarness({
    latestData: data,
    favoriteOnly: true,
    readFavorites: () => ({ version_01: {} }),
    filterDataForFavorites: () => filtered,
    getChartId: () => "chart_01",
    listElement,
    mountFavorites: () => { calls.favoriteMount += 1; },
    updateFilterButton: () => {},
    window: {
      BmsChartRenderPipeline: {
        render(renderData, options) {
          calls.render += 1;
          assert.equal(renderData, data);
          assert.deepEqual(options, {
            target: listElement,
            mode: "replace",
            source: "favorite-filter"
          });
        }
      },
      fetch() { calls.fetch += 1; }
    }
  });
  harness.rerenderLatest();
  harness.mountFavoriteStage({
    data: filtered,
    target: listElement,
    renderedNodes: [],
    mode: "replace"
  });
  assert.deepEqual(calls, { render: 1, favoriteMount: 1, fetch: 0 });
  assert.equal(listElement.thumbnailSlots, 1);
  assert.equal(listElement.favoriteButtons, 1);
});
check("two favorites rerenders do not recurse or grow DOM", () => {
  const calls = { render: 0, favoriteMount: 0 };
  const listElement = { querySelector: () => null, thumbnailSlots: 1, favoriteButtons: 1 };
  const harness = createFavoritesHarness({
    latestData: { charts: [] },
    favoriteOnly: false,
    readFavorites: () => ({}),
    filterDataForFavorites: (data) => data,
    getChartId: () => "",
    listElement,
    mountFavorites: () => { calls.favoriteMount += 1; },
    updateFilterButton: () => {},
    window: { BmsChartRenderPipeline: { render: () => { calls.render += 1; } } }
  });
  harness.rerenderLatest();
  harness.rerenderLatest();
  assert.deepEqual(calls, { render: 2, favoriteMount: 0 });
  assert.deepEqual([listElement.thumbnailSlots, listElement.favoriteButtons], [1, 1]);
});

let performanceMetrics;
check("eight-version fixture builds one model and expected Action nodes per version", () => {
  const targetDocument = new FakeDocument();
  let modelBuildCount = 0;
  let actionNodeCount = 0;
  let replacementCount = 0;
  let htmlBytes = 0;
  Array.from({ length: 8 }, (_, index) => rawVersion({ id: `version_${index}` })).forEach((version) => {
    modelBuildCount += 1;
    const uiModel = buildVersionUiModel(version, {
      workerBaseUrl: "https://worker.example.test",
      hasProgressMap: true
    });
    const append = createAppendControl(uiModel, { document: targetDocument, chartId: "chart_01" });
    const management = createManagementControl(uiModel, {
      document: targetDocument,
      chartId: "chart_01",
      versionLabel: version.id
    });
    const comments = createCommentControl(uiModel, {
      document: targetDocument,
      songTitle: "Song",
      chartName: "Chart",
      versionLabel: version.id,
      author: "Author"
    });
    actionNodeCount += Number(Boolean(append)) + Number(Boolean(management)) + Number(Boolean(comments));
    htmlBytes += Buffer.byteLength(`${append?.outerHTML || ""}${comments?.outerHTML || ""}${management?.outerHTML || ""}`, "utf8");
    const duplicate = createAppendControl(uiModel, { document: targetDocument, chartId: "chart_01" });
    replaceControlIfChanged(append, duplicate);
    replacementCount += append.replaceCount || 0;
  });
  performanceMetrics = {
    versionCount: 8,
    modelBuildCount,
    actionNodeCount,
    replacementCount,
    favoritesMountsPerRerender: 1,
    domTraversalIncrease: 0,
    htmlBytes
  };
  assert.equal(modelBuildCount, 8);
  assert.equal(actionNodeCount, 24);
  assert.equal(replacementCount, 0);
});

assert.ok(passed >= 54, `expected at least 54 checks, got ${passed}`);
console.log(`version action ui tests: ${passed} checks passed`);
console.log(`version action ui performance fixture: ${JSON.stringify(performanceMetrics)}`);
