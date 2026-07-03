const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
const PASSWORD_STORAGE_KEY = "bms-wip-charts-admin-password";

const allowedChartExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);
const readableChartExtensions = new Set([".bms", ".bme", ".bml"]);

const form = document.querySelector("#chartForm");
const fileInput = document.querySelector("#chartFile");
const titleInput = document.querySelector("#title");
const subtitleInput = document.querySelector("#subtitle");
const artistInput = document.querySelector("#artist");
const subartistInput = document.querySelector("#subartist");
const chartNameInput = document.querySelector("#chartName");
const difficultyInput = document.querySelector("#difficulty");
const difficultyPicker = document.querySelector("#difficultyPicker");
const difficultyTabs = Array.from(document.querySelectorAll(".difficulty-tab"));
const difficultyChips = document.querySelector("#difficultyChips");
const difficultyManualPanel = document.querySelector("#difficultyManualPanel");
const difficultyManualInput = document.querySelector("#difficultyManual");
const difficultyPreview = document.querySelector("#difficultyPreview");
const authorInput = document.querySelector("#author");
const progressInput = document.querySelector("#progress");
const progressMap = document.querySelector("#progressMap");
const progressMapStatus = document.querySelector("#progressMapStatus");
const progressMapGraphWrap = document.querySelector("#progressMapGraphWrap");
const progressMapCanvas = document.querySelector("#progressMapCanvas");
const progressMapBlocks = document.querySelector("#progressMapBlocks");
const progressMapSummary = document.querySelector("#progressMapSummary");
const completeProgressButton = document.querySelector("#completeProgressButton");
const commentInput = document.querySelector("#comment");
const isRejectedInput = document.querySelector("#isRejected");
const passwordInput = document.querySelector("#password");
const savePasswordInput = document.querySelector("#savePassword");
const submitButton = document.querySelector("#submitButton");
const errorBox = document.querySelector("#errorBox");
const chartList = document.querySelector("#chartList");

let isSubmitting = false;
let lastValidManualDifficulty = "";

const maxDifficultyNumber = 25;
const progressMapCanvasHeight = 180;
const difficultyLimits = {
  "★": 25,
  "★★": 7,
  sl: 12,
  st: 15
};

const normalPlayNoteChannelRanges = [[11, 19], [21, 29]];
const longNoteChannelRanges = [[51, 59], [61, 69]];

const difficultyState = {
  mode: "symbol",
  symbol: "★",
  number: null,
  manualValue: ""
};

const progressMapState = {
  analysis: null,
  paintedMeasures: new Set(),
  savedPaintedMeasures: null,
  isDragging: false
};

const requiredFieldChecks = [
  { name: "譜面ファイル", input: fileInput, isMissing: () => !fileInput.files?.[0] },
  { name: "曲名", input: titleInput, isMissing: () => !titleInput.value.trim() },
  { name: "アーティスト", input: artistInput, isMissing: () => !artistInput.value.trim() },
  { name: "仮差分名", input: chartNameInput, isMissing: () => !chartNameInput.value.trim() },
  { name: "想定難易度", input: difficultyInput, isMissing: () => !difficultyInput.value.trim() },
  { name: "差分作者", input: authorInput, isMissing: () => !authorInput.value.trim() },
  { name: "進捗度", input: progressInput, isMissing: () => !progressInput.value.trim() },
  { name: "管理パスワード", input: passwordInput, isMissing: () => !passwordInput.value.trim() }
];

function setFieldInvalid(input, invalid) {
  input.setAttribute("aria-invalid", invalid ? "true" : "false");

  if (input === difficultyInput) {
    difficultyPicker.setAttribute("aria-invalid", invalid ? "true" : "false");
  }
}

function clearRequiredFieldIndicators() {
  for (const field of requiredFieldChecks) {
    setFieldInvalid(field.input, false);
  }
}

function buildApiUrl(path) {
  return new URL(path, API_BASE_URL).toString();
}

