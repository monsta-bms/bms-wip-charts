(function initializeChartMetadataExtract(globalScope, factory) {
  "use strict";

  const api = factory(globalScope);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope?.document) {
    globalScope.BmsChartMetadataExtract = Object.freeze(api);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, (globalScope) => {
  "use strict";

  const STORAGE_KEY = "bms-wip-charts:chart-metadata-extract:v1";
  const MAX_SOURCE_LENGTH = 128 * 1024;
  const SOURCE_FIELDS = Object.freeze([
    { key: "title", allowChartName: true },
    { key: "subtitle", allowChartName: true },
    { key: "artist", allowChartName: false },
    { key: "subartist", allowChartName: false }
  ]);
  const SOURCE_FIELD_KEYS = new Set(SOURCE_FIELDS.map((field) => field.key));
  const MARKER_SPECS = Object.freeze([
    { token: "charter", punctuation: ":：;；", allowWhitespace: false },
    { token: "chart", punctuation: ":：;；", allowWhitespace: false },
    { token: "notes", punctuation: ":：;；", allowWhitespace: false },
    { token: "note", punctuation: ":：;；", allowWhitespace: false },
    { token: "obj", punctuation: ":：.．;；@", allowWhitespace: true }
  ]);

  function isHorizontalWhitespace(character) {
    return character === " " || character === "\t" || character === "\u3000";
  }

  function skipHorizontalWhitespace(value, start, limit = value.length) {
    let index = start;
    while (index < limit && isHorizontalWhitespace(value[index])) {
      index += 1;
    }
    return index;
  }

  function trimHorizontalEndIndex(value, end = value.length) {
    let index = Math.min(end, value.length);
    while (index > 0 && isHorizontalWhitespace(value[index - 1])) {
      index -= 1;
    }
    return index;
  }

  function isAsciiWordCharacter(character) {
    if (!character) return false;
    const code = character.charCodeAt(0);
    return (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || character === "_";
  }

  function candidateId(candidate) {
    return `${candidate.kind}:${candidate.start}:${candidate.end}:${candidate.raw}`;
  }

  function matchAuthorMarkerAt(value, start) {
    if (start > 0 && isAsciiWordCharacter(value[start - 1])) {
      return null;
    }

    for (const spec of MARKER_SPECS) {
      const tokenEnd = start + spec.token.length;
      if (tokenEnd > value.length || value.slice(start, tokenEnd).toLowerCase() !== spec.token) {
        continue;
      }

      let cursor = tokenEnd;
      const whitespaceStart = cursor;
      cursor = skipHorizontalWhitespace(value, cursor);
      const hadWhitespace = cursor > whitespaceStart;
      const delimiter = value[cursor] || "";

      if (spec.punctuation.includes(delimiter)) {
        cursor += 1;
        cursor = skipHorizontalWhitespace(value, cursor);
        return {
          start,
          markerEnd: cursor,
          nameStart: cursor,
          token: spec.token
        };
      }

      if (spec.allowWhitespace && hadWhitespace) {
        return {
          start,
          markerEnd: cursor,
          nameStart: cursor,
          token: spec.token
        };
      }
    }

    return null;
  }

  function findRelatedSeparator(value, markerStart) {
    let cursor = markerStart;
    while (cursor > 0 && isHorizontalWhitespace(value[cursor - 1])) {
      cursor -= 1;
    }
    const slashIndex = cursor - 1;
    if (slashIndex < 0 || value[slashIndex] !== "/") {
      return null;
    }

    return {
      slashIndex,
      hadLeftSpace: slashIndex > 0 && isHorizontalWhitespace(value[slashIndex - 1]),
      hadRightSpace: slashIndex + 1 < markerStart
    };
  }

  function findAuthorMarkers(value) {
    const markers = [];
    for (let index = 0; index < value.length; index += 1) {
      const marker = matchAuthorMarkerAt(value, index);
      if (!marker) continue;
      marker.relatedSeparator = findRelatedSeparator(value, marker.start);
      markers.push(marker);
      index += Math.max(0, marker.token.length - 1);
    }
    return markers;
  }

  function hasDelimiterInside(value, start, end, opening, closing) {
    for (let index = start; index < end; index += 1) {
      if (value[index] === opening || value[index] === closing) {
        return true;
      }
    }
    return false;
  }

  function findMatchingHyphenStart(value, end, runLength) {
    let cursor = end - runLength;
    while (cursor > 0) {
      cursor -= 1;
      if (value[cursor] !== "-") continue;
      let runStart = cursor;
      while (runStart > 0 && value[runStart - 1] === "-") {
        runStart -= 1;
      }
      let runEnd = cursor + 1;
      while (runEnd < end - runLength && value[runEnd] === "-") {
        runEnd += 1;
      }
      const openingLength = runEnd - runStart;
      cursor = runStart;
      if (openingLength !== runLength) continue;
      const inner = value.slice(runEnd, end - runLength);
      if (inner.trim().length > 0) {
        return runStart;
      }
    }
    return -1;
  }

  function findChartCandidateAtEnd(value, boundary) {
    const end = trimHorizontalEndIndex(value, boundary);
    if (end <= 1) return null;

    const closing = value[end - 1];
    let start = -1;
    if (closing === "]") {
      start = value.lastIndexOf("[", end - 2);
      if (start < 0 || hasDelimiterInside(value, start + 1, end - 1, "[", "]")) return null;
    } else if (closing === ")") {
      start = value.lastIndexOf("(", end - 2);
      if (start < 0 || hasDelimiterInside(value, start + 1, end - 1, "(", ")")) return null;
    } else if (closing === "ー") {
      start = value.lastIndexOf("ー", end - 2);
      if (start < 0 || value.slice(start + 1, end - 1).includes("ー")) return null;
    } else if (closing === "-") {
      let trailingStart = end - 1;
      while (trailingStart > 0 && value[trailingStart - 1] === "-") {
        trailingStart -= 1;
      }
      const runLength = end - trailingStart;
      if (runLength !== 1 && runLength !== 2) return null;
      start = findMatchingHyphenStart(value, end, runLength);
      if (start < 0) return null;
    } else {
      return null;
    }

    const raw = value.slice(start, end);
    const wrapperLength = closing === "-" && raw.startsWith("--") && raw.endsWith("--") ? 2 : 1;
    const inner = raw.slice(wrapperLength, -wrapperLength);
    if (!inner || inner.trim().length === 0) {
      return null;
    }

    const candidate = {
      kind: "chart",
      start,
      end,
      raw,
      transferValue: raw
    };
    candidate.id = candidateId(candidate);
    return candidate;
  }

  function collectChartCandidates(value, markers) {
    const byRange = new Map();
    const boundaries = [value.length, ...markers.map((marker) => marker.start)];
    for (const initialBoundary of boundaries) {
      let boundary = initialBoundary;
      while (boundary > 0) {
        const candidate = findChartCandidateAtEnd(value, boundary);
        if (!candidate) break;
        byRange.set(`${candidate.start}:${candidate.end}`, candidate);
        if (candidate.start >= boundary) break;
        boundary = candidate.start;
      }
    }
    return Array.from(byRange.values()).sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function collectAuthorCandidates(value, markers, chartCandidates) {
    const candidates = [];
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      let nameEnd = value.length;
      const nextMarker = markers[index + 1];
      if (nextMarker) {
        nameEnd = nextMarker.relatedSeparator?.slashIndex ?? nextMarker.start;
      }
      for (const chartCandidate of chartCandidates) {
        if (chartCandidate.start >= marker.nameStart && chartCandidate.start < nameEnd) {
          nameEnd = chartCandidate.start;
        }
      }

      const nameStart = skipHorizontalWhitespace(value, marker.nameStart, nameEnd);
      const trimmedNameEnd = trimHorizontalEndIndex(value, nameEnd);
      if (nameStart >= trimmedNameEnd) continue;

      const name = value.slice(nameStart, trimmedNameEnd);
      if (name.trim().length === 0) continue;

      const candidate = {
        kind: "author",
        start: marker.start,
        end: trimmedNameEnd,
        raw: value.slice(marker.start, trimmedNameEnd),
        transferValue: name.trim(),
        relatedSeparator: marker.relatedSeparator ? { ...marker.relatedSeparator } : null
      };
      candidate.id = candidateId(candidate);
      candidates.push(candidate);
    }
    return candidates;
  }

  function parseCandidates(value, sourceKey) {
    const normalizedValue = String(value || "");
    if (!SOURCE_FIELD_KEYS.has(sourceKey) || normalizedValue.length > MAX_SOURCE_LENGTH) {
      return [];
    }

    const markers = findAuthorMarkers(normalizedValue);
    const allowChartName = sourceKey === "title" || sourceKey === "subtitle";
    const chartCandidates = allowChartName ? collectChartCandidates(normalizedValue, markers) : [];
    const authorCandidates = collectAuthorCandidates(normalizedValue, markers, chartCandidates);
    return [...chartCandidates, ...authorCandidates]
      .sort((left, right) => left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind));
  }

  function removeCandidateRange(value, start, end) {
    const before = value.slice(0, start);
    const after = value.slice(end);
    const leftEnd = trimHorizontalEndIndex(before);
    const rightStart = skipHorizontalWhitespace(after, 0);
    const hadBoundarySpace = leftEnd < before.length || rightStart > 0;
    const left = before.slice(0, leftEnd);
    const right = after.slice(rightStart);
    const joiner = left && right && hadBoundarySpace ? " " : "";
    const nextValue = `${left}${joiner}${right}`;
    const rightOriginalStart = end + rightStart;

    return {
      value: nextValue,
      mapIndex(index) {
        if (index < left.length) return index;
        if (index >= rightOriginalStart) {
          return left.length + joiner.length + index - rightOriginalStart;
        }
        return -1;
      }
    };
  }

  function removeSeparatorRange(value, slashIndex, spacing = {}) {
    let rangeStart = slashIndex;
    let rangeEnd = slashIndex + 1;
    while (rangeStart > 0 && isHorizontalWhitespace(value[rangeStart - 1])) {
      rangeStart -= 1;
    }
    while (rangeEnd < value.length && isHorizontalWhitespace(value[rangeEnd])) {
      rangeEnd += 1;
    }

    const left = value.slice(0, rangeStart);
    const right = value.slice(rangeEnd);
    const hadSpace = Boolean(spacing.hadLeftSpace || spacing.hadRightSpace || rangeStart < slashIndex || rangeEnd > slashIndex + 1);
    const joiner = left && right && hadSpace ? " " : "";
    const nextValue = left
      ? right ? `${left}${joiner}${right}` : left.trimEnd()
      : right.trimStart();

    return {
      value: nextValue,
      mapIndex(index) {
        if (index < rangeStart) return index;
        if (index >= rangeEnd) return left.length + joiner.length + index - rangeEnd;
        return -1;
      }
    };
  }

  function defaultPreferences() {
    return {
      title: true,
      subtitle: true,
      artist: true,
      subartist: true
    };
  }

  function errorType(error) {
    return error instanceof Error ? error.name : typeof error;
  }

  function logSafeFailure(code, stage, error) {
    if (!globalScope?.console?.warn) return;
    globalScope.console.warn("[chart-metadata-extract] operation failed", {
      code,
      stage,
      errorType: errorType(error)
    });
  }

  function readPreferences() {
    const defaults = defaultPreferences();
    try {
      const storage = globalScope?.localStorage;
      if (!storage) return defaults;
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || typeof parsed.fields !== "object") {
        throw new TypeError("Stored candidate visibility settings are invalid.");
      }
      const fields = {};
      for (const key of SOURCE_FIELD_KEYS) {
        if (typeof parsed.fields[key] !== "boolean") {
          throw new TypeError("Stored candidate visibility field is invalid.");
        }
        fields[key] = parsed.fields[key];
      }
      return fields;
    } catch (error) {
      logSafeFailure("CHART_METADATA_STORAGE_READ_FAILED", "read-visibility", error);
      return defaults;
    }
  }

  const browserState = {
    initialized: false,
    suspended: false,
    internalMutationDepth: 0,
    fields: new Map(),
    preferences: defaultPreferences(),
    operations: new Map(),
    destinations: new Map(),
    nextOperationId: 1,
    liveRegion: null,
    form: null
  };

  function writePreferences() {
    try {
      const storage = globalScope?.localStorage;
      if (!storage) return;
      storage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        fields: { ...browserState.preferences }
      }));
    } catch (error) {
      logSafeFailure("CHART_METADATA_STORAGE_WRITE_FAILED", "write-visibility", error);
    }
  }

  function appendDescribedBy(element, id) {
    if (!element || !id) return;
    const values = new Set((element.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    values.add(id);
    element.setAttribute("aria-describedby", Array.from(values).join(" "));
  }

  function createButton(text, className, ariaLabel) {
    const button = globalScope.document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    return button;
  }

  function createPanel(fieldState) {
    const panel = globalScope.document.createElement("div");
    panel.className = "metadata-candidate-panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "メタ情報候補の操作");

    const previousButton = createButton("←", "metadata-candidate-button metadata-candidate-previous", "前の候補");
    const candidateText = globalScope.document.createElement("output");
    candidateText.className = "metadata-candidate-text";
    candidateText.setAttribute("aria-live", "polite");
    const transferButton = createButton("転記して除去", "metadata-candidate-button metadata-candidate-transfer");
    const removeButton = createButton("除去のみ", "metadata-candidate-button metadata-candidate-remove");
    const undoButton = createButton("元に戻す", "metadata-candidate-button metadata-candidate-undo");
    const closeButton = createButton("×", "metadata-candidate-button metadata-candidate-close", "候補操作を閉じる");
    const nextButton = createButton("→", "metadata-candidate-button metadata-candidate-next", "次の候補");

    panel.append(previousButton, candidateText, transferButton, removeButton, undoButton, closeButton, nextButton);
    fieldState.host.replaceChildren(panel);
    fieldState.panel = panel;
    fieldState.previousButton = previousButton;
    fieldState.candidateText = candidateText;
    fieldState.transferButton = transferButton;
    fieldState.removeButton = removeButton;
    fieldState.undoButton = undoButton;
    fieldState.closeButton = closeButton;
    fieldState.nextButton = nextButton;

    previousButton.addEventListener("click", () => moveSelection(fieldState, -1));
    nextButton.addEventListener("click", () => moveSelection(fieldState, 1));
    transferButton.addEventListener("click", () => applyCandidate(fieldState, { transfer: true }));
    removeButton.addEventListener("click", () => applyCandidate(fieldState, { transfer: false }));
    undoButton.addEventListener("click", () => undoField(fieldState));
    closeButton.addEventListener("click", () => closeFieldPanel(fieldState, { restoreFocus: true }));
  }

  function getDestinationState(destinationId) {
    let state = browserState.destinations.get(destinationId);
    if (!state) {
      state = {
        element: globalScope.document.querySelector(`#${destinationId}`),
        ownerOperationId: null,
        revision: 0,
        highlightTimer: 0
      };
      browserState.destinations.set(destinationId, state);
    }
    return state;
  }

  function initializeBrowser() {
    if (browserState.initialized || !globalScope?.document) return browserState.initialized;
    const form = globalScope.document.querySelector("#chartForm");
    if (!form) return false;

    browserState.form = form;
    browserState.preferences = readPreferences();

    for (const config of SOURCE_FIELDS) {
      const input = globalScope.document.querySelector(`#${config.key}`);
      const container = input?.closest(".metadata-field");
      const wrapper = container?.querySelector(".metadata-input-wrap");
      const host = container?.querySelector(".metadata-candidate-host");
      const reopenButton = container?.querySelector(".metadata-bubble-reopen");
      const status = container?.querySelector(".metadata-candidate-status");
      if (!input || !container || !wrapper || !host || !reopenButton || !status) {
        logSafeFailure("CHART_METADATA_FIELD_INIT_FAILED", `initialize-${config.key}`, new Error("Required metadata field DOM is missing."));
        continue;
      }

      const fieldState = {
        ...config,
        input,
        container,
        wrapper,
        host,
        reopenButton,
        status,
        candidates: [],
        selectedId: null,
        activeSeparators: [],
        undo: null,
        composing: false,
        debounceTimer: 0
      };
      createPanel(fieldState);
      appendDescribedBy(input, status.id);
      reopenButton.addEventListener("click", () => openFieldPanel(fieldState));
      container.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || fieldState.host.hidden || fieldState.panel.classList.contains("is-undo-only")) return;
        event.preventDefault();
        closeFieldPanel(fieldState);
      });
      input.addEventListener("compositionstart", () => {
        fieldState.composing = true;
        discardFieldUndo(fieldState);
        fieldState.activeSeparators = [];
        fieldState.candidates = [];
        fieldState.selectedId = null;
        renderField(fieldState);
      });
      input.addEventListener("compositionend", () => {
        fieldState.composing = false;
        refreshField(fieldState, { selectionMode: "initial" });
      });
      input.addEventListener("input", () => handleSourceInput(fieldState));
      browserState.fields.set(config.key, fieldState);
    }

    for (const destinationId of ["chartName", "author"]) {
      const destinationState = getDestinationState(destinationId);
      destinationState.element?.addEventListener("input", () => {
        if (browserState.internalMutationDepth > 0) return;
        destinationState.revision += 1;
        destinationState.ownerOperationId = null;
      });
    }

    const liveRegion = globalScope.document.createElement("p");
    liveRegion.className = "visually-hidden";
    liveRegion.id = "chartMetadataExtractStatus";
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    form.append(liveRegion);
    browserState.liveRegion = liveRegion;
    form.addEventListener("reset", () => reset());
    browserState.initialized = true;
    reset();
    return true;
  }

  function selectedCandidate(fieldState) {
    return fieldState.candidates.find((candidate) => candidate.id === fieldState.selectedId) || null;
  }

  function separatorCandidate(separator) {
    const candidate = {
      kind: "separator",
      start: separator.slashIndex,
      end: separator.slashIndex + 1,
      raw: "/",
      transferValue: "",
      separatorId: separator.id,
      hadLeftSpace: separator.hadLeftSpace,
      hadRightSpace: separator.hadRightSpace
    };
    candidate.id = `separator:${separator.id}:${separator.slashIndex}`;
    return candidate;
  }

  function fieldCandidates(fieldState) {
    fieldState.activeSeparators = fieldState.activeSeparators.filter((separator) => (
      separator.slashIndex >= 0 && fieldState.input.value[separator.slashIndex] === "/"
    ));
    const parsed = parseCandidates(fieldState.input.value, fieldState.key);
    const separators = fieldState.activeSeparators.map(separatorCandidate);
    return [...parsed, ...separators]
      .sort((left, right) => left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind));
  }

  function chooseInitialCandidate(candidates) {
    const authors = candidates.filter((candidate) => candidate.kind === "author");
    if (authors.length > 0) return authors[authors.length - 1];
    const charts = candidates.filter((candidate) => candidate.kind === "chart");
    return charts[charts.length - 1] || candidates[candidates.length - 1] || null;
  }

  function refreshField(fieldState, { selectionMode = "preserve", selectedId = null } = {}) {
    fieldState.candidates = fieldCandidates(fieldState);
    let selected = null;
    if (selectedId) {
      selected = fieldState.candidates.find((candidate) => candidate.id === selectedId) || null;
    } else if (selectionMode === "preserve") {
      selected = selectedCandidate(fieldState);
    }
    if (!selected && selectionMode === "after-operation") {
      selected = fieldState.candidates[fieldState.candidates.length - 1] || null;
    }
    if (!selected) {
      selected = chooseInitialCandidate(fieldState.candidates);
    }
    fieldState.selectedId = selected?.id || null;
    renderField(fieldState);
  }

  function renderField(fieldState) {
    const candidate = selectedCandidate(fieldState);
    const hasCandidates = fieldState.candidates.length > 0;
    const hasUndo = Boolean(fieldState.undo);
    const shouldOpen = hasCandidates && browserState.preferences[fieldState.key];
    const undoOnly = !hasCandidates && hasUndo;

    fieldState.input.toggleAttribute("data-metadata-candidate", hasCandidates);
    fieldState.container.toggleAttribute("data-metadata-candidate", hasCandidates);
    fieldState.wrapper.classList.toggle("has-metadata-reopen", hasCandidates && !shouldOpen);
    fieldState.reopenButton.hidden = !hasCandidates || shouldOpen;
    fieldState.host.hidden = !shouldOpen && !undoOnly;
    fieldState.panel.classList.toggle("is-undo-only", undoOnly);
    fieldState.status.textContent = candidate?.raw || "";

    fieldState.previousButton.hidden = undoOnly;
    fieldState.candidateText.hidden = undoOnly;
    fieldState.transferButton.hidden = undoOnly || candidate?.kind === "separator";
    fieldState.removeButton.hidden = undoOnly;
    fieldState.closeButton.hidden = undoOnly;
    fieldState.nextButton.hidden = undoOnly;
    fieldState.undoButton.disabled = !hasUndo;

    if (candidate) {
      const index = fieldState.candidates.indexOf(candidate);
      fieldState.candidateText.textContent = candidate.raw;
      fieldState.previousButton.disabled = index <= 0;
      fieldState.nextButton.disabled = index < 0 || index >= fieldState.candidates.length - 1;
      fieldState.transferButton.disabled = candidate.kind === "separator";
      if (globalScope.document.activeElement === fieldState.input && typeof fieldState.input.setSelectionRange === "function") {
        try {
          fieldState.input.setSelectionRange(candidate.start, candidate.end);
        } catch (error) {
          logSafeFailure("CHART_METADATA_SELECTION_FAILED", `select-${fieldState.key}`, error);
        }
      }
    } else {
      fieldState.candidateText.textContent = "";
      fieldState.previousButton.disabled = true;
      fieldState.nextButton.disabled = true;
    }
  }

  function moveSelection(fieldState, direction) {
    const current = selectedCandidate(fieldState);
    const index = current ? fieldState.candidates.indexOf(current) : -1;
    const nextIndex = Math.max(0, Math.min(fieldState.candidates.length - 1, index + direction));
    if (nextIndex === index || nextIndex < 0) return;
    fieldState.selectedId = fieldState.candidates[nextIndex].id;
    renderField(fieldState);
  }

  function closeFieldPanel(fieldState, { restoreFocus = false } = {}) {
    browserState.preferences[fieldState.key] = false;
    writePreferences();
    renderField(fieldState);
    if (restoreFocus && !fieldState.reopenButton.hidden) {
      fieldState.reopenButton.focus({ preventScroll: true });
    }
  }

  function openFieldPanel(fieldState) {
    browserState.preferences[fieldState.key] = true;
    writePreferences();
    renderField(fieldState);
  }

  function discardFieldUndo(fieldState) {
    fieldState.undo = null;
  }

  function handleSourceInput(fieldState) {
    if (browserState.internalMutationDepth > 0 || browserState.suspended) return;
    discardFieldUndo(fieldState);
    fieldState.activeSeparators = [];
    fieldState.candidates = [];
    fieldState.selectedId = null;
    renderField(fieldState);
    if (fieldState.composing) return;
    globalScope.clearTimeout(fieldState.debounceTimer);
    fieldState.debounceTimer = globalScope.setTimeout(() => {
      refreshField(fieldState, { selectionMode: "initial" });
    }, 120);
  }

  function dispatchInternalInput(element) {
    if (!element) return;
    element.dispatchEvent(new globalScope.Event("input", { bubbles: true }));
  }

  function mutateInputs(mutations) {
    browserState.internalMutationDepth += 1;
    try {
      for (const mutation of mutations) {
        mutation.element.value = mutation.value;
        dispatchInternalInput(mutation.element);
      }
    } finally {
      browserState.internalMutationDepth -= 1;
    }
  }

  function transformSeparators(separators, mapIndex) {
    return separators.flatMap((separator) => {
      const nextIndex = mapIndex(separator.slashIndex);
      return nextIndex >= 0 ? [{ ...separator, slashIndex: nextIndex }] : [];
    });
  }

  function activateRelatedSeparator(fieldState, candidate, mapIndex) {
    if (candidate.kind !== "author" || !candidate.relatedSeparator) return;
    const slashIndex = mapIndex(candidate.relatedSeparator.slashIndex);
    if (slashIndex < 0) return;
    const duplicate = fieldState.activeSeparators.some((separator) => separator.slashIndex === slashIndex);
    if (duplicate) return;
    fieldState.activeSeparators.push({
      id: `${fieldState.key}-${browserState.nextOperationId}-separator`,
      slashIndex,
      hadLeftSpace: candidate.relatedSeparator.hadLeftSpace,
      hadRightSpace: candidate.relatedSeparator.hadRightSpace
    });
  }

  function destinationIdForCandidate(candidate) {
    if (candidate.kind === "chart") return "chartName";
    if (candidate.kind === "author") return "author";
    return null;
  }

  function snapshotField(fieldState, operationId) {
    return {
      sourceValue: fieldState.input.value,
      candidates: fieldState.candidates.map((candidate) => ({
        ...candidate,
        relatedSeparator: candidate.relatedSeparator ? { ...candidate.relatedSeparator } : null
      })),
      selectedId: fieldState.selectedId,
      bubbleOpen: browserState.preferences[fieldState.key],
      activeSeparators: fieldState.activeSeparators.map((separator) => ({ ...separator })),
      operationId,
      destinationId: null
    };
  }

  function createDestinationOperation(destinationId, transferValue, operationId) {
    const destinationState = getDestinationState(destinationId);
    if (!destinationState.element) return null;
    const operation = {
      id: operationId,
      active: true,
      destinationId,
      beforeOwnerId: destinationState.ownerOperationId,
      beforeValue: destinationState.element.value,
      writtenValue: transferValue,
      afterRevision: destinationState.revision + 1
    };
    destinationState.revision = operation.afterRevision;
    destinationState.ownerOperationId = operationId;
    browserState.operations.set(operationId, operation);
    return operation;
  }

  function highlightDestination(destinationId) {
    const destinationState = getDestinationState(destinationId);
    if (!destinationState.element) return;
    globalScope.clearTimeout(destinationState.highlightTimer);
    destinationState.element.setAttribute("data-metadata-transfer", "true");
    destinationState.highlightTimer = globalScope.setTimeout(() => {
      destinationState.element.removeAttribute("data-metadata-transfer");
    }, 900);
  }

  function applyCandidate(fieldState, { transfer }) {
    const candidate = selectedCandidate(fieldState);
    if (!candidate || (transfer && candidate.kind === "separator")) return;

    const operationId = `metadata-operation-${browserState.nextOperationId}`;
    browserState.nextOperationId += 1;
    const snapshot = snapshotField(fieldState, operationId);
    let destinationOperation = null;
    let destinationState = null;

    if (transfer) {
      const destinationId = destinationIdForCandidate(candidate);
      if (destinationId) {
        destinationOperation = createDestinationOperation(destinationId, candidate.transferValue, operationId);
        destinationState = getDestinationState(destinationId);
        snapshot.destinationId = destinationId;
      }
    }

    const removal = candidate.kind === "separator"
      ? removeSeparatorRange(fieldState.input.value, candidate.start, candidate)
      : removeCandidateRange(fieldState.input.value, candidate.start, candidate.end);

    fieldState.activeSeparators = transformSeparators(fieldState.activeSeparators, removal.mapIndex);
    if (candidate.kind === "separator") {
      fieldState.activeSeparators = fieldState.activeSeparators.filter((separator) => separator.id !== candidate.separatorId);
    } else {
      activateRelatedSeparator(fieldState, candidate, removal.mapIndex);
    }

    const mutations = [{ element: fieldState.input, value: removal.value }];
    if (destinationOperation && destinationState?.element) {
      mutations.unshift({ element: destinationState.element, value: destinationOperation.writtenValue });
    }
    fieldState.undo = snapshot;
    mutateInputs(mutations);
    refreshField(fieldState, { selectionMode: "after-operation" });
    if (snapshot.destinationId) {
      highlightDestination(snapshot.destinationId);
    }
  }

  function findPreviousActiveOperation(operation) {
    let beforeOwnerId = operation.beforeOwnerId;
    let fallbackValue = operation.beforeValue;
    while (beforeOwnerId) {
      const previous = browserState.operations.get(beforeOwnerId);
      if (!previous) break;
      if (previous.active) {
        return { operation: previous, value: previous.writtenValue };
      }
      fallbackValue = previous.beforeValue;
      beforeOwnerId = previous.beforeOwnerId;
    }
    return { operation: null, value: fallbackValue };
  }

  function restoreDestinationForUndo(snapshot) {
    if (!snapshot.destinationId) return true;
    const operation = browserState.operations.get(snapshot.operationId);
    const destinationState = getDestinationState(snapshot.destinationId);
    if (!operation || !destinationState.element) return false;

    const isCurrent = operation.active
      && destinationState.ownerOperationId === operation.id
      && destinationState.element.value === operation.writtenValue;
    operation.active = false;
    if (!isCurrent) return false;

    const previous = findPreviousActiveOperation(operation);
    destinationState.revision += 1;
    destinationState.ownerOperationId = previous.operation?.id || null;
    if (previous.operation) {
      previous.operation.afterRevision = destinationState.revision;
    }
    mutateInputs([{ element: destinationState.element, value: previous.value }]);
    return true;
  }

  function announce(message) {
    if (!browserState.liveRegion) return;
    browserState.liveRegion.textContent = "";
    globalScope.requestAnimationFrame(() => {
      browserState.liveRegion.textContent = message;
    });
  }

  function undoField(fieldState) {
    const snapshot = fieldState.undo;
    if (!snapshot) return;
    const destinationRestored = restoreDestinationForUndo(snapshot);
    fieldState.undo = null;
    fieldState.activeSeparators = snapshot.activeSeparators.map((separator) => ({ ...separator }));
    browserState.preferences[fieldState.key] = snapshot.bubbleOpen;
    writePreferences();
    mutateInputs([{ element: fieldState.input, value: snapshot.sourceValue }]);
    refreshField(fieldState, { selectionMode: "preserve", selectedId: snapshot.selectedId });
    if (snapshot.destinationId && !destinationRestored) {
      announce("転記先は後から変更されたため、そのまま維持しました。");
    }
  }

  function clearFieldState(fieldState) {
    globalScope.clearTimeout(fieldState.debounceTimer);
    fieldState.debounceTimer = 0;
    fieldState.candidates = [];
    fieldState.selectedId = null;
    fieldState.activeSeparators = [];
    fieldState.undo = null;
    fieldState.composing = false;
    fieldState.input.removeAttribute("data-metadata-candidate");
    fieldState.container.removeAttribute("data-metadata-candidate");
    renderField(fieldState);
  }

  function reset() {
    if (!browserState.initialized && !initializeBrowser()) return;
    for (const fieldState of browserState.fields.values()) {
      clearFieldState(fieldState);
    }
    for (const destinationState of browserState.destinations.values()) {
      globalScope.clearTimeout(destinationState.highlightTimer);
      destinationState.highlightTimer = 0;
      destinationState.ownerOperationId = null;
      destinationState.element?.removeAttribute("data-metadata-transfer");
    }
    browserState.operations.clear();
    if (browserState.liveRegion) browserState.liveRegion.textContent = "";
  }

  function mount() {
    if (!initializeBrowser()) return false;
    const appendMode = globalScope.document.querySelector(".submit-panel")?.classList.contains("is-append-mode");
    if (browserState.suspended || appendMode) {
      reset();
      return false;
    }
    for (const fieldState of browserState.fields.values()) {
      fieldState.activeSeparators = [];
      fieldState.undo = null;
      refreshField(fieldState, { selectionMode: "initial" });
    }
    return true;
  }

  function suspend() {
    if (!initializeBrowser()) return;
    browserState.suspended = true;
    reset();
  }

  function resume() {
    if (!initializeBrowser()) return;
    browserState.suspended = false;
    reset();
  }

  if (globalScope?.document) {
    initializeBrowser();
  }

  return Object.freeze({
    limits: Object.freeze({ maxSourceLength: MAX_SOURCE_LENGTH }),
    mount,
    parseCandidates,
    removeCandidateRange,
    removeSeparatorRange,
    reset,
    resume,
    suspend
  });
});
