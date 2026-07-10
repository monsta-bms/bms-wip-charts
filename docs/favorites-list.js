(() => {
  const listElement = document.querySelector("#chartList");
  const filterButton = document.querySelector("#favoriteFilterToggle");
  const storageKey = "bms-wip-charts:favorites:v1";
  const completedCollapseReason = "superseded_by_completed_descendant";

  if (!listElement || typeof renderCharts !== "function") {
    return;
  }

  const wrappedRenderCharts = renderCharts;
  let latestData = null;
  let favoriteOnly = false;
  let storageWarned = false;

  function injectStyles() {
    if (document.querySelector("#favoriteListStyles")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "favoriteListStyles";
    style.textContent = `
      .list-toolbar {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      button.favorite-filter-toggle {
        align-items: center;
        background: #ffffff;
        border: 1px solid var(--line);
        color: var(--muted);
        display: inline-flex;
        font-size: 0.84rem;
        gap: 6px;
        min-height: 34px;
        padding: 0 12px;
        white-space: nowrap;
      }

      button.favorite-filter-toggle:hover,
      button.favorite-filter-toggle:focus-visible {
        background: #fff8e6;
        border-color: rgba(217, 154, 0, 0.4);
        color: #8a5a00;
      }

      button.favorite-filter-toggle.is-active,
      button.favorite-filter-toggle.is-active:hover,
      button.favorite-filter-toggle.is-active:focus-visible {
        background: #fff4d6;
        border-color: rgba(245, 184, 46, 0.58);
        color: #7a4b00;
      }

      button.favorite-version-button {
        align-items: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 999px;
        color: #b6c0c9;
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 1rem;
        height: 26px;
        justify-content: center;
        line-height: 1;
        min-height: 26px;
        padding: 0;
        width: 26px;
      }

      button.favorite-version-button:hover,
      button.favorite-version-button:focus-visible {
        background: #fff7df;
        border-color: rgba(217, 154, 0, 0.34);
        color: #d99a00;
      }

      button.favorite-version-button.is-favorite,
      button.favorite-version-button.is-favorite:hover,
      button.favorite-version-button.is-favorite:focus-visible {
        background: #fff4d6;
        border-color: rgba(245, 184, 46, 0.36);
        color: #f5b82e;
      }

      .version-row.is-favorite-version .version-main-label {
        color: var(--primary-dark);
      }

      @media (max-width: 640px) {
        .list-toolbar,
        .list-toolbar button.favorite-filter-toggle {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

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

  function warnStorage(stage, error) {
    if (storageWarned) {
      return;
    }

    storageWarned = true;
    console.warn("[favorites-storage] failed to access localStorage", {
      stage,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  function readFavorites() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return {};
      }

      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      warnStorage("read", error);
      return {};
    }
  }

  function writeFavorites(favorites) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(favorites || {}));
      return true;
    } catch (error) {
      warnStorage("write", error);
      return false;
    }
  }

  function hasFavorite(favorites, versionId) {
    return Boolean(versionId) && Object.prototype.hasOwnProperty.call(favorites || {}, versionId);
  }

  function getVersionId(version) {
    return version?.id || version?.versionId || "";
  }

  function getParentVersionId(version) {
    return version?.parentVersionId || version?.parent_version_id || "";
  }

  function getBranchPath(version) {
    return version?.branchPath || version?.branch_path || "root";
  }

  function getParentBranchPath(version) {
    const parts = getBranchPath(version).split("/").filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  }

  function getDisplayVersion(version) {
    return version?.displayVersion || version?.display_version || "ver?.?";
  }

  function getChartId(entry) {
    const chart = entry?.chart || {};
    return chart.id || chart.chartId || entry?.chartId || "";
  }

  function getSongTitle(entry) {
    const song = entry?.song || {};
    return song.title || song.songTitle || song.name || entry?.songTitle || entry?.title || "";
  }

  function getChartName(entry) {
    const chart = entry?.chart || {};
    return chart.name || chart.chartName || chart.chart_name || entry?.chartName || entry?.chart_name || "";
  }

  function buildVersionLabel(version) {
    if (window.BmsVersionLabels?.buildVersionPathLabel) {
      return window.BmsVersionLabels.buildVersionPathLabel(getBranchPath(version));
    }

    const parts = getBranchPath(version).split("/").filter(Boolean);
    const pathParts = parts[0] === "root" ? parts.slice(1) : parts;
    if (pathParts.length === 0) {
      return "BASE";
    }

    return pathParts.map((segment) => {
      const value = String(segment || "").trim().toLowerCase();
      if (!/^[a-z]+$/.test(value)) {
        return value || "0";
      }

      let number = 0;
      for (const character of value) {
        number = number * 26 + (character.charCodeAt(0) - 96);
      }
      return String(number);
    }).join("-");
  }

  function buildLookup(versions) {
    const byId = new Map();
    const byPath = new Map();
    versions.forEach((version) => {
      const versionId = getVersionId(version);
      if (versionId) {
        byId.set(versionId, version);
      }
      byPath.set(getBranchPath(version), version);
    });
    return { byId, byPath };
  }

  function getParentVersion(version, lookup) {
    const parentId = getParentVersionId(version);
    if (parentId && lookup.byId.has(parentId)) {
      return lookup.byId.get(parentId);
    }

    const parentPath = getParentBranchPath(version);
    return parentPath && lookup.byPath.has(parentPath) ? lookup.byPath.get(parentPath) : null;
  }

  function getDownloadBlockReason(version) {
    return version?.downloadBlockReason || version?.download_block_reason || "";
  }

  function normalizeFavoriteContextVersion(version) {
    const copy = { ...version };
    if (getDownloadBlockReason(copy) === completedCollapseReason) {
      copy.collapsedByCompletion = false;
      copy.collapsed_by_completion = false;
      copy.collapsedReason = "";
      copy.collapsed_reason = "";
      copy.collapsedByVersionId = "";
      copy.collapsed_by_version_id = "";
      copy.downloadBlockReason = "favorite_filter_context";
      copy.download_block_reason = "favorite_filter_context";
      copy.favoriteFilterIntermediate = true;
    }
    return copy;
  }

  function buildFavoriteVersionSet(versions, favorites) {
    const favoriteIds = new Set(Object.keys(favorites || {}));
    const visibleIds = new Set();
    if (favoriteIds.size === 0) {
      return visibleIds;
    }

    const lookup = buildLookup(versions);
    versions.forEach((version) => {
      const versionId = getVersionId(version);
      if (!favoriteIds.has(versionId)) {
        return;
      }

      let current = version;
      while (current) {
        const currentId = getVersionId(current);
        if (!currentId || visibleIds.has(currentId)) {
          break;
        }

        visibleIds.add(currentId);
        current = getParentVersion(current, lookup);
      }
    });

    return visibleIds;
  }

  function filterDataForFavorites(data, favorites) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];
    const filteredCharts = charts.flatMap((entry) => {
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const visibleIds = buildFavoriteVersionSet(versions, favorites);
      if (visibleIds.size === 0) {
        return [];
      }

      return [{
        ...entry,
        versions: versions
          .filter((version) => visibleIds.has(getVersionId(version)))
          .map(normalizeFavoriteContextVersion)
      }];
    });

    return { ...data, charts: filteredCharts };
  }

  function updateFilterButton() {
    if (!filterButton) {
      return;
    }

    filterButton.classList.toggle("is-active", favoriteOnly);
    filterButton.setAttribute("aria-pressed", favoriteOnly ? "true" : "false");
    filterButton.textContent = favoriteOnly ? "★ お気に入りのみ" : "☆ お気に入りのみ";
    filterButton.title = favoriteOnly ? "通常一覧に戻す" : "お気に入りversionと祖先だけを表示";
  }

  function setButtonState(button, active) {
    button.classList.toggle("is-favorite", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("aria-label", active ? "お気に入りから外す" : "お気に入りに追加");
    button.title = active ? "お気に入りから外す" : "お気に入りに追加";
    button.textContent = active ? "★" : "☆";
    button.closest(".version-row")?.classList.toggle("is-favorite-version", active);
  }

  function createFavoriteButton() {
    const button = document.createElement("button");
    button.className = "favorite-version-button";
    button.type = "button";
    return button;
  }

  function lockFavoriteContextAppend(row) {
    const actions = row.querySelector(".version-actions");
    const appendButton = actions?.querySelector(".append-version-button, button.secondary:not(.intermediate-toggle-button)");
    if (!appendButton || appendButton.classList.contains("append-disabled-intermediate")) {
      return;
    }

    const locked = document.createElement("button");
    locked.className = "secondary append-disabled-intermediate";
    locked.type = "button";
    locked.disabled = true;
    locked.title = "完成版に置き換え済みの中間履歴のため追記できません";
    locked.textContent = "追記不可";
    appendButton.replaceWith(locked);
  }

  function versionMapByLabel(versions) {
    const map = new Map();
    versions.forEach((version) => {
      map.set(buildVersionLabel(version), version);
    });
    return map;
  }

  function mountFavorites(renderData) {
    const favorites = readFavorites();
    const entries = Array.isArray(renderData?.charts) ? renderData.charts : [];
    const groups = Array.from(listElement.querySelectorAll(".chart-group"));

    entries.forEach((entry, chartIndex) => {
      const group = groups[chartIndex];
      if (!group) {
        return;
      }

      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const versionsByLabel = versionMapByLabel(versions);
      const rows = Array.from(group.querySelectorAll(".version-row.version-tree-row"));

      rows.forEach((row) => {
        const mainLabel = row.querySelector(".version-main-label");
        const titleLine = row.querySelector(".version-title-line");
        if (!mainLabel || !titleLine) {
          return;
        }

        const version = versionsByLabel.get(mainLabel.textContent.trim());
        if (!version) {
          return;
        }

        const versionId = getVersionId(version);
        let button = titleLine.querySelector(".favorite-version-button");
        if (!button) {
          button = createFavoriteButton();
          mainLabel.insertAdjacentElement("afterend", button);
        }

        row.dataset.versionId = versionId;
        row.dataset.chartId = getChartId(entry);
        button.dataset.versionId = versionId;
        button.dataset.chartId = getChartId(entry);
        button.dataset.songTitle = getSongTitle(entry);
        button.dataset.chartName = getChartName(entry);
        button.dataset.versionLabel = buildVersionLabel(version);
        button.dataset.branchPath = getBranchPath(version);
        button.dataset.displayVersion = getDisplayVersion(version);
        setButtonState(button, hasFavorite(favorites, versionId));

        if (version.favoriteFilterIntermediate) {
          row.classList.add("is-intermediate-history");
          lockFavoriteContextAppend(row);
        }
      });
    });
  }

  function renderWithFavorites(data) {
    latestData = data;
    const favorites = readFavorites();
    const renderData = favoriteOnly ? filterDataForFavorites(data, favorites) : data;
    wrappedRenderCharts(renderData);
    if (favoriteOnly && (!Array.isArray(renderData?.charts) || renderData.charts.length === 0)) {
      const status = listElement.querySelector(".list-status");
      if (status) {
        status.textContent = "お気に入り登録されたversionはありません。";
      }
    }
    mountFavorites(renderData);
    updateFilterButton();
  }

  function rerenderLatest() {
    if (!latestData) {
      return;
    }

    renderWithFavorites(latestData);
  }

  listElement.addEventListener("click", (event) => {
    const button = event.target.closest(".favorite-version-button");
    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const versionId = button.dataset.versionId || "";
    if (!versionId) {
      return;
    }

    const favorites = readFavorites();
    if (hasFavorite(favorites, versionId)) {
      delete favorites[versionId];
    } else {
      favorites[versionId] = {
        versionId,
        chartId: button.dataset.chartId || "",
        songTitle: button.dataset.songTitle || "",
        chartName: button.dataset.chartName || "",
        versionLabel: button.dataset.versionLabel || "",
        branchPath: button.dataset.branchPath || "",
        favoritedAt: new Date().toISOString()
      };
    }

    if (!writeFavorites(favorites)) {
      return;
    }

    if (favoriteOnly) {
      rerenderLatest();
      return;
    }

    setButtonState(button, hasFavorite(favorites, versionId));
  });

  filterButton?.addEventListener("click", () => {
    favoriteOnly = !favoriteOnly;
    updateFilterButton();
    rerenderLatest();
  });

  try {
    renderCharts = renderWithFavorites;
  } catch (error) {
    window.renderCharts = renderWithFavorites;
  }

  injectStyles();
  updateFilterButton();

  if (typeof loadCharts === "function") {
    loadCharts();
  }
})();