function escapeHtml(value) {
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

function showError(error) {
  const code = error?.code || "REQUEST_FAILED";
  const message = error?.message || "処理に失敗しました。";
  const detail = error?.detail || "ブラウザの開発者ツールで通信状況を確認してください。";

  errorBox.textContent = `code: ${code}\nmessage: ${message}\ndetail: ${detail}`;
  errorBox.hidden = false;
}

function showTextError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function setSubmitting(nextValue) {
  isSubmitting = nextValue;
  submitButton.disabled = nextValue;
  submitButton.textContent = nextValue ? "送信中" : "投稿する";
}

function getExtension(fileName) {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) {
    return "";
  }
  return fileName.slice(dotIndex).toLowerCase();
}

function extractLevelFromDifficulty(difficulty) {
  const value = difficulty.trim();
  if (!value) {
    return "";
  }

  const numericMatch = value.match(/\d{1,2}/);
  return numericMatch ? numericMatch[0] : "";
}

function buildSymbolDifficulty() {
  if (!difficultyState.number) {
    return "";
  }

  return `${difficultyState.symbol}${difficultyState.number}`;
}

function getCurrentDifficultyValue() {
  if (difficultyState.mode === "manual") {
    return difficultyState.manualValue.trim();
  }

  return buildSymbolDifficulty();
}

function updateDifficultyValue() {
  const value = getCurrentDifficultyValue();
  difficultyInput.value = value;
  difficultyPreview.textContent = value || "未選択";

  if (value) {
    setFieldInvalid(difficultyInput, false);
  }
}

