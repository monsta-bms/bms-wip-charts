"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createOriginLink,
  createDownloadControl,
  serializeControl
} = require("../docs/version-link-ui.js");
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

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this._textContent = "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  get textContent() {
    return this._textContent;
  }

  set innerHTML(_value) {
    throw new Error("innerHTML must not be used by VersionLinkUi");
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  addEventListener() {
    throw new Error("click listeners must not be used by VersionLinkUi");
  }

  remove() {
    this.removeCount = (this.removeCount || 0) + 1;
  }

  replaceWith(element) {
    this.replacedWith = element;
  }

  get outerHTML() {
    const attributes = [...this.attributes]
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join("");
    return `<${this.tagName.toLowerCase()}${attributes}>${escapeText(this.textContent)}</${this.tagName.toLowerCase()}>`;
  }
}

class FakeDocument {
  constructor() {
    this.createdCount = 0;
  }

  createElement(tagName) {
    this.createdCount += 1;
    return new FakeElement(tagName);
  }
}

function model(overrides = {}) {
  return {
    canShowActions: true,
    actionReason: "available",
    originLink: {
      available: true,
      url: "https://songs.example.test/original",
      reason: "available"
    },
    download: {
      available: true,
      url: "https://worker.example.test/api/files/File_01",
      label: "DL",
      reason: "available"
    },
    ...overrides
  };
}

function options(overrides = {}) {
  return {
    document: new FakeDocument(),
    ariaLabel: "ver1.0 の原曲・本体の配布ページを開く（外部サイト）",
    ...overrides
  };
}

check("available origin creates an anchor", () => {
  assert.equal(createOriginLink(model(), options()).tagName, "A");
});
check("unavailable origin returns null", () => {
  assert.equal(createOriginLink(model({ originLink: { available: false, url: null } }), options()), null);
});
check("null model origin returns null", () => {
  assert.equal(createOriginLink(null, options()), null);
});
check("available origin without URL returns null", () => {
  assert.equal(createOriginLink(model({ originLink: { available: true, url: null } }), options()), null);
});
check("origin target remains blank", () => {
  assert.equal(createOriginLink(model(), options()).getAttribute("target"), "_blank");
});
check("origin rel remains noopener noreferrer", () => {
  assert.equal(createOriginLink(model(), options()).getAttribute("rel"), "noopener noreferrer");
});
check("origin text remains 曲", () => {
  assert.equal(createOriginLink(model(), options()).textContent, "曲");
});
check("origin default class remains stable", () => {
  assert.equal(createOriginLink(model(), options()).className, "version-origin-link");
});
check("origin aria-label is set through an attribute", () => {
  assert.equal(createOriginLink(model(), options()).getAttribute("aria-label"), options().ariaLabel);
});
check("origin title remains stable", () => {
  assert.equal(createOriginLink(model(), options()).getAttribute("title"), "原曲・本体の配布ページを開く");
});
check("origin custom text uses textContent safely", () => {
  const control = createOriginLink(model(), options({ text: "<曲&候補>" }));
  assert.equal(control.textContent, "<曲&候補>");
  assert.match(serializeControl(control), />&lt;曲&amp;候補&gt;<\/a>$/);
});
check("origin creation never uses innerHTML", () => {
  assert.doesNotThrow(() => createOriginLink(model(), options()));
});

