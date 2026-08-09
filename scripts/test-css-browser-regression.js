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
const widths = [390, 760, 1024, 1366, 1920];
const apiPort = 8788;
const tolerance = 0.25;
const startedAt = process.hrtime.bigint();
const progressFormFixture = fs.readFileSync(path.join(root, "scripts", "fixtures", "chart-metadata-extract-utf8.bms"), "utf8");
const appendCompletionFixture = `${progressFormFixture}\n#00411:01`;
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

function createAppendCompletionParentMap() {
  return {
    schemaVersion: 2,
    blockMode: "standardized_measure",
    firstMeasure: 1,
    lastMeasure: 4,
    targetBlockCount: 4,
    blocks: Array.from({ length: 4 }, (_, index) => ({
      index,
      startMeasure: index + 1,
      endMeasure: index + 1,
      startPosition: index + 1,
      endPosition: index + 2,
      startTimeSec: index * 2,
      endTimeSec: index === 3 ? 6 : (index + 1) * 2,
      playNotes: index === 0 || index === 3 ? 1 : 0
    })),
    layers: [{ kind: "initial", versionId: "version-active", color: "#27896b", ranges: [[0, 1]] }],
    progress: 50
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
    commentCount: 0,
    latestComment: null,
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
  createVersion("version-active", {
    comment: "Author line 1\nAuthor line 2\nAuthor line 3\nAuthor line 4 with an-extremely-long-unbroken-word-for-browser-overflow-regression",
    commentCount: 2,
    latestComment: {
      body: "Existing latest public comment",
      createdAt: "2026-07-25T02:30:00.000Z"
    },
    progressMap: createAppendCompletionParentMap()
  }),
  createVersion("version-append-off", { allowAppend: false, appendAvailable: false, progress: 62 }),
  createVersion("version-download-blocked", {
    downloadBlocked: true,
    downloadAvailable: false,
    file: { downloadUrl: null },
    progress: 70
  }),
  ...Array.from({ length: 7 }, (_, index) => createVersion(`version-depth-${index + 1}`, {
    progress: index === 0 ? 99 : index === 1 || index === 2 ? 100 : 40 + index,
    completed: index === 1,
    completedAt: index === 1 ? "2026-07-25T03:00:00.000Z" : null,
    isRejected: index === 2
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
    authorComment: versions[0].comment,
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
  },
  {
    ...versions[4],
    chartId: "chart-audit",
    title: "投稿者コメントだけの完成版",
    subtitle: "",
    chartName: "完成差分",
    versionLabel: "v3",
    progress: 100,
    completedAt: "2026-07-25T03:00:00.000Z",
    hasComment: true,
    authorComment: "投稿者コメントだけを表示するfixtureです。",
    commentPreview: "投稿者コメントだけを表示するfixtureです。",
    commentCount: 12,
    latestComment: null,
    chartUpdatedAt: "2026-07-25T03:00:00.000Z",
    isNew: false,
    withdrawn: false,
    deleteRequested: false
  },
  {
    ...versions[5],
    chartId: "chart-audit",
    title: "最新コメントだけの没譜面",
    subtitle: "",
    chartName: "没譜面差分",
    versionLabel: "v4",
    progress: 100,
    hasComment: false,
    authorComment: "",
    commentPreview: "",
    commentCount: 1,
    latestComment: {
      body: "最新コメントだけを表示するfixtureです。",
      createdAt: "2026-07-25T03:30:00.000Z"
    },
    chartUpdatedAt: "2026-07-25T03:30:00.000Z",
    isNew: false,
    isRejected: true,
    originUrl: null,
    withdrawn: false,
    deleteRequested: false
  },
  {
    ...versions[6],
    chartId: "chart-audit",
    title: "非常に長い曲名を持つ投稿一覧の折り返しと高さを確認するためのfixture title",
    subtitle: "LONG SUBTITLE",
    chartName: "非常に長い差分名を持つfixture chart name",
    versionLabel: "v5-long",
    author: "非常に長い作者名を持つfixture author name",
    progress: 47,
    hasComment: false,
    authorComment: "",
    commentPreview: "",
    commentCount: 9,
    latestComment: null,
    chartUpdatedAt: "2026-07-25T04:00:00.000Z",
    isNew: true,
    allowAppend: false,
    appendAvailable: false,
    managementAvailable: false,
    withdrawn: false,
    deleteRequested: false
  }
];

const commentFixture = {
  postRequests: 0,
  items: [
    { id: "comment-fixture-1", body: "First public comment", createdAt: "2026-07-25T02:00:00.000Z" },
    { id: "comment-fixture-2", body: "Existing latest public comment", createdAt: "2026-07-25T02:30:00.000Z" }
  ]
};

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
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/api/charts/chart-audit") {
      json(response, 200, { serverTime: "2026-07-25T03:00:00.000Z", charts: [chartEntry] });
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/api/versions/version-active/comments?")) {
      const url = new URL(request.url, `http://localhost:${apiPort}`);
      const page = Number(url.searchParams.get("page")) || 1;
      const pageSize = Number(url.searchParams.get("pageSize")) || 20;
      const offset = (page - 1) * pageSize;
      json(response, 200, {
        versionId: "version-active",
        items: commentFixture.items.slice(offset, offset + pageSize),
        page,
        pageSize,
        total: commentFixture.items.length
      });
      return;
    }
    if (request.method === "POST" && request.url === "/api/versions/version-active/comments") {
      let source = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { source += chunk; });
      request.on("end", () => {
        commentFixture.postRequests += 1;
        const payload = JSON.parse(source);
        const comment = {
          id: `comment-fixture-${commentFixture.items.length + 1}`,
          body: String(payload.body || ""),
          createdAt: "2026-07-25T03:00:00.000Z"
        };
        commentFixture.items.push(comment);
        versions[0].commentCount = commentFixture.items.length;
        versions[0].latestComment = { body: comment.body, createdAt: comment.createdAt };
        compactItems[0].commentCount = commentFixture.items.length;
        compactItems[0].latestComment = { body: comment.body, createdAt: comment.createdAt };
        setTimeout(() => json(response, 201, {
          ok: true,
          comment,
          total: commentFixture.items.length
        }), 120);
      });
      return;
    }
    if (request.method === "GET" && request.url.startsWith(`/api/progress-images/${imageFixtureVersion.id}`)) {
      response.statusCode = 200;
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Content-Type", "image/png");
      response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzW0QAAAABJRU5ErkJggg==", "base64"));
      return;
    }
    if (request.method === "GET" && request.url.startsWith("/api/progress-images/css-regression-slow")) {
      setTimeout(() => {
        response.statusCode = 200;
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Content-Type", "image/png");
        response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+AvzW0QAAAABJRU5ErkJggg==", "base64"));
      }, 250);
      return;
    }
    if (request.method === "GET" && request.url === "/api/progress-images/css-regression-invalid") {
      response.statusCode = 200;
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Content-Type", "image/png");
      response.end("not-a-valid-png");
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
    progressStylesheet: [...document.styleSheets].some((sheet) => sheet.href && new URL(sheet.href).pathname.endsWith("/progress-thumbnail-list.css")),
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

async function captureProgressThumbnailStates(cdp, sessionId) {
  return evaluate(cdp, sessionId, `(async () => {
    const existing = document.querySelector("#css-regression-progress-host");
    existing?.remove();
    const host = document.createElement("div");
    host.id = "css-regression-progress-host";
    document.body.appendChild(host);
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
      warnings.push({
        message: String(args[0] || ""),
        code: String(args[1]?.code || "")
      });
    };
    const wait = async (predicate, label) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(\`progress fixture timed out: \${label}\`);
    };
    const round = (value) => Number(Number(value || 0).toFixed(3));
    const rectValue = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: round(rect.left),
        right: round(rect.right),
        width: round(rect.width),
        height: round(rect.height)
      };
    };
    const describe = (root) => {
      const thumbnail = root.querySelector(".progress-thumbnail");
      const wrap = root.querySelector(".progress-thumbnail-image-wrap");
      const image = root.querySelector("img.progress-thumbnail-image");
      const fallback = root.querySelector(".progress-thumbnail-fallback");
      const value = root.querySelector(".progress-thumbnail-value");
      const wrapStyle = wrap ? getComputedStyle(wrap) : null;
      const imageStyle = image ? getComputedStyle(image) : null;
      const valueStyle = value ? getComputedStyle(value) : null;
      const wrapRect = wrap?.getBoundingClientRect?.() || null;
      return {
        thumbnailCount: root.querySelectorAll(".progress-thumbnail").length,
        mapCount: root.querySelectorAll(".progress-thumbnail.has-progress-map").length,
        imageThumbnailCount: root.querySelectorAll(".progress-thumbnail.has-progress-image").length,
        wrapCount: root.querySelectorAll(".progress-thumbnail-image-wrap").length,
        imageCount: root.querySelectorAll("img.progress-thumbnail-image").length,
        fallbackCount: root.querySelectorAll(".progress-thumbnail-fallback").length,
        className: String(thumbnail?.className || ""),
        mounted: thumbnail?.dataset.progressImageMounted || "",
        source: thumbnail?.dataset.progressImageSrc || "",
        wrapHidden: wrap?.hidden ?? null,
        fallbackHidden: fallback?.hidden ?? null,
        fallbackText: String(fallback?.textContent || "").trim(),
        imageSrc: image?.getAttribute("src") || "",
        imageAlt: image?.alt || "",
        imageDecoding: image?.decoding || "",
        imageLoading: image?.loading || "",
        wrap: wrapStyle ? {
          alignItems: wrapStyle.alignItems,
          backgroundColor: wrapStyle.backgroundColor,
          borderColor: wrapStyle.borderColor,
          borderStyle: wrapStyle.borderStyle,
          borderWidth: wrapStyle.borderWidth,
          borderRadius: wrapStyle.borderRadius,
          display: wrapStyle.display,
          height: wrapStyle.height,
          justifyContent: wrapStyle.justifyContent,
          maxWidth: wrapStyle.maxWidth,
          minWidth: wrapStyle.minWidth,
          overflow: wrapStyle.overflow,
          width: wrapStyle.width,
          rect: rectValue(wrap),
          viewportClip: wrapRect ? {
            left: round(Math.max(0, -wrapRect.left)),
            right: round(Math.max(0, wrapRect.right - document.documentElement.clientWidth))
          } : null
        } : null,
        image: imageStyle ? {
          display: imageStyle.display,
          height: imageStyle.height,
          objectFit: imageStyle.objectFit,
          opacity: imageStyle.opacity,
          filter: imageStyle.filter,
          width: imageStyle.width,
          rect: rectValue(image)
        } : null,
        valueColor: valueStyle?.color || ""
      };
    };
    const version = (id, progressImage, progressMap = null) => ({
      id,
      versionId: id,
      progress: 50,
      progressImage,
      progressMap
    });
    const map = {
      schemaVersion: 2,
      blockMode: "standardized_measure",
      progress: 50,
      blocks: [{ startMeasure: 0, endMeasure: 3, startTimeSec: 0, endTimeSec: 5, playNotes: 24 }],
      layers: [{ kind: "initial", versionId: "css-progress-map", color: "#27896b", ranges: [[0, 0]] }]
    };
    const states = {};
    const slowImageSource = "/api/progress-images/css-regression-slow?fixture=" + Date.now() + "-" + Math.random();
    try {
      host.innerHTML = window.renderProgressThumbnail(version("css-progress-map", null, map));
      states.mapOnly = describe(host);

      host.innerHTML = window.renderProgressThumbnail(version(
        "css-progress-map-image",
        { url: slowImageSource },
        map
      ));
      states.mapAndImageMetadata = describe(host);

      host.innerHTML = window.renderProgressThumbnail(version(
        "css-progress-image",
        { url: slowImageSource }
      ));
      states.beforeMount = describe(host);
      const imageMountStartedAt = performance.now();
      window.mountProgressImageThumbnails(host);
      const firstImage = host.querySelector("img.progress-thumbnail-image");
      states.loading = describe(host);
      await wait(() => host.querySelector(".progress-thumbnail")?.classList.contains("is-image-loaded"), "image load");
      const imageMountMs = round(performance.now() - imageMountStartedAt);
      states.loaded = describe(host);

      window.mountProgressImageThumbnails(host);
      states.remount = {
        reusedImage: firstImage === host.querySelector("img.progress-thumbnail-image"),
        ...describe(host)
      };

      const changedSource = ${JSON.stringify(`http://localhost:${apiPort}/api/progress-images/${imageFixtureVersion.id}?changed=1`)};
      host.querySelector(".progress-thumbnail").dataset.progressImageSrc = changedSource;
      window.mountProgressImageThumbnails(host);
      const changedImage = host.querySelector("img.progress-thumbnail-image");
      await wait(() => changedImage?.complete && changedImage?.naturalWidth > 0, "changed image load");
      states.urlChanged = {
        replacedImage: changedImage !== firstImage,
        ...describe(host)
      };

      host.innerHTML = window.renderProgressThumbnail(version(
        "css-progress-error",
        { url: "/api/progress-images/css-regression-invalid" }
      ));
      window.mountProgressImageThumbnails(host);
      await wait(() => host.querySelector(".progress-thumbnail")?.classList.contains("is-image-fallback"), "image error");
      states.errorEmpty = describe(host);

      host.innerHTML = '<div class="progress-thumbnail has-progress-image" data-version-id="css-progress-fallback" data-progress-image-src="http://localhost:${apiPort}/api/progress-images/css-regression-invalid">'
        + '<div class="progress-thumbnail-image-wrap"></div>'
        + '<div class="progress-thumbnail-fallback" hidden><span>map fallback</span></div>'
        + '<span class="progress-thumbnail-value">progress 50%</span>'
        + '</div>';
      window.mountProgressImageThumbnails(host);
      await wait(() => host.querySelector(".progress-thumbnail")?.classList.contains("is-image-fallback"), "fallback display");
      states.fallback = describe(host);

      host.innerHTML = window.renderProgressThumbnail(version("css-progress-missing", null));
      states.missingUrl = describe(host);

      host.innerHTML = window.renderProgressThumbnail(version(
        "css-progress-invalid",
        { url: "httpx://[" }
      ));
      states.invalidUrl = describe(host);

      host.innerHTML = window.renderProgressThumbnail(version(
        "css-progress-blob",
        { url: "blob:http://127.0.0.1/css-progress" }
      ));
      states.blobRejected = describe(host);

      host.innerHTML = window.renderProgressThumbnail(version(
        "css-progress-standalone",
        { url: ${JSON.stringify(`/api/progress-images/${imageFixtureVersion.id}`)} }
      ));
      window.mountProgressImageThumbnails(host);
      await wait(() => host.querySelector(".progress-thumbnail")?.classList.contains("is-image-loaded"), "standalone image");
      states.standalone = describe(host);

      const cell = document.createElement("div");
      cell.className = "thumbnail-cell";
      cell.innerHTML = window.renderProgressThumbnail(version(
        "css-progress-cell",
        { url: ${JSON.stringify(`/api/progress-images/${imageFixtureVersion.id}`)} }
      ));
      host.replaceChildren(cell);
      window.mountProgressImageThumbnails(host);
      await wait(() => cell.querySelector(".progress-thumbnail")?.classList.contains("is-image-loaded"), "thumbnail cell image");
      states.thumbnailCell = describe(cell);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const originalAnimationFrame = window.requestAnimationFrame;
      const originalCancelAnimationFrame = window.cancelAnimationFrame;
      let animationFrameCount = 0;
      let cancelAnimationFrameCount = 0;
      window.requestAnimationFrame = (callback) => {
        animationFrameCount += 1;
        return originalAnimationFrame.call(window, callback);
      };
      window.cancelAnimationFrame = (handle) => {
        cancelAnimationFrameCount += 1;
        return originalCancelAnimationFrame.call(window, handle);
      };
      window.scheduleProgressImageThumbnailMount(host);
      window.scheduleProgressImageThumbnailMount(host);
      const directSchedule = { animationFrameCount, cancelAnimationFrameCount };
      await new Promise((resolve) => setTimeout(resolve, 80));

      animationFrameCount = 0;
      cancelAnimationFrameCount = 0;
      const observerMarker = document.createElement("span");
      document.querySelector("#chartList")?.appendChild(observerMarker);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const observerSchedule = { animationFrameCount, cancelAnimationFrameCount };
      window.requestAnimationFrame = originalAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      observerMarker.remove();
      await new Promise((resolve) => setTimeout(resolve, 80));
      states.scheduler = { directSchedule, observerSchedule };

      const loadMoreTarget = document.createElement("div");
      document.body.appendChild(loadMoreTarget);
      const loadMoreVersion = {
        id: "css-progress-load-more",
        versionId: "css-progress-load-more",
        parentVersionId: null,
        displayVersion: "ver1.0",
        branchPath: "root",
        difficulty: "★1",
        author: "CSS fixture",
        progress: 50,
        comment: "load-more fixture",
        createdAt: "2026-07-25T01:00:00.000Z",
        isRejected: false,
        hidden: false,
        publicDataRedacted: false,
        publicActionsHidden: false,
        canShowActions: true,
        lifecycleStatus: "active",
        handlingMode: null,
        downloadBlocked: false,
        withdrawalDownloadBlocked: false,
        downloadAvailable: true,
        allowAppend: true,
        appendAvailable: true,
        managementAvailable: true,
        collapsedByCompletion: false,
        originUrl: "https://example.com/css-progress-load-more",
        file: { downloadUrl: "http://localhost:${apiPort}/api/files/css-progress-load-more" },
        progressMap: null,
        progressImage: { url: "/api/progress-images/${imageFixtureVersion.id}" }
      };
      const loadMoreMountStartedAt = performance.now();
      const loadMoreContext = window.BmsChartRenderPipeline.renderInto({
        charts: [{
          song: { id: "css-song-load-more", title: "Load more", artist: "CSS fixture" },
          chart: { id: "css-chart-load-more", chartId: "css-chart-load-more", name: "CSS fixture" },
          versions: [loadMoreVersion]
        }]
      }, loadMoreTarget, { mode: "append", source: "load-more", suppressFavorites: true });
      await wait(() => loadMoreTarget.querySelector(".progress-thumbnail")?.classList.contains("is-image-loaded"), "load-more image");
      states.loadMore = {
        mode: loadMoreContext.mode,
        source: loadMoreContext.source,
        renderedNodeCount: loadMoreContext.renderedNodes.length,
        stageNames: loadMoreContext.stageResults.map((result) => result.name),
        chartCount: loadMoreTarget.querySelectorAll(".chart-group").length,
        versionCount: loadMoreTarget.querySelectorAll(".version-row").length,
        thumbnail: describe(loadMoreTarget)
      };
      states.timings = {
        imageMountMs,
        loadMoreMountMs: round(performance.now() - loadMoreMountStartedAt)
      };
      loadMoreTarget.remove();

      states.runtimeStyles = {
        favorite: document.querySelectorAll("#favoriteListStyles").length,
        progress: document.querySelectorAll("#progress-image-thumbnail-style").length,
        total: document.querySelectorAll("style").length,
        staticStylesheet: [...document.styleSheets].filter((sheet) => (
          sheet.href && new URL(sheet.href).pathname.endsWith("/progress-thumbnail-list.css")
        )).length
      };
      states.pipeline = window.BmsChartRenderPipeline.getRegisteredStages();
      states.warnings = warnings;
      return states;
    } finally {
      console.warn = originalWarn;
      host.remove();
    }
  })()`);
}

async function captureDetailStatusStyle(cdp, sessionId, state) {
  const selector = "#selectedChartStatus";
  await evaluate(cdp, sessionId, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.classList.toggle("is-error", ${JSON.stringify(state)} === "error");
    element.classList.toggle("is-success", ${JSON.stringify(state)} === "success");
    return true;
  })()`);
  return captureBrowserStyle(cdp, sessionId, selector);
}

