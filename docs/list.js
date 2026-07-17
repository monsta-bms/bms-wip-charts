(() => {
  "use strict";

  const PRODUCTION_API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const API_BASE_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:8788"
    : PRODUCTION_API_BASE_URL;
  const FAVORITES_STORAGE_KEY = "bms-wip-charts:favorites:v1";
  const PAGE_SIZE = 20;
  const MAX_QUERY_LENGTH = 100;
  const MAX_FAVORITES = 200;
  const validSorts = new Set(["new", "updated"]);
  const validStatuses = new Set(["all", "incomplete", "complete", "rejected"]);

  const searchForm = document.getElementById("compactSearchForm");
  const searchInput = document.getElementById("compactSearchInput");
  const searchClearButton = document.getElementById("compactSearchClear");
  const sortSelect = document.getElementById("compactSortSelect");
  const statusSelect = document.getElementById("compactStatusSelect");
  const favoriteOnlyInput = document.getElementById("compactFavoriteOnly");
  const summary = document.getElementById("compactListSummary");
  const list = document.getElementById("compactVersionList");
  const feedback = document.getElementById("compactListFeedback");
  const retryButton = document.getElementById("compactListRetry");
  const pagination = document.getElementById("compactPagination");
  const results = document.querySelector(".compact-results");

  if (!searchForm || !searchInput || !searchClearButton || !sortSelect || !statusSelect
    || !favoriteOnlyInput || !summary || !list || !feedback || !retryButton || !pagination) {
    return;
  }

  const initialLocationState = readLocationState();
  const state = {
    ...initialLocationState,
    items: [],
    total: 0,
    hasNext: false,
    unavailableFavoriteCount: 0,
    favoriteIdCount: 0,
    loading: false,
    errorCode: "",
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

  function parsePage(value) {
    const source = String(value ?? "").trim();
    if (!/^\d+$/.test(source)) {
      return 1;
    }
    const page = Number(source);
    return Number.isSafeInteger(page) && page > 0 ? page : 1;
  }

  function readLocationState() {
    const params = new URL(window.location.href).searchParams;
    const sort = params.get("sort") || "new";
    const status = params.get("status") || "all";
    return {
      query: normalizeQuery(params.get("q") || ""),
      sort: validSorts.has(sort) ? sort : "new",
      status: validStatuses.has(status) ? status : "all",
      favoriteOnly: ["1", "true"].includes((params.get("favorites") || "").toLowerCase()),
      page: parsePage(params.get("page"))
    };
  }

  function updateLocation(options = {}) {
    const url = new URL(window.location.href);
    const setOrDelete = (name, value, defaultValue = "") => {
      if (value && value !== defaultValue) {
        url.searchParams.set(name, value);
      } else {
        url.searchParams.delete(name);
      }
    };
    setOrDelete("q", state.query);
    setOrDelete("sort", state.sort, "new");
    setOrDelete("status", state.status, "all");
    setOrDelete("favorites", state.favoriteOnly ? "1" : "");
    setOrDelete("page", state.page > 1 ? String(state.page) : "");
    const historyState = {
      q: state.query,
      sort: state.sort,
      status: state.status,
      favorites: state.favoriteOnly,
      page: state.page
    };
    window.history[options.replace ? "replaceState" : "pushState"](historyState, "", url);
  }

  function readFavoriteVersionIds() {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return [];
      }
      return Object.keys(parsed).map((id) => id.trim()).filter(Boolean);
    } catch (error) {
      console.warn("[compact-version-list] favorite storage read failed", {
        code: "FAVORITE_STORAGE_READ_FAILED",
        errorType: error instanceof Error ? error.name : typeof error
      });
      return [];
    }
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
      short: dateFormatter.format(date),
      full: dateTimeFormatter.format(date),
      datetime: date.toISOString()
    };
  }

  function buildStateBadges(item) {
    const badges = [];
    if (item.isNew === true) {
      badges.push('<span class="compact-state-badge is-new">NEW</span>');
    }
    if (item.isRejected === true) {
      badges.push('<span class="compact-state-badge">没譜面</span>');
    }
    if (item.withdrawn === true) {
      badges.push('<span class="compact-state-badge">取り下げ</span>');
    }
    if (item.deleteRequested === true) {
      badges.push('<span class="compact-state-badge">削除申請中</span>');
    }
    if (item.downloadBlocked === true) {
      badges.push('<span class="compact-state-badge">DL停止</span>');
    }
    return badges.join("");
  }

  function renderRow(item) {
    const songTitle = String(item.title || "曲名未入力").trim();
    const subtitle = String(item.subtitle || "").trim();
    const fullTitle = subtitle ? `${songTitle} ${subtitle}` : songTitle;
    const chartName = String(item.chartName || "差分名未入力").trim();
    const versionLabel = String(item.versionLabel || "版不明").trim();
    const difficulty = String(item.difficulty || "未入力").trim();
    const author = String(item.author || "未入力").trim();
    const rawProgress = Number(item.progress);
    const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, Math.round(rawProgress))) : 0;
    const createdAt = formatCreatedAt(item.createdAt);
    const stateBadges = buildStateBadges(item);
    const fullLabel = `${fullTitle} [${chartName}] / ${versionLabel}`;

    return `
      <article class="compact-version-row" data-version-id="${escapeHtml(item.versionId || "")}">
        <time class="compact-date" datetime="${escapeHtml(createdAt.datetime)}" title="${escapeHtml(createdAt.full)}">${escapeHtml(createdAt.short)}</time>
        <div class="compact-title-cell" title="${escapeHtml(fullLabel)}">
          <div class="compact-title-line">
            <span class="compact-song-title">${escapeHtml(fullTitle)}</span>
            <span class="compact-state-badges">${stateBadges}</span>
          </div>
          <span class="compact-version-title">[${escapeHtml(chartName)}] / ${escapeHtml(versionLabel)}</span>
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

  function getEmptyMessage() {
    if (state.favoriteOnly) {
      if (state.favoriteIdCount === 0) {
        return "お気に入りはありません。";
      }
      if (state.query || state.status !== "all") {
        return "条件に一致する公開中のお気に入りはありません。";
      }
      return "公開中のお気に入りはありません。";
    }
    if (state.query) {
      return `「${escapeHtml(state.query)}」に一致する投稿はありません。`;
    }
    if (state.status !== "all") {
      return "この状態に一致する投稿はありません。";
    }
    return "投稿はまだありません。";
  }

  function renderSummary() {
    if (state.loading && state.items.length === 0) {
      summary.textContent = state.query ? "検索しています。" : "一覧を読み込んでいます。";
      return;
    }
    if (state.loading) {
      summary.textContent = "表示条件を更新しています。";
      return;
    }
    if (state.errorCode && state.items.length === 0) {
      summary.textContent = "一覧を取得できませんでした。";
      return;
    }
    if (state.total === 0) {
      const hidden = state.favoriteOnly && state.unavailableFavoriteCount > 0
        ? ` 見つからないお気に入り ${state.unavailableFavoriteCount}件`
        : "";
      summary.textContent = `0版を表示${hidden}`;
      return;
    }

    const start = ((state.page - 1) * PAGE_SIZE) + 1;
    const end = start + state.items.length - 1;
    const queryPrefix = state.query ? `「${state.query}」: ` : "";
    if (state.favoriteOnly) {
      const conditionPrefix = state.query || state.status !== "all" ? "条件に一致する" : "";
      const unavailable = state.unavailableFavoriteCount > 0
        ? ` / 見つからないお気に入り ${state.unavailableFavoriteCount}件`
        : "";
      summary.textContent = `${queryPrefix}${conditionPrefix}公開中のお気に入り${state.total}件中 ${start}～${end}件を表示${unavailable}`;
      return;
    }
    summary.textContent = `${queryPrefix}全${state.total}版中 ${start}～${end}版を表示`;
  }

  function paginationTokens(current, totalPages) {
    const pages = new Set([1, totalPages, current - 1, current, current + 1]);
    const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
    const tokens = [];
    let previous = 0;
    for (const page of sorted) {
      if (previous && page - previous > 1) {
        tokens.push("ellipsis");
      }
      tokens.push(page);
      previous = page;
    }
    return tokens;
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    pagination.hidden = state.total === 0 || totalPages <= 1;
    if (pagination.hidden) {
      pagination.innerHTML = "";
      return;
    }

    const tokens = paginationTokens(state.page, totalPages).map((token) => {
      if (token === "ellipsis") {
        return '<span class="compact-page-ellipsis" aria-hidden="true">…</span>';
      }
      const current = token === state.page;
      return `<button type="button" data-page="${token}"${current ? ' class="is-current" aria-current="page"' : ""}${state.loading ? " disabled" : ""}>${token}</button>`;
    }).join("");

    pagination.innerHTML = `
      <button type="button" class="compact-page-move" data-page="${state.page - 1}"${state.page <= 1 || state.loading ? " disabled" : ""}>前へ</button>
      <span class="compact-page-numbers">${tokens}</span>
      <span class="compact-page-total">${state.page} / ${totalPages}ページ</span>
      <button type="button" class="compact-page-move" data-page="${state.page + 1}"${state.page >= totalPages || state.loading ? " disabled" : ""}>次へ</button>
    `;
  }

  function syncControls() {
    if (document.activeElement !== searchInput) {
      searchInput.value = state.query;
    }
    searchClearButton.disabled = !searchInput.value.trim();
    sortSelect.value = state.sort;
    statusSelect.value = state.status;
    favoriteOnlyInput.checked = state.favoriteOnly;
    sortSelect.disabled = state.loading;
    statusSelect.disabled = state.loading;
    favoriteOnlyInput.disabled = state.loading;
  }

  function renderCurrent() {
    list.setAttribute("aria-busy", state.loading ? "true" : "false");
    list.classList.toggle("is-stale", Boolean(state.errorCode && state.items.length > 0));
    if (state.loading && state.items.length === 0) {
      list.innerHTML = '<p class="compact-list-state">読み込み中...</p>';
    } else if (state.items.length === 0) {
      const errorClass = state.errorCode ? " compact-list-error" : "";
      const message = state.errorCode
        ? "一覧を読み込めませんでした。時間をおいて再試行してください。"
        : getEmptyMessage();
      list.innerHTML = `<p class="compact-list-state${errorClass}">${message}</p>`;
    } else {
      list.innerHTML = state.items.map(renderRow).join("");
    }
    retryButton.hidden = !state.errorCode;
    retryButton.disabled = state.loading;
    renderSummary();
    renderPagination();
    syncControls();
  }

  async function readResponse(response) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error("VERSION_LIST_REQUEST_FAILED");
      error.code = String(data?.code || `HTTP_${response.status}`);
      throw error;
    }
    return data;
  }

  function buildRequest(favoriteVersionIds) {
    if (state.favoriteOnly) {
      return {
        url: `${API_BASE_URL}/api/versions/query`,
        init: {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            favoriteVersionIds,
            q: state.query,
            sort: state.sort,
            status: state.status,
            page: state.page,
            pageSize: PAGE_SIZE
          })
        }
      };
    }

    const params = new URLSearchParams({
      sort: state.sort,
      status: state.status,
      page: String(state.page),
      pageSize: String(PAGE_SIZE)
    });
    if (state.query) {
      params.set("q", state.query);
    }
    return {
      url: `${API_BASE_URL}/api/versions?${params.toString()}`,
      init: { method: "GET", headers: { Accept: "application/json" } }
    };
  }

  async function loadVersions() {
    state.abortController?.abort();
    const favoriteVersionIds = state.favoriteOnly ? readFavoriteVersionIds() : [];
    state.favoriteIdCount = favoriteVersionIds.length;
    if (state.favoriteOnly && favoriteVersionIds.length > MAX_FAVORITES) {
      state.loading = false;
      state.errorCode = "TOO_MANY_LOCAL_FAVORITES";
      setFeedback(`お気に入りが${MAX_FAVORITES}件を超えているため一覧を取得できません。`);
      renderCurrent();
      return;
    }

    const requestSequence = state.requestSequence + 1;
    const abortController = new AbortController();
    state.requestSequence = requestSequence;
    state.abortController = abortController;
    state.loading = true;
    state.errorCode = "";
    setFeedback("");
    renderCurrent();

    const request = buildRequest(favoriteVersionIds);
    try {
      const response = await fetch(request.url, { ...request.init, signal: abortController.signal });
      const data = await readResponse(response);
      if (requestSequence !== state.requestSequence) {
        return;
      }

      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const itemMap = new Map();
      for (const item of rawItems) {
        const versionId = String(item?.versionId || "").trim();
        if (versionId && !itemMap.has(versionId)) {
          itemMap.set(versionId, item);
        }
      }
      const total = Math.max(0, Number(data?.pagination?.total) || 0);
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (total > 0 && state.page > totalPages) {
        state.page = totalPages;
        updateLocation({ replace: true });
        state.loading = false;
        return loadVersions();
      }

      state.items = [...itemMap.values()];
      state.total = total;
      state.hasNext = data?.pagination?.hasNext === true;
      state.unavailableFavoriteCount = Math.max(0, Number(data?.unavailableFavoriteCount) || 0);
      state.errorCode = "";
      state.loading = false;
      setFeedback(state.total > 0 && !state.hasNext && state.page === totalPages ? "最終ページです。" : "");
      renderCurrent();
    } catch (error) {
      if (error?.name === "AbortError" || requestSequence !== state.requestSequence) {
        return;
      }
      state.loading = false;
      state.errorCode = String(error?.code || "VERSION_LIST_REQUEST_FAILED");
      console.warn("[compact-version-list] request failed", {
        code: state.errorCode,
        page: state.page,
        sort: state.sort,
        status: state.status,
        favoriteOnly: state.favoriteOnly
      });
      setFeedback(state.items.length > 0
        ? "ページの取得に失敗しました。直前の表示を残しています。"
        : "一覧の取得に失敗しました。");
      renderCurrent();
    } finally {
      if (requestSequence === state.requestSequence) {
        state.loading = false;
        list.setAttribute("aria-busy", "false");
        syncControls();
        renderPagination();
      }
    }
  }

  function applyFilterChange(changes) {
    Object.assign(state, changes, { page: 1 });
    updateLocation();
    loadVersions();
  }

  function scrollToResults() {
    if (!results) {
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    results.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = normalizeQuery(searchInput.value);
    searchInput.value = query;
    applyFilterChange({ query });
  });

  searchInput.addEventListener("input", () => {
    searchClearButton.disabled = !searchInput.value.trim();
  });

  searchClearButton.addEventListener("click", () => {
    searchInput.value = "";
    applyFilterChange({ query: "" });
    searchInput.focus();
  });

  sortSelect.addEventListener("change", () => {
    applyFilterChange({ sort: validSorts.has(sortSelect.value) ? sortSelect.value : "new" });
  });

  statusSelect.addEventListener("change", () => {
    applyFilterChange({ status: validStatuses.has(statusSelect.value) ? statusSelect.value : "all" });
  });

  favoriteOnlyInput.addEventListener("change", () => {
    applyFilterChange({ favoriteOnly: favoriteOnlyInput.checked });
  });

  retryButton.addEventListener("click", () => {
    loadVersions();
  });

  pagination.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (!button || button.disabled) {
      return;
    }
    const page = parsePage(button.dataset.page);
    if (page === state.page) {
      return;
    }
    state.page = page;
    updateLocation();
    loadVersions();
    scrollToResults();
  });

  window.addEventListener("popstate", () => {
    Object.assign(state, readLocationState());
    syncControls();
    loadVersions();
  });

  window.addEventListener("storage", (event) => {
    if (event.key === FAVORITES_STORAGE_KEY && state.favoriteOnly) {
      state.page = 1;
      updateLocation({ replace: true });
      loadVersions();
    }
  });

  updateLocation({ replace: true });
  syncControls();
  loadVersions();
})();
