"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const docsRoot = path.join(root, "docs");
const themes = ["white", "default", "dark"];
const widths = [390, 760, 1366];
const apiPort = 8788;
const tolerance = 0.25;
const startedAt = process.hrtime.bigint();
const detailControlSelectors = {
  appendAvailable: '.version-row[data-version-id="version-active"] .append-version-button',
  appendStopped: ".append-policy-disabled-button",
  appendUnavailable: ".css-regression-append-unavailable",
  appendLegacy: ".css-regression-append-legacy",
  appendIntermediate: ".css-regression-append-intermediate",
  management: '.version-row[data-version-id="version-active"] .version-management-button',
  downloadUnavailable: '.version-row[data-version-id="version-download-blocked"] .download-blocked-control',
  genericSecondaryDisabled: ".css-regression-generic-secondary-disabled",
  withdrawalActionDisabled: ".css-regression-withdrawal-action-disabled"
};

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const writeSnapshotPath = option("--write-snapshot");
const compareSnapshotPath = option("--compare-snapshot");

function createProgressMap(progress = 50) {
  return {
    schemaVersion: 2,
    blockMode: "standardized_measure",
    progress,
    blocks: Array.from({ length: 8 }, (_, index) => ({
      startMeasure: index * 4,
      endMeasure: (index * 4) + 3,
      startTimeSec: index * 5,
      endTimeSec: (index + 1) * 5,
      playNotes: 20 + (index * 4)
    })),
    layers: [{ kind: "initial", versionId: "version-active", color: "#27896b", ranges: [[0, 3]] }]
  };
}

function createVersion(id, overrides = {}) {
  return {
    id,
    versionId: id,
    parentVersionId: id === "version-active" ? null : "version-active",
    displayVersion: id === "version-active" ? "ver1.0" : `ver1.${id.length}`,
    branchPath: id === "version-active" ? "1" : `1.${id.length}`,
    difficulty: "★12",
    author: "監査用譜面作者",
    progress: 50,
    comment: "CSS回帰監査用コメント",
    createdAt: "2026-07-25T01:00:00.000Z",
    isRejected: false,
    hidden: false,
    publicDataRedacted: false,
    publicActionsHidden: false,
    canShowActions: true,
    lifecycleStatus: "active",
    handlingMode: null,
    scheduledAt: null,
    downloadBlocked: false,
    withdrawalDownloadBlocked: false,
    downloadAvailable: true,
    allowAppend: true,
    appendAvailable: true,
    managementAvailable: true,
    collapsedByCompletion: false,
    collapsedReason: "",
    originUrl: `https://example.com/${id}`,
    file: { downloadUrl: `http://localhost:${apiPort}/api/files/${id}` },
    progressMap: createProgressMap(50),
    ...overrides
  };
}

const versions = [
  createVersion("version-active"),
  createVersion("version-append-off", { allowAppend: false, appendAvailable: false, progress: 62 }),
  createVersion("version-download-blocked", {
    downloadBlocked: true,
    downloadAvailable: false,
    file: { downloadUrl: null },
    progress: 70
  }),
  ...Array.from({ length: 7 }, (_, index) => createVersion(`version-depth-${index + 1}`, {
    progress: 40 + index
  })),
  createVersion("version-grace", {
    lifecycleStatus: "withdrawal_pending",
    handlingMode: "grace_auto_delete",
    scheduledAt: "2026-08-01T01:00:00.000Z",
    withdrawalDownloadBlocked: true,
    downloadAvailable: false,
    file: { downloadUrl: null },
    progress: 100,
    progressMap: createProgressMap(100)
  }),
  createVersion("version-manual", {
    lifecycleStatus: "withdrawal_pending",
    handlingMode: "manual_review",
    scheduledAt: null,
    withdrawalDownloadBlocked: true,
    downloadAvailable: false,
    file: { downloadUrl: null },
    isRejected: true,
    progress: 82
  }),
  createVersion("version-immediate", {
    lifecycleStatus: "withdrawal_pending",
    handlingMode: "immediate_delete",
    scheduledAt: null,
    withdrawalDownloadBlocked: true,
    downloadAvailable: false,
    file: { downloadUrl: null },
    progress: 88
  }),
  createVersion("version-processing", {
    lifecycleStatus: "processing",
    publicDataRedacted: true,
    publicActionsHidden: true,
    canShowActions: false,
    downloadBlocked: true,
    downloadAvailable: false,
    appendAvailable: false,
    managementAvailable: false,
    file: { downloadUrl: null },
    originUrl: null,
    progressMap: null
  }),
  createVersion("version-tombstoned", {
    lifecycleStatus: "tombstoned",
    publicDataRedacted: true,
    publicActionsHidden: true,
    canShowActions: false,
    downloadBlocked: true,
    downloadAvailable: false,
    appendAvailable: false,
    managementAvailable: false,
    file: { downloadUrl: null },
    originUrl: null,
    progressMap: null
  }),
  createVersion("version-deleted", {
    lifecycleStatus: "deleted",
    publicActionsHidden: true,
    canShowActions: false,
    downloadBlocked: true,
    downloadAvailable: false,
    appendAvailable: false,
    managementAvailable: false,
    file: { downloadUrl: null },
    originUrl: null,
    progressMap: null
  })
];

versions.forEach((version, index) => {
  version.parentVersionId = index === 0 ? null : versions[index - 1].id;
  version.branchPath = index === 0 ? "root" : `root/${Array.from({ length: index }, () => "a").join("/")}`;
  version.displayVersion = index === 0 ? "ver1.0" : `ver1.${index}`;
});
versions.find((version) => version.id === "version-immediate").displayVersion = "ver1.12-long-mobile-label";
const imageFixtureVersion = versions.find((version) => version.id === "version-depth-1");
imageFixtureVersion.progressMap = null;
imageFixtureVersion.progressImage = {
  url: `/api/progress-images/${imageFixtureVersion.id}`,
  mime: "image/png",
  size: 68,
  sha256: "fixture",
  createdAt: "2026-07-25T01:30:00.000Z"
};

const chartEntry = {
  song: { id: "song-audit", title: "CSS回帰監査用の長い曲名", artist: "監査用アーティスト" },
  chart: { id: "chart-audit", chartId: "chart-audit", name: "監査用差分" },
  versions
};

const compactItems = [
  {
    ...versions[0],
    chartId: "chart-audit",
    title: "CSS回帰監査用の長い曲名",
    subtitle: "SUBTITLE",
    chartName: "監査用差分",
    versionLabel: "BASE",
    hasComment: true,
    commentPreview: "コンパクト一覧回帰確認",
    chartUpdatedAt: "2026-07-25T02:00:00.000Z",
    isNew: true,
    withdrawn: false,
    deleteRequested: false
  },
  {
    ...versions[3],
    chartId: "chart-audit",
    title: "DL停止中の曲",
    subtitle: "",
    chartName: "監査用差分2",
    versionLabel: "v2",
    hasComment: false,
    commentPreview: "",
    chartUpdatedAt: "2026-07-24T02:00:00.000Z",
    isNew: false,
    withdrawn: false,
    deleteRequested: true
  }
];

function json(response, status, body) {
  response.statusCode = status;
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function createApiServer() {
  return http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/api/charts/chart-audit") {
      json(response, 200, { serverTime: "2026-07-25T03:00:00.000Z", charts: [chartEntry] });
      return;
    }
    if (request.method === "GET" && request.url === `/api/progress-images/${imageFixtureVersion.id}`) {
      response.statusCode = 200;
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Content-Type", "image/png");
      response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzW0QAAAABJRU5ErkJggg==", "base64"));
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/api/charts?")) {
      json(response, 200, {
        serverTime: "2026-07-25T03:00:00.000Z",
        charts: [],
        pagination: { page: 1, pageSize: 8, total: 0, hasNext: false }
      });
      return;
    }
    if ((request.method === "GET" && request.url.startsWith("/api/versions?"))
      || (request.method === "POST" && request.url === "/api/versions/query")) {
      json(response, 200, {
        serverTime: "2026-07-25T03:00:00.000Z",
        items: compactItems,
        pagination: { page: 1, pageSize: 20, total: compactItems.length, hasNext: false },
        unavailableFavoriteCount: 0
      });
      return;
    }
    json(response, 404, { code: "NOT_FOUND", message: "fixture endpoint not found", detail: null });
  });
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".ico", "image/x-icon"]
]);

