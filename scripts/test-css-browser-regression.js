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
      const body = fs.readFileSync(filePath);
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
    favoriteStyle: Boolean(document.querySelector("#favoriteListStyles")),
    bodyText: document.body?.innerText?.slice(0, 500) || ""
  })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

function captureExpression(pageKind) {
  return `(async () => {
    const round = (value) => Number(Number(value || 0).toFixed(3));
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
    const inspect = (selector) => [...document.querySelectorAll(selector)].map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const parentRect = element.parentElement?.getBoundingClientRect?.() || rect;
      return {
        tagName: element.tagName,
        className: String(element.className || ""),
        dataVersionId: element.closest(".version-row")?.dataset.versionId || "",
        text: String(element.textContent || "").trim(),
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
    });
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
        matrix.push({ requestedTheme: theme, requestedWidth: width, ...(await evaluate(cdp, sessionId, expression)) });
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
  const checks = [
    ["KNOWN-CSS-003", dark390.known.appendStopped?.backgroundColor === white390.known.appendStopped?.backgroundColor, "dark append-stopped fixed light background"],
    ["KNOWN-CSS-004", new Set(themeAt1366.map((entry) => JSON.stringify(entry.known.favoriteIdle))).size === 1, "favorite idle fixed color"],
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
      && document.querySelector("#favoriteListStyles")`, "detail fixture");
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
