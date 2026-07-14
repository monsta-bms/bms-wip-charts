(() => {
  const appendLayerColor = "#2563eb";
  const parentLayerColor = "#1f7a5c";
  const thumbnailMaxCells = 96;
  const allowedExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);

  const submitPanel = document.querySelector(".submit-panel");
  const form = document.querySelector("#chartForm");
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
  const difficultyInput = document.querySelector("#difficulty");
  const difficultyPicker = document.querySelector("#difficultyPicker");
  const difficultyManualInput = document.querySelector("#difficultyManual");
  const difficultyChips = document.querySelector("#difficultyChips");
  const authorInput = document.querySelector("#author");
  const progressInput = document.querySelector("#progress");
  const progressMap = document.querySelector("#progressMap");
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
  const passwordInput = document.querySelector("#password");
  const savePasswordInput = document.querySelector("#savePassword");
  const submitButton = document.querySelector("#submitButton");
  const cancelAppendButton = document.querySelector("#cancelAppendButton");
  const chartList = document.querySelector("#chartList");

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
    layerKind: "followup",
    fileGridMismatch: false,
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

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
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
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, cssWidth, cssHeight);
    context.strokeStyle = "#dce4ea";
    context.beginPath();
    context.moveTo(0, baseY + 0.5);
    context.lineTo(cssWidth, baseY + 0.5);
    context.stroke();
    context.fillStyle = "rgba(42, 128, 116, 0.46)";

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
    progressMapBlocks.querySelectorAll(".progress-map-block").forEach((block) => {
      const index = Number(block.dataset.blockIndex);
      const parentPainted = appendState.parentPainted.has(index);
      const currentPainted = appendState.currentPainted.has(index);
      const painted = union.has(index);
      block.classList.toggle("is-parent-painted", parentPainted);
      block.classList.toggle("is-current-painted", currentPainted);
      block.classList.toggle("is-painted", painted);
      block.setAttribute("aria-pressed", painted ? "true" : "false");
      block.disabled = false;
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
      progressMapSummary.textContent = `play notes: ${playNotes} / blocks: ${appendState.blocks.length} / measures: ${formatMeasure(firstMeasure)}-${formatMeasure(lastMeasure)} / progress: ${progress}%`;
      progressMapSummary.hidden = false;
    }

    if (completeProgressButton) {
      completeProgressButton.disabled = progress < 80 || progress >= 100;
    }
  }

  function renderAppendProgressMap() {
    if (!progressMap || !progressMapBlocks || !appendState.blocks.length) {
      return;
    }

    progressMap.dataset.state = "ready";
    progressMap.classList.remove("is-locked");
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

  function initializeAppendProgressMap(progressMapValue) {
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
    appendState.layerKind = "followup";
    appendState.fileGridMismatch = false;
    appendState.isDragging = false;
    appendState.dragAnchorIndex = null;
    appendState.dragMode = null;
    appendState.originalCurrentPainted = null;
    renderAppendProgressMap();
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

    return {
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
    if (!appendState.active || !Number.isInteger(blockIndex)) {
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
  }

  function paintAppendCompletion() {
    if (!appendState.active || !appendState.blocks.length) {
      return;
    }

    appendState.layerKind = "completion_fill";
    for (const block of appendState.blocks) {
      if (!appendState.parentPainted.has(block.index)) {
        appendState.currentPainted.add(block.index);
      }
    }
    updateAppendBlockClasses();
    updateAppendProgressSummary();
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
    for (const input of [titleInput, subtitleInput, artistInput, subartistInput, chartNameInput, isRejectedInput]) {
      if (input) {
        input.disabled = active;
      }
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
      return;
    }

    if (typeof resetDifficultySelector === "function") {
      resetDifficultySelector();
    }
  }

  function enterAppendMode(entry, parentVersion) {
    const song = entry.song || {};
    const chart = entry.chart || {};
    const chartId = chart.id || chart.chartId || entry.chartId;
    const parentVersionId = parentVersion.id || parentVersion.versionId;
    const parentMap = parseProgressMap(parentVersion.progressMap);

    if (!chartId || !parentVersionId) {
      showText("追記先のchartIdまたはparentVersionIdを取得できませんでした。");
      return;
    }

    if (parentVersion.isRejected) {
      showText("没譜面は追記できません");
      return;
    }

    if (!isUsableProgressMap(parentMap)) {
      showText("このversionは古い形式のため、画面から追記できません。");
      return;
    }

    if (Number(parentVersion.progress) === 100 && !window.confirm("このversionは進捗100に到達済みです。このversionから追記しますか？")) {
      return;
    }

    appendState.active = true;
    appendState.entry = entry;
    appendState.song = song;
    appendState.chart = chart;
    appendState.parentVersion = parentVersion;
    appendState.chartId = chartId;
    appendState.parentVersionId = parentVersionId;
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
      appendParentChartName.textContent = chart.name || "差分名未入力";
    }

    if (titleInput) titleInput.value = song.title || "";
    if (artistInput) artistInput.value = song.artist || "";
    if (subtitleInput) subtitleInput.value = song.subtitle || "";
    if (subartistInput) subartistInput.value = song.subartist || "";
    if (chartNameInput) chartNameInput.value = chart.name || "";
    if (isRejectedInput) isRejectedInput.checked = false;
    if (fileInput) fileInput.value = "";
    if (authorInput) authorInput.value = "";
    if (commentInput) commentInput.value = "";

    setAppendFieldMode(true);
    setDifficultyValue(parentVersion.difficulty || "");
    initializeAppendProgressMap(parentMap);
    setAppendSubmitting(false);
    if (cancelAppendButton) {
      cancelAppendButton.hidden = false;
    }
    clearMessage();
    submitPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitAppendMode({ resetForm = true } = {}) {
    const savedPassword = passwordInput?.value || "";
    const shouldRestorePassword = Boolean(savePasswordInput?.checked);

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
    appendState.layerKind = "followup";
    appendState.fileGridMismatch = false;
    appendState.fileAnalysisRevision += 1;
    window.BmsFormMiniView?.clear();
    appendState.isDragging = false;
    appendState.originalCurrentPainted = null;

    submitPanel?.classList.remove("is-append-mode");
    if (submitTitle) submitTitle.textContent = "投稿フォーム";
    if (formModeBadge) formModeBadge.textContent = "初回投稿 ver1.0";
    if (appendContext) appendContext.hidden = true;
    if (cancelAppendButton) cancelAppendButton.hidden = true;
    setAppendFieldMode(false);

    if (resetForm) {
      form?.reset();
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
      if (shouldRestorePassword && passwordInput && savePasswordInput) {
        passwordInput.value = savedPassword;
        savePasswordInput.checked = true;
      }
      if (typeof applyRejectedProgressState === "function") {
        applyRejectedProgressState();
      }
    }

    setAppendSubmitting(false);
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
    window.BmsFormMiniView?.clear();
    if (!file) {
      setInvalid(fileInput, false);
      clearMessage();
      return;
    }

    const extension = getExtension(file.name);
    if (!allowedExtensions.has(extension)) {
      fileInput.value = "";
      setInvalid(fileInput, true);
      showText("投稿対象は .bms .bme .bml .zip のみです。");
      return;
    }

    setInvalid(fileInput, false);

    try {
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
        showText("選択した譜面の進捗ブロック格子が追記元と一致しません。");
        return;
      }

      appendState.blocks = analyzedBlocks;
      renderAppendProgressMap();
      if (localAnalysis.miniView?.status === "ready") {
        window.BmsFormMiniView?.setAnalysis(localAnalysis.miniView, analyzedBlocks);
      } else {
        window.BmsFormMiniView?.setUnavailable("ミニビュー非対応");
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
      window.BmsFormMiniView?.clear();
      console.error("[append-file-meta-check] failed to read BMS metadata", {
        code: "APPEND_FILE_META_CHECK_FAILED",
        message: error instanceof Error ? error.message : String(error)
      });
      showText("譜面情報の読み取りに失敗しました。追記先との一致判定はAPI側で行います。");
    }
  }

  function validateAppendForm() {
    const missing = [];

    if (!fileInput?.files?.[0]) {
      missing.push("譜面ファイル");
      setInvalid(fileInput, true);
    }
    if (!difficultyInput?.value?.trim()) {
      missing.push("想定難易度");
      setInvalid(difficultyInput, true);
    }
    if (!authorInput?.value?.trim()) {
      missing.push("差分作者");
      setInvalid(authorInput, true);
    }
    if (!passwordInput?.value?.trim()) {
      missing.push("管理パスワード");
      setInvalid(passwordInput, true);
    }

    if (missing.length > 0) {
      showText(`未入力の項目があります: ${missing.join(", ")}`);
      return false;
    }

    if (appendState.currentPainted.size === 0) {
      showText("追記範囲が追加されていません。");
      return false;
    }

    if (appendState.fileGridMismatch) {
      showText("選択した譜面の進捗ブロック格子が追記元と一致しません。");
      return false;
    }

    clearMessage();
    return true;
  }

  function buildAppendFormData() {
    const difficulty = difficultyInput.value.trim();
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("parentVersionId", appendState.parentVersionId);
    formData.append("author", authorInput.value.trim());
    formData.append("progressMap", JSON.stringify(buildAppendProgressMapPayload()));
    formData.append("password", passwordInput.value);
    formData.append("difficulty", difficulty);
    formData.append("level", localExtractLevel(difficulty));
    formData.append("comment", commentInput.value.trim());
    return formData;
  }

  async function submitAppendVersion() {
    if (appendState.isSubmitting || !appendState.active) {
      return;
    }

    if (!validateAppendForm()) {
      return;
    }

    setAppendSubmitting(true);

    try {
      if (typeof persistPasswordPreference === "function") {
        persistPasswordPreference();
      }
      const turnstileToken = await window.BmsTurnstile?.getToken();
      if (!turnstileToken) {
        throw {
          code: "TURNSTILE_REQUIRED",
          message: "Turnstile認証を完了してください。",
          detail: "Turnstile token is unavailable."
        };
      }
      await callApi(`/api/charts/${encodeURIComponent(appendState.chartId)}/versions`, {
        method: "POST",
        headers: {
          "X-Turnstile-Token": turnstileToken
        },
        body: buildAppendFormData()
      });
      exitAppendMode({ resetForm: true });
      if (typeof loadCharts === "function") {
        await loadCharts();
      }
    } catch (error) {
      console.error("[api-chart-version-append] failed to append version", {
        code: error?.code || "CHART_VERSION_APPEND_FAILED",
        message: error?.detail || error?.message || String(error)
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

    if (version.isRejected) {
      return `
        <button class="secondary" type="button" disabled title="没譜面は追記できません">追記投稿</button>
        <span class="append-disabled-note">没譜面は追記できません</span>
      `;
    }

    if (!isUsableProgressMap(version.progressMap)) {
      return `
        <button class="secondary" type="button" disabled title="このversionは古い形式のため、画面から追記できません。">追記投稿</button>
        <span class="append-disabled-note">古い形式のため追記不可</span>
      `;
    }

    return `<button class="secondary append-version-button" type="button" data-chart-id="${html(chartId)}" data-parent-version-id="${html(parentVersionId)}">追記投稿</button>`;
  }

  function renderChartsWithAppend(data) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];
    appendState.charts = charts;

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
        const downloadHref = makeDownloadUrl(version.file?.downloadUrl);
        const rejectedBadge = version.isRejected ? `<span class="rejected-badge">没譜面</span>` : "";
        const downloadControl = downloadHref
          ? `<a href="${html(downloadHref)}">DL</a>`
          : `<span class="download-disabled">DL不可</span>`;

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
              ${downloadControl}
              ${buildAppendControl(entry, version)}
            </div>
          </div>
        `;
      }).join("");

      return `
        <article class="chart-group">
          <div class="chart-title-row">
            <h3>${html(song.title || "無題")}</h3>
            <span class="artist-separator">/</span>
            <span class="chart-artist">${html(song.artist || "Unknown Artist")}</span>
            <span class="chart-name-badge">${html(chart.name || "差分名未入力")}</span>
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

  chartList?.addEventListener("click", (event) => {
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
    paintAppendCompletion();
  }, true);

  window.addEventListener("resize", () => {
    if (!appendState.active) {
      return;
    }

    drawAppendDensityChart();
    renderAppendLabels();
    hideAppendFloatingInfo();
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
