(() => {
  const apiBaseUrl = window.API_BASE_URL || "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const chartList = document.querySelector("#chartList") || document.querySelector("#compactVersionList");
  const chartInteractionRoot = document.querySelector("#list") || chartList;
  const dialog = document.querySelector("#versionManagementDialog");
  if (!chartList || !chartInteractionRoot || !dialog) return;

  const form = dialog.querySelector("#versionManagementForm");
  const title = dialog.querySelector("#versionManagementTitle");
  const versionValue = dialog.querySelector("#versionManagementVersion");
  const authorValue = dialog.querySelector("#versionManagementAuthor");
  const stateValue = dialog.querySelector("#versionManagementState");
  const createdAtValue = dialog.querySelector("#versionManagementCreatedAt");
  const scheduleValue = dialog.querySelector("#versionManagementSchedule");
  const downloadValue = dialog.querySelector("#versionManagementDownload");
  const allowAppendValue = dialog.querySelector("#versionManagementAllowAppend");
  const actionTitle = dialog.querySelector("#withdrawalActionTitle");
  const description = dialog.querySelector("#versionWithdrawalDescription");
  const reasonField = dialog.querySelector("#versionWithdrawalReasonField");
  const reasonInput = dialog.querySelector("#versionWithdrawalReason");
  const passwordInput = dialog.querySelector("#versionManagementPassword");
  const actionButton = dialog.querySelector("#versionWithdrawalActionButton");
  const closeButtons = Array.from(dialog.querySelectorAll("[data-version-management-close]"));
  const message = dialog.querySelector("#versionManagementMessage");

  const fixedErrorMessages = {
    INVALID_IDEMPOTENCY_KEY: "取り下げ操作を確認できません。管理画面を開き直してください。",
    IDEMPOTENCY_KEY_REUSED: "取り下げ操作を確認できません。管理画面を開き直してください。",
    WITHDRAWAL_NOT_ALLOWED: "この投稿は現在取り下げできません。",
    WITHDRAWAL_NOT_PENDING: "取り消せる取り下げ申請がありません。",
    WITHDRAWAL_CANCEL_EXPIRED: "取り下げ申請の取消期限を過ぎています。",
    WITHDRAWAL_STATE_CONFLICT: "投稿の状態が更新されました。画面を再読み込みして確認してください。",
    LIFECYCLE_OPERATION_IN_PROGRESS: "取り下げ処理が開始されているため、操作できません。",
    LEGACY_LIFECYCLE_ACTIVE: "この投稿は従来方式の取り下げ・削除処理中です。",
    INVALID_PASSWORD: "管理パスワードが違います。",
    PASSWORD_REQUIRED: "管理パスワードを入力してください。",
    RATE_LIMITED: "管理パスワードの試行回数が上限を超えました。しばらく待ってから再試行してください。",
    INVALID_WITHDRAWAL_REASON: "取り下げ理由を10文字以上で入力してください。",
    WITHDRAWAL_REASON_TOO_LONG: "取り下げ理由は500文字以内で入力してください。"
  };

  const state = {
    versionId: "",
    chartId: "",
    versionLabel: "",
    author: "",
    createdAt: null,
    lifecycleStatus: "active",
    requestMode: null,
    handlingMode: null,
    requestedAt: null,
    scheduledAt: null,
    requestPreview: "unavailable",
    canRequestWithdrawal: false,
    canCancelWithdrawal: false,
    downloadAvailable: false,
    appendAvailable: false,
    loading: false,
    submitting: false,
    idempotencyKey: "",
    lifecycleRevision: 0,
    lifecycleController: null
  };

  function parseApiDate(value) {
    const source = String(value || "").trim();
    if (!source) return null;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatDateTime(value) {
    const date = value instanceof Date ? value : parseApiDate(value);
    if (!date) return "-";
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function readSavedPassword() {
    return window.BmsPostPreferences?.getStoredPassword?.() || "";
  }

  function createIdempotencyKey() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function setMessage(text, kind = "error") {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = !text;
  }

  function describeState() {
    if (state.lifecycleStatus === "active" && state.canRequestWithdrawal) {
      if (state.requestPreview === "immediate_delete") return "24時間以内の投稿なので即時削除できます。";
      if (state.requestPreview === "grace_auto_delete") return "即時削除はできません。7日間に追記がなければ自動削除します。";
      if (state.requestPreview === "manual_review") return "派生版があるため、DLを停止して管理者確認へ進みます。";
    }
    switch (state.lifecycleStatus) {
      case "withdrawal_pending":
        return state.handlingMode === "manual_review"
          ? "DL停止・管理者確認待ち"
          : state.handlingMode === "grace_auto_delete"
            ? "DL停止・自動削除待ち"
            : "削除処理待ち";
      case "processing": return "取り下げ処理中";
      case "legacy_withdrawn": return "従来方式の取り下げ中";
      case "legacy_delete_pending": return "従来方式の削除申請中";
      case "tombstoned": return "履歴のみ";
      default: return "公開中";
    }
  }

  function renderLifecycle() {
    stateValue.textContent = describeState();
    scheduleValue.textContent = state.handlingMode === "grace_auto_delete" && state.scheduledAt
      ? `${formatDateTime(state.scheduledAt)}以降`
      : "-";
    downloadValue.textContent = state.downloadAvailable ? "利用可能" : "利用不可";
    allowAppendValue.textContent = state.appendAvailable ? "許可" : "停止";

    actionButton.hidden = false;
    actionButton.disabled = state.loading || state.submitting;
    reasonField.hidden = true;
    reasonInput.required = false;
    if (state.loading) {
      actionTitle.textContent = "投稿を取り下げる";
      description.textContent = "対象の状態を確認しています。";
      actionButton.textContent = "確認中…";
      return;
    }

    if (state.lifecycleStatus === "active" && state.canRequestWithdrawal) {
      if (state.requestPreview === "immediate_delete") {
        actionTitle.textContent = "即時削除";
        description.textContent = "投稿から24時間以内で、派生版や参照がありません。取り下げると直ちに削除され、元に戻せません。";
        actionButton.textContent = "取り下げて削除する";
      } else if (state.requestPreview === "grace_auto_delete") {
        actionTitle.textContent = "DL停止・7日後に自動削除";
        description.textContent = "投稿から24時間を超えているため、すぐには削除されません。ダウンロードを停止し、申請後7日間に新しい追記や参照がなければ自動削除します。";
        actionButton.textContent = "DL停止と自動削除を申請する";
        reasonField.hidden = false;
        reasonInput.required = true;
      } else {
        actionTitle.textContent = "DL停止・管理者確認";
        description.textContent = "派生版または参照があるため、自動削除できません。ダウンロードを停止し、申請理由を管理者が確認します。版ツリーの関係を保つため、履歴が残る場合があります。";
        actionButton.textContent = "DL停止を申請する";
        reasonField.hidden = false;
        reasonInput.required = true;
      }
      return;
    }

    if (state.lifecycleStatus === "withdrawal_pending" && state.handlingMode !== "immediate_delete") {
      if (state.handlingMode === "manual_review") {
        actionTitle.textContent = "DL停止・管理者確認待ち";
        description.textContent = "ダウンロードを停止しています。申請理由と派生版の状態を管理者が確認します。取り消すと、今回の申請によるDL停止を解除します。";
      } else {
        actionTitle.textContent = "DL停止・自動削除待ち";
        description.textContent = `ダウンロードを停止しています。${formatDateTime(state.scheduledAt)}以降、申請後の追記や参照がなければ自動削除します。取り消すと、今回の申請によるDL停止を解除します。`;
      }
      if (state.canCancelWithdrawal) {
        actionButton.textContent = "取り下げ申請を取り消す";
      } else {
        actionButton.textContent = "取消期限を過ぎています";
        actionButton.disabled = true;
      }
      return;
    }

    actionButton.hidden = true;
    if (state.lifecycleStatus === "withdrawal_pending") {
      actionTitle.textContent = "削除処理待ち";
      description.textContent = "この投稿は削除処理待ちです。この操作は取り消せません。";
    } else if (state.lifecycleStatus === "processing") {
      actionTitle.textContent = "取り下げ処理中";
      description.textContent = "取り下げ処理を受け付けました。処理完了までしばらくお待ちください。";
    } else if (["legacy_withdrawn", "legacy_delete_pending"].includes(state.lifecycleStatus)) {
      actionTitle.textContent = "従来方式の処理中";
      description.textContent = "この投稿は従来方式の取り下げ・削除処理中です。";
    } else if (state.lifecycleStatus === "tombstoned") {
      actionTitle.textContent = "投稿者により取り下げられました";
      description.textContent = "派生版を維持するため、版ツリー上の履歴だけ残っています。";
    } else {
      actionTitle.textContent = "投稿を取り下げる";
      description.textContent = "この投稿は現在取り下げできません。";
    }
  }

  function setSubmitting(submitting) {
    state.submitting = submitting;
    passwordInput.disabled = submitting;
    reasonInput.disabled = submitting;
    closeButtons.forEach((button) => { button.disabled = submitting; });
    dialog.classList.toggle("is-submitting", submitting);
    renderLifecycle();
  }

  function applyLifecycle(body) {
    state.lifecycleStatus = String(body?.lifecycleStatus || "active");
    state.requestMode = body?.requestMode === "immediate" || body?.requestMode === "deferred"
      ? body.requestMode
      : null;
    state.handlingMode = ["immediate_delete", "grace_auto_delete", "manual_review"].includes(body?.handlingMode)
      ? body.handlingMode
      : null;
    state.requestedAt = parseApiDate(body?.requestedAt);
    state.scheduledAt = parseApiDate(body?.scheduledAt);
    state.requestPreview = String(body?.requestPreview || "unavailable");
    state.canRequestWithdrawal = body?.canRequestWithdrawal === true;
    state.canCancelWithdrawal = body?.canCancelWithdrawal === true;
    state.downloadAvailable = body?.downloadAvailable === true;
    state.appendAvailable = body?.appendAvailable === true;
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  async function fetchLifecycle() {
    const revision = state.lifecycleRevision;
    const versionId = state.versionId;
    state.lifecycleController?.abort();
    const controller = new AbortController();
    state.lifecycleController = controller;
    state.loading = true;
    renderLifecycle();
    try {
      const response = await fetch(new URL(
        `/api/versions/${encodeURIComponent(versionId)}/lifecycle`,
        apiBaseUrl
      ).toString(), { cache: "no-store", signal: controller.signal });
      const body = await readJson(response);
      if (revision !== state.lifecycleRevision || versionId !== state.versionId) return;
      if (!response.ok) {
        if (response.status === 404 || body?.code === "NOT_FOUND") {
          throw { code: "LIFECYCLE_API_UNAVAILABLE" };
        }
        throw body || { code: "LIFECYCLE_LOAD_FAILED" };
      }
      applyLifecycle(body);
      setMessage("");
    } catch (error) {
      if (error?.name === "AbortError" || revision !== state.lifecycleRevision) return;
      console.warn("[version-management] lifecycle lookup failed", {
        code: error?.code || "LIFECYCLE_LOAD_FAILED",
        versionId: state.versionId
      });
      state.canRequestWithdrawal = false;
      setMessage("取り下げ機能を更新中です。時間を置いて再度お試しください。");
    } finally {
      if (revision !== state.lifecycleRevision || versionId !== state.versionId) return;
      if (state.lifecycleController === controller) state.lifecycleController = null;
      state.loading = false;
      renderLifecycle();
    }
  }

  function openDialog(button) {
    state.lifecycleController?.abort();
    state.lifecycleRevision += 1;
    state.versionId = button.dataset.versionId || "";
    state.chartId = button.dataset.chartId || "";
    state.versionLabel = button.dataset.versionLabel || "-";
    state.author = button.dataset.author || "未入力";
    state.createdAt = parseApiDate(button.dataset.createdAt);
    state.lifecycleStatus = button.dataset.lifecycleStatus || "active";
    state.requestMode = button.dataset.requestMode || null;
    state.handlingMode = button.dataset.handlingMode || null;
    state.scheduledAt = parseApiDate(button.dataset.scheduledAt);
    state.requestPreview = "unavailable";
    state.canRequestWithdrawal = false;
    state.canCancelWithdrawal = button.dataset.canCancelWithdrawal === "true";
    state.downloadAvailable = button.dataset.downloadAvailable === "true";
    state.appendAvailable = button.dataset.appendAvailable === "true";
    state.idempotencyKey = "";
    reasonInput.value = "";
    state.loading = true;
    state.submitting = false;

    title.textContent = `削除確認: ${state.versionLabel}`;
    versionValue.textContent = state.versionLabel;
    authorValue.textContent = state.author;
    createdAtValue.textContent = formatDateTime(state.createdAt);
    passwordInput.value = readSavedPassword();
    setMessage("");
    renderLifecycle();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    void fetchLifecycle().then(() => window.setTimeout(() => passwordInput.focus(), 0));
  }

  function closeDialog() {
    if (state.submitting) return;
    state.lifecycleController?.abort();
    state.lifecycleController = null;
    state.lifecycleRevision += 1;
    state.idempotencyKey = "";
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  async function refreshPublicViews(outcome) {
    const failures = [];
    try {
      if (typeof window.BmsCompactVersionList?.refreshAfterDeletion === "function") {
        const refreshed = await window.BmsCompactVersionList.refreshAfterDeletion({
          chartId: state.chartId,
          versionId: state.versionId,
          outcome
        });
        if (refreshed === false) failures.push("compact-list");
      }
    } catch {
      failures.push("compact-list");
    }
    try {
      const refreshed = await window.BmsChartDetail?.refreshAfterManagement?.({
        chartId: state.chartId,
        versionId: state.versionId,
        outcome
      });
      if (refreshed === false) failures.push("selected-detail");
    } catch {
      failures.push("selected-detail");
    }
    try {
      if (typeof window.loadCharts === "function") {
        const refreshed = await window.loadCharts({
          selectedChartId: window.BmsChartDetail?.getSelection?.().chartId || ""
        });
        if (!refreshed) failures.push("recent-list");
      }
    } catch {
      failures.push("recent-list");
    }
    return failures;
  }

  async function submitOperation() {
    const password = passwordInput.value.trim();
    if (!password) {
      setMessage("管理パスワードを入力してください。");
      passwordInput.focus();
      return;
    }

    const canceling = state.lifecycleStatus === "withdrawal_pending"
      && state.canCancelWithdrawal;
    const reason = reasonInput.value.trim();
    if (!canceling && state.requestPreview !== "immediate_delete" && reason.length < 10) {
      setMessage("取り下げ理由を10文字以上で入力してください。");
      reasonInput.focus();
      return;
    }
    const immediate = state.requestPreview === "immediate_delete";
    const confirmation = canceling
      ? "取り下げ申請を取り消しますか？"
      : immediate
        ? "取り下げると直ちに削除され、元に戻せません。続けますか？"
        : state.requestPreview === "manual_review"
          ? "ダウンロードを停止し、管理者確認を申請します。続けますか？"
          : "ダウンロードを停止し、7日後の自動削除を申請します。続けますか？";
    if (!window.confirm(confirmation)) {
      if (!canceling) state.idempotencyKey = "";
      return;
    }

    const path = canceling
      ? `/api/versions/${encodeURIComponent(state.versionId)}/withdrawal/cancel`
      : `/api/versions/${encodeURIComponent(state.versionId)}/withdrawal`;
    if (!canceling && !state.idempotencyKey) state.idempotencyKey = createIdempotencyKey();

    setMessage("");
    setSubmitting(true);
    try {
      const response = await fetch(new URL(path, apiBaseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canceling
          ? { password }
          : { password, idempotencyKey: state.idempotencyKey, reason })
      });
      const body = await readJson(response);
      if (!response.ok) throw body || { code: "REQUEST_FAILED" };

      state.idempotencyKey = "";
      applyLifecycle(body);
      const outcome = String(body?.outcome || "");
      const successText = canceling
        ? "取り下げ申請を取り消しました。"
        : outcome === "immediate_deleted"
          ? "投稿を削除しました。"
          : outcome === "tombstoned"
            ? "投稿者により取り下げられました。派生版を維持するため、版ツリー上の履歴だけ残っています。"
            : outcome === "processing"
              ? "取り下げ処理を受け付けました。処理完了までしばらくお待ちください。"
              : state.handlingMode === "manual_review"
                ? "ダウンロードを停止し、管理者確認の申請を受け付けました。"
                : "ダウンロードを停止し、自動削除の申請を受け付けました。";
      setSubmitting(false);
      setMessage(successText, "success");
      const failures = await refreshPublicViews(outcome);
      if (failures.length > 0) {
        setMessage(`${successText}\n表示を更新できませんでした。ページを再読み込みしてください。`, "success");
      }
      if (["immediate_deleted", "tombstoned"].includes(outcome) && failures.length === 0) {
        closeDialog();
      }
    } catch (error) {
      const code = error?.code || "REQUEST_FAILED";
      console.warn("[version-management] lifecycle operation failed", {
        code,
        versionId: state.versionId,
        operation: canceling ? "cancel" : "request"
      });
      const unavailable = code === "NOT_FOUND" || code === "LIFECYCLE_API_UNAVAILABLE";
      setMessage(unavailable
        ? "取り下げ機能を更新中です。時間を置いて再度お試しください。"
        : fixedErrorMessages[code] || "取り下げ操作に失敗しました。時間を置いて再度お試しください。");
      setSubmitting(false);
    }
  }

  chartInteractionRoot.addEventListener("click", (event) => {
    const button = event.target.closest(".version-management-button");
    if (!button) return;
    event.preventDefault();
    openDialog(button);
  });
  actionButton.addEventListener("click", submitOperation);
  closeButtons.forEach((button) => button.addEventListener("click", closeDialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener("cancel", (event) => {
    if (state.submitting) event.preventDefault();
    else {
      state.lifecycleController?.abort();
      state.lifecycleController = null;
      state.lifecycleRevision += 1;
      state.idempotencyKey = "";
    }
  });
  form.addEventListener("submit", (event) => event.preventDefault());
})();