function renderDifficultyTabs() {
  for (const tab of difficultyTabs) {
    const mode = tab.dataset.difficultyMode;
    const selected = mode === "manual"
      ? difficultyState.mode === "manual"
      : difficultyState.mode === "symbol" && tab.dataset.symbol === difficultyState.symbol;

    tab.classList.toggle("is-selected", selected);
    tab.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

function renderDifficultyChips() {
  difficultyPicker.classList.toggle("is-manual-mode", difficultyState.mode === "manual");

  if (difficultyState.mode === "manual") {
    difficultyChips.hidden = true;
    difficultyChips.innerHTML = "";
    difficultyManualPanel.hidden = false;
    difficultyManualInput.value = difficultyState.manualValue;
    return;
  }

  difficultyChips.hidden = false;
  difficultyManualPanel.hidden = true;

  const limit = difficultyLimits[difficultyState.symbol];
  difficultyChips.innerHTML = Array.from({ length: maxDifficultyNumber }, (_, index) => {
    const number = index + 1;
    const disabled = number > limit;
    const selected = !disabled && difficultyState.number === number;
    const disabledAttributes = disabled ? " disabled aria-disabled=\"true\"" : " aria-disabled=\"false\"";
    return `<button class="difficulty-chip${selected ? " is-selected" : ""}" type="button" data-number="${number}" aria-pressed="${selected ? "true" : "false"}"${disabledAttributes}>${number}</button>`;
  }).join("");
}

function renderDifficultySelector() {
  renderDifficultyTabs();
  renderDifficultyChips();
  updateDifficultyValue();
}

function selectDifficultyTab(tab) {
  const mode = tab.dataset.difficultyMode;

  if (mode === "manual") {
    if (!difficultyState.manualValue && difficultyState.number) {
      difficultyState.manualValue = buildSymbolDifficulty();
      lastValidManualDifficulty = difficultyState.manualValue;
    }

    difficultyState.mode = "manual";
    renderDifficultySelector();
    difficultyManualInput.focus();
    return;
  }

  const nextSymbol = tab.dataset.symbol;
  const nextLimit = difficultyLimits[nextSymbol];
  difficultyState.mode = "symbol";
  difficultyState.symbol = nextSymbol;

  if (difficultyState.number && difficultyState.number > nextLimit) {
    difficultyState.number = nextLimit;
  }

  renderDifficultySelector();
}

function selectDifficultyNumber(number) {
  if (difficultyState.mode !== "symbol" || number > difficultyLimits[difficultyState.symbol]) {
    return;
  }

  difficultyState.number = number;
  renderDifficultySelector();
}

function hasThreeDigitNumber(value) {
  return /\d{3,}/.test(value);
}

function handleManualDifficultyInput() {
  const nextValue = difficultyManualInput.value;

  if (hasThreeDigitNumber(nextValue)) {
    difficultyManualInput.value = lastValidManualDifficulty;
    return;
  }

  difficultyState.manualValue = nextValue;
  lastValidManualDifficulty = nextValue;
  updateDifficultyValue();
}

function resetDifficultySelector() {
  difficultyState.mode = "symbol";
  difficultyState.symbol = "★";
  difficultyState.number = null;
  difficultyState.manualValue = "";
  lastValidManualDifficulty = "";
  renderDifficultySelector();
}

function decodeBuffer(buffer, encoding) {
  const decoder = new TextDecoder(encoding, { fatal: false });
  return decoder.decode(buffer);
}

function countReplacementCharacters(text) {
  return (text.match(/\uFFFD/g) || []).length;
}

function decodeBmsText(buffer) {
  const utf8Text = decodeBuffer(buffer, "utf-8");
  const shiftJisText = decodeBuffer(buffer, "shift-jis");

  if (countReplacementCharacters(shiftJisText) < countReplacementCharacters(utf8Text)) {
    return shiftJisText;
  }

  return utf8Text;
}

function parseBmsMeta(text) {
  const meta = { title: "", artist: "" };
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const titleMatch = line.match(/^#TITLE\s+(.+)$/i);
    const artistMatch = line.match(/^#ARTIST\s+(.+)$/i);

    if (titleMatch && !meta.title) {
      meta.title = titleMatch[1].trim();
    }

    if (artistMatch && !meta.artist) {
      meta.artist = artistMatch[1].trim();
    }

    if (meta.title && meta.artist) {
      break;
    }
  }

  return meta;
}

function isInChannelRanges(channel, ranges) {
  if (!/^\d{2}$/.test(channel)) {
    return false;
  }

  const numericChannel = Number(channel);
  return ranges.some(([min, max]) => numericChannel >= min && numericChannel <= max);
}

function isNormalPlayNoteChannel(channel) {
  return isInChannelRanges(channel, normalPlayNoteChannelRanges);
}

function isLongNoteChannel(channel) {
  return isInChannelRanges(channel, longNoteChannelRanges);
}

function isPlayNoteChannel(channel) {
  return isNormalPlayNoteChannel(channel) || isLongNoteChannel(channel);
}

function addMeasureNotes(measureCounts, measure, count) {
  if (count <= 0) {
    return;
  }

  measureCounts.set(measure, (measureCounts.get(measure) || 0) + count);
}

function compareLongNoteEvents(a, b) {
  const aPosition = a.measure + a.pairIndex / Math.max(a.pairCount, 1);
  const bPosition = b.measure + b.pairIndex / Math.max(b.pairCount, 1);
  return aPosition - bPosition || a.channel.localeCompare(b.channel);
}

function countLongNoteStarts(events, measureCounts) {
  const activeByChannel = new Map();
  let starts = 0;

  for (const event of [...events].sort(compareLongNoteEvents)) {
    const isActive = activeByChannel.get(event.channel) || false;
    if (!isActive) {
      addMeasureNotes(measureCounts, event.measure, 1);
      starts += 1;
    }

    activeByChannel.set(event.channel, !isActive);
  }

  return starts;
}

function analyzeBmsProgressText(text) {
  const measureCounts = new Map();
  const longNoteEvents = [];
  let playNotes = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    const match = line.match(/^#(\d{3})([0-9A-Za-z]{2}):([0-9A-Za-z]*)/);
    if (!match) {
      continue;
    }

    const [, measureText, channel, data] = match;
    if (!isPlayNoteChannel(channel)) {
      continue;
    }

    const measure = Number(measureText);
    const pairCount = Math.floor(data.length / 2);
    let lineNotes = 0;

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const objectId = data.slice(pairIndex * 2, pairIndex * 2 + 2);
      if (objectId.toUpperCase() === "00") {
        continue;
      }

      if (isLongNoteChannel(channel)) {
        longNoteEvents.push({ measure, channel, pairIndex, pairCount });
      } else {
        lineNotes += 1;
      }
    }

    addMeasureNotes(measureCounts, measure, lineNotes);
    playNotes += lineNotes;
  }

  playNotes += countLongNoteStarts(longNoteEvents, measureCounts);

  const noteMeasures = [...measureCounts.keys()].filter((measure) => (measureCounts.get(measure) || 0) > 0);
  if (noteMeasures.length === 0) {
    return {
      playNotes: 0,
      firstMeasure: null,
      lastMeasure: null,
      targetMeasureCount: 0,
      lnPolicy: "count_start_only",
      measures: []
    };
  }

  const firstMeasure = Math.min(...noteMeasures);
  const lastMeasure = Math.max(...noteMeasures);
  const measures = [];

  for (let measure = firstMeasure; measure <= lastMeasure; measure += 1) {
    measures.push({
      measure,
      playNotes: measureCounts.get(measure) || 0
    });
  }

  return {
    playNotes,
    firstMeasure,
    lastMeasure,
    targetMeasureCount: measures.length,
    lnPolicy: "count_start_only",
    measures
  };
}

function setProgressMapMessage(message, state = "empty") {
  progressMap.dataset.state = state;
  progressMapStatus.textContent = message;
  progressMapStatus.hidden = false;
  progressMapGraphWrap.hidden = true;
  progressMapSummary.hidden = true;
  progressMapBlocks.innerHTML = "";
}

function resetProgressMap(message = "譜面ファイル選択後に進捗マップを表示します") {
  progressMapState.analysis = null;
  progressMapState.paintedMeasures = new Set();
  progressMapState.savedPaintedMeasures = null;
  progressMapState.isDragging = false;
  setProgressMapMessage(message, "empty");
  updateCompleteButtonState();
}

function calculateMapProgress() {
  const analysis = progressMapState.analysis;
  if (!analysis || analysis.targetMeasureCount <= 0) {
    return null;
  }

  return Math.round((progressMapState.paintedMeasures.size / analysis.targetMeasureCount) * 100);
}

function updateProgressSummary(progressValue = calculateMapProgress()) {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    progressMapSummary.hidden = true;
    return;
  }

  progressMapSummary.textContent = `play notes: ${analysis.playNotes} / measures: ${analysis.firstMeasure}-${analysis.lastMeasure} / progress: ${progressValue ?? 0}%`;
  progressMapSummary.hidden = false;
}

function updateCompleteButtonState() {
  const progressValue = Number(progressInput.value);
  const hasMap = Boolean(progressMapState.analysis && progressMapState.analysis.targetMeasureCount > 0);
  completeProgressButton.disabled = !hasMap || isRejectedInput.checked || !Number.isFinite(progressValue) || progressValue < 80 || progressValue >= 100;
}

function updateProgressBlockClasses() {
  const locked = isRejectedInput.checked;
  progressMap.classList.toggle("is-locked", locked);

  progressMapBlocks.querySelectorAll(".progress-map-block").forEach((block) => {
    const measure = Number(block.dataset.measure);
    const painted = progressMapState.paintedMeasures.has(measure);
    block.classList.toggle("is-painted", painted);
    block.setAttribute("aria-pressed", painted ? "true" : "false");
    block.disabled = locked;
  });
}

function updateProgressFromMap({ updateBlocks = true } = {}) {
  const progressValue = isRejectedInput.checked ? 100 : calculateMapProgress();
  if (progressValue === null) {
    updateCompleteButtonState();
    return;
  }

  progressInput.value = String(progressValue);
  setFieldInvalid(progressInput, false);
  updateProgressSummary(progressValue);
  updateCompleteButtonState();

  if (updateBlocks) {
    updateProgressBlockClasses();
  }
}

function getGraphX(index, count, plotLeft, plotWidth) {
  if (count <= 1) {
    return plotLeft + plotWidth / 2;
  }

  return plotLeft + (index / (count - 1)) * plotWidth;
}

function drawProgressGraph() {
  const analysis = progressMapState.analysis;
  if (!analysis || progressMapGraphWrap.hidden) {
    return;
  }

  const canvas = progressMapCanvas;
  const context = canvas.getContext("2d");
  const cssWidth = Math.max(Math.floor(progressMapGraphWrap.clientWidth), 320);
  const cssHeight = progressMapCanvasHeight;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  canvas.style.width = "100%";
  canvas.style.height = `${cssHeight}px`;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, cssWidth, cssHeight);

  const measures = analysis.measures;
  const count = measures.length;
  const maxNotes = Math.max(1, ...measures.map((measure) => measure.playNotes));
  const plotLeft = 28;
  const plotRight = 10;
  const plotTop = 12;
  const plotBottom = 20;
  const plotWidth = cssWidth - plotLeft - plotRight;
  const plotHeight = cssHeight - plotTop - plotBottom;
  const baseY = plotTop + plotHeight;

  context.strokeStyle = "#dce4ea";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(plotLeft, plotTop);
  context.lineTo(plotLeft, baseY);
  context.lineTo(cssWidth - plotRight, baseY);
  context.stroke();

  for (let index = 0; index < count; index += 1) {
    const measure = measures[index].measure;
    if ((measure - analysis.firstMeasure) % 8 !== 0) {
      continue;
    }

    const x = getGraphX(index, count, plotLeft, plotWidth);
    context.strokeStyle = "rgba(0, 0, 0, 0.82)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x, plotTop);
    context.lineTo(x, baseY);
    context.stroke();
  }

  context.strokeStyle = "#256f5d";
  context.lineWidth = 2;
  context.beginPath();

  measures.forEach((measure, index) => {
    const x = getGraphX(index, count, plotLeft, plotWidth);
    const y = baseY - (measure.playNotes / maxNotes) * plotHeight;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();

  context.fillStyle = "#1c5749";
  measures.forEach((measure, index) => {
    const x = getGraphX(index, count, plotLeft, plotWidth);
    const y = baseY - (measure.playNotes / maxNotes) * plotHeight;
    context.beginPath();
    context.arc(x, y, 2.2, 0, Math.PI * 2);
    context.fill();
  });
}

function renderProgressBlocks() {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    progressMapBlocks.innerHTML = "";
    return;
  }

  const count = analysis.measures.length;
  progressMapBlocks.innerHTML = analysis.measures.map((measure, index) => {
    const left = (index / count) * 100;
    const width = 100 / count;
    const isBarline = (measure.measure - analysis.firstMeasure) % 8 === 0;
    const classes = ["progress-map-block", isBarline ? "is-barline" : ""].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" data-measure="${measure.measure}" aria-pressed="false" aria-label="${measure.measure}小節 ${measure.playNotes} notes" style="left:${left}%;width:${width}%;"></button>`;
  }).join("");

  updateProgressBlockClasses();
}

function renderProgressMap() {
  const analysis = progressMapState.analysis;
  if (!analysis || analysis.targetMeasureCount <= 0) {
    setProgressMapMessage("プレイノートを検出できませんでした", "unavailable");
    return;
  }

  progressMap.dataset.state = "ready";
  progressMapStatus.hidden = true;
  progressMapGraphWrap.hidden = false;
  progressMapSummary.hidden = false;
  renderProgressBlocks();
  drawProgressGraph();
  updateProgressFromMap();
}

function initializeProgressMap(analysis) {
  progressMapState.analysis = analysis;
  progressMapState.paintedMeasures = new Set();
  progressMapState.savedPaintedMeasures = null;

  if (isRejectedInput.checked) {
    for (const measure of analysis.measures) {
      progressMapState.paintedMeasures.add(measure.measure);
    }
  }

  renderProgressMap();
}

function paintProgressMeasure(measure) {
  if (!progressMapState.analysis || isRejectedInput.checked || !Number.isFinite(measure)) {
    return;
  }

  progressMapState.paintedMeasures.add(measure);
  updateProgressFromMap();
}

function findProgressBlockFromPointer(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  return element?.closest?.(".progress-map-block") || null;
}

function paintAllProgressMeasures() {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    return;
  }

  progressMapState.paintedMeasures = new Set(analysis.measures.map((measure) => measure.measure));
  progressInput.value = "100";
  setFieldInvalid(progressInput, false);
  updateProgressSummary(100);
  updateProgressBlockClasses();
  updateCompleteButtonState();
}