check("available download creates an anchor", () => {
  assert.equal(createDownloadControl(model(), options()).tagName, "A");
});
check("unavailable download creates a span", () => {
  const unavailable = model({ download: { available: false, url: null, reason: "download_blocked" } });
  assert.equal(createDownloadControl(unavailable, options()).tagName, "SPAN");
});
check("available download without URL fails closed", () => {
  const invalid = model({ download: { available: true, url: null, reason: "available" } });
  assert.equal(createDownloadControl(invalid, options()).tagName, "SPAN");
});
check("null model download fails closed", () => {
  assert.equal(createDownloadControl(null, options()).tagName, "SPAN");
});
check("available download text remains DL", () => {
  assert.equal(createDownloadControl(model(), options()).textContent, "DL");
});
check("unavailable download text remains DL不可", () => {
  assert.equal(createDownloadControl(null, options()).textContent, "DL不可");
});
check("download default classes remain stable", () => {
  assert.equal(createDownloadControl(model(), options()).className, "version-download-control");
  assert.equal(createDownloadControl(null, options()).className, "version-download-control download-disabled");
});
check("download aria-label follows its availability", () => {
  const available = createDownloadControl(model(), options({ availableAriaLabel: "download available" }));
  const unavailable = createDownloadControl(null, options({ unavailableAriaLabel: "download unavailable" }));
  assert.equal(available.getAttribute("aria-label"), "download available");
  assert.equal(unavailable.getAttribute("aria-label"), "download unavailable");
});
check("download href comes from the model", () => {
  assert.equal(createDownloadControl(model(), options()).getAttribute("href"), model().download.url);
});
check("unavailable download is never a disabled anchor", () => {
  const control = createDownloadControl(null, options());
  assert.equal(control.tagName, "SPAN");
  assert.equal(control.getAttribute("href"), null);
});
check("download creation never installs a click listener", () => {
  assert.doesNotThrow(() => createDownloadControl(model(), options()));
});

check("tree variant uses final tree classes", () => {
  const available = createDownloadControl(model(), options({ variant: "tree" }));
  const unavailable = createDownloadControl(null, options({ variant: "tree" }));
  assert.equal(available.className, "version-download-control download-button download-available-control");
  assert.equal(unavailable.className, "version-download-control download-disabled download-button download-blocked-control");
});
check("compact variant uses compact classes", () => {
  const origin = createOriginLink(model(), options({ variant: "compact" }));
  const download = createDownloadControl(model(), options({ variant: "compact" }));
  assert.equal(origin.className, "compact-link-control compact-origin-link");
  assert.equal(download.className, "compact-link-control compact-download-link");
});
check("unknown variant uses the default variant", () => {
  assert.equal(createOriginLink(model(), options({ variant: "unknown" })).className, "version-origin-link");
  assert.equal(createDownloadControl(model(), options({ variant: "unknown" })).className, "version-download-control");
  assert.equal(createDownloadControl(model(), options({ variant: "__proto__" })).className, "version-download-control");
});
check("variant never changes availability", () => {
  [undefined, "tree", "compact", "unknown"].forEach((variant) => {
    assert.equal(createOriginLink(model({ originLink: { available: false, url: null } }), options({ variant })), null);
    assert.equal(createDownloadControl(null, options({ variant })).tagName, "SPAN");
  });
});