async function captureDetailTargetState(cdp, sessionId, versionId) {
  return evaluate(cdp, sessionId, `(() => {
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
    const rectValue = (rect) => ({
      left: round(rect.left), right: round(rect.right), top: round(rect.top), bottom: round(rect.bottom),
      width: round(rect.width), height: round(rect.height)
    });
    const clipAgainst = (inner, outer) => ({
      left: round(Math.max(0, outer.left - inner.left)),
      right: round(Math.max(0, inner.right - outer.right)),
      top: round(Math.max(0, outer.top - inner.top)),
      bottom: round(Math.max(0, inner.bottom - outer.bottom))
    });
    const overlaps = (first, second) => Boolean(first && second
      && first.left < second.right && first.right > second.left
      && first.top < second.bottom && first.bottom > second.top);
    const rows = [...document.querySelectorAll("#selectedChartCardSlot .version-row")];
    rows.forEach((candidate) => candidate.classList.remove("is-detail-target"));
    const row = rows.find((candidate) => candidate.dataset.versionId === ${JSON.stringify(versionId)});
    if (!row) throw new Error("detail target fixture row is missing");
    row.classList.add("is-detail-target");
    const style = getComputedStyle(row);
    const pseudo = getComputedStyle(row, "::after");
    const rowRect = row.getBoundingClientRect();
    const sectionRect = document.querySelector("#selectedChartSection").getBoundingClientRect();
    const shadowColors = [...style.boxShadow.matchAll(/rgba?\\([^)]*\\)/g)].map((match) => match[0]);
    const probe = document.createElement("span");
    probe.textContent = pseudo.content.replace(/^['\"]|['\"]$/g, "");
    Object.assign(probe.style, {
      position: "fixed",
      visibility: "hidden",
      padding: pseudo.padding,
      border: pseudo.border,
      borderRadius: pseudo.borderRadius,
      font: pseudo.font,
      fontSize: pseudo.fontSize,
      fontWeight: pseudo.fontWeight,
      lineHeight: pseudo.lineHeight,
      whiteSpace: pseudo.whiteSpace
    });
    document.body.appendChild(probe);
    const probeRect = probe.getBoundingClientRect();
    probe.remove();
    const badgeRight = rowRect.right - Number.parseFloat(pseudo.right || "0");
    const badgeTop = rowRect.top + Number.parseFloat(pseudo.top || "0");
    const badgeRect = {
      left: badgeRight - probeRect.width,
      right: badgeRight,
      top: badgeTop,
      bottom: badgeTop + probeRect.height,
      width: probeRect.width,
      height: probeRect.height
    };
    const lifecycleRect = row.querySelector(".withdrawal-pending-badge, .withdrawal-processing-badge, .withdrawal-tombstone-badge")?.getBoundingClientRect() || null;
    const favoriteRect = row.querySelector(".favorite-version-button")?.getBoundingClientRect() || null;
    const result = {
      versionId: row.dataset.versionId,
      classCount: document.querySelectorAll("#selectedChartCardSlot .version-row.is-detail-target").length,
      row: {
        backgroundColor: style.backgroundColor,
        color: style.color,
        boxShadow: style.boxShadow,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        rect: rectValue(rowRect),
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        viewportClip: clipAgainst(rowRect, { left: 0, right: document.documentElement.clientWidth, top: 0, bottom: innerHeight }),
        sectionClip: clipAgainst(rowRect, sectionRect)
      },
      accent: shadowColors[0] || null,
      border: shadowColors[1] || null,
      accentContrastRatio: contrast(shadowColors[0], style.backgroundColor),
      borderContrastRatio: contrast(shadowColors[1], style.backgroundColor),
      badge: {
        content: pseudo.content,
        display: pseudo.display,
        backgroundColor: pseudo.backgroundColor,
        color: pseudo.color,
        borderColor: pseudo.borderColor,
        borderStyle: pseudo.borderStyle,
        borderWidth: pseudo.borderWidth,
        fontSize: pseudo.fontSize,
        fontWeight: pseudo.fontWeight,
        padding: pseudo.padding,
        top: pseudo.top,
        right: pseudo.right,
        rect: rectValue(badgeRect),
        textContrastRatio: contrast(pseudo.color, pseudo.backgroundColor),
        borderContrastRatio: contrast(pseudo.borderColor, pseudo.backgroundColor),
        viewportClip: clipAgainst(badgeRect, { left: 0, right: document.documentElement.clientWidth, top: 0, bottom: innerHeight }),
        rowClip: clipAgainst(badgeRect, rowRect),
        lifecycleRect: lifecycleRect ? rectValue(lifecycleRect) : null,
        favoriteRect: favoriteRect ? rectValue(favoriteRect) : null,
        lifecycleOverlap: overlaps(badgeRect, lifecycleRect),
        favoriteOverlap: overlaps(badgeRect, favoriteRect)
      }
    };
    row.classList.remove("is-detail-target");
    return result;
  })()`);
}

