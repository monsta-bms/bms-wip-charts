(() => {
  const appendLayerColor = "#2563eb";
  const parentLayerColor = "#1f7a5c";
  const thumbnailMaxCells = 96;
  const allowedExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);

  const submitPanel = document.querySelector(".submit-panel");
  const form = document.querySelector("#chartForm");
  const postFormBody = document.querySelector("#postFormBody");
  const submitTitle = document.querySelector("#submitTitle");
  const formModeBadge = document.querySelector("#formModeBadge");
  const appendContext = document.querySelector("#appendContext");
  const appendContextTitle = document.querySelector("#appendContextTitle");
  const appendParentVersion = document.querySelector("#appendParentVersion");
  const appendParentSong = document.querySelector("#appendParentSong");
  const appendParentArtist = document.querySelector("#appendParentArtist");
  const appendParentChartName = document.querySelector("#appendParentChartName");
  const fileInput = document.querySelector("#chartFile");
  const titleInput = document.querySelector("#title");
  const subtitleInput = document.querySelector("#subtitle");
  const artistInput = document.querySelector("#artist");
  const subartistInput = document.querySelector("#subartist");
  const chartNameInput = document.querySelector("#chartName");
  const chartNameLabel = document.querySelector("#chartNameLabel");
  const chartNameHelp = document.querySelector("#chartNameHelp");
  const difficultyInput = document.querySelector("#difficulty");
  const difficultyPicker = document.querySelector("#difficultyPicker");
  const difficultyManualInput = document.querySelector("#difficultyManual");
  const difficultyChips = document.querySelector("#difficultyChips");
  const authorInput = document.querySelector("#author");
  const progressInput = document.querySelector("#progress");
  const progressMap = document.querySelector("#progressMap");
  const progressMapHeader = document.querySelector("#progressMapHeader");
  const progressControls = document.querySelector("#progressControls");
  const rejectedProgressControl = document.querySelector("#rejectedProgressControl");
  const progressMapStatus = document.querySelector("#progressMapStatus");
  const progressMapGraphWrap = document.querySelector("#progressMapGraphWrap");
  const progressMapCanvas = document.querySelector("#progressMapCanvas");
  const progressMapBlocks = document.querySelector("#progressMapBlocks");
  const progressMapLabels = document.querySelector("#progressMapLabels");
  const progressMapSummary = document.querySelector("#progressMapSummary");
  const progressMapTooltip = document.querySelector("#progressMapTooltip");
  const progressMapPopover = document.querySelector("#progressMapPopover");
  const completeProgressButton = document.querySelector("#completeProgressButton");
  const commentInput = document.querySelector("#comment");
  const isRejectedInput = document.querySelector("#isRejected");
  const allowAppendControl = document.querySelector("#allowAppendControl");
  const allowAppendInput = document.querySelector("#allowAppend");
  const passwordInput = document.querySelector("#password");
  const saveAuthorInput = document.querySelector("#saveAuthor");
  const savePasswordInput = document.querySelector("#savePassword");
  const submitButton = document.querySelector("#submitButton");
  const cancelAppendButton = document.querySelector("#cancelAppendButton");
  const chartList = document.querySelector("#chartList");
  const chartInteractionRoot = document.querySelector("#list") || chartList;

  const appendState = {
    active: false,
    charts: [],
    entry: null,
    song: null,
    chart: null,
    parentVersion: null,
    chartId: "",
    parentVersionId: "",
    parentMap: null,
    parentLayers: [],
    blocks: [],
    parentPainted: new Set(),
    currentPainted: new Set(),
    completionBasePainted: null,
    completionRestoreSnapshot: null,
    layerKind: "followup",
    fileGridMismatch: false,
    fileAnalysisStatus: "empty",
    hasUsableFileProgressMap: false,
    fileAnalysisRevision: 0,
    isSubmitting: false,
    isDragging: false,
    dragAnchorIndex: null,
    dragMode: null,
    originalCurrentPainted: null
  };

  function html(value) {
    if (typeof escapeHtml === "function") {
      return escapeHtml(value);
    }

    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      const replacements = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return replacements[character];
    });
  }

  function showText(message) {
    if (typeof showTextError === "function") {
      showTextError(message);
      return;
    }

    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    }
  }

  function showApiError(error) {
    if (window.BmsPostErrorUi?.showApiError) {
      window.BmsPostErrorUi.showApiError(error, { mode: "append" });
      return;
    }
    if (typeof showError === "function") {
      showError(error);
      return;
    }

    showText(`code: ${error?.code || "REQUEST_FAILED"}\nmessage: ${error?.message || "処理に失敗しました。"}\ndetail: ${error?.detail || "原因を確認してください。"}`);
  }

  function clearMessage() {
    if (typeof clearError === "function") {
      clearError();
      return;
    }

    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.textContent = "";
      errorBox.hidden = true;
    }
  }

  function setInvalid(input, invalid) {
    if (!input) {
      return;
    }

    if (typeof setFieldInvalid === "function") {
      setFieldInvalid(input, invalid);
      return;
    }

    input.setAttribute("aria-invalid", invalid ? "true" : "false");
    if (input === difficultyInput && difficultyPicker) {
      difficultyPicker.setAttribute("aria-invalid", invalid ? "true" : "false");
    }
  }

  function getExtension(fileName) {
    const dotIndex = String(fileName || "").lastIndexOf(".");
    return dotIndex === -1 ? "" : fileName.slice(dotIndex).toLowerCase();
  }

  function localExtractLevel(difficulty) {
    if (typeof extractLevelFromDifficulty === "function") {
      return extractLevelFromDifficulty(difficulty);
    }

    const match = String(difficulty || "").match(/\d{1,2}/);
    return match ? match[0] : "";
  }

  function callApi(path, options = {}) {
    if (typeof apiRequest === "function") {
      return apiRequest(path, options);
    }

    const baseUrl = window.API_BASE_URL || "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
    return fetch(new URL(path, baseUrl).toString(), options).then(async (response) => {
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw body || {
          code: "HTTP_ERROR",
          message: "APIリクエストに失敗しました。",
          detail: `HTTP status ${response.status}`
        };
      }
      return body;
    });
  }

  function makeDownloadUrl(downloadUrl) {
    if (!downloadUrl) {
      return "";
    }

    if (typeof buildDownloadUrl === "function") {
      return buildDownloadUrl(downloadUrl);
    }

    return downloadUrl;
  }

  function makeOriginUrl(originUrl) {
    if (typeof normalizeExternalHttpUrl === "function") {
      return normalizeExternalHttpUrl(originUrl);
    }

    try {
      const url = new URL(String(originUrl || ""));
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function syncAppendPolicyReadiness(options = {}) {
    return window.BmsAppendPolicy?.setAppendReadiness?.({
      hasTarget: appendState.active && Boolean(appendState.chartId && appendState.parentVersionId),
      formOpen: appendState.active && !postFormBody?.hidden,
      fileSelected: Boolean(fileInput?.files?.[0]),
      analysisStatus: appendState.fileAnalysisStatus,
      hasProgressMap: appendState.hasUsableFileProgressMap,
      hasAnalysisError: appendState.fileAnalysisStatus === "error" || appendState.fileGridMismatch
    }, options);
  }

  function setAppendFileAnalysisState(status, { hasProgressMap = false, progress } = {}) {
    appendState.fileAnalysisStatus = status;
    appendState.hasUsableFileProgressMap = Boolean(hasProgressMap);
    syncAppendPolicyReadiness({
      progress: Number.isFinite(Number(progress)) ? Number(progress) : calculateProgress()
    });
  }

  function discardCompletionState() {
    appendState.completionRestoreSnapshot = null;
    appendState.completionBasePainted = null;
    appendState.layerKind = "followup";
    appendState.isDragging = false;
    appendState.dragAnchorIndex = null;
    appendState.dragMode = null;
    appendState.originalCurrentPainted = null;
    window.BmsAppendPolicy?.setCompletionRequested?.(false, { progress: calculateProgress() });
  }

  function parseProgressMap(progressMapValue) {
    if (!progressMapValue) {
      return null;
    }

    if (typeof progressMapValue === "string") {
      try {
        return JSON.parse(progressMapValue);
      } catch (error) {
        console.warn("[append-progress-map-parse] failed to parse progressMap", {
          code: "APPEND_PROGRESS_MAP_PARSE_FAILED",
          detail: error instanceof Error ? error.message : String(error)
        });
        return null;
      }
    }

    if (typeof progressMapValue === "object") {
      return progressMapValue;
    }

    return null;
  }

  function isUsableProgressMap(progressMapValue) {
    const progressMapObject = parseProgressMap(progressMapValue);
    return Boolean(
      progressMapObject &&
      progressMapObject.schemaVersion === 2 &&
      progressMapObject.blockMode === "standardized_measure" &&
      Array.isArray(progressMapObject.blocks) &&
      progressMapObject.blocks.length > 0 &&
      Array.isArray(progressMapObject.layers)
    );
  }

  function normalizeBlock(block, fallbackIndex) {
    const index = Number.isInteger(Number(block?.index)) ? Number(block.index) : fallbackIndex;
    return {
      ...block,
      index,
      startMeasure: Number.isInteger(Number(block?.startMeasure)) ? Number(block.startMeasure) : index,
      endMeasure: Number.isInteger(Number(block?.endMeasure)) ? Number(block.endMeasure) : Number(block?.startMeasure ?? index),
      startPosition: block?.startPosition !== null && block?.startPosition !== undefined && Number.isFinite(Number(block.startPosition))
        ? Number(block.startPosition)
        : null,
      endPosition: block?.endPosition !== null && block?.endPosition !== undefined && Number.isFinite(Number(block.endPosition))
        ? Number(block.endPosition)
        : null,
      startTimeSec: Number.isFinite(Number(block?.startTimeSec)) ? Number(block.startTimeSec) : null,
      endTimeSec: Number.isFinite(Number(block?.endTimeSec)) ? Number(block.endTimeSec) : null,
      playNotes: Number.isFinite(Number(block?.playNotes)) ? Number(block.playNotes) : 0
    };
  }

  function normalizeRange(range) {
    if (!Array.isArray(range) || range.length !== 2) {
      return null;
    }

    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      return null;
    }

    return [start, end];
  }

  function normalizeLayer(layer, fallbackColor) {
    const ranges = Array.isArray(layer?.ranges)
      ? layer.ranges.map(normalizeRange).filter(Boolean)
      : [];

    return {
      versionId: layer?.versionId || "unknown",
      color: layer?.color || fallbackColor,
      kind: layer?.kind || "initial",
      ranges
    };
  }

  function collectPaintedIndexes(layers, totalBlocks) {
    const painted = new Set();

    for (const layer of layers) {
      for (const range of layer.ranges || []) {
        const safeStart = Math.max(0, range[0]);
        const safeEnd = Math.min(totalBlocks - 1, range[1]);
        for (let index = safeStart; index <= safeEnd; index += 1) {
          painted.add(index);
        }
      }
    }

    return painted;
  }

  function collectUnionPainted() {
    return new Set([...appendState.parentPainted, ...appendState.currentPainted]);
  }

  function compressRanges(indexes) {
    const sorted = [...indexes].filter(Number.isInteger).sort((a, b) => a - b);
    const ranges = [];
    let start = null;
    let previous = null;

    for (const index of sorted) {
      if (start === null) {
        start = index;
        previous = index;
        continue;
      }

      if (index === previous + 1) {
        previous = index;
        continue;
      }

      ranges.push([start, previous]);
      start = index;
      previous = index;
    }

    if (start !== null) {
      ranges.push([start, previous]);
    }

    return ranges;
  }

  function calculateProgress() {
    if (!appendState.blocks.length) {
      return 0;
    }

    return Math.round((collectUnionPainted().size / appendState.blocks.length) * 100);
  }

  function formatMeasure(value) {
    return String(Number.isFinite(Number(value)) ? Number(value) : 0).padStart(3, "0");
  }

  function formatSeconds(value) {
    if (!Number.isFinite(Number(value))) {
      return "?";
    }

    const totalSeconds = Math.max(0, Math.round(Number(value)));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function getBlockDetailLines(block) {
    const startMeasure = formatMeasure(block.startMeasure);
    const endMeasure = formatMeasure(block.endMeasure);
    const measureLine = startMeasure === endMeasure ? startMeasure : `${startMeasure}-${endMeasure}`;
    const lines = [measureLine];

    if (Number.isFinite(Number(block.startTimeSec)) || Number.isFinite(Number(block.endTimeSec))) {
      lines.push(`${formatSeconds(block.startTimeSec)}-${formatSeconds(block.endTimeSec)}`);
    }

    lines.push(`notes: ${Number(block.playNotes) || 0}`);
    return lines;
  }

  function positionFloatingBox(box, event) {
    const margin = 10;
    box.hidden = false;
    box.style.left = "0px";
    box.style.top = "0px";
    const rect = box.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - margin, Math.max(margin, event.clientX + 12));
    const top = Math.min(window.innerHeight - rect.height - margin, Math.max(margin, event.clientY + 12));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  function hideAppendFloatingInfo() {
    if (progressMapTooltip) {
      progressMapTooltip.hidden = true;
    }
    if (progressMapPopover) {
      progressMapPopover.hidden = true;
    }
  }

  function showAppendTooltip(blockElement, event) {
    if (!progressMapTooltip) {
      return;
    }

    const block = appendState.blocks[Number(blockElement.dataset.blockIndex)];
    if (!block) {
      return;
    }

    progressMapTooltip.innerHTML = getBlockDetailLines(block).map((line) => `<div>${html(line)}</div>`).join("");
    positionFloatingBox(progressMapTooltip, event);
  }

  function showAppendPopover(blockElement, event) {
    if (!progressMapPopover) {
      return;
    }

    const block = appendState.blocks[Number(blockElement.dataset.blockIndex)];
    if (!block) {
      return;
    }

    const lines = getBlockDetailLines(block);
    progressMapPopover.innerHTML = `
      <div class="progress-map-popover-title">${html(lines[0])}</div>
      <div class="progress-map-popover-line">time: ${html(lines[1] || "?")}</div>
      <div class="progress-map-popover-line">${html(lines[2] || "notes: 0")}</div>
    `;
    positionFloatingBox(progressMapPopover, event);
  }

  function buildBlockDensities(blocks) {
    return blocks.map((block) => {
      const durationSec = Number(block.endTimeSec) - Number(block.startTimeSec);
      const playNotes = Number(block.playNotes) || 0;
      return {
        index: block.index,
        densityValue: Number.isFinite(durationSec) && durationSec > 0 ? playNotes / durationSec : playNotes
      };
    });
  }

  function resolveAllowAppend(version) {
    if (typeof window.BmsAppendPolicy?.resolve === "function") {
      return window.BmsAppendPolicy.resolve(version);
    }
    if (typeof version?.allowAppend === "boolean") {
      return version.allowAppend;
    }
    return version?.isRejected !== true && version?.is_rejected !== true;
  }

  function getThemeCanvasColor(name, fallback) {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function drawAppendDensityChart() {
    if (!progressMapCanvas || !appendState.blocks.length || progressMapGraphWrap.hidden) {
      return;
    }

    const context = progressMapCanvas.getContext("2d");
    const cssWidth = Math.max(Math.floor(progressMapCanvas.parentElement.clientWidth), 320);
    const cssHeight = 120;
    const ratio = window.devicePixelRatio || 1;
    const densities = buildBlockDensities(appendState.blocks);
    const maxDensity = Math.max(1, ...densities.map((item) => item.densityValue));
    const plotTop = 8;
    const plotBottom = 14;
    const plotHeight = cssHeight - plotTop - plotBottom;
    const baseY = plotTop + plotHeight;
    const barSlot = cssWidth / densities.length;

    progressMapCanvas.width = Math.floor(cssWidth * ratio);
    progressMapCanvas.height = Math.floor(cssHeight * ratio);
    progressMapCanvas.style.width = "100%";
    progressMapCanvas.style.height = `${cssHeight}px`;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = getThemeCanvasColor("--canvas-bg", "#ffffff");
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.strokeStyle = getThemeCanvasColor("--canvas-grid", "#dce4ea");
    context.beginPath();
    context.moveTo(0, baseY + 0.5);
    context.lineTo(cssWidth, baseY + 0.5);
    context.stroke();
    context.fillStyle = getThemeCanvasColor("--canvas-density", "rgba(42, 128, 116, 0.46)");

    densities.forEach((item, index) => {
      const x = index * barSlot;
      const height = Math.max(item.densityValue > 0 ? 2 : 0, (item.densityValue / maxDensity) * plotHeight);
      context.fillRect(x, baseY - height, Math.ceil(barSlot), height);
    });
  }

  function renderAppendLabels() {
    if (!progressMapLabels) {
      return;
    }

    const blocks = appendState.blocks;
    progressMapLabels.hidden = blocks.length === 0;
    progressMapLabels.style.gridTemplateColumns = `repeat(${Math.max(blocks.length, 1)}, minmax(0, 1fr))`;

    const labelStep = blocks.length > 160 ? 32 : blocks.length > 80 ? 16 : 8;
    progressMapLabels.innerHTML = blocks.map((block, index) => {
      const visible = index === 0 || index % labelStep === 0;
      const className = visible ? "progress-block-measure-label" : "progress-block-measure-label is-empty";
      return `<span class="${className}">${visible ? html(formatMeasure(block.startMeasure)) : ""}</span>`;
    }).join("");
  }

  function updateAppendBlockClasses() {
    if (!progressMapBlocks) {
      return;
    }

    const union = collectUnionPainted();
    const completionLocked = appendState.layerKind === "completion_fill";
    progressMap?.classList.toggle("is-completion-locked", completionLocked);
    progressMapBlocks.querySelectorAll(".progress-map-block").forEach((block) => {
      const index = Number(block.dataset.blockIndex);
      const parentPainted = appendState.parentPainted.has(index);
      const currentPainted = appendState.currentPainted.has(index);
      const painted = union.has(index);
      block.classList.toggle("is-parent-painted", parentPainted);
      block.classList.toggle("is-current-painted", currentPainted);
      block.classList.toggle("is-painted", painted);
      block.setAttribute("aria-pressed", painted ? "true" : "false");
      const disabled = Boolean(isRejectedInput?.checked) || completionLocked;
      block.disabled = disabled;
      block.setAttribute("aria-disabled", disabled ? "true" : "false");
    });
  }

  function updateAppendProgressSummary() {
    const progress = calculateProgress();
    if (progressInput) {
      progressInput.value = String(progress);
      progressInput.readOnly = true;
      progressInput.classList.add("readonly-input");
      setInvalid(progressInput, false);
    }

    if (progressMapSummary) {
      const playNotes = appendState.blocks.reduce((sum, block) => sum + (Number(block.playNotes) || 0), 0);
      const firstMeasure = appendState.blocks[0]?.startMeasure;
      const lastMeasure = appendState.blocks[appendState.blocks.length - 1]?.endMeasure;
      progressMapSummary.textContent = `ノーツ ${playNotes.toLocaleString("ja-JP")} / ${appendState.blocks.length}区間 / 小節 ${formatMeasure(firstMeasure)}–${formatMeasure(lastMeasure)}`;
      progressMapSummary.hidden = false;
    }

    window.BmsAppendPolicy?.setCompletionRequested?.(
      appendState.layerKind === "completion_fill",
      { progress }
    );
  }

  function renderAppendProgressMap() {
    if (!progressMap || !progressMapBlocks || !appendState.blocks.length) {
      return;
    }

    progressMap.dataset.state = "ready";
    progressMap.classList.remove("is-locked");
    if (progressMapHeader) progressMapHeader.hidden = false;
    if (progressControls) progressControls.hidden = false;
    if (rejectedProgressControl) rejectedProgressControl.hidden = false;
    if (allowAppendControl) allowAppendControl.hidden = false;
    progressMapStatus.hidden = true;
    progressMapGraphWrap.hidden = false;
    hideAppendFloatingInfo();

    progressMapBlocks.style.gridTemplateColumns = `repeat(${appendState.blocks.length}, minmax(0, 1fr))`;
    progressMapBlocks.innerHTML = appendState.blocks.map((block) => {
      const isBarline = block.index % 8 === 0;
      const classes = ["progress-map-block", isBarline ? "is-barline" : ""].filter(Boolean).join(" ");
      const ariaLabel = [`block ${block.index + 1}`, ...getBlockDetailLines(block)].join(", ");
      return `<button class="${classes}" type="button" data-block-index="${block.index}" aria-label="${html(ariaLabel)}"></button>`;
    }).join("");

    renderAppendLabels();
    drawAppendDensityChart();
    updateAppendBlockClasses();
    updateAppendProgressSummary();
  }

  function initializeAppendProgressMap(progressMapValue, { render = true } = {}) {
    const parsedMap = parseProgressMap(progressMapValue);
    if (!isUsableProgressMap(parsedMap)) {
      return false;
    }

    const parentMap = cloneJson(parsedMap);
    const blocks = parentMap.blocks.map(normalizeBlock);
    const parentLayers = parentMap.layers.map((layer) => normalizeLayer(layer, parentLayerColor));

    appendState.parentMap = parentMap;
    appendState.parentLayers = parentLayers;
    appendState.blocks = blocks;
    appendState.parentPainted = collectPaintedIndexes(parentLayers, blocks.length);
    appendState.currentPainted = new Set();
    appendState.completionBasePainted = null;
    appendState.completionRestoreSnapshot = null;
    appendState.layerKind = "followup";
    appendState.fileGridMismatch = false;
    appendState.isDragging = false;
    appendState.dragAnchorIndex = null;
    appendState.dragMode = null;
    appendState.originalCurrentPainted = null;
    if (render) {
      renderAppendProgressMap();
    }
    return true;
  }

  function buildAppendProgressMapPayload() {
    const parentMap = cloneJson(appendState.parentMap);
    const currentLayer = {
      versionId: "pending",
      color: appendLayerColor,
      kind: appendState.layerKind,
      ranges: compressRanges(appendState.currentPainted)
    };

    const layers = appendState.parentLayers.map((layer) => ({
      versionId: layer.versionId,
      color: layer.color || parentLayerColor,
      kind: layer.kind || "initial",
      ranges: layer.ranges.map((range) => [range[0], range[1]])
    }));
    layers.push(currentLayer);

    const payload = {
      ...parentMap,
      schemaVersion: 2,
      blockMode: "standardized_measure",
      firstMeasure: appendState.blocks[0]?.startMeasure ?? null,
      lastMeasure: appendState.blocks[appendState.blocks.length - 1]?.endMeasure ?? null,
      targetBlockCount: appendState.blocks.length,
      blocks: appendState.blocks.map((block) => ({ ...block })),
      layers,
      progress: calculateProgress()
    };
    if (appendState.layerKind === "completion_fill") {
      payload.completionBaseRanges = compressRanges(appendState.completionBasePainted || new Set());
    }
    return payload;
  }

  function createCompletionRestoreSnapshot() {
    return cloneJson({
      progressMap: buildAppendProgressMapPayload(),
      parentMap: appendState.parentMap,
      parentLayers: appendState.parentLayers,
      parentPainted: [...appendState.parentPainted],
      currentPainted: [...appendState.currentPainted],
      uiState: {
        layerKind: appendState.layerKind,
        fileGridMismatch: appendState.fileGridMismatch,
        progress: calculateProgress()
      }
    });
  }

  function restoreCompletionSnapshot() {
    const snapshot = appendState.completionRestoreSnapshot;
    if (!snapshot?.progressMap || !Array.isArray(snapshot.progressMap.blocks)) {
      showText("完成版の状態を確認できません。譜面ファイルを選択し直してください。");
      return false;
    }

    appendState.parentMap = cloneJson(snapshot.parentMap);
    appendState.parentLayers = cloneJson(snapshot.parentLayers).map((layer) => normalizeLayer(layer, parentLayerColor));
    appendState.blocks = cloneJson(snapshot.progressMap.blocks).map(normalizeBlock);
    appendState.parentPainted = new Set(snapshot.parentPainted);
    appendState.currentPainted = new Set(snapshot.currentPainted);
    appendState.completionBasePainted = null;
    appendState.layerKind = snapshot.uiState?.layerKind || "followup";
    appendState.fileGridMismatch = Boolean(snapshot.uiState?.fileGridMismatch);
    appendState.isDragging = false;
    appendState.dragAnchorIndex = null;
    appendState.dragMode = null;
    appendState.originalCurrentPainted = null;
    renderAppendProgressMap();
    appendState.completionRestoreSnapshot = null;
    clearMessage();
    return true;
  }

  function applyAppendDragRange(currentBlockIndex) {
    if (!appendState.originalCurrentPainted || !Number.isInteger(currentBlockIndex)) {
      return;
    }

    const anchorIndex = appendState.dragAnchorIndex;
    if (!Number.isInteger(anchorIndex)) {
      return;
    }

    const start = Math.min(anchorIndex, currentBlockIndex);
    const end = Math.max(anchorIndex, currentBlockIndex);
    const nextCurrent = new Set(appendState.originalCurrentPainted);

    for (let index = start; index <= end; index += 1) {
      if (appendState.dragMode === "erase") {
        nextCurrent.delete(index);
      } else {
        nextCurrent.add(index);
      }
    }

    appendState.currentPainted = nextCurrent;
    updateAppendBlockClasses();
    updateAppendProgressSummary();
  }

  function findProgressBlockFromPointer(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element?.closest?.(".progress-map-block") || null;
  }

  function startAppendDrag(blockIndex, event) {
    if (!appendState.active || isRejectedInput?.checked || !Number.isInteger(blockIndex)) {
      return;
    }

    if (appendState.layerKind === "completion_fill") {
      showText("完成版指定中は進捗範囲を編集できません。編集する場合は完成版を解除してください。");
      return;
    }
    const currentPainted = appendState.currentPainted.has(blockIndex);
    appendState.isDragging = true;
    appendState.dragAnchorIndex = blockIndex;
    appendState.dragMode = currentPainted ? "erase" : "paint";
    appendState.originalCurrentPainted = new Set(appendState.currentPainted);
    hideAppendFloatingInfo();
    progressMapBlocks.setPointerCapture?.(event.pointerId);
    applyAppendDragRange(blockIndex);
  }

  function finishAppendDrag({ restoreOriginal = false } = {}) {
    if (restoreOriginal && appendState.originalCurrentPainted) {
      appendState.currentPainted = new Set(appendState.originalCurrentPainted);
      updateAppendBlockClasses();
      updateAppendProgressSummary();
    }

    appendState.isDragging = false;
    appendState.dragAnchorIndex = null;
    appendState.dragMode = null;
    appendState.originalCurrentPainted = null;
    if (appendState.currentPainted.size > 0 && !appendState.fileGridMismatch) {
      window.BmsPostErrorUi?.clearField?.("progressMap");
    }
  }

  function toggleAppendCompletion() {
    if (!appendState.active || isRejectedInput?.checked || !appendState.blocks.length) {
      return;
    }

    if (appendState.layerKind === "completion_fill") {
      restoreCompletionSnapshot();
      return;
    }

    const policyState = window.BmsAppendPolicy?.snapshot?.();
    if (!policyState?.hasValidAppendFile || calculateProgress() < 80) {
      return;
    }

    appendState.completionRestoreSnapshot = createCompletionRestoreSnapshot();
    appendState.completionBasePainted = new Set(appendState.currentPainted);
    appendState.layerKind = "completion_fill";
    for (const block of appendState.blocks) {
      if (!appendState.parentPainted.has(block.index)) {
        appendState.currentPainted.add(block.index);
      }
    }
    updateAppendBlockClasses();
    updateAppendProgressSummary();
    window.BmsPostErrorUi?.clearField?.("completion");
    window.BmsPostErrorUi?.clearField?.("progressMap");
    clearMessage();
  }

  function setAppendSubmitting(nextValue) {
    appendState.isSubmitting = nextValue;
    if (submitButton) {
      submitButton.disabled = nextValue;
      submitButton.textContent = nextValue ? "送信中" : appendState.active ? "追記投稿する" : "投稿する";
    }
    if (cancelAppendButton) {
      cancelAppendButton.disabled = nextValue;
    }
  }

  function setAppendFieldMode(active) {
    for (const input of [titleInput, subtitleInput, artistInput, subartistInput]) {
      if (input) {
        input.disabled = active;
      }
    }

    if (chartNameLabel) {
      chartNameLabel.firstChild.textContent = active ? "今回の差分名 " : "差分名 ";
    }
    if (chartNameHelp) {
      chartNameHelp.textContent = active
        ? "親の差分名を引き継いでいます。必要な場合だけ変更してください。"
        : "一覧で差分を区別する名前です。";
    }
  }

  function setDifficultyValue(value) {
    const difficulty = String(value || "").trim();
    const symbolRules = [
      { pattern: /^★★\s*(\d{1,2})$/i, symbol: "★★", max: 7 },
      { pattern: /^★\s*(\d{1,2})$/i, symbol: "★", max: 25 },
      { pattern: /^sl\s*(\d{1,2})$/i, symbol: "sl", max: 12 },
      { pattern: /^st\s*(\d{1,2})$/i, symbol: "st", max: 15 }
    ];

    for (const rule of symbolRules) {
      const match = difficulty.match(rule.pattern);
      const number = match ? Number(match[1]) : null;
      if (number && number >= 1 && number <= rule.max) {
        document.querySelector(`.difficulty-tab[data-symbol="${rule.symbol}"]`)?.click();
        difficultyChips?.querySelector(`button[data-number="${number}"]`)?.click();
        return;
      }
    }

    if (difficulty) {
      document.querySelector('.difficulty-tab[data-difficulty-mode="manual"]')?.click();
      if (difficultyManualInput) {
        difficultyManualInput.value = difficulty;
        difficultyManualInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      window.BmsDifficultyUi?.collapseIfSelected?.();
      return;
    }

    if (typeof resetDifficultySelector === "function") {
      resetDifficultySelector();
    }
  }

  function enterAppendMode(entry, parentVersion) {
    window.BmsPostErrorUi?.clearAll?.();
    const song = entry.song || {};
    const chart = entry.chart || {};
    const chartId = chart.id || chart.chartId || entry.chartId;
    const parentVersionId = parentVersion.id || parentVersion.versionId;
    const parentMap = parseProgressMap(parentVersion.progressMap);
    const parentChartName = String(
      parentVersion.chartName
      || parentVersion.chart_name
      || chart.name
      || chart.chartName
      || ""
    ).trim();

    if (!chartId || !parentVersionId) {
      showText("追記先のchartIdまたはparentVersionIdを取得できませんでした。");
      return;
    }

    if (!resolveAllowAppend(parentVersion)) {
      showText("この版からの新しい追記は停止されています。");
      return;
    }

    if (!isUsableProgressMap(parentMap)) {
      showText("このversionは古い形式のため、画面から追記できません。");
      return;
    }

    const parentIsRejected = parentVersion.isRejected === true || parentVersion.is_rejected === true;
    if (!parentIsRejected && Number(parentVersion.progress) === 100 && !window.confirm("このversionは進捗100に到達済みです。このversionから追記しますか？")) {
      return;
    }

    window.BmsChartMetadataExtract?.suspend?.();
    discardCompletionState();

    appendState.active = true;
    appendState.entry = entry;
    appendState.song = song;
    appendState.chart = chart;
    appendState.parentVersion = parentVersion;
    appendState.chartId = chartId;
    appendState.parentVersionId = parentVersionId;
    appendState.fileAnalysisStatus = "empty";
    appendState.hasUsableFileProgressMap = false;
    appendState.fileAnalysisRevision += 1;
    window.BmsFormMiniView?.clear();

    submitPanel?.classList.add("is-append-mode");
    if (submitTitle) {
      submitTitle.textContent = "追記投稿フォーム";
    }
    if (formModeBadge) {
      formModeBadge.textContent = "追記投稿";
    }
    if (appendContext) {
      appendContext.hidden = false;
    }
    if (appendContextTitle) {
      appendContextTitle.textContent = `追記投稿: ${parentVersion.displayVersion || "ver?.?"} から`;
    }
    if (appendParentVersion) {
      appendParentVersion.textContent = `${parentVersion.displayVersion || "ver?.?"} / ${parentVersion.branchPath || "root"}`;
    }
    if (appendParentSong) {
      appendParentSong.textContent = song.title || "無題";
    }
    if (appendParentArtist) {
      appendParentArtist.textContent = song.artist || "Unknown Artist";
    }
    if (appendParentChartName) {
      appendParentChartName.textContent = parentChartName || "差分名未入力";
    }

    if (titleInput) titleInput.value = song.title || "";
    if (artistInput) artistInput.value = song.artist || "";
    if (subtitleInput) subtitleInput.value = song.subtitle || "";
    if (subartistInput) subartistInput.value = song.subartist || "";
    if (chartNameInput) chartNameInput.value = parentChartName;
    if (isRejectedInput) isRejectedInput.checked = false;
    window.BmsAppendPolicy?.setMode?.("append");
    if (fileInput) fileInput.value = "";
    if (authorInput) authorInput.value = "";
    if (commentInput) commentInput.value = "";
    window.BmsPostPreferences?.restore?.();

    setAppendFieldMode(true);
    setDifficultyValue(parentVersion.difficulty || "");
    initializeAppendProgressMap(parentMap, { render: false });
    syncAppendPolicyReadiness({ progress: calculateProgress() });
    if (typeof resetProgressMap === "function") {
      resetProgressMap();
    }
    window.BmsPostFileUi?.setEmpty?.();
    setAppendSubmitting(false);
    if (cancelAppendButton) {
      cancelAppendButton.hidden = false;
    }
    clearMessage();
    if (typeof window.BmsPostFormUi?.open === "function") {
      window.BmsPostFormUi.open();
    } else {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      submitPanel?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function exitAppendMode({ resetForm = true } = {}) {
    window.BmsPostErrorUi?.clearAll?.();
    discardCompletionState();
    appendState.active = false;
    appendState.entry = null;
    appendState.song = null;
    appendState.chart = null;
    appendState.parentVersion = null;
    appendState.chartId = "";
    appendState.parentVersionId = "";
    appendState.parentMap = null;
    appendState.parentLayers = [];
    appendState.blocks = [];
    appendState.parentPainted = new Set();
    appendState.currentPainted = new Set();
    appendState.completionBasePainted = null;
    appendState.completionRestoreSnapshot = null;
    appendState.layerKind = "followup";
    appendState.fileGridMismatch = false;
    appendState.fileAnalysisStatus = "empty";
    appendState.hasUsableFileProgressMap = false;
    appendState.fileAnalysisRevision += 1;
    window.BmsFormMiniView?.clear();
    window.BmsPostFileUi?.setEmpty?.();
    appendState.isDragging = false;
    appendState.originalCurrentPainted = null;
    syncAppendPolicyReadiness({ progress: 0 });

    submitPanel?.classList.remove("is-append-mode");
    if (submitTitle) submitTitle.textContent = "投稿フォーム";
    if (formModeBadge) formModeBadge.textContent = "初回投稿 ver1.0";
    if (appendContext) appendContext.hidden = true;
    if (cancelAppendButton) cancelAppendButton.hidden = true;
    setAppendFieldMode(false);

    if (resetForm) {
      form?.reset();
      window.BmsAppendPolicy?.setMode?.("initial");
      if (typeof clearRequiredFieldIndicators === "function") {
        clearRequiredFieldIndicators();
      }
      if (typeof resetDifficultySelector === "function") {
        resetDifficultySelector();
      }
      if (typeof resetProgressMap === "function") {
        resetProgressMap();
      }
      if (progressInput) {
        progressInput.value = "100";
        progressInput.readOnly = false;
        progressInput.classList.remove("readonly-input");
      }
      window.BmsPostPreferences?.restore?.();
      if (typeof applyRejectedProgressState === "function") {
        applyRejectedProgressState();
      }
      window.BmsPostFormUi?.markClean?.();
    }

    setAppendSubmitting(false);
    window.BmsChartMetadataExtract?.resume?.();
    clearMessage();
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[\s\u3000_-]+/g, "").trim();
  }

  function isCloseMetaMatch(fileValue, parentValue) {
    const fileText = normalizeText(fileValue);
    const parentText = normalizeText(parentValue);
    if (!fileText || !parentText) {
      return true;
    }
    return fileText.includes(parentText) || parentText.includes(fileText);
  }

  async function handleAppendFileChange(file) {
    const analysisRevision = ++appendState.fileAnalysisRevision;
    discardCompletionState();
    appendState.currentPainted = new Set();
    appendState.fileGridMismatch = false;
    appendState.hasUsableFileProgressMap = false;
    window.BmsFormMiniView?.clear();
    if (!file) {
      setInvalid(fileInput, false);
      appendState.currentPainted = new Set();
      setAppendFileAnalysisState("empty", { progress: calculateProgress() });
      if (typeof resetProgressMap === "function") {
        resetProgressMap();
      }
      window.BmsPostFileUi?.setEmpty?.();
      clearMessage();
      return;
    }

    const fileValidation = window.BmsPostFileUi?.validateFile?.(file);
    if (fileValidation && !fileValidation.valid) {
      fileInput.value = "";
      setInvalid(fileInput, true);
      if (typeof resetProgressMap === "function") {
        resetProgressMap();
      }
      window.BmsPostFileUi?.setError?.(fileValidation.message, file);
      setAppendFileAnalysisState("error", { progress: calculateProgress() });
      clearMessage();
      return;
    }

    const extension = getExtension(file.name);
    if (!allowedExtensions.has(extension)) {
      fileInput.value = "";
      setInvalid(fileInput, true);
      window.BmsPostFileUi?.setError?.("投稿できるのは .bms / .bme / .bml / .zip です。", file);
      setAppendFileAnalysisState("error", { progress: calculateProgress() });
      clearMessage();
      return;
    }

    setInvalid(fileInput, false);

    try {
      setAppendFileAnalysisState("loading", { progress: calculateProgress() });
      window.BmsPostFileUi?.setAnalyzing?.(file);
      if (typeof setProgressMapMessage === "function") {
        setProgressMapMessage(extension === ".zip" ? "ZIP内の譜面を解析しています" : "譜面を解析しています", "loading");
      }
      window.BmsFormMiniView?.setLoading();
      const localAnalysis = await window.BmsLocalChartAnalysis.analyze(file, analyzeBmsProgressText);
      if (
        analysisRevision !== appendState.fileAnalysisRevision
        || !appendState.active
        || fileInput.files?.[0] !== file
      ) {
        return;
      }
      const text = localAnalysis.text;
      const meta = typeof parseBmsMeta === "function" ? parseBmsMeta(text) : { title: "", artist: "" };
      const analysis = localAnalysis.progressAnalysis;
      const analyzedBlocks = Array.isArray(analysis?.standardBlocks)
        ? analysis.standardBlocks.map(normalizeBlock)
        : [];
      appendState.fileGridMismatch = !blocksShareGrid(appendState.parentMap?.blocks || [], analyzedBlocks);
      if (appendState.fileGridMismatch) {
        window.BmsFormMiniView?.setUnavailable("block格子不一致のためミニビュー非表示");
        if (typeof setProgressMapMessage === "function") {
          setProgressMapMessage("選択した譜面の進捗ブロック格子が追記元と一致しません", "unavailable");
        }
        window.BmsPostFileUi?.setError?.("追記元と進捗ブロックの構成が一致しません。", file);
        setAppendFileAnalysisState("error", { progress: calculateProgress() });
        clearMessage();
        return;
      }

      appendState.blocks = analyzedBlocks;
      setAppendFileAnalysisState("ready", {
        hasProgressMap: analyzedBlocks.length > 0,
        progress: calculateProgress()
      });
      renderAppendProgressMap();
      if (localAnalysis.miniView?.status === "ready") {
        window.BmsFormMiniView?.setAnalysis(localAnalysis.miniView, analyzedBlocks);
      } else {
        window.BmsFormMiniView?.setUnavailable("ミニビュー非対応");
      }
      window.BmsPostFileUi?.setReady?.({
        file,
        sourceFileName: localAnalysis.sourceFileName,
        blockCount: analyzedBlocks.length,
        miniViewAvailable: localAnalysis.miniView?.status === "ready"
      });
      if (appendState.hasUsableFileProgressMap && !appendState.fileGridMismatch) {
        window.BmsPostErrorUi?.clearField?.("progressMap");
      }
      const titleMatches = isCloseMetaMatch(meta.title, appendState.song?.title);
      const artistMatches = isCloseMetaMatch(meta.artist, appendState.song?.artist);

      if (!titleMatches || !artistMatches) {
        showText("選択ファイルの曲名/アーティストが追記先と一致しない可能性があります。");
        return;
      }

      clearMessage();
    } catch (error) {
      if (
        analysisRevision !== appendState.fileAnalysisRevision
        || !appendState.active
        || fileInput.files?.[0] !== file
      ) {
        return;
      }
      appendState.fileGridMismatch = true;
      setAppendFileAnalysisState("error", { progress: calculateProgress() });
      window.BmsFormMiniView?.clear();
      if (typeof setProgressMapMessage === "function") {
        setProgressMapMessage("BMS解析に失敗しました", "unavailable");
      }
      window.BmsPostFileUi?.setError?.("譜面情報を読み取れませんでした。ファイルの内容を確認してください。", file);
      console.error("[append-file-meta-check] failed to read BMS metadata", {
        code: "APPEND_FILE_META_CHECK_FAILED",
        message: error instanceof Error ? error.message : String(error)
      });
      clearMessage();
    }
  }

  function validateAppendForm() {
    const errors = [];
    const addError = (fieldKey, message, code = "FIELD_REQUIRED") => {
      errors.push({ fieldKey, message, code });
    };
    const selectedFile = fileInput?.files?.[0];

    if (!appendState.chartId || !appendState.parentVersionId) {
      addError("appendContext", "追記元の情報を確認できません。版ツリーから追記先を選び直してください。", "APPEND_CONTEXT_MISSING");
    }
    if (appendState.fileAnalysisStatus === "error") {
      addError(
        "file",
        document.querySelector("#chartFileDropError")?.textContent?.trim()
          || "譜面ファイルを解析できませんでした。別のファイルを選択してください。",
        "FILE_ANALYSIS_FAILED"
      );
    } else if (!selectedFile) {
      addError("file", "譜面ファイルを選択してください。");
    } else if (appendState.fileAnalysisStatus === "loading") {
      addError("file", "譜面ファイルの解析が完了するまでお待ちください。", "FILE_ANALYSIS_PENDING");
    }
    setInvalid(fileInput, !selectedFile || appendState.fileAnalysisStatus === "error");

    if (!difficultyInput?.value?.trim()) {
      addError("difficulty", "想定難易度を選択または入力してください。");
      setInvalid(difficultyInput, true);
    }
    if (!chartNameInput?.value?.trim()) {
      addError("chartName", "今回の差分名を入力してください。");
      setInvalid(chartNameInput, true);
    } else if (Array.from(chartNameInput.value.trim()).length > 100) {
      addError("chartName", "今回の差分名は100文字以内で入力してください。", "CHART_NAME_TOO_LONG");
      setInvalid(chartNameInput, true);
    } else {
      setInvalid(chartNameInput, false);
    }
    if (!authorInput?.value?.trim()) {
      addError("author", "差分作者を入力してください。");
      setInvalid(authorInput, true);
    }
    if (!passwordInput?.value?.trim()) {
      addError("password", "管理パスワードを入力してください。");
      setInvalid(passwordInput, true);
    }

    if (appendState.layerKind === "completion_fill") {
      const policyState = window.BmsAppendPolicy?.snapshot?.();
      const completionStateValid = Boolean(
        appendState.active
        && fileInput?.files?.[0]
        && appendState.fileAnalysisStatus === "ready"
        && appendState.hasUsableFileProgressMap
        && !appendState.fileGridMismatch
        && appendState.completionRestoreSnapshot?.progressMap
        && calculateProgress() === 100
        && !isRejectedInput?.checked
        && policyState?.isCompleted
        && policyState?.hasValidAppendFile
      );
      if (!completionStateValid) {
        addError("completion", "完成版の状態を確認できません。譜面ファイルを選択し直してください。", "COMPLETION_ACTION_REQUIRED");
      }
    }

    if (appendState.currentPainted.size === 0) {
      addError("progressMap", "追記範囲が追加されていません。", "PROGRESS_MAP_UNCHANGED");
    }
    if (appendState.fileGridMismatch) {
      addError("progressMap", "選択した譜面の進捗ブロック格子が追記元と一致しません。", "PROGRESS_MAP_BLOCK_COUNT_MISMATCH");
    }
    const policyState = window.BmsAppendPolicy?.snapshot?.();
    if (!policyState?.isCompleted && window.BmsAppendPolicy?.effectiveValue?.() === false) {
      addError("allowAppend", "追記未完成版では追記受付を停止できません。", "APPEND_POLICY_LOCKED_FOR_INCOMPLETE");
    }

    if (errors.length > 0) {
      if (window.BmsPostErrorUi?.showValidationErrors) {
        window.BmsPostErrorUi.showValidationErrors(errors, {
          source: "local"
        });
      } else {
        showText(`入力内容を確認してください（${errors.length}件）`);
      }
      return false;
    }

    window.BmsPostErrorUi?.clearAll?.({ source: "local" });
    clearMessage();
    return true;
  }

  function buildAppendFormData() {
    const difficulty = difficultyInput.value.trim();
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("parentVersionId", appendState.parentVersionId);
    formData.append("chartName", chartNameInput.value.trim());
    formData.append("author", authorInput.value.trim());
    formData.append("progressMap", JSON.stringify(buildAppendProgressMapPayload()));
    formData.append("password", passwordInput.value);
    formData.append("difficulty", difficulty);
    formData.append("level", localExtractLevel(difficulty));
    formData.append("comment", commentInput.value.trim());
    formData.append("isRejected", "false");
    formData.append("allowAppend", window.BmsAppendPolicy?.effectiveValue?.() ? "true" : "false");
    return formData;
  }

  async function submitAppendVersion() {
    if (appendState.isSubmitting || !appendState.active) {
      return;
    }

    window.BmsPostErrorUi?.clearAll?.({ source: "api" });
    if (!validateAppendForm()) {
      return;
    }

    setAppendSubmitting(true);

    try {
      const turnstileToken = await window.BmsTurnstile?.getToken();
      if (!turnstileToken) {
        throw {
          code: "TURNSTILE_REQUIRED",
          message: "Turnstile認証を完了してください。",
          detail: "Turnstile token is unavailable."
        };
      }
      const created = await callApi(`/api/charts/${encodeURIComponent(appendState.chartId)}/versions`, {
        method: "POST",
        headers: {
          "X-Turnstile-Token": turnstileToken
        },
        body: buildAppendFormData()
      });
      window.BmsPostPreferences?.commitAfterSuccess?.({
        author: authorInput?.value.trim() || "",
        password: passwordInput?.value || "",
        saveAuthor: Boolean(saveAuthorInput?.checked),
        savePassword: Boolean(savePasswordInput?.checked)
      });
      exitAppendMode({ resetForm: true });
      window.BmsTurnstile?.reset();
      window.BmsPostFormUi?.markClean?.();
      window.BmsPostFormUi?.close?.();
      if (window.BmsChartDetail?.showCreatedVersion) {
        await window.BmsChartDetail.showCreatedVersion({
          chartId: created?.chartId,
          versionId: created?.versionId,
          message: "追記を投稿しました。"
        });
      } else if (typeof loadCharts === "function") {
        await loadCharts({ selectedChartId: created?.chartId });
      }
    } catch (error) {
      console.error("[api-chart-version-append] failed to append version", {
        code: error?.code || "CHART_VERSION_APPEND_FAILED",
        stage: "submit_append",
        status: Number(error?.status) || null,
        errorType: error?.name || typeof error
      });
      showApiError(error);
    } finally {
      window.BmsTurnstile?.reset();
      setAppendSubmitting(false);
    }
  }

  function renderProgressThumbnail(version) {
    const progressMapObject = parseProgressMap(version?.progressMap);
    if (!isUsableProgressMap(progressMapObject)) {
      return "";
    }

    const totalBlocks = progressMapObject.blocks.length;
    const layers = progressMapObject.layers.map((layer) => normalizeLayer(layer, parentLayerColor));
    const painted = collectPaintedIndexes(layers, totalBlocks);
    const progress = Number.isFinite(Number(progressMapObject.progress))
      ? Number(progressMapObject.progress)
      : Math.round((painted.size / totalBlocks) * 100);
    const cellCount = Math.max(1, Math.min(totalBlocks, thumbnailMaxCells));
    const cells = Array.from({ length: cellCount }, (_, cellIndex) => {
      const startIndex = Math.floor((cellIndex * totalBlocks) / cellCount);
      const nextStart = Math.floor(((cellIndex + 1) * totalBlocks) / cellCount);
      const endIndex = Math.max(startIndex, nextStart - 1);
      let cellPainted = false;
      for (let index = startIndex; index <= endIndex; index += 1) {
        if (painted.has(index)) {
          cellPainted = true;
          break;
        }
      }
      return `<span class="progress-thumbnail-cell${cellPainted ? " is-painted" : ""}" aria-hidden="true"></span>`;
    }).join("");

    return `
      <div class="progress-thumbnail" aria-label="progress ${html(progress)}%">
        <div class="progress-thumbnail-bar" style="--progress-thumbnail-cells: ${cellCount};">${cells}</div>
        <span class="progress-thumbnail-value">progress ${html(progress)}%</span>
      </div>
    `;
  }

  function buildAppendControl(entry, version) {
    const chart = entry.chart || {};
    const chartId = chart.id || chart.chartId || entry.chartId || "";
    const parentVersionId = version.id || version.versionId || "";

    if (!resolveAllowAppend(version)) {
      const descriptionId = `append-policy-description-${html(parentVersionId)}`;
      return `
        <button class="secondary append-policy-disabled-button" type="button" disabled aria-disabled="true" aria-describedby="${descriptionId}">追記停止</button>
      `;
    }

    if (!isUsableProgressMap(version.progressMap)) {
      return `
        <button class="secondary" type="button" disabled aria-disabled="true">旧形式</button>
      `;
    }

    return `<button class="secondary append-version-button" type="button" data-chart-id="${html(chartId)}" data-parent-version-id="${html(parentVersionId)}">追記投稿</button>`;
  }

  function renderChartsWithAppend(data) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];
    const nextChartIds = new Set(charts.map((entry) => String(entry?.chart?.id || entry?.chartId || "")));
    appendState.charts = [
      ...charts,
      ...appendState.charts.filter((entry) => {
        const chartId = String(entry?.chart?.id || entry?.chartId || "");
        return chartId && !nextChartIds.has(chartId);
      })
    ];

    if (!chartList) {
      return;
    }

    if (charts.length === 0) {
      if (typeof renderEmpty === "function") {
        renderEmpty();
      } else {
        chartList.innerHTML = `<div class="list-status">投稿はまだありません。</div>`;
      }
      return;
    }

    chartList.innerHTML = charts.map((entry) => {
      const song = entry.song || {};
      const chart = entry.chart || {};
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const rows = versions.map((version) => {
        const difficulty = version.difficulty || "未入力";
        const progress = Number.isFinite(Number(version.progress)) ? Number(version.progress) : 0;
        const thumbnail = renderProgressThumbnail(version);
        const displayVersionLabel = String(version.displayVersion || "ver?.?");
        const originHref = makeOriginUrl(version.originUrl);
        const downloadHref = makeDownloadUrl(version.file?.downloadUrl);
        const rejectedBadge = version.isRejected ? `<span class="rejected-badge">没譜面</span>` : "";
        const originControl = originHref
          ? `<a class="version-origin-link" href="${html(originHref)}" target="_blank" rel="noopener noreferrer" title="原曲・本体の配布ページを開く" aria-label="${html(`${displayVersionLabel} の原曲・本体の配布ページを開く（外部サイト）`)}">曲</a>`
          : "";
        const downloadControl = downloadHref
          ? `<a class="version-download-control" href="${html(downloadHref)}">DL</a>`
          : `<span class="version-download-control download-disabled">DL不可</span>`;

        return `
          <div class="version-row">
            <div class="version-tag">${html(version.displayVersion || "ver?.?")}</div>
            <div class="meta-block">
              <span class="meta-label">想定難易度</span>
              <span class="meta-value">${html(difficulty)}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">差分作者</span>
              <span class="meta-value">${html(version.author || "未入力")}</span>
            </div>
            <div class="meta-block">
              <span class="meta-label">進捗度</span>
              <span class="progress-pill">${html(progress)}%</span>
              ${rejectedBadge}
            </div>
            <div class="meta-block progress-thumbnail-block${thumbnail ? "" : " is-empty"}">
              ${thumbnail || ""}
            </div>
            <div class="meta-block">
              <span class="meta-label">コメント</span>
              <span class="meta-value">${html(version.comment || "")}</span>
            </div>
            <div class="version-actions">
              ${originControl}
              ${downloadControl}
              ${buildAppendControl(entry, version)}
            </div>
          </div>
        `;
      }).join("");

      return `
        <article class="chart-group">
          <div class="chart-title-row">
            <div class="chart-heading-main">
              <h3>${html(song.title || "無題")}</h3>
              <span class="artist-separator">/</span>
              <span class="chart-artist">${html(song.artist || "Unknown Artist")}</span>
            </div>
            <div class="chart-origin-name">
              <span class="chart-origin-name-label">起点差分名：</span>
              <span class="chart-origin-name-value" title="${html(chart.name || "差分名未入力")}">${html(chart.name || "差分名未入力")}</span>
            </div>
          </div>
          <div class="version-list">${rows || `<div class="list-status">表示できるversionがありません。</div>`}</div>
        </article>
      `;
    }).join("");
  }

  function findAppendTarget(chartId, parentVersionId) {
    for (const entry of appendState.charts) {
      const chart = entry.chart || {};
      const currentChartId = chart.id || chart.chartId || entry.chartId || "";
      if (currentChartId !== chartId) {
        continue;
      }

      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const version = versions.find((item) => (item.id || item.versionId) === parentVersionId);
      if (version) {
        return { entry, version };
      }
    }

    return null;
  }

  chartInteractionRoot?.addEventListener("click", (event) => {
    const button = event.target.closest(".append-version-button");
    if (!button) {
      return;
    }

    const target = findAppendTarget(button.dataset.chartId, button.dataset.parentVersionId);
    if (!target) {
      showText("追記先のversionを一覧から取得できませんでした。ページを再読み込みしてください。");
      return;
    }

    enterAppendMode(target.entry, target.version);
  });

  cancelAppendButton?.addEventListener("click", () => {
    exitAppendMode({ resetForm: true });
  });

  form?.addEventListener("submit", (event) => {
    if (!appendState.active) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    submitAppendVersion();
  }, true);

  fileInput?.addEventListener("change", (event) => {
    if (!appendState.active) {
      return;
    }

    event.stopImmediatePropagation();
    handleAppendFileChange(fileInput.files?.[0]);
  }, true);

  progressMapBlocks?.addEventListener("pointerdown", (event) => {
    if (!appendState.active || event.button !== 0) {
      return;
    }

    const block = event.target.closest(".progress-map-block");
    if (!block) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    startAppendDrag(Number(block.dataset.blockIndex), event);
  }, true);

  progressMapBlocks?.addEventListener("pointermove", (event) => {
    if (!appendState.active) {
      return;
    }

    event.stopImmediatePropagation();
    const block = findProgressBlockFromPointer(event);
    if (appendState.isDragging) {
      event.preventDefault();
      if (block) {
        applyAppendDragRange(Number(block.dataset.blockIndex));
      }
      return;
    }

    if (block) {
      showAppendTooltip(block, event);
    } else if (progressMapTooltip) {
      progressMapTooltip.hidden = true;
    }
  }, true);

  progressMapBlocks?.addEventListener("pointerout", (event) => {
    if (!appendState.active) {
      return;
    }

    event.stopImmediatePropagation();
    if (!progressMapBlocks.contains(event.relatedTarget) && progressMapTooltip) {
      progressMapTooltip.hidden = true;
    }
  }, true);

  progressMapBlocks?.addEventListener("pointerup", (event) => {
    if (!appendState.active || !appendState.isDragging) {
      return;
    }

    event.stopImmediatePropagation();
    progressMapBlocks.releasePointerCapture?.(event.pointerId);
    finishAppendDrag();
  }, true);

  progressMapBlocks?.addEventListener("pointercancel", (event) => {
    if (!appendState.active || !appendState.isDragging) {
      return;
    }

    event.stopImmediatePropagation();
    progressMapBlocks.releasePointerCapture?.(event.pointerId);
    finishAppendDrag({ restoreOriginal: true });
  }, true);

  progressMapBlocks?.addEventListener("contextmenu", (event) => {
    if (!appendState.active) {
      return;
    }

    const block = event.target.closest(".progress-map-block");
    if (!block) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (progressMapTooltip) {
      progressMapTooltip.hidden = true;
    }
    showAppendPopover(block, event);
  }, true);

  completeProgressButton?.addEventListener("click", (event) => {
    if (!appendState.active) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    toggleAppendCompletion();
  }, true);

  window.addEventListener("resize", () => {
    if (!appendState.active) {
      return;
    }

    drawAppendDensityChart();
    renderAppendLabels();
    hideAppendFloatingInfo();
  });

  window.addEventListener("bms:themechange", () => {
    if (appendState.active) {
      drawAppendDensityChart();
    }
  });

  try {
    renderCharts = renderChartsWithAppend;
  } catch (error) {
    window.renderCharts = renderChartsWithAppend;
  }

  function blocksShareGrid(leftBlocks, rightBlocks) {
    if (!Array.isArray(leftBlocks) || !Array.isArray(rightBlocks) || leftBlocks.length !== rightBlocks.length) {
      return false;
    }

    return leftBlocks.every((block, index) => {
      const other = rightBlocks[index];
      const hasLeftStart = block.startPosition !== null && block.startPosition !== undefined;
      const hasRightStart = other.startPosition !== null && other.startPosition !== undefined;
      const hasLeftEnd = block.endPosition !== null && block.endPosition !== undefined;
      const hasRightEnd = other.endPosition !== null && other.endPosition !== undefined;
      const leftStart = Number(block.startPosition);
      const rightStart = Number(other.startPosition);
      const leftEnd = Number(block.endPosition);
      const rightEnd = Number(other.endPosition);
      return Number(block.index) === Number(other.index)
        && Number(block.startMeasure) === Number(other.startMeasure)
        && Number(block.endMeasure) === Number(other.endMeasure)
        && (!hasLeftStart || !hasRightStart || Math.abs(leftStart - rightStart) <= 1e-9)
        && (!hasLeftEnd || !hasRightEnd || Math.abs(leftEnd - rightEnd) <= 1e-9);
    });
  }
})();
