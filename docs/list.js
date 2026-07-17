(() => {
  "use strict";

  const API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const PAGE_SIZE = 20;
  const MAX_QUERY_LENGTH = 100;

  const searchForm = document.getElementById("compactSearchForm");
  const searchInput = document.getElementById("compactSearchInput");
  const searchClearButton = document.getElementById("compactSearchClear");
  const summary = document.getElementById("compactListSummary");
  const list = document.getElementById("compactVersionList");
  const feedback = document.getElementById("compactListFeedback");
  const loadMoreButton = document.getElementById("compactLoadMore");

  if (!searchForm || !searchInput || !searchClearButton || !summary || !list || !feedback || !loadMoreButton) {
    return;
  }

  const state = {
    query: readQueryFromUrl(),
    page: 0,
    totalCharts: 0,
    hasNext: false,
    charts: [],
    loading: false,
    loadingMore: false,
    loadMoreFailed: false,
    requestSequence: 0,
    abortController: null
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeQuery(value) {
    const normalized = String(value ?? "").normalize("NFKC").trim();
    return Array.from(normalized).slice(0, MAX_QUERY_LENGTH).join("");
  }

  function readQueryFromUrl() {
    return normalizeQuery(new URL(window.location.href).searchParams.get("q") || "");
  }

  function updateQueryUrl(query) {
    const url = new URL(window.location.href);
    if (query) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }
    window.history.pushState({ q: query }, "", url);
  }

  function branchSegmentToNumber(segment) {
    const normalized = String(segment || "").trim().toLowerCase();
    if (!/^[a-z]+$/.test(normalized)) {
      return normalized;
    }

    let value = 0;
    for (const char of normalized) {
      value = (value * 26) + (char.charCodeAt(0) - 96);
    }
    return String(value);
  }

  function buildVersionPathLabel(branchPath, fallback) {
    const parts = String(branchPath || "")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part.toLowerCase() !== "root");

    if (parts.length === 0) {
      return "BASE";
    }

    const label = parts.map(branchSegmentToNumber).filter(Boolean).join("-");
    return label || String(fallback || "版不明");
  }

  function parseCreatedAt(value) {
    const source = String(value || "").trim();
    if (!source) {
      return null;
    }

    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  function formatCreatedAt(value) {
    const date = parseCreatedAt(value);
    if (!date) {
      return { short: "日付不明", full: "日付不明", datetime: "" };
    }

    return {
      short: dateFormatter.format(date).replaceAll("/", "/"),
      full: dateTimeFormatter.format(date),
      datetime: date.toISOString()
    };
  }

  function getChartId(entry) {
    return String(entry?.chart?.id || entry?.chartId || "").trim();
  }

  function mergeChartEntries(current, incoming) {
    const merged = current.slice();
    const indexById = new Map();
    merged.forEach((entry, index) => {
      const chartId = getChartId(entry);
      if (chartId) {
        indexById.set(chartId, index);
      }
    });

    incoming.forEach((entry) => {
      const chartId = getChartId(entry);
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

  function flattenVersions(charts) {
    const rows = [];
    const seenVersionIds = new Set();

    charts.forEach((entry, chartOrder) => {
      const versions = Array.isArray(entry?.versions) ? entry.versions : [];
      versions.forEach((version, versionOrder) => {
        if (version?.isHidden === true || version?.hidden === true) {
          return;
        }

        const versionId = String(version?.id || "").trim();
        const fallbackKey = `${getChartId(entry)}:${version?.branchPath || versionOrder}:${version?.createdAt || ""}`;
        const rowKey = versionId || fallbackKey;
        if (!rowKey || seenVersionIds.has(rowKey)) {
          return;
        }
        seenVersionIds.add(rowKey);

        rows.push({
          entry,
          version,
          rowKey,
          chartOrder,
          versionOrder,
          createdAtMs: parseCreatedAt(version?.createdAt)?.getTime() || 0
        });
      });
    });

    rows.sort((left, right) => (
      right.createdAtMs - left.createdAtMs
      || left.chartOrder - right.chartOrder
      || left.versionOrder - right.versionOrder
      || left.rowKey.localeCompare(right.rowKey)
    ));
    return rows;
  }

  function buildDetailHref(entry) {
    const songTitle = String(entry?.song?.title || "").trim();
    const chartName = String(entry?.chart?.name || "").trim();
    const query = songTitle || chartName;
    const params = new URLSearchParams();
    if (query) {
      params.set("q", query);
    }
    const search = params.toString();
    return `./index.html${search ? `?${search}` : ""}#list`;
  }

  function renderRow(row) {
    const song = row.entry?.song || {};
    const chart = row.entry?.chart || {};
    const version = row.version || {};
    const songTitle = String(song.title || "曲名未入力").trim();
    const subtitle = String(song.subtitle || "").trim();
    const fullTitle = subtitle ? `${songTitle} ${subtitle}` : songTitle;
    const chartName = String(chart.name || "差分名未入力").trim();
    const versionLabel = buildVersionPathLabel(version.branchPath, version.displayVersion);
    const difficulty = String(version.difficulty || version.level || "未入力").trim();
    const author = String(version.author || "未入力").trim();
    const rawProgress = Number(version.progress);
    const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, Math.round(rawProgress))) : 0;
    const createdAt = formatCreatedAt(version.createdAt);
    const detailHref = buildDetailHref(row.entry);
    const linkLabel = `${fullTitle} ${chartName} ${versionLabel}を詳細一覧で見る`;

    return `
      <article class="compact-version-row" data-version-id="${escapeHtml(version.id || "")}">
        <time class="compact-date" datetime="${escapeHtml(createdAt.datetime)}" title="${escapeHtml(createdAt.full)}">${escapeHtml(createdAt.short)}</time>
        <div class="compact-title-cell">
          <a class="compact-title-link" href="${escapeHtml(detailHref)}" aria-label="${escapeHtml(linkLabel)}">
            <span class="compact-song-title">${escapeHtml(fullTitle)}</span>
            <span class="compact-version-title">[${escapeHtml(chartName)}] / ${escapeHtml(versionLabel)}</span>
          </a>
        </div>
        <div class="compact-difficulty"><span class="compact-field-label">難易度</span><span>${escapeHtml(difficulty)}</span></div>
        <div class="compact-author"><span class="compact-field-label">作者</span><span title="${escapeHtml(author)}">${escapeHtml(author)}</span></div>
        <div class="compact-progress"><span class="compact-field-label">進捗</span><span>${escapeHtml(progress)}%</span></div>
      </article>
    `;
  }

  function setFeedback(message) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }

  function updateControls(rows) {
    if (document.activeElement !== searchInput) {
      searchInput.value = state.query;
    }
    searchClearButton.disabled = !searchInput.value.trim();

    if (state.loading && !state.loadingMore) {
      summary.textContent = state.query ? "検索しています。" : "一覧を読み込んでいます。";
    } else {
      const chartCount = state.charts.length;
      const total = Math.max(state.totalCharts, chartCount);
      const prefix = state.query ? `「${state.query}」: ` : "";
      summary.textContent = `${prefix}曲・差分 ${chartCount}/${total}件を読み込み、公開版 ${rows.length}件を表示`;
    }

    loadMoreButton.hidden = state.charts.length === 0 || !state.hasNext;
    loadMoreButton.disabled = state.loading;
    loadMoreButton.textContent = state.loadingMore
      ? "読み込み中..."
      : state.loadMoreFailed
        ? "再試行"
        : "さらに読み込む";
  }

  function renderCurrent() {
    const rows = flattenVersions(state.charts);
    list.setAttribute("aria-busy", state.loading ? "true" : "false");

    if (state.loading && !state.loadingMore && state.charts.length === 0) {
      list.innerHTML = '<p class="compact-list-state">読み込み中...</p>';
    } else if (rows.length === 0) {
      list.innerHTML = `<p class="compact-list-state">${state.query ? `「${escapeHtml(state.query)}」に一致する投稿はありません。` : "投稿はまだありません。"}</p>`;
    } else {
      list.innerHTML = rows.map(renderRow).join("");
    }

    updateControls(rows);
    return rows;
  }

  async function readResponse(response) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error("CHART_LIST_REQUEST_FAILED");
      error.code = String(data?.code || `HTTP_${response.status}`);
      throw error;
    }
    return data;
  }

  async function loadCharts(options = {}) {
    const append = options.append === true;
    if (append && (state.loading || !state.hasNext)) {
      return;
    }

    if (!append) {
      state.abortController?.abort();
      state.query = normalizeQuery(options.query ?? state.query);
      state.page = 0;
      state.totalCharts = 0;
      state.hasNext = false;
      state.charts = [];
      state.loadMoreFailed = false;
    }

    const targetPage = append ? state.page + 1 : 1;
    const requestSequence = state.requestSequence + 1;
    const abortController = new AbortController();
    state.requestSequence = requestSequence;
    state.abortController = abortController;
    state.loading = true;
    state.loadingMore = append;
    setFeedback(append ? "次のページを読み込んでいます。" : "");
    renderCurrent();

    const params = new URLSearchParams({
      page: String(targetPage),
      pageSize: String(PAGE_SIZE)
    });
    if (state.query) {
      params.set("q", state.query);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/charts?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: abortController.signal
      });
      const data = await readResponse(response);
      if (requestSequence !== state.requestSequence) {
        return;
      }

      const nextCharts = Array.isArray(data?.charts) ? data.charts : [];
      state.charts = append ? mergeChartEntries(state.charts, nextCharts) : nextCharts;
      state.page = Number(data?.pagination?.page) || targetPage;
      state.totalCharts = Number.isFinite(Number(data?.pagination?.total))
        ? Number(data.pagination.total)
        : state.charts.length;
      state.hasNext = data?.pagination?.hasNext === true;
      state.loadMoreFailed = false;
      state.loading = false;
      state.loadingMore = false;

      const rows = renderCurrent();
      if (rows.length > 0 && !state.hasNext) {
        setFeedback("全件読み込み済みです。");
      } else {
        setFeedback("");
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      if (requestSequence !== state.requestSequence) {
        return;
      }

      const code = String(error?.code || "CHART_LIST_REQUEST_FAILED");
      console.warn("[compact-version-list] request failed", { code, page: targetPage, append });
      state.loadMoreFailed = append;
      if (append) {
        setFeedback("追加の読み込みに失敗しました。表示中の行はそのままです。");
      } else {
        list.innerHTML = '<p class="compact-list-state compact-list-error">一覧を読み込めませんでした。時間をおいて再試行してください。</p>';
        setFeedback("一覧の取得に失敗しました。");
      }
    } finally {
      if (requestSequence === state.requestSequence) {
        state.loading = false;
        state.loadingMore = false;
        list.setAttribute("aria-busy", "false");
        updateControls(flattenVersions(state.charts));
      }
    }
  }

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = normalizeQuery(searchInput.value);
    searchInput.value = query;
    updateQueryUrl(query);
    loadCharts({ query });
  });

  searchInput.addEventListener("input", () => {
    searchClearButton.disabled = !searchInput.value.trim();
  });

  searchClearButton.addEventListener("click", () => {
    searchInput.value = "";
    updateQueryUrl("");
    loadCharts({ query: "" });
    searchInput.focus();
  });

  loadMoreButton.addEventListener("click", () => {
    loadCharts({ append: true });
  });

  window.addEventListener("popstate", () => {
    const query = readQueryFromUrl();
    searchInput.value = query;
    loadCharts({ query });
  });

  searchInput.value = state.query;
  searchClearButton.disabled = !state.query;
  loadCharts({ query: state.query });
})();
