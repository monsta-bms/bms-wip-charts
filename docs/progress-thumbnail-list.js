(() => {
  const thumbnailMaxCells = 96;
  const listElement = document.querySelector("#chartList");
  let progressThumbnailMountFrame = 0;
  let progressThumbnailObserver = null;
  let progressThumbnailBridgeInstalled = false;
  let progressImageGenerationWarnCount = 0;
  const maxProgressImageGenerationWarnings = 5;
  const emptyBarFill = "#D3E5DF";
  const emptyStripFill = "#DCEAE5";
  const colorLabels = ["青", "紫", "橙", "赤", "水色"];
  const progressBlockRangesByVersionId = new Map();

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

  function downloadUrl(value) {
    if (!value) {
      return "";
    }

    if (typeof buildDownloadUrl === "function") {
      return buildDownloadUrl(value);
    }

    return value;
  }

  function ensureProgressImageThumbnailStyle() {
    if (document.querySelector("#progress-image-thumbnail-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "progress-image-thumbnail-style";
    style.textContent = `
      .progress-thumbnail-image-wrap {
        align-items: center;
        background: #f4f7f9;
        border: 1px solid #dfe6ec;
        border-radius: 6px;
        display: flex;
        height: 38px;
        justify-content: center;
        max-width: 220px;
        min-width: 96px;
        overflow: hidden;
        width: 100%;
      }

      .progress-thumbnail-image {
        display: block;
        height: 100%;
        object-fit: contain;
        width: 100%;
      }

      .thumbnail-cell .progress-thumbnail-image-wrap {
        max-width: 100%;
      }

      .progress-thumbnail.is-empty .progress-thumbnail-value {
        color: #8a96a3;
      }

      @media (max-width: 640px) {
        .progress-thumbnail-image-wrap {
          max-width: none;
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function warnProgressThumbnail(versionId, detail) {
    console.warn("[progress-thumbnail-render] failed to render progress thumbnail", {
      code: "PROGRESS_THUMBNAIL_RENDER_SKIPPED",
      versionId: versionId || "unknown",
      detail
    });
  }

  function warnProgressImageNotGenerated(version, detail) {
    if (progressImageGenerationWarnCount >= maxProgressImageGenerationWarnings) {
      return;
    }

    progressImageGenerationWarnCount += 1;
    console.warn("[progress-thumbnail-image] progressImage url exists but R2 image thumbnail was not generated", {
      versionId: getVersionId(version) || "unknown",
      progressImageUrl: getRawProgressImageUrl(version),
      detail
    });
  }

  function debugProgressImage(versionId, src) {
    console.debug("[progress-thumbnail-image] using stored progress image", {
      versionId: versionId || "unknown",
      src
    });
  }

  function resolveApiUrl(value) {
    const url = String(value || "").trim();
    if (!url) {
      return "";
    }

    if (/^blob:/i.test(url)) {
      warnProgressThumbnail("unknown", "blob URL is not allowed for list thumbnails; use progressImage.url from R2.");
      return "";
    }

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    try {
      if (typeof buildApiUrl === "function") {
        return buildApiUrl(url);
      }
    } catch (error) {
      warnProgressThumbnail("unknown", `buildApiUrl failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const fallbackBase = typeof API_BASE_URL !== "undefined" ? API_BASE_URL : window.location.origin;
      return new URL(url, fallbackBase).toString();
    } catch (error) {
      warnProgressThumbnail("unknown", `progressImage.url is invalid: ${error instanceof Error ? error.message : String(error)}`);
      return "";
    }
  }

  const progressImageObjectKeys = [
    "progressImage",
    "progress_image",
    "progressImageObject",
    "progress_image_object"
  ];

  const progressImageUrlKeys = [
    "progressImageUrl",
    "progressImageURL",
    "progress_image_url",
    "progress_image_URL",
    "progressImageSrc",
    "progress_image_src",
    "progressImageHref",
    "progress_image_href",
    "progressImagePath",
    "progress_image_path"
  ];

  const progressImageNestedUrlKeys = [
    "url",
    "href",
    "src",
    "path",
    "downloadUrl",
    "download_url",
    "imageUrl",
    "image_url",
    "imageURL",
    "progressImageUrl",
    "progressImageURL",
    "progress_image_url"
  ];

  function firstStringValue(values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  function getVersionId(version) {
    return version?.id || version?.versionId || version?.version_id || "";
  }

  function getBranchPath(version) {
    return version?.branchPath || version?.branch_path || "";
  }

  function pickProgressImageUrl(value) {
    if (typeof value === "string") {
      return value;
    }

    if (!value || typeof value !== "object") {
      return "";
    }

    const directUrl = firstStringValue(progressImageNestedUrlKeys.map((key) => value[key]));
    if (directUrl) {
      return directUrl;
    }

    const nestedCandidates = [value.image, value.file, value.progressImage, value.progress_image];
    for (const nested of nestedCandidates) {
      if (nested && nested !== value) {
        const nestedUrl = pickProgressImageUrl(nested);
        if (nestedUrl) {
          return nestedUrl;
        }
      }
    }

    return "";
  }

  function hasProgressImageMetadata(value) {
    if (!value || typeof value !== "object") {
      return false;
    }

    if (pickProgressImageUrl(value)) {
      return true;
    }

    return Boolean(
      value.key ||
      value.r2Key ||
      value.r2_key ||
      value.sha256 ||
      value.mime ||
      value.mimeType ||
      value.mime_type ||
      value.createdAt ||
      value.created_at ||
      Number.isFinite(Number(value.size))
    );
  }

  function getRawProgressImageUrl(version) {
    if (!version || typeof version !== "object") {
      return "";
    }

    const directUrl = firstStringValue(progressImageUrlKeys.map((key) => version[key]));
    if (directUrl) {
      return directUrl;
    }

    for (const key of progressImageObjectKeys) {
      const objectUrl = pickProgressImageUrl(version[key]);
      if (objectUrl) {
        return objectUrl;
      }
    }

    for (const [key, value] of Object.entries(version)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      if (!normalizedKey.includes("progress") || !normalizedKey.includes("image")) {
        continue;
      }

      const discoveredUrl = pickProgressImageUrl(value);
      if (discoveredUrl) {
        return discoveredUrl;
      }
    }

    const versionId = getVersionId(version);
    if (versionId) {
      for (const key of progressImageObjectKeys) {
        if (hasProgressImageMetadata(version[key])) {
          return `/api/progress-images/${encodeURIComponent(versionId)}`;
        }
      }
    }

    return "";
  }

  function getProgressImageUrl(version) {
    const rawUrl = getRawProgressImageUrl(version);
    return resolveApiUrl(rawUrl);
  }

  function parseProgressMap(progressMap, versionId) {
    if (!progressMap) {
      return null;
    }

    if (typeof progressMap === "string") {
      try {
        return JSON.parse(progressMap);
      } catch (error) {
        warnProgressThumbnail(versionId, error instanceof Error ? error.message : String(error));
        return null;
      }
    }

    if (typeof progressMap === "object") {
      return progressMap;
    }

    warnProgressThumbnail(versionId, "progressMap is neither object nor JSON string.");
    return null;
  }

  function sanitizeCssColor(value, fallback) {
    const color = String(value || "").trim();
    if (/^#[0-9a-f]{3,8}$/i.test(color)) {
      return color;
    }
    if (/^rgba?\([0-9\s.,%+-]+\)$/i.test(color)) {
      return color;
    }
    if (/^hsla?\([0-9\s.,%+-]+\)$/i.test(color)) {
      return color;
    }
    return fallback;
  }

  function resolveLayerFill(layer, index, context) {
    const helpers = window.BmsProgressLayerColors || null;
    const fallback = layer?.color || "#2E8B57";
    if (helpers?.getLayerFillColor) {
      return sanitizeCssColor(helpers.getLayerFillColor(layer, index, context), fallback);
    }
    return sanitizeCssColor(fallback, "#2E8B57");
  }

  function getBlockDensityValue(block) {
    const playNotes = Number(block?.playNotes ?? block?.play_notes ?? block?.notes ?? block?.noteCount ?? 0);
    const start = Number(block?.startTimeSec ?? block?.start_time_sec ?? block?.startSec ?? 0);
    const end = Number(block?.endTimeSec ?? block?.end_time_sec ?? block?.endSec ?? 0);
    const duration = end > start ? end - start : 0;
    if (duration > 0) {
      return Math.max(0, playNotes / duration);
    }
    return Math.max(0, playNotes);
  }

  function getLayerColorLabel(layer, index) {
    const kind = String(layer?.kind || "").toLowerCase();
    if (kind === "initial" || kind === "rejected_auto_fill" || index === 0) {
      return "緑";
    }
    if (kind === "completion_fill") {
      return "緑";
    }
    return colorLabels[Math.max(0, index - 1) % colorLabels.length];
  }

  function getLayerContributorLabel(layer, index, context) {
    const versionId = String(layer?.versionId || layer?.version_id || "").trim();
    const author = versionId && context?.authorByVersionId?.get(versionId);
    if (author) {
      return author;
    }

    const kind = String(layer?.kind || "").toLowerCase();
    if (versionId === "pending") {
      return "今回追記";
    }
    if (kind === "initial" || kind === "rejected_auto_fill" || index === 0) {
      return "初回";
    }
    if (kind === "completion_fill") {
      return "完成補完";
    }
    if (kind === "followup") {
      return `追記${Math.max(1, index)}`;
    }
    return `layer ${index + 1}`;
  }

  function collectDensityValuesFromProgressMap(progressMap) {
    if (!progressMap || !Array.isArray(progressMap.blocks)) {
      return [];
    }

    return progressMap.blocks
      .map(getBlockDensityValue)
      .filter((value) => Number.isFinite(value) && value > 0);
  }

  function calculateDensityScale(values) {
    const positiveValues = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (positiveValues.length === 0) {
      return null;
    }

    const percentileIndex = Math.min(positiveValues.length - 1, Math.max(0, Math.floor((positiveValues.length - 1) * 0.95)));
    return Math.max(1, positiveValues[percentileIndex]);
  }

  function calculateListDensityScale(data) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];
    const values = [];

    for (const entry of charts) {
      const versions = Array.isArray(entry?.versions) ? entry.versions : [];
      for (const version of versions) {
        const progressMap = parseProgressMap(version?.progressMap, getVersionId(version) || "unknown");
        values.push(...collectDensityValuesFromProgressMap(progressMap));
      }
    }

    return calculateDensityScale(values);
  }

  function buildAuthorByVersionId(versions) {
    const authorByVersionId = new Map();
    for (const version of versions || []) {
      const versionId = getVersionId(version);
      const author = String(version?.author || version?.user || "").trim();
      if (versionId && author) {
        authorByVersionId.set(versionId, author);
      }
    }
    return authorByVersionId;
  }

  function buildThumbnailContext(versions, densityScale) {
    return {
      authorByVersionId: buildAuthorByVersionId(versions),
      densityScale
    };
  }

  function normalizeProgressThumbnail(version, context = {}) {
    const versionId = getVersionId(version) || "unknown";
    const progressMap = parseProgressMap(version?.progressMap, versionId);
    if (!progressMap) {
      return null;
    }

    if (progressMap.schemaVersion !== 2 || progressMap.blockMode !== "standardized_measure") {
      warnProgressThumbnail(versionId, "progressMap schemaVersion/blockMode is not supported.");
      return null;
    }

    if (!Array.isArray(progressMap.blocks) || !Array.isArray(progressMap.layers)) {
      warnProgressThumbnail(versionId, "progressMap.blocks or progressMap.layers is missing.");
      return null;
    }

    const totalBlocks = progressMap.blocks.length;
    if (totalBlocks <= 0) {
      warnProgressThumbnail(versionId, "progressMap.blocks is empty.");
      return null;
    }

    const blockStates = progressMap.blocks.map((block, index) => ({
      index,
      block,
      densityValue: getBlockDensityValue(block),
      fill: emptyBarFill,
      stripFill: emptyStripFill,
      contributorLabel: "未着手",
      colorLabel: "未着手",
      layerIndex: null,
      painted: false
    }));
    const paintedIndexes = new Set();
    const touchedLayers = new Map();

    for (const [layerIndex, layer] of progressMap.layers.entries()) {
      if (!layer || !Array.isArray(layer.ranges)) {
        warnProgressThumbnail(versionId, `layers[${layerIndex}].ranges is missing.`);
        continue;
      }

      const colorLabel = getLayerColorLabel(layer, layerIndex);
      const contributorLabel = getLayerContributorLabel(layer, layerIndex, context);
      const fill = resolveLayerFill(layer, layerIndex, { versionId, role: layer?.kind || "list" });
      let layerTouched = false;

      for (const [rangeIndex, range] of layer.ranges.entries()) {
        if (!Array.isArray(range) || range.length !== 2) {
          warnProgressThumbnail(versionId, `layers[${layerIndex}].ranges[${rangeIndex}] is invalid.`);
          continue;
        }

        const start = Number(range[0]);
        const end = Number(range[1]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
          warnProgressThumbnail(versionId, `layers[${layerIndex}].ranges[${rangeIndex}] is out of shape.`);
          continue;
        }

        const safeStart = Math.max(0, start);
        const safeEnd = Math.min(totalBlocks - 1, end);
        if (safeStart > safeEnd) {
          warnProgressThumbnail(versionId, `layers[${layerIndex}].ranges[${rangeIndex}] is outside block range.`);
          continue;
        }

        layerTouched = true;
        for (let index = safeStart; index <= safeEnd; index += 1) {
          paintedIndexes.add(index);
          blockStates[index] = {
            ...blockStates[index],
            fill,
            stripFill: fill,
            contributorLabel,
            colorLabel,
            layerIndex,
            painted: true
          };
        }
      }

      if (layerTouched) {
        touchedLayers.set(layerIndex, {
          colorLabel,
          contributorLabel,
          fill,
          layerIndex
        });
      }
    }

    const calculatedProgress = Math.round((paintedIndexes.size / totalBlocks) * 100);
    const progress = Number.isFinite(Number(progressMap.progress))
      ? Number(progressMap.progress)
      : calculatedProgress;
    const localMaxDensity = Math.max(1, ...blockStates.map((state) => state.densityValue));
    const densityScale = Number.isFinite(Number(context?.densityScale)) && Number(context.densityScale) > 0
      ? Number(context.densityScale)
      : localMaxDensity;
    const contributorSet = new Set([...touchedLayers.values()].map((item) => item.contributorLabel));

    return {
      totalBlocks,
      blockStates,
      blockRanges: blockStates.map((state) => ({
        index: state.index,
        startMeasure: Number.isInteger(Number(state.block?.startMeasure)) ? Number(state.block.startMeasure) : null,
        endMeasure: Number.isInteger(Number(state.block?.endMeasure)) ? Number(state.block.endMeasure) : null,
        startPosition: state.block?.startPosition !== null
          && state.block?.startPosition !== undefined
          && Number.isFinite(Number(state.block.startPosition))
          ? Number(state.block.startPosition)
          : null,
        endPosition: state.block?.endPosition !== null
          && state.block?.endPosition !== undefined
          && Number.isFinite(Number(state.block.endPosition))
          ? Number(state.block.endPosition)
          : null
      })),
      paintedIndexes,
      paintedCount: paintedIndexes.size,
      unpaintedCount: Math.max(0, totalBlocks - paintedIndexes.size),
      userCount: Math.max(1, contributorSet.size),
      legendEntries: [...touchedLayers.values()],
      progress,
      localMaxDensity,
      densityScale
    };
  }

  function getVersionProgress(version, fallbackModel) {
    const versionProgress = Number(version?.progress);
    if (Number.isFinite(versionProgress)) {
      return versionProgress;
    }

    if (fallbackModel && Number.isFinite(Number(fallbackModel.progress))) {
      return Number(fallbackModel.progress);
    }

    return 0;
  }

  function summarizeCell(model, cellIndex, cellCount) {
    const startIndex = Math.floor((cellIndex * model.totalBlocks) / cellCount);
    const nextStart = Math.floor(((cellIndex + 1) * model.totalBlocks) / cellCount);
    const endIndex = Math.max(startIndex, nextStart - 1);
    const safeStart = Math.min(model.totalBlocks - 1, startIndex);
    const safeEnd = Math.min(model.totalBlocks - 1, endIndex);
    let densityTotal = 0;
    let densityCount = 0;
    let painted = false;
    let fill = emptyBarFill;
    let stripFill = emptyStripFill;
    let contributorLabel = "未着手";
    let colorLabel = "未着手";

    for (let index = safeStart; index <= safeEnd; index += 1) {
      const state = model.blockStates[index];
      densityTotal += state?.densityValue || 0;
      densityCount += 1;
      if (state?.painted) {
        painted = true;
        fill = state.fill || fill;
        stripFill = state.stripFill || stripFill;
        contributorLabel = state.contributorLabel || contributorLabel;
        colorLabel = state.colorLabel || colorLabel;
      }
    }

    const densityValue = densityCount > 0 ? densityTotal / densityCount : 0;
    const scale = Math.max(1, model.densityScale || model.localMaxDensity || 1);
    const normalized = densityValue > 0 ? Math.min(1, Math.sqrt(densityValue / scale)) : 0;
    const height = densityValue > 0
      ? Math.max(14, Math.min(100, Math.round(normalized * 100)))
      : painted ? 10 : 6;

    return {
      colorLabel,
      contributorLabel,
      densityValue,
      fill,
      height,
      painted,
      stripFill
    };
  }

  function buildTooltip(model, progress) {
    const lines = [
      `進捗: ${progress}%`,
      `作成済み: ${model.paintedCount}/${model.totalBlocks} blocks`,
      `参加者: ${model.userCount} users`
    ];

    if (model.legendEntries.length > 0) {
      lines.push("");
      for (const entry of model.legendEntries) {
        lines.push(`${entry.colorLabel}: ${entry.contributorLabel}`);
      }
    }

    lines.push(`未着手: ${model.unpaintedCount} blocks`);
    return lines.join("\n");
  }

  function renderProgressMapThumbnailGraph(model, progress, versionId = "", miniViewUnavailable = false) {
    const cellCount = Math.max(1, Math.min(model.totalBlocks, thumbnailMaxCells));
    const summaries = Array.from({ length: cellCount }, (_, cellIndex) => summarizeCell(model, cellIndex, cellCount));
    const bars = summaries.map((summary) => `
      <span
        class="progress-thumbnail-density-bar${summary.painted ? " is-painted" : ""}${summary.densityValue === 0 ? " is-zero-density" : ""}"
        style="--bar-height: ${summary.height}%; --bar-fill: ${html(summary.fill)};"
        title="${html(`${summary.colorLabel}: ${summary.contributorLabel}`)}"
        aria-hidden="true"
      ></span>
    `).join("");
    const strip = summaries.map((summary) => `
      <span
        class="progress-thumbnail-strip-cell${summary.painted ? " is-painted" : ""}"
        style="--strip-fill: ${html(summary.stripFill)};"
        aria-hidden="true"
      ></span>
    `).join("");
    const userLabel = model.userCount === 1 ? "1 user" : `${model.userCount} users`;
    const hasExactBlockRanges = model.blockRanges.some((range) => (
      Number.isFinite(range.startPosition)
      && Number.isFinite(range.endPosition)
      && range.endPosition > range.startPosition
    ));
    const blockNavigator = versionId && hasExactBlockRanges
      ? `<button
          class="progress-thumbnail-block-navigator"
          type="button"
          data-progress-block-navigator
          data-version-id="${html(versionId)}"
          data-selected-block="0"
          aria-label="進捗ブロックの譜面範囲をプレビュー。左右キーでブロックを選択できます"
        ></button>`
      : "";
    const miniViewStatus = miniViewUnavailable
      ? `<span class="progress-thumbnail-miniview-status" title="この譜面形式ではミニビューを表示できません">ビューなし</span>`
      : "";

    return `
      <div class="progress-thumbnail-graph" style="--progress-thumbnail-cells: ${cellCount};">
        <div class="progress-thumbnail-density" aria-hidden="true">${bars}</div>
        <div class="progress-thumbnail-fill-strip" aria-hidden="true">${strip}</div>
        ${blockNavigator}
      </div>
      <div class="progress-thumbnail-meta">
        <span>${html(model.paintedCount)}/${html(model.totalBlocks)} blocks</span>
        <span aria-hidden="true">·</span>
        <span>${html(userLabel)}</span>
        ${miniViewStatus}
      </div>
    `;
  }

  function renderProgressMapThumbnailBar(model) {
    return renderProgressMapThumbnailGraph(model, model.progress);
  }

  function renderProgressThumbnail(version, context = {}) {
    const versionId = getVersionId(version) || "unknown";
    const rawImageUrl = getRawProgressImageUrl(version);
    const imageUrl = getProgressImageUrl(version);
    const model = normalizeProgressThumbnail(version, context);
    const progress = getVersionProgress(version, model);

    if (rawImageUrl && !imageUrl) {
      warnProgressThumbnail(versionId, "progressImage.url exists but could not be resolved; falling back to progressMap thumbnail.");
    }

    if (model) {
      progressBlockRangesByVersionId.set(versionId, model.blockRanges);
      const tooltip = buildTooltip(model, progress);
      const interactiveVersionId = version?.miniView?.available === true ? versionId : "";
      const miniViewUnavailable = Boolean(version?.miniView) && version.miniView.available !== true;
      return `
        <div class="progress-thumbnail has-progress-map" aria-label="${html(tooltip)}" title="${html(tooltip)}" data-version-id="${html(versionId)}" data-density-scale="${html(model.densityScale)}"${imageUrl ? ` data-progress-image-src="${html(imageUrl)}"` : ""}>
          ${renderProgressMapThumbnailGraph(model, progress, interactiveVersionId, miniViewUnavailable)}
        </div>
      `;
    }

    if (imageUrl) {
      progressBlockRangesByVersionId.delete(versionId);
      return `
        <div class="progress-thumbnail has-progress-image" aria-label="progress ${html(progress)}%" data-version-id="${html(versionId)}" data-progress-image-src="${html(imageUrl)}">
          <div class="progress-thumbnail-image-wrap"></div>
          <div class="progress-thumbnail-fallback" hidden></div>
          <span class="progress-thumbnail-value">progress ${html(progress)}%</span>
        </div>
      `;
    }

    progressBlockRangesByVersionId.delete(versionId);
    return "";
  }

  function fallbackProgressImage(image) {
    const thumbnail = image.closest(".progress-thumbnail");
    if (!thumbnail) {
      return;
    }

    const versionId = thumbnail.dataset.versionId || "unknown";
    warnProgressThumbnail(versionId, "progressImage failed to load; falling back to progressMap thumbnail.");

    const imageWrap = thumbnail.querySelector(".progress-thumbnail-image-wrap");
    const fallback = thumbnail.querySelector(".progress-thumbnail-fallback");
    if (imageWrap) {
      imageWrap.hidden = true;
    }

    thumbnail.classList.add("is-image-fallback");
    if (fallback && fallback.innerHTML.trim()) {
      fallback.hidden = false;
      return;
    }

    thumbnail.classList.add("is-empty");
  }

  function handleProgressImageError(event) {
    const image = event.target?.closest?.("img.progress-thumbnail-image");
    if (image) {
      fallbackProgressImage(image);
    }
  }

  function mountProgressImageThumbnails(root = document) {
    const thumbnails = Array.from(root.querySelectorAll(".progress-thumbnail.has-progress-image[data-progress-image-src]"));
    thumbnails.forEach((thumbnail) => {
      const src = thumbnail.dataset.progressImageSrc || "";
      const wrap = thumbnail.querySelector(".progress-thumbnail-image-wrap");
      const versionId = thumbnail.dataset.versionId || "unknown";

      if (!src) {
        warnProgressThumbnail(versionId, "progressImage.url exists but resolved img src is empty.");
        return;
      }

      if (/^blob:/i.test(src)) {
        warnProgressThumbnail(versionId, "blob URL was rejected for list thumbnail; falling back to progressMap thumbnail.");
        const existing = thumbnail.querySelector("img.progress-thumbnail-image");
        if (existing) {
          fallbackProgressImage(existing);
        }
        return;
      }

      if (!wrap) {
        warnProgressThumbnail(versionId, "progressImage.url exists but thumbnail image container is missing.");
        return;
      }

      const currentImage = wrap.querySelector("img.progress-thumbnail-image");
      if (thumbnail.dataset.progressImageMounted === "true" && currentImage?.getAttribute("src") === src) {
        return;
      }

      const image = document.createElement("img");
      image.className = "progress-thumbnail-image";
      image.alt = "progress image";
      image.decoding = "async";
      image.loading = "eager";
      image.addEventListener("load", () => {
        thumbnail.classList.add("is-image-loaded");
      });
      image.addEventListener("error", () => fallbackProgressImage(image));

      wrap.hidden = false;
      wrap.replaceChildren(image);
      thumbnail.dataset.progressImageMounted = "true";
      debugProgressImage(versionId, src);
      image.src = src;
    });
  }

  function scheduleProgressImageThumbnailMount(root = listElement || document) {
    if (!root) {
      return;
    }

    if (progressThumbnailMountFrame) {
      window.cancelAnimationFrame?.(progressThumbnailMountFrame);
      progressThumbnailMountFrame = 0;
    }

    const run = () => {
      progressThumbnailMountFrame = 0;
      mountProgressImageThumbnails(root);
    };

    if (typeof window.requestAnimationFrame === "function") {
      progressThumbnailMountFrame = window.requestAnimationFrame(run);
      return;
    }

    window.setTimeout(run, 0);
  }

  function findVersionForRow(row, versions, fallbackIndex) {
    const branchPath = row.dataset.branchPath || "";
    if (branchPath) {
      const byBranchPath = versions.find((version) => getBranchPath(version) === branchPath);
      if (byBranchPath) {
        return byBranchPath;
      }
    }

    const thumbnailVersionId = row.querySelector(".progress-thumbnail[data-version-id]")?.dataset.versionId || "";
    if (thumbnailVersionId) {
      const byThumbnailId = versions.find((version) => getVersionId(version) === thumbnailVersionId);
      if (byThumbnailId) {
        return byThumbnailId;
      }
    }

    return versions[fallbackIndex] || null;
  }

  function ensureProgressThumbnailSlot(thumbnailCell) {
    let slot = thumbnailCell.querySelector(":scope > .progress-thumbnail-slot");
    if (slot) {
      return slot;
    }

    slot = document.createElement("div");
    slot.className = "progress-thumbnail-slot";
    const preservedMiniView = thumbnailCell.querySelector(":scope > .chart-miniview-shell");
    Array.from(thumbnailCell.childNodes).forEach((node) => {
      if (node !== preservedMiniView) {
        slot.appendChild(node);
      }
    });
    thumbnailCell.insertBefore(slot, preservedMiniView || thumbnailCell.firstChild);
    return slot;
  }

  function applyStoredProgressThumbnails(data, root = listElement) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];
    if (!root || charts.length === 0) {
      return;
    }

    const densityScale = calculateListDensityScale(data);
    const chartGroups = Array.from(root.querySelectorAll(".chart-group"));
    charts.forEach((entry, chartIndex) => {
      const group = chartGroups[chartIndex];
      const versions = Array.isArray(entry?.versions) ? entry.versions : [];
      const context = buildThumbnailContext(versions, densityScale);
      const list = group?.querySelector(".version-list");
      const rows = Array.from(list?.querySelectorAll(":scope > .version-row") || []);
      if (!group || !list || versions.length === 0 || rows.length === 0) {
        return;
      }

      let fallbackIndex = 0;
      rows.forEach((row) => {
        const version = findVersionForRow(row, versions, fallbackIndex);
        fallbackIndex += 1;
        if (!version) {
          return;
        }

        const thumbnailCell = row.querySelector(":scope > .thumbnail-cell, :scope > .progress-thumbnail-block");
        if (!thumbnailCell) {
          return;
        }

        const rawImageUrl = getRawProgressImageUrl(version);
        const thumbnail = renderProgressThumbnail(version, context);
        const progressSlot = ensureProgressThumbnailSlot(thumbnailCell);
        if (thumbnail) {
          thumbnailCell.classList.remove("is-empty");
          progressSlot.innerHTML = thumbnail;
        } else {
          thumbnailCell.classList.add("is-empty");
          progressSlot.innerHTML = "";
        }

        if (rawImageUrl && !progressSlot.querySelector(".progress-thumbnail.has-progress-image, .progress-thumbnail.has-progress-map")) {
          warnProgressImageNotGenerated(version, "renderProgressThumbnail did not return progress image or progress map markup.");
        }
      });
    });

    scheduleProgressImageThumbnailMount(root);
  }

  function installProgressThumbnailObserver() {
    if (!listElement || progressThumbnailObserver || typeof MutationObserver !== "function") {
      return;
    }

    progressThumbnailObserver = new MutationObserver(() => {
      scheduleProgressImageThumbnailMount(listElement);
    });
    progressThumbnailObserver.observe(listElement, {
      childList: true,
      subtree: true
    });
  }

  function renderEmptyList() {
    if (typeof renderEmpty === "function") {
      renderEmpty();
      return;
    }

    if (listElement) {
      listElement.innerHTML = `<div class="list-status">投稿はまだありません。</div>`;
    }
  }

  function renderChartsWithProgressThumbnails(data) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];

    if (!listElement) {
      return;
    }

    if (charts.length === 0) {
      renderEmptyList();
      return;
    }

    const densityScale = calculateListDensityScale(data);
    listElement.innerHTML = charts.map((entry) => {
      const song = entry.song || {};
      const chart = entry.chart || {};
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const context = buildThumbnailContext(versions, densityScale);
      const rows = versions.map((version) => {
        const difficulty = version.difficulty || "未入力";
        const progress = Number.isFinite(Number(version.progress)) ? Number(version.progress) : 0;
        const thumbnail = renderProgressThumbnail(version, context);
        const downloadHref = downloadUrl(version.file?.downloadUrl);
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
              <div class="progress-thumbnail-slot">${thumbnail || ""}</div>
            </div>
            <div class="meta-block">
              <span class="meta-label">コメント</span>
              <span class="meta-value">${html(version.comment || "")}</span>
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
            <h3>${html(song.title || "無題")}</h3>
            <span class="artist-separator">/</span>
            <span class="chart-artist">${html(song.artist || "Unknown Artist")}</span>
            <span class="chart-name-badge">${html(chart.name || "差分名未入力")}</span>
          </div>
          <div class="version-list">${rows || `<div class="list-status">表示できるversionがありません。</div>`}</div>
        </article>
      `;
    }).join("");

    scheduleProgressImageThumbnailMount(listElement);
  }

  function installFinalProgressThumbnailBridge() {
    if (progressThumbnailBridgeInstalled || typeof renderCharts !== "function") {
      return;
    }

    const finalRenderCharts = renderCharts;
    if (finalRenderCharts.__progressThumbnailFinalBridge) {
      progressThumbnailBridgeInstalled = true;
      return;
    }

    const renderChartsWithFinalProgressThumbnails = (data) => {
      finalRenderCharts(data);
      applyStoredProgressThumbnails(data, listElement);
    };
    renderChartsWithFinalProgressThumbnails.__progressThumbnailFinalBridge = true;
    renderChartsWithFinalProgressThumbnails.__progressThumbnailBase = finalRenderCharts;

    try {
      renderCharts = renderChartsWithFinalProgressThumbnails;
    } catch (error) {
      window.renderCharts = renderChartsWithFinalProgressThumbnails;
    }

    progressThumbnailBridgeInstalled = true;
  }

  function debugProgressThumbnails(root = listElement || document) {
    const scope = root || document;
    const progressThumbnails = Array.from(scope.querySelectorAll(".progress-thumbnail"));
    const mapThumbnails = Array.from(scope.querySelectorAll(".progress-thumbnail.has-progress-map"));
    const graphThumbnails = Array.from(scope.querySelectorAll(".progress-thumbnail-graph"));
    const imageThumbnails = Array.from(scope.querySelectorAll(".progress-thumbnail.has-progress-image"));
    const images = Array.from(scope.querySelectorAll("img.progress-thumbnail-image"));
    const sourceNodes = Array.from(scope.querySelectorAll("[data-progress-image-src]"));
    const densityScaleSamples = progressThumbnails.slice(0, 10).map((node) => node.dataset.densityScale || "");
    const summary = {
      progressThumbnailCount: progressThumbnails.length,
      hasProgressMapCount: mapThumbnails.length,
      progressGraphCount: graphThumbnails.length,
      hasProgressImageCount: imageThumbnails.length,
      imageElementCount: images.length,
      dataProgressImageSrcCount: sourceNodes.length,
      densityScaleSamples,
      hasScheduleProgressImageThumbnailMount: typeof window.scheduleProgressImageThumbnailMount === "function",
      hasRenderProgressThumbnail: typeof window.renderProgressThumbnail === "function"
    };
    const samples = sourceNodes.slice(0, 10).map((node, index) => ({
      index,
      dataProgressImageSrc: node.dataset.progressImageSrc || "",
      imgSrc: images[index]?.src || ""
    }));

    console.log("[progress-thumbnail-debug] summary", summary);
    if (typeof console.table === "function") {
      console.table(samples);
    } else {
      console.log("[progress-thumbnail-debug] samples", samples);
    }

    return {
      ...summary,
      dataProgressImageSrcSamples: sourceNodes.slice(0, 10).map((node) => node.dataset.progressImageSrc || ""),
      imgSrcSamples: images.slice(0, 10).map((image) => image.src || "")
    };
  }

  ensureProgressImageThumbnailStyle();
  installProgressThumbnailObserver();

  if (listElement) {
    listElement.addEventListener("error", handleProgressImageError, true);
  }

  window.renderProgressThumbnail = renderProgressThumbnail;
  window.mountProgressImageThumbnails = mountProgressImageThumbnails;
  window.scheduleProgressImageThumbnailMount = scheduleProgressImageThumbnailMount;
  window.applyStoredProgressThumbnails = applyStoredProgressThumbnails;
  window.getProgressThumbnailBlockRanges = (versionId) => progressBlockRangesByVersionId.get(String(versionId || "")) || null;
  window.debugProgressThumbnails = debugProgressThumbnails;

  try {
    renderCharts = renderChartsWithProgressThumbnails;
  } catch (error) {
    window.renderCharts = renderChartsWithProgressThumbnails;
  }

  window.setTimeout(installFinalProgressThumbnailBridge, 0);
})();
