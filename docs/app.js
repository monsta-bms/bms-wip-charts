const PRODUCTION_API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
const API_BASE_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:8788"
  : PRODUCTION_API_BASE_URL;

const allowedChartExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);

const form = document.querySelector("#chartForm");
const fileInput = document.querySelector("#chartFile");
const titleInput = document.querySelector("#title");
const subtitleInput = document.querySelector("#subtitle");
const artistInput = document.querySelector("#artist");
const subartistInput = document.querySelector("#subartist");
const chartNameInput = document.querySelector("#chartName");
const difficultyInput = document.querySelector("#difficulty");
const difficultyField = document.querySelector(".difficulty-field");
const difficultySection = difficultyField?.closest(".diff-info-section");
const difficultyPicker = document.querySelector("#difficultyPicker");
const difficultyCompact = document.querySelector("#difficultyCompact");
const difficultyCompactValue = document.querySelector("#difficultyCompactValue");
const difficultyChangeButton = document.querySelector("#difficultyChangeButton");
const difficultyTabs = Array.from(document.querySelectorAll(".difficulty-tab"));
const difficultyChips = document.querySelector("#difficultyChips");
const difficultyManualPanel = document.querySelector("#difficultyManualPanel");
const difficultyManualInput = document.querySelector("#difficultyManual");
const difficultyPreview = document.querySelector("#difficultyPreview");
const authorInput = document.querySelector("#author");
const originUrlInput = document.querySelector("#originUrl");
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
const completionStateBadge = document.querySelector("#completionStateBadge");
const completionStateDescription = document.querySelector("#completionStateDescription");
const completionEditNotice = document.querySelector("#completionEditNotice");
const commentInput = document.querySelector("#comment");
const isRejectedInput = document.querySelector("#isRejected");
const rejectedStateBadge = document.querySelector("#rejectedStateBadge");
const rejectedStateDescription = document.querySelector("#rejectedStateDescription");
const allowAppendControl = document.querySelector("#allowAppendControl");
const allowAppendInput = document.querySelector("#allowAppend");
const allowAppendStateBadge = document.querySelector("#allowAppendStateBadge");
const allowAppendStateDescription = document.querySelector("#allowAppendStateDescription");
const passwordInput = document.querySelector("#password");
const saveAuthorInput = document.querySelector("#saveAuthor");
const savePasswordInput = document.querySelector("#savePassword");
const submitButton = document.querySelector("#submitButton");
const errorBox = document.querySelector("#errorBox");
const chartList = document.querySelector("#chartList");
const chartListFeedback = document.querySelector("#chartListFeedback");
const chartListPagination = document.querySelector("#chartListPagination");
const loadMoreChartsButton = document.querySelector("#loadMoreChartsButton");

let isSubmitting = false;
let lastValidManualDifficulty = "";
let initialFileAnalysisRevision = 0;
let difficultyPickerExpanded = true;
const postStateUi = {
  mode: "initial",
  completionRequested: false,
  appendReadiness: {
    hasTarget: false,
    formOpen: false,
    fileSelected: false,
    analysisStatus: "empty",
    hasProgressMap: false,
    hasAnalysisError: false
  },
  initialRejectedChoice: false,
  initialRejectedChoiceInitialized: false,
  appendCompletedChoice: true,
  appendCompletedChoiceInitialized: false
};

const recentChartCount = 10;
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
  query: "",
  page: 0,
  pageSize: recentChartCount,
  total: 0,
  hasNext: false,
  charts: [],
  loading: false,
  loadingMore: false,
  loadMoreFailed: false,
  requestSequence: 0,
  abortController: null,
  selectedChartId: ""
};

const requiredFieldChecks = [
  { name: "譜面ファイル", input: fileInput, isMissing: () => !fileInput.files?.[0] },
  { name: "曲名", input: titleInput, isMissing: () => !titleInput.value.trim() },
  { name: "アーティスト", input: artistInput, isMissing: () => !artistInput.value.trim() },
  { name: "差分名", input: chartNameInput, isMissing: () => !chartNameInput.value.trim() },
  { name: "想定難易度", input: difficultyInput, isMissing: () => !difficultyInput.value.trim() },
  { name: "差分作者", input: authorInput, isMissing: () => !authorInput.value.trim() },
  { name: "進捗度", input: progressInput, isMissing: () => !progressInput.value.trim() },
  { name: "管理パスワード", input: passwordInput, isMissing: () => !passwordInput.value.trim() }
];