check("origin serialization preserves the existing default DOM", () => {
  const control = createOriginLink(model(), options());
  assert.equal(
    serializeControl(control),
    '<a class="version-origin-link" href="https://songs.example.test/original" target="_blank" rel="noopener noreferrer" title="原曲・本体の配布ページを開く" aria-label="ver1.0 の原曲・本体の配布ページを開く（外部サイト）">曲</a>'
  );
});
check("download serialization preserves the existing default DOM", () => {
  assert.equal(
    serializeControl(createDownloadControl(model(), { document: new FakeDocument() })),
    '<a class="version-download-control" href="https://worker.example.test/api/files/File_01">DL</a>'
  );
});
check("unavailable serialization preserves the existing default DOM", () => {
  assert.equal(
    serializeControl(createDownloadControl(null, { document: new FakeDocument() })),
    '<span class="version-download-control download-disabled">DL不可</span>'
  );
});
check("tree available serialization preserves the enhanced DOM", () => {
  const control = createDownloadControl(model(), options({
    variant: "tree",
    availableAriaLabel: "ver1.0 をダウンロード"
  }));
  assert.equal(
    serializeControl(control),
    '<a class="version-download-control download-button download-available-control" href="https://worker.example.test/api/files/File_01" aria-label="ver1.0 をダウンロード">DL</a>'
  );
});
check("tree unavailable serialization preserves the enhanced DOM", () => {
  const control = createDownloadControl(null, options({
    variant: "tree",
    unavailableAriaLabel: "ver1.0 はダウンロードできません"
  }));
  assert.equal(
    serializeControl(control),
    '<span class="version-download-control download-disabled download-button download-blocked-control" title="この版はダウンロードできません" aria-label="ver1.0 はダウンロードできません">DL不可</span>'
  );
});
check("compact origin serialization preserves the existing DOM", () => {
  const control = createOriginLink(model(), options({
    variant: "compact",
    ariaLabel: "曲名 の原曲・本体の配布ページを開く（外部サイト）"
  }));
  assert.equal(
    serializeControl(control),
    '<a class="compact-link-control compact-origin-link" href="https://songs.example.test/original" target="_blank" rel="noopener noreferrer" title="原曲・本体の配布ページを開く" aria-label="曲名 の原曲・本体の配布ページを開く（外部サイト）">曲</a>'
  );
});
check("compact download serialization preserves the existing DOM", () => {
  const control = createDownloadControl(model(), options({
    variant: "compact",
    availableAriaLabel: "曲名 / 差分名 / ver1.0 をダウンロード"
  }));
  assert.equal(
    serializeControl(control),
    '<a class="compact-link-control compact-download-link" href="https://worker.example.test/api/files/File_01" aria-label="曲名 / 差分名 / ver1.0 をダウンロード">DL</a>'
  );
});
check("compact unavailable serialization preserves the existing DOM", () => {
  const control = createDownloadControl(null, options({
    variant: "compact",
    unavailableAriaLabel: "曲名 / 差分名 / ver1.0 はダウンロードできません"
  }));
  assert.equal(
    serializeControl(control),
    '<span class="compact-link-control compact-download-disabled" aria-label="曲名 / 差分名 / ver1.0 はダウンロードできません">DL不可</span>'
  );
});
check("null serialization is empty", () => {
  assert.equal(serializeControl(null), "");
});
check("serialization escapes double quotes", () => {
  const control = createOriginLink(model(), options({ ariaLabel: '" quoted' }));
  assert.match(serializeControl(control), /aria-label="&quot; quoted"/);
});
check("serialization escapes angle brackets and ampersands", () => {
  const control = createOriginLink(model(), options({ ariaLabel: "<name>&value" }));
  assert.match(serializeControl(control), /aria-label="&lt;name&gt;&amp;value"/);
});
check("attribute injection does not create attributes or scripts", () => {
  const attack = '\"><script>alert(1)</script>\' autofocus onfocus=\'alert(1)';
  const control = createOriginLink(model(), options({ ariaLabel: attack, text: attack }));
  assert.equal(control.attributes.has("autofocus"), false);
  assert.equal(control.attributes.has("onfocus"), false);
  assert.deepEqual([...control.attributes.keys()], ["class", "href", "target", "rel", "title", "aria-label"]);
  assert.doesNotMatch(serializeControl(control), /<script>|<\/script>/i);
});

check("model is not mutated", () => {
  const input = model();
  const before = JSON.stringify(input);
  createOriginLink(input, options());
  createDownloadControl(input, options());
  assert.equal(JSON.stringify(input), before);
});
check("options are not mutated", () => {
  const input = Object.freeze({ variant: "tree", ariaLabel: "label", document: new FakeDocument() });
  const keys = Object.keys(input).join("|");
  createOriginLink(model(), input);
  assert.equal(Object.keys(input).join("|"), keys);
});
check("same input creates the same DOM attributes", () => {
  const first = createDownloadControl(model(), options({ variant: "tree", availableAriaLabel: "download" }));
  const second = createDownloadControl(model(), options({ variant: "tree", availableAriaLabel: "download" }));
  assert.equal(serializeControl(first), serializeControl(second));
});
check("same input creates separate node instances", () => {
  assert.notEqual(createOriginLink(model(), options()), createOriginLink(model(), options()));
});
check("reason is never rendered", () => {
  const input = model({ download: { available: false, url: null, reason: "secret-user-input" } });
  assert.doesNotMatch(serializeControl(createDownloadControl(input, options())), /secret-user-input/);
});
check("Link UI does not parse URLs again", () => {
  const NativeUrl = global.URL;
  global.URL = class ForbiddenUrl {
    constructor() {
      throw new Error("VersionLinkUi must not parse URLs");
    }
  };
  try {
    assert.doesNotThrow(() => createOriginLink(model(), options()));
    assert.doesNotThrow(() => createDownloadControl(model(), options()));
  } finally {
    global.URL = NativeUrl;
  }
});
check("serializer rejects elements it did not create", () => {
  assert.equal(serializeControl(new FakeElement("a")), "");
});
check("tree unavailable control preserves title and aria-label", () => {
  const control = createDownloadControl(null, options({
    variant: "tree",
    unavailableAriaLabel: "ver1.0 はダウンロードできません"
  }));
  assert.equal(control.getAttribute("title"), "この版はダウンロードできません");
  assert.equal(control.getAttribute("aria-label"), "ver1.0 はダウンロードできません");
});
check("compact unavailable control has no href or title", () => {
  const control = createDownloadControl(null, options({ variant: "compact" }));
  assert.equal(control.getAttribute("href"), null);
  assert.equal(control.getAttribute("title"), null);
});

