(() => {
  const defaultOptions = {
    width: 640,
    height: 120,
    paddingX: 14,
    densityTop: 10,
    densityHeight: 52,
    blockTop: 72,
    blockHeight: 26,
    labelY: 112
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

  function collectPaintedIndexes(progressMap, totalBlocks) {
    const painted = new Set();

    if (!Array.isArray(progressMap.layers)) {
      throw new Error("progressMap.layers is missing.");
    }

    progressMap.layers.forEach((layer, layerIndex) => {
      if (!layer || !Array.isArray(layer.ranges)) {
        warnProgressImage(`layers[${layerIndex}].ranges is missing.`);
        return;
      }

      layer.ranges.forEach((range, rangeIndex) => {
        if (!Array.isArray(range) || range.length !== 2) {
          warnProgressImage(`layers[${layerIndex}].ranges[${rangeIndex}] is invalid.`);
          return;
        }

        const start = Number(range[0]);
        const end = Number(range[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
          warnProgressImage(`layers[${layerIndex}].ranges[${rangeIndex}] has invalid numbers.`);
          return;
        }

        const safeStart = Math.max(0, start);
        const safeEnd = Math.min(totalBlocks - 1, end);
        for (let index = safeStart; index <= safeEnd; index += 1) {
          painted.add(index);
        }
      });
    });

    return painted;
  }

  function normalizeProgressImageModel(progressMapValue) {
    const progressMap = parseProgressMap(progressMapValue);
    if (!progressMap || typeof progressMap !== "object") {
      throw new Error("progressMap is missing.");
    }

    if (!Array.isArray(progressMap.blocks) || progressMap.blocks.length === 0) {
      throw new Error("progressMap.blocks is missing or empty.");
    }

    const blocks = progressMap.blocks.map(normalizeBlock);
    const paintedIndexes = collectPaintedIndexes(progressMap, blocks.length);
    const calculatedProgress = Math.round((paintedIndexes.size / blocks.length) * 100);
    const progress = Number.isFinite(Number(progressMap.progress))
      ? Number(progressMap.progress)
      : calculatedProgress;

    return {
      blocks,
      paintedIndexes,
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
    const model = normalizeProgressImageModel(progressMap);
    const settings = { ...defaultOptions, ...options };
    const canvas = document.createElement("canvas");
    canvas.width = settings.width;
    canvas.height = settings.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is not available.");
    }

    const innerX = settings.paddingX;
    const innerWidth = settings.width - settings.paddingX * 2;
    const blocks = model.blocks;
    const blockCount = blocks.length;
    const slotWidth = innerWidth / blockCount;
    const densities = buildBlockDensities(blocks);
    const maxDensity = Math.max(1, ...densities.map((item) => item.densityValue));

    context.clearRect(0, 0, settings.width, settings.height);
    context.fillStyle = "#f8fafb";
    context.fillRect(0, 0, settings.width, settings.height);

    context.strokeStyle = "#d8e1e8";
    context.lineWidth = 1;
    drawRoundedRect(context, 0.5, 0.5, settings.width - 1, settings.height - 1, 8);
    context.stroke();

    const densityBaseY = settings.densityTop + settings.densityHeight;
    context.strokeStyle = "#dce4ea";
    context.beginPath();
    context.moveTo(innerX, densityBaseY + 0.5);
    context.lineTo(innerX + innerWidth, densityBaseY + 0.5);
    context.stroke();

    context.fillStyle = "rgba(42, 128, 116, 0.5)";
    densities.forEach((item, index) => {
      const x = innerX + index * slotWidth;
      const barHeight = Math.max(item.densityValue > 0 ? 2 : 0, (item.densityValue / maxDensity) * settings.densityHeight);
      context.fillRect(x, densityBaseY - barHeight, Math.max(1, Math.ceil(slotWidth)), barHeight);
    });

    blocks.forEach((block, index) => {
      const x = innerX + index * slotWidth;
      const width = Math.max(1, Math.ceil(slotWidth));
      context.fillStyle = model.paintedIndexes.has(block.index) ? "rgba(37, 111, 93, 0.78)" : "#edf2f5";
      context.fillRect(x, settings.blockTop, width, settings.blockHeight);
    });

    context.strokeStyle = "rgba(91, 101, 114, 0.18)";
    context.lineWidth = 1;
    blocks.forEach((_, index) => {
      const x = innerX + index * slotWidth;
      context.beginPath();
      context.moveTo(x + 0.5, settings.blockTop);
      context.lineTo(x + 0.5, settings.blockTop + settings.blockHeight);
      context.stroke();
    });

    context.strokeStyle = "rgba(59, 68, 78, 0.82)";
    context.lineWidth = 1.5;
    blocks.forEach((_, index) => {
      if (index % 8 !== 0) {
        return;
      }

      const x = innerX + index * slotWidth;
      context.beginPath();
      context.moveTo(x + 0.5, settings.blockTop - 2);
      context.lineTo(x + 0.5, settings.blockTop + settings.blockHeight + 2);
      context.stroke();
    });

    context.strokeStyle = "#d8e1e8";
    context.lineWidth = 1;
    context.strokeRect(innerX + 0.5, settings.blockTop + 0.5, innerWidth - 1, settings.blockHeight - 1);

    context.fillStyle = "#1c5749";
    context.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    context.textBaseline = "middle";
    context.fillText(`progress ${model.progress}%`, innerX, settings.labelY);

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

  function buildProgressMapFromVisibleEditor() {
    const blockElements = Array.from(document.querySelectorAll("#progressMapBlocks .progress-map-block"));
    if (blockElements.length === 0) {
      return null;
    }

    const blocks = blockElements.map(blockFromElement);
    const paintedIndexes = new Set();
    blockElements.forEach((blockElement, fallbackIndex) => {
      const index = Number.isInteger(Number(blockElement.dataset.blockIndex))
        ? Number(blockElement.dataset.blockIndex)
        : fallbackIndex;
      if (
        blockElement.classList.contains("is-painted") ||
        blockElement.classList.contains("is-parent-painted") ||
        blockElement.classList.contains("is-current-painted")
      ) {
        paintedIndexes.add(index);
      }
    });

    const progressInput = document.querySelector("#progress");
    const progress = Number.isFinite(Number(progressInput?.value))
      ? Number(progressInput.value)
      : Math.round((paintedIndexes.size / blockElements.length) * 100);

    return {
      schemaVersion: 2,
      blockMode: "standardized_measure",
      targetBlockCount: blockElements.length,
      blocks,
      layers: [
        {
          versionId: "preview",
          color: "#1f7a5c",
          kind: "preview_union",
          ranges: compressRanges(paintedIndexes)
        }
      ],
      progress
    };
  }

  function getCurrentProgressMapForPreview() {
    const isAppendMode = document.querySelector(".submit-panel")?.classList.contains("is-append-mode");
    if (isAppendMode) {
      return buildProgressMapFromVisibleEditor();
    }

    if (window.BmsProgressMapForm?.getCurrentProgressMap) {
      const progressMap = window.BmsProgressMapForm.getCurrentProgressMap();
      if (progressMap) {
        return progressMap;
      }
    }

    if (typeof window.buildProgressMapPayload === "function") {
      const progressMap = window.buildProgressMapPayload();
      if (progressMap) {
        return progressMap;
      }
    }

    return buildProgressMapFromVisibleEditor();
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

      try {
        const progressMapValue = getCurrentProgressMapForPreview();
        if (!progressMapValue) {
          throw new Error("進捗マップ表示後にPNGを生成できます。");
        }

        await renderProgressImagePreview(progressMapValue, elements);
      } catch (error) {
        warnProgressImage(error instanceof Error ? error.message : String(error));
        elements.status.textContent = error instanceof Error ? error.message : "PNG生成に失敗しました。";
        elements.status.classList.add("is-error");
        elements.previewFrame.hidden = true;
        elements.downloadLink.hidden = true;
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
