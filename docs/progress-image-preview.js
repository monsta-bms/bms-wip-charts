(() => {
  const defaultOptions = {
    width: 640,
    height: 120,
    paddingX: 14,
    densityTop: 10,
    densityHeight: 48,
    blockTop: 68,
    blockHeight: 8,
    labelY: 106,
    blockGap: 1,
    minUnpaintedZeroHeight: 3,
    minPaintedZeroHeight: 4,
    minDensityHeight: 6
  };

  const fallbackLayerColors = {
    initial: "#2E8B57",
    parent: "rgba(46, 139, 87, 0.32)",
    current: "#4A90E2",
    rejected: "#7A4A30",
    empty: "#CFE3DC",
    emptyRail: "#D8E8E2"
  };

  let currentPreviewUrl = "";

  function warnProgressImage(detail) {
    console.warn("[progress-image-preview] failed to create progress image", {
      code: "PROGRESS_IMAGE_PREVIEW_FAILED",
      detail
    });
  }

  function parseProgressMap(progressMap) {
    if (!progressMap) {
      return null;
    }

    if (typeof progressMap === "string") {
      return JSON.parse(progressMap);
    }

    if (typeof progressMap === "object") {
      return progressMap;
    }

    return null;
  }

  function normalizeBlock(block, fallbackIndex) {
    const index = Number.isInteger(Number(block?.index)) ? Number(block.index) : fallbackIndex;
    return {
      index,
      startMeasure: Number.isInteger(Number(block?.startMeasure)) ? Number(block.startMeasure) : null,
      endMeasure: Number.isInteger(Number(block?.endMeasure)) ? Number(block.endMeasure) : null,
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

  function resolveLayerRole(layer, layerIndex, layerCount, contextMode) {
    if (contextMode === "visible-append" || contextMode === "append") {
      return layerIndex === layerCount - 1 && String(layer?.kind || "") !== "parent_preview"
        ? "current"
        : "parent";
    }

    return "";
  }

  function getLayerFollowupIndex(layer, layerIndex) {
    if (Number.isInteger(Number(layer?.followupIndex))) {
      return Math.max(0, Number(layer.followupIndex));
    }

    return Math.max(0, Number(layerIndex) - 1);
  }

  function getEmptyFillColor() {
    return window.BmsProgressLayerColors?.PROGRESS_LAYER_COLORS?.empty?.fill || fallbackLayerColors.empty;
  }

  function getEmptyRailColor() {
    return window.BmsProgressLayerColors?.PROGRESS_LAYER_COLORS?.empty?.stroke || fallbackLayerColors.emptyRail;
  }

  function getLayerFillColor(layer, layerIndex, layerCount, contextMode) {
    const role = resolveLayerRole(layer, layerIndex, layerCount, contextMode);
    if (window.BmsProgressLayerColors?.getLayerFillColor) {
      return window.BmsProgressLayerColors.getLayerFillColor(layer, layerIndex, {
        role,
        followupIndex: getLayerFollowupIndex(layer, layerIndex)
      });
    }

    if (role === "parent") {
      return fallbackLayerColors.parent;
    }
    if (role === "current") {
      return fallbackLayerColors.current;
    }
    if (layer?.kind === "rejected_auto_fill") {
      return fallbackLayerColors.rejected;
    }
    if (layer?.kind === "followup" || String(layer?.color || "").toLowerCase() === "#2563eb") {
      return fallbackLayerColors.current;
    }
    return fallbackLayerColors.initial;
  }

  function collectLayerPaint(progressMap, totalBlocks, contextMode) {
    const paintedIndexes = new Set();
    const blockColorByIndex = new Map();

    if (!Array.isArray(progressMap.layers)) {
      throw new Error("progressMap.layers is missing.");
    }

    progressMap.layers.forEach((layer, layerIndex) => {
      if (!layer || !Array.isArray(layer.ranges)) {
        warnProgressImage(`layers[${layerIndex}].ranges is missing.`);
        return;
      }

      const fillColor = getLayerFillColor(layer, layerIndex, progressMap.layers.length, contextMode);
      layer.ranges.forEach((range, rangeIndex) => {
        const normalizedRange = normalizeRange(range);
        if (!normalizedRange) {
          warnProgressImage(`layers[${layerIndex}].ranges[${rangeIndex}] is invalid.`);
          return;
        }

        const [start, end] = normalizedRange;
        const safeStart = Math.max(0, start);
        const safeEnd = Math.min(totalBlocks - 1, end);
        for (let index = safeStart; index <= safeEnd; index += 1) {
          paintedIndexes.add(index);
          blockColorByIndex.set(index, fillColor);
        }
      });
    });

    return {
      paintedIndexes,
      blockColorByIndex
    };
  }

  function normalizeProgressImageModel(progressMapValue, options = {}) {
    const progressMap = parseProgressMap(progressMapValue);
    if (!progressMap || typeof progressMap !== "object") {
      throw new Error("progressMap is missing.");
    }

    if (!Array.isArray(progressMap.blocks) || progressMap.blocks.length === 0) {
      throw new Error("progressMap.blocks is missing or empty.");
    }

    const blocks = progressMap.blocks.map(normalizeBlock);
    const layerPaint = collectLayerPaint(progressMap, blocks.length, options.contextMode || "saved");
    const calculatedProgress = Math.round((layerPaint.paintedIndexes.size / blocks.length) * 100);
    const progress = Number.isFinite(Number(progressMap.progress))
      ? Number(progressMap.progress)
      : calculatedProgress;

    return {
      blocks,
      paintedIndexes: layerPaint.paintedIndexes,
      blockColorByIndex: layerPaint.blockColorByIndex,
      progress
    };
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

  function calculateDensityScale(densities) {
    const values = densities
      .map((item) => item.densityValue)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);

    if (values.length === 0) {
      return 1;
    }

    const percentileIndex = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * 0.95)));
    return Math.max(1, values[percentileIndex]);
  }

  function buildProgressImageLayout(blockCount, settings) {
    const safeBlockCount = Math.max(1, blockCount);
    const plotX = settings.paddingX;
    const plotWidth = Math.max(1, settings.width - settings.paddingX * 2);
    const requestedGap = Number.isFinite(Number(settings.blockGap)) ? Math.max(0, Number(settings.blockGap)) : 1;
    const gap = safeBlockCount > 160 ? Math.min(0.5, requestedGap) : requestedGap;
    const availableWidth = Math.max(1, plotWidth - Math.max(0, safeBlockCount - 1) * gap);
    const blockWidth = Math.max(0.5, availableWidth / safeBlockCount);
    const stride = blockWidth + gap;

    return {
      blockCount: safeBlockCount,
      blockWidth,
      gap,
      plotWidth,
      plotX,
      xForBlock(index) {
        return plotX + Math.max(0, index) * stride;
      }
    };
  }

  function getBarHeight(densityValue, densityScale, painted, settings) {
    if (densityValue <= 0) {
      return painted ? settings.minPaintedZeroHeight : settings.minUnpaintedZeroHeight;
    }

    const normalized = Math.min(1, Math.sqrt(densityValue / Math.max(1, densityScale)));
    return Math.max(settings.minDensityHeight, normalized * settings.densityHeight);
  }

  function drawRoundedRect(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  }

  function createProgressImageCanvas(progressMap, options = {}) {
    const model = normalizeProgressImageModel(progressMap, options);
    const settings = { ...defaultOptions, ...options };
    const canvas = document.createElement("canvas");
    canvas.width = settings.width;
    canvas.height = settings.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }

    const blocks = model.blocks;
    const blockCount = blocks.length;
    const layout = buildProgressImageLayout(blockCount, settings);
    const densities = buildBlockDensities(blocks);
    const densityScale = calculateDensityScale(densities);
    const emptyFill = getEmptyFillColor();
    const emptyRail = getEmptyRailColor();

    context.clearRect(0, 0, settings.width, settings.height);
    context.fillStyle = "#f8fafb";
    context.fillRect(0, 0, settings.width, settings.height);

    context.strokeStyle = "#d8e1e8";
    context.lineWidth = 1;
    drawRoundedRect(context, 0.5, 0.5, settings.width - 1, settings.height - 1, 8);
    context.stroke();

    const densityBaseY = settings.densityTop + settings.densityHeight;
    context.fillStyle = "#eef6f2";
    context.fillRect(layout.plotX, settings.densityTop, layout.plotWidth, settings.densityHeight);

    context.strokeStyle = "#dce4ea";
    context.beginPath();
    context.moveTo(layout.plotX, densityBaseY + 0.5);
    context.lineTo(layout.plotX + layout.plotWidth, densityBaseY + 0.5);
    context.stroke();

    densities.forEach((item, index) => {
      const x = layout.xForBlock(index);
      const painted = model.paintedIndexes.has(index);
      const barHeight = getBarHeight(item.densityValue, densityScale, painted, settings);
      context.fillStyle = model.blockColorByIndex.get(index) || emptyFill;
      context.fillRect(x, densityBaseY - barHeight, layout.blockWidth, barHeight);
    });

    context.fillStyle = emptyRail;
    drawRoundedRect(context, layout.plotX, settings.blockTop, layout.plotWidth, settings.blockHeight, settings.blockHeight / 2);
    context.fill();

    blocks.forEach((_, index) => {
      const x = layout.xForBlock(index);
      context.fillStyle = model.blockColorByIndex.get(index) || emptyRail;
      context.fillRect(x, settings.blockTop, layout.blockWidth, settings.blockHeight);
    });

    if (layout.blockWidth >= 2.4) {
      context.strokeStyle = "rgba(91, 101, 114, 0.12)";
      context.lineWidth = 1;
      blocks.forEach((_, index) => {
        const x = layout.xForBlock(index);
        context.beginPath();
        context.moveTo(x + 0.5, settings.blockTop);
        context.lineTo(x + 0.5, settings.blockTop + settings.blockHeight);
        context.stroke();
      });
    }

    context.strokeStyle = "rgba(59, 68, 78, 0.78)";
    context.lineWidth = 1.3;
    blocks.forEach((_, index) => {
      if (index % 8 !== 0) {
        return;
      }

      const x = layout.xForBlock(index);
      context.beginPath();
      context.moveTo(x + 0.5, settings.densityTop);
      context.lineTo(x + 0.5, settings.blockTop + settings.blockHeight + 2);
      context.stroke();
    });

    context.strokeStyle = "#d8e1e8";
    context.lineWidth = 1;
    context.strokeRect(layout.plotX + 0.5, settings.blockTop + 0.5, layout.plotWidth - 1, settings.blockHeight - 1);

    context.fillStyle = "#1c5749";
    context.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    context.textBaseline = "middle";
    context.fillText(`progress ${model.progress}%`, layout.plotX, settings.labelY);

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas toBlob returned null."));
          }
        }, "image/png");
        return;
      }

      try {
        const dataUrl = canvas.toDataURL("image/png");
        const binary = atob(dataUrl.split(",")[1] || "");
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        resolve(new Blob([bytes], { type: "image/png" }));
      } catch (error) {
        reject(error);
      }
    });
  }

  function createProgressImageBlob(progressMap, options = {}) {
    return canvasToBlob(createProgressImageCanvas(progressMap, options));
  }

  function parseTimeRangePart(value) {
    const match = String(value || "").match(/(\d+):(\d{2})(?:\s*-\s*(\d+):(\d{2}))?/);
    if (!match) {
      return [null, null];
    }

    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = match[3] ? Number(match[3]) * 60 + Number(match[4]) : null;
    return [start, end];
  }

  function parseMeasureRangePart(value) {
    const cleanValue = String(value || "").replace(/^小節:\s*/, "").trim();
    const match = cleanValue.match(/^(\d{1,3})(?:\s*-\s*(\d{1,3}))?/);
    if (!match) {
      return [null, null];
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    return [start, end];
  }

  function blockFromElement(blockElement, fallbackIndex) {
    const ariaLabel = blockElement.getAttribute("aria-label") || "";
    const parts = ariaLabel.split(",").map((part) => part.trim()).filter(Boolean);
    const notesMatch = ariaLabel.match(/notes:\s*(\d+)/i);
    const measurePart = parts.find((part) => /^小節:/.test(part) || /^\d{3}(?:\s*-\s*\d{3})?$/.test(part));
    const timePart = parts.find((part) => /^time:/.test(part) || /^\d+:\d{2}/.test(part));
    const [startMeasure, endMeasure] = parseMeasureRangePart(measurePart);
    const [startTimeSec, endTimeSec] = parseTimeRangePart(timePart);
    const index = Number.isInteger(Number(blockElement.dataset.blockIndex))
      ? Number(blockElement.dataset.blockIndex)
      : fallbackIndex;

    return {
      index,
      startMeasure,
      endMeasure,
      startTimeSec,
      endTimeSec,
      playNotes: notesMatch ? Number(notesMatch[1]) : 0
    };
  }

  function compressRanges(indexes) {
    const sorted = [...indexes].sort((a, b) => a - b);
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

  function getLayerStorageColor(layer, layerIndex, context) {
    if (window.BmsProgressLayerColors?.getLayerStorageColor) {
      return window.BmsProgressLayerColors.getLayerStorageColor(layer, layerIndex, context);
    }

    if (context?.role === "current" || layer?.kind === "followup") {
      return "#2563eb";
    }

    return "#1f7a5c";
  }

  function getAppendParentBranchPath() {
    const parentVersionElement = document.querySelector("#appendParentVersion");
    const rawText = `${parentVersionElement?.title || ""} ${parentVersionElement?.textContent || ""}`;
    const branchMatch = rawText.match(/branchPath:\s*([^\s/]+(?:\/[A-Za-z]+)*)|\b(root(?:\/[A-Za-z]+)*)\b/);
    return branchMatch?.[1] || branchMatch?.[2] || "root";
  }

  function getBranchDepth(branchPath) {
    const parts = String(branchPath || "root").split("/").filter(Boolean);
    return Math.max(0, parts[0] === "root" ? parts.length - 1 : parts.length);
  }

  function getCurrentAppendFollowupIndex() {
    return getBranchDepth(getAppendParentBranchPath());
  }

  function syncVisibleProgressLayerCssVariables() {
    const isAppendMode = document.querySelector(".submit-panel")?.classList.contains("is-append-mode");
    if (!window.BmsProgressLayerColors?.getFollowupColor) {
      return;
    }

    const followupIndex = isAppendMode ? getCurrentAppendFollowupIndex() : 0;
    document.documentElement.style.setProperty(
      "--progress-fill-current",
      window.BmsProgressLayerColors.getFollowupColor(followupIndex).fill
    );
  }

  function buildProgressMapFromVisibleEditor() {
    const blockElements = Array.from(document.querySelectorAll("#progressMapBlocks .progress-map-block"));
    if (blockElements.length === 0) {
      return null;
    }

    const blocks = blockElements.map(blockFromElement);
    const parentIndexes = new Set();
    const currentIndexes = new Set();
    const initialIndexes = new Set();
    const appendMode = document.querySelector(".submit-panel")?.classList.contains("is-append-mode");
    const rejected = Boolean(document.querySelector("#isRejected")?.checked);
    const followupIndex = appendMode ? getCurrentAppendFollowupIndex() : 0;

    blockElements.forEach((blockElement, fallbackIndex) => {
      const index = Number.isInteger(Number(blockElement.dataset.blockIndex))
        ? Number(blockElement.dataset.blockIndex)
        : fallbackIndex;
      const parentPainted = blockElement.classList.contains("is-parent-painted");
      const currentPainted = blockElement.classList.contains("is-current-painted");
      const painted = blockElement.classList.contains("is-painted");

      if (appendMode) {
        if (parentPainted) {
          parentIndexes.add(index);
        }
        if (currentPainted) {
          currentIndexes.add(index);
        }
        return;
      }

      if (painted) {
        initialIndexes.add(index);
      }
    });

    const layers = [];
    if (appendMode) {
      layers.push({
        versionId: "preview-parent",
        color: getLayerStorageColor({ kind: "parent_preview" }, 0, { role: "parent" }),
        kind: "parent_preview",
        ranges: compressRanges(parentIndexes)
      });
      layers.push({
        versionId: "preview-current",
        color: getLayerStorageColor({ kind: "followup", followupIndex }, 1, { role: "current", followupIndex }),
        followupIndex,
        kind: "followup",
        ranges: compressRanges(currentIndexes)
      });
    } else {
      const layerKind = rejected ? "rejected_auto_fill" : "initial";
      layers.push({
        versionId: "preview",
        color: getLayerStorageColor({ kind: layerKind }, 0, {}),
        kind: layerKind,
        ranges: compressRanges(initialIndexes)
      });
    }

    const progressInput = document.querySelector("#progress");
    const union = new Set([...parentIndexes, ...currentIndexes, ...initialIndexes]);
    const progress = Number.isFinite(Number(progressInput?.value))
      ? Number(progressInput.value)
      : Math.round((union.size / blockElements.length) * 100);

    return {
      schemaVersion: 2,
      blockMode: "standardized_measure",
      targetBlockCount: blockElements.length,
      blocks,
      layers,
      progress
    };
  }

  function getCurrentProgressMapForPreview() {
    const isAppendMode = document.querySelector(".submit-panel")?.classList.contains("is-append-mode");
    if (isAppendMode) {
      const progressMap = window.BmsAppendProgressMap?.getCurrentProgressMap?.() || buildProgressMapFromVisibleEditor();
      return { progressMap, contextMode: "append" };
    }

    if (window.BmsProgressMapForm?.getCurrentProgressMap) {
      const progressMap = window.BmsProgressMapForm.getCurrentProgressMap();
      if (progressMap) {
        return { progressMap, contextMode: "initial" };
      }
    }

    if (typeof window.buildProgressMapPayload === "function") {
      const progressMap = window.buildProgressMapPayload();
      if (progressMap) {
        return { progressMap, contextMode: "initial" };
      }
    }

    return { progressMap: buildProgressMapFromVisibleEditor(), contextMode: isAppendMode ? "append" : "initial" };
  }

  async function renderProgressImagePreview(progressMap, elements, options = {}) {
    const blob = await createProgressImageBlob(progressMap, options);
    const url = URL.createObjectURL(blob);

    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
    }
    currentPreviewUrl = url;

    elements.previewImage.src = url;
    elements.previewImage.alt = "進捗画像PNGプレビュー";
    elements.previewFrame.hidden = false;
    elements.downloadLink.href = url;
    elements.downloadLink.download = "progress-preview.png";
    elements.downloadLink.hidden = false;
    elements.status.textContent = "PNGプレビューを生成しました。";
    elements.status.classList.remove("is-error");
  }

  function mountPreviewUi() {
    const progressMapField = document.querySelector(".progress-map-field");
    const progressMap = document.querySelector("#progressMap");
    if (!progressMapField || !progressMap || document.querySelector("#progressImagePreviewPanel")) {
      return;
    }

    const panel = document.createElement("div");
    panel.className = "progress-image-preview-panel";
    panel.id = "progressImagePreviewPanel";
    panel.innerHTML = `
      <div class="progress-image-preview-actions">
        <button class="secondary progress-image-preview-button" id="progressImagePreviewButton" type="button">進捗画像を確認</button>
        <a class="progress-image-download-link" id="progressImageDownloadLink" hidden>PNGをダウンロード</a>
      </div>
      <p class="progress-image-preview-status" id="progressImagePreviewStatus">PNGは投稿にはまだ送信されません。</p>
      <div class="progress-image-preview-frame" id="progressImagePreviewFrame" hidden>
        <img class="progress-image-preview" id="progressImagePreview" alt="">
      </div>
    `;
    progressMap.insertAdjacentElement("afterend", panel);
    syncVisibleProgressLayerCssVariables();

    const elements = {
      button: panel.querySelector("#progressImagePreviewButton"),
      downloadLink: panel.querySelector("#progressImageDownloadLink"),
      status: panel.querySelector("#progressImagePreviewStatus"),
      previewFrame: panel.querySelector("#progressImagePreviewFrame"),
      previewImage: panel.querySelector("#progressImagePreview")
    };

    elements.button.addEventListener("click", async () => {
      elements.status.textContent = "PNGプレビューを生成中です。";
      elements.status.classList.remove("is-error");
      syncVisibleProgressLayerCssVariables();

      try {
        const previewSource = getCurrentProgressMapForPreview();
        if (!previewSource.progressMap) {
          throw new Error("進捗マップ表示後にPNGを生成できます。");
        }

        await renderProgressImagePreview(previewSource.progressMap, elements, {
          contextMode: previewSource.contextMode
        });
      } catch (error) {
        warnProgressImage(error instanceof Error ? error.message : String(error));
        elements.status.textContent = error instanceof Error ? error.message : "PNG生成に失敗しました。";
        elements.status.classList.add("is-error");
        elements.previewFrame.hidden = true;
        elements.downloadLink.hidden = true;
      }
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest(".append-version-button, #cancelAppendButton")) {
        window.setTimeout(syncVisibleProgressLayerCssVariables, 0);
      }
    });
  }

  window.BmsProgressImage = {
    createProgressImageCanvas,
    createProgressImageBlob,
    renderProgressImagePreview,
    buildProgressMapFromVisibleEditor
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountPreviewUi, { once: true });
  } else {
    mountPreviewUi();
  }
})();