const treeSource = fs.readFileSync(path.resolve(__dirname, "../docs/branch-tree-list.js"), "utf8");
const reconcileStart = treeSource.indexOf("function reconcileLinkControl(");
const reconcileEnd = treeSource.indexOf("\n\n  function enhanceLinkControls", reconcileStart);
assert.ok(reconcileStart >= 0 && reconcileEnd > reconcileStart, "tree reconciliation function must be extractable");
const reconcileLinkControl = Function(`return (${treeSource.slice(reconcileStart, reconcileEnd)})`)();

check("tree second enhancement keeps an identical origin node", () => {
  const existing = createOriginLink(model(), options({ variant: "tree" }));
  const desired = createOriginLink(model(), options({ variant: "tree" }));
  const actions = { insertBefore() { throw new Error("must not insert"); } };
  const result = reconcileLinkControl(actions, existing, desired, null, serializeControl(desired));
  assert.equal(result, existing);
  assert.equal(existing.replacedWith, undefined);
});
check("tree second enhancement keeps an identical download node", () => {
  const existing = createDownloadControl(model(), options({ variant: "tree", availableAriaLabel: "download" }));
  const desired = createDownloadControl(model(), options({ variant: "tree", availableAriaLabel: "download" }));
  const actions = { insertBefore() { throw new Error("must not insert"); } };
  assert.equal(reconcileLinkControl(actions, existing, desired, null, serializeControl(desired)), existing);
});
check("tree replaces available download with unavailable span once", () => {
  const existing = createDownloadControl(model(), options({ variant: "tree" }));
  const desired = createDownloadControl(null, options({ variant: "tree" }));
  assert.equal(reconcileLinkControl({}, existing, desired, null, serializeControl(desired)), desired);
  assert.equal(existing.replacedWith, desired);
  assert.equal(desired.tagName, "SPAN");
});
check("tree replaces unavailable span with available download once", () => {
  const existing = createDownloadControl(null, options({ variant: "tree" }));
  const desired = createDownloadControl(model(), options({ variant: "tree" }));
  assert.equal(reconcileLinkControl({}, existing, desired, null, serializeControl(desired)), desired);
  assert.equal(existing.replacedWith, desired);
  assert.equal(desired.tagName, "A");
});
check("tree removes an origin when the model no longer provides one", () => {
  const existing = createOriginLink(model(), options({ variant: "tree" }));
  assert.equal(reconcileLinkControl({}, existing, null, null, ""), null);
  assert.equal(existing.removeCount, 1);
});
check("tree inserts a newly available origin only once", () => {
  const desired = createOriginLink(model(), options({ variant: "tree" }));
  let insertionCount = 0;
  const actions = {
    insertBefore(element, point) {
      insertionCount += 1;
      assert.equal(element, desired);
      assert.equal(point, null);
    }
  };
  assert.equal(reconcileLinkControl(actions, null, desired, null, serializeControl(desired)), desired);
  assert.equal(insertionCount, 1);
});
check("normal top fixture matrix preserves origin and download controls", () => {
  const base = {
    id: "version_fixture",
    lifecycleStatus: "active",
    handlingMode: null,
    hidden: false,
    downloadBlocked: false,
    allowAppend: true,
    originUrl: "https://songs.example.test/original",
    file: { downloadUrl: "/api/files/File_fixture" }
  };
  const fixture = [
    { overrides: {}, origin: true, downloadTag: "A" },
    { overrides: { originUrl: null }, origin: false, downloadTag: "A" },
    { overrides: { downloadBlocked: true, file: { downloadUrl: null } }, origin: true, downloadTag: "SPAN" },
    { overrides: { originUrl: null, downloadBlocked: true, file: { downloadUrl: null } }, origin: false, downloadTag: "SPAN" },
    { overrides: { lifecycleStatus: "active" }, origin: true, downloadTag: "A" },
    {
      overrides: {
        lifecycleStatus: "withdrawal_pending",
        handlingMode: "grace_auto_delete",
        downloadBlocked: true,
        withdrawalDownloadBlocked: true,
        file: { downloadUrl: null }
      },
      origin: true,
      downloadTag: "SPAN"
    },
    {
      overrides: {
        lifecycleStatus: "withdrawal_pending",
        handlingMode: "manual_review",
        downloadBlocked: true,
        withdrawalDownloadBlocked: true,
        file: { downloadUrl: null }
      },
      origin: true,
      downloadTag: "SPAN"
    }
  ];
  fixture.forEach((item) => {
    const uiModel = buildVersionUiModel({ ...base, ...item.overrides }, {
      workerBaseUrl: "https://worker.example.test",
      hasProgressMap: true
    });
    const targetDocument = new FakeDocument();
    const origin = createOriginLink(uiModel, { document: targetDocument });
    const download = createDownloadControl(uiModel, { document: targetDocument });
    assert.equal(Boolean(origin), item.origin);
    assert.equal(download.tagName, item.downloadTag);
  });
});

