const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
const PASSWORD_STORAGE_KEY = "bms-wip-charts-admin-password";

const allowedChartExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);

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
const originUrlInput = document.querySelector("#originUrl");
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
const errorBox = document.querySelector("#errorBox");
const chartList = document.querySelector("#chartList");
const chartSearchForm = document.querySelector("#chartSearchForm");
const chartSearchInput = document.querySelector("#chartSearchInput");
const chartSearchClearButton = document.querySelector("#chartSearchClearButton");
const chartSearchSummary = document.querySelector("#chartSearchSummary");
const chartListFeedback = document.querySelector("#chartListFeedback");
const loadMoreChartsButton = document.querySelector("#loadMoreChartsButton");

let isSubmitting = false;
let lastValidManualDifficulty = "";
let initialFileAnalysisRevision = 0;

const chartPageSize = 20;
const maxChartSearchLength = 100;
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
  layerKind: "initial",
  isDragging: false,
  dragAnchorIndex: null,
  dragCurrentIndex: null,
  dragMode: null,
  originalPaintedBlockIndexes: null
};

const chartListState = {
  query: readChartQueryFromUrl(),
  page: 0,
  pageSize: chartPageSize,
  total: 0,
  hasNext: false,
  charts: [],
  loading: false,
  loadingMore: false,
  loadMoreFailed: false,
  requestSequence: 0,
  abortController: null
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
  const meta = { title: "", subtitle: "", artist: "", subartist: "" };
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const titleMatch = line.match(/^#TITLE\s+(.+)$/i);
    const subtitleMatch = line.match(/^#SUBTITLE\s+(.+)$/i);
    const artistMatch = line.match(/^#ARTIST\s+(.+)$/i);
    const subartistMatch = line.match(/^#SUBARTIST\s+(.+)$/i);

    if (titleMatch && !meta.title) {
      meta.title = titleMatch[1].trim();
    }

    if (subtitleMatch && !meta.subtitle) {
      meta.subtitle = subtitleMatch[1].trim();
    }

    if (artistMatch && !meta.artist) {
      meta.artist = artistMatch[1].trim();
    }

    if (subartistMatch && !meta.subartist) {
      meta.subartist = subartistMatch[1].trim();
    }

    if (meta.title && meta.subtitle && meta.artist && meta.subartist) {
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

function estimateTimeForPosition(standardPosition, playEvents) {
  const timedEvents = playEvents
    .filter((event) => Number.isFinite(event.standardPosition) && Number.isFinite(event.timeSec))
    .sort(comparePlayEvents);

  if (timedEvents.length === 0) {
    return null;
  }

  const firstEvent = timedEvents[0];
  const lastEvent = timedEvents[timedEvents.length - 1];

  if (standardPosition <= firstEvent.standardPosition) {
    return firstEvent.timeSec;
  }

  if (standardPosition >= lastEvent.standardPosition) {
    return lastEvent.timeSec;
  }

  for (let index = 1; index < timedEvents.length; index += 1) {
    const previous = timedEvents[index - 1];
    const next = timedEvents[index];
    if (standardPosition <= next.standardPosition) {
      const positionSpan = next.standardPosition - previous.standardPosition;
      if (positionSpan <= 0) {
        return next.timeSec;
      }

      const ratio = (standardPosition - previous.standardPosition) / positionSpan;
      return previous.timeSec + (next.timeSec - previous.timeSec) * ratio;
    }
  }

  return lastEvent.timeSec;
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
      startPosition,
      endPosition,
      startTimeSec: estimateTimeForPosition(startPosition, playEvents),
      endTimeSec: estimateTimeForPosition(endPosition, playEvents),
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

function formatMeasureNumber(measure) {
  if (!Number.isFinite(Number(measure))) {
    return "---";
  }

  return String(Number(measure)).padStart(3, "0");
}

function formatMeasureRange(block) {
  if (!block) {
    return "---";
  }

  const start = formatMeasureNumber(block.startMeasure);
  const end = formatMeasureNumber(block.endMeasure);
  return start === end ? start : `${start}-${end}`;
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return "";
  }

  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const restSeconds = String(rounded % 60).padStart(2, "0");
  return `${minutes}:${restSeconds}`;
}

function formatTimeRange(block) {
  if (!block || !Number.isFinite(block.startTimeSec)) {
    return "";
  }

  const start = formatSeconds(block.startTimeSec);
  const end = Number.isFinite(block.endTimeSec) ? formatSeconds(block.endTimeSec) : "";

  if (!end || start === end) {
    return start;
  }

  return `${start}-${end}`;
}

function getBlockDetailLines(block) {
  if (!block) {
    return [];
  }

  const lines = [`小節: ${formatMeasureRange(block)}`];
  const timeRange = formatTimeRange(block);
  if (timeRange) {
    lines.push(`time: ${timeRange}`);
  }
  lines.push(`notes: ${block.playNotes}`);
  return lines;
}

function getBlockByIndex(blockIndex) {
  const analysis = progressMapState.analysis;
  if (!analysis || !Number.isInteger(blockIndex)) {
    return null;
  }

  return analysis.standardBlocks[blockIndex] || null;
}

function getBlockFromElement(blockElement) {
  if (!blockElement) {
    return null;
  }

  const blockIndex = Number(blockElement.dataset.blockIndex);
  return getBlockByIndex(blockIndex);
}

function getMeasureLabelInterval(blockCount) {
  if (blockCount > 240) {
    return 32;
  }

  if (blockCount > 120) {
    return 16;
  }

  return 8;
}

function getViewportMeasureLabelInterval(blockCount) {
  const width = progressMapLabels?.clientWidth || progressMapBlocks.clientWidth || 0;
  if (width > 0 && width < 560) {
    return Math.max(16, getMeasureLabelInterval(blockCount));
  }

  return getMeasureLabelInterval(blockCount);
}

function getBlockDurationSec(block) {
  const start = Number(block?.startTimeSec);
  const end = Number(block?.endTimeSec);
  const duration = end - start;
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function buildBlockDensities(blocks) {
  return blocks.map((block, index) => {
    const playNotes = Number(block.playNotes) || 0;
    const durationSec = getBlockDurationSec(block);
    const densityValue = durationSec ? playNotes / durationSec : playNotes;

    return {
      index,
      playNotes,
      durationSec,
      densityValue: Number.isFinite(densityValue) ? densityValue : 0
    };
  });
}

function renderProgressMeasureLabels(blocks) {
  if (!progressMapLabels) {
    return;
  }

  if (blocks.length === 0) {
    progressMapLabels.innerHTML = "";
    progressMapLabels.hidden = true;
    progressMapLabels.style.removeProperty("grid-template-columns");
    return;
  }

  const labelInterval = getViewportMeasureLabelInterval(blocks.length);
  progressMapLabels.hidden = false;
  progressMapLabels.style.gridTemplateColumns = `repeat(${blocks.length}, minmax(0, 1fr))`;
  progressMapLabels.innerHTML = blocks.map((block) => {
    const showLabel = block.index % 8 === 0 && block.index % labelInterval === 0;
    return showLabel
      ? `<span class="progress-block-measure-label">${formatMeasureNumber(block.startMeasure)}</span>`
      : `<span class="progress-block-measure-label is-empty"></span>`;
  }).join("");
}

function positionFloatingElement(element, clientX, clientY) {
  if (!element) {
    return;
  }

  const margin = 10;
  const offset = 12;
  element.hidden = false;
  element.style.left = `${clientX + offset}px`;
  element.style.top = `${clientY + offset}px`;

  const rect = element.getBoundingClientRect();
  let left = clientX + offset;
  let top = clientY + offset;

  if (left + rect.width + margin > window.innerWidth) {
    left = clientX - rect.width - offset;
  }

  if (top + rect.height + margin > window.innerHeight) {
    top = clientY - rect.height - offset;
  }

  element.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
  element.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))}px`;
}

function showProgressMapTooltip(blockElement, event) {
  if (!progressMapTooltip || progressMapState.isDragging) {
    return;
  }

  const block = getBlockFromElement(blockElement);
  if (!block) {
    return;
  }

  progressMapTooltip.innerHTML = getBlockDetailLines(block).map(escapeHtml).join("<br>");
  positionFloatingElement(progressMapTooltip, event.clientX, event.clientY);
}

function hideProgressMapTooltip() {
  if (!progressMapTooltip) {
    return;
  }

  progressMapTooltip.hidden = true;
}

function showProgressMapPopover(blockElement, event) {
  if (!progressMapPopover) {
    return;
  }

  const block = getBlockFromElement(blockElement);
  if (!block) {
    return;
  }

  const lines = getBlockDetailLines(block).map((line) => `<div class="progress-map-popover-line">${escapeHtml(line)}</div>`).join("");
  progressMapPopover.innerHTML = `<div class="progress-map-popover-title">ブロック ${block.index + 1}</div>${lines}`;
  positionFloatingElement(progressMapPopover, event.clientX, event.clientY);
}

function hideProgressMapPopover() {
  if (!progressMapPopover) {
    return;
  }

  progressMapPopover.hidden = true;
}

function hideProgressMapFloatingInfo() {
  hideProgressMapTooltip();
  hideProgressMapPopover();
}

function setProgressMapMessage(message, state = "empty") {
  progressMapState.analysis = null;
  progressMapState.paintedBlockIndexes = new Set();
  progressMapState.savedPaintedBlockIndexes = null;
  progressMapState.layerKind = "initial";
  progressMapState.isDragging = false;
  progressMapState.dragAnchorIndex = null;
  progressMapState.dragCurrentIndex = null;
  progressMapState.dragMode = null;
  progressMapState.originalPaintedBlockIndexes = null;
  progressMap.dataset.state = state;
  progressMapStatus.textContent = message;
  progressMapStatus.hidden = false;
  progressMapGraphWrap.hidden = true;
  progressMapSummary.hidden = true;
  progressMapBlocks.innerHTML = "";
  progressMapBlocks.style.removeProperty("grid-template-columns");
  renderProgressMeasureLabels([]);
  hideProgressMapFloatingInfo();
  updateCompleteButtonState();
}

function resetProgressMap(message = "譜面ファイル選択後に進捗マップを表示します") {
  window.BmsFormMiniView?.clear();
  setProgressMapMessage(message, "empty");
}

function calculateMapProgress() {
  const analysis = progressMapState.analysis;
  if (!analysis || analysis.standardBlocks.length === 0) {
    return null;
  }

  return Math.round((progressMapState.paintedBlockIndexes.size / analysis.standardBlocks.length) * 100);
}

function compressBlockIndexesToRanges(indexes) {
  const sortedIndexes = [...new Set(indexes)]
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b);
  const ranges = [];

  for (const index of sortedIndexes) {
    const previousRange = ranges[ranges.length - 1];
    if (previousRange && previousRange[1] + 1 === index) {
      previousRange[1] = index;
    } else {
      ranges.push([index, index]);
    }
  }

  return ranges;
}

function normalizeProgressMapBlock(block, index) {
  return {
    index,
    startMeasure: Number.isInteger(block.startMeasure) ? block.startMeasure : null,
    endMeasure: Number.isInteger(block.endMeasure) ? block.endMeasure : null,
    startPosition: Number.isFinite(block.startPosition ?? block.startStandardPosition)
      ? Number(block.startPosition ?? block.startStandardPosition)
      : null,
    endPosition: Number.isFinite(block.endPosition ?? block.endStandardPosition)
      ? Number(block.endPosition ?? block.endStandardPosition)
      : null,
    startTimeSec: Number.isFinite(block.startTimeSec) ? block.startTimeSec : null,
    endTimeSec: Number.isFinite(block.endTimeSec) ? block.endTimeSec : null,
    playNotes: Number.isInteger(block.playNotes) && block.playNotes > 0 ? block.playNotes : 0
  };
}

function buildProgressMapPayload() {
  const analysis = progressMapState.analysis;
  if (!analysis || !Array.isArray(analysis.standardBlocks) || analysis.standardBlocks.length === 0) {
    return null;
  }

  const targetBlockCount = analysis.standardBlocks.length;
  const paintedIndexes = [...progressMapState.paintedBlockIndexes]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < targetBlockCount);
  const progress = Math.round((new Set(paintedIndexes).size / targetBlockCount) * 100);

  return {
    schemaVersion: 2,
    blockMode: "standardized_measure",
    firstMeasure: Number.isInteger(analysis.firstMeasure) ? analysis.firstMeasure : null,
    lastMeasure: Number.isInteger(analysis.lastMeasure) ? analysis.lastMeasure : null,
    targetBlockCount,
    blocks: analysis.standardBlocks.map(normalizeProgressMapBlock),
    layers: [
      {
        versionId: "pending",
        color: "#1f7a5c",
        kind: isRejectedInput.checked ? "rejected_auto_fill" : progressMapState.layerKind,
        ranges: compressBlockIndexesToRanges(paintedIndexes)
      }
    ],
    progress
  };
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

  const blocks = Array.isArray(analysis.standardBlocks) ? analysis.standardBlocks : [];
  if (blocks.length === 0) {
    return;
  }

  const densities = buildBlockDensities(blocks);
  const maxDensity = Math.max(1, ...densities.map((item) => item.densityValue));
  const plotTop = 8;
  const plotBottom = 14;
  const plotWidth = cssWidth;
  const plotHeight = cssHeight - plotTop - plotBottom;
  const baseY = plotTop + plotHeight;
  const barSlot = plotWidth / densities.length;
  const barWidth = Math.max(1, barSlot);

  context.strokeStyle = "#dce4ea";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, baseY + 0.5);
  context.lineTo(cssWidth, baseY + 0.5);
  context.stroke();

  context.fillStyle = "rgba(42, 128, 116, 0.46)";
  densities.forEach((item, index) => {
    const x = index * barSlot;
    const height = Math.max(item.densityValue > 0 ? 2 : 0, (item.densityValue / maxDensity) * plotHeight);
    const y = baseY - height;
    context.fillRect(x, y, Math.ceil(barWidth), height);
  });
}

function renderProgressBlocks() {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    progressMapBlocks.innerHTML = "";
    progressMapBlocks.style.removeProperty("grid-template-columns");
    renderProgressMeasureLabels([]);
    return;
  }

  const blocks = analysis.standardBlocks;
  progressMapBlocks.style.gridTemplateColumns = `repeat(${blocks.length}, minmax(0, 1fr))`;
  progressMapBlocks.innerHTML = blocks.map((block) => {
    const isBarline = block.index % 8 === 0;
    const classes = ["progress-map-block", isBarline ? "is-barline" : ""].filter(Boolean).join(" ");
    const ariaLabel = [`block ${block.index + 1}`, ...getBlockDetailLines(block)].join(", ");
    return `<button class="${classes}" type="button" data-block-index="${block.index}" aria-pressed="false" aria-label="${escapeHtml(ariaLabel)}"></button>`;
  }).join("");

  renderProgressMeasureLabels(blocks);
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
  hideProgressMapFloatingInfo();
  renderProgressBlocks();
  drawDensityChart();
  updateProgressFromMap();
}

function initializeProgressMap(analysis) {
  progressMapState.analysis = analysis;
  progressMapState.paintedBlockIndexes = new Set();
  progressMapState.savedPaintedBlockIndexes = null;
  progressMapState.layerKind = isRejectedInput.checked ? "rejected_auto_fill" : "initial";
  progressMapState.isDragging = false;
  progressMapState.dragAnchorIndex = null;
  progressMapState.dragCurrentIndex = null;
  progressMapState.dragMode = null;
  progressMapState.originalPaintedBlockIndexes = null;

  if (isRejectedInput.checked) {
    for (const block of analysis.standardBlocks) {
      progressMapState.paintedBlockIndexes.add(block.index);
    }
  }

  renderProgressMap();
}

function findProgressBlockFromPointer(event) {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  return element?.closest?.(".progress-map-block") || null;
}

function applyProgressDragRange(currentBlockIndex) {
  if (!progressMapState.analysis || !progressMapState.originalPaintedBlockIndexes || !Number.isInteger(currentBlockIndex)) {
    return;
  }

  const anchorIndex = progressMapState.dragAnchorIndex;
  if (!Number.isInteger(anchorIndex)) {
    return;
  }

  const rangeStart = Math.min(anchorIndex, currentBlockIndex);
  const rangeEnd = Math.max(anchorIndex, currentBlockIndex);
  const nextPainted = new Set(progressMapState.originalPaintedBlockIndexes);

  for (let index = rangeStart; index <= rangeEnd; index += 1) {
    if (progressMapState.dragMode === "erase") {
      nextPainted.delete(index);
    } else {
      nextPainted.add(index);
    }
  }

  progressMapState.dragCurrentIndex = currentBlockIndex;
  progressMapState.paintedBlockIndexes = nextPainted;
  updateProgressFromMap();
}

function startProgressDrag(blockIndex, event) {
  if (!progressMapState.analysis || isRejectedInput.checked || !Number.isInteger(blockIndex)) {
    return;
  }

  const wasPainted = progressMapState.paintedBlockIndexes.has(blockIndex);
  progressMapState.layerKind = "initial";
  progressMapState.isDragging = true;
  progressMapState.dragAnchorIndex = blockIndex;
  progressMapState.dragCurrentIndex = blockIndex;
  progressMapState.dragMode = wasPainted ? "erase" : "paint";
  progressMapState.originalPaintedBlockIndexes = new Set(progressMapState.paintedBlockIndexes);
  hideProgressMapFloatingInfo();
  progressMapBlocks.setPointerCapture?.(event.pointerId);
  applyProgressDragRange(blockIndex);
}

function finishProgressDrag({ restoreOriginal = false } = {}) {
  if (restoreOriginal && progressMapState.originalPaintedBlockIndexes) {
    progressMapState.paintedBlockIndexes = new Set(progressMapState.originalPaintedBlockIndexes);
    updateProgressFromMap();
  }

  progressMapState.isDragging = false;
  progressMapState.dragAnchorIndex = null;
  progressMapState.dragCurrentIndex = null;
  progressMapState.dragMode = null;
  progressMapState.originalPaintedBlockIndexes = null;
}

function paintAllProgressBlocks(kind = "completion_fill") {
  const analysis = progressMapState.analysis;
  if (!analysis) {
    return;
  }

  progressMapState.layerKind = kind;
  progressMapState.paintedBlockIndexes = new Set(analysis.standardBlocks.map((block) => block.index));
  progressInput.value = "100";
  setFieldInvalid(progressInput, false);
  updateProgressSummary(100);
  updateProgressBlockClasses();
  updateCompleteButtonState();
}

function applyRejectedProgressMapState() {
  const analysis = progressMapState.analysis;
  hideProgressMapFloatingInfo();
  if (!analysis) {
    updateCompleteButtonState();
    return;
  }

  if (isRejectedInput.checked) {
    if (!progressMapState.savedPaintedBlockIndexes) {
      progressMapState.savedPaintedBlockIndexes = new Set(progressMapState.paintedBlockIndexes);
    }
    paintAllProgressBlocks("rejected_auto_fill");
    return;
  }

  if (progressMapState.savedPaintedBlockIndexes) {
    progressMapState.paintedBlockIndexes = new Set(progressMapState.savedPaintedBlockIndexes);
    progressMapState.savedPaintedBlockIndexes = null;
    progressMapState.layerKind = "initial";
  }

  updateProgressFromMap();
}

async function fillMetaFromFile(file, analysisRevision) {
  const extension = getExtension(file.name);
  resetProgressMap();

  if (!allowedChartExtensions.has(extension)) {
    showTextError("投稿対象は .bms .bme .bml .zip のみです。");
    fileInput.value = "";
    setFieldInvalid(fileInput, true);
    return;
  }

  setFieldInvalid(fileInput, false);

  try {
    setProgressMapMessage(extension === ".zip" ? "ZIP内の譜面を解析しています" : "譜面を解析しています", "loading");
    window.BmsFormMiniView?.setLoading();
    const localAnalysis = await window.BmsLocalChartAnalysis.analyze(file, analyzeBmsProgressText);
    if (
      analysisRevision !== initialFileAnalysisRevision
      || fileInput.files?.[0] !== file
      || document.querySelector(".submit-panel")?.classList.contains("is-append-mode")
    ) {
      return;
    }
    const text = localAnalysis.text;
    const meta = parseBmsMeta(text);
    const analysis = localAnalysis.progressAnalysis;

    if (meta.title) {
      titleInput.value = meta.title;
      setFieldInvalid(titleInput, false);
    }

    if (meta.subtitle) {
      subtitleInput.value = meta.subtitle;
    }

    if (meta.artist) {
      artistInput.value = meta.artist;
      setFieldInvalid(artistInput, false);
    }

    if (meta.subartist) {
      subartistInput.value = meta.subartist;
    }

    if (analysis.standardBlocks.length > 0) {
      initializeProgressMap(analysis);
      if (localAnalysis.miniView?.status === "ready") {
        window.BmsFormMiniView?.setAnalysis(localAnalysis.miniView, analysis.standardBlocks);
      } else {
        window.BmsFormMiniView?.setUnavailable("ミニビュー非対応");
      }
    } else {
      window.BmsFormMiniView?.setUnavailable("ミニビュー非対応");
      setProgressMapMessage("プレイノートを検出できませんでした", "unavailable");
    }

    clearError();
  } catch (error) {
    if (analysisRevision !== initialFileAnalysisRevision || fileInput.files?.[0] !== file) {
      return;
    }
    window.BmsFormMiniView?.clear();
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

function normalizeChartQuery(value) {
  return Array.from(String(value ?? "").trim()).slice(0, maxChartSearchLength).join("");
}

function readChartQueryFromUrl() {
  return normalizeChartQuery(new URL(window.location.href).searchParams.get("q") || "");
}

function updateChartSearchUrl(query, replace = false) {
  const url = new URL(window.location.href);
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ q: query }, "", url);
}

function getChartEntryId(entry) {
  return String(entry?.chart?.id || entry?.chartId || "");
}

function mergeChartEntries(currentEntries, nextEntries) {
  const merged = [...currentEntries];
  const indexById = new Map();
  merged.forEach((entry, index) => {
    const chartId = getChartEntryId(entry);
    if (chartId) {
      indexById.set(chartId, index);
    }
  });

  nextEntries.forEach((entry) => {
    const chartId = getChartEntryId(entry);
    if (chartId && indexById.has(chartId)) {
      merged[indexById.get(chartId)] = entry;
      return;
    }

    if (chartId) {
      indexById.set(chartId, merged.length);
    }
    merged.push(entry);
  });

  return merged;
}

function setChartListFeedback(message = "") {
  if (!chartListFeedback) {
    return;
  }

  chartListFeedback.textContent = message;
  chartListFeedback.hidden = !message;
}

function updateChartListControls() {
  if (chartSearchInput && document.activeElement !== chartSearchInput) {
    chartSearchInput.value = chartListState.query;
  }

  if (chartSearchClearButton) {
    chartSearchClearButton.disabled = !chartSearchInput?.value.trim();
  }

  if (chartSearchSummary) {
    if (chartListState.loading && !chartListState.loadingMore) {
      chartSearchSummary.textContent = chartListState.query ? "検索中です。" : "一覧を読み込んでいます。";
    } else if (chartListState.query) {
      chartSearchSummary.textContent = `「${chartListState.query}」の検索結果 ${chartListState.total}件（${chartListState.charts.length}件表示）`;
    } else {
      chartSearchSummary.textContent = `全${chartListState.total}件中 ${chartListState.charts.length}件表示`;
    }
  }

  if (loadMoreChartsButton) {
    loadMoreChartsButton.hidden = chartListState.charts.length === 0 || !chartListState.hasNext;
    loadMoreChartsButton.disabled = chartListState.loading;
    loadMoreChartsButton.textContent = chartListState.loadingMore
      ? "読み込み中"
      : chartListState.loadMoreFailed
        ? "再試行"
        : "さらに読み込む";
  }
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

function rerenderCurrentChartList() {
  const renderData = {
    charts: chartListState.charts,
    pagination: {
      page: chartListState.page,
      pageSize: chartListState.pageSize,
      total: chartListState.total,
      hasNext: chartListState.hasNext
    },
    query: { q: chartListState.query }
  };
  renderCharts(renderData);
  updateChartListControls();
  return renderData;
}

window.rerenderCurrentChartList = rerenderCurrentChartList;

async function loadCharts(options = {}) {
  const append = options.append === true;
  if (append && (chartListState.loading || !chartListState.hasNext)) {
    return null;
  }

  if (!append) {
    chartListState.abortController?.abort();
    chartListState.query = normalizeChartQuery(options.query ?? chartListState.query);
    chartListState.page = 0;
    chartListState.total = 0;
    chartListState.hasNext = false;
    chartListState.charts = [];
    chartListState.loadMoreFailed = false;
    renderLoading();
  }

  const targetPage = append ? chartListState.page + 1 : 1;
  const requestSequence = chartListState.requestSequence + 1;
  const abortController = new AbortController();
  chartListState.requestSequence = requestSequence;
  chartListState.abortController = abortController;
  chartListState.loading = true;
  chartListState.loadingMore = append;
  setChartListFeedback(append ? "追加分を読み込んでいます。" : "");
  updateChartListControls();

  const searchParams = new URLSearchParams({
    page: String(targetPage),
    pageSize: String(chartListState.pageSize)
  });
  if (chartListState.query) {
    searchParams.set("q", chartListState.query);
  }

  try {
    const data = await apiRequest(`/api/charts?${searchParams.toString()}`, {
      signal: abortController.signal
    });
    if (requestSequence !== chartListState.requestSequence) {
      return null;
    }

    const nextCharts = Array.isArray(data?.charts) ? data.charts : [];
    chartListState.charts = append
      ? mergeChartEntries(chartListState.charts, nextCharts)
      : nextCharts;
    chartListState.page = Number(data?.pagination?.page) || targetPage;
    chartListState.total = Number.isFinite(Number(data?.pagination?.total))
      ? Number(data.pagination.total)
      : chartListState.charts.length;
    chartListState.hasNext = data?.pagination?.hasNext === true;
    chartListState.loadMoreFailed = false;

    const renderData = {
      ...data,
      charts: chartListState.charts,
      pagination: {
        ...data?.pagination,
        page: chartListState.page,
        pageSize: chartListState.pageSize,
        total: chartListState.total,
        hasNext: chartListState.hasNext
      },
      query: { q: chartListState.query }
    };
    renderCharts(renderData);

    if (chartListState.charts.length === 0 && chartListState.query) {
      const status = chartList.querySelector(".list-status");
      if (status) {
        status.textContent = `「${chartListState.query}」に一致する投稿はありません。`;
      }
    }

    setChartListFeedback("");
    return renderData;
  } catch (error) {
    if (error?.name === "AbortError" || requestSequence !== chartListState.requestSequence) {
      return null;
    }

    console.error("[api-charts-list] failed to load charts", {
      code: error?.code || "CHARTS_LIST_FAILED",
      append,
      page: targetPage,
      message: error?.detail || error?.message || String(error)
    });

    if (append) {
      chartListState.loadMoreFailed = true;
      setChartListFeedback("追加分を読み込めませんでした。再試行してください。");
    } else {
      chartList.innerHTML = `<div class="list-status">一覧を読み込めませんでした。</div>`;
      setChartListFeedback("初回取得に失敗しました。");
      showError(error);
    }
    return null;
  } finally {
    if (requestSequence === chartListState.requestSequence) {
      chartListState.loading = false;
      chartListState.loadingMore = false;
      chartListState.abortController = null;
      updateChartListControls();
      window.dispatchEvent(new CustomEvent("chart-list-load-settled", {
        detail: {
          append,
          page: targetPage,
          chartCount: chartListState.charts.length
        }
      }));
    }
  }
}

function buildChartFormData() {
  const file = fileInput.files?.[0];
  const difficulty = difficultyInput.value.trim();
  const progressMapPayload = buildProgressMapPayload();
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
  formData.append("originUrl", originUrlInput.value.trim());
  formData.append("progress", isRejectedInput.checked ? "100" : progressInput.value.trim());
  formData.append("comment", commentInput.value.trim());
  formData.append("isRejected", isRejectedInput.checked ? "true" : "false");
  formData.append("password", passwordInput.value);

  if (progressMapPayload) {
    formData.append("progressMap", JSON.stringify(progressMapPayload));
  }

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
    const turnstileToken = await window.BmsTurnstile?.getToken();
    if (!turnstileToken) {
      throw {
        code: "TURNSTILE_REQUIRED",
        message: "Turnstile認証を完了してください。",
        detail: "Turnstile token is unavailable."
      };
    }
    await apiRequest("/api/charts", {
      method: "POST",
      headers: {
        "X-Turnstile-Token": turnstileToken
      },
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
    window.BmsTurnstile?.reset();
    setSubmitting(false);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  const revision = ++initialFileAnalysisRevision;
  window.BmsFormMiniView?.clear();

  if (document.querySelector(".submit-panel")?.classList.contains("is-append-mode")) {
    return;
  }

  if (!file) {
    setFieldInvalid(fileInput, false);
    resetProgressMap();
    clearError();
    return;
  }

  fillMetaFromFile(file, revision);
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
  if (event.button !== 0) {
    return;
  }

  const block = event.target.closest(".progress-map-block");
  if (!block) {
    return;
  }

  event.preventDefault();
  startProgressDrag(Number(block.dataset.blockIndex), event);
});

progressMapBlocks.addEventListener("pointermove", (event) => {
  if (progressMapState.isDragging) {
    event.preventDefault();
    hideProgressMapTooltip();
    const block = findProgressBlockFromPointer(event);
    if (block) {
      applyProgressDragRange(Number(block.dataset.blockIndex));
    }
    return;
  }

  const block = findProgressBlockFromPointer(event);
  if (block) {
    showProgressMapTooltip(block, event);
  } else {
    hideProgressMapTooltip();
  }
});

progressMapBlocks.addEventListener("pointerout", (event) => {
  if (!progressMapBlocks.contains(event.relatedTarget)) {
    hideProgressMapTooltip();
  }
});

progressMapBlocks.addEventListener("pointerup", (event) => {
  if (!progressMapState.isDragging) {
    return;
  }

  progressMapBlocks.releasePointerCapture?.(event.pointerId);
  finishProgressDrag();
});

progressMapBlocks.addEventListener("pointercancel", (event) => {
  if (!progressMapState.isDragging) {
    return;
  }

  progressMapBlocks.releasePointerCapture?.(event.pointerId);
  finishProgressDrag({ restoreOriginal: true });
});

progressMapBlocks.addEventListener("contextmenu", (event) => {
  const block = event.target.closest(".progress-map-block");
  if (!block) {
    return;
  }

  event.preventDefault();
  hideProgressMapTooltip();
  showProgressMapPopover(block, event);
});

completeProgressButton.addEventListener("click", () => {
  paintAllProgressBlocks("completion_fill");
});

window.addEventListener("resize", () => {
  drawDensityChart();
  if (progressMapState.analysis) {
    renderProgressMeasureLabels(progressMapState.analysis.standardBlocks);
  }
  hideProgressMapFloatingInfo();
});

document.addEventListener("click", (event) => {
  if (!progressMapPopover || progressMapPopover.hidden) {
    return;
  }

  if (!progressMapPopover.contains(event.target) && !event.target.closest(".progress-map-block")) {
    hideProgressMapPopover();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideProgressMapFloatingInfo();
  }
});

savePasswordInput.addEventListener("change", persistPasswordPreference);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitChart();
});

chartSearchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = normalizeChartQuery(chartSearchInput?.value || "");
  if (chartSearchInput) {
    chartSearchInput.value = query;
  }
  updateChartSearchUrl(query, query === chartListState.query);
  loadCharts({ query });
});

chartSearchInput?.addEventListener("input", () => {
  if (chartSearchClearButton) {
    chartSearchClearButton.disabled = !chartSearchInput.value.trim();
  }
});

chartSearchClearButton?.addEventListener("click", () => {
  if (chartSearchInput) {
    chartSearchInput.value = "";
    chartSearchInput.focus();
  }
  updateChartSearchUrl("", chartListState.query === "");
  loadCharts({ query: "" });
});

loadMoreChartsButton?.addEventListener("click", () => {
  loadCharts({ append: true });
});

window.addEventListener("popstate", () => {
  const query = readChartQueryFromUrl();
  if (chartSearchInput) {
    chartSearchInput.value = query;
  }
  loadCharts({ query });
});

loadSavedPassword();
resetDifficultySelector();
resetProgressMap();
applyRejectedProgressState();
if (chartSearchInput) {
  chartSearchInput.value = chartListState.query;
}
updateChartListControls();

const startInitialChartLoad = async () => {
  const detailRender = window.chartDetailInitialRenderPromise;
  if (detailRender && typeof detailRender.then === "function") {
    try {
      await detailRender;
    } catch (error) {
      console.warn("[chart-detail-before-list] detail preparation did not complete normally", {
        code: "CHART_DETAIL_PREPARE_FAILED",
        errorType: error instanceof Error ? error.name : typeof error
      });
    }
  }
  return loadCharts({ query: chartListState.query });
};
if (document.readyState === "complete") {
  window.setTimeout(startInitialChartLoad, 0);
} else {
  window.addEventListener("load", startInitialChartLoad, { once: true });
}