function createStaticServer() {
  return http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (requestPath === "/favicon.ico") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const filePath = path.resolve(docsRoot, relativePath);
    if (filePath !== docsRoot && !filePath.startsWith(`${docsRoot}${path.sep}`)) {
      response.statusCode = 403;
      response.end("forbidden");
      return;
    }
    try {
      let body = fs.readFileSync(filePath);
      if (relativePath === "index.html") {
        const source = body.toString("utf8");
        const marker = '<div class="section-heading recent-chart-heading">';
        const favoriteFilterFixture = `
          <div class="list-toolbar" id="css-regression-favorite-toolbar">
            <button class="favorite-filter-toggle" id="favoriteFilterToggle" type="button" aria-pressed="false">☆ お気に入りのみ</button>
          </div>
        `;
        assert.ok(source.includes(marker), "favorite filter fixture marker is missing");
        body = Buffer.from(source.replace(marker, `${favoriteFilterFixture}${marker}`), "utf8");
      }
      response.statusCode = 200;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream");
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end("not found");
    }
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function browserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(executable, "Chrome or Edge executable was not found; set CHROME_PATH");
  return executable;
}

class CdpConnection {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
        else resolve(message.result || {});
        return;
      }
      this.listeners.forEach((listener) => listener(message));
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.sequence += 1;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.socket.close();
  }
}

async function waitForDebugger(port) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description
      || response.exceptionDetails.exception?.value
      || response.exceptionDetails.text
      || "browser evaluation failed";
    throw new Error(String(detail));
  }
  return response.result.value;
}

