(() => {
  const listElement = document.querySelector("#chartList");
  const dialog = document.querySelector("#chartMiniViewDialog");
  const dialogCanvas = document.querySelector("#chartMiniViewDialogCanvas");
  const dialogTitle = document.querySelector("#chartMiniViewDialogTitle");
  const dialogSummary = document.querySelector("#chartMiniViewDialogSummary");
  const payloadCache = new Map();
  const pendingRequests = new Map();
  const requestQueue = [];
  const maxConcurrentRequests = 4;
  let activeRequests = 0;
  let observer = null;
  let scheduled = false;
  let lastDialogTrigger = null;
  let rangePreview = null;
  let rangePreviewCanvas = null;
  let rangePreviewLabel = null;
  let rangePreviewMeta = null;
  let activeRangeTarget = null;
  let activeRangeIndex = -1;
  let rangePreviewPinned = false;
  let rangePreviewRequestId = 0;

  if (!listElement) {
    return;
  }

  function apiUrl(path) {
    const base = typeof API_BASE_URL === "string" ? API_BASE_URL : window.location.origin;
    return new URL(path, `${base.replace(/\/$/, "")}/`).href;
  }

  function decodeBase64Bytes(value) {
    const binary = atob(String(value || ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function readVarint(state) {
    let value = 0;
    let multiplier = 1;
    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      if (state.offset >= state.bytes.length) {
        throw new Error("Chart miniview packed data ended unexpectedly.");
      }
      const byte = state.bytes[state.offset++];
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) {
          throw new Error("Chart miniview packed integer is too large.");
        }
        return value;
      }
      multiplier *= 128;
    }
    throw new Error("Chart miniview packed integer is invalid.");
  }

  function buildMeasureGeometry(endMeasure, overrides) {
    const lengths = Array.from({ length: endMeasure + 1 }, () => 1);
    for (const entry of overrides) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error("Chart miniview measure length is invalid.");
      }
      const measure = Number(entry[0]);
      const length = Number(entry[1]);
      if (!Number.isInteger(measure) || measure < 0 || measure > endMeasure || !Number.isFinite(length) || length <= 0) {
        throw new Error("Chart miniview measure length is invalid.");
      }
      lengths[measure] = length;
    }
    const starts = Array.from({ length: endMeasure + 2 }, () => 0);
    for (let measure = 0; measure <= endMeasure; measure += 1) {
      starts[measure + 1] = starts[measure] + lengths[measure];
    }
    return { lengths, starts };
  }

  function decodePackedEvents(value, groupCount, measureStarts, measureLengths, endMeasure) {
    const state = { bytes: decodeBase64Bytes(value), offset: 0 };
    const events = [];
    let measure = 0;
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      measure += readVarint(state);
      if (measure > endMeasure || state.offset >= state.bytes.length) {
        throw new Error("Chart miniview event measure is invalid.");
      }
      const descriptor = state.bytes[state.offset++];
      const lane = descriptor & 0x07;
      const kind = descriptor >> 3;
      const denominator = readVarint(state);
      const count = readVarint(state);
      if (kind > 2 || denominator <= 0 || count <= 0) {
        throw new Error("Chart miniview event group is invalid.");
      }
      let numerator = 0;
      for (let index = 0; index < count; index += 1) {
        numerator += readVarint(state);
        if (numerator >= denominator) {
          throw new Error("Chart miniview event fraction is invalid.");
        }
        events.push({
          lane,
          kind,
          measure,
          numerator,
          denominator,
          position: measureStarts[measure] + numerator / denominator * measureLengths[measure]
        });
      }
    }
    if (state.offset !== state.bytes.length) {
      throw new Error("Chart miniview packed data has trailing bytes.");
    }
    return events;
  }

  function normalizePayload(value) {
    if (!value || typeof value !== "object") {
      throw new Error("Chart miniview payload is missing.");
    }
    const startMeasure = Number(value.startMeasure);
    const endMeasure = Number(value.endMeasure);
    const startPosition = Number(value.startPosition);
    const endPosition = Number(value.endPosition);
    const eventGroupCount = Number(value.eventGroupCount);
    if (
      ![2, 3].includes(value.schemaVersion)
      || value.mode !== "7key-sp"
      || !Array.isArray(value.laneOrder)
      || value.laneOrder.length !== 8
      || !Number.isInteger(startMeasure)
      || !Number.isInteger(endMeasure)
      || endMeasure < startMeasure
      || !Number.isFinite(startPosition)
      || !Number.isFinite(endPosition)
      || endPosition <= startPosition
      || value.eventEncoding !== "grouped-varint-v1"
      || !Number.isInteger(eventGroupCount)
      || eventGroupCount < 0
      || typeof value.eventData !== "string"
      || !Array.isArray(value.measureLengths)
      || (value.schemaVersion === 3 && !Array.isArray(value.bpmEvents))
    ) {
      throw new Error("Chart miniview payload is unsupported.");
    }
    const geometry = buildMeasureGeometry(endMeasure, value.measureLengths);
    if (
      Math.abs(geometry.starts[startMeasure] - startPosition) > 1e-9
      || Math.abs(geometry.starts[endMeasure + 1] - endPosition) > 1e-9
    ) {
      throw new Error("Chart miniview position range is inconsistent.");
    }
    const events = decodePackedEvents(
      value.eventData,
      eventGroupCount,
      geometry.starts,
      geometry.lengths,
      endMeasure
    );
    const initialBpm = value.schemaVersion === 3 ? Number(value.initialBpm) : null;
    if (value.schemaVersion === 3 && value.initialBpm !== null && (!Number.isFinite(initialBpm) || initialBpm <= 0)) {
      throw new Error("Chart miniview initial BPM is invalid.");
    }
    const bpmEvents = value.schemaVersion === 3
      ? value.bpmEvents.map((entry) => {
        if (!Array.isArray(entry) || entry.length !== 4) {
          throw new Error("Chart miniview BPM event is invalid.");
        }
        const [measure, numerator, denominator, bpm] = entry.map(Number);
        if (
          !Number.isInteger(measure)
          || measure < 0
          || measure > endMeasure
          || !Number.isInteger(numerator)
          || numerator < 0
          || !Number.isInteger(denominator)
          || denominator <= 0
          || numerator >= denominator
          || !Number.isFinite(bpm)
          || bpm <= 0
        ) {
          throw new Error("Chart miniview BPM event is invalid.");
        }
        return {
          measure,
          numerator,
          denominator,
          bpm,
          position: geometry.starts[measure] + numerator / denominator * geometry.lengths[measure]
        };
      }).sort((left, right) => left.position - right.position)
      : [];
    const tapEvents = events.filter((event) => event.kind === 0);
    const longNotes = [];
    for (let lane = 0; lane < 8; lane += 1) {
      const endpoints = events
        .filter((event) => event.lane === lane && event.kind !== 0)
        .sort((left, right) => left.position - right.position || left.kind - right.kind);
      let start = null;
      for (const event of endpoints) {
        if (event.kind === 1 && start === null) {
          start = event;
        } else if (event.kind === 2 && start && event.position > start.position) {
          longNotes.push({ lane, start, end: event });
          start = null;
        } else {
          throw new Error("Chart miniview long-note data is invalid.");
        }
      }
      if (start) {
        throw new Error("Chart miniview long-note data is incomplete.");
      }
    }
    if (tapEvents.length !== Number(value.tapCount) || longNotes.length !== Number(value.longNoteCount)) {
      throw new Error("Chart miniview event counts are inconsistent.");
    }

    return {
      ...value,
      startMeasure,
      endMeasure,
      startPosition,
      endPosition,
      measureLengths: geometry.lengths,
      measureStarts: geometry.starts,
      tapEvents,
      longNotes,
      initialBpm: Number.isFinite(initialBpm) && initialBpm > 0 ? initialBpm : null,
      bpmEvents
    };
  }

  function drawPlaceholder(canvas) {
    const width = Math.max(48, Math.round(canvas.getBoundingClientRect().width || 70));
    const height = Math.max(56, Math.round(canvas.getBoundingClientRect().height || 68));
    const ratio = Math.min(Number(window.devicePixelRatio) || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#090909";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#303030";
    context.lineWidth = 1;
    for (let lane = 1; lane < 8; lane += 1) {
      const x = Math.round(lane * width / 8) + 0.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }

  function getLanePalette(lane) {
    if (lane === 0) {
      return {
        laneFill: "#120808",
        noteFill: "#FF5555",
        longFill: "#9F343A",
        longMarker: "#FF5555"
      };
    }
    if (lane % 2 === 0) {
      return {
        laneFill: "#080B14",
        noteFill: "#4B74FF",
        longFill: "#2E4599",
        longMarker: "#4B74FF"
      };
    }
    return {
      laneFill: "#090909",
      noteFill: "#EDEDED",
      longFill: "#8F999F",
      longMarker: "#EDEDED"
    };
  }

  function formatBpm(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "";
    }
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
  }

  function collectBpmDisplayData(payload, rangeStart, rangeEnd) {
    let activeBpm = payload.initialBpm;
    for (const event of payload.bpmEvents) {
      if (event.position <= rangeStart + 1e-9) {
        activeBpm = event.bpm;
      } else {
        break;
      }
    }
    const annotations = [];
    for (const event of payload.bpmEvents) {
      const isAtRangeStart = Math.abs(event.position - rangeStart) <= 1e-9;
      if ((isAtRangeStart || event.position > rangeStart + 1e-9) && event.position < rangeEnd - 1e-9) {
        annotations.push({ position: event.position, bpm: event.bpm });
      }
    }
    return {
      currentBpm: Number.isFinite(activeBpm) && activeBpm > 0 ? activeBpm : null,
      annotations
    };
  }

  function drawPayload(canvas, payload, large = false, viewRange = null) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(large ? 240 : 52, Math.round(rect.width || (large ? 360 : 70)));
    const height = Math.max(large ? 360 : 56, Math.round(rect.height || (large ? 640 : 68)));
    const ratio = Math.min(Number(window.devicePixelRatio) || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const paddingX = large ? 8 : 3;
    const paddingY = large ? 12 : 3;
    const plotX = paddingX;
    const plotY = paddingY;
    const plotWidth = Math.max(1, width - paddingX * 2);
    const plotHeight = Math.max(1, height - paddingY * 2);
    const rangeStart = Number.isFinite(Number(viewRange?.startPosition))
      ? Math.max(payload.startPosition, Number(viewRange.startPosition))
      : payload.startPosition;
    const rangeEnd = Number.isFinite(Number(viewRange?.endPosition))
      ? Math.min(payload.endPosition, Number(viewRange.endPosition))
      : payload.endPosition;
    if (!(rangeEnd > rangeStart)) {
      throw new Error("Chart miniview display range is invalid.");
    }
    const bpmDisplay = collectBpmDisplayData(payload, rangeStart, rangeEnd);
    const hasBpmAnnotations = large && bpmDisplay.annotations.length > 0;
    const bpmBandWidth = hasBpmAnnotations ? 32 : 0;
    const bpmBandGap = hasBpmAnnotations ? 4 : 0;
    let measureBandWidth = 0;
    if (large) {
      const measureLabelCandidates = [
        String(viewRange?.startMeasure ?? payload.startMeasure),
        String(viewRange?.endMeasure ?? payload.endMeasure)
      ];
      context.save();
      context.font = "700 12px system-ui, sans-serif";
      const measuredMeasureLabelWidth = Math.max(...measureLabelCandidates.map((label) => context.measureText(label).width));
      context.restore();
      measureBandWidth = Math.max(36, Math.ceil(measuredMeasureLabelWidth + 14));
    }
    const measureBandGap = large ? 4 : 0;
    const lanePlotX = plotX + bpmBandWidth + bpmBandGap;
    const lanePlotWidth = Math.max(1, plotWidth - bpmBandWidth - bpmBandGap - measureBandWidth - measureBandGap);
    const measureBandX = lanePlotX + lanePlotWidth + measureBandGap;
    const laneUnits = [1.5, 1, 1, 1, 1, 1, 1, 1];
    const unitWidth = lanePlotWidth / 8.5;
    const laneGeometry = [];
    let laneX = lanePlotX;
    for (const units of laneUnits) {
      const widthForLane = units * unitWidth;
      laneGeometry.push({ x: laneX, width: widthForLane });
      laneX += widthForLane;
    }
    const visualGap = large ? 0.9 : 0.5;
    const eventTopInset = large ? 7 : 2.5;
    const eventBottomInset = large ? 1.5 : 0.8;
    const eventPlotHeight = Math.max(1, plotHeight - eventTopInset - eventBottomInset);
    const yForPosition = (position) => plotY + eventTopInset
      + (rangeEnd - position) / (rangeEnd - rangeStart) * eventPlotHeight;
    const topForNote = (eventY, noteHeight) => Math.max(
      plotY + 1,
      Math.min(plotY + plotHeight - noteHeight - 1, eventY - visualGap - noteHeight)
    );
    const noteHeightForLane = (lane) => large ? (lane === 0 ? 5 : 3.8) : 1.5;
    const markerHeightForLane = (lane) => large ? (lane === 0 ? 5.4 : 4.8) : 1.8;

    context.fillStyle = "#050505";
    context.fillRect(0, 0, width, height);
    if (hasBpmAnnotations) {
      context.fillStyle = "#08120B";
      context.fillRect(plotX, plotY, bpmBandWidth, plotHeight);
    }
    for (let lane = 0; lane < 8; lane += 1) {
      context.fillStyle = getLanePalette(lane).laneFill;
      context.fillRect(laneGeometry[lane].x, plotY, laneGeometry[lane].width, plotHeight);
    }
    if (large) {
      context.fillStyle = "#8F8F8F";
      context.fillRect(measureBandX, plotY, measureBandWidth, plotHeight);
    }

    context.strokeStyle = "#3A3A3A";
    context.lineWidth = large ? 1 : 0.6;
    for (let lane = 1; lane < 8; lane += 1) {
      const x = laneGeometry[lane].x;
      context.beginPath();
      context.moveTo(x, plotY);
      context.lineTo(x, plotY + plotHeight);
      context.stroke();
    }

    const visibleMeasures = [];
    for (let measure = payload.startMeasure; measure <= payload.endMeasure; measure += 1) {
      const measureStart = payload.measureStarts[measure];
      const measureEnd = payload.measureStarts[measure + 1];
      if (measureStart < rangeEnd && measureEnd > rangeStart) {
        visibleMeasures.push({ measure, start: measureStart, end: measureEnd });
      }
    }
    for (const item of visibleMeasures) {
      const clippedStart = Math.max(item.start, rangeStart);
      const clippedEnd = Math.min(item.end, rangeEnd);
      const measurePixelHeight = Math.abs(yForPosition(clippedEnd) - yForPosition(clippedStart));
      if (large && measurePixelHeight >= 28) {
        const divisionCount = Math.ceil((item.end - item.start) / 0.0625 - 1e-9);
        for (let division = 1; division < divisionCount; division += 1) {
          const position = item.start + division * 0.0625;
          if (position <= rangeStart || position >= rangeEnd || position >= item.end - 1e-9) {
            continue;
          }
          context.strokeStyle = division % 4 === 0 ? "#4A4A4A" : "#2C2C2C";
          context.lineWidth = division % 4 === 0 ? 0.9 : 0.65;
          const y = yForPosition(position);
          context.beginPath();
          context.moveTo(lanePlotX, y);
          context.lineTo(lanePlotX + lanePlotWidth, y);
          context.stroke();
        }
      }
      if (item.start >= rangeStart - 1e-9 && item.start <= rangeEnd + 1e-9) {
        const startY = yForPosition(item.start);
        context.strokeStyle = "#E8E8E8";
        context.lineWidth = large ? 1.3 : 0.8;
        context.beginPath();
        context.moveTo(lanePlotX, startY);
        context.lineTo(lanePlotX + lanePlotWidth + (large ? measureBandGap + measureBandWidth : 0), startY);
        context.stroke();
      }
      if (large && measurePixelHeight >= 14) {
        context.fillStyle = "#F6F6F6";
        context.font = "700 12px system-ui, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          String(item.measure),
          measureBandX + measureBandWidth / 2,
          (yForPosition(clippedStart) + yForPosition(clippedEnd)) / 2
        );
      }
    }
    const finalVisibleBoundary = visibleMeasures.at(-1)?.end;
    if (Number.isFinite(finalVisibleBoundary) && finalVisibleBoundary <= rangeEnd + 1e-9) {
      const finalY = yForPosition(finalVisibleBoundary);
      context.strokeStyle = "#E8E8E8";
      context.lineWidth = large ? 1.3 : 0.8;
      context.beginPath();
      context.moveTo(lanePlotX, finalY);
      context.lineTo(lanePlotX + lanePlotWidth + (large ? measureBandGap + measureBandWidth : 0), finalY);
      context.stroke();
    }

    context.save();
    context.beginPath();
    context.rect(lanePlotX + 1, plotY + 1, Math.max(1, lanePlotWidth - 2), Math.max(1, plotHeight - 2));
    context.clip();
    for (const longNote of payload.longNotes) {
      if (longNote.end.position <= rangeStart || longNote.start.position >= rangeEnd) {
        continue;
      }
      const geometry = laneGeometry[longNote.lane];
      const palette = getLanePalette(longNote.lane);
      const start = Math.max(longNote.start.position, rangeStart);
      const end = Math.min(longNote.end.position, rangeEnd);
      const yStart = yForPosition(start);
      const yEnd = yForPosition(end);
      const markerHeight = markerHeightForLane(longNote.lane);
      const startCenter = longNote.start.position >= rangeStart
        ? topForNote(yStart, markerHeight) + markerHeight / 2
        : yStart;
      const endCenter = longNote.end.position < rangeEnd
        ? topForNote(yEnd, markerHeight) + markerHeight / 2
        : yEnd;
      const longWidth = geometry.width * (longNote.lane === 0 ? 0.82 : 0.68);
      context.fillStyle = palette.longFill;
      context.fillRect(
        geometry.x + (geometry.width - longWidth) / 2,
        Math.min(startCenter, endCenter),
        Math.max(2, longWidth),
        Math.max(3, Math.abs(endCenter - startCenter))
      );
    }

    for (const event of payload.tapEvents) {
      if (event.position < rangeStart || event.position >= rangeEnd) {
        continue;
      }
      const geometry = laneGeometry[event.lane];
      const noteWidth = Math.max(2, geometry.width * (event.lane === 0 ? 0.92 : 0.8));
      const noteHeight = noteHeightForLane(event.lane);
      const y = yForPosition(event.position);
      context.fillStyle = getLanePalette(event.lane).noteFill;
      context.fillRect(
        geometry.x + (geometry.width - noteWidth) / 2,
        topForNote(y, noteHeight),
        noteWidth,
        noteHeight
      );
    }
    for (const longNote of payload.longNotes) {
      for (const event of [longNote.start, longNote.end]) {
        if (event.position < rangeStart || event.position >= rangeEnd) {
          continue;
        }
        const geometry = laneGeometry[event.lane];
        const markerWidth = Math.max(2, geometry.width * (event.lane === 0 ? 0.94 : 0.82));
        const markerHeight = markerHeightForLane(event.lane);
        const y = yForPosition(event.position);
        context.fillStyle = getLanePalette(event.lane).longMarker;
        context.fillRect(
          geometry.x + (geometry.width - markerWidth) / 2,
          topForNote(y, markerHeight),
          markerWidth,
          markerHeight
        );
      }
    }
    context.restore();

    if (hasBpmAnnotations) {
      context.font = "700 10px system-ui, sans-serif";
      context.textAlign = "right";
      context.textBaseline = "middle";
      for (const annotation of bpmDisplay.annotations) {
        const exactY = yForPosition(annotation.position);
        const lineY = Math.max(plotY + 1, Math.min(plotY + plotHeight - 1, exactY));
        const labelY = Math.max(plotY + 7, Math.min(plotY + plotHeight - 7, exactY - 3));
        context.strokeStyle = "#3DBB58";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(plotX + bpmBandWidth - 7, lineY);
        context.lineTo(lanePlotX, lineY);
        context.stroke();
        context.fillStyle = "#67DF7B";
        context.fillText(formatBpm(annotation.bpm), plotX + bpmBandWidth - 3, labelY);
      }
      context.strokeStyle = "#31523A";
      context.lineWidth = 1;
      context.strokeRect(plotX + 0.5, plotY + 0.5, Math.max(0, bpmBandWidth - 1), Math.max(0, plotHeight - 1));
    }

    context.strokeStyle = "#D0D0D0";
    context.lineWidth = 1;
    context.strokeRect(lanePlotX + 0.5, plotY + 0.5, Math.max(0, lanePlotWidth - 1), Math.max(0, plotHeight - 1));
    if (large) {
      context.strokeRect(measureBandX + 0.5, plotY + 0.5, Math.max(0, measureBandWidth - 1), Math.max(0, plotHeight - 1));
    }
  }

  async function fetchPayloadFromNetwork(url) {
    return fetch(apiUrl(url), {
      headers: { Accept: "application/json" }
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Chart miniview request failed (${response.status}).`);
      }
      const body = await response.json();
      return normalizePayload(body?.miniView);
    });
  }

  function paintRowVersion(versionId, payload) {
    listElement.querySelectorAll(`.chart-miniview-button[data-version-id="${CSS.escape(versionId)}"]`).forEach((button) => {
      const canvas = button.querySelector("canvas");
      if (!canvas) {
        return;
      }
      drawPayload(canvas, payload);
      button.dataset.state = "ready";
      button.title = "譜面ミニビューを拡大表示";
      button.setAttribute(
        "aria-label",
        `譜面ミニビューを開く。7key、通常ノート${payload.tapCount}、LN${payload.longNoteCount}`
      );
    });
  }

  function pumpQueue() {
    while (activeRequests < maxConcurrentRequests && requestQueue.length > 0) {
      const task = requestQueue.shift();
      if (!task.priority && (!task.button.isConnected || task.button.closest(".version-row")?.hidden)) {
        pendingRequests.delete(task.versionId);
        task.reject(new Error("Chart miniview load was canceled."));
        continue;
      }

      activeRequests += 1;
      task.button.dataset.state = "loading";
      fetchPayloadFromNetwork(task.url)
        .then((payload) => {
          payloadCache.set(task.versionId, payload);
          task.resolve(payload);
        }, task.reject)
        .finally(() => {
          pendingRequests.delete(task.versionId);
          activeRequests -= 1;
          pumpQueue();
        });
    }
  }

  function requestPayload(versionId, url, button, priority = false) {
    if (payloadCache.has(versionId)) {
      return Promise.resolve(payloadCache.get(versionId));
    }
    if (pendingRequests.has(versionId)) {
      return pendingRequests.get(versionId);
    }

    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    pendingRequests.set(versionId, promise);
    const task = {
      versionId,
      url,
      button,
      priority,
      resolve: resolveRequest,
      reject: rejectRequest
    };
    if (priority) {
      requestQueue.unshift(task);
    } else {
      requestQueue.push(task);
    }
    pumpQueue();
    return promise;
  }

  function ensureRangePreview() {
    if (rangePreview) {
      return;
    }
    rangePreview = document.createElement("div");
    rangePreview.id = "chartMiniViewRangePreview";
    rangePreview.className = "chart-miniview-range-preview";
    rangePreview.setAttribute("role", "tooltip");
    rangePreview.hidden = true;
    rangePreview.innerHTML = `
      <div class="chart-miniview-range-header">
        <strong class="chart-miniview-range-label"></strong>
        <span class="chart-miniview-range-meta"></span>
      </div>
      <canvas class="chart-miniview-range-canvas" aria-hidden="true"></canvas>
      <span class="chart-miniview-range-hint">クリックで固定・切替 / ←→で移動 / Escで閉じる</span>
    `;
    document.body.appendChild(rangePreview);
    rangePreviewCanvas = rangePreview.querySelector("canvas");
    rangePreviewLabel = rangePreview.querySelector(".chart-miniview-range-label");
    rangePreviewMeta = rangePreview.querySelector(".chart-miniview-range-meta");
  }

  function getProgressBlockRanges(target) {
    const versionId = target?.dataset?.versionId || "";
    const ranges = window.getProgressThumbnailBlockRanges?.(versionId);
    return Array.isArray(ranges) ? ranges : [];
  }

  function blockIndexFromPointer(target, clientX) {
    const ranges = getProgressBlockRanges(target);
    if (ranges.length === 0) {
      return -1;
    }
    const rect = target.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(ranges.length - 1, Math.floor(Math.max(0, Math.min(0.999999, ratio)) * ranges.length)));
  }

  function measureForPosition(payload, position) {
    for (let measure = payload.startMeasure; measure <= payload.endMeasure; measure += 1) {
      if (position >= payload.measureStarts[measure] - 1e-9 && position < payload.measureStarts[measure + 1] - 1e-9) {
        return measure;
      }
    }
    return payload.endMeasure;
  }

  function buildBlockViewRange(payload, block) {
    const startPosition = Number(block.startPosition);
    const endPosition = Number(block.endPosition);
    if (!Number.isFinite(startPosition) || !Number.isFinite(endPosition) || endPosition <= startPosition) {
      return null;
    }
    const clippedStart = Math.max(payload.startPosition, startPosition);
    const clippedEnd = Math.min(payload.endPosition, endPosition);
    if (clippedEnd <= clippedStart) {
      return null;
    }
    return {
      startPosition: clippedStart,
      endPosition: clippedEnd,
      startMeasure: measureForPosition(payload, clippedStart),
      endMeasure: measureForPosition(payload, Math.max(clippedStart, clippedEnd - 1e-9))
    };
  }

  function positionRangePreview(target) {
    if (!rangePreview || rangePreview.hidden || !target?.isConnected) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const previewWidth = rangePreview.offsetWidth;
    const previewHeight = rangePreview.offsetHeight;
    const margin = 8;
    const gap = 10;
    let left;
    let top;

    if (viewportWidth <= 700) {
      left = Math.max(margin, Math.min(viewportWidth - previewWidth - margin, rect.left + rect.width / 2 - previewWidth / 2));
      const below = rect.bottom + gap;
      const placeBelow = below + previewHeight <= viewportHeight - margin;
      top = placeBelow ? below : rect.top - previewHeight - gap;
      rangePreview.dataset.placement = placeBelow ? "below" : "above";
    } else {
      left = rect.right + gap;
      if (left + previewWidth > viewportWidth - margin) {
        left = rect.left - previewWidth - gap;
        rangePreview.dataset.placement = "left";
      } else {
        rangePreview.dataset.placement = "right";
      }
      top = rect.top + rect.height / 2 - previewHeight / 2;
    }

    rangePreview.style.left = `${Math.max(margin, Math.min(viewportWidth - previewWidth - margin, left))}px`;
    rangePreview.style.top = `${Math.max(margin, Math.min(viewportHeight - previewHeight - margin, top))}px`;
  }

  function closeRangePreview(force = false) {
    if (rangePreviewPinned && !force) {
      return;
    }
    rangePreviewRequestId += 1;
    activeRangeTarget?.removeAttribute("aria-describedby");
    if (activeRangeTarget) {
      delete activeRangeTarget.dataset.previewActive;
      delete activeRangeTarget.dataset.previewMode;
    }
    if (rangePreview) {
      rangePreview.hidden = true;
    }
    activeRangeTarget = null;
    activeRangeIndex = -1;
    rangePreviewPinned = false;
  }

  async function showRangePreview(target, blockIndex) {
    const ranges = getProgressBlockRanges(target);
    const block = ranges[blockIndex];
    const row = target.closest(".version-row");
    const versionId = target.dataset.versionId || "";
    const url = row?.dataset.miniviewUrl || "";
    if (!block || !row || row.hidden || !versionId || !url) {
      closeRangePreview(true);
      return;
    }

    ensureRangePreview();
    if (!rangePreview || !rangePreviewCanvas) {
      return;
    }
    const unchanged = activeRangeTarget === target && activeRangeIndex === blockIndex && !rangePreview.hidden;
    activeRangeTarget?.removeAttribute("aria-describedby");
    if (activeRangeTarget && activeRangeTarget !== target) {
      delete activeRangeTarget.dataset.previewActive;
      delete activeRangeTarget.dataset.previewMode;
    }
    activeRangeTarget = target;
    activeRangeIndex = blockIndex;
    target.dataset.selectedBlock = String(blockIndex);
    target.dataset.previewActive = "true";
    target.dataset.previewMode = rangePreviewPinned ? "fixed" : "hover";
    target.style.setProperty("--selected-block-index", String(blockIndex));
    target.style.setProperty("--progress-block-count", String(ranges.length));
    target.setAttribute("aria-describedby", rangePreview.id);
    target.setAttribute(
      "aria-label",
      `進捗ブロック ${blockIndex + 1}/${ranges.length}、小節 ${block.startMeasure}-${block.endMeasure} の譜面範囲をプレビュー`
    );
    rangePreview.hidden = false;
    positionRangePreview(target);
    if (unchanged) {
      return;
    }
    rangePreview.dataset.state = "loading";

    if (rangePreviewLabel) {
      rangePreviewLabel.textContent = `小節 ${block.startMeasure}-${block.endMeasure}`;
    }
    if (rangePreviewMeta) {
      rangePreviewMeta.textContent = `block ${blockIndex + 1}/${ranges.length} · 読み込み中`;
    }
    drawPlaceholder(rangePreviewCanvas);
    const requestId = ++rangePreviewRequestId;

    try {
      const payload = await requestPayload(versionId, url, target, true);
      if (requestId !== rangePreviewRequestId || activeRangeTarget !== target || activeRangeIndex !== blockIndex) {
        return;
      }
      const viewRange = buildBlockViewRange(payload, block);
      if (!viewRange) {
        throw new Error("Chart miniview block range is invalid.");
      }
      drawPayload(rangePreviewCanvas, payload, true, viewRange);
      rangePreview.dataset.state = "ready";
      if (rangePreviewLabel) {
        rangePreviewLabel.textContent = `小節 ${viewRange.startMeasure}-${viewRange.endMeasure}`;
      }
      if (rangePreviewMeta) {
        const bpmDisplay = collectBpmDisplayData(payload, viewRange.startPosition, viewRange.endPosition);
        const bpmText = bpmDisplay.currentBpm === null ? "" : ` · BPM ${formatBpm(bpmDisplay.currentBpm)}`;
        rangePreviewMeta.textContent = `block ${blockIndex + 1}/${ranges.length} · 7key SP${bpmText}`;
      }
      paintRowVersion(versionId, payload);
      positionRangePreview(target);
    } catch (error) {
      if (requestId !== rangePreviewRequestId) {
        return;
      }
      if (rangePreviewMeta) {
        rangePreviewMeta.textContent = "ミニビュー非対応";
      }
      rangePreview.dataset.state = "error";
    }
  }

  function queueLoad(button) {
    const versionId = button.dataset.versionId || "";
    const url = button.dataset.miniviewUrl || "";
    if (!versionId || !url) {
      return;
    }
    const cached = payloadCache.get(versionId);
    if (cached) {
      paintRowVersion(versionId, cached);
      return;
    }
    if (pendingRequests.has(versionId)) {
      return;
    }
    requestPayload(versionId, url, button)
      .then((payload) => paintRowVersion(versionId, payload))
      .catch((error) => {
        if (!button.isConnected || button.closest(".version-row")?.hidden) {
          return;
        }
        button.dataset.state = "error";
        button.title = "譜面ミニビューを読み込めませんでした";
        console.warn("[chart-miniview] failed to load", {
          versionId,
          message: error instanceof Error ? error.message : String(error)
        });
      });
  }

  function ensureObserver() {
    if (observer || typeof IntersectionObserver !== "function") {
      return observer;
    }
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          queueLoad(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "240px 0px" });
    return observer;
  }

  function ensureProgressSlot(cell) {
    let slot = cell.querySelector(":scope > .progress-thumbnail-slot");
    if (slot) {
      return slot;
    }
    slot = document.createElement("div");
    slot.className = "progress-thumbnail-slot";
    Array.from(cell.childNodes).forEach((node) => slot.appendChild(node));
    cell.appendChild(slot);
    return slot;
  }

  function mount(root = listElement) {
    if (activeRangeTarget && (!activeRangeTarget.isConnected || activeRangeTarget.closest(".version-row")?.hidden)) {
      closeRangePreview(true);
    }
    root.querySelectorAll(".chart-miniview-shell").forEach((shell) => shell.remove());
    root.querySelectorAll(".thumbnail-cell.has-chart-miniview, .progress-thumbnail-block.has-chart-miniview")
      .forEach((cell) => cell.classList.remove("has-chart-miniview"));
  }

  function schedule(root = listElement) {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      mount(root);
    });
  }

  async function openDialog(button) {
    if (!dialog || !dialogCanvas) {
      return;
    }
    const versionId = button.dataset.versionId || "";
    const url = button.dataset.miniviewUrl || "";
    if (!versionId || !url) {
      return;
    }

    lastDialogTrigger = button;
    if (dialogTitle) {
      dialogTitle.textContent = "譜面ミニビュー";
    }
    if (dialogSummary) {
      dialogSummary.textContent = "読み込み中です。";
    }
    if (!dialog.open) {
      dialog.showModal();
    }

    try {
      const payload = await requestPayload(versionId, url, button, true);
      drawPayload(dialogCanvas, payload, true);
      if (dialogSummary) {
        dialogSummary.textContent = `7key SP / 通常ノート ${payload.tapCount} / LN ${payload.longNoteCount} / 小節 ${payload.startMeasure}-${payload.endMeasure}`;
      }
      paintRowVersion(versionId, payload);
    } catch (error) {
      drawPlaceholder(dialogCanvas);
      if (dialogSummary) {
        dialogSummary.textContent = "譜面ミニビューを読み込めませんでした。";
      }
    }
  }

  function getBlockNavigator(event) {
    return event.target?.closest?.("[data-progress-block-navigator]") || null;
  }

  listElement.addEventListener("pointerover", (event) => {
    const target = getBlockNavigator(event);
    if (!target) {
      return;
    }
    const blockIndex = blockIndexFromPointer(target, event.clientX);
    if (rangePreviewPinned) {
      target.dataset.pointerBlock = String(blockIndex);
      return;
    }
    if (blockIndex >= 0) {
      showRangePreview(target, blockIndex);
    }
  });

  listElement.addEventListener("pointermove", (event) => {
    const target = getBlockNavigator(event);
    if (!target) {
      return;
    }
    const blockIndex = blockIndexFromPointer(target, event.clientX);
    if (rangePreviewPinned) {
      target.dataset.pointerBlock = String(blockIndex);
      return;
    }
    if (blockIndex >= 0 && (activeRangeTarget !== target || activeRangeIndex !== blockIndex)) {
      showRangePreview(target, blockIndex);
    }
  });

  listElement.addEventListener("pointerout", (event) => {
    const target = getBlockNavigator(event);
    if (!target || target.contains(event.relatedTarget)) {
      return;
    }
    if (!rangePreviewPinned && document.activeElement !== target && activeRangeTarget === target) {
      closeRangePreview(true);
    }
  });

  listElement.addEventListener("focusin", (event) => {
    const target = getBlockNavigator(event);
    if (!target) {
      return;
    }
    const ranges = getProgressBlockRanges(target);
    const selected = Math.max(0, Math.min(ranges.length - 1, Number(target.dataset.selectedBlock) || 0));
    if (ranges.length > 0) {
      showRangePreview(target, selected);
    }
  });

  listElement.addEventListener("focusout", (event) => {
    const target = getBlockNavigator(event);
    if (!target) {
      return;
    }
    window.setTimeout(() => {
      if (!rangePreviewPinned && activeRangeTarget === target && document.activeElement !== target) {
        closeRangePreview(true);
      }
    }, 0);
  });

  listElement.addEventListener("keydown", (event) => {
    const target = getBlockNavigator(event);
    if (!target) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeRangePreview(true);
      return;
    }
    const ranges = getProgressBlockRanges(target);
    if (ranges.length === 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const current = Math.max(0, Math.min(ranges.length - 1, Number(target.dataset.selectedBlock) || 0));
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? ranges.length - 1
        : Math.max(0, Math.min(ranges.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
    showRangePreview(target, next);
  });

  listElement.addEventListener("click", (event) => {
    const rangeTarget = getBlockNavigator(event);
    if (rangeTarget) {
      event.preventDefault();
      const selected = event.detail > 0 || event.clientX > 0
        ? blockIndexFromPointer(rangeTarget, event.clientX)
        : Math.max(0, Number(rangeTarget.dataset.selectedBlock) || 0);
      if (selected < 0) {
        return;
      }
      if (rangePreviewPinned && activeRangeTarget === rangeTarget && activeRangeIndex === selected) {
        closeRangePreview(true);
      } else {
        rangePreviewPinned = true;
        showRangePreview(rangeTarget, selected);
      }
      return;
    }
    const button = event.target.closest(".chart-miniview-button");
    if (button) {
      openDialog(button);
    }
  });

  dialog?.querySelectorAll("[data-chart-miniview-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog?.addEventListener("close", () => {
    lastDialogTrigger?.focus();
    lastDialogTrigger = null;
  });

  document.addEventListener("pointerdown", (event) => {
    if (activeRangeTarget && !activeRangeTarget.contains(event.target)) {
      closeRangePreview(true);
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeRangeTarget) {
      closeRangePreview(true);
    }
  });
  window.addEventListener("scroll", () => {
    if (activeRangeTarget) {
      positionRangePreview(activeRangeTarget);
    }
  }, true);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      listElement.querySelectorAll(".chart-miniview-button[data-version-id]").forEach((button) => {
        const payload = payloadCache.get(button.dataset.versionId || "");
        const canvas = button.querySelector("canvas");
        if (payload && canvas) {
          drawPayload(canvas, payload);
        }
      });
      if (activeRangeTarget) {
        positionRangePreview(activeRangeTarget);
      }
    }, 120);
  });

  window.scheduleChartMiniViewMount = schedule;
  window.debugChartMiniViews = () => ({
    availableRows: listElement.querySelectorAll('[data-miniview-available="true"]').length,
    mountedButtons: listElement.querySelectorAll(".chart-miniview-button").length,
    readyButtons: listElement.querySelectorAll('.chart-miniview-button[data-state="ready"]').length,
    cachedVersions: payloadCache.size,
    activeRequests,
    queuedRequests: requestQueue.length
  });
})();
