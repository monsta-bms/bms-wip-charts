(() => {
  const thumbnailMaxCells = 96;
  const listElement = document.querySelector("#chartList");

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

  function warnProgressThumbnail(versionId, detail) {
    console.warn("[progress-thumbnail-render] failed to render progress thumbnail", {
      code: "PROGRESS_THUMBNAIL_RENDER_SKIPPED",
      versionId: versionId || "unknown",
      detail
    });
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

  function collectPaintedIndexes(progressMap, totalBlocks, versionId) {
    const paintedIndexes = new Set();

    for (const [layerIndex, layer] of progressMap.layers.entries()) {
      if (!layer || !Array.isArray(layer.ranges)) {
        warnProgressThumbnail(versionId, `layers[${layerIndex}].ranges is missing.`);
        continue;
      }

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

        for (let index = safeStart; index <= safeEnd; index += 1) {
          paintedIndexes.add(index);
        }
      }
    }

    return paintedIndexes;
  }

  function normalizeProgressThumbnail(version) {
    const versionId = version?.id || "unknown";
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

    const paintedIndexes = collectPaintedIndexes(progressMap, totalBlocks, versionId);
    const calculatedProgress = Math.round((paintedIndexes.size / totalBlocks) * 100);
    const progress = Number.isFinite(Number(progressMap.progress))
      ? Number(progressMap.progress)
      : calculatedProgress;

    return {
      totalBlocks,
      paintedIndexes,
      progress
    };
  }

  function isCellPainted(model, cellIndex, cellCount) {
    const startIndex = Math.floor((cellIndex * model.totalBlocks) / cellCount);
    const nextStart = Math.floor(((cellIndex + 1) * model.totalBlocks) / cellCount);
    const endIndex = Math.max(startIndex, nextStart - 1);

    for (let index = startIndex; index <= endIndex; index += 1) {
      if (model.paintedIndexes.has(index)) {
        return true;
      }
    }

    return false;
  }

  function renderProgressThumbnail(version) {
    const model = normalizeProgressThumbnail(version);
    if (!model) {
      return "";
    }

    const cellCount = Math.max(1, Math.min(model.totalBlocks, thumbnailMaxCells));
    const cells = Array.from({ length: cellCount }, (_, cellIndex) => {
      const painted = isCellPainted(model, cellIndex, cellCount);
      return `<span class="progress-thumbnail-cell${painted ? " is-painted" : ""}" aria-hidden="true"></span>`;
    }).join("");

    return `
      <div class="progress-thumbnail" aria-label="progress ${html(model.progress)}%">
        <div class="progress-thumbnail-bar" style="--progress-thumbnail-cells: ${cellCount};">${cells}</div>
        <span class="progress-thumbnail-value">progress ${html(model.progress)}%</span>
      </div>
    `;
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

    listElement.innerHTML = charts.map((entry) => {
      const song = entry.song || {};
      const chart = entry.chart || {};
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const rows = versions.map((version) => {
        const difficulty = version.difficulty || "未入力";
        const progress = Number.isFinite(Number(version.progress)) ? Number(version.progress) : 0;
        const thumbnail = renderProgressThumbnail(version);
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
              ${thumbnail || ""}
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
  }

  try {
    renderCharts = renderChartsWithProgressThumbnails;
  } catch (error) {
    window.renderCharts = renderChartsWithProgressThumbnails;
  }

  if (typeof loadCharts === "function") {
    loadCharts();
  }
})();