async function waitFor(cdp, sessionId, expression, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  const diagnostic = await evaluate(cdp, sessionId, `({
    readyState: document.readyState,
    versionRows: document.querySelectorAll(".version-row").length,
    thumbnails: document.querySelectorAll(".thumbnail-cell .progress-thumbnail").length,
    compactRows: document.querySelectorAll(".compact-version-row").length,
    progressStyle: Boolean(document.querySelector("#progress-image-thumbnail-style")),
    favoriteRuntimeStyle: Boolean(document.querySelector("#favoriteListStyles")),
    favoriteStylesheet: [...document.styleSheets].some((sheet) => sheet.href && new URL(sheet.href).pathname.endsWith("/favorites-list.css")),
    bodyText: document.body?.innerText?.slice(0, 500) || ""
  })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function installControlFixtures(cdp, sessionId) {
  await evaluate(cdp, sessionId, `(() => {
    const existing = document.querySelector("#css-regression-control-fixtures");
    if (existing) return true;
    const actionUi = window.BmsVersionActionUi;
    if (typeof actionUi?.createAppendControl !== "function") {
      throw new Error("version Action UI is unavailable for CSS control fixtures");
    }
    const host = document.createElement("div");
    host.id = "css-regression-control-fixtures";
    host.className = "version-actions";
    host.setAttribute("aria-label", "CSS regression controls");
    const fixtureModel = (reason, label, available = false) => ({
      canShowActions: true,
      versionId: "css-regression-fixture",
      append: {
        available,
        allowedByPolicy: reason !== "append_disabled",
        hasProgressMap: reason !== "legacy_progress_map",
        label,
        reason
      }
    });
    const appendUnavailable = actionUi.createAppendControl(
      fixtureModel("inconsistent_data", "\u8ffd\u8a18\u4e0d\u53ef")
    );
    appendUnavailable.classList.add("css-regression-append-unavailable");
    const appendLegacy = actionUi.createAppendControl(
      fixtureModel("legacy_progress_map", "\u65e7\u5f62\u5f0f")
    );
    appendLegacy.classList.add("css-regression-append-legacy");
    const appendIntermediate = actionUi.createAppendControl(
      fixtureModel("superseded_intermediate", "\u8ffd\u8a18\u4e0d\u53ef")
    );
    appendIntermediate.classList.add("css-regression-append-intermediate");
    const genericDisabled = document.createElement("button");
    genericDisabled.className = "secondary css-regression-generic-secondary-disabled";
    genericDisabled.type = "button";
    genericDisabled.disabled = true;
    genericDisabled.textContent = "Generic disabled";
    const withdrawalDisabled = document.createElement("button");
    withdrawalDisabled.className = "version-withdrawal-action-button css-regression-withdrawal-action-disabled";
    withdrawalDisabled.type = "button";
    withdrawalDisabled.disabled = true;
    withdrawalDisabled.textContent = "Withdrawal disabled";
    host.append(appendUnavailable, appendLegacy, appendIntermediate, genericDisabled, withdrawalDisabled);
    document.body.appendChild(host);
    const favoriteSource = document.querySelector('.version-row[data-version-id="version-active"] .favorite-version-button');
    const favoriteRoot = document.querySelector("#list");
    if (!favoriteSource || !favoriteRoot) {
      throw new Error("favorite duplicate fixture source is unavailable");
    }
    const favoriteDuplicateHost = document.createElement("div");
    favoriteDuplicateHost.id = "css-regression-favorite-duplicate-host";
    favoriteDuplicateHost.hidden = true;
    const favoriteDuplicate = favoriteSource.cloneNode(true);
    favoriteDuplicate.classList.add("css-regression-favorite-duplicate");
    favoriteDuplicateHost.appendChild(favoriteDuplicate);
    favoriteRoot.appendChild(favoriteDuplicateHost);
    return true;
  })()`);
}

function browserStyleExpression(selector) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const round = (value) => Number(Number(value || 0).toFixed(3));
    const colorChannels = (value) => {
      const channels = String(value || "").match(/[\\d.]+/g)?.map(Number) || [];
      return channels.length >= 3 ? channels : null;
    };
    const luminance = (channels) => {
      const linear = channels.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
    };
    const contrast = (first, second) => {
      const firstChannels = colorChannels(first);
      const secondChannels = colorChannels(second);
      if (!firstChannels || !secondChannels) return null;
      const firstLuminance = luminance(firstChannels);
      const secondLuminance = luminance(secondChannels);
      return round((Math.max(firstLuminance, secondLuminance) + 0.05)
        / (Math.min(firstLuminance, secondLuminance) + 0.05));
    };
    const effectiveBackground = (start) => {
      let current = start;
      while (current) {
        const value = getComputedStyle(current).backgroundColor;
        const channels = colorChannels(value);
        if (channels && (channels.length < 4 || channels[3] > 0)) return value;
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const backgroundColor = style.backgroundColor;
    const backgroundChannels = colorChannels(backgroundColor);
    const visibleBackgroundColor = backgroundChannels && backgroundChannels.length >= 4 && backgroundChannels[3] === 0
      ? effectiveBackground(element.parentElement)
      : backgroundColor;
    const surroundingBackgroundColor = effectiveBackground(element.parentElement);
    return {
      tagName: element.tagName,
      className: String(element.className || ""),
      text: String(element.textContent || "").trim(),
      ariaPressed: element.getAttribute("aria-pressed"),
      ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      backgroundColor,
      visibleBackgroundColor,
      surroundingBackgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      opacity: style.opacity,
      cursor: style.cursor,
      display: style.display,
      width: style.width,
      height: style.height,
      contrastRatio: contrast(style.color, visibleBackgroundColor),
      borderContrastRatio: contrast(style.borderColor, surroundingBackgroundColor),
      outlineContrastRatio: contrast(style.outlineColor, surroundingBackgroundColor),
      rect: {
        left: round(rect.left), right: round(rect.right), top: round(rect.top), bottom: round(rect.bottom),
        width: round(rect.width), height: round(rect.height)
      },
      viewportClip: {
        left: round(Math.max(0, -rect.left)),
        right: round(Math.max(0, rect.right - document.documentElement.clientWidth)),
        top: round(Math.max(0, -rect.top)),
        bottom: round(Math.max(0, rect.bottom - innerHeight))
      }
    };
  })()`;
}

async function captureBrowserStyle(cdp, sessionId, selector) {
  return evaluate(cdp, sessionId, browserStyleExpression(selector));
}

async function captureForcedPseudoStyle(cdp, sessionId, selector, pseudoClass) {
  const { root: documentNode } = await cdp.send("DOM.getDocument", { depth: 0, pierce: true }, sessionId);
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: documentNode.nodeId,
    selector
  }, sessionId);
  assert.ok(nodeId, `control fixture is missing for ${selector}`);
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [pseudoClass] }, sessionId);
  try {
    const style = await captureBrowserStyle(cdp, sessionId, selector);
    style.matches = await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(selector)}).matches(${JSON.stringify(`:${pseudoClass}`)})`);
    style.boxShadow = await evaluate(cdp, sessionId, `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).boxShadow`);
    return style;
  } finally {
    await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }, sessionId);
  }
}

async function clickAndSettle(cdp, sessionId, selector) {
  await evaluate(cdp, sessionId, `(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("interaction fixture is missing");
    element.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function captureFavoriteInteractions(cdp, sessionId) {
  const filterSelector = "#favoriteFilterToggle";
  const starSelector = '.version-row[data-version-id="version-active"] .favorite-version-button';
  const duplicateSelector = ".css-regression-favorite-duplicate";
  const storageKey = "bms-wip-charts:favorites:v1";
  const resourceCount = () => evaluate(cdp, sessionId, `performance.getEntriesByType("resource")
    .filter((entry) => new URL(entry.name).pathname === "/api/charts").length`);

  if (await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(filterSelector)}).classList.contains("is-active")`)) {
    await clickAndSettle(cdp, sessionId, filterSelector);
  }
  if (await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(starSelector)}).classList.contains("is-favorite")`)) {
    await clickAndSettle(cdp, sessionId, starSelector);
  }

  const beforeResources = await resourceCount();
  const filterIdle = await captureBrowserStyle(cdp, sessionId, filterSelector);
  const filterHover = await captureForcedPseudoStyle(cdp, sessionId, filterSelector, "hover");
  const filterFocus = await captureForcedPseudoStyle(cdp, sessionId, filterSelector, "focus-visible");
  await clickAndSettle(cdp, sessionId, filterSelector);
  const filterActive = await captureBrowserStyle(cdp, sessionId, filterSelector);
  const filterActiveHover = await captureForcedPseudoStyle(cdp, sessionId, filterSelector, "hover");
  const filterActiveFocus = await captureForcedPseudoStyle(cdp, sessionId, filterSelector, "focus-visible");
  const filterOn = await evaluate(cdp, sessionId, `(() => {
    const button = document.querySelector(${JSON.stringify(filterSelector)});
    return { active: button.classList.contains("is-active"), ariaPressed: button.getAttribute("aria-pressed"), text: button.textContent, title: button.title };
  })()`);
  await clickAndSettle(cdp, sessionId, filterSelector);
  const filterOff = await evaluate(cdp, sessionId, `(() => {
    const button = document.querySelector(${JSON.stringify(filterSelector)});
    return { active: button.classList.contains("is-active"), ariaPressed: button.getAttribute("aria-pressed"), text: button.textContent, title: button.title };
  })()`);

  const starIdle = await captureBrowserStyle(cdp, sessionId, starSelector);
  const starHover = await captureForcedPseudoStyle(cdp, sessionId, starSelector, "hover");
  const starFocus = await captureForcedPseudoStyle(cdp, sessionId, starSelector, "focus-visible");
  await clickAndSettle(cdp, sessionId, starSelector);
  const starFavorite = await captureBrowserStyle(cdp, sessionId, starSelector);
  const starFavoriteHover = await captureForcedPseudoStyle(cdp, sessionId, starSelector, "hover");
  const starFavoriteFocus = await captureForcedPseudoStyle(cdp, sessionId, starSelector, "focus-visible");
  const storageAfterAdd = await evaluate(cdp, sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}) || "{}")`);
  const favoriteOn = await evaluate(cdp, sessionId, `(() => {
    const button = document.querySelector(${JSON.stringify(starSelector)});
    const duplicate = document.querySelector(${JSON.stringify(duplicateSelector)});
    return {
      active: button.classList.contains("is-favorite"),
      rowActive: button.closest(".version-row").classList.contains("is-favorite-version"),
      ariaPressed: button.getAttribute("aria-pressed"), ariaLabel: button.getAttribute("aria-label"),
      text: button.textContent, title: button.title,
      duplicateActive: duplicate.classList.contains("is-favorite"), duplicateAriaPressed: duplicate.getAttribute("aria-pressed"), duplicateText: duplicate.textContent
    };
  })()`);
  await clickAndSettle(cdp, sessionId, starSelector);
  const storageAfterRemove = await evaluate(cdp, sessionId, `JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}) || "{}")`);
  const favoriteOff = await evaluate(cdp, sessionId, `(() => {
    const button = document.querySelector(${JSON.stringify(starSelector)});
    const duplicate = document.querySelector(${JSON.stringify(duplicateSelector)});
    return {
      active: button.classList.contains("is-favorite"),
      rowActive: button.closest(".version-row").classList.contains("is-favorite-version"),
      ariaPressed: button.getAttribute("aria-pressed"), ariaLabel: button.getAttribute("aria-label"),
      text: button.textContent, title: button.title,
      duplicateActive: duplicate.classList.contains("is-favorite"), duplicateAriaPressed: duplicate.getAttribute("aria-pressed"), duplicateText: duplicate.textContent
    };
  })()`);
  const afterResources = await resourceCount();
  const toolbar = await captureBrowserStyle(cdp, sessionId, "#css-regression-favorite-toolbar");
  const runtimeStyles = await evaluate(cdp, sessionId, `({
    favorite: document.querySelectorAll("#favoriteListStyles").length,
    progress: document.querySelectorAll("#progress-image-thumbnail-style").length,
    total: document.querySelectorAll("style").length
  })`);
  return {
    filterIdle, filterHover, filterFocus, filterActive, filterActiveHover, filterActiveFocus,
    starIdle, starHover, starFocus, starFavorite, starFavoriteHover, starFavoriteFocus,
    behavior: { filterOn, filterOff, favoriteOn, favoriteOff, storageAfterAdd, storageAfterRemove, chartFetchDelta: afterResources - beforeResources },
    toolbar,
    runtimeStyles
  };
}

async function captureControlInteractions(cdp, sessionId) {
  const interactions = {};
  for (const [name, selector] of Object.entries(detailControlSelectors)) {
    const programmatic = await evaluate(cdp, sessionId, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const wasDisabled = element.matches(":disabled");
      let clickEvents = 0;
      const listener = () => { clickEvents += 1; };
      if (wasDisabled) element.addEventListener("click", listener);
      element.focus({ preventScroll: true });
      const activeAfterFocus = document.activeElement === element;
      if (wasDisabled) element.click();
      if (wasDisabled) element.removeEventListener("click", listener);
      element.blur();
      return { activeAfterFocus, clickEvents, inlineClickHandler: typeof element.onclick === "function" };
    })()`);
    interactions[name] = {
      programmatic,
      hover: await captureForcedPseudoStyle(cdp, sessionId, selector, "hover"),
      focusVisible: await captureForcedPseudoStyle(cdp, sessionId, selector, "focus-visible"),
      active: await captureForcedPseudoStyle(cdp, sessionId, selector, "active")
    };
  }
  return interactions;
}