function applyRejectedProgressMapState() {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    updateCompleteButtonState();
    return;
  }

  if (isRejectedInput.checked) {
    if (!progressMapState.savedPaintedMeasures) {
      progressMapState.savedPaintedMeasures = new Set(progressMapState.paintedMeasures);
    }
    paintAllProgressMeasures();
    return;
  }

  if (progressMapState.savedPaintedMeasures) {
    progressMapState.paintedMeasures = new Set(progressMapState.savedPaintedMeasures);
    progressMapState.savedPaintedMeasures = null;
  }

  updateProgressFromMap();
}

async function fillMetaFromFile(file) {
  const extension = getExtension(file.name);

  if (!allowedChartExtensions.has(extension)) {
    showTextError("投稿対象は .bms .bme .bml .zip のみです。");
    fileInput.value = "";
    resetProgressMap();
    setFieldInvalid(fileInput, true);
    return;
  }

  setFieldInvalid(fileInput, false);

  if (!readableChartExtensions.has(extension)) {
    clearError();
    setProgressMapMessage("単体BMSのみ進捗マップを表示します", "unavailable");
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const text = decodeBmsText(buffer);
    const meta = parseBmsMeta(text);
    const analysis = analyzeBmsProgressText(text);

    if (meta.title) {
      titleInput.value = meta.title;
      setFieldInvalid(titleInput, false);
    }

    if (meta.artist) {
      artistInput.value = meta.artist;
      setFieldInvalid(artistInput, false);
    }

    if (analysis.targetMeasureCount > 0) {
      initializeProgressMap(analysis);
    } else {
      setProgressMapMessage("プレイノートを検出できませんでした", "unavailable");
    }

    clearError();
  } catch (error) {
    console.error("[file-meta-read] failed to read chart metadata", {
      code: "TITLE_ARTIST_PARSE_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
    console.error("[progress-map-analysis] failed to analyze progress map", {
      code: "PROGRESS_MAP_ANALYSIS_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
    setProgressMapMessage("BMS解析に失敗しました", "unavailable");
    showTextError("譜面情報の読み取りに失敗しました。曲名とアーティストは手入力してください。");
  }
}

function isValidProgress(value) {
  if (value.trim() === "") {
    return false;
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 100;
}

function validateProgress() {
  if (isRejectedInput.checked) {
    progressInput.value = "100";
  }

  const valid = isValidProgress(progressInput.value);
  setFieldInvalid(progressInput, !valid);

  if (!valid) {
    showTextError("進捗度は0から100までの整数で入力してください。");
    return false;
  }

  clearError();
  updateCompleteButtonState();
  return true;
}

function validateRequiredFields() {
  const missingFields = [];

  for (const field of requiredFieldChecks) {
    const missing = field.isMissing();
    setFieldInvalid(field.input, missing);

    if (missing) {
      missingFields.push(field.name);
    }
  }

  if (missingFields.length > 0) {
    showTextError(`未入力の項目があります: ${missingFields.join(", ")}`);
    return false;
  }

  return true;
}

function applyRejectedProgressState() {
  if (isRejectedInput.checked) {
    progressInput.value = "100";
    progressInput.readOnly = true;
    progressInput.classList.add("readonly-input");
    progressInput.setAttribute("aria-readonly", "true");
    setFieldInvalid(progressInput, false);
    return;
  }

  progressInput.readOnly = false;
  progressInput.classList.remove("readonly-input");
  progressInput.removeAttribute("aria-readonly");
}

function loadSavedPassword() {
  try {
    const savedPassword = localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (savedPassword) {
      passwordInput.value = savedPassword;
      savePasswordInput.checked = true;
    }
  } catch (error) {
    console.error("[password-storage-load] failed to load saved password", {
      code: "LOCAL_STORAGE_READ_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function persistPasswordPreference() {
  try {
    if (savePasswordInput.checked && passwordInput.value) {
      localStorage.setItem(PASSWORD_STORAGE_KEY, passwordInput.value);
      return;
    }

    localStorage.removeItem(PASSWORD_STORAGE_KEY);
  } catch (error) {
    console.error("[password-storage-save] failed to save password preference", {
      code: "LOCAL_STORAGE_WRITE_FAILED",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw {
      code: "INVALID_JSON_RESPONSE",
      message: "APIレスポンスの解析に失敗しました。",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(buildApiUrl(path), options);
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw body || {
      code: "HTTP_ERROR",
      message: "APIリクエストに失敗しました。",
      detail: `HTTP status ${response.status}`
    };
  }

  return body;
}

function buildDownloadUrl(downloadUrl) {
  if (!downloadUrl) {
    return "";
  }

  return new URL(downloadUrl, API_BASE_URL).toString();
}

function renderLoading() {
  chartList.innerHTML = `<div class="list-status">読み込み中</div>`;
}

function renderEmpty() {
  chartList.innerHTML = `<div class="list-status">投稿はまだありません。</div>`;
}

function renderCharts(data) {
  const charts = Array.isArray(data?.charts) ? data.charts : [];

  if (charts.length === 0) {
    renderEmpty();
    return;
  }

  chartList.innerHTML = charts.map((entry) => {
    const song = entry.song || {};
    const chart = entry.chart || {};
    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    const rows = versions.map((version) => {
      const difficulty = version.difficulty || "未入力";
      const progress = Number.isFinite(Number(version.progress)) ? Number(version.progress) : 0;
      const downloadHref = buildDownloadUrl(version.file?.downloadUrl);
      const rejectedBadge = version.isRejected ? `<span class="rejected-badge">没譜面</span>` : "";
      const downloadControl = downloadHref
        ? `<a href="${escapeHtml(downloadHref)}">DL</a>`
        : `<span class="download-disabled">DL不可</span>`;

      return `
        <div class="version-row">
          <div class="version-tag">${escapeHtml(version.displayVersion || "ver?.?")}</div>
          <div class="meta-block">
            <span class="meta-label">想定難易度</span>
            <span class="meta-value">${escapeHtml(difficulty)}</span>
          </div>
          <div class="meta-block">
            <span class="meta-label">差分作者</span>
            <span class="meta-value">${escapeHtml(version.author || "未入力")}</span>
          </div>
          <div class="meta-block">
            <span class="meta-label">進捗度</span>
            <span class="progress-pill">${escapeHtml(progress)}%</span>
            ${rejectedBadge}
          </div>
          <div class="meta-block">
            <span class="meta-label">コメント</span>
            <span class="meta-value">${escapeHtml(version.comment || "")}</span>
          </div>
          <div class="version-actions">
            ${downloadControl}
            <button class="secondary" type="button" disabled>追記投稿</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <article class="chart-group">
        <div class="chart-title-row">
          <h3>${escapeHtml(song.title || "無題")}</h3>
          <span class="artist-separator">/</span>
          <span class="chart-artist">${escapeHtml(song.artist || "Unknown Artist")}</span>
          <span class="chart-name-badge">${escapeHtml(chart.name || "差分名未入力")}</span>
        </div>
        <div class="version-list">${rows || `<div class="list-status">表示できるversionがありません。</div>`}</div>
      </article>
    `;
  }).join("");
}

async function loadCharts() {
  renderLoading();

  try {
    const data = await apiRequest("/api/charts?page=1&pageSize=100");
    renderCharts(data);
  } catch (error) {
    console.error("[api-charts-list] failed to load charts", {
      code: error?.code || "CHARTS_LIST_FAILED",
      message: error?.detail || error?.message || String(error)
    });
    chartList.innerHTML = `<div class="list-status">一覧を読み込めませんでした。</div>`;
    showError(error);
  }
}

function buildChartFormData() {
  const file = fileInput.files?.[0];
  const difficulty = difficultyInput.value.trim();
  const formData = new FormData();

  formData.append("file", file);
  formData.append("title", titleInput.value.trim());
  formData.append("subtitle", subtitleInput.value.trim());
  formData.append("artist", artistInput.value.trim());
  formData.append("subartist", subartistInput.value.trim());
  formData.append("chartName", chartNameInput.value.trim());
  formData.append("difficulty", difficulty);
  formData.append("level", extractLevelFromDifficulty(difficulty));
  formData.append("author", authorInput.value.trim());
  formData.append("progress", isRejectedInput.checked ? "100" : progressInput.value.trim());
  formData.append("comment", commentInput.value.trim());
  formData.append("isRejected", isRejectedInput.checked ? "true" : "false");
  formData.append("password", passwordInput.value);

  return formData;
}

async function submitChart() {
  if (isSubmitting) {
    return;
  }

  if (!validateRequiredFields() || !validateProgress()) {
    return;
  }

  setSubmitting(true);
  clearError();

  try {
    persistPasswordPreference();
    await apiRequest("/api/charts", {
      method: "POST",
      body: buildChartFormData()
    });

    const savedPassword = passwordInput.value;
    const shouldRestorePassword = savePasswordInput.checked;
    form.reset();
    clearRequiredFieldIndicators();
    resetDifficultySelector();
    resetProgressMap();
    progressInput.value = "100";
    if (shouldRestorePassword) {
      passwordInput.value = savedPassword;
      savePasswordInput.checked = true;
    }
    applyRejectedProgressState();
    await loadCharts();
  } catch (error) {
    console.error("[api-chart-create] failed to create chart", {
      code: error?.code || "CHART_CREATE_FAILED",
      message: error?.detail || error?.message || String(error)
    });
    showError(error);
  } finally {
    setSubmitting(false);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (!file) {
    setFieldInvalid(fileInput, false);
    resetProgressMap();
    clearError();
    return;
  }

  fillMetaFromFile(file);
});

for (const field of requiredFieldChecks) {
  const eventName = field.input === fileInput ? "change" : "input";
  field.input.addEventListener(eventName, () => {
    if (!field.isMissing()) {
      setFieldInvalid(field.input, false);
    }
  });
}

difficultyTabs.forEach((tab) => {
  tab.addEventListener("click", () => selectDifficultyTab(tab));
});

difficultyChips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-number]");
  if (!button) {
    return;
  }

  selectDifficultyNumber(Number(button.dataset.number));
});

difficultyManualInput.addEventListener("input", handleManualDifficultyInput);

progressInput.addEventListener("input", () => {
  if (progressInput.getAttribute("aria-invalid") === "true") {
    validateProgress();
  }

  updateCompleteButtonState();
});

isRejectedInput.addEventListener("change", () => {
  applyRejectedProgressState();
  applyRejectedProgressMapState();
  clearError();
});

progressMapBlocks.addEventListener("pointerdown", (event) => {
  const block = event.target.closest(".progress-map-block");
  if (!block) {
    return;
  }

  event.preventDefault();
  progressMapState.isDragging = true;
  progressMapBlocks.setPointerCapture?.(event.pointerId);
  paintProgressMeasure(Number(block.dataset.measure));
});

progressMapBlocks.addEventListener("pointermove", (event) => {
  if (!progressMapState.isDragging) {
    return;
  }

  const block = findProgressBlockFromPointer(event);
  if (block) {
    paintProgressMeasure(Number(block.dataset.measure));
  }
});

progressMapBlocks.addEventListener("pointerup", () => {
  progressMapState.isDragging = false;
});

progressMapBlocks.addEventListener("pointercancel", () => {
  progressMapState.isDragging = false;
});

completeProgressButton.addEventListener("click", () => {
  paintAllProgressMeasures();
});

window.addEventListener("resize", () => {
  drawProgressGraph();
});

savePasswordInput.addEventListener("change", persistPasswordPreference);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitChart();
});

loadSavedPassword();
resetDifficultySelector();
resetProgressMap();
applyRejectedProgressState();
loadCharts();
