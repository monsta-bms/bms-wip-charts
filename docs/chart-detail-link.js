(() => {
  "use strict";

  const section = document.querySelector("#selectedChartSection");
  const status = document.querySelector("#selectedChartStatus");
  const retryButton = document.querySelector("#selectedChartRetry");
  const cardSlot = document.querySelector("#selectedChartCardSlot");
  const backLink = document.querySelector("#selectedChartBackLink");

  if (!section || !status || !retryButton || !cardSlot || !backLink
    || typeof window.BmsChartRenderPipeline?.renderInto !== "function") {
    return;
  }

  const maxIdLength = 160;
  const validIdPattern = /^[A-Za-z0-9_-]+$/;
  let selection = readSelectionFromUrl();
  let detailRequested = selection.paramsPresent;
  let detailReady = false;
  let shouldFocusTarget = false;
  let highlightTimer = 0;
  let successMessage = "";

  function readSelectionFromUrl() {
    const url = new URL(window.location.href);
    return {
      chartId: url.searchParams.get("chartId") || "",
      versionId: url.searchParams.get("versionId") || "",
      paramsPresent: url.searchParams.has("chartId") || url.searchParams.has("versionId")
    };
  }

  function isValidId(value) {
    return typeof value === "string"
      && value.length > 0
      && Array.from(value).length <= maxIdLength
      && validIdPattern.test(value);
  }

  function hasValidSelection() {
    return isValidId(selection.chartId) && isValidId(selection.versionId);
  }

  function getVersionId(version) {
    return String(version?.id || version?.versionId || "");
  }

  function isPublicReplacementVersion(version) {
    const uiModel = typeof buildSharedVersionUiModel === "function"
      ? buildSharedVersionUiModel(version, { hasProgressMap: true })
      : null;
    return isValidId(getVersionId(version))
      && uiModel?.canShowActions === true
      && uiModel.lifecycle.state === "active";
  }

  function versionSortTime(version) {
    const createdAt = Date.parse(String(version?.createdAt || version?.created_at || ""));
    const updatedAt = Date.parse(String(version?.updatedAt || version?.updated_at || ""));
    return Math.max(Number.isFinite(createdAt) ? createdAt : 0, Number.isFinite(updatedAt) ? updatedAt : 0);
  }

  function chooseReplacementVersion(chartEntry, preferredParentVersionId = "") {
    const versions = (Array.isArray(chartEntry?.versions) ? chartEntry.versions : [])
      .filter(isPublicReplacementVersion);
    if (versions.length === 0) {
      return null;
    }

    const byId = new Map(versions.map((version) => [getVersionId(version), version]));
    if (preferredParentVersionId && byId.has(preferredParentVersionId)) {
      return byId.get(preferredParentVersionId);
    }

    const chart = chartEntry?.chart || {};
    const representativeVersionId = String(
      chart.representativeVersionId
      || chart.representative_version_id
      || chartEntry?.representativeVersionId
      || chartEntry?.representative_version_id
      || ""
    );
    if (representativeVersionId && byId.has(representativeVersionId)) {
      return byId.get(representativeVersionId);
    }

    const latest = versions.filter((version) => versionSortTime(version) > 0).sort((left, right) => {
      const timeDifference = versionSortTime(right) - versionSortTime(left);
      return timeDifference || getVersionId(left).localeCompare(getVersionId(right));
    })[0];
    return latest
      || versions.find((version) => String(version?.branchPath || version?.branch_path || "") === "root")
      || versions[0];
  }

  function updateBackLink() {
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.delete("chartId");
    returnUrl.searchParams.delete("versionId");
    returnUrl.hash = "list";
    backLink.href = returnUrl.toString();
  }

  function updateDetailUrl(historyMode = "replace") {
    const url = new URL(window.location.href);
    url.searchParams.set("chartId", selection.chartId);
    url.searchParams.set("versionId", selection.versionId);
    url.hash = "list";
    const method = historyMode === "push" ? "pushState" : "replaceState";
    window.history[method]({ chartId: selection.chartId, versionId: selection.versionId }, "", url);
    updateBackLink();
  }

  function insertSection() {
    if (!detailRequested) {
      return;
    }
    section.hidden = false;
  }

  function setStatus(message, options = {}) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("is-error", options.error === true);
    status.classList.toggle("is-success", options.success === true);
    retryButton.hidden = options.retry !== true;
    section.setAttribute("aria-busy", options.loading === true ? "true" : "false");
    insertSection();
  }

  function nextFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  function findTargetRow() {
    return Array.from(cardSlot.querySelectorAll(".version-row[data-version-id]"))
      .find((row) => row.dataset.versionId === selection.versionId) || null;
  }

  async function focusTargetVersion() {
    if (!detailReady || !shouldFocusTarget) {
      return;
    }
    shouldFocusTarget = false;

    let row = window.revealChartVersionRow?.(cardSlot, selection.versionId) || findTargetRow();
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

  function renderDetailCard(data, source = "detail") {
    cardSlot.replaceChildren();
    window.BmsChartRenderPipeline.renderInto(data, cardSlot, {
      mode: "detail",
      source,
      selectedChartId: selection.chartId,
      suppressFavorites: true
    });

    const renderedCard = cardSlot.querySelector(":scope > .chart-group");
    if (!renderedCard) {
      const error = new Error("The shared chart renderer did not produce a chart card.");
      error.code = "CHART_DETAIL_CARD_MISSING";
      throw error;
    }

    detailReady = true;
    shouldFocusTarget = true;
    setStatus(successMessage, { success: Boolean(successMessage) });
    section.dispatchEvent(new CustomEvent("chart-detail:rendered", {
      detail: { chartId: selection.chartId, versionId: selection.versionId }
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
    const postSuccess = options.postSuccess === true;
    const managementRefresh = options.managementRefresh === true;
    const recoverDeletedVersion = options.recoverDeletedVersion === true;
    const preferredParentVersionId = recoverDeletedVersion
      ? String(findTargetRow()?.dataset.parentVersionId || "")
      : "";
    setStatus(postSuccess ? successMessage : "指定された投稿を読み込んでいます。", {
      loading: true,
      success: postSuccess && Boolean(successMessage)
    });
    retryButton.disabled = true;

    try {
      const response = await fetch(new URL(`/api/charts/${encodeURIComponent(selection.chartId)}`, API_BASE_URL), {
        headers: { Accept: "application/json" },
        cache: "no-cache"
      });
      const body = await readResponse(response);
      if (!response.ok) {
        if (response.status === 404 && recoverDeletedVersion) {
          clearDeletedSelection();
          return true;
        }
        if (response.status === 404 && managementRefresh) {
          detailReady = false;
          cardSlot.replaceChildren();
          setStatus("管理操作後、この投稿は公開一覧から非表示になりました。", { success: true });
          return true;
        }
        if (response.status === 404 && !postSuccess) {
          detailReady = false;
          cardSlot.replaceChildren();
          setStatus("指定された投稿は見つかりませんでした。\n非公開または取り下げ済みの可能性があります。", { error: true });
          return false;
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

      const selectedVersionVisible = (Array.isArray(charts[0]?.versions) ? charts[0].versions : [])
        .some((version) => String(version?.id || version?.versionId || "") === selection.versionId);
      if (!selectedVersionVisible) {
        if (recoverDeletedVersion) {
          const replacementVersion = chooseReplacementVersion(charts[0], preferredParentVersionId);
          const replacement = getVersionId(replacementVersion);
          if (!replacement) {
            clearDeletedSelection();
            return true;
          }
          selection = { chartId: selection.chartId, versionId: replacement, paramsPresent: true };
          successMessage = "指定された版は削除されたため、残っている版を表示しました。";
          updateDetailUrl("replace");
          window.BmsRecentActivity?.setServerTime?.(body?.serverTime);
          renderDetailCard(body, managementRefresh ? "management-refresh" : "detail");
          await focusTargetVersion();
          return true;
        }
        detailReady = false;
        cardSlot.replaceChildren();
        setStatus(
          managementRefresh
            ? "管理操作後、この版は公開一覧から非表示になりました。"
            : "指定された版は公開一覧に表示されていません。",
          managementRefresh ? { success: true } : { error: true }
        );
        return managementRefresh;
      }

      window.BmsRecentActivity?.setServerTime?.(body?.serverTime);
      renderDetailCard(body, managementRefresh ? "management-refresh" : (postSuccess ? "append-success" : "detail"));
      await focusTargetVersion();
      return true;
    } catch (error) {
      detailReady = false;
      cardSlot.replaceChildren();
      setStatus(
        postSuccess
          ? "投稿は完了しましたが、表示を更新できませんでした。再試行してください。"
          : "指定された投稿を読み込めませんでした。",
        { error: true, retry: true }
      );
      console.warn("[chart-detail-load] failed to load selected chart", {
        code: error?.code || "CHART_DETAIL_LOAD_FAILED",
        chartId: selection.chartId,
        hasVersionId: Boolean(selection.versionId),
        postSuccess,
        errorType: error?.name || typeof error
      });
      return false;
    } finally {
      retryButton.disabled = false;
      section.setAttribute("aria-busy", "false");
    }
  }

  async function showCreatedVersion({ chartId, versionId, message = "投稿しました。" } = {}) {
    if (!isValidId(chartId) || !isValidId(versionId)) {
      console.warn("[chart-detail-created] success response did not contain usable IDs", {
        code: "INVALID_CREATED_VERSION_IDS",
        hasChartId: Boolean(chartId),
        hasVersionId: Boolean(versionId)
      });
      return false;
    }

    selection = { chartId: String(chartId), versionId: String(versionId), paramsPresent: true };
    detailRequested = true;
    detailReady = false;
    successMessage = message;
    updateDetailUrl("replace");
    insertSection();

    const loaded = await loadDetail({ postSuccess: true });
    await window.loadCharts?.({ selectedChartId: selection.chartId });
    return loaded;
  }

  async function reloadFromUrl() {
    selection = readSelectionFromUrl();
    detailRequested = selection.paramsPresent;
    detailReady = false;
    shouldFocusTarget = false;
    successMessage = "";
    cardSlot.replaceChildren();

    if (!detailRequested) {
      section.hidden = true;
      await window.loadCharts?.({ selectedChartId: "" });
      return;
    }

    updateBackLink();
    if (!hasValidSelection()) {
      setStatus("指定された投稿を開けませんでした。URLを確認してください。", { error: true });
      await window.loadCharts?.({ selectedChartId: "" });
      return;
    }

    await loadDetail({ recoverDeletedVersion: true });
    await window.loadCharts?.({ selectedChartId: selection.chartId });
  }

  function clearDeletedSelection() {
    const url = new URL(window.location.href);
    url.searchParams.delete("chartId");
    url.searchParams.delete("versionId");
    url.hash = "list";
    window.history.replaceState({}, "", url);
    selection = { chartId: "", versionId: "", paramsPresent: false };
    detailRequested = false;
    detailReady = false;
    shouldFocusTarget = false;
    successMessage = "";
    cardSlot.replaceChildren();
    section.hidden = true;
  }

  async function refreshAfterManagement({ chartId, outcome } = {}) {
    if (!detailRequested || String(chartId || "") !== selection.chartId) {
      return true;
    }
    if (outcome === "immediate_deleted") {
      successMessage = "投稿を削除しました。";
      return loadDetail({ managementRefresh: true, recoverDeletedVersion: true });
    }
    successMessage = "";
    return loadDetail({ managementRefresh: true });
  }

  window.BmsChartDetail = {
    getSelection: () => ({
      chartId: detailRequested ? selection.chartId : "",
      versionId: detailRequested ? selection.versionId : ""
    }),
    reloadFromUrl,
    showCreatedVersion,
    refreshAfterManagement
  };

  updateBackLink();
  if (!detailRequested) {
    section.hidden = true;
    window.chartDetailInitialRenderPromise = Promise.resolve();
  } else if (!hasValidSelection()) {
    setStatus("指定された投稿を開けませんでした。URLを確認してください。", { error: true });
    console.warn("[chart-detail-params] invalid detail link parameters", {
      code: "INVALID_CHART_DETAIL_PARAMS",
      hasChartId: Boolean(selection.chartId),
      hasVersionId: Boolean(selection.versionId)
    });
    window.chartDetailInitialRenderPromise = Promise.resolve();
  } else {
    window.chartDetailInitialRenderPromise = loadDetail({ recoverDeletedVersion: true });
  }

  retryButton.addEventListener("click", async () => {
    const loaded = await loadDetail({
      postSuccess: Boolean(successMessage),
      recoverDeletedVersion: true
    });
    if (loaded) {
      await window.loadCharts?.({ selectedChartId: selection.chartId });
    }
  });

  window.addEventListener("popstate", () => {
    void reloadFromUrl();
  });

  window.addEventListener("chart-list-load-settled", () => {
    insertSection();
    void focusTargetVersion();
  });
})();