function captureExpression(pageKind) {
  return `(async () => {
    const round = (value) => Number(Number(value || 0).toFixed(3));
    const colorChannels = (value) => {
      const channels = String(value || "").match(/[\\d.]+/g)?.map(Number) || [];
      if (channels.length < 3) return null;
      return channels.slice(0, 3);
    };
    const luminance = (channels) => {
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
    };
    const contrast = (first, second) => {
      const firstChannels = colorChannels(first);
      const secondChannels = colorChannels(second);
      if (!firstChannels || !secondChannels) return null;
      const firstLuminance = luminance(firstChannels);
      const secondLuminance = luminance(secondChannels);
      return round((Math.max(firstLuminance, secondLuminance) + 0.05)
        / (Math.min(firstLuminance, secondLuminance) + 0.05));
    };
    const effectiveBackground = (element) => {
      let current = element;
      while (current) {
        const value = getComputedStyle(current).backgroundColor;
        const channels = String(value || "").match(/[\\d.]+/g)?.map(Number) || [];
        if (channels.length >= 3 && (channels.length < 4 || channels[3] > 0)) return value;
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const rectValue = (rect) => ({
      left: round(rect.left),
      right: round(rect.right),
      top: round(rect.top),
      bottom: round(rect.bottom),
      width: round(rect.width),
      height: round(rect.height)
    });
    const clipAgainst = (rect, containerRect) => ({
      left: round(Math.max(0, containerRect.left - rect.left)),
      right: round(Math.max(0, rect.right - containerRect.right)),
      top: round(Math.max(0, containerRect.top - rect.top)),
      bottom: round(Math.max(0, rect.bottom - containerRect.bottom))
    });
    const describe = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const parentRect = element.parentElement?.getBoundingClientRect?.() || rect;
      const surroundingBackgroundColor = effectiveBackground(element.parentElement);
      return {
        tagName: element.tagName,
        className: String(element.className || ""),
        dataVersionId: element.closest(".version-row")?.dataset.versionId || "",
        text: String(element.textContent || "").trim(),
        type: element.getAttribute("type"),
        disabled: element.matches(":disabled"),
        ariaDisabled: element.getAttribute("aria-disabled"),
        ariaDescribedBy: element.getAttribute("aria-describedby"),
        inlineClickHandler: typeof element.onclick === "function",
        display: style.display,
        flex: style.flex,
        flexBasis: style.flexBasis,
        flexWrap: style.flexWrap,
        width: style.width,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        height: style.height,
        position: style.position,
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        whiteSpace: style.whiteSpace,
        gap: style.gap,
        gridTemplateColumns: style.gridTemplateColumns,
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        borderStyle: style.borderStyle,
        borderWidth: style.borderWidth,
        opacity: style.opacity,
        cursor: style.cursor,
        boxShadow: style.boxShadow,
        outline: style.outline,
        pointerEvents: style.pointerEvents,
        surroundingBackgroundColor,
        contrastRatio: contrast(style.color, style.backgroundColor),
        borderContrastRatio: contrast(style.borderColor, surroundingBackgroundColor),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        rect: rectValue(rect),
        parentRect: { width: round(parentRect.width), height: round(parentRect.height) },
        parentClip: clipAgainst(rect, parentRect),
        viewportClip: {
          left: round(Math.max(0, -rect.left)),
          right: round(Math.max(0, rect.right - document.documentElement.clientWidth))
        }
      };
    };
    const inspect = (selector) => [...document.querySelectorAll(selector)].map(describe);
    const selectors = ${pageKind === "detail" ? JSON.stringify({
      versionRows: ".version-row",
      actions: ".version-actions",
      originLinks: ".version-origin-link",
      downloads: ".version-download-control",
      appendControls: ".append-version-button, .append-policy-disabled-button, .append-disabled-intermediate",
      managementControls: ".version-management-button",
      lifecycle: ".withdrawal-pending-badge, .withdrawal-processing-badge, .withdrawal-tombstone-badge",
      stateBadgeGroups: ".version-state-badges",
      titleLines: ".version-title-line",
      labelStacks: ".version-label-stack",
      treeCells: ".version-tree-cell",
      favorites: ".favorite-version-button",
      thumbnailCells: ".thumbnail-cell",
      thumbnails: ".thumbnail-cell .progress-thumbnail",
      graphs: ".progress-thumbnail-graph",
      imageWraps: ".progress-thumbnail-image-wrap"
    }) : JSON.stringify({
      compactRows: ".compact-version-row",
      originLinks: ".compact-origin-link",
      downloads: ".compact-download-link, .compact-download-disabled"
    })};
    const elements = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, inspect(selector)]));
    const controls = ${pageKind === "detail"
      ? `Object.fromEntries(Object.entries(${JSON.stringify(detailControlSelectors)}).map(([name, selector]) => [name, describe(document.querySelector(selector))]))`
      : "{}"};
    const lifecycleGeometry = [];
    if (${JSON.stringify(pageKind)} === "detail") {
      const badgeSelector = ".withdrawal-pending-badge, .withdrawal-processing-badge, .withdrawal-tombstone-badge";
      const containerSelectors = [
        ".version-state-badges",
        ".version-title-line",
        ".version-label-stack",
        ".version-tree-cell",
        ".version-row"
      ];
      for (const badge of document.querySelectorAll(badgeSelector)) {
        const initialRect = badge.getBoundingClientRect();
        scrollTo(0, Math.max(0, scrollY + initialRect.top - ((innerHeight - initialRect.height) / 2)));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const badgeRect = badge.getBoundingClientRect();
        const badgeStyle = getComputedStyle(badge);
        const containers = {};
        for (const selector of containerSelectors) {
          const container = badge.closest(selector);
          if (!container) continue;
          const rect = container.getBoundingClientRect();
          const style = getComputedStyle(container);
          containers[selector] = {
            text: String(container.textContent || "").trim(),
            rect: rectValue(rect),
            clip: clipAgainst(badgeRect, rect),
            clientWidth: container.clientWidth,
            scrollWidth: container.scrollWidth,
            clientHeight: container.clientHeight,
            scrollHeight: container.scrollHeight,
            flex: style.flex,
            flexBasis: style.flexBasis,
            flexWrap: style.flexWrap,
            minWidth: style.minWidth,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            whiteSpace: style.whiteSpace
          };
        }
        const viewportRect = { left: 0, right: document.documentElement.clientWidth, top: 0, bottom: innerHeight };
        lifecycleGeometry.push({
          dataVersionId: badge.closest(".version-row")?.dataset.versionId || "",
          className: String(badge.className || ""),
          text: String(badge.textContent || "").trim(),
          rect: rectValue(badgeRect),
          viewportRect,
          viewportClip: clipAgainst(badgeRect, viewportRect),
          clientWidth: badge.clientWidth,
          scrollWidth: badge.scrollWidth,
          clientHeight: badge.clientHeight,
          scrollHeight: badge.scrollHeight,
          flexWrap: badgeStyle.flexWrap,
          flexBasis: badgeStyle.flexBasis,
          minWidth: badgeStyle.minWidth,
          overflowX: badgeStyle.overflowX,
          overflowY: badgeStyle.overflowY,
          whiteSpace: badgeStyle.whiteSpace,
          containers
        });
      }
      scrollTo(0, 0);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    let detailTarget = null;
    let focusVisible = null;
    if (${JSON.stringify(pageKind)} === "detail") {
      const target = document.querySelector('.version-row[data-version-id="version-active"]') || document.querySelector(".version-row");
      if (target) {
        target.classList.add("is-detail-target");
        const style = getComputedStyle(target);
        detailTarget = { backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.color };
        target.classList.remove("is-detail-target");
      }
      const focusTarget = document.querySelector(".version-origin-link");
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
        const focusStyle = getComputedStyle(focusTarget);
        focusVisible = {
          matches: focusTarget.matches(":focus-visible"),
          outlineStyle: focusStyle.outlineStyle,
          outlineWidth: focusStyle.outlineWidth,
          outlineColor: focusStyle.outlineColor,
          outlineOffset: focusStyle.outlineOffset
        };
        focusTarget.blur();
      }
    }
    const pending = elements.lifecycle?.find((item) => item.className.includes("withdrawal-pending-badge")) || null;
    const processing = elements.lifecycle?.find((item) => item.className.includes("withdrawal-processing-badge")) || null;
    const appendStoppedElement = document.querySelector(".append-policy-disabled-button");
    const appendStoppedStyle = appendStoppedElement ? getComputedStyle(appendStoppedElement) : null;
    const favoriteStyle = document.querySelector(".favorite-version-button")
      ? getComputedStyle(document.querySelector(".favorite-version-button"))
      : null;
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      pageKind: ${JSON.stringify(pageKind)},
      theme: document.documentElement.dataset.theme,
      viewport: { innerWidth, clientWidth: document.documentElement.clientWidth },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      },
      counts: Object.fromEntries(Object.entries(elements).map(([name, items]) => [name, items.length])),
      elements,
      controls,
      lifecycleGeometry,
      focusVisible,
      known: {
        pendingViewportClip: pending?.viewportClip?.right || 0,
        processingViewportClip: processing?.viewportClip?.right || 0,
        appendStopped: appendStoppedStyle ? { backgroundColor: appendStoppedStyle.backgroundColor, color: appendStoppedStyle.color } : null,
        favoriteIdle: favoriteStyle ? { backgroundColor: favoriteStyle.backgroundColor, color: favoriteStyle.color } : null,
        detailTarget
      },
      overlay: (() => {
        const element = document.querySelector(".version-tree-overlay, .tree-overlay, .tree-connector-overlay, svg.tree-progress-overlay");
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: round(rect.left), right: round(rect.right), width: round(rect.width) };
      })(),
      detailCardWidth: round(document.querySelector(".selected-chart-section .chart-group")?.getBoundingClientRect().width || 0),
      navigationDurationMs: round(navigation?.duration || 0)
    };
  })()`;
}