async function captureDetailPresentation(cdp, sessionId) {
  const section = await captureBrowserStyle(cdp, sessionId, "#selectedChartSection");
  const headingIdle = await captureBrowserStyle(cdp, sessionId, "#selectedChartBackLink");
  const headingHover = await captureForcedPseudoStyle(cdp, sessionId, "#selectedChartBackLink", "hover");
  const headingFocus = await captureForcedPseudoStyle(cdp, sessionId, "#selectedChartBackLink", "focus-visible");
  const recentIdle = await captureBrowserStyle(cdp, sessionId, ".recent-chart-all-link");
  const recentHover = await captureForcedPseudoStyle(cdp, sessionId, ".recent-chart-all-link", "hover");
  const recentFocus = await captureForcedPseudoStyle(cdp, sessionId, ".recent-chart-all-link", "focus-visible");
  const statusIdle = await captureDetailStatusStyle(cdp, sessionId, "idle");
  const statusError = await captureDetailStatusStyle(cdp, sessionId, "error");
  const statusSuccess = await captureDetailStatusStyle(cdp, sessionId, "success");
  await evaluate(cdp, sessionId, `document.querySelector("#selectedChartStatus").classList.remove("is-error", "is-success")`);
  const targets = {};
  for (const versionId of ["version-active", "version-grace", "version-processing", "version-deleted"]) {
    targets[versionId] = await captureDetailTargetState(cdp, sessionId, versionId);
  }
  await evaluate(cdp, sessionId, `document.querySelector('.version-row[data-version-id="version-active"]').classList.add("is-detail-target")`);
  const targetFocus = await captureForcedPseudoStyle(
    cdp,
    sessionId,
    '.version-row[data-version-id="version-active"]',
    "focus"
  );
  await evaluate(cdp, sessionId, `document.querySelector('.version-row[data-version-id="version-active"]').classList.remove("is-detail-target")`);
  const switchState = await evaluate(cdp, sessionId, `(() => {
    const rows = [...document.querySelectorAll("#selectedChartCardSlot .version-row")];
    rows.forEach((row) => row.classList.remove("is-detail-target"));
    const oldRow = rows.find((row) => row.dataset.versionId === "version-active");
    const nextRow = rows.find((row) => row.dataset.versionId === "version-grace");
    oldRow.classList.add("is-detail-target");
    const before = { count: rows.filter((row) => row.classList.contains("is-detail-target")).length, versionId: oldRow.dataset.versionId };
    oldRow.classList.remove("is-detail-target");
    nextRow.classList.add("is-detail-target");
    const after = {
      count: rows.filter((row) => row.classList.contains("is-detail-target")).length,
      versionId: nextRow.dataset.versionId,
      oldActive: oldRow.classList.contains("is-detail-target"),
      nextActive: nextRow.classList.contains("is-detail-target")
    };
    nextRow.classList.remove("is-detail-target");
    return { before, after, finalCount: rows.filter((row) => row.classList.contains("is-detail-target")).length };
  })()`);
  const selection = await evaluate(cdp, sessionId, `({
    api: window.BmsChartDetail?.getSelection?.() || null,
    chartId: new URL(location.href).searchParams.get("chartId"),
    versionId: new URL(location.href).searchParams.get("versionId"),
    sectionHidden: document.querySelector("#selectedChartSection").hidden,
    cardCount: document.querySelectorAll("#selectedChartCardSlot > .chart-group").length,
    versionCount: document.querySelectorAll("#selectedChartCardSlot .version-row").length
  })`);
  return {
    section,
    headingIdle, headingHover, headingFocus,
    recentIdle, recentHover, recentFocus,
    statusIdle, statusError, statusSuccess,
    targets, targetFocus, switchState, selection
  };
}

async function captureProgressDragHintInteractions(cdp, sessionId) {
  const helperStates = await evaluate(cdp, sessionId, `(() => {
    const visible = window.BmsProgressMapDragHint.isVisible;
    const base = {
      editable: true,
      mapAvailable: true,
      analysisComplete: true,
      paintedCount: 0,
      isDragging: false,
      isRejected: false,
      isCompletionLocked: false,
      hasFailure: false
    };
    return {
      initial: visible(base),
      painted: visible({ ...base, paintedCount: 1 }),
      dragging: visible({ ...base, isDragging: true }),
      rejected: visible({ ...base, isRejected: true }),
      completion: visible({ ...base, isCompletionLocked: true }),
      analyzing: visible({ ...base, analysisComplete: false }),
      failed: visible({ ...base, hasFailure: true }),
      cleared: visible({ ...base, paintedCount: 0 })
    };
  })()`);
  assert.deepEqual(helperStates, {
    initial: true,
    painted: false,
    dragging: false,
    rejected: false,
    completion: false,
    analyzing: false,
    failed: false,
    cleared: true
  });

  const matrix = [];
  for (const theme of themes) {
    await setTheme(cdp, sessionId, theme);
    for (const width of widths) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      }, sessionId);
      const entry = await evaluate(cdp, sessionId, `(() => {
        const hint = document.querySelector("#progressMapDragHint");
        const host = hint.closest(".progress-block-interaction");
        hint.hidden = false;
        const style = getComputedStyle(hint);
        const rect = hint.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const result = {
          text: hint.textContent.trim(),
          hintCount: document.querySelectorAll("#progressMapDragHint").length,
          pointerEvents: style.pointerEvents,
          display: style.display,
          withinHost: rect.left >= hostRect.left - 1 && rect.right <= hostRect.right + 1
            && rect.top >= hostRect.top - 1 && rect.bottom <= hostRect.bottom + 1,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };
        hint.hidden = true;
        return result;
      })()`);
      assert.equal(entry.text, "ここをドラッグ");
      assert.equal(entry.hintCount, 1);
      assert.equal(entry.pointerEvents, "none");
      assert.equal(entry.display, "flex");
      assert.equal(entry.withinHost, true);
      assert.equal(entry.horizontalOverflow, false);
      matrix.push({ theme, width, ...entry });
    }
  }
  return { helperStates, matrix };
}

