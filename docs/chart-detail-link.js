(() => {
  "use strict";

  const chartList = document.querySelector("#chartList");
  const section = document.querySelector("#selectedChartSection");
  const status = document.querySelector("#selectedChartStatus");
  const retryButton = document.querySelector("#selectedChartRetry");
  const cardSlot = document.querySelector("#selectedChartCardSlot");
  const backLink = document.querySelector("#selectedChartBackLink");

  if (!chartList || !section || !status || !retryButton || !cardSlot || !backLink
    || typeof renderCharts !== "function") {
    return;
  }

  const params = new URL(window.location.href).searchParams;
  const rawChartId = params.get("chartId");
  const rawVersionId = params.get("versionId");
  const detailRequested = params.has("chartId") || params.has("versionId");
  const maxIdLength = 160;
  const validIdPattern = /^[A-Za-z0-9_-]+$/;
  const baseRenderCharts = renderCharts;
  let detailReady = false;
  let shouldFocusTarget = false;
  let highlightTimer = 0;

  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.delete("chartId");
  returnUrl.searchParams.delete("versionId");
  returnUrl.hash = "list";
  backLink.href = returnUrl.toString();

  function isValidId(value) {
    return typeof value === "string"
      && value.length > 0
      && Array.from(value).length <= maxIdLength
      && validIdPattern.test(value);
  }

  function insertSection() {
    if (!detailRequested) {
      return;
    }
    if (chartList.firstElementChild !== section) {
      chartList.prepend(section);
    }
    section.hidden = false;
  }

  function setStatus(message, options = {}) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("is-error", options.error === true);
    retryButton.hidden = options.retry !== true;
    section.setAttribute("aria-busy", options.loading === true ? "true" : "false");
    insertSection();
  }

  function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  function findTargetRow() {
    return Array.from(cardSlot.querySelectorAll(".version-row[data-version-id]"))
      .find((row) => row.dataset.versionId === rawVersionId) || null;
  }

  async function focusTargetVersion() {
    if (!detailReady || !shouldFocusTarget) {
      return;
    }
    shouldFocusTarget = false;

    let row = window.revealChartVersionRow?.(cardSlot, rawVersionId) || findTargetRow();
    await nextFrame();
    await nextFrame();
    row = row?.isConnected ? row : findTargetRow();

    if (!row) {
      setStatus("投稿は見つかりましたが、指定された版は表示できませんでした。", { error: true });
      return;
    }

    row.tabIndex = -1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    row.focus({ preventScroll: true });
    row.classList.add("is-detail-target");
    window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(() => {
      row.classList.remove("is-detail-target");
    }, 4000);
  }

  function scheduleDetailMounts() {
    window.scheduleProgressImageThumbnailMount?.(section);
    window.scheduleChartMiniViewMount?.(section);
    window.scheduleBranchTreeOverlayRefresh?.();
  }

  function renderChartsWithSelectedSection(data) {
    baseRenderCharts(data);
    insertSection();
    scheduleDetailMounts();
    void focusTargetVersion();
  }

  try {
    renderCharts = renderChartsWithSelectedSection;
  } catch {
    window.renderCharts = renderChartsWithSelectedSection;
  }

  function preserveCurrentList() {
    section.remove();
    const fragment = document.createDocumentFragment();
    while (chartList.firstChild) {
      fragment.appendChild(chartList.firstChild);
    }
    return fragment;
  }

  function renderDetailCard(data) {
    const preservedList = preserveCurrentList();
    cardSlot.replaceChildren();
    baseRenderCharts(data);

    const renderedCard = chartList.querySelector(":scope > .chart-group");
    if (!renderedCard) {
      chartList.replaceChildren(preservedList);
      throw new Error("The shared chart renderer did not produce a chart card.");
    }

    cardSlot.appendChild(renderedCard);
    chartList.replaceChildren(preservedList);
    detailReady = true;
    shouldFocusTarget = true;
    setStatus("");
    section.dispatchEvent(new CustomEvent("chart-detail:rendered", {
      detail: { chartId: rawChartId, hasVersionId: Boolean(rawVersionId) }
    }));
  }

  async function readResponse(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function loadDetail(options = {}) {
    setStatus("指定された投稿を読み込んでいます。", { loading: true });
    retryButton.disabled = true;

    try {
      const response = await fetch(new URL(`/api/charts/${encodeURIComponent(rawChartId)}`, API_BASE_URL), {
        headers: { Accept: "application/json" },
        cache: "no-cache"
      });
      const body = await readResponse(response);
      if (!response.ok) {
        if (response.status === 404) {
          detailReady = false;
          cardSlot.replaceChildren();
          setStatus("指定された投稿は見つかりませんでした。\n非公開または取り下げ済みの可能性があります。", { error: true });
          return;
        }
        throw {
          code: body?.code || "CHART_DETAIL_LOAD_FAILED",
          name: "ChartDetailRequestError"
        };
      }

      const charts = Array.isArray(body?.charts) ? body.charts : [];
      if (charts.length !== 1) {
        throw { code: "CHART_DETAIL_INVALID_RESPONSE", name: "ChartDetailResponseError" };
      }

      renderDetailCard(body);
      if (options.rerenderList === true) {
        window.rerenderCurrentChartList?.();
      }
    } catch (error) {
      detailReady = false;
      cardSlot.replaceChildren();
      setStatus("指定された投稿を読み込めませんでした。", { error: true, retry: true });
      console.warn("[chart-detail-load] failed to load selected chart", {
        code: error?.code || "CHART_DETAIL_LOAD_FAILED",
        chartId: rawChartId,
        hasVersionId: Boolean(rawVersionId),
        errorType: error?.name || typeof error
      });
    } finally {
      retryButton.disabled = false;
      section.setAttribute("aria-busy", "false");
    }
  }

  if (!detailRequested) {
    return;
  }

  if (!isValidId(rawChartId) || !isValidId(rawVersionId)) {
    setStatus("指定された投稿を開けませんでした。URLを確認してください。", { error: true });
    console.warn("[chart-detail-params] invalid detail link parameters", {
      code: "INVALID_CHART_DETAIL_PARAMS",
      hasChartId: Boolean(rawChartId),
      hasVersionId: Boolean(rawVersionId)
    });
    window.chartDetailInitialRenderPromise = Promise.resolve();
  } else {
    window.chartDetailInitialRenderPromise = loadDetail();
  }

  retryButton.addEventListener("click", () => {
    void loadDetail({ rerenderList: true });
  });

  window.addEventListener("chart-list-load-settled", () => {
    insertSection();
    scheduleDetailMounts();
    void focusTargetVersion();
  });
})();