async function setTheme(cdp, sessionId, theme) {
  await evaluate(cdp, sessionId, `(() => {
    const select = document.querySelector('select[aria-label="表示テーマ"]');
    if (!select) throw new Error("theme select missing");
    select.value = ${JSON.stringify(theme)};
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return document.documentElement.dataset.theme;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function captureMatrix(cdp, sessionId, pageKind) {
  const matrix = [];
  const captureStart = process.hrtime.bigint();
  for (const theme of themes) {
    await setTheme(cdp, sessionId, theme);
    for (const width of widths) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      }, sessionId);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const expression = captureExpression(pageKind);
      try {
        const entry = { requestedTheme: theme, requestedWidth: width, ...(await evaluate(cdp, sessionId, expression)) };
        if (pageKind === "detail") {
          entry.controlInteractions = await captureControlInteractions(cdp, sessionId);
          entry.favoriteInteractions = await captureFavoriteInteractions(cdp, sessionId);
        }
        matrix.push(entry);
      } catch (error) {
        error.message = `${error.message}\nCapture expression:\n${expression}`;
        throw error;
      }
    }
  }
  return {
    matrix,
    computedCaptureMs: Number(process.hrtime.bigint() - captureStart) / 1e6
  };
}

function findResult(matrix, theme, width) {
  return matrix.find((entry) => entry.requestedTheme === theme && entry.requestedWidth === width);
}

const untouchedControlColors = {
  white: {
    appendAvailable: ["rgb(232, 239, 237)", "rgb(25, 77, 63)", "rgb(158, 174, 169)"],
    appendUnavailable: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(207, 216, 213)"],
    appendLegacy: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(207, 216, 213)"],
    appendIntermediate: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(207, 216, 213)"],
    management: ["rgb(232, 239, 237)", "rgb(25, 77, 63)", "rgb(158, 174, 169)"],
    downloadUnavailable: ["rgb(227, 233, 231)", "rgb(111, 123, 119)", "rgb(207, 216, 213)"],
    genericSecondaryDisabled: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(207, 216, 213)"],
    withdrawalActionDisabled: ["rgb(227, 233, 231)", "rgb(111, 123, 119)", "rgb(207, 216, 213)"]
  },
  default: {
    appendAvailable: ["rgb(219, 230, 226)", "rgb(23, 76, 62)", "rgb(129, 151, 143)"],
    appendUnavailable: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    appendLegacy: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    appendIntermediate: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    management: ["rgb(219, 230, 226)", "rgb(23, 76, 62)", "rgb(129, 151, 143)"],
    downloadUnavailable: ["rgb(198, 208, 205)", "rgb(101, 114, 110)", "rgb(170, 185, 180)"],
    genericSecondaryDisabled: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    withdrawalActionDisabled: ["rgb(198, 208, 205)", "rgb(101, 114, 110)", "rgb(170, 185, 180)"]
  },
  dark: {
    appendAvailable: ["rgb(38, 52, 47)", "rgb(212, 228, 222)", "rgb(107, 129, 121)"],
    appendUnavailable: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(70, 92, 84)"],
    appendLegacy: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(70, 92, 84)"],
    appendIntermediate: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(70, 92, 84)"],
    management: ["rgb(38, 52, 47)", "rgb(212, 228, 222)", "rgb(107, 129, 121)"],
    downloadUnavailable: ["rgb(43, 57, 52)", "rgb(156, 170, 165)", "rgb(70, 92, 84)"],
    genericSecondaryDisabled: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(70, 92, 84)"],
    withdrawalActionDisabled: ["rgb(43, 57, 52)", "rgb(156, 170, 165)", "rgb(70, 92, 84)"]
  }
};

const favoriteControlColors = {
  white: {
    filterIdle: ["rgb(255, 255, 255)", "rgb(90, 104, 100)", "rgb(207, 216, 213)"],
    filterHover: ["rgb(255, 248, 230)", "rgb(138, 90, 0)", "rgba(217, 154, 0, 0.4)"],
    filterActive: ["rgb(255, 244, 214)", "rgb(122, 75, 0)", "rgba(245, 184, 46, 0.58)"],
    starIdle: ["rgba(0, 0, 0, 0)", "rgb(119, 131, 142)", "rgba(0, 0, 0, 0)"],
    starHover: ["rgb(255, 247, 223)", "rgb(138, 90, 0)", "rgba(217, 154, 0, 0.34)"],
    starFavorite: ["rgb(255, 244, 214)", "rgb(122, 75, 0)", "rgba(245, 184, 46, 0.36)"]
  },
  default: {
    filterIdle: ["rgb(255, 255, 255)", "rgb(82, 99, 94)", "rgb(170, 185, 180)"],
    filterHover: ["rgb(255, 248, 230)", "rgb(138, 90, 0)", "rgba(217, 154, 0, 0.4)"],
    filterActive: ["rgb(255, 244, 214)", "rgb(122, 75, 0)", "rgba(245, 184, 46, 0.58)"],
    starIdle: ["rgba(0, 0, 0, 0)", "rgb(119, 131, 142)", "rgba(0, 0, 0, 0)"],
    starHover: ["rgb(255, 247, 223)", "rgb(138, 90, 0)", "rgba(217, 154, 0, 0.34)"],
    starFavorite: ["rgb(255, 244, 214)", "rgb(122, 75, 0)", "rgba(245, 184, 46, 0.36)"]
  },
  dark: {
    filterIdle: ["rgb(32, 43, 39)", "rgb(179, 192, 187)", "rgb(70, 92, 84)"],
    filterHover: ["rgb(61, 50, 27)", "rgb(242, 198, 109)", "rgb(159, 122, 50)"],
    filterActive: ["rgb(74, 59, 29)", "rgb(255, 224, 160)", "rgb(194, 153, 67)"],
    starIdle: ["rgba(0, 0, 0, 0)", "rgb(147, 162, 157)", "rgba(0, 0, 0, 0)"],
    starHover: ["rgb(61, 50, 27)", "rgb(242, 198, 109)", "rgb(159, 122, 50)"],
    starFavorite: ["rgb(74, 59, 29)", "rgb(255, 224, 160)", "rgb(194, 153, 67)"]
  }
};

function controlColorTuple(control) {
  return [control.backgroundColor, control.color, control.borderColor];
}

function assertPageInvariants(snapshot, consoleMessages) {
  const lifecycleExpectations = new Map([
    ["version-grace", ["withdrawal-pending-badge", "DL停止・自動削除待ち"]],
    ["version-manual", ["withdrawal-pending-badge", "DL停止・管理者確認待ち"]],
    ["version-immediate", ["withdrawal-pending-badge", "取り下げ申請中"]],
    ["version-processing", ["withdrawal-processing-badge", "取り下げ処理中"]],
    ["version-tombstoned", ["withdrawal-tombstone-badge", "履歴のみ"]],
    ["version-deleted", ["withdrawal-tombstone-badge", "削除済み"]]
  ]);
  for (const entry of [...snapshot.detail.matrix, ...snapshot.compact.matrix]) {
    assert.equal(entry.document.horizontalOverflow, false, `${entry.pageKind} ${entry.requestedTheme} ${entry.requestedWidth}px overflow`);
  }
  const detailCounts = snapshot.detail.matrix[0].counts;
  for (const group of ["originLinks", "downloads", "appendControls", "managementControls", "favorites", "thumbnails"]) {
    assert.ok(detailCounts[group] > 0, `${group} fixture count must be positive`);
  }
  for (const entry of snapshot.detail.matrix) {
    assert.equal(entry.counts.versionRows, versions.length);
    assert.equal(entry.counts.lifecycle, lifecycleExpectations.size);
    assert.ok(entry.overlay, `tree overlay is missing at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    assert.equal(entry.focusVisible?.matches, true, `focus-visible did not activate at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    assert.notEqual(entry.focusVisible?.outlineStyle, "none", `focus-visible outline missing at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    assert.ok(Number.parseFloat(entry.focusVisible?.outlineWidth || "0") >= 1, `focus-visible outline is too thin at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    assert.deepEqual(entry.counts, detailCounts, `detail control counts changed at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    assert.deepEqual(Object.keys(entry.controls), Object.keys(detailControlSelectors));
    for (const [name, expectedColors] of Object.entries(untouchedControlColors[entry.requestedTheme])) {
      assert.deepEqual(
        controlColorTuple(entry.controls[name]),
        expectedColors,
        `${name} colors changed at ${entry.requestedTheme} ${entry.requestedWidth}px`
      );
    }
    const stopped = entry.controls.appendStopped;
    const expectedStopped = entry.requestedTheme === "dark"
      ? ["rgb(43, 57, 52)", "rgb(156, 170, 165)", "rgb(118, 151, 139)"]
      : [
        "rgb(238, 243, 241)",
        "rgb(101, 113, 110)",
        entry.requestedTheme === "white" ? "rgb(207, 216, 213)" : "rgb(170, 185, 180)"
      ];
    assert.deepEqual(controlColorTuple(stopped), expectedStopped, `append-stopped semantic colors changed at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    assert.equal(stopped.tagName, "BUTTON");
    assert.equal(stopped.type, "button");
    assert.equal(stopped.text, "\u8ffd\u8a18\u505c\u6b62");
    assert.equal(stopped.disabled, true);
    assert.equal(stopped.ariaDisabled, "true");
    assert.match(stopped.ariaDescribedBy, /^append-policy-description-/);
    assert.equal(stopped.opacity, "1");
    assert.equal(stopped.cursor, "not-allowed");
    assert.equal(stopped.pointerEvents, "auto");
    assert.equal(stopped.inlineClickHandler, false);
    assert.ok(stopped.contrastRatio >= 4.5, `append-stopped contrast ${stopped.contrastRatio} is below 4.5 at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    if (entry.requestedTheme === "dark") {
      assert.notEqual(stopped.backgroundColor, "rgb(238, 243, 241)");
      assert.match(stopped.boxShadow, /inset/);
      assert.ok(stopped.borderContrastRatio >= 3, `dark append-stopped border contrast ${stopped.borderContrastRatio} is below 3`);
    } else {
      assert.equal(stopped.boxShadow, "none");
    }
    const stoppedInteractions = entry.controlInteractions.appendStopped;
    assert.deepEqual(stoppedInteractions.programmatic, {
      activeAfterFocus: false,
      clickEvents: 0,
      inlineClickHandler: false
    });
    for (const state of ["hover", "focusVisible", "active"]) {
      const forced = stoppedInteractions[state];
      assert.equal(forced.matches, true, `forced ${state} state did not apply`);
      assert.equal(forced.backgroundColor, stopped.backgroundColor, `append-stopped ${state} background changed`);
      assert.equal(forced.color, stopped.color, `append-stopped ${state} text changed`);
      assert.equal(forced.borderColor, stopped.borderColor, `append-stopped ${state} border changed`);
      assert.equal(forced.boxShadow, stopped.boxShadow, `append-stopped ${state} shadow changed`);
    }
    for (const name of ["appendUnavailable", "appendLegacy", "appendIntermediate", "genericSecondaryDisabled", "withdrawalActionDisabled"]) {
      assert.equal(entry.controls[name].disabled, true, `${name} must remain disabled`);
      assert.equal(entry.controlInteractions[name].programmatic.activeAfterFocus, false, `${name} entered the focus order`);
      assert.equal(entry.controlInteractions[name].programmatic.clickEvents, 0, `${name} emitted a click event`);
    }
    const favorite = entry.favoriteInteractions;
    const expectedFavorite = favoriteControlColors[entry.requestedTheme];
    assert.deepEqual(controlColorTuple(favorite.filterIdle), expectedFavorite.filterIdle);
    assert.deepEqual(controlColorTuple(favorite.filterHover), expectedFavorite.filterHover);
    assert.deepEqual(controlColorTuple(favorite.filterFocus), expectedFavorite.filterHover);
    assert.deepEqual(controlColorTuple(favorite.filterActive), expectedFavorite.filterActive);
    assert.deepEqual(controlColorTuple(favorite.filterActiveHover), expectedFavorite.filterActive);
    assert.deepEqual(controlColorTuple(favorite.filterActiveFocus), expectedFavorite.filterActive);
    assert.deepEqual(controlColorTuple(favorite.starIdle), expectedFavorite.starIdle);
    assert.deepEqual(controlColorTuple(favorite.starHover), expectedFavorite.starHover);
    assert.deepEqual(controlColorTuple(favorite.starFocus), expectedFavorite.starHover);
    assert.deepEqual(controlColorTuple(favorite.starFavorite), expectedFavorite.starFavorite);
    assert.deepEqual(controlColorTuple(favorite.starFavoriteHover), expectedFavorite.starFavorite);
    assert.deepEqual(controlColorTuple(favorite.starFavoriteFocus), expectedFavorite.starFavorite);
    for (const state of ["filterIdle", "filterHover", "filterFocus", "filterActive", "filterActiveHover", "filterActiveFocus"]) {
      assert.ok(favorite[state].contrastRatio >= 4.5, `${state} contrast ${favorite[state].contrastRatio} is below 4.5`);
    }
    for (const state of ["starIdle", "starHover", "starFocus", "starFavorite", "starFavoriteHover", "starFavoriteFocus"]) {
      assert.ok(favorite[state].contrastRatio >= 3, `${state} contrast ${favorite[state].contrastRatio} is below 3`);
    }
    for (const state of ["filterFocus", "filterActiveFocus", "starFocus", "starFavoriteFocus"]) {
      assert.equal(favorite[state].matches, true, `${state} forced focus-visible did not apply`);
      assert.notEqual(favorite[state].outlineStyle, "none", `${state} outline is missing`);
      assert.ok(Number.parseFloat(favorite[state].outlineWidth) >= 1, `${state} outline is too thin`);
      assert.ok(favorite[state].outlineContrastRatio >= 3, `${state} outline contrast ${favorite[state].outlineContrastRatio} is below 3`);
    }
    assert.deepEqual(favorite.behavior.filterOn, {
      active: true,
      ariaPressed: "true",
      text: "★ お気に入りのみ",
      title: "通常一覧に戻す"
    });
    assert.deepEqual(favorite.behavior.filterOff, {
      active: false,
      ariaPressed: "false",
      text: "☆ お気に入りのみ",
      title: "お気に入りversionと祖先だけを表示"
    });
    assert.deepEqual(favorite.behavior.favoriteOn, {
      active: true,
      rowActive: true,
      ariaPressed: "true",
      ariaLabel: "お気に入りから外す",
      text: "★",
      title: "お気に入りから外す",
      duplicateActive: true,
      duplicateAriaPressed: "true",
      duplicateText: "★"
    });
    assert.deepEqual(favorite.behavior.favoriteOff, {
      active: false,
      rowActive: false,
      ariaPressed: "false",
      ariaLabel: "お気に入りに追加",
      text: "☆",
      title: "お気に入りに追加",
      duplicateActive: false,
      duplicateAriaPressed: "false",
      duplicateText: "☆"
    });
    assert.deepEqual(Object.keys(favorite.behavior.storageAfterAdd), ["version-active"]);
    assert.equal(favorite.behavior.storageAfterAdd["version-active"].versionId, "version-active");
    assert.match(favorite.behavior.storageAfterAdd["version-active"].favoritedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(favorite.behavior.storageAfterRemove, {});
    assert.equal(favorite.behavior.chartFetchDelta, 0, "favorite-only rerender must not fetch charts again");
    assert.deepEqual(favorite.runtimeStyles, { favorite: 0, progress: 1, total: 1 });
    for (const state of ["filterIdle", "filterHover", "filterFocus", "filterActive", "filterActiveHover", "filterActiveFocus", "starIdle", "starHover", "starFocus", "starFavorite", "starFavoriteHover", "starFavoriteFocus"]) {
      for (const side of ["left", "right"]) {
        assert.equal(favorite[state].viewportClip[side], 0, `${state} ${side} clip at ${entry.requestedTheme} ${entry.requestedWidth}px`);
      }
    }
    if (entry.requestedWidth === 390) {
      assert.ok(Math.abs(favorite.toolbar.rect.width - favorite.filterIdle.rect.width) <= 1, "390px favorite filter must fill its toolbar");
    }
    for (const group of ["originLinks", "downloads", "appendControls", "managementControls", "favorites", "thumbnails"]) {
      for (const item of entry.elements[group]) {
        assert.equal(item.viewportClip.left, 0, `${group} left clip at ${entry.requestedWidth}px`);
        assert.equal(item.viewportClip.right, 0, `${group} right clip at ${entry.requestedWidth}px`);
      }
    }
    if (entry.requestedWidth === 390) {
      for (const row of entry.elements.versionRows) {
        assert.ok(row.scrollWidth <= row.clientWidth + 1, `${row.dataVersionId} row overflows horizontally at ${entry.requestedTheme} 390px`);
      }
    }
    assert.equal(entry.lifecycleGeometry.length, lifecycleExpectations.size);
    for (const badge of entry.lifecycleGeometry) {
      const expected = lifecycleExpectations.get(badge.dataVersionId);
      assert.ok(expected, `unexpected lifecycle fixture ${badge.dataVersionId}`);
      assert.ok(badge.className.includes(expected[0]), `${badge.dataVersionId} lifecycle class changed`);
      assert.equal(badge.text, expected[1], `${badge.dataVersionId} lifecycle text changed`);
      assert.equal(badge.whiteSpace, "nowrap", `${badge.dataVersionId} badge text must stay on one line`);
      assert.ok(badge.scrollWidth <= badge.clientWidth + 1, `${badge.dataVersionId} badge text clips horizontally`);
      assert.ok(badge.scrollHeight <= badge.clientHeight + 1, `${badge.dataVersionId} badge text clips vertically`);
      for (const side of ["left", "right", "top", "bottom"]) {
        assert.ok(badge.viewportClip[side] <= 1, `${badge.dataVersionId} viewport ${side} clip at ${entry.requestedTheme} ${entry.requestedWidth}px`);
      }
      if (entry.requestedWidth === 390) {
        for (const [selector, container] of Object.entries(badge.containers)) {
          for (const side of ["left", "right", "top", "bottom"]) {
            assert.ok(container.clip[side] <= 1, `${badge.dataVersionId} ${selector} ${side} clip at ${entry.requestedTheme} ${entry.requestedWidth}px`);
          }
        }
      }
      const title = badge.containers[".version-title-line"];
      const group = badge.containers[".version-state-badges"];
      if (entry.requestedWidth === 390) {
        assert.equal(title.flexWrap, "wrap", `${badge.dataVersionId} mobile title line must wrap`);
        assert.equal(group.flexWrap, "wrap", `${badge.dataVersionId} mobile badge group must wrap`);
        assert.equal(group.flexBasis, "100%", `${badge.dataVersionId} mobile badge group must use a new flex line`);
        assert.equal(group.minWidth, "0px", `${badge.dataVersionId} mobile badge group min-width changed`);
      } else {
        assert.equal(title.flexWrap, "nowrap", `${badge.dataVersionId} desktop/tablet title line changed`);
        assert.equal(group.flexWrap, "nowrap", `${badge.dataVersionId} desktop/tablet badge group changed`);
        assert.equal(group.flex, "0 0 auto", `${badge.dataVersionId} desktop/tablet badge placement changed`);
      }
    }
    const manual = entry.lifecycleGeometry.find((badge) => badge.dataVersionId === "version-manual");
    assert.match(manual.containers[".version-state-badges"].text, /没譜面/);
  }
  for (const entry of snapshot.compact.matrix) {
    assert.equal(entry.counts.compactRows, compactItems.length);
    assert.equal(entry.counts.originLinks, compactItems.length);
    assert.equal(entry.counts.downloads, compactItems.length);
  }
  const errors = consoleMessages.filter((message) => message.type === "error" || message.type === "exception");
  const warnings = consoleMessages.filter((message) => message.type === "warning");
  assert.deepEqual(errors, [], "browser console errors must remain zero");
  assert.deepEqual(warnings, [], "unexpected browser console warnings must remain zero");
}

function reportKnownIssues(snapshot) {
  const white390 = findResult(snapshot.detail.matrix, "white", 390);
  const dark390 = findResult(snapshot.detail.matrix, "dark", 390);
  const themeAt1366 = themes.map((theme) => findResult(snapshot.detail.matrix, theme, 1366));
  if (dark390.known.appendStopped?.backgroundColor === white390.known.appendStopped?.backgroundColor
    || dark390.known.appendStopped?.backgroundColor === "rgb(238, 243, 241)") {
    throw new Error("KNOWN-CSS-003 regressed: dark append-stopped uses the fixed light background");
  }
  if (dark390.known.favoriteIdle?.color === white390.known.favoriteIdle?.color
    || dark390.known.favoriteIdle?.color === "rgb(182, 192, 201)") {
    throw new Error("KNOWN-CSS-004 regressed: dark favorite idle uses the fixed light color");
  }
  const checks = [
    ["KNOWN-CSS-005", new Set(themeAt1366.map((entry) => entry.known.detailTarget?.backgroundColor)).size === 1, "detail target fixed light background"]
  ];
  for (const [id, observed, label] of checks) {
    if (!observed) {
      throw new Error(`${id} is no longer observed; update the known-issue documentation before accepting the new behavior: ${JSON.stringify({ white390: white390.known, dark390: dark390.known, lifecycle: white390.elements.lifecycle })}`);
    }
    console.warn(`${id} observed (known issue, not an accepted visual specification): ${label}`);
  }
}

function isAllowedMobileLayoutDifference(location) {
  const match = location.match(/^detail\[(\d+)\]\.(.*)$/);
  if (!match || Number(match[1]) % widths.length !== 0) return false;
  const rest = match[2];
  if (rest.startsWith("lifecycleGeometry")) return true;
  if (/^known\.(pendingViewportClip|processingViewportClip)$/.test(rest)) return true;
  if (/^elements\.[^.]+\[\d+\]\.(rect\.(left|right)|parentRect\.width|parentClip\.(left|right)|viewportClip\.(left|right))$/.test(rest)) return true;
  if (/^elements\.[^.]+\[\d+\]\.parentRect\.height$/.test(rest)) return true;
  if (/^elements\.versionRows\[\d+\]\.(height|clientHeight|scrollHeight|scrollWidth|rect\.height|parentRect\.height)$/.test(rest)) return true;
  if (/^elements\.lifecycle\[\d+\]\.(rect\.(left|right)|parentRect|viewportClip)$/.test(rest)) return true;
  return false;
}

function compareValues(expected, actual, location = "snapshot") {
  if (isAllowedMobileLayoutDifference(location)) return;
  if (typeof expected === "number" && typeof actual === "number") {
    assert.ok(Math.abs(expected - actual) <= tolerance, `${location}: ${expected} != ${actual}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.equal(Array.isArray(actual), true, `${location} must remain an array`);
    assert.equal(actual.length, expected.length, `${location} length changed`);
    expected.forEach((value, index) => compareValues(value, actual[index], `${location}[${index}]`));
    return;
  }
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `${location} must remain an object`);
    for (const key of Object.keys(expected)) {
      if (key === "navigationDurationMs") continue;
      if (key === "overlay") continue;
      if ((key === "top" || key === "bottom") && location.endsWith(".rect")) continue;
      const detailIndex = Number(location.match(/^detail\[(\d+)\]/)?.[1] ?? -1);
      const isDark = detailIndex >= themes.indexOf("dark") * widths.length;
      const isStoppedControl = expected.className?.split(/\s+/).includes("append-policy-disabled-button");
      const isStoppedSummary = /\.known\.appendStopped$/.test(location);
      const isStoppedInteraction = /\.controlInteractions\.appendStopped\.(?:hover|focusVisible|active)$/.test(location);
      const isFavoriteStyle = /\.(?:elements\.favorites\[\d+\]|known\.favoriteIdle|favoriteInteractions\.(?:filter(?:Idle|Hover|Focus|Active(?:Hover|Focus)?)|star(?:Idle|Hover|Focus|Favorite(?:Hover|Focus)?)))$/.test(location);
      const favoriteStyleChanges = new Set([
        "backgroundColor", "visibleBackgroundColor", "surroundingBackgroundColor", "color", "borderColor",
        "outline", "outlineColor", "contrastRatio", "borderContrastRatio", "outlineContrastRatio", "boxShadow"
      ]);
      const changedInAllThemes = new Set(["color", "contrastRatio", "outline", "outlineColor"]);
      const changedInDark = new Set(["backgroundColor", "borderColor", "boxShadow", "borderContrastRatio"]);
      if ((isStoppedControl || isStoppedSummary || isStoppedInteraction)
        && (changedInAllThemes.has(key) || (isDark && changedInDark.has(key)))) {
        continue;
      }
      if (isFavoriteStyle && favoriteStyleChanges.has(key)) continue;
      if (location.endsWith(".favoriteInteractions.runtimeStyles") && key === "favorite") continue;
      if (location.endsWith(".favoriteInteractions.behavior.storageAfterAdd.version-active") && key === "favoritedAt") continue;
      compareValues(expected[key], actual[key], `${location}.${key}`);
    }
    return;
  }
  assert.equal(actual, expected, `${location} changed`);
}

function rowHeightDeltas(baseline, snapshot) {
  const ids = ["version-grace", "version-manual", "version-immediate", "version-processing", "version-tombstoned", "version-deleted"];
  return themes.flatMap((theme) => widths.map((width) => {
    const before = baseline.detail.find((entry) => entry.requestedTheme === theme && entry.requestedWidth === width);
    const after = snapshot.detail.find((entry) => entry.requestedTheme === theme && entry.requestedWidth === width);
    return {
      theme,
      width,
      rows: Object.fromEntries(ids.map((id) => {
        const beforeRow = before.elements.versionRows.find((row) => row.dataVersionId === id);
        const afterRow = after.elements.versionRows.find((row) => row.dataVersionId === id);
        return [id, Number((afterRow.rect.height - beforeRow.rect.height).toFixed(3))];
      }))
    };
  }));
}

async function run() {
  const apiServer = createApiServer();
  const staticServer = createStaticServer();
  let chrome = null;
  let cdp = null;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "bms-css-r4b2a-browser-"));
  try {
    await listen(apiServer, apiPort);
    const staticPort = await listen(staticServer, 0);
    const debuggerPort = await availablePort();
    chrome = childProcess.spawn(browserExecutable(), [
      "--headless=new",
      "--disable-gpu",
      "--disable-features=OverlayScrollbar",
      "--disable-overlay-scrollbar",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debuggerPort}`,
      `--user-data-dir=${profileDir}`,
      "about:blank"
    ], { stdio: "ignore", windowsHide: true });
    const debuggerUrl = await waitForDebugger(debuggerPort);
    cdp = new CdpConnection(debuggerUrl);
    await cdp.open();
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Log.enable", {}, sessionId);
    await cdp.send("DOM.enable", {}, sessionId);
    await cdp.send("CSS.enable", {}, sessionId);
    const consoleMessages = [];
    cdp.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
        consoleMessages.push({ type: message.params.type, text: message.params.args.map((arg) => arg.value || arg.description || "").join(" ") });
      }
      if (message.method === "Runtime.exceptionThrown") {
        consoleMessages.push({ type: "exception", text: message.params.exceptionDetails?.text || "runtime exception" });
      }
      if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry?.level)) {
        consoleMessages.push({ type: message.params.entry.level, text: message.params.entry.text });
      }
    });

    const detailUrl = `http://127.0.0.1:${staticPort}/index.html?chartId=chart-audit&versionId=version-active#list`;
    const navigationStart = process.hrtime.bigint();
    await cdp.send("Page.navigate", { url: detailUrl }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll(".version-row").length === ${versions.length}
      && document.querySelectorAll(".thumbnail-cell .progress-thumbnail").length >= 5
      && document.querySelectorAll(".progress-thumbnail-image-wrap img.progress-thumbnail-image").length === 1
      && document.querySelectorAll(".progress-thumbnail.has-progress-image.is-image-loaded").length === 1
      && document.querySelector("#progress-image-thumbnail-style")
      && !document.querySelector("#favoriteListStyles")
      && [...document.styleSheets].some((sheet) => sheet.href && new URL(sheet.href).pathname.endsWith("/favorites-list.css"))`, "detail fixture");
    await installControlFixtures(cdp, sessionId);
    const detailNavigationMs = Number(process.hrtime.bigint() - navigationStart) / 1e6;
    const detail = await captureMatrix(cdp, sessionId, "detail");

    const compactNavigationStart = process.hrtime.bigint();
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${staticPort}/list.html` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll(".compact-version-row").length === ${compactItems.length}`, "compact fixture");
    const compactNavigationMs = Number(process.hrtime.bigint() - compactNavigationStart) / 1e6;
    const compact = await captureMatrix(cdp, sessionId, "compact");

    const snapshot = {
      format: "bms-css-r4b2a-v1",
      fixture: { chartCount: 1, versionCount: versions.length, compactCount: compactItems.length },
      detail: detail.matrix,
      compact: compact.matrix
    };
    const wrapped = { detail: { matrix: detail.matrix }, compact: { matrix: compact.matrix } };
    assertPageInvariants(wrapped, consoleMessages);
    reportKnownIssues(wrapped);

    if (writeSnapshotPath) {
      fs.writeFileSync(path.resolve(writeSnapshotPath), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    }
    if (compareSnapshotPath) {
      const baseline = JSON.parse(fs.readFileSync(path.resolve(compareSnapshotPath), "utf8"));
      assert.equal(baseline.format, snapshot.format);
      compareValues(baseline.fixture, snapshot.fixture, "fixture");
      compareValues(baseline.detail, snapshot.detail, "detail");
      compareValues(baseline.compact, snapshot.compact, "compact");
      console.log(`css browser row height deltas: ${JSON.stringify(rowHeightDeltas(baseline, snapshot))}`);
    }

    const totalMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log("css browser regression: 9 detail + 9 compact theme/width conditions passed");
    console.log(JSON.stringify({
      detailNavigationMs: Number(detailNavigationMs.toFixed(1)),
      compactNavigationMs: Number(compactNavigationMs.toFixed(1)),
      computedStyleMs: Number((detail.computedCaptureMs + compact.computedCaptureMs).toFixed(1)),
      totalMs: Number(totalMs.toFixed(1)),
      consoleErrors: 0,
      consoleWarnings: 0
    }));
  } finally {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
    }
    await Promise.allSettled([closeServer(apiServer), closeServer(staticServer)]);
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
}

run().catch((error) => {
  console.error(`css browser regression failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
