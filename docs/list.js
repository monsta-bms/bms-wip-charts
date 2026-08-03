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
  const sortInputs = [...document.querySelectorAll('input[name="compactSort"]')];
  const statusInputs = [...document.querySelectorAll('input[name="compactStatus"]')];
  const dateFromInput = document.getElementById("compactDateFrom");
  const dateToInput = document.getElementById("compactDateTo");
  const dateApplyButton = document.getElementById("compactDateApply");
  const dateError = document.getElementById("compactDateError");
  const dateShortcuts = document.getElementById("compactDateShortcuts");
  const dateHeading = document.getElementById("compactDateHeading");
  const favoriteOnlyInput = document.getElementById("compactFavoriteOnly");
  const summary = document.getElementById("compactListSummary");
  const list = document.getElementById("compactVersionList");
  const feedback = document.getElementById("compactListFeedback");
  const retryButton = document.getElementById("compactListRetry");
  const pagination = document.getElementById("compactPagination");
  const results = document.querySelector(".compact-results");

  if (!searchForm || !searchInput || !searchClearButton || sortInputs.length === 0 || statusInputs.length === 0
    || !dateFromInput || !dateToInput || !dateApplyButton || !dateError || !dateShortcuts || !dateHeading
    || !favoriteOnlyInput || !summary || !list || !feedback || !retryButton || !pagination) {
    return;
  }

  const initialLocationState = readLocationState();
  const state = {
    ...initialLocationState,
    draftDateFrom: initialLocationState.dateFrom,
    draftDateTo: initialLocationState.dateTo,
    activeDateShortcut: "",
    dateError: initialLocationState.dateError,
    serverTime: "",
    serverTimeCapturedAt: 0,
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
  const relativeTimeWarnings = new Set();

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function buildSharedVersionUiModel(version, options = {}) {
    return window.BmsVersionUiModel?.buildVersionUiModel?.(version, {
      workerBaseUrl: API_BASE_URL,
      hasProgressMap: options.hasProgressMap === true,
      isSupersededIntermediate: options.isSupersededIntermediate === true
    }) || null;
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

  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function daysInMonth(year, month) {
    if (month === 2) {
      return isLeapYear(year) ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  function isValidDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) {
      return false;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
  }

  function parseLocationDate(params, name) {
    const rawValue = params.get(name);
    if (rawValue === null || rawValue === "") {
      return { value: "", invalid: false };
    }
    return isValidDateOnly(rawValue)
      ? { value: rawValue, invalid: false }
      : { value: "", invalid: true };
  }

  function readLocationState() {
    const params = new URL(window.location.href).searchParams;
    const sort = params.get("sort") || "new";
    const status = params.get("status") || "all";
    const parsedDateFrom = parseLocationDate(params, "dateFrom");
    const parsedDateTo = parseLocationDate(params, "dateTo");
    let dateFrom = parsedDateFrom.value;
    let dateTo = parsedDateTo.value;
    let dateErrorMessage = parsedDateFrom.invalid || parsedDateTo.invalid
      ? "URLの日付指定を読み込めなかったため解除しました。"
      : "";
    if (dateFrom && dateTo && dateFrom > dateTo) {
      dateFrom = "";
      dateTo = "";
      dateErrorMessage = "開始日は終了日以前にしてください。期間指定を解除しました。";
    }
    return {
      query: normalizeQuery(params.get("q") || ""),
      sort: validSorts.has(sort) ? sort : "new",
      status: validStatuses.has(status) ? status : "all",
      favoriteOnly: ["1", "true"].includes((params.get("favorites") || "").toLowerCase()),
      dateFrom,
      dateTo,
      dateError: dateErrorMessage,
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
    setOrDelete("dateFrom", state.dateFrom);
    setOrDelete("dateTo", state.dateTo);
    setOrDelete("page", state.page > 1 ? String(state.page) : "");
    const historyState = {
      q: state.query,
      sort: state.sort,
      status: state.status,
      favorites: state.favoriteOnly,
      dateFrom: state.dateFrom,
      dateTo: state.dateTo,
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

  function getServerNow() {
    const serverDate = parseCreatedAt(state.serverTime);
    if (!serverDate) {
      if (state.serverTime && !relativeTimeWarnings.has("INVALID_SERVER_TIME")) {
        relativeTimeWarnings.add("INVALID_SERVER_TIME");
        console.warn("[compact-version-list] invalid API server time", {
          code: "INVALID_SERVER_TIME"
        });
      }
      return null;
    }
    return serverDate.getTime() + Math.max(0, performance.now() - state.serverTimeCapturedAt);
  }

  function getRelativeTimeLabel(createdAt) {
    const created = parseCreatedAt(createdAt);
    if (!created) {
      const warningKey = `INVALID_VERSION_TIMESTAMP:${createdAt}`;
      if (createdAt && !relativeTimeWarnings.has(warningKey)) {
        relativeTimeWarnings.add(warningKey);
        console.warn("[compact-version-list] invalid version timestamp was ignored", {
          code: "INVALID_VERSION_TIMESTAMP"
        });
      }
      return "";
    }

    const now = getServerNow();
    if (now === null) {
      return "";
    }
    const ageMs = now - created.getTime();
    if (ageMs < 0) {
      const warningKey = `FUTURE_VERSION_TIMESTAMP:${createdAt}`;
      if (!relativeTimeWarnings.has(warningKey)) {
        relativeTimeWarnings.add(warningKey);
        console.warn("[compact-version-list] future version timestamp was ignored", {
          code: "FUTURE_VERSION_TIMESTAMP"
        });
      }
      return "";
    }

    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    if (hours < 1) {
      return "1時間未満";
    }
    if (hours < 24) {
      return `${hours}時間前`;
    }
    if (hours < 192) {
      return `${Math.floor(hours / 24)}日前`;
    }
    return "";
  }

  function renderRelativeTimeBadge(createdAt) {
    const source = String(createdAt || "");
    if (!source) {
      return "";
    }
    const label = getRelativeTimeLabel(source);
    const absolute = formatCreatedAt(source).full;
    return `<span class="compact-relative-time-badge" data-created-at="${escapeHtml(source)}" title="版の投稿日時: ${escapeHtml(absolute)}" aria-label="${escapeHtml(label ? `${label}、版の投稿日時: ${absolute}` : `版の投稿日時: ${absolute}`)}"${label ? "" : " hidden"}>${escapeHtml(label)}</span>`;
  }

  function refreshRelativeTimeBadges() {
    list.querySelectorAll(".compact-relative-time-badge[data-created-at]").forEach((badge) => {
      const createdAt = badge.dataset.createdAt || "";
      const label = getRelativeTimeLabel(createdAt);
      const absolute = formatCreatedAt(createdAt).full;
      badge.hidden = !label;
      badge.textContent = label;
      badge.title = `版の投稿日時: ${absolute}`;
      badge.setAttribute("aria-label", label ? `${label}、版の投稿日時: ${absolute}` : `版の投稿日時: ${absolute}`);
    });
  }

  function formatDateOnly(year, month, day) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function addDaysToDateOnly(value, amount) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return formatDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  function getServerJstToday() {
    const serverDate = parseCreatedAt(state.serverTime);
    if (!serverDate) {
      return "";
    }
    const shifted = new Date(serverDate.getTime() + (9 * 60 * 60 * 1000));
    return formatDateOnly(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }

  function buildDateShortcutRange(shortcut) {
    if (shortcut === "none") {
      return { dateFrom: "", dateTo: "" };
    }
    const today = getServerJstToday();
    if (!today) {
      return null;
    }
    const [year, month] = today.split("-").map(Number);
    if (shortcut === "today") {
      return { dateFrom: today, dateTo: today };
    }
    if (shortcut === "month") {
      return { dateFrom: formatDateOnly(year, month, 1), dateTo: today };
    }
    if (shortcut === "year") {
      return { dateFrom: formatDateOnly(year, 1, 1), dateTo: today };
    }
    if (shortcut === "week") {
      const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
      const dayOfWeek = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay)).getUTCDay();
      const daysSinceMonday = (dayOfWeek + 6) % 7;
      return { dateFrom: addDaysToDateOnly(today, -daysSinceMonday), dateTo: today };
    }
    return null;
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

  function formatVersionChartName(chartName) {
    return String(chartName || "差分名未入力").trim();
  }

  function renderRow(item) {
    const songTitle = String(item.title || "曲名未入力").trim();
    const subtitle = String(item.subtitle || "").trim();
    const fullTitle = subtitle ? `${songTitle} ${subtitle}` : songTitle;
    const chartName = String(item.chartName || item.chart_name || "差分名未入力").trim();
    const versionLabel = String(item.versionLabel || "版不明").trim();
    const difficulty = String(item.difficulty || "未入力").trim();
    const author = String(item.author || "未入力").trim();
    const commentPreview = item.hasComment === true ? String(item.commentPreview || "") : "";
    const hasComment = Boolean(commentPreview);
    const rawProgress = Number(item.progress);
    const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, Math.round(rawProgress))) : 0;
    const displayedAt = formatCreatedAt(state.sort === "updated" ? item.chartUpdatedAt : item.createdAt);
    const relativeTimeBadge = renderRelativeTimeBadge(item.createdAt);
    const stateBadges = buildStateBadges(item);
    const versionChartName = formatVersionChartName(chartName);
    const fullLabel = `${fullTitle} / 差分名: ${versionChartName} / 版: ${versionLabel}`;
    const uiModel = buildSharedVersionUiModel(item, { hasProgressMap: true });
    const linkUi = window.BmsVersionLinkUi;
    const canBuildLinks = typeof linkUi?.createOriginLink === "function"
      && typeof linkUi?.createDownloadControl === "function"
      && typeof linkUi?.serializeControl === "function";
    const originControl = canBuildLinks
      ? linkUi.serializeControl(linkUi.createOriginLink(uiModel, {
        variant: "compact",
        ariaLabel: `${fullTitle} の原曲・本体の配布ページを開く（外部サイト）`
      }))
      : "";
    const downloadControl = (canBuildLinks
      ? linkUi.serializeControl(linkUi.createDownloadControl(uiModel, {
        variant: "compact",
        availableAriaLabel: `${fullTitle} / ${versionChartName} / ${versionLabel} をダウンロード`,
        unavailableAriaLabel: `${fullTitle} / ${versionChartName} / ${versionLabel} はダウンロードできません`
      }))
      : "") || `<span class="compact-link-control compact-download-disabled" aria-label="${escapeHtml(`${fullTitle} / ${versionChartName} / ${versionLabel} はダウンロードできません`)}">DL不可</span>`;
    const actionUi = window.BmsVersionActionUi;
    const commentControl = typeof actionUi?.createCommentControl === `function`
      ? actionUi.createCommentControl(uiModel, {
          songTitle: fullTitle,
          chartName: versionChartName,
          versionLabel,
          author,
          authorComment: String(item.authorComment || item.author_comment || item.commentPreview || ``)
        })?.outerHTML || ``
      : "";
    const detailUrl = new URL("./index.html", document.baseURI);
    detailUrl.searchParams.set("chartId", String(item.chartId || ""));
    detailUrl.searchParams.set("versionId", String(item.versionId || ""));
    detailUrl.hash = "list";

    return `
      <article class="compact-version-row${hasComment ? " has-comment" : ""}" data-version-id="${escapeHtml(item.versionId || "")}">
        <div class="compact-date-cell">
          <time class="compact-date" datetime="${escapeHtml(displayedAt.datetime)}" title="${escapeHtml(displayedAt.full)}">${escapeHtml(displayedAt.short)}</time>
          ${relativeTimeBadge}
        </div>
        <div class="compact-title-cell" title="${escapeHtml(fullLabel)}">
          <div class="compact-title-line">
            <a class="compact-song-title compact-detail-link" href="${escapeHtml(detailUrl.toString())}">${escapeHtml(fullTitle)}</a>
            <span class="compact-state-badges">${stateBadges}</span>
          </div>
          <div class="compact-version-title">
            <span class="compact-version-detail">
              <span class="compact-version-detail-label">差分名：</span>
              <span class="compact-version-detail-value" title="${escapeHtml(versionChartName)}">${escapeHtml(versionChartName)}</span>
            </span>
            <span class="compact-version-detail">
              <span class="compact-version-detail-label">版：</span>
              <span class="compact-version-detail-value">${escapeHtml(versionLabel)}</span>
            </span>
          </div>
        </div>
        <div class="compact-difficulty"><span class="compact-field-label">難易度</span><span>${escapeHtml(difficulty)}</span></div>
        <div class="compact-author"><span class="compact-field-label">作者</span><span title="${escapeHtml(author)}">${escapeHtml(author)}</span></div>
        <div class="compact-comment"></div>
        <div class="compact-progress"><span class="compact-field-label">進捗</span><span>${escapeHtml(progress)}%</span></div>
        <div class="compact-links"><span class="compact-field-label">リンク</span>${originControl}${downloadControl}${commentControl}</div>
      </article>
    `;
  }

  function applyCommentText() {
    const rows = [...list.querySelectorAll(".compact-version-row")];
    rows.forEach((row, index) => {
      const comment = row.querySelector(".compact-comment");
      const item = state.items[index];
      if (!comment || !item) {
        return;
      }
      const fullComment = item.hasComment === true
        ? String(item.authorComment || item.author_comment || item.commentPreview || "")
        : ``;
      const commentUi = window.BmsVersionCommentUi;
      if (typeof commentUi?.mountAuthorComment === "function") {
        commentUi.mountAuthorComment(comment, fullComment, {
          versionId: String(item.versionId || ""),
          songTitle: String(item.title || `曲名不明`),
          chartName: String(item.chartName || `差分名不明`),
          versionLabel: String(item.versionLabel || `版不明`),
          author: String(item.author || `未入力`),
          latestComment: item.latestComment || item.latest_comment || null
        });
      } else {
        comment.textContent = fullComment || `—`;
      }
    });
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
      if (state.query || state.status !== "all" || state.dateFrom || state.dateTo) {
        return "条件に一致する公開中のお気に入りはありません。";
      }
      return "公開中のお気に入りはありません。";
    }
    if (state.query) {
      return `「${escapeHtml(state.query)}」に一致する投稿はありません。`;
    }
    if (state.status !== "all" || state.dateFrom || state.dateTo) {
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
      const conditionPrefix = state.query || state.status !== "all" || state.dateFrom || state.dateTo
        ? "条件に一致する"
        : "";
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
    sortInputs.forEach((input) => {
      input.checked = input.value === state.sort;
    });
    statusInputs.forEach((input) => {
      input.checked = input.value === state.status;
    });
    dateFromInput.value = state.draftDateFrom;
    dateToInput.value = state.draftDateTo;
    dateHeading.textContent = state.sort === "updated" ? "更新日" : "投稿日";
    favoriteOnlyInput.checked = state.favoriteOnly;
    dateError.textContent = state.dateError;
    dateError.hidden = !state.dateError;
    const hasDateError = Boolean(state.dateError);
    dateFromInput.setAttribute("aria-invalid", hasDateError ? "true" : "false");
    dateToInput.setAttribute("aria-invalid", hasDateError ? "true" : "false");
    const hasServerClock = Boolean(getServerJstToday());
    dateShortcuts.querySelectorAll("button[data-date-shortcut]").forEach((button) => {
      button.disabled = !hasServerClock;
      button.setAttribute("aria-pressed", button.dataset.dateShortcut === state.activeDateShortcut ? "true" : "false");
    });
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
      applyCommentText();
      refreshRelativeTimeBadges();
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
            dateFrom: state.dateFrom || null,
            dateTo: state.dateTo || null,
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
    if (state.dateFrom) {
      params.set("dateFrom", state.dateFrom);
    }
    if (state.dateTo) {
      params.set("dateTo", state.dateTo);
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
      state.serverTime = String(data?.serverTime || state.serverTime || "");
      state.serverTimeCapturedAt = performance.now();
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
        hasDateFrom: Boolean(state.dateFrom),
        hasDateTo: Boolean(state.dateTo),
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

  function validateDraftDateRange() {
    const dateFrom = String(state.draftDateFrom || "");
    const dateTo = String(state.draftDateTo || "");
    if ((dateFrom && !isValidDateOnly(dateFrom)) || (dateTo && !isValidDateOnly(dateTo))) {
      return { ok: false, message: "日付はYYYY-MM-DD形式で入力してください。" };
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return { ok: false, message: "開始日は終了日以前にしてください。" };
    }
    return { ok: true, dateFrom, dateTo };
  }

  function applyDraftDateRange(activeShortcut = "") {
    const validated = validateDraftDateRange();
    if (!validated.ok) {
      state.dateError = validated.message;
      syncControls();
      return;
    }
    state.dateError = "";
    state.activeDateShortcut = activeShortcut;
    applyFilterChange({ dateFrom: validated.dateFrom, dateTo: validated.dateTo });
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

  sortInputs.forEach((input) => input.addEventListener("change", () => {
    if (input.checked) {
      applyFilterChange({ sort: validSorts.has(input.value) ? input.value : "new" });
    }
  }));

  statusInputs.forEach((input) => input.addEventListener("change", () => {
    if (input.checked) {
      applyFilterChange({ status: validStatuses.has(input.value) ? input.value : "all" });
    }
  }));

  const handleDateDraftInput = () => {
    state.draftDateFrom = dateFromInput.value;
    state.draftDateTo = dateToInput.value;
    state.activeDateShortcut = "";
    state.dateError = "";
    syncControls();
  };

  dateFromInput.addEventListener("input", handleDateDraftInput);
  dateToInput.addEventListener("input", handleDateDraftInput);
  dateApplyButton.addEventListener("click", () => {
    applyDraftDateRange();
  });

  dateShortcuts.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-date-shortcut]");
    if (!button || button.disabled) {
      return;
    }
    const shortcut = button.dataset.dateShortcut || "";
    const range = buildDateShortcutRange(shortcut);
    if (!range) {
      return;
    }
    state.draftDateFrom = range.dateFrom;
    state.draftDateTo = range.dateTo;
    state.dateError = "";
    applyDraftDateRange(shortcut);
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
    const locationState = readLocationState();
    Object.assign(state, locationState, {
      draftDateFrom: locationState.dateFrom,
      draftDateTo: locationState.dateTo,
      activeDateShortcut: "",
      dateError: locationState.dateError
    });
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

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshRelativeTimeBadges();
    }
  });

  updateLocation({ replace: true });
  syncControls();
  loadVersions();
})();