let performanceMetrics;
check("eight-version integration builds one model and two controls per version", () => {
  const fixture = Array.from({ length: 8 }, (_, index) => ({
    id: `version_${index}`,
    lifecycleStatus: "active",
    handlingMode: null,
    hidden: false,
    downloadBlocked: false,
    allowAppend: true,
    originUrl: `https://songs.example.test/original-${index}`,
    file: { downloadUrl: `/api/files/File_${index}` }
  }));
  const targetDocument = new FakeDocument();
  const NativeUrl = global.URL;
  let modelBuildCount = 0;
  let urlParseCount = 0;
  let originNodeCount = 0;
  let downloadNodeCount = 0;
  const serialized = [];
  global.URL = class CountingUrl extends NativeUrl {
    constructor(value, base) {
      urlParseCount += 1;
      super(value, base);
    }
  };
  try {
    fixture.forEach((version) => {
      modelBuildCount += 1;
      const uiModel = buildVersionUiModel(version, {
        workerBaseUrl: "https://worker.example.test",
        hasProgressMap: true
      });
      const origin = createOriginLink(uiModel, {
        document: targetDocument,
        ariaLabel: `${version.id} の原曲・本体の配布ページを開く（外部サイト）`
      });
      const download = createDownloadControl(uiModel, { document: targetDocument });
      originNodeCount += origin ? 1 : 0;
      downloadNodeCount += download ? 1 : 0;
      serialized.push(serializeControl(origin), serializeControl(download));
    });
  } finally {
    global.URL = NativeUrl;
  }
  performanceMetrics = {
    versionCount: fixture.length,
    modelBuildCount,
    originNodeCount,
    downloadNodeCount,
    urlParseCount,
    htmlBytes: Buffer.byteLength(serialized.join(""), "utf8")
  };
  assert.deepEqual(performanceMetrics, {
    versionCount: 8,
    modelBuildCount: 8,
    originNodeCount: 8,
    downloadNodeCount: 8,
    urlParseCount: 24,
    htmlBytes: 2880
  });
  assert.equal(targetDocument.createdCount, 16);
});

assert.ok(passed >= 40, `expected at least 40 checks, got ${passed}`);
console.log(`version link ui tests: ${passed} checks passed`);
console.log(`version link ui performance fixture: ${JSON.stringify(performanceMetrics)}`);