async function capturePostFormPointerUi(cdp, sessionId) {
  await setTheme(cdp, sessionId, "default");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1366,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);
  await evaluate(cdp, sessionId, `(() => {
    document.querySelector("#postFormToggle")?.click();
    const input = document.querySelector("#chartFile");
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(progressFormFixture)}], "progress-tooltip-regression.bms", { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await waitFor(cdp, sessionId, `document.querySelector(".submit-panel")?.classList.contains("is-form-open")
    && !document.querySelector(".progress-section")?.hidden
    && document.querySelectorAll("#progressMapBlocks .progress-map-block").length > 0`, "post form progress fixture");
  await new Promise((resolve) => setTimeout(resolve, 260));

  const matrix = [];
  for (const theme of themes) {
    await setTheme(cdp, sessionId, theme);
    for (const width of widths) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
      }, sessionId);
      await evaluate(cdp, sessionId, `document.querySelector("#progressMapBlocks")?.scrollIntoView({ block: "center" })`);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const entry = await evaluate(cdp, sessionId, `(() => {
        const blocks = [...document.querySelectorAll("#progressMapBlocks .progress-map-block")];
        const block = blocks[Math.floor(blocks.length / 2)];
        const blockRect = block.getBoundingClientRect();
        const pointer = {
          x: blockRect.left + (blockRect.width / 2),
          y: blockRect.top + (blockRect.height / 2)
        };
        block.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX: pointer.x,
          clientY: pointer.y,
          pointerId: 71,
          pointerType: "mouse"
        }));
        const tooltip = document.querySelector("#progressMapTooltip");
        const tooltipRect = tooltip.getBoundingClientRect();
        const progressSection = document.querySelector(".progress-section");
        const sectionStyle = getComputedStyle(progressSection);
        const row = document.querySelector("#incompleteStateControl");
        const radio = document.querySelector("#submissionStateIncomplete");
        const rowRect = row.getBoundingClientRect();
        const radioRect = radio.getBoundingClientRect();
        return {
          pointer,
          tooltipHidden: tooltip.hidden,
          tooltipText: tooltip.textContent,
          tooltipOffset: {
            x: tooltipRect.left - pointer.x,
            y: tooltipRect.top - pointer.y
          },
          tooltipWithinViewport: tooltipRect.left >= 0 && tooltipRect.right <= innerWidth
            && tooltipRect.top >= 0 && tooltipRect.bottom <= innerHeight,
          sectionTransform: sectionStyle.transform,
          sectionAnimationFillMode: sectionStyle.animationFillMode,
          radioInset: radioRect.left - rowRect.left,
          labelPaddingInlineStart: getComputedStyle(radio.closest(".submission-state-choice")).paddingInlineStart,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };
      })()`);
      assert.equal(entry.tooltipHidden, false, `${theme} ${width}px tooltip must be visible`);
      assert.match(entry.tooltipText, /小節:/u);
      assert.match(entry.tooltipText, /notes:/u);
      assert.ok(entry.tooltipOffset.x >= 8 && entry.tooltipOffset.x <= 20, `${theme} ${width}px tooltip x offset ${entry.tooltipOffset.x}`);
      assert.ok(entry.tooltipOffset.y >= 8 && entry.tooltipOffset.y <= 20, `${theme} ${width}px tooltip y offset ${entry.tooltipOffset.y}`);
      assert.equal(entry.tooltipWithinViewport, true, `${theme} ${width}px tooltip escaped viewport`);
      assert.equal(entry.sectionTransform, "none", `${theme} ${width}px progress section retained a transform`);
      assert.equal(entry.sectionAnimationFillMode, "none", `${theme} ${width}px reveal animation retained its final frame`);
      assert.ok(entry.radioInset >= 5 && entry.radioInset <= 6, `${theme} ${width}px radio inset ${entry.radioInset}`);
      assert.equal(entry.labelPaddingInlineStart, "5px");
      assert.equal(entry.horizontalOverflow, false, `${theme} ${width}px post form overflowed horizontally`);
      matrix.push({ theme, width, ...entry });
    }
  }
  await evaluate(cdp, sessionId, `(() => {
    document.querySelector("#chartForm")?.reset();
    window.BmsPostFormUi?.markClean?.();
    window.BmsPostFormUi?.close?.();
  })()`);
  await waitFor(cdp, sessionId, `window.BmsPostFormUi?.isDirty?.() === false`, "post form fixture cleanup");
  return { matrix };
}

async function captureAppendDropFileRevealRegression(cdp, sessionId) {
  await setTheme(cdp, sessionId, "default");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1366,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);
  await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(detailControlSelectors.appendAvailable)})?.click()`);
  await waitFor(cdp, sessionId, `document.querySelector(".submit-panel")?.classList.contains("is-append-mode")
    && !document.querySelector("#postFormBody")?.hidden`, "append form open before file drop");
  await evaluate(cdp, sessionId, `(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(appendCompletionFixture)}], "append-drop-regression.bms", { type: "text/plain" }));
    document.querySelector("#chartFileDropZone")?.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  })()`);
  await waitFor(cdp, sessionId, `document.querySelector("#chartFile")?.files?.length === 1`, "append drop file assignment");
  await waitFor(cdp, sessionId, `window.BmsAppendPolicy?.snapshot?.().hasValidAppendFile === true`, "append drop analysis readiness");
  const result = await evaluate(cdp, sessionId, `(() => {
    const deferred = [...document.querySelectorAll("[data-post-requires-file]")];
    return {
      appendMode: document.querySelector(".submit-panel")?.classList.contains("is-append-mode"),
      fileCount: document.querySelector("#chartFile")?.files?.length || 0,
      deferredCount: deferred.length,
      visibleDeferredCount: deferred.filter((section) => !section.hidden).length,
      diffVisible: !document.querySelector(".diff-info-section")?.hidden,
      progressVisible: !document.querySelector(".progress-section")?.hidden,
      formHasFileClass: document.querySelector("#chartForm")?.classList.contains("has-selected-chart-file"),
      stateControls: {
        incompleteChecked: document.querySelector("#submissionStateIncomplete")?.checked,
        incompleteDisabled: document.querySelector("#submissionStateIncomplete")?.disabled,
        completedChecked: document.querySelector("#submissionStateCompleted")?.checked,
        completedDisabled: document.querySelector("#submissionStateCompleted")?.disabled,
        rejectedDisabled: document.querySelector("#submissionStateRejected")?.disabled,
        completionButtonCount: document.querySelectorAll("#completeProgressButton").length
      },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })()`);
  assert.equal(result.appendMode, true);
  assert.equal(result.fileCount, 1);
  assert.equal(result.deferredCount, 5);
  assert.equal(result.visibleDeferredCount, result.deferredCount, "append drop must reveal every file-dependent section");
  assert.equal(result.diffVisible, true, "append drop must reveal diff information");
  assert.equal(result.progressVisible, true, "append drop must reveal progress controls");
  assert.equal(result.formHasFileClass, true);
  assert.deepEqual(result.stateControls, {
    incompleteChecked: true,
    incompleteDisabled: false,
    completedChecked: false,
    completedDisabled: false,
    rejectedDisabled: true,
    completionButtonCount: 0
  });
  assert.equal(result.horizontalOverflow, false);

  await evaluate(cdp, sessionId, `document.querySelector("#progressMapBlocks")?.scrollIntoView({ block: "center" })`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const manualPaintPoints = await evaluate(cdp, sessionId, `(() => {
    const blocks = [...document.querySelectorAll("#progressMapBlocks .progress-map-block")];
    return [0, 2].map((index) => {
      const rect = blocks[index].getBoundingClientRect();
      return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
    });
  })()`);
  for (const point of manualPaintPoints) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, sessionId);
  }
  await waitFor(cdp, sessionId, `document.querySelector("#progress")?.value === "75"`, "append manual layer paint");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const manual = await evaluate(cdp, sessionId, `(() => {
    const blocks = [...document.querySelectorAll("#progressMapBlocks .progress-map-block")];
    return {
      progress: document.querySelector("#progress")?.value,
      parent: blocks.map((block, index) => block.classList.contains("is-parent-painted") ? index : null).filter(Number.isInteger),
      current: blocks.map((block, index) => block.classList.contains("is-current-painted") ? index : null).filter(Number.isInteger),
      completion: blocks.map((block, index) => block.classList.contains("is-completion-painted") ? index : null).filter(Number.isInteger),
      rootCurrentColor: getComputedStyle(document.documentElement).getPropertyValue("--progress-fill-current").trim(),
      currentColor: getComputedStyle(blocks[2], "::after").backgroundColor
    };
  })()`);
  assert.deepEqual(manual, {
    progress: "75",
    parent: [0, 1],
    current: [0, 2],
    completion: [],
    rootCurrentColor: "#E39D3C",
    currentColor: "rgb(227, 157, 60)"
  });

  await evaluate(cdp, sessionId, `document.querySelector("#submissionStateCompleted")?.click()`);
  await waitFor(cdp, sessionId, `document.querySelector("#progress")?.value === "100"
    && window.BmsAppendPolicy?.snapshot?.().isCompleted === true`, "append completion radio auto fill");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const completed = await evaluate(cdp, sessionId, `(() => {
    const blocks = [...document.querySelectorAll("#progressMapBlocks .progress-map-block")];
    return {
      incompleteChecked: document.querySelector("#submissionStateIncomplete")?.checked,
      completedChecked: document.querySelector("#submissionStateCompleted")?.checked,
      progress: document.querySelector("#progress")?.value,
      blockCount: blocks.length,
      paintedCount: blocks.filter((block) => block.getAttribute("aria-pressed") === "true").length,
      lockedCount: blocks.filter((block) => block.disabled).length,
      completionLocked: document.querySelector("#progressMap")?.classList.contains("is-completion-locked"),
      parent: blocks.map((block, index) => block.classList.contains("is-parent-painted") ? index : null).filter(Number.isInteger),
      current: blocks.map((block, index) => block.classList.contains("is-current-painted") ? index : null).filter(Number.isInteger),
      completion: blocks.map((block, index) => block.classList.contains("is-completion-painted") ? index : null).filter(Number.isInteger),
      completionColor: getComputedStyle(blocks[3], "::after").backgroundColor,
      preview: window.BmsProgressImage?.buildProgressMapFromVisibleEditor?.(),
      priorities: {
        manual: window.BmsProgressLayerColors?.getLayerPaintPriority?.({ kind: "followup" }),
        parent: window.BmsProgressLayerColors?.getLayerPaintPriority?.({ kind: "initial" }),
        completion: window.BmsProgressLayerColors?.getLayerPaintPriority?.({ kind: "completion_fill" })
      }
    };
  })()`);
  assert.equal(completed.incompleteChecked, false);
  assert.equal(completed.completedChecked, true);
  assert.equal(completed.progress, "100");
  assert.ok(completed.blockCount > 0);
  assert.equal(completed.paintedCount, completed.blockCount, "completed radio must fill every progress block");
  assert.equal(completed.lockedCount, completed.blockCount, "completed radio must lock manual painting");
  assert.equal(completed.completionLocked, true);
  assert.deepEqual(completed.parent, [0, 1]);
  assert.deepEqual(completed.current, [0, 2]);
  assert.deepEqual(completed.completion, [3]);
  assert.equal(completed.completionColor, "rgb(227, 157, 60)");
  assert.deepEqual(completed.preview.layers.map((layer) => ({ kind: layer.kind, ranges: layer.ranges })), [
    { kind: "parent_preview", ranges: [[0, 1]] },
    { kind: "followup", ranges: [[0, 0], [2, 2]] },
    { kind: "completion_fill", ranges: [[3, 3]] }
  ]);
  assert.deepEqual(completed.priorities, { manual: 3, parent: 2, completion: 1 });
  assert.equal(completed.preview.layers.at(-2).color, "#E39D3C");
  assert.equal(completed.preview.layers.at(-1).color, "#E39D3C");

  await evaluate(cdp, sessionId, `document.querySelector("#submissionStateIncomplete")?.click()`);
  await waitFor(cdp, sessionId, `document.querySelector("#progress")?.value === "75"
    && window.BmsAppendPolicy?.snapshot?.().isCompleted === false`, "append incomplete radio restore");
  const restored = await evaluate(cdp, sessionId, `(() => {
    const blocks = [...document.querySelectorAll("#progressMapBlocks .progress-map-block")];
    return {
      incompleteChecked: document.querySelector("#submissionStateIncomplete")?.checked,
      completedChecked: document.querySelector("#submissionStateCompleted")?.checked,
      progress: document.querySelector("#progress")?.value,
      paintedCount: blocks.filter((block) => block.getAttribute("aria-pressed") === "true").length,
      lockedCount: blocks.filter((block) => block.disabled).length,
      parent: blocks.map((block, index) => block.classList.contains("is-parent-painted") ? index : null).filter(Number.isInteger),
      current: blocks.map((block, index) => block.classList.contains("is-current-painted") ? index : null).filter(Number.isInteger),
      completion: blocks.map((block, index) => block.classList.contains("is-completion-painted") ? index : null).filter(Number.isInteger)
    };
  })()`);
  assert.deepEqual(restored, {
    incompleteChecked: true,
    completedChecked: false,
    progress: "75",
    paintedCount: 3,
    lockedCount: 0,
    parent: [0, 1],
    current: [0, 2],
    completion: []
  });

  const finalBlockPoint = await evaluate(cdp, sessionId, `(() => {
    const block = [...document.querySelectorAll("#progressMapBlocks .progress-map-block")][3];
    const rect = block.getBoundingClientRect();
    return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: finalBlockPoint.x, y: finalBlockPoint.y, button: "left", clickCount: 1 }, sessionId);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: finalBlockPoint.x, y: finalBlockPoint.y, button: "left", clickCount: 1 }, sessionId);
  await waitFor(cdp, sessionId, `document.querySelector("#progress")?.value === "100"
    && document.querySelector("#submissionStateCompleted")?.checked === true
    && window.BmsAppendPolicy?.snapshot?.().isCompleted === true`, "manual 100 percent auto completion");
  await evaluate(cdp, sessionId, `document.querySelector("#cancelAppendButton")?.click()`);
  await waitFor(cdp, sessionId, `!document.querySelector(".submit-panel")?.classList.contains("is-append-mode")
    && !document.querySelector("#chartFile")?.files?.length`, "append drop fixture cleanup");
  return { ...result, manual, completed, restored };
}

async function captureVersionCommentInteractions(cdp, sessionId) {
  await setTheme(cdp, sessionId, "default");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);
  const sourceSelector = '.version-row[data-version-id="version-active"] .version-comment-button';
  const expectedAuthorComment = versions[0].comment;
  const initial = await evaluate(cdp, sessionId, `(() => {
    const source = document.querySelector(${JSON.stringify(sourceSelector)});
    const authorText = document.querySelector('.version-row[data-version-id="version-active"] .author-comment-preview-text');
    const fullButton = document.querySelector('.version-row[data-version-id="version-active"] .author-comment-full-button');
    return {
      count: source?.querySelector(".version-comment-count")?.textContent,
      authorText: authorText?.textContent,
      authorClipped: authorText ? authorText.scrollHeight > authorText.clientHeight + 1 : false,
      fullButtonVisible: Boolean(fullButton && !fullButton.hidden),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })()`);
  assert.equal(initial.count, "2");
  assert.equal(initial.authorText, expectedAuthorComment);
  assert.equal(initial.authorClipped, true);
  assert.equal(initial.fullButtonVisible, true);
  assert.equal(initial.horizontalOverflow, false);

  await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(sourceSelector)}).click()`);
  await waitFor(cdp, sessionId, `document.querySelector("#versionCommentDialog")?.open
    && document.querySelectorAll("#versionCommentDialog .version-comment-item").length === 2`, "version comment dialog");
  const opened = await evaluate(cdp, sessionId, `(() => {
    const dialog = document.querySelector("#versionCommentDialog");
    const rect = dialog.getBoundingClientRect();
    return {
      role: dialog.getAttribute("role"),
      ariaLabelledby: dialog.getAttribute("aria-labelledby"),
      activeClass: document.activeElement?.className || "",
      bodyLocked: document.body.classList.contains("version-comment-dialog-open"),
      authorText: dialog.querySelector("[data-comment-author-body]").textContent,
      total: dialog.querySelector("[data-comment-total]").textContent,
      itemBodies: [...dialog.querySelectorAll(".version-comment-item-body")].map((item) => item.textContent),
      withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })()`);
  assert.equal(opened.role, "dialog");
  assert.equal(opened.ariaLabelledby, "versionCommentDialogTitle");
  assert.match(opened.activeClass, /version-comment-dialog-close/);
  assert.equal(opened.bodyLocked, true);
  assert.equal(opened.authorText, expectedAuthorComment);
  assert.equal(opened.total, "2");
  assert.deepEqual(opened.itemBodies, ["First public comment", "Existing latest public comment"]);
  assert.equal(opened.withinViewport, true);
  assert.equal(opened.horizontalOverflow, false);

  const focusTrap = await evaluate(cdp, sessionId, `(() => {
    const close = document.querySelector("#versionCommentDialog [data-version-comment-close]");
    close.focus();
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    return document.activeElement?.tagName || "";
  })()`);
  assert.equal(focusTrap, "TEXTAREA");

  const inputLimits = await evaluate(cdp, sessionId, `(() => {
    const textarea = document.querySelector("#versionCommentBody");
    const submit = document.querySelector("#versionCommentDialog [data-comment-submit]");
    textarea.value = "   \\n\\t";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const whitespaceDisabled = submit.disabled;
    textarea.value = "x".repeat(501);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return {
      whitespaceDisabled,
      codePoints: Array.from(textarea.value).length,
      counter: document.querySelector("#versionCommentDialog [data-comment-counter]").textContent,
      submitEnabledAtLimit: !submit.disabled
    };
  })()`);
  assert.equal(inputLimits.whitespaceDisabled, true);
  assert.equal(inputLimits.codePoints, 500);
  assert.equal(inputLimits.counter, "500 / 500");
  assert.equal(inputLimits.submitEnabledAtLimit, true);

  const submitStart = await evaluate(cdp, sessionId, `(() => {
    const textarea = document.querySelector("#versionCommentBody");
    const submit = document.querySelector("#versionCommentDialog [data-comment-submit]");
    textarea.value = "Fresh public comment\\nsecond line";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const disabledBeforeClick = submit.disabled;
    submit.click();
    submit.click();
    return {
      disabledBeforeClick,
      disabledAfterClick: submit.disabled,
      counter: document.querySelector("#versionCommentDialog [data-comment-counter]").textContent
    };
  })()`);
  assert.equal(submitStart.disabledBeforeClick, false);
  assert.equal(submitStart.disabledAfterClick, true);
  assert.equal(submitStart.counter, "32 / 500");
  await waitFor(cdp, sessionId, `Number(document.querySelector("#versionCommentDialog [data-comment-total]")?.textContent) >= 3
    && document.querySelectorAll("#versionCommentDialog .version-comment-item").length >= 3
    && document.querySelector("#versionCommentBody")?.value === ""`, "version comment post");
  assert.equal(commentFixture.postRequests, 1);
  const afterPost = await evaluate(cdp, sessionId, `(() => ({
    dialogCount: document.querySelector("#versionCommentDialog [data-comment-total]").textContent,
    actionCount: document.querySelector(${JSON.stringify(sourceSelector)}).querySelector(".version-comment-count").textContent,
    latest: document.querySelector('.version-row[data-version-id="version-active"] .version-comment-latest-text').textContent,
    itemBodies: [...document.querySelectorAll("#versionCommentDialog .version-comment-item-body")].map((item) => item.textContent)
  }))()`);
  assert.equal(afterPost.dialogCount, "3");
  assert.equal(afterPost.actionCount, "3");
  assert.equal(afterPost.latest, "Fresh public comment\nsecond line");
  assert.equal(afterPost.itemBodies.at(-1), "Fresh public comment\nsecond line");

  await evaluate(cdp, sessionId, `document.querySelector("#versionCommentDialog [data-version-comment-close]").click()`);
  await waitFor(cdp, sessionId, `!document.querySelector("#versionCommentDialog")?.open`, "comment dialog close");
  const closeFocusReturned = await evaluate(cdp, sessionId, `document.activeElement === document.querySelector(${JSON.stringify(sourceSelector)})`);
  assert.equal(closeFocusReturned, true);

  await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(sourceSelector)}).click()`);
  await waitFor(cdp, sessionId, `document.querySelector("#versionCommentDialog")?.open`, "comment dialog reopen for Escape");
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  }, sessionId);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  }, sessionId);
  await waitFor(cdp, sessionId, `!document.querySelector("#versionCommentDialog")?.open`, "comment dialog Escape");

  await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(sourceSelector)}).click()`);
  await waitFor(cdp, sessionId, `document.querySelector("#versionCommentDialog")?.open`, "comment dialog reopen for backdrop");
  await evaluate(cdp, sessionId, `document.querySelector("#versionCommentDialog")
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))`);
  await waitFor(cdp, sessionId, `!document.querySelector("#versionCommentDialog")?.open`, "comment dialog backdrop");

  const inPlaceResult = await evaluate(cdp, sessionId, `window.BmsChartDetail.refreshAfterManagement({
    chartId: "chart-audit",
    outcome: "updated"
  })`);
  assert.equal(inPlaceResult, true);
  await waitFor(cdp, sessionId, `document.querySelector(${JSON.stringify(sourceSelector)})?.querySelector(".version-comment-count")?.textContent === "3"`, "in-place comment rerender");
  const inPlaceCount = await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(sourceSelector)}).querySelector(".version-comment-count").textContent`);

  const previousTimeOrigin = await evaluate(cdp, sessionId, "performance.timeOrigin");
  await cdp.send("Page.reload", { ignoreCache: true }, sessionId);
  await waitFor(cdp, sessionId, `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`, "comment page reload navigation");
  await waitFor(cdp, sessionId, `document.querySelector(${JSON.stringify(sourceSelector)})?.querySelector(".version-comment-count")?.textContent === "3"
    && document.querySelector('.version-row[data-version-id="version-active"] .author-comment-preview-text')`, "reloaded comment summary");
  const reloadState = await evaluate(cdp, sessionId, `(() => ({
    count: document.querySelector(${JSON.stringify(sourceSelector)}).querySelector(".version-comment-count").textContent,
    authorText: document.querySelector('.version-row[data-version-id="version-active"] .author-comment-preview-text').textContent,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }))()`);
  assert.equal(inPlaceCount, "3");
  assert.equal(reloadState.count, "3");
  assert.equal(reloadState.authorText, expectedAuthorComment);
  assert.equal(reloadState.horizontalOverflow, false);

  return { initial, opened, inputLimits, afterPost, closeFocusReturned, inPlaceCount, reloadState };
}

async function captureDetailRerenderRegression(cdp, sessionId) {
  await setTheme(cdp, sessionId, "dark");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);
  await evaluate(cdp, sessionId, `window.__cssDetailRenderedCount = 0;
    document.querySelector("#selectedChartSection").addEventListener("chart-detail:rendered", () => {
      window.__cssDetailRenderedCount += 1;
    });`);
  const before = await evaluate(cdp, sessionId, `({
    selection: window.BmsChartDetail.getSelection(),
    cardCount: document.querySelectorAll("#selectedChartCardSlot > .chart-group").length,
    versionCount: document.querySelectorAll("#selectedChartCardSlot .version-row").length,
    activeLayout: (() => {
      const row = document.querySelector('.version-row[data-version-id="version-active"]');
      const actions = row?.querySelector('.version-actions');
      return {
        rowColumns: row ? getComputedStyle(row).gridTemplateColumns : "",
        actionAreas: actions ? getComputedStyle(actions).gridTemplateAreas : "",
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })()
  })`);
  const appendResult = await evaluate(cdp, sessionId, `window.BmsChartDetail.showCreatedVersion({
    chartId: "chart-audit",
    versionId: "version-active",
    message: "投稿しました。"
  })`);
  const afterAppend = await evaluate(cdp, sessionId, `({
    selection: window.BmsChartDetail.getSelection(),
    url: location.href,
    cardCount: document.querySelectorAll("#selectedChartCardSlot > .chart-group").length,
    versionCount: document.querySelectorAll("#selectedChartCardSlot .version-row").length,
    targetCount: document.querySelectorAll("#selectedChartCardSlot .is-detail-target").length,
    statusText: document.querySelector("#selectedChartStatus").textContent,
    statusSuccess: document.querySelector("#selectedChartStatus").classList.contains("is-success"),
    renderedCount: window.__cssDetailRenderedCount,
    activeLayout: (() => {
      const row = document.querySelector('.version-row[data-version-id="version-active"]');
      const actions = row?.querySelector('.version-actions');
      return {
        rowColumns: row ? getComputedStyle(row).gridTemplateColumns : "",
        actionAreas: actions ? getComputedStyle(actions).gridTemplateAreas : "",
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })()
  })`);
  const managementResult = await evaluate(cdp, sessionId, `window.BmsChartDetail.refreshAfterManagement({
    chartId: "chart-audit",
    outcome: "updated"
  })`);
  const afterManagement = await evaluate(cdp, sessionId, `({
    selection: window.BmsChartDetail.getSelection(),
    url: location.href,
    cardCount: document.querySelectorAll("#selectedChartCardSlot > .chart-group").length,
    versionCount: document.querySelectorAll("#selectedChartCardSlot .version-row").length,
    targetCount: document.querySelectorAll("#selectedChartCardSlot .is-detail-target").length,
    renderedCount: window.__cssDetailRenderedCount,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    activeLayout: (() => {
      const row = document.querySelector('.version-row[data-version-id="version-active"]');
      const actions = row?.querySelector('.version-actions');
      return {
        rowColumns: row ? getComputedStyle(row).gridTemplateColumns : "",
        actionAreas: actions ? getComputedStyle(actions).gridTemplateAreas : "",
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })()
  })`);
  return { before, appendResult, afterAppend, managementResult, afterManagement };
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
      compactLinks: ".compact-links",
      compactComments: ".compact-comment",
      commentPreviews: ".compact-comment .author-comment-preview",
      latestCommentPreviews: ".compact-comment .version-comment-latest-preview:not([hidden])",
      originLinks: ".compact-origin-link",
      downloads: ".compact-download-link, .compact-download-disabled"
    })};
    const elements = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, inspect(selector)]));
    const densityRows = [...document.querySelectorAll(${JSON.stringify(pageKind)} === "detail" ? ".version-row" : ".compact-version-row")]
      .map((row, index) => {
        const rowRect = row.getBoundingClientRect();
        const actions = row.querySelector(${JSON.stringify(pageKind)} === "detail" ? ".version-actions" : ".compact-actions-cell");
        const comment = row.querySelector(${JSON.stringify(pageKind)} === "detail" ? ".comment-cell .meta-value" : ".compact-comment");
        const commentColumn = row.querySelector(${JSON.stringify(pageKind)} === "detail" ? ".comment-cell" : ".compact-comment");
        const authorText = comment?.querySelector(".author-comment-preview-text") || null;
        const authorLabel = comment?.querySelector(".author-comment-preview-label") || null;
        const latestText = comment?.querySelector(".version-comment-latest-text") || null;
        const latestLabel = comment?.querySelector(".version-comment-latest-label") || null;
        const fullLink = comment?.querySelector(".author-comment-full-button:not([hidden])") || null;
        const actionControls = actions
          ? [...actions.querySelectorAll(":scope > a, :scope > button, :scope > .version-download-control, :scope > .compact-link-control")]
            .filter((control) => {
              const style = getComputedStyle(control);
              return !control.hidden && style.display !== "none" && control.getClientRects().length > 0;
            })
          : [];
        const actionRects = actionControls.map((control) => control.getBoundingClientRect());
        const actionStyles = actionControls.map((control) => getComputedStyle(control));
        const actionLineCount = new Set(actionRects.map((rect) => Math.round(rect.top))).size;
        const management = actions?.querySelector(".version-management-button") || null;
        const managementRect = management?.getBoundingClientRect?.() || null;
        const progressPill = row.querySelector(".progress-pill");
        const progressStyle = progressPill ? getComputedStyle(progressPill) : null;
        const commentText = String(comment?.textContent || "").trim();
        return {
          index,
          versionId: row.dataset.versionId || "",
          exceptionalState: row.matches(".is-withdrawal-pending, .is-withdrawal-processing, .is-withdrawal-tombstone, .is-intermediate-history"),
          height: round(rowRect.height),
          hasComment: Boolean(comment && !comment.hidden && getComputedStyle(comment).display !== "none" && commentText),
          commentHidden: !comment || comment.hidden || getComputedStyle(comment).display === "none",
          commentHeight: round(comment?.getBoundingClientRect?.().height || 0),
          commentTextLength: commentText.length,
          commentColumnWidth: round(commentColumn?.getBoundingClientRect?.().width || 0),
          actionsWidth: round(actions?.getBoundingClientRect?.().width || 0),
          progressText: String(progressPill?.textContent || "").trim(),
          progressCompletedTone: Boolean(progressPill?.classList.contains("is-completed")),
          progressBackgroundColor: progressStyle?.backgroundColor || "",
          authorPreviewLines: authorText
            ? round(authorText.getBoundingClientRect().height
              / Number.parseFloat(getComputedStyle(authorText).lineHeight))
            : 0,
          authorFontSize: authorText ? Number.parseFloat(getComputedStyle(authorText).fontSize) : 0,
          authorLineHeightRatio: authorText
            ? round(Number.parseFloat(getComputedStyle(authorText).lineHeight) / Number.parseFloat(getComputedStyle(authorText).fontSize))
            : 0,
          authorLabelVisible: Boolean(authorLabel && authorLabel.getBoundingClientRect().width > 1 && authorLabel.getBoundingClientRect().height > 1),
          authorLabelVisuallyHidden: Boolean(authorLabel?.classList.contains("visually-hidden")),
          latestPreviewLines: latestText
            ? round(latestText.getBoundingClientRect().height
              / Number.parseFloat(getComputedStyle(latestText).lineHeight))
            : 0,
          latestFontSize: latestText ? Number.parseFloat(getComputedStyle(latestText).fontSize) : 0,
          latestLabelVisible: Boolean(latestLabel && latestLabel.getBoundingClientRect().width > 1 && latestLabel.getBoundingClientRect().height > 1),
          latestLabelVisuallyHidden: Boolean(latestLabel?.classList.contains("visually-hidden")),
          fullLinkPosition: fullLink ? getComputedStyle(fullLink).position : "",
          fullLinkFontSize: fullLink ? Number.parseFloat(getComputedStyle(fullLink).fontSize) : 0,
          actionControlCount: actionControls.length,
          actionControls: actionControls.map((control, controlIndex) => ({
            text: String(control.textContent || "").trim(),
            ariaLabel: control.getAttribute("aria-label") || "",
            height: round(actionRects[controlIndex].height),
            width: round(actionRects[controlIndex].width),
            fontSize: Number.parseFloat(actionStyles[controlIndex].fontSize),
            borderRadius: Number.parseFloat(actionStyles[controlIndex].borderRadius)
          })),
          actionLineCount,
          actionGridColumns: actions ? getComputedStyle(actions).gridTemplateColumns : "",
          actionGridAreas: actions ? getComputedStyle(actions).gridTemplateAreas : "",
          actionsContained: actionRects.every((rect) => (
            rect.left >= rowRect.left - 1
            && rect.right <= rowRect.right + 1
            && rect.top >= rowRect.top - 1
            && rect.bottom <= rowRect.bottom + 1
          )),
          managementContained: !managementRect || (
            managementRect.left >= rowRect.left - 1
            && managementRect.right <= rowRect.right + 1
          )
        };
      });
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
    const detailLayout = ${JSON.stringify(pageKind)} === "detail";
    const columnAlignment = innerWidth > (detailLayout ? 760 : 1179) ? (() => {
      const header = document.querySelector(detailLayout ? ".version-list-header" : ".compact-list-head");
      const row = document.querySelector(detailLayout ? ".version-row.version-tree-row" : ".compact-version-row");
      const pairs = detailLayout
        ? [
            ["version", ".version-list-heading-version", ".version-tree-cell"],
            ["difficulty", ".version-list-heading-difficulty", ".difficulty-cell"],
            ["author", ".version-list-heading-author", ".author-cell"],
            ["progress", ".version-list-heading-progress", ".progress-cell"],
            ["thumbnail", ".version-list-heading-thumbnail", ".thumbnail-cell"],
            ["comment", ".version-list-heading-comment", ".comment-cell"],
            ["actions", ".version-list-heading-actions", ".actions-cell"]
          ]
        : [
            ["date", ".list-heading-date", ".compact-date-cell"],
            ["chart", ".list-heading-chart", ".compact-sheet-cell"],
            ["meta", ".list-heading-meta", ".compact-meta-cell"],
            ["progress", ".list-heading-progress", ".compact-progress"],
            ["comment", ".list-heading-comment", ".compact-comment"],
            ["actions", ".list-heading-actions", ".compact-actions-cell"]
          ];
      return Object.fromEntries(pairs.map(([name, headingSelector, cellSelector]) => {
        const heading = header?.querySelector(headingSelector);
        const cell = row?.querySelector(cellSelector);
        if (!heading || !cell) return [name, null];
        const headingRect = heading.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const textRange = document.createRange();
        textRange.selectNodeContents(heading);
        const headingTextRect = textRange.getBoundingClientRect();
        const visualElements = name === "actions"
          ? [...cell.querySelectorAll(":scope > a, :scope > button, :scope > .version-download-control, :scope > .compact-link-control")]
          : name === "progress"
            ? [cell.querySelector(".progress-pill")].filter(Boolean)
            : name === "comment"
              ? [cell.querySelector(".author-comment-preview, .version-comment-latest-preview")].filter(Boolean)
              : name === "meta" || name === "difficulty" || name === "author"
                ? [...cell.querySelectorAll(".compact-difficulty, .compact-author, .meta-value")]
                : [];
        const visualRects = visualElements
          .filter((element) => !element.hidden && getComputedStyle(element).display !== "none")
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        const visualRect = visualRects.length > 0
          ? {
              left: Math.min(...visualRects.map((rect) => rect.left)),
              right: Math.max(...visualRects.map((rect) => rect.right))
            }
          : { left: cellRect.left, right: cellRect.right };
        const visualDifference = name === "progress" || name === "actions"
          ? Math.abs((headingTextRect.left + (headingTextRect.width / 2)) - ((visualRect.left + visualRect.right) / 2))
          : Math.abs(headingTextRect.left - visualRect.left);
        return [name, {
          xDifference: round(Math.abs(headingRect.left - cellRect.left)),
          widthDifference: round(Math.abs(headingRect.width - cellRect.width)),
          headingWidth: round(headingRect.width),
          cellWidth: round(cellRect.width),
          visualDifference: round(visualDifference)
        }];
      }));
    })() : null;
    return {
      pageKind: ${JSON.stringify(pageKind)},
      theme: document.documentElement.dataset.theme,
      viewport: { innerWidth, clientWidth: document.documentElement.clientWidth },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        overflowing: [...document.querySelectorAll("body *")].map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            id: element.id,
            className: String(element.className || ""),
            left: round(rect.left),
            right: round(rect.right),
            width: round(rect.width)
          };
        }).filter((item) => item.width > 0 && (item.left < -0.5 || item.right > document.documentElement.clientWidth + 0.5)).slice(0, 12)
      },
      counts: Object.fromEntries(Object.entries(elements).map(([name, items]) => [name, items.length])),
      elements,
      densityRows,
      columnAlignment,
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
      console.log(`css browser phase: ${pageKind} ${theme} ${width}px`);
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
          entry.detailPresentation = await captureDetailPresentation(cdp, sessionId);
          entry.controlInteractions = await captureControlInteractions(cdp, sessionId);
          entry.favoriteInteractions = await captureFavoriteInteractions(cdp, sessionId);
          entry.progressThumbnailStates = await captureProgressThumbnailStates(cdp, sessionId);
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
    management: ["rgba(0, 0, 0, 0)", "rgb(165, 55, 50)", "rgb(165, 55, 50)"],
    downloadUnavailable: ["rgb(227, 233, 231)", "rgb(111, 123, 119)", "rgb(207, 216, 213)"],
    genericSecondaryDisabled: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(207, 216, 213)"],
    withdrawalActionDisabled: ["rgb(227, 233, 231)", "rgb(111, 123, 119)", "rgb(207, 216, 213)"]
  },
  default: {
    appendAvailable: ["rgb(219, 230, 226)", "rgb(23, 76, 62)", "rgb(129, 151, 143)"],
    appendUnavailable: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    appendLegacy: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    appendIntermediate: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    management: ["rgba(0, 0, 0, 0)", "rgb(159, 56, 51)", "rgb(159, 56, 51)"],
    downloadUnavailable: ["rgb(198, 208, 205)", "rgb(101, 114, 110)", "rgb(170, 185, 180)"],
    genericSecondaryDisabled: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(170, 185, 180)"],
    withdrawalActionDisabled: ["rgb(198, 208, 205)", "rgb(101, 114, 110)", "rgb(170, 185, 180)"]
  },
  dark: {
    appendAvailable: ["rgb(38, 52, 47)", "rgb(212, 228, 222)", "rgb(107, 129, 121)"],
    appendUnavailable: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(70, 92, 84)"],
    appendLegacy: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(70, 92, 84)"],
    appendIntermediate: ["rgb(238, 243, 241)", "rgb(130, 145, 141)", "rgb(70, 92, 84)"],
    management: ["rgba(0, 0, 0, 0)", "rgb(255, 170, 164)", "rgb(255, 170, 164)"],
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

const detailPresentationColors = {
  white: {
    sectionBackground: "rgb(243, 248, 246)",
    sectionBorder: "rgb(183, 203, 197)",
    link: "rgb(25, 84, 67)",
    status: "rgb(90, 104, 100)",
    error: "rgb(165, 55, 50)",
    success: "rgb(23, 102, 71)",
    focus: "rgb(36, 110, 91)",
    targetBackground: "rgb(233, 246, 241)",
    targetAccent: "rgb(35, 128, 111)",
    targetBorder: "rgb(106, 148, 138)",
    badgeBackground: "rgb(255, 255, 255)",
    badgeText: "rgb(21, 95, 81)"
  },
  default: {
    sectionBackground: "rgb(243, 248, 246)",
    sectionBorder: "rgb(183, 203, 197)",
    link: "rgb(21, 82, 65)",
    status: "rgb(82, 99, 94)",
    error: "rgb(159, 56, 51)",
    success: "rgb(23, 102, 71)",
    focus: "rgb(31, 107, 87)",
    targetBackground: "rgb(233, 246, 241)",
    targetAccent: "rgb(35, 128, 111)",
    targetBorder: "rgb(106, 148, 138)",
    badgeBackground: "rgb(255, 255, 255)",
    badgeText: "rgb(21, 95, 81)"
  },
  dark: {
    sectionBackground: "rgb(23, 35, 31)",
    sectionBorder: "rgb(88, 113, 104)",
    link: "rgb(99, 185, 155)",
    status: "rgb(179, 192, 187)",
    error: "rgb(255, 170, 164)",
    success: "rgb(120, 215, 173)",
    focus: "rgb(79, 165, 137)",
    targetBackground: "rgb(32, 60, 51)",
    targetAccent: "rgb(99, 185, 155)",
    targetBorder: "rgb(118, 151, 139)",
    badgeBackground: "rgb(38, 52, 47)",
    badgeText: "rgb(212, 228, 222)"
  }
};

const progressThumbnailColors = {
  white: {
    background: "rgb(244, 247, 249)",
    border: "rgb(223, 230, 236)",
    emptyText: "rgb(102, 114, 127)"
  },
  default: {
    background: "rgb(244, 247, 249)",
    border: "rgb(223, 230, 236)",
    emptyText: "rgb(102, 114, 127)"
  },
  dark: {
    background: "rgb(23, 35, 31)",
    border: "rgb(88, 113, 104)",
    emptyText: "rgb(184, 199, 193)"
  }
};

function colorContrastRatio(first, second) {
  const channels = (value) => String(value || "").match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
  const luminance = (value) => {
    const linear = channels(value).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  };
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function controlColorTuple(control) {
  return [control.backgroundColor, control.color, control.borderColor];
}

function assertPageInvariants(snapshot, consoleMessages) {
  const assertCommentAndActionBalance = (entry, row) => {
    const location = `${entry.pageKind} ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`;
    if (row.authorPreviewLines > 0) {
      assert.ok(row.authorFontSize >= 13.9 && row.authorFontSize <= 14.1, `author comment font is not 14px at ${location}`);
      assert.ok(row.authorLineHeightRatio >= 1.45 && row.authorLineHeightRatio <= 1.55, `author comment line-height is outside 1.45-1.55 at ${location}`);
      assert.equal(row.authorLabelVisible, false, `author comment label is visible at ${location}`);
      assert.equal(row.authorLabelVisuallyHidden, true, `author comment label is not preserved for assistive technology at ${location}`);
    }
    if (row.latestPreviewLines > 0) {
      assert.ok(row.latestFontSize >= 13 && row.latestFontSize <= 14, `latest comment font is outside 13-14px at ${location}`);
      assert.equal(row.latestLabelVisible, false, `latest comment label is visible at ${location}`);
      assert.equal(row.latestLabelVisuallyHidden, true, `latest comment label is not preserved for assistive technology at ${location}`);
    }
    if (row.fullLinkPosition) {
      assert.equal(row.fullLinkPosition, "static", `full comment link overlays text at ${location}`);
      assert.ok(row.fullLinkFontSize <= 12, `full comment link is too large at ${location}`);
    }
    if (entry.requestedWidth >= 1024 && (entry.pageKind !== "compact" || row.hasComment)) {
      const minimumCommentWidth = entry.pageKind === "compact" ? 360 : 230;
      assert.ok(row.commentColumnWidth >= minimumCommentWidth, `comment column is narrower than ${minimumCommentWidth}px at ${location}`);
    }
    if (entry.requestedWidth >= 1366 && (entry.pageKind !== "compact" || row.hasComment)) {
      assert.ok(row.commentColumnWidth > row.actionsWidth, `comment column is not wider than actions at ${location}`);
    }
    if (entry.requestedWidth <= 760) {
      assert.equal(row.actionGridColumns.trim().split(/\s+/u).length, 2, `mobile actions create implicit grid columns at ${location}`);
      assert.doesNotMatch(row.actionGridAreas, /label/u, `mobile action label remains a grid item at ${location}`);
    }
    for (const control of row.actionControls) {
      if (entry.requestedWidth >= 1024) {
        assert.ok(control.height >= 32 && control.height <= 34, `desktop action height ${control.height}px is outside 32-34px at ${location}`);
        assert.ok(control.width <= 140, `desktop action width ${control.width}px is excessive at ${location}`);
        assert.ok(control.fontSize >= 13 && control.fontSize <= 14, `desktop action font is outside 13-14px at ${location}`);
        assert.ok(control.borderRadius >= 5 && control.borderRadius <= 6, `desktop action radius is outside 5-6px at ${location}`);
      } else {
        assert.ok(control.height >= 44, `mobile action height is below 44px at ${location}`);
      }
      if (control.text === "追記") assert.equal(control.ariaLabel, "追記投稿を開始", `append accessible name changed at ${location}`);
      if (control.text.startsWith("💬")) assert.match(control.ariaLabel, /^コメントを開く、\d+件（.+）$/u, `comment accessible name changed at ${location}`);
    }
  };
  const lifecycleExpectations = new Map([
    ["version-grace", ["withdrawal-pending-badge", "DL停止・自動削除待ち"]],
    ["version-manual", ["withdrawal-pending-badge", "DL停止・管理者確認待ち"]],
    ["version-immediate", ["withdrawal-pending-badge", "取り下げ申請中"]],
    ["version-processing", ["withdrawal-processing-badge", "取り下げ処理中"]],
    ["version-tombstoned", ["withdrawal-tombstone-badge", "履歴のみ"]],
    ["version-deleted", ["withdrawal-tombstone-badge", "削除済み"]]
  ]);
  for (const entry of [...snapshot.detail.matrix, ...snapshot.compact.matrix]) {
    assert.equal(entry.document.horizontalOverflow, false, `${entry.pageKind} ${entry.requestedTheme} ${entry.requestedWidth}px overflow: ${JSON.stringify(entry.document.overflowing)}`);
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
    if (entry.requestedWidth > 760) {
      for (const [name, alignment] of Object.entries(entry.columnAlignment || {})) {
        assert.ok(alignment, `${name} alignment is missing at ${entry.requestedTheme} ${entry.requestedWidth}px`);
        assert.ok(alignment.xDifference <= (name === "version" ? 12 : 8), `${name} heading x differs by ${alignment.xDifference}px at ${entry.requestedTheme} ${entry.requestedWidth}px`);
        assert.ok(alignment.widthDifference <= 2, `${name} heading width differs by ${alignment.widthDifference}px at ${entry.requestedTheme} ${entry.requestedWidth}px: ${JSON.stringify(entry.columnAlignment)}`);
        if (["difficulty", "author", "progress", "comment", "actions"].includes(name)) {
          assert.ok(alignment.visualDifference <= 8, `${name} heading visual alignment differs by ${alignment.visualDifference}px at ${entry.requestedTheme} ${entry.requestedWidth}px`);
        }
      }
    }
    for (const row of entry.densityRows) {
      assertCommentAndActionBalance(entry, row);
      assert.equal(row.actionsContained, true, `detail actions escape row at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      assert.equal(row.managementContained, true, `detail delete button escapes row at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      assert.ok(row.authorPreviewLines <= 2.1, `detail author comment exceeds two lines at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      assert.ok(row.latestPreviewLines <= 1.1, `detail latest comment exceeds one line at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      if (entry.requestedWidth >= 1024 && row.actionControlCount >= 2) {
        assert.equal(row.actionLineCount, 2, `detail actions are not exactly two lines at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      } else {
        assert.ok(row.actionLineCount <= 3, `detail mobile actions exceed three lines at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      }
      if (entry.requestedWidth >= 1366 && row.commentTextLength > 0 && !row.exceptionalState) {
        const maximumHeight = row.commentTextLength > 100 ? 140 : 132;
        assert.ok(row.height <= maximumHeight, `detail row height ${row.height}px exceeds ${maximumHeight}px at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      }
    }
    const detail = entry.detailPresentation;
    const expectedDetail = detailPresentationColors[entry.requestedTheme];
    assert.equal(detail.section.backgroundColor, expectedDetail.sectionBackground);
    assert.ok(detail.section.borderColor.includes(expectedDetail.sectionBorder), "selected detail section border changed");
    assert.equal(detail.section.visibleBackgroundColor, expectedDetail.sectionBackground);
    for (const state of ["headingIdle", "headingHover", "headingFocus", "recentIdle", "recentHover", "recentFocus"]) {
      assert.equal(detail[state].color, expectedDetail.link, `${state} link color changed`);
      assert.ok(detail[state].contrastRatio >= 4.5, `${state} contrast ${detail[state].contrastRatio} is below 4.5`);
    }
    for (const state of ["headingHover", "headingFocus", "recentHover", "recentFocus"]) {
      assert.equal(detail[state].matches, true, `${state} forced state did not apply`);
    }
    for (const state of ["headingFocus", "recentFocus"]) {
      assert.notEqual(detail[state].outlineStyle, "none", `${state} outline is missing`);
      assert.ok(Number.parseFloat(detail[state].outlineWidth) >= 1, `${state} outline is too thin`);
      assert.ok(detail[state].outlineContrastRatio >= 3, `${state} outline contrast ${detail[state].outlineContrastRatio} is below 3`);
    }
    assert.equal(detail.statusIdle.color, expectedDetail.status);
    assert.equal(detail.statusError.color, expectedDetail.error);
    assert.equal(detail.statusSuccess.color, expectedDetail.success);
    for (const state of ["statusIdle", "statusError", "statusSuccess"]) {
      assert.ok(detail[state].contrastRatio >= 4.5, `${state} contrast ${detail[state].contrastRatio} is below 4.5`);
    }
    for (const [versionId, target] of Object.entries(detail.targets)) {
      assert.equal(target.versionId, versionId);
      assert.equal(target.classCount, 1, `${versionId} must be the sole detail target`);
      assert.equal(target.row.backgroundColor, expectedDetail.targetBackground);
      assert.equal(target.accent, expectedDetail.targetAccent);
      assert.equal(target.border, expectedDetail.targetBorder);
      assert.ok(target.accentContrastRatio >= 3, `${versionId} accent contrast ${target.accentContrastRatio} is below 3`);
      assert.ok(target.borderContrastRatio >= 3, `${versionId} border contrast ${target.borderContrastRatio} is below 3`);
      assert.equal(target.badge.backgroundColor, expectedDetail.badgeBackground);
      assert.equal(target.badge.color, expectedDetail.badgeText);
      assert.equal(target.badge.borderColor, expectedDetail.targetBorder);
      assert.ok(target.badge.textContrastRatio >= 4.5, `${versionId} badge text contrast ${target.badge.textContrastRatio} is below 4.5`);
      assert.ok(target.badge.borderContrastRatio >= 3, `${versionId} badge border contrast ${target.badge.borderContrastRatio} is below 3`);
      assert.ok(target.row.scrollWidth <= target.row.clientWidth + 1, `${versionId} target row overflows horizontally`);
      for (const side of ["left", "right", "top", "bottom"]) {
        assert.equal(target.row.sectionClip[side], 0, `${versionId} row ${side} clips against the detail section at ${entry.requestedTheme} ${entry.requestedWidth}px: ${JSON.stringify(target.row)}`);
        assert.equal(target.badge.rowClip[side], 0, `${versionId} target badge ${side} clips against its row`);
      }
      assert.equal(target.badge.lifecycleOverlap, false, `${versionId} target badge overlaps its lifecycle badge`);
      assert.equal(target.badge.favoriteOverlap, false, `${versionId} target badge overlaps its favorite control`);
    }
    assert.equal(detail.targetFocus.matches, true, "detail target focus state did not apply");
    assert.equal(detail.targetFocus.outlineColor, expectedDetail.focus);
    assert.notEqual(detail.targetFocus.outlineStyle, "none", "detail target focus outline is missing");
    assert.ok(Number.parseFloat(detail.targetFocus.outlineWidth) >= 2, "detail target focus outline is too thin");
    assert.ok(
      colorContrastRatio(detail.targetFocus.outlineColor, detail.targetFocus.backgroundColor) >= 3,
      "detail target focus outline contrast is below 3"
    );
    assert.deepEqual(detail.switchState, {
      before: { count: 1, versionId: "version-active" },
      after: { count: 1, versionId: "version-grace", oldActive: false, nextActive: true },
      finalCount: 0
    });
    assert.deepEqual(detail.selection, {
      api: { chartId: "chart-audit", versionId: "version-active" },
      chartId: "chart-audit",
      versionId: "version-active",
      sectionHidden: false,
      cardCount: 1,
      versionCount: versions.length
    });
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
    assert.deepEqual(favorite.runtimeStyles, { favorite: 0, progress: 0, total: 0 });
    const progressStates = entry.progressThumbnailStates;
    const expectedProgress = progressThumbnailColors[entry.requestedTheme];
    assert.deepEqual(
      {
        thumbnailCount: progressStates.mapOnly.thumbnailCount,
        mapCount: progressStates.mapOnly.mapCount,
        imageThumbnailCount: progressStates.mapOnly.imageThumbnailCount,
        wrapCount: progressStates.mapOnly.wrapCount,
        imageCount: progressStates.mapOnly.imageCount
      },
      { thumbnailCount: 1, mapCount: 1, imageThumbnailCount: 0, wrapCount: 0, imageCount: 0 }
    );
    assert.equal(progressStates.mapAndImageMetadata.mapCount, 1);
    assert.equal(progressStates.mapAndImageMetadata.imageThumbnailCount, 0);
    assert.equal(progressStates.mapAndImageMetadata.wrapCount, 0);
    assert.match(progressStates.mapAndImageMetadata.source, /css-regression-slow\?fixture=/);
    assert.equal(progressStates.beforeMount.imageThumbnailCount, 1);
    assert.equal(progressStates.beforeMount.wrapCount, 1);
    assert.equal(progressStates.beforeMount.imageCount, 0);
    assert.equal(progressStates.loading.imageCount, 1);
    assert.equal(progressStates.loading.className.includes("is-image-loaded"), false);
    assert.equal(progressStates.loaded.imageCount, 1);
    assert.ok(progressStates.loaded.className.includes("is-image-loaded"));
    assert.equal(progressStates.loaded.imageAlt, "progress image");
    assert.equal(progressStates.loaded.imageDecoding, "async");
    assert.equal(progressStates.loaded.imageLoading, "eager");
    assert.equal(progressStates.loaded.image.objectFit, "contain");
    assert.equal(progressStates.loaded.image.opacity, "1");
    assert.equal(progressStates.loaded.image.filter, "none");
    assert.equal(progressStates.remount.reusedImage, true);
    assert.equal(progressStates.remount.imageCount, 1);
    assert.equal(progressStates.urlChanged.replacedImage, true);
    assert.equal(progressStates.urlChanged.imageCount, 1);
    assert.match(progressStates.urlChanged.source, /\?changed=1$/);
    assert.equal(progressStates.urlChanged.imageSrc, progressStates.urlChanged.source);
    assert.ok(progressStates.errorEmpty.className.includes("is-image-fallback"));
    assert.ok(progressStates.errorEmpty.className.includes("is-empty"));
    assert.equal(progressStates.errorEmpty.wrapHidden, true);
    assert.equal(progressStates.errorEmpty.fallbackHidden, true);
    assert.equal(progressStates.errorEmpty.valueColor, expectedProgress.emptyText);
    assert.ok(
      colorContrastRatio(progressStates.errorEmpty.valueColor, expectedProgress.background) >= 4.5,
      `${entry.requestedTheme} empty progress text contrast is below 4.5`
    );
    assert.ok(progressStates.fallback.className.includes("is-image-fallback"));
    assert.equal(progressStates.fallback.className.includes("is-empty"), false);
    assert.equal(progressStates.fallback.wrapHidden, true);
    assert.equal(progressStates.fallback.fallbackHidden, false);
    assert.equal(progressStates.fallback.fallbackText, "map fallback");
    assert.equal(progressStates.missingUrl.thumbnailCount, 0);
    assert.equal(progressStates.invalidUrl.thumbnailCount, 0);
    assert.equal(progressStates.blobRejected.thumbnailCount, 0);
    for (const state of [progressStates.loaded, progressStates.standalone, progressStates.thumbnailCell]) {
      assert.equal(state.wrap.backgroundColor, expectedProgress.background);
      assert.equal(state.wrap.borderColor, expectedProgress.border);
      assert.equal(state.wrap.borderStyle, "solid");
      assert.equal(state.wrap.borderWidth, "1px");
      assert.equal(state.wrap.borderRadius, "6px");
      assert.equal(state.wrap.display, "flex");
      assert.equal(state.wrap.height, "38px");
      assert.equal(state.wrap.minWidth, "96px");
      assert.equal(state.wrap.overflow, "hidden");
      assert.equal(state.wrap.viewportClip.left, 0);
      assert.equal(state.wrap.viewportClip.right, 0);
    }
    assert.equal(progressStates.thumbnailCell.wrap.maxWidth, "100%");
    if (entry.requestedWidth === 390) {
      assert.equal(progressStates.standalone.wrap.maxWidth, "none");
      assert.ok(progressStates.standalone.wrap.rect.width <= entry.viewport.clientWidth);
    } else {
      assert.equal(progressStates.standalone.wrap.maxWidth, "220px");
      assert.equal(progressStates.standalone.wrap.rect.width, 220);
    }
    assert.deepEqual(progressStates.scheduler.directSchedule, {
      animationFrameCount: 2,
      cancelAnimationFrameCount: 1
    });
    assert.ok(progressStates.scheduler.observerSchedule.animationFrameCount >= 1);
    assert.ok(progressStates.scheduler.observerSchedule.animationFrameCount <= 3);
    assert.ok(progressStates.scheduler.observerSchedule.cancelAnimationFrameCount <= 1);
    const { thumbnail: loadMoreThumbnail, ...loadMoreSummary } = progressStates.loadMore;
    assert.deepEqual(loadMoreSummary, {
      mode: "append",
      source: "load-more",
      renderedNodeCount: 1,
      stageNames: [
        "favorites-filter",
        "branch-append-base",
        "tree",
        "favorites",
        "stored-progress-thumbnails",
        "common-mount"
      ],
      chartCount: 1,
      versionCount: 1
    });
    assert.equal(loadMoreThumbnail.imageThumbnailCount, 1);
    assert.equal(loadMoreThumbnail.imageCount, 1);
    assert.ok(loadMoreThumbnail.className.includes("is-image-loaded"));
    assert.equal(loadMoreThumbnail.wrap.backgroundColor, expectedProgress.background);
    assert.equal(loadMoreThumbnail.wrap.borderColor, expectedProgress.border);
    assert.deepEqual(progressStates.runtimeStyles, {
      favorite: 0,
      progress: 0,
      total: 0,
      staticStylesheet: 1
    });
    assert.equal(progressStates.warnings.length, 7);
    assert.ok(progressStates.warnings.every((warning) => warning.code === "PROGRESS_THUMBNAIL_RENDER_SKIPPED"));
    assert.ok(progressStates.timings.imageMountMs >= 200 && progressStates.timings.imageMountMs < 3000);
    assert.ok(progressStates.timings.loadMoreMountMs > 0 && progressStates.timings.loadMoreMountMs < 3000);
    assert.equal(
      progressStates.pipeline.postRender.filter((stage) => stage.name === "stored-progress-thumbnails").length,
      1
    );
    assert.deepEqual(
      progressStates.pipeline.postRender.find((stage) => stage.name === "stored-progress-thumbnails"),
      { name: "stored-progress-thumbnails", order: 300, required: true }
    );
    assert.equal(progressStates.pipeline.mount.filter((stage) => stage.name === "common-mount").length, 1);
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
  const detailRerender = snapshot.detailRerender;
  const expectedSelection = { chartId: "chart-audit", versionId: "version-active" };
  assert.deepEqual(detailRerender.before.selection, expectedSelection);
  assert.equal(detailRerender.before.cardCount, 1);
  assert.equal(detailRerender.before.versionCount, versions.length);
  assert.equal(detailRerender.before.activeLayout.horizontalOverflow, false);
  assert.equal(detailRerender.appendResult, true);
  assert.deepEqual(detailRerender.afterAppend.selection, expectedSelection);
  assert.equal(detailRerender.afterAppend.cardCount, 1);
  assert.equal(detailRerender.afterAppend.versionCount, versions.length);
  assert.equal(detailRerender.afterAppend.targetCount, 1);
  assert.equal(detailRerender.afterAppend.statusText, "\u6295\u7a3f\u3057\u307e\u3057\u305f\u3002");
  assert.equal(detailRerender.afterAppend.statusSuccess, true);
  assert.equal(detailRerender.afterAppend.renderedCount, 1);
  assert.deepEqual(detailRerender.afterAppend.activeLayout, detailRerender.before.activeLayout);
  assert.equal(detailRerender.managementResult, true);
  assert.deepEqual(detailRerender.afterManagement.selection, expectedSelection);
  assert.equal(detailRerender.afterManagement.cardCount, 1);
  assert.equal(detailRerender.afterManagement.versionCount, versions.length);
  assert.equal(detailRerender.afterManagement.targetCount, 1);
  assert.equal(detailRerender.afterManagement.renderedCount, 2);
  assert.equal(detailRerender.afterManagement.horizontalOverflow, false);
  assert.deepEqual(detailRerender.afterManagement.activeLayout, detailRerender.before.activeLayout);
  for (const value of [detailRerender.afterAppend.url, detailRerender.afterManagement.url]) {
    const url = new URL(value);
    assert.equal(url.pathname, "/index.html");
    assert.equal(url.searchParams.get("chartId"), "chart-audit");
    assert.equal(url.searchParams.get("versionId"), "version-active");
    assert.equal(url.hash, "#list");
  }
  for (const entry of snapshot.compact.matrix) {
    assert.equal(entry.counts.compactRows, compactItems.length);
    assert.equal(entry.counts.compactLinks, compactItems.length);
    assert.equal(entry.counts.compactComments, compactItems.length);
    assert.equal(entry.counts.commentPreviews, 2);
    assert.equal(entry.counts.latestCommentPreviews, 2);
    assert.ok(entry.counts.originLinks > 0 && entry.counts.originLinks < compactItems.length);
    assert.equal(entry.counts.downloads, compactItems.length);
    if (entry.requestedWidth >= 1180) {
      for (const [name, alignment] of Object.entries(entry.columnAlignment || {})) {
        assert.ok(alignment, `${name} compact alignment is missing at ${entry.requestedTheme} ${entry.requestedWidth}px`);
        assert.ok(alignment.xDifference <= 2, `${name} compact heading x differs by ${alignment.xDifference}px at ${entry.requestedTheme} ${entry.requestedWidth}px`);
        assert.ok(alignment.widthDifference <= 2, `${name} compact heading width differs by ${alignment.widthDifference}px at ${entry.requestedTheme} ${entry.requestedWidth}px`);
        if (["meta", "progress", "comment", "actions"].includes(name)) {
          assert.ok(alignment.visualDifference <= 8, `${name} compact heading visual alignment differs by ${alignment.visualDifference}px at ${entry.requestedTheme} ${entry.requestedWidth}px`);
        }
      }
    }
    for (const row of entry.elements.compactRows) {
      assert.ok(row.scrollWidth <= row.clientWidth + 1, `compact row overflows at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    }
    for (const links of entry.elements.compactLinks) {
      assert.ok(links.scrollWidth <= links.clientWidth + 1, `compact link actions overflow at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    }
    for (const preview of entry.elements.commentPreviews) {
      assert.ok(preview.parentClip.left <= 1 && preview.parentClip.right <= 1, `compact comment preview escapes its column at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    }
    const hiddenCommentRows = entry.densityRows.filter((row) => row.commentHidden);
    assert.equal(hiddenCommentRows.length, 2, `compact empty comment regions changed at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    assert.ok(hiddenCommentRows.every((row) => row.commentHeight === 0), `compact empty comments retain height at ${entry.requestedTheme} ${entry.requestedWidth}px`);
    for (const row of entry.densityRows) {
      assertCommentAndActionBalance(entry, row);
      assert.equal(row.actionsContained, true, `compact actions escape row at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      assert.equal(row.managementContained, true, `compact delete button escapes row at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      assert.ok(row.authorPreviewLines <= 2.1, `compact author comment exceeds two lines at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      assert.ok(row.latestPreviewLines <= 1.1, `compact latest comment exceeds one line at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      if (entry.requestedWidth >= 1024 && row.actionControlCount >= 2) {
        assert.equal(row.actionLineCount, 2, `compact actions are not exactly two lines at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      } else {
        assert.ok(row.actionLineCount <= 3, `compact mobile actions exceed three lines at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      }
      if (entry.requestedWidth >= 1366) {
        const maximumHeight = row.commentTextLength > 100 ? 140 : (row.hasComment ? 132 : 108);
        assert.ok(row.height <= maximumHeight, `compact row height ${row.height}px exceeds ${maximumHeight}px at ${entry.requestedTheme} ${entry.requestedWidth}px ${row.versionId}`);
      }
    }
  }
  for (const detailEntry of snapshot.detail.matrix) {
    const compactEntry = snapshot.compact.matrix.find((entry) => entry.requestedTheme === detailEntry.requestedTheme
      && entry.requestedWidth === detailEntry.requestedWidth);
    assert.ok(compactEntry, `matching compact matrix entry is missing for ${detailEntry.requestedTheme} ${detailEntry.requestedWidth}px`);
    const detailRows = new Map(detailEntry.densityRows.map((row) => [row.versionId, row]));
    const compactRows = new Map(compactEntry.densityRows.map((row) => [row.versionId, row]));
    const progress99 = detailRows.get("version-depth-1");
    const completedDetail = detailRows.get("version-depth-2");
    const rejectedDetail = detailRows.get("version-depth-3");
    const completedCompact = compactRows.get("version-depth-2");
    const rejectedCompact = compactRows.get("version-depth-3");
    assert.equal(progress99?.progressText, "99%");
    assert.equal(progress99?.progressCompletedTone, false, `99% received completed tone at ${detailEntry.requestedTheme} ${detailEntry.requestedWidth}px`);
    for (const row of [completedDetail, rejectedDetail, completedCompact, rejectedCompact]) {
      assert.equal(row?.progressText, "100%");
      assert.equal(row?.progressCompletedTone, true, `confirmed 100% missed completed tone at ${detailEntry.requestedTheme} ${detailEntry.requestedWidth}px`);
    }
    assert.equal(completedDetail.progressBackgroundColor, rejectedDetail.progressBackgroundColor);
    assert.equal(completedCompact.progressBackgroundColor, rejectedCompact.progressBackgroundColor);
    assert.equal(completedDetail.progressBackgroundColor, completedCompact.progressBackgroundColor);
    assert.notEqual(progress99.progressBackgroundColor, completedDetail.progressBackgroundColor);
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
  if (new Set(themeAt1366.map((entry) => entry.known.detailTarget?.backgroundColor)).size === 1
    || dark390.known.detailTarget?.backgroundColor === white390.known.detailTarget?.backgroundColor
    || dark390.known.detailTarget?.backgroundColor === "rgb(233, 246, 241)") {
    throw new Error("KNOWN-CSS-005 regressed: dark detail target uses the fixed light background");
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

function isAllowedDetailPresentationDifference(location, key) {
  const match = location.match(/^detail\[(\d+)\]\.detailPresentation\.(.*)$/);
  if (!match) return false;
  const path = match[2];
  const colorKeys = new Set([
    "backgroundColor", "visibleBackgroundColor", "surroundingBackgroundColor", "color", "borderColor", "outline", "outlineColor",
    "contrastRatio", "borderContrastRatio", "outlineContrastRatio", "boxShadow", "accent", "border",
    "accentContrastRatio", "textContrastRatio"
  ]);
  if (colorKeys.has(key)) return true;
  const isMobile = Number(match[1]) % widths.length === 0;
  if (isMobile && /^targets\.[^.]+\.badge$/.test(path) && (key === "top" || key === "favoriteOverlap")) {
    return true;
  }
  if (isMobile && /^targets\.[^.]+\.badge\.viewportClip$/.test(path) && (key === "top" || key === "bottom")) {
    return true;
  }
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
      const isDetailTargetRow = expected.className?.split(/\s+/).includes("is-detail-target");
      const isStoppedSummary = /\.known\.appendStopped$/.test(location);
      const isStoppedInteraction = /\.controlInteractions\.appendStopped\.(?:hover|focusVisible|active)$/.test(location);
      const isFavoriteStyle = /\.(?:elements\.favorites\[\d+\]|known\.favoriteIdle|favoriteInteractions\.(?:filter(?:Idle|Hover|Focus|Active(?:Hover|Focus)?)|star(?:Idle|Hover|Focus|Favorite(?:Hover|Focus)?)))$/.test(location);
      const isProgressImageWrap = /\.(?:elements\.imageWraps\[\d+\]|progressThumbnailStates\.[^.]+\.wrap)$/.test(location);
      const isProgressEmptyState = /\.progressThumbnailStates\.(?:errorEmpty|invalidUrl)$/.test(location);
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
      if (isAllowedDetailPresentationDifference(location, key)) continue;
      if (/^detail\[\d+\]\.known\.detailTarget$/.test(location) && key === "backgroundColor") continue;
      if (isDetailTargetRow && new Set([
        "backgroundColor", "visibleBackgroundColor", "boxShadow", "contrastRatio",
        "outline", "outlineColor", "outlineContrastRatio"
      ]).has(key)) continue;
      if (isFavoriteStyle && favoriteStyleChanges.has(key)) continue;
      if (location.endsWith(".favoriteInteractions.runtimeStyles") && key === "favorite") continue;
      if (location.endsWith(".favoriteInteractions.runtimeStyles") && (key === "progress" || key === "total")) continue;
      if (location.endsWith(".progressThumbnailStates.runtimeStyles") && (key === "progress" || key === "total")) continue;
      if (isProgressEmptyState && key === "valueColor") continue;
      if (isDark && isProgressImageWrap && new Set([
        "backgroundColor", "borderColor", "contrastRatio", "borderContrastRatio"
      ]).has(key)) continue;
      if (location.endsWith(".favoriteInteractions.behavior.storageAfterAdd.version-active") && key === "favoritedAt") continue;
      if (location === "detailRerender" && key === "url") continue;
      if (/^detailRerender\.(?:afterAppend|afterManagement)$/.test(location) && key === "url") continue;
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
      && !document.querySelector("#progress-image-thumbnail-style")
      && !document.querySelector("#favoriteListStyles")
      && [...document.styleSheets].some((sheet) => sheet.href && new URL(sheet.href).pathname.endsWith("/favorites-list.css"))
      && [...document.styleSheets].some((sheet) => sheet.href && new URL(sheet.href).pathname.endsWith("/progress-thumbnail-list.css"))`, "detail fixture");
    console.log("css browser phase: detail fixture ready");
    await installControlFixtures(cdp, sessionId);
    const detailNavigationMs = Number(process.hrtime.bigint() - navigationStart) / 1e6;
    const detail = await captureMatrix(cdp, sessionId, "detail");
    console.log("css browser phase: detail matrix complete");
    const progressDragHint = await captureProgressDragHintInteractions(cdp, sessionId);
    console.log("css browser phase: progress drag hint complete");
    const versionComments = await captureVersionCommentInteractions(cdp, sessionId);
    console.log("css browser phase: version comments complete");
    const detailRerender = await captureDetailRerenderRegression(cdp, sessionId);
    console.log("css browser phase: detail rerender complete");
    const appendDropFileReveal = await captureAppendDropFileRevealRegression(cdp, sessionId);
    console.log("css browser phase: append drop file reveal complete");
    const postFormPointerUi = await capturePostFormPointerUi(cdp, sessionId);
    console.log("css browser phase: post form matrix complete");

    const compactNavigationStart = process.hrtime.bigint();
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${staticPort}/list.html` }, sessionId);
    await waitFor(cdp, sessionId, `document.querySelectorAll(".compact-version-row").length === ${compactItems.length}`, "compact fixture");
    console.log("css browser phase: compact fixture ready");
    const compactNavigationMs = Number(process.hrtime.bigint() - compactNavigationStart) / 1e6;
    const compact = await captureMatrix(cdp, sessionId, "compact");

    const snapshot = {
      format: "bms-css-r4b2a-v1",
      fixture: { chartCount: 1, versionCount: versions.length, compactCount: compactItems.length },
      detail: detail.matrix,
      progressDragHint,
      versionComments,
      detailRerender,
      appendDropFileReveal,
      postFormPointerUi,
      compact: compact.matrix
    };
    const wrapped = { detail: { matrix: detail.matrix }, detailRerender, compact: { matrix: compact.matrix } };
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
      compareValues(baseline.detailRerender, snapshot.detailRerender, "detailRerender");
      compareValues(baseline.compact, snapshot.compact, "compact");
      console.log(`css browser row height deltas: ${JSON.stringify(rowHeightDeltas(baseline, snapshot))}`);
    }

    const totalMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const timingSummary = (key) => {
      const values = detail.matrix.map((entry) => entry.progressThumbnailStates.timings[key]);
      return {
        min: Number(Math.min(...values).toFixed(1)),
        average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
        max: Number(Math.max(...values).toFixed(1))
      };
    };
    console.log(`css browser regression: ${detail.matrix.length} detail + ${compact.matrix.length} compact + ${postFormPointerUi.matrix.length} post-form theme/width conditions, append drop reveal, and version comment interactions passed`);
    console.log(JSON.stringify({
      detailNavigationMs: Number(detailNavigationMs.toFixed(1)),
      compactNavigationMs: Number(compactNavigationMs.toFixed(1)),
      computedStyleMs: Number((detail.computedCaptureMs + compact.computedCaptureMs).toFixed(1)),
      imageMountMs: timingSummary("imageMountMs"),
      loadMoreMountMs: timingSummary("loadMoreMountMs"),
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
