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
const densityCanvasHeight = 120;
const defaultBpm = 130;
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
  paintedBlockIndexes: new Set(),
  savedPaintedBlockIndexes: null,
  isDragging: false,
  dragAction: null
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

function parseNumber(value) {
  const numberValue = Number.parseFloat(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function splitDataObjects(data) {
  const pairs = [];
  const cleanData = data.trim();
  const pairCount = Math.floor(cleanData.length / 2);

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const objectId = cleanData.slice(pairIndex * 2, pairIndex * 2 + 2).toUpperCase();
    if (objectId !== "00") {
      pairs.push({ objectId, pairIndex, pairCount });
    }
  }

  return pairs;
}

function getMeasureLength(measure, measureLengths) {
  const value = measureLengths.get(measure);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function buildMeasureStarts(maxMeasure, measureLengths) {
  const starts = [];
  let position = 0;

  for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
    starts[measure] = position;
    position += getMeasureLength(measure, measureLengths);
  }

  return starts;
}

function getStandardPosition(event, measureStarts, measureLengths) {
  return measureStarts[event.measure] + event.fraction * getMeasureLength(event.measure, measureLengths);
}

function positionToMeasure(standardPosition, measureStarts, measureLengths, maxMeasure) {
  for (let measure = 0; measure <= maxMeasure; measure += 1) {
    const start = measureStarts[measure];
    const end = start + getMeasureLength(measure, measureLengths);
    if (standardPosition >= start && standardPosition < end) {
      return measure;
    }
  }

  return maxMeasure;
}

function addMeasureNotes(measureCounts, measure, count) {
  if (count <= 0) {
    return;
  }

  measureCounts.set(measure, (measureCounts.get(measure) || 0) + count);
}

function comparePlayEvents(a, b) {
  return a.standardPosition - b.standardPosition || a.channel.localeCompare(b.channel);
}

function collectLongNoteStarts(longNoteEvents, measureCounts) {
  const activeByChannel = new Map();
  const starts = [];

  for (const event of [...longNoteEvents].sort(comparePlayEvents)) {
    const isActive = activeByChannel.get(event.channel) || false;
    if (!isActive) {
      starts.push({ ...event });
      addMeasureNotes(measureCounts, event.measure, 1);
    }

    activeByChannel.set(event.channel, !isActive);
  }

  return starts;
}

function addTimelineEvent(eventsByMeasure, event) {
  const events = eventsByMeasure.get(event.measure) || [];
  events.push(event);
  eventsByMeasure.set(event.measure, events);
}

function getEventPriority(event) {
  if (event.kind === "bpm") {
    return 0;
  }

  if (event.kind === "stop") {
    return 1;
  }

  return 2;
}

function applyTimingToNotes(playEvents, timingEvents, maxMeasure, measureLengths, initialBpm) {
  const eventsByMeasure = new Map();

  for (const event of timingEvents) {
    addTimelineEvent(eventsByMeasure, event);
  }

  for (const event of playEvents) {
    addTimelineEvent(eventsByMeasure, { ...event, kind: "note", noteRef: event });
  }

  let currentBpm = Number.isFinite(initialBpm) && initialBpm > 0 ? initialBpm : defaultBpm;
  let timeSec = 0;

  for (let measure = 0; measure <= maxMeasure; measure += 1) {
    const measureLength = getMeasureLength(measure, measureLengths);
    const events = (eventsByMeasure.get(measure) || [])
      .filter((event) => Number.isFinite(event.fraction))
      .sort((a, b) => a.fraction - b.fraction || getEventPriority(a) - getEventPriority(b));
    let lastFraction = 0;

    for (const event of events) {
      const fraction = Math.min(Math.max(event.fraction, 0), 1);
      const deltaBeats = Math.max(0, fraction - lastFraction) * measureLength * 4;
      timeSec += deltaBeats * 60 / currentBpm;
      lastFraction = Math.max(lastFraction, fraction);

      if (event.kind === "bpm" && Number.isFinite(event.value) && event.value > 0) {
        currentBpm = event.value;
      } else if (event.kind === "stop" && Number.isFinite(event.value) && event.value > 0) {
        timeSec += (event.value / 192) * 4 * 60 / currentBpm;
      } else if (event.kind === "note" && event.noteRef) {
        event.noteRef.timeSec = timeSec;
      }
    }

    const restBeats = Math.max(0, 1 - lastFraction) * measureLength * 4;
    timeSec += restBeats * 60 / currentBpm;
  }
}

function buildDensityBins(playEvents) {
  const timedEvents = playEvents.filter((event) => Number.isFinite(event.timeSec));

  if (timedEvents.length === 0) {
    return [];
  }

  const firstTimeSec = Math.min(...timedEvents.map((event) => event.timeSec));
  const lastTimeSec = Math.max(...timedEvents.map((event) => event.timeSec));
  const binCount = Math.max(1, Math.floor(lastTimeSec - firstTimeSec) + 1);
  const bins = Array.from({ length: binCount }, (_, second) => ({ second, playNotes: 0 }));

  for (const event of timedEvents) {
    const second = Math.min(binCount - 1, Math.max(0, Math.floor(event.timeSec - firstTimeSec)));
    bins[second].playNotes += 1;
  }

  return bins;
}

function buildStandardBlocks(playEvents, measureStarts, measureLengths, maxMeasure) {
  if (playEvents.length === 0) {
    return [];
  }

  const firstStandardPosition = Math.min(...playEvents.map((event) => event.standardPosition));
  const lastStandardPosition = Math.max(...playEvents.map((event) => event.standardPosition));
  const firstBlockPosition = Math.floor(firstStandardPosition);
  const lastBlockPosition = Math.floor(lastStandardPosition);
  const blockCount = Math.max(1, lastBlockPosition - firstBlockPosition + 1);

  return Array.from({ length: blockCount }, (_, index) => {
    const startPosition = firstBlockPosition + index;
    const endPosition = startPosition + 1;
    const blockNotes = playEvents.filter((event) => event.standardPosition >= startPosition && event.standardPosition < endPosition);

    return {
      index,
      startMeasure: positionToMeasure(startPosition, measureStarts, measureLengths, maxMeasure),
      endMeasure: positionToMeasure(endPosition - 0.000001, measureStarts, measureLengths, maxMeasure),
      startStandardPosition: startPosition,
      endStandardPosition: endPosition,
      playNotes: blockNotes.length
    };
  });
}

function analyzeBmsProgressText(text) {
  const bpmDefinitions = new Map();
  const stopDefinitions = new Map();
  const measureLengths = new Map();
  const measureCounts = new Map();
  const normalNoteEvents = [];
  const longNoteEvents = [];
  const timingEvents = [];
  let initialBpm = defaultBpm;
  let maxMeasure = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (!line) {
      continue;
    }

    const indexedBpmMatch = line.match(/^#BPM([0-9A-Za-z]{2})\s+([0-9.]+)$/i);
    if (indexedBpmMatch) {
      const bpm = parseNumber(indexedBpmMatch[2]);
      if (bpm && bpm > 0) {
        bpmDefinitions.set(indexedBpmMatch[1].toUpperCase(), bpm);
      }
      continue;
    }

    const baseBpmMatch = line.match(/^#BPM\s+([0-9.]+)$/i);
    if (baseBpmMatch) {
      const bpm = parseNumber(baseBpmMatch[1]);
      if (bpm && bpm > 0) {
        initialBpm = bpm;
      }
      continue;
    }

    const stopMatch = line.match(/^#STOP([0-9A-Za-z]{2})\s+([0-9.]+)$/i);
    if (stopMatch) {
      const stopValue = parseNumber(stopMatch[2]);
      if (stopValue && stopValue > 0) {
        stopDefinitions.set(stopMatch[1].toUpperCase(), stopValue);
      }
      continue;
    }

    const dataMatch = line.match(/^#(\d{3})([0-9A-Za-z]{2}):(.+)$/);
    if (!dataMatch) {
      continue;
    }

    const measure = Number(dataMatch[1]);
    const channel = dataMatch[2].toUpperCase();
    const data = dataMatch[3].trim();
    maxMeasure = Math.max(maxMeasure, measure);

    if (channel === "02") {
      const length = parseNumber(data);
      if (length && length > 0) {
        measureLengths.set(measure, length);
      }
      continue;
    }

    const pairs = splitDataObjects(data);
    if (pairs.length === 0) {
      continue;
    }

    for (const pair of pairs) {
      const fraction = pair.pairCount > 0 ? pair.pairIndex / pair.pairCount : 0;

      if (channel === "03") {
        const bpm = Number.parseInt(pair.objectId, 16);
        if (Number.isFinite(bpm) && bpm > 0) {
          timingEvents.push({ kind: "bpm", measure, fraction, value: bpm });
        }
        continue;
      }

      if (channel === "08") {
        const bpm = bpmDefinitions.get(pair.objectId);
        if (bpm && bpm > 0) {
          timingEvents.push({ kind: "bpm", measure, fraction, value: bpm });
        }
        continue;
      }

      if (channel === "09") {
        const stopValue = stopDefinitions.get(pair.objectId);
        if (stopValue && stopValue > 0) {
          timingEvents.push({ kind: "stop", measure, fraction, value: stopValue });
        }
        continue;
      }

      if (!isPlayNoteChannel(channel)) {
        continue;
      }

      const event = { measure, channel, fraction, pairIndex: pair.pairIndex, pairCount: pair.pairCount };
      if (isLongNoteChannel(channel)) {
        longNoteEvents.push(event);
      } else {
        normalNoteEvents.push(event);
        addMeasureNotes(measureCounts, measure, 1);
      }
    }
  }

  const measureStarts = buildMeasureStarts(maxMeasure, measureLengths);
  const preparedNormalNotes = normalNoteEvents.map((event) => ({
    ...event,
    standardPosition: getStandardPosition(event, measureStarts, measureLengths)
  }));
  const preparedLongNotes = longNoteEvents.map((event) => ({
    ...event,
    standardPosition: getStandardPosition(event, measureStarts, measureLengths)
  }));
  const playEvents = [...preparedNormalNotes, ...collectLongNoteStarts(preparedLongNotes, measureCounts)]
    .sort(comparePlayEvents);

  if (playEvents.length === 0) {
    return {
      playNotes: 0,
      firstMeasure: null,
      lastMeasure: null,
      targetMeasureCount: 0,
      blockMode: "standardized_measure",
      lnPolicy: "count_start_only",
      densityBins: [],
      standardBlocks: [],
      fallback: false
    };
  }

  try {
    applyTimingToNotes(playEvents, timingEvents, maxMeasure, measureLengths, initialBpm);
  } catch (error) {
    console.error("[progress-map-timing] failed to estimate note timing", {
      code: "PROGRESS_MAP_TIMING_FALLBACK",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const firstStandardPosition = Math.min(...playEvents.map((event) => event.standardPosition));
  for (const event of playEvents) {
    if (!Number.isFinite(event.timeSec)) {
      event.timeSec = (event.standardPosition - firstStandardPosition) * 2;
    }
  }

  const standardBlocks = buildStandardBlocks(playEvents, measureStarts, measureLengths, maxMeasure);
  const firstMeasure = Math.min(...playEvents.map((event) => event.measure));
  const lastMeasure = Math.max(...playEvents.map((event) => event.measure));

  return {
    playNotes: playEvents.length,
    firstMeasure,
    lastMeasure,
    targetMeasureCount: standardBlocks.length,
    blockMode: "standardized_measure",
    lnPolicy: "count_start_only",
    densityBins: buildDensityBins(playEvents),
    standardBlocks,
    fallback: false
  };
}

function setProgressMapMessage(message, state = "empty") {
  progressMapState.analysis = null;
  progressMapState.paintedBlockIndexes = new Set();
  progressMapState.savedPaintedBlockIndexes = null;
  progressMapState.isDragging = false;
  progressMapState.dragAction = null;
  progressMap.dataset.state = state;
  progressMapStatus.textContent = message;
  progressMapStatus.hidden = false;
  progressMapGraphWrap.hidden = true;
  progressMapSummary.hidden = true;
  progressMapBlocks.innerHTML = "";
  progressMapBlocks.style.removeProperty("grid-template-columns");
  updateCompleteButtonState();
}

function resetProgressMap(message = "譜面ファイル選択後に進捗マップを表示します") {
  setProgressMapMessage(message, "empty");
}

function calculateMapProgress() {
  const analysis = progressMapState.analysis;
  if (!analysis || analysis.standardBlocks.length === 0) {
    return null;
  }

  return Math.round((progressMapState.paintedBlockIndexes.size / analysis.standardBlocks.length) * 100);
}

function updateProgressSummary(progressValue = calculateMapProgress()) {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    progressMapSummary.hidden = true;
    return;
  }

  const measureText = analysis.firstMeasure === null || analysis.lastMeasure === null
    ? ""
    : ` / measures: ${analysis.firstMeasure}-${analysis.lastMeasure}`;
  progressMapSummary.textContent = `play notes: ${analysis.playNotes} / blocks: ${analysis.standardBlocks.length} / progress: ${progressValue ?? 0}%${measureText}`;
  progressMapSummary.hidden = false;
}

function updateCompleteButtonState() {
  const progressValue = Number(progressInput.value);
  const hasMap = Boolean(progressMapState.analysis && progressMapState.analysis.standardBlocks.length > 0);
  completeProgressButton.disabled = !hasMap || isRejectedInput.checked || !Number.isFinite(progressValue) || progressValue < 80 || progressValue >= 100;
}

function updateProgressBlockClasses() {
  const locked = isRejectedInput.checked;
  progressMap.classList.toggle("is-locked", locked);

  progressMapBlocks.querySelectorAll(".progress-map-block").forEach((block) => {
    const blockIndex = Number(block.dataset.blockIndex);
    const painted = progressMapState.paintedBlockIndexes.has(blockIndex);
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

function drawDensityChart() {
  const analysis = progressMapState.analysis;
  if (!analysis || progressMapGraphWrap.hidden) {
    return;
  }

  const canvas = progressMapCanvas;
  const context = canvas.getContext("2d");
  const cssWidth = Math.max(Math.floor(canvas.parentElement.clientWidth), 320);
  const cssHeight = densityCanvasHeight;
  const ratio = window.devicePixelRatio || 1;

  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  canvas.style.width = "100%";
  canvas.style.height = `${cssHeight}px`;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, cssWidth, cssHeight);

  const bins = analysis.densityBins.length > 0
    ? analysis.densityBins
    : [{ second: 0, playNotes: 0 }];
  const maxNotes = Math.max(1, ...bins.map((bin) => bin.playNotes));
  const plotLeft = 10;
  const plotRight = 10;
  const plotTop = 10;
  const plotBottom = 16;
  const plotWidth = cssWidth - plotLeft - plotRight;
  const plotHeight = cssHeight - plotTop - plotBottom;
  const baseY = plotTop + plotHeight;
  const barSlot = plotWidth / bins.length;
  const barWidth = Math.max(1, Math.min(10, barSlot * 0.78));

  context.strokeStyle = "#dce4ea";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(plotLeft, baseY + 0.5);
  context.lineTo(cssWidth - plotRight, baseY + 0.5);
  context.stroke();

  context.fillStyle = "rgba(42, 128, 116, 0.46)";
  for (const bin of bins) {
    const x = plotLeft + bin.second * barSlot + (barSlot - barWidth) / 2;
    const height = Math.max(bin.playNotes > 0 ? 2 : 0, (bin.playNotes / maxNotes) * plotHeight);
    const y = baseY - height;
    context.fillRect(x, y, barWidth, height);
  }
}

function renderProgressBlocks() {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    progressMapBlocks.innerHTML = "";
    progressMapBlocks.style.removeProperty("grid-template-columns");
    return;
  }

  const blocks = analysis.standardBlocks;
  progressMapBlocks.style.gridTemplateColumns = `repeat(${blocks.length}, minmax(4px, 1fr))`;
  progressMapBlocks.innerHTML = blocks.map((block) => {
    const isBarline = block.index % 8 === 0;
    const classes = ["progress-map-block", isBarline ? "is-barline" : ""].filter(Boolean).join(" ");
    const measureRange = block.startMeasure === block.endMeasure
      ? `${block.startMeasure}`
      : `${block.startMeasure}-${block.endMeasure}`;
    return `<button class="${classes}" type="button" data-block-index="${block.index}" aria-pressed="false" aria-label="block ${block.index + 1}, measures ${measureRange}, ${block.playNotes} notes"></button>`;
  }).join("");

  updateProgressBlockClasses();
}

function renderProgressMap() {
  const analysis = progressMapState.analysis;
  if (!analysis || analysis.standardBlocks.length === 0) {
    setProgressMapMessage("プレイノートを検出できませんでした", "unavailable");
    return;
  }

  progressMap.dataset.state = "ready";
  progressMapStatus.hidden = true;
  progressMapGraphWrap.hidden = false;
  progressMapSummary.hidden = false;
  renderProgressBlocks();
  drawDensityChart();
  updateProgressFromMap();
}

function initializeProgressMap(analysis) {
  progressMapState.analysis = analysis;
  progressMapState.paintedBlockIndexes = new Set();
  progressMapState.savedPaintedBlockIndexes = null;
  progressMapState.isDragging = false;
  progressMapState.dragAction = null;

  if (isRejectedInput.checked) {
    for (const block of analysis.standardBlocks) {
      progressMapState.paintedBlockIndexes.add(block.index);
    }
  }

  renderProgressMap();
}

function applyPaintAction(blockIndex, action) {
  if (!progressMapState.analysis || isRejectedInput.checked || !Number.isFinite(blockIndex)) {
    return;
  }

  if (action === "erase") {
    progressMapState.paintedBlockIndexes.delete(blockIndex);
  } else {
    progressMapState.paintedBlockIndexes.add(blockIndex);
  }

  updateProgressFromMap();
}

function findProgressBlockFromPointer(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  return element?.closest?.(".progress-map-block") || null;
}

function paintAllProgressBlocks() {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    return;
  }

  progressMapState.paintedBlockIndexes = new Set(analysis.standardBlocks.map((block) => block.index));
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
    if (!progressMapState.savedPaintedBlockIndexes) {
      progressMapState.savedPaintedBlockIndexes = new Set(progressMapState.paintedBlockIndexes);
    }
    paintAllProgressBlocks();
    return;
  }

  if (progressMapState.savedPaintedBlockIndexes) {
    progressMapState.paintedBlockIndexes = new Set(progressMapState.savedPaintedBlockIndexes);
    progressMapState.savedPaintedBlockIndexes = null;
  }

  updateProgressFromMap();
}

async function fillMetaFromFile(file) {
  const extension = getExtension(file.name);
  resetProgressMap();

  if (!allowedChartExtensions.has(extension)) {
    showTextError("投稿対象は .bms .bme .bml .zip のみです。");
    fileInput.value = "";
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

    if (analysis.standardBlocks.length > 0) {
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
  const blockIndex = Number(block.dataset.blockIndex);
  const wasPainted = progressMapState.paintedBlockIndexes.has(blockIndex);
  progressMapState.isDragging = true;
  progressMapState.dragAction = wasPainted ? "erase" : "paint";
  progressMapBlocks.setPointerCapture?.(event.pointerId);
  applyPaintAction(blockIndex, progressMapState.dragAction);
});

progressMapBlocks.addEventListener("pointermove", (event) => {
  if (!progressMapState.isDragging || !progressMapState.dragAction) {
    return;
  }

  const block = findProgressBlockFromPointer(event);
  if (block) {
    applyPaintAction(Number(block.dataset.blockIndex), progressMapState.dragAction);
  }
});

progressMapBlocks.addEventListener("pointerup", () => {
  progressMapState.isDragging = false;
  progressMapState.dragAction = null;
});

progressMapBlocks.addEventListener("pointercancel", () => {
  progressMapState.isDragging = false;
  progressMapState.dragAction = null;
});

completeProgressButton.addEventListener("click", () => {
  paintAllProgressBlocks();
});

window.addEventListener("resize", () => {
  drawDensityChart();
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
