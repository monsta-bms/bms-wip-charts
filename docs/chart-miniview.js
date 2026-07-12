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

  function decodeBits(value, resolution) {
    const binary = atob(String(value || ""));
    const expectedBytes = Math.ceil(resolution / 8);
    if (binary.length !== expectedBytes) {
      throw new Error("Invalid chart miniview bitset length.");
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bitAt(bits, index) {
    return (bits[index >> 3] & (1 << (index & 7))) !== 0;
  }

  function normalizePayload(value) {
    if (!value || typeof value !== "object") {
      throw new Error("Chart miniview payload is missing.");
    }
    const resolution = Number(value.resolution);
    const startMeasure = Number(value.startMeasure);
    const endMeasure = Number(value.endMeasure);
    if (
      value.schemaVersion !== 1
      || value.mode !== "7key-sp"
      || !Number.isInteger(resolution)
      || resolution <= 0
      || resolution > 4096
      || !Array.isArray(value.laneOrder)
      || value.laneOrder.length !== 8
      || !Number.isInteger(startMeasure)
      || !Number.isInteger(endMeasure)
      || endMeasure < startMeasure
    ) {
      throw new Error("Chart miniview payload is unsupported.");
    }

    const readLaneBits = (source) => {
      if (!Array.isArray(source) || source.length !== 8) {
        throw new Error("Chart miniview lane data is invalid.");
      }
      return source.map((item) => decodeBits(item, resolution));
    };
    let measurePositions = null;
    if (value.measurePositions !== undefined) {
      if (
        !Array.isArray(value.measurePositions)
        || value.measurePositions.length !== endMeasure - startMeasure + 2
      ) {
        throw new Error("Chart miniview measure positions are invalid.");
      }
      measurePositions = value.measurePositions.map(Number);
      if (measurePositions.some((position, index) => (
        !Number.isInteger(position)
        || position < 0
        || position >= resolution
        || (index > 0 && position < measurePositions[index - 1])
      ))) {
        throw new Error("Chart miniview measure positions are invalid.");
      }
    }

    return {
      ...value,
      resolution,
      startMeasure,
      endMeasure,
      measurePositions,
      tapBitsets: readLaneBits(value.tapBits),
      longActiveBitsets: readLaneBits(value.longActiveBits),
      longStartBitsets: readLaneBits(value.longStartBits),
      longEndBitsets: readLaneBits(value.longEndBits),
      measureBitset: decodeBits(value.measureBits, resolution)
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
    context.fillStyle = "#f5f8f7";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#d6e1dd";
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
        laneFill: "#F2E6E6",
        noteFill: "#DC6262",
        noteStroke: "#A94747",
        longFill: "#C65353",
        longMarker: "#A83E3E"
      };
    }
    if (lane % 2 === 0) {
      return {
        laneFill: "#EAF3F6",
        noteFill: "#32B4E2",
        noteStroke: "#237F9F",
        longFill: "#2D8FBC",
        longMarker: "#206D91"
      };
    }
    return {
      laneFill: "#F3F6F6",
      noteFill: "#E6E6E6",
      noteStroke: "#859198",
      longFill: "#BFC7CC",
      longMarker: "#7E8B92"
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

    const padding = large ? 10 : 3;
    const plotX = padding;
    const plotY = padding;
    const plotWidth = Math.max(1, width - padding * 2);
    const plotHeight = Math.max(1, height - padding * 2);
    const laneWidth = plotWidth / 8;
    const rangeStart = Math.max(0, Math.min(payload.resolution - 1, Number(viewRange?.startIndex) || 0));
    const rangeEnd = Math.max(
      rangeStart,
      Math.min(payload.resolution - 1, Number.isFinite(Number(viewRange?.endIndex))
        ? Number(viewRange.endIndex)
        : payload.resolution - 1)
    );
    const yForIndex = (index) => plotY
      + (index - rangeStart) / Math.max(rangeEnd - rangeStart, 1) * plotHeight;

    context.fillStyle = "#F3F6F6";
    context.fillRect(plotX, plotY, plotWidth, plotHeight);
    for (let lane = 0; lane < 8; lane += 1) {
      context.fillStyle = getLanePalette(lane).laneFill;
      context.fillRect(plotX + lane * laneWidth, plotY, laneWidth, plotHeight);
    }

    context.strokeStyle = "rgba(116, 132, 137, 0.2)";
    context.lineWidth = 1;
    for (let lane = 1; lane < 8; lane += 1) {
      const x = plotX + lane * laneWidth;
      context.beginPath();
      context.moveTo(x, plotY);
      context.lineTo(x, plotY + plotHeight);
      context.stroke();
    }

    context.strokeStyle = "#C9D3D6";
    context.lineWidth = large ? 1 : 0.7;
    for (let index = rangeStart; index <= rangeEnd; index += 1) {
      if (!bitAt(payload.measureBitset, index)) {
        continue;
      }
      const y = yForIndex(index);
      context.beginPath();
      context.moveTo(plotX, y);
      context.lineTo(plotX + plotWidth, y);
      context.stroke();
    }

    for (let lane = 0; lane < 8; lane += 1) {
      const x = plotX + lane * laneWidth;
      const activeBits = payload.longActiveBitsets[lane];
      context.fillStyle = getLanePalette(lane).longFill;
      let runStart = -1;
      for (let index = rangeStart; index <= rangeEnd + 1; index += 1) {
        const active = index <= rangeEnd && bitAt(activeBits, index);
        if (active && runStart < 0) {
          runStart = index;
        } else if (!active && runStart >= 0) {
          const yStart = yForIndex(runStart);
          const yEnd = yForIndex(Math.max(runStart + 1, index - 1));
          context.fillRect(x + laneWidth * 0.27, yStart, Math.max(1, laneWidth * 0.46), Math.max(1, yEnd - yStart));
          runStart = -1;
        }
      }
    }

    for (let lane = 0; lane < 8; lane += 1) {
      const x = plotX + lane * laneWidth;
      const tapBits = payload.tapBitsets[lane];
      const startBits = payload.longStartBitsets[lane];
      const endBits = payload.longEndBitsets[lane];
      const palette = getLanePalette(lane);
      for (let index = rangeStart; index <= rangeEnd; index += 1) {
        const y = yForIndex(index);
        if (bitAt(tapBits, index)) {
          const noteX = x + 0.7;
          const noteY = y - (large ? 1 : 0.5);
          const noteWidth = Math.max(1, laneWidth - 1.4);
          const noteHeight = large ? 2.2 : 1.2;
          context.fillStyle = palette.noteFill;
          context.fillRect(noteX, noteY, noteWidth, noteHeight);
          context.strokeStyle = palette.noteStroke;
          context.lineWidth = large ? 0.7 : 0.45;
          context.strokeRect(noteX, noteY, noteWidth, noteHeight);
        }
        if (bitAt(startBits, index) || bitAt(endBits, index)) {
          context.fillStyle = palette.longMarker;
          context.fillRect(x + laneWidth * 0.12, y - 1, Math.max(1, laneWidth * 0.76), large ? 2.5 : 1.5);
        }
      }
    }

    context.strokeStyle = "#8D9A9E";
    context.lineWidth = 1;
    context.strokeRect(plotX + 0.5, plotY + 0.5, Math.max(0, plotWidth - 1), Math.max(0, plotHeight - 1));
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
      <span class="chart-miniview-range-hint">左右キーでブロック移動 / Escで閉じる</span>
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

  function measureBoundaryIndex(payload, measure) {
    const measureCount = payload.endMeasure - payload.startMeasure + 1;
    const offset = Math.max(0, Math.min(measureCount, measure - payload.startMeasure));
    if (payload.measurePositions && payload.measurePositions.length === measureCount + 1) {
      return payload.measurePositions[offset];
    }
    return Math.round(offset / Math.max(measureCount, 1) * (payload.resolution - 1));
  }

  function buildBlockViewRange(payload, block) {
    const startMeasure = Math.max(payload.startMeasure, Number(block.startMeasure));
    const endMeasure = Math.min(payload.endMeasure, Number(block.endMeasure));
    if (!Number.isInteger(startMeasure) || !Number.isInteger(endMeasure) || endMeasure < startMeasure) {
      return null;
    }
    const startIndex = measureBoundaryIndex(payload, startMeasure);
    const endBoundary = measureBoundaryIndex(payload, endMeasure + 1);
    return {
      startIndex,
      endIndex: Math.max(startIndex + 1, Math.min(payload.resolution - 1, endBoundary - 1)),
      startMeasure,
      endMeasure
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
    }
    activeRangeTarget = target;
    activeRangeIndex = blockIndex;
    target.dataset.selectedBlock = String(blockIndex);
    target.dataset.previewActive = "true";
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
      if (rangePreviewLabel) {
        rangePreviewLabel.textContent = `小節 ${viewRange.startMeasure}-${viewRange.endMeasure}`;
      }
      if (rangePreviewMeta) {
        rangePreviewMeta.textContent = `block ${blockIndex + 1}/${ranges.length} · 7key SP`;
      }
      paintRowVersion(versionId, payload);
      positionRangePreview(target);
    } catch (error) {
      if (requestId !== rangePreviewRequestId) {
        return;
      }
      if (rangePreviewMeta) {
        rangePreviewMeta.textContent = "読み込めませんでした";
      }
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
    const localObserver = ensureObserver();
    root.querySelectorAll('.version-row[data-miniview-available="true"]').forEach((row) => {
      if (row.hidden) {
        return;
      }
      const cell = row.querySelector(":scope > .thumbnail-cell, :scope > .progress-thumbnail-block");
      if (!cell) {
        return;
      }
      ensureProgressSlot(cell);
      cell.classList.add("has-chart-miniview");
      cell.classList.remove("is-empty");

      let shell = cell.querySelector(":scope > .chart-miniview-shell");
      if (!shell) {
        shell = document.createElement("div");
        shell.className = "chart-miniview-shell";
        shell.innerHTML = `
          <button class="chart-miniview-button" type="button" data-state="idle">
            <canvas class="chart-miniview-canvas" aria-hidden="true"></canvas>
          </button>
        `;
        cell.appendChild(shell);
      }

      const button = shell.querySelector(".chart-miniview-button");
      const canvas = shell.querySelector("canvas");
      if (!button || !canvas) {
        return;
      }
      button.dataset.versionId = row.dataset.versionId || "";
      button.dataset.miniviewUrl = row.dataset.miniviewUrl || "";
      button.setAttribute("aria-label", "譜面ミニビューを読み込んで開く");
      button.title = "譜面ミニビュー";
      drawPlaceholder(canvas);

      const cached = payloadCache.get(button.dataset.versionId);
      if (cached) {
        paintRowVersion(button.dataset.versionId, cached);
      } else if (localObserver) {
        localObserver.observe(button);
      } else {
        queueLoad(button);
      }
    });
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
    if (!target || rangePreviewPinned) {
      return;
    }
    const blockIndex = blockIndexFromPointer(target, event.clientX);
    if (blockIndex >= 0) {
      showRangePreview(target, blockIndex);
    }
  });

  listElement.addEventListener("pointermove", (event) => {
    const target = getBlockNavigator(event);
    if (!target || rangePreviewPinned) {
      return;
    }
    const blockIndex = blockIndexFromPointer(target, event.clientX);
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
      const selected = Math.max(0, Number(rangeTarget.dataset.selectedBlock) || 0);
      if (rangePreviewPinned && activeRangeTarget === rangeTarget) {
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