function setFieldInvalid(input, invalid) {
  input.setAttribute("aria-invalid", invalid ? "true" : "false");

  if (input === difficultyInput) {
    difficultyPicker.setAttribute("aria-invalid", invalid ? "true" : "false");
    if (invalid) {
      setDifficultyPickerExpanded(true);
    }
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
  const safeMessages = {
    INVALID_ALLOW_APPEND: "追記受付の設定が正しくありません。ページを再読み込みしてください。",
    APPEND_POLICY_LOCKED_FOR_INCOMPLETE: "未完成版では追記受付を停止できません。",
    INITIAL_COMPLETION_NOT_ALLOWED: "初回投稿では完成版にできません。追記投稿から完成版にしてください。",
    FOLLOWUP_REJECTED_NOT_ALLOWED: "追記投稿では没譜面にできません。",
    COMPLETION_PROGRESS_TOO_LOW: "完成版にするには、進捗度を80%以上にしてください。",
    COMPLETION_ACTION_REQUIRED: "完成版にする操作を使用してください。",
    PARENT_APPEND_DISABLED: "この版からの追記受付は停止されています。ページを再読み込みして、別の版を選択してください。",
    PARENT_APPEND_CONFLICT: "親版の状態が更新されたため追記できませんでした。ページを再読み込みして、もう一度確認してください。"
  };
  const message = safeMessages[code] || error?.message || "処理に失敗しました。";
  const detail = error?.detail || "ブラウザの開発者ツールで通信状況を確認してください。";

  errorBox.textContent = safeMessages[code]
    ? `code: ${code}\nmessage: ${message}`
    : `code: ${code}\nmessage: ${message}\ndetail: ${detail}`;
  errorBox.hidden = false;
}

function resolveAllowAppend(version) {
  const uiModel = buildSharedVersionUiModel(version, { hasProgressMap: true });
  return uiModel?.append.allowedByPolicy === true;
}

function setPostStateBadge(element, text, state) {
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state;
}

function setControlDisabled(control, disabled) {
  if (!control) return;
  control.disabled = disabled;
  control.setAttribute("aria-disabled", disabled ? "true" : "false");
}

function getPostStateSnapshot() {
  const isAppend = postStateUi.mode === "append";
  const isRejected = !isAppend && Boolean(isRejectedInput?.checked);
  const isCompleted = isAppend && postStateUi.completionRequested;
  const isAllowAppendConfigurable = isRejected || isCompleted;
  const allowAppendUserChoice = isRejected
    ? postStateUi.initialRejectedChoice
    : postStateUi.appendCompletedChoice;
  const readiness = postStateUi.appendReadiness;
  const hasValidAppendFile = Boolean(
    isAppend
    && readiness.hasTarget
    && readiness.formOpen
    && readiness.fileSelected
    && readiness.analysisStatus === "ready"
    && readiness.hasProgressMap
    && !readiness.hasAnalysisError
  );

  return {
    isAppend,
    isRejected,
    isCompleted,
    hasValidAppendFile,
    appendReadiness: { ...readiness },
    isAllowAppendConfigurable,
    effectiveAllowAppend: isAllowAppendConfigurable ? allowAppendUserChoice : true
  };
}

function updatePostStateUi({ progress = Number(progressInput?.value) } = {}) {
  const state = getPostStateSnapshot();
  const numericProgress = Number.isFinite(Number(progress)) ? Number(progress) : 0;

  if (isRejectedInput) {
    if (state.isAppend) isRejectedInput.checked = false;
    setControlDisabled(isRejectedInput, state.isAppend);
  }

  if (completeProgressButton) {
    const completionAvailable = state.hasValidAppendFile
      && (state.isCompleted || (numericProgress >= 80 && numericProgress <= 100));
    setControlDisabled(completeProgressButton, !completionAvailable);
    completeProgressButton.hidden = false;
    completeProgressButton.textContent = state.isCompleted ? "完成版を解除" : "完成版にする";
    completeProgressButton.setAttribute("aria-pressed", state.isCompleted ? "true" : "false");
  }
  if (completionEditNotice) {
    completionEditNotice.hidden = !state.isCompleted;
  }

  if (!state.isAppend) {
    setPostStateBadge(completionStateBadge, "利用不可", "unavailable");
    if (completionStateDescription) completionStateDescription.textContent = "初回投稿では完成版にできません。";
  } else if (state.isCompleted && state.hasValidAppendFile) {
    setPostStateBadge(completionStateBadge, "完成版指定中", "selected");
    if (completionStateDescription) completionStateDescription.textContent = "完成版として投稿します。解除すると、進捗マップを指定直前の状態へ戻します。";
  } else if (!state.appendReadiness.fileSelected) {
    setPostStateBadge(completionStateBadge, "譜面未選択", "unavailable");
    if (completionStateDescription) completionStateDescription.textContent = "譜面ファイルを選択し、解析が完了すると完成版を設定できます。";
  } else if (state.appendReadiness.analysisStatus === "loading") {
    setPostStateBadge(completionStateBadge, "解析中", "unavailable");
    if (completionStateDescription) completionStateDescription.textContent = "譜面を解析しています。解析完了後に完成版の条件を判定します。";
  } else if (state.appendReadiness.analysisStatus === "error" || state.appendReadiness.hasAnalysisError || !state.appendReadiness.hasProgressMap) {
    setPostStateBadge(completionStateBadge, "解析失敗", "unavailable");
    if (completionStateDescription) completionStateDescription.textContent = "譜面を解析できないため、完成版を設定できません。";
  } else if (numericProgress < 80) {
    setPostStateBadge(completionStateBadge, "進捗不足", "unavailable");
    if (completionStateDescription) completionStateDescription.textContent = "完成版にするには、進捗度を80%以上にしてください。";
  } else {
    setPostStateBadge(completionStateBadge, "設定可能", "configurable");
    if (completionStateDescription) completionStateDescription.textContent = "透明部分を塗りつぶし、進捗度100%の完成版として投稿します。";
  }

  if (state.isAppend) {
    setPostStateBadge(rejectedStateBadge, "追記投稿では利用不可", "unavailable");
    if (rejectedStateDescription) rejectedStateDescription.textContent = "追記投稿では没譜面にできません。";
  } else {
    setPostStateBadge(rejectedStateBadge, "操作可能", "configurable");
    if (rejectedStateDescription) {
      rejectedStateDescription.textContent = state.isRejected
        ? "没譜面として投稿します。進捗度は100%として扱われます。"
        : "制作途中の通常版として投稿します。";
    }
  }

  if (allowAppendInput) {
    allowAppendInput.checked = state.effectiveAllowAppend;
    setControlDisabled(allowAppendInput, !state.isAllowAppendConfigurable);
  }
  setPostStateBadge(
    allowAppendStateBadge,
    state.isAllowAppendConfigurable ? "設定可能" : "自動で許可",
    state.isAllowAppendConfigurable ? "configurable" : "automatic"
  );
  if (allowAppendStateDescription) {
    if (!state.isAppend && !state.isRejected) {
      allowAppendStateDescription.textContent = "初回の未完成版は追記受付が必須です。停止にはできません。";
    } else if (!state.isAppend) {
      allowAppendStateDescription.textContent = state.effectiveAllowAppend
        ? "他の利用者による引継ぎ・改変を許可します。"
        : "他の利用者による追記・改変を受け付けません。";
    } else if (!state.isCompleted) {
      allowAppendStateDescription.textContent = "未完成版は追記受付が必須です。停止にはできません。";
    } else {
      allowAppendStateDescription.textContent = state.effectiveAllowAppend
        ? "他の利用者による追加の改変・分岐を許可します。"
        : "この完成版からの新しい追記・分岐を停止します。";
    }
  }

  return state;
}

function resetAllowAppendForForm(isRejected = false, { mode = "initial" } = {}) {
  postStateUi.mode = mode === "append" ? "append" : "initial";
  postStateUi.completionRequested = false;
  postStateUi.appendReadiness = {
    hasTarget: false,
    formOpen: false,
    fileSelected: false,
    analysisStatus: "empty",
    hasProgressMap: false,
    hasAnalysisError: false
  };
  postStateUi.initialRejectedChoice = false;
  postStateUi.initialRejectedChoiceInitialized = false;
  postStateUi.appendCompletedChoice = true;
  postStateUi.appendCompletedChoiceInitialized = false;
  if (isRejectedInput) isRejectedInput.checked = postStateUi.mode === "initial" && Boolean(isRejected);
  updatePostStateUi();
}

window.BmsAppendPolicy = {
  resolve: resolveAllowAppend,
  resetForForm: resetAllowAppendForForm,
  setMode: (mode) => resetAllowAppendForForm(false, { mode }),
  setAppendReadiness: (readiness = {}, options = {}) => {
    postStateUi.appendReadiness = {
      ...postStateUi.appendReadiness,
      ...readiness
    };
    return updatePostStateUi(options);
  },
  setCompletionRequested: (requested, options = {}) => {
    postStateUi.completionRequested = Boolean(requested);
    if (postStateUi.completionRequested && !postStateUi.appendCompletedChoiceInitialized) {
      postStateUi.appendCompletedChoice = true;
      postStateUi.appendCompletedChoiceInitialized = true;
    }
    return updatePostStateUi(options);
  },
  sync: updatePostStateUi,
  snapshot: getPostStateSnapshot,
  effectiveValue: () => getPostStateSnapshot().effectiveAllowAppend,
  value: () => getPostStateSnapshot().effectiveAllowAppend
};

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

function setDifficultyPickerExpanded(expanded, { focus = false } = {}) {
  const hasValue = Boolean(getCurrentDifficultyValue());
  const nextExpanded = Boolean(expanded) || !hasValue;
  difficultyPickerExpanded = nextExpanded;
  difficultyPicker.hidden = !nextExpanded;
  difficultyCompact.hidden = nextExpanded;
  difficultyField?.classList.toggle("is-compact", !nextExpanded);
  difficultySection?.classList.toggle("is-difficulty-compact", !nextExpanded);
  difficultyChangeButton?.setAttribute("aria-expanded", String(nextExpanded));
  difficultyPicker.setAttribute("aria-hidden", String(!nextExpanded));

  if (focus && nextExpanded) {
    const selectedTab = difficultyTabs.find((tab) => tab.getAttribute("aria-pressed") === "true");
    (selectedTab || difficultyTabs[0])?.focus();
  }
}

function collapseDifficultyPickerIfSelected() {
  if (!getCurrentDifficultyValue()) {
    return false;
  }

  setDifficultyPickerExpanded(false);
  return true;
}

function updateDifficultyValue() {
  const value = getCurrentDifficultyValue();
  difficultyInput.value = value;
  difficultyPreview.textContent = value || "未選択";
  difficultyCompactValue.textContent = value || "未選択";

  if (value) {
    setFieldInvalid(difficultyInput, false);
    window.BmsPostErrorUi?.clearField?.("difficulty");
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
  collapseDifficultyPickerIfSelected();
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
  setDifficultyPickerExpanded(true);
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
  if (progressMapHeader) {
    progressMapHeader.hidden = true;
  }
  if (progressControls) {
    progressControls.hidden = true;
  }
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
    : ` / 小節 ${analysis.firstMeasure}–${analysis.lastMeasure}`;
  progressMapSummary.textContent = `ノーツ ${analysis.playNotes.toLocaleString("ja-JP")} / ${analysis.standardBlocks.length}区間${measureText}`;
  progressMapSummary.hidden = false;
}

function updateCompleteButtonState() {
  updatePostStateUi({ progress: Number(progressInput.value) });
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
  window.BmsPostErrorUi?.clearField?.("progress");
  window.BmsPostErrorUi?.clearField?.("progressMap");
  if (progressValue < 100) window.BmsPostErrorUi?.clearField?.("completion");
  updateProgressSummary(progressValue);
  updateCompleteButtonState();

  if (updateBlocks) {
    updateProgressBlockClasses();
  }
}

function getThemeCanvasColor(name, fallback) {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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
  context.fillStyle = getThemeCanvasColor("--canvas-bg", "#ffffff");
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

  context.strokeStyle = getThemeCanvasColor("--canvas-grid", "#dce4ea");
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, baseY + 0.5);
  context.lineTo(cssWidth, baseY + 0.5);
  context.stroke();

  context.fillStyle = getThemeCanvasColor("--canvas-density", "rgba(42, 128, 116, 0.46)");
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
  if (progressMapHeader) {
    progressMapHeader.hidden = false;
  }
  if (progressControls) {
    progressControls.hidden = false;
  }
  if (rejectedProgressControl) {
    rejectedProgressControl.hidden = false;
  }
  if (allowAppendControl) {
    allowAppendControl.hidden = false;
  }
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

  const fileValidation = window.BmsPostFileUi?.validateFile?.(file);
  if (fileValidation && !fileValidation.valid) {
    fileInput.value = "";
    setFieldInvalid(fileInput, true);
    window.BmsPostFileUi?.setError?.(fileValidation.message, file);
    clearError();
    return;
  }

  if (!allowedChartExtensions.has(extension)) {
    fileInput.value = "";
    setFieldInvalid(fileInput, true);
    window.BmsPostFileUi?.setError?.("投稿できるのは .bms / .bme / .bml / .zip です。", file);
    clearError();
    return;
  }

  setFieldInvalid(fileInput, false);

  try {
    window.BmsPostFileUi?.setAnalyzing?.(file);
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
      window.BmsPostErrorUi?.clearField?.("title");
    }

    if (meta.subtitle) {
      subtitleInput.value = meta.subtitle;
    }

    if (meta.artist) {
      artistInput.value = meta.artist;
      setFieldInvalid(artistInput, false);
      window.BmsPostErrorUi?.clearField?.("artist");
    }

    if (meta.subartist) {
      subartistInput.value = meta.subartist;
    }

    window.BmsChartMetadataExtract?.mount?.();

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

    window.BmsPostFileUi?.setReady?.({
      file,
      sourceFileName: localAnalysis.sourceFileName,
      blockCount: analysis.standardBlocks.length,
      miniViewAvailable: localAnalysis.miniView?.status === "ready"
    });

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
    window.BmsPostFileUi?.setError?.("譜面情報を読み取れませんでした。ファイルの内容を確認してください。", file);
    clearError();
  }
}

function clearInitialFileMetadata() {
  window.BmsChartMetadataExtract?.reset?.();
  titleInput.value = "";
  subtitleInput.value = "";
  artistInput.value = "";
  subartistInput.value = "";
  setFieldInvalid(titleInput, false);
  setFieldInvalid(artistInput, false);
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
    window.BmsPostErrorUi?.showValidationErrors?.([
      { fieldKey: "progress", message: "進捗度は0から100までの整数で入力してください。" }
    ], { source: "local", reveal: false, showSummary: false, replace: false });
    return false;
  }

  window.BmsPostErrorUi?.clearField?.("progress");
  updateCompleteButtonState();
  return true;
}

function validateRequiredFields() {
  const errors = [];
  const addError = (fieldKey, message, code = "FIELD_REQUIRED") => {
    errors.push({ fieldKey, message, code });
  };
  const selectedFile = fileInput.files?.[0];
  const fileState = document.querySelector("#chartFileDropControl")?.dataset.state || "empty";

  if (fileState === "error") {
    addError(
      "file",
      document.querySelector("#chartFileDropError")?.textContent?.trim()
        || "譜面ファイルを解析できませんでした。別のファイルを選択してください。",
      "FILE_ANALYSIS_FAILED"
    );
  } else if (!selectedFile) {
    addError("file", "譜面ファイルを選択してください。");
  } else if (fileState === "analyzing") {
    addError("file", "譜面ファイルの解析が完了するまでお待ちください。", "FILE_ANALYSIS_PENDING");
  }

  const requiredFields = [
    ["title", titleInput, "曲名を入力してください。"],
    ["artist", artistInput, "アーティストを入力してください。"],
    ["difficulty", difficultyInput, "想定難易度を選択または入力してください。"],
    ["chartName", chartNameInput, "差分名を入力してください。"],
    ["author", authorInput, "差分作者を入力してください。"],
    ["progress", progressInput, "進捗度を入力してください。"],
    ["password", passwordInput, "管理パスワードを入力してください。"]
  ];
  for (const [fieldKey, input, message] of requiredFields) {
    const missing = !input.value.trim();
    setFieldInvalid(input, missing);
    if (missing) addError(fieldKey, message);
  }

  if (chartNameInput.value.trim() && Array.from(chartNameInput.value.trim()).length > 100) {
    setFieldInvalid(chartNameInput, true);
    addError("chartName", "差分名は100文字以内で入力してください。", "CHART_NAME_TOO_LONG");
  }

  const originUrl = originUrlInput.value;
  const originUrlIsValid = window.BmsPostErrorUi?.isValidOriginUrl
    ? window.BmsPostErrorUi.isValidOriginUrl(originUrl)
    : true;
  if (originUrl.trim().length > 2048) {
    addError("originUrl", "原曲配布URLは2048文字以内で入力してください。", "ORIGIN_URL_TOO_LONG");
  } else if (!originUrlIsValid) {
    addError("originUrl", "原曲配布URLは認証情報を含まないHTTPまたはHTTPSのURLで入力してください。", "INVALID_ORIGIN_URL");
  }

  if (progressInput.value.trim() && !isValidProgress(progressInput.value)) {
    setFieldInvalid(progressInput, true);
    addError("progress", "進捗度は0から100までの整数で入力してください。", "INVALID_PROGRESS");
  }

  const state = getPostStateSnapshot();
  if (selectedFile && fileState === "ready" && !state.isRejected && Number(progressInput.value) === 100) {
    addError("completion", "初回投稿は完成版にできません。進捗度を99以下にするか、没譜面として投稿してください。", "INITIAL_COMPLETION_NOT_ALLOWED");
  }
  if (!state.isRejected && !state.effectiveAllowAppend) {
    addError("allowAppend", "未完成版では追記受付を停止できません。", "APPEND_POLICY_LOCKED_FOR_INCOMPLETE");
  }

  if (errors.length > 0) {
    if (window.BmsPostErrorUi?.showValidationErrors) {
      window.BmsPostErrorUi.showValidationErrors(errors, {
        source: "local"
      });
    } else {
      showTextError(`入力内容を確認してください（${errors.length}件）`);
    }
    return false;
  }

  window.BmsPostErrorUi?.clearAll?.({ source: "local" });
  clearRequiredFieldIndicators();
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

function buildSharedVersionUiModel(version, options = {}) {
  return window.BmsVersionUiModel?.buildVersionUiModel?.(version, {
    workerBaseUrl: API_BASE_URL,
    hasProgressMap: options.hasProgressMap === true,
    isSupersededIntermediate: options.isSupersededIntermediate === true
  }) || null;
}

function getChartEntryId(entry) {
  return String(entry?.chart?.id || entry?.chartId || "");
}

function getSelectedChartId() {
  const controllerSelection = window.BmsChartDetail?.getSelection?.();
  if (controllerSelection?.chartId) {
    return String(controllerSelection.chartId);
  }

  return String(new URL(window.location.href).searchParams.get("chartId") || "");
}

function setChartListFeedback(message = "") {
  if (!chartListFeedback) {
    return;
  }

  chartListFeedback.textContent = message;
  chartListFeedback.hidden = !message;
}

const recentActivityClock = {
  serverTimeMs: null,
  capturedAt: 0
};
const recentActivityWarnings = new Set();

function parseApiTimestamp(value) {
  const source = String(value || "").trim();
  if (!source) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)
    ? `${source.replace(" ", "T")}Z`
    : source;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function setRecentActivityServerTime(value) {
  const date = parseApiTimestamp(value);
  if (!date) {
    if (value && !recentActivityWarnings.has("INVALID_SERVER_TIME")) {
      recentActivityWarnings.add("INVALID_SERVER_TIME");
      console.warn("[recent-activity] invalid API server time", {
        code: "INVALID_SERVER_TIME"
      });
    }
    return false;
  }
  recentActivityClock.serverTimeMs = date.getTime();
  recentActivityClock.capturedAt = performance.now();
  return true;
}

function getRecentActivityNow() {
  if (!Number.isFinite(recentActivityClock.serverTimeMs)) {
    return null;
  }
  return recentActivityClock.serverTimeMs + Math.max(0, performance.now() - recentActivityClock.capturedAt);
}

function formatAbsolutePostedAt(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function getRecentActivityLabel(createdAt) {
  const now = getRecentActivityNow();
  const created = parseApiTimestamp(createdAt);
  if (!created) {
    const warningKey = `INVALID_VERSION_TIMESTAMP:${createdAt}`;
    if (createdAt && !recentActivityWarnings.has(warningKey)) {
      recentActivityWarnings.add(warningKey);
      console.warn("[recent-activity] invalid version timestamp was ignored", {
        code: "INVALID_VERSION_TIMESTAMP"
      });
    }
    return null;
  }
  if (now === null) {
    return null;
  }

  const ageMs = now - created.getTime();
  if (ageMs < 0) {
    const warningKey = `FUTURE_VERSION_TIMESTAMP:${createdAt}`;
    if (!recentActivityWarnings.has(warningKey)) {
      recentActivityWarnings.add(warningKey);
      console.warn("[recent-activity] future version timestamp was ignored", {
        code: "FUTURE_VERSION_TIMESTAMP"
      });
    }
    return null;
  }

  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  if (hours < 1) {
    return "1時間未満";
  }
  if (hours < 24) {
    return `${hours}時間前`;
  }
  if (hours < 192) {
    return `${Math.floor(hours / 24)}日前`;
  }
  return null;
}

function refreshRecentActivityBadges(root = document) {
  root.querySelectorAll?.(".recent-activity-badge[data-created-at]").forEach((badge) => {
    const createdAt = badge.dataset.createdAt || "";
    const created = parseApiTimestamp(createdAt);
    const label = getRecentActivityLabel(createdAt);
    if (!created || !label) {
      badge.hidden = true;
      badge.textContent = "";
      badge.removeAttribute("title");
      badge.removeAttribute("aria-label");
      return;
    }

    const absolute = formatAbsolutePostedAt(created);
    badge.hidden = false;
    badge.textContent = label;
    badge.title = `投稿日時 ${absolute}`;
    badge.setAttribute("aria-label", `${label}、投稿日時 ${absolute}`);
  });
}

function mountChartUi(data, root = chartList, options = {}) {
  if (!root) {
    return;
  }
  if (data && options.applyStoredThumbnails !== false) {
    window.applyStoredProgressThumbnails?.(data, root);
  }
  if (data && options.mountFavorites !== false) {
    window.mountFavoriteButtons?.(data, root);
  }
  window.scheduleProgressImageThumbnailMount?.(root);
  window.scheduleChartMiniViewMount?.(root);
  window.refreshBranchTreeOverlays?.(root);
  window.scheduleBranchTreeOverlayRefresh?.();
  refreshRecentActivityBadges(root);
  root.dispatchEvent(new CustomEvent("chart-ui:mounted", {
    bubbles: true,
    detail: {
      root,
      data: data || null,
      reason: options.reason || "render"
    }
  }));
}

window.BmsRecentActivity = {
  setServerTime: setRecentActivityServerTime,
  refresh: refreshRecentActivityBadges
};
window.mountChartUi = mountChartUi;

function getChartRenderMountReason(source) {
  const reasons = {
    initial: "initial",
    reload: "rerender",
    "favorite-filter": "favorites-rerender",
    "append-success": "append-success",
    "management-refresh": "management-refresh",
    "load-more": "append-complete",
    detail: "selected-detail"
  };
  return reasons[source] || "render";
}

if (typeof window.BmsChartRenderPipeline?.registerMountStage !== "function") {
  const error = new Error("The chart render pipeline is unavailable.");
  error.code = "CHART_RENDER_PIPELINE_UNAVAILABLE";
  throw error;
}
window.BmsChartRenderPipeline.registerMountStage({
  name: "common-mount",
  order: 400,
  required: true,
  run(context) {
    mountChartUi(context.data, context.target, {
      reason: getChartRenderMountReason(context.source),
      applyStoredThumbnails: false,
      mountFavorites: false
    });
  }
});

function updateChartListControls() {
  if (!chartListPagination || !loadMoreChartsButton) {
    return;
  }

  chartListPagination.hidden = false;
  if (chartListState.loading || chartListState.loadingMore) {
    loadMoreChartsButton.textContent = "読み込み中…";
    loadMoreChartsButton.disabled = true;
    chartListPagination.setAttribute("aria-busy", "true");
    return;
  }

  chartListPagination.setAttribute("aria-busy", "false");
  if (chartListState.loadMoreFailed) {
    loadMoreChartsButton.textContent = "再試行";
    loadMoreChartsButton.disabled = false;
    return;
  }

  if (chartListState.hasNext) {
    loadMoreChartsButton.textContent = `さらに${recentChartCount}件読み込む`;
    loadMoreChartsButton.disabled = false;
    return;
  }

  loadMoreChartsButton.textContent = "すべて表示しました";
  loadMoreChartsButton.disabled = true;
}

function renderLoading() {
  chartList.innerHTML = `<div class="list-status">読み込み中</div>`;
}

function appendRenderedCharts(data) {
  const previousCardCount = chartList.querySelectorAll(":scope > .chart-group").length;
  chartList.querySelectorAll(":scope > .appended-batch-boundary").forEach((boundary) => boundary.remove());
  chartList.querySelectorAll(":scope > .appended-batch-start").forEach((card) => {
    card.classList.remove("appended-batch-start");
  });

  const renderContext = window.renderCharts(data, {
    target: chartList,
    mode: "append",
    source: "load-more"
  });
  const addedCards = renderContext.renderedNodes.filter((node) => node.matches?.(".chart-group"));
  const firstAddedCard = addedCards[0] || null;
  const batchBoundary = firstAddedCard ? document.createElement("div") : null;
  if (firstAddedCard && batchBoundary) {
    firstAddedCard.classList.add("appended-batch-start");
    batchBoundary.className = "appended-batch-boundary";
    batchBoundary.dataset.appendedAfter = String(previousCardCount);
    batchBoundary.dataset.appendedCount = String(addedCards.length);
    batchBoundary.setAttribute("aria-hidden", "true");
    batchBoundary.innerHTML = '<span class="appended-batch-boundary-mark"></span>';
    chartList.insertBefore(batchBoundary, firstAddedCard);
  }
  return renderContext;
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
  window.renderCharts(renderData, {
    target: chartList,
    mode: "replace",
    source: "reload"
  });
  updateChartListControls();
  return renderData;
}

window.rerenderCurrentChartList = rerenderCurrentChartList;

async function loadCharts(options = {}) {
  const append = options.append === true;
  const selectedChartId = String(options.selectedChartId ?? getSelectedChartId());
  if (append && (chartListState.loading || chartListState.loadingMore || !chartListState.hasNext)) {
    return null;
  }

  chartListState.abortController?.abort();
  if (!append) {
    chartListState.query = "";
    chartListState.page = 0;
    chartListState.total = 0;
    chartListState.hasNext = false;
    chartListState.charts = [];
    chartListState.selectedChartId = selectedChartId;
    renderLoading();
  }
  chartListState.loadMoreFailed = false;

  const targetPage = append ? chartListState.page + 1 : 1;
  const requestSequence = chartListState.requestSequence + 1;
  const abortController = new AbortController();
  chartListState.requestSequence = requestSequence;
  chartListState.abortController = abortController;
  chartListState.loading = !append;
  chartListState.loadingMore = append;
  setChartListFeedback("");
  updateChartListControls();

  const searchParams = new URLSearchParams({
    page: String(targetPage),
    pageSize: String(recentChartCount)
  });
  if (selectedChartId) {
    searchParams.set("excludeChartId", selectedChartId);
  }

  try {
    const data = await apiRequest(`/api/charts?${searchParams.toString()}`, {
      signal: abortController.signal
    });
    if (requestSequence !== chartListState.requestSequence) {
      return null;
    }

    setRecentActivityServerTime(data?.serverTime);
    const existingIds = new Set(chartListState.charts.map(getChartEntryId));
    const nextCharts = (Array.isArray(data?.charts) ? data.charts : [])
      .filter((entry) => {
        const chartId = getChartEntryId(entry);
        return chartId
          && (!selectedChartId || chartId !== selectedChartId)
          && (!append || !existingIds.has(chartId));
      });

    chartListState.charts = append
      ? [...chartListState.charts, ...nextCharts]
      : nextCharts;
    chartListState.page = Number(data?.pagination?.page) || targetPage;
    chartListState.total = Number.isFinite(Number(data?.pagination?.total))
      ? Number(data.pagination.total)
      : chartListState.charts.length;
    chartListState.hasNext = data?.pagination?.hasNext === true;
    chartListState.loadMoreFailed = false;

    const renderData = {
      ...data,
      charts: append ? nextCharts : chartListState.charts,
      pagination: {
        ...data?.pagination,
        page: chartListState.page,
        pageSize: recentChartCount,
        total: chartListState.total,
        hasNext: chartListState.hasNext
      },
      query: { q: "" }
    };
    if (append) {
      if (nextCharts.length > 0) {
        appendRenderedCharts(renderData);
      }
    } else {
      window.renderCharts(renderData, {
        target: chartList,
        mode: "replace",
        source: "initial",
        selectedChartId
      });
    }

    setChartListFeedback(`${chartListState.charts.length}件表示`);
    return renderData;
  } catch (error) {
    if (error?.name === "AbortError" || requestSequence !== chartListState.requestSequence) {
      return null;
    }

    console.error("[api-charts-list] failed to load charts", {
      code: error?.code || "CHARTS_LIST_FAILED",
      page: targetPage,
      message: error?.detail || error?.message || String(error)
    });

    chartListState.loadMoreFailed = true;
    if (!append) {
      chartList.innerHTML = `<div class="list-status">最近の投稿を読み込めませんでした。</div>`;
      setChartListFeedback("一覧の取得に失敗しました。再試行できます。");
    } else {
      setChartListFeedback("追加の投稿を読み込めませんでした。表示中の投稿はそのままです。");
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

window.loadCharts = loadCharts;

loadMoreChartsButton?.addEventListener("click", () => {
  const append = chartListState.page > 0 && chartListState.charts.length > 0;
  void loadCharts({
    append,
    selectedChartId: chartListState.selectedChartId || getSelectedChartId()
  });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshRecentActivityBadges(document.querySelector("#list") || document);
  }
});

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
  formData.append("allowAppend", getPostStateSnapshot().effectiveAllowAppend ? "true" : "false");
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

  window.BmsPostErrorUi?.clearAll?.({ source: "api" });
  if (!validateRequiredFields()) {
    return;
  }

  setSubmitting(true);
  clearError();

  try {
    const turnstileToken = await window.BmsTurnstile?.getToken();
    if (!turnstileToken) {
      throw {
        code: "TURNSTILE_REQUIRED",
        message: "Turnstile認証を完了してください。",
        detail: "Turnstile token is unavailable."
      };
    }
    const created = await apiRequest("/api/charts", {
      method: "POST",
      headers: {
        "X-Turnstile-Token": turnstileToken
      },
      body: buildChartFormData()
    });

    window.BmsPostPreferences?.commitAfterSuccess?.({
      author: authorInput.value.trim(),
      password: passwordInput.value,
      saveAuthor: Boolean(saveAuthorInput?.checked),
      savePassword: Boolean(savePasswordInput?.checked)
    });
    window.BmsChartMetadataExtract?.reset?.();
    form.reset();
    resetAllowAppendForForm(false);
    window.BmsPostPreferences?.restore?.();
    clearRequiredFieldIndicators();
    resetDifficultySelector();
    resetProgressMap();
    window.BmsFormMiniView?.clear();
    progressInput.value = "100";
    applyRejectedProgressState();
    window.BmsTurnstile?.reset();
    window.BmsPostFormUi?.markClean?.();
    window.BmsPostFormUi?.close?.();
    window.BmsPostErrorUi?.clearAll?.();
    if (window.BmsChartDetail?.showCreatedVersion) {
      await window.BmsChartDetail.showCreatedVersion({
        chartId: created?.chartId,
        versionId: created?.versionId,
        message: "投稿しました。"
      });
    } else {
      await loadCharts({ selectedChartId: created?.chartId });
    }
  } catch (error) {
    console.error("[api-chart-create] failed to create chart", {
      code: error?.code || "CHART_CREATE_FAILED",
      stage: "submit_initial",
      status: Number(error?.status) || null,
      errorType: error?.name || typeof error
    });
    if (window.BmsPostErrorUi?.showApiError) {
      window.BmsPostErrorUi.showApiError(error, { mode: "initial" });
    } else {
      showError(error);
    }
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

  clearInitialFileMetadata();

  if (!file) {
    setFieldInvalid(fileInput, false);
    window.BmsPostFileUi?.setEmpty?.();
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
difficultyManualInput.addEventListener("blur", (event) => {
  if (difficultyPicker.contains(event.relatedTarget)) {
    return;
  }
  collapseDifficultyPickerIfSelected();
});
difficultyManualInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  if (collapseDifficultyPickerIfSelected()) {
    difficultyChangeButton?.focus();
  }
});
difficultyChangeButton?.addEventListener("click", () => {
  setDifficultyPickerExpanded(true, { focus: true });
});

progressInput.addEventListener("input", () => {
  if (progressInput.getAttribute("aria-invalid") === "true") {
    validateProgress();
  }

  updateCompleteButtonState();
});

isRejectedInput.addEventListener("change", () => {
  if (isRejectedInput.checked && !postStateUi.initialRejectedChoiceInitialized) {
    postStateUi.initialRejectedChoice = false;
    postStateUi.initialRejectedChoiceInitialized = true;
  }
  applyRejectedProgressState();
  applyRejectedProgressMapState();
  updatePostStateUi();
  clearError();
});

allowAppendInput?.addEventListener("change", () => {
  const state = getPostStateSnapshot();
  if (state.isAllowAppendConfigurable) {
    if (state.isAppend) {
      postStateUi.appendCompletedChoice = allowAppendInput.checked;
      postStateUi.appendCompletedChoiceInitialized = true;
    } else {
      postStateUi.initialRejectedChoice = allowAppendInput.checked;
      postStateUi.initialRejectedChoiceInitialized = true;
    }
  }
  updatePostStateUi();
  clearError();
});

form.addEventListener("reset", () => {
  queueMicrotask(() => resetAllowAppendForForm(false, { mode: "initial" }));
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

window.addEventListener("bms:themechange", () => {
  drawDensityChart();
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitChart();
});

resetDifficultySelector();
resetProgressMap();
resetAllowAppendForForm(false);
applyRejectedProgressState();
updateChartListControls();

window.BmsDifficultyUi = {
  collapseIfSelected: collapseDifficultyPickerIfSelected,
  expand: () => setDifficultyPickerExpanded(true),
  isExpanded: () => difficultyPickerExpanded
};

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
  return loadCharts({ selectedChartId: getSelectedChartId() });
};
if (document.readyState === "complete") {
  window.setTimeout(startInitialChartLoad, 0);
} else {
  window.addEventListener("load", startInitialChartLoad, { once: true });
}
