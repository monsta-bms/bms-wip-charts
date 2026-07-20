(() => {
  const apiBaseUrl = window.API_BASE_URL || "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const reasonMaxLength = 500;
  const chartList = document.querySelector("#chartList");
  const chartInteractionRoot = document.querySelector("#list") || chartList;
  const dialog = document.querySelector("#versionManagementDialog");

  if (!chartList || !chartInteractionRoot || !dialog) {
    return;
  }

  const form = dialog.querySelector("#versionManagementForm");
  const title = dialog.querySelector("#versionManagementTitle");
  const versionValue = dialog.querySelector("#versionManagementVersion");
  const authorValue = dialog.querySelector("#versionManagementAuthor");
  const stateValue = dialog.querySelector("#versionManagementState");
  const createdAtValue = dialog.querySelector("#versionManagementCreatedAt");
  const elapsedValue = dialog.querySelector("#versionManagementElapsed");
  const deadlineValue = dialog.querySelector("#versionManagementDeadline");
  const descendantsValue = dialog.querySelector("#versionManagementDescendants");
  const allowAppendValue = dialog.querySelector("#versionManagementAllowAppend");
  const withdrawDescription = dialog.querySelector("#versionWithdrawDescription");
  const deleteDescription = dialog.querySelector("#versionDeleteDescription");
  const passwordInput = dialog.querySelector("#versionManagementPassword");
  const reasonInput = dialog.querySelector("#versionDeleteReason");
  const withdrawConfirm = dialog.querySelector("#versionWithdrawConfirm");
  const withdrawButton = dialog.querySelector("#versionWithdrawButton");
  const deleteRequestButton = dialog.querySelector("#versionDeleteRequestButton");
  const closeButtons = Array.from(dialog.querySelectorAll("[data-version-management-close]"));
  const message = dialog.querySelector("#versionManagementMessage");

  const state = {
    versionId: "",
    chartId: "",
    versionLabel: "",
    author: "",
    createdAt: null,
    within24Hours: false,
    hasDescendants: false,
    withdrawn: false,
    deleteRequested: false,
    allowAppend: true,
    hidden: false,
    submitting: false
  };

  function parseApiDate(value) {
    const source = String(value || "").trim();
    if (!source) {
      return null;
    }

    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatDateTime(date) {
    if (!date) {
      return "不明";
    }

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

  function formatDuration(milliseconds) {
    const minutes = Math.max(0, Math.floor(milliseconds / 60000));
    if (minutes < 60) {
      return `${minutes}分`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}時間${remainingMinutes > 0 ? `${remainingMinutes}分` : ""}`;
  }

  function updateLifecyclePreview() {
    const createdAt = state.createdAt;
    const deadline = createdAt ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000) : null;
    const now = Date.now();
    const within24Hours = createdAt
      ? now < deadline.getTime()
      : state.within24Hours;
    state.within24Hours = within24Hours;

    createdAtValue.textContent = formatDateTime(createdAt);
    elapsedValue.textContent = createdAt ? formatDuration(now - createdAt.getTime()) : "不明";
    deadlineValue.textContent = deadline
      ? `${formatDateTime(deadline)}${within24Hours ? `（残り${formatDuration(deadline.getTime() - now)}）` : "（経過済み）"}`
      : "不明";
    descendantsValue.textContent = state.hasDescendants ? "あり" : "なし";
    if (allowAppendValue) {
      allowAppendValue.textContent = state.allowAppend ? "許可" : "停止";
    }
    const appendPolicyText = state.allowAppend
      ? "この版からの追記受付は継続します。"
      : "この版からの新しい追記は停止されています。";

    if (within24Hours && !state.hasDescendants) {
      withdrawDescription.textContent = "この版は投稿から24時間以内で、公開中の追記版がありません。取り下げると一覧から非表示になります。譜面ファイルと進捗画像はすぐには整理されません。";
      deleteDescription.textContent = "この版は投稿から24時間以内で、公開中の追記版がありません。削除すると一覧から非表示になります。この場合、管理者確認待ちの削除申請は作成されません。";
      return;
    }

    if (within24Hours) {
      withdrawDescription.textContent = `この版は投稿から24時間以内ですが、公開中の追記版があるため一覧に履歴を残します。ダウンロードを停止します。${appendPolicyText}`;
      deleteDescription.textContent = `公開中の追記版があるため一覧に履歴を残し、ダウンロードを停止して削除申請を受け付けます。${appendPolicyText}`;
      return;
    }

    withdrawDescription.textContent = `この版は投稿から24時間を経過しています。取り下げるとダウンロードを停止します。${appendPolicyText}`;
    deleteDescription.textContent = `この版は投稿から24時間を経過しています。ダウンロードを停止し、管理者確認待ちの削除申請として受け付けます。${appendPolicyText}`;
  }

  function readSavedPassword() {
    return window.BmsPostPreferences?.getStoredPassword?.() || "";
  }

  function setMessage(text, kind = "error") {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = !text;
  }

  function setSubmitting(submitting) {
    state.submitting = submitting;
    passwordInput.disabled = submitting;
    reasonInput.disabled = submitting || state.deleteRequested || state.hidden;
    withdrawConfirm.disabled = submitting || state.withdrawn || state.hidden;
    withdrawButton.disabled = submitting || state.withdrawn || state.hidden;
    deleteRequestButton.disabled = submitting || state.deleteRequested || state.hidden;
    closeButtons.forEach((button) => {
      button.disabled = submitting;
    });
    dialog.classList.toggle("is-submitting", submitting);
  }

  function describeState() {
    const values = [];
    if (state.withdrawn) {
      values.push("取り下げ済み");
    }
    if (state.deleteRequested) {
      values.push("削除申請中");
    }
    if (state.hidden) {
      values.push("非表示");
    }
    return values.length > 0 ? values.join(" / ") : "公開中";
  }

  function deleteActionLabel() {
    if (state.deleteRequested) {
      return "削除申請中";
    }

    return state.within24Hours && !state.hasDescendants ? "削除する" : "削除を申請";
  }

  function openDialog(button) {
    state.versionId = button.dataset.versionId || "";
    state.chartId = button.dataset.chartId || "";
    state.versionLabel = button.dataset.versionLabel || "-";
    state.author = button.dataset.author || "未入力";
    state.createdAt = parseApiDate(button.dataset.createdAt);
    state.within24Hours = button.dataset.within24Hours === "true";
    state.hasDescendants = button.dataset.hasDescendants === "true";
    state.withdrawn = button.dataset.withdrawn === "true";
    state.deleteRequested = button.dataset.deleteRequested === "true";
    state.allowAppend = button.dataset.allowAppend !== "false";
    state.hidden = false;

    title.textContent = `投稿管理: ${state.versionLabel}`;
    versionValue.textContent = state.versionLabel;
    authorValue.textContent = state.author;
    stateValue.textContent = describeState();
    updateLifecyclePreview();
    passwordInput.value = readSavedPassword();
    reasonInput.value = "";
    withdrawConfirm.checked = false;
    setMessage("");
    setSubmitting(false);

    withdrawButton.textContent = state.withdrawn ? "取り下げ済み" : "取り下げる";
    deleteRequestButton.textContent = deleteActionLabel();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    window.setTimeout(() => passwordInput.focus(), 0);
  }

  function closeDialog() {
    if (state.submitting) {
      return;
    }
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function buildOutcomeMessage(body, action) {
    const outcome = body?.outcome;
    const appendPolicyText = state.allowAppend
      ? "この版からの追記受付は継続します。"
      : "この版からの新しい追記は停止されています。";
    if (outcome === "immediate_hidden") {
      return "投稿から24時間以内で公開中の追記版がないため、一覧から取り下げました。譜面ファイルと進捗画像はすぐには整理されません。";
    }

    if (outcome === "download_blocked") {
      return body?.hasDescendants
        ? `派生版があるため非表示にはせず、DLのみ停止しました。${appendPolicyText}`
        : `24時間を経過しているため、DLのみ停止しました。${appendPolicyText}`;
    }

    if (outcome === "delete_requested") {
      return `削除申請として受け付けました。DLを停止し、後日管理確認後に処理されます。${appendPolicyText}`;
    }

    return action === "withdraw" ? "取り下げを受け付けました。" : "削除申請を受け付けました。";
  }

  async function requestLifecycle(action) {
    const password = passwordInput.value.trim();
    if (!password) {
      setMessage("管理パスワードを入力してください。");
      passwordInput.focus();
      return;
    }

    if (action === "withdraw" && !withdrawConfirm.checked) {
      setMessage("取り下げ内容を確認し、確認欄にチェックしてください。");
      withdrawConfirm.focus();
      return;
    }

    const reason = reasonInput.value.trim();
    if (reason.length > reasonMaxLength) {
      setMessage(`削除申請理由は${reasonMaxLength}文字以内で入力してください。`);
      reasonInput.focus();
      return;
    }

    setMessage("");
    setSubmitting(true);
    const path = `/api/versions/${encodeURIComponent(state.versionId)}/${action === "withdraw" ? "withdraw" : "delete-request"}`;

    try {
      const response = await fetch(new URL(path, apiBaseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "withdraw" ? { password } : { password, reason })
      });
      const responseText = await response.text();
      let body = null;
      try {
        body = responseText ? JSON.parse(responseText) : null;
      } catch {
        body = null;
      }

      if (!response.ok) {
        throw body || {
          code: "REQUEST_FAILED",
          message: "管理操作に失敗しました。",
          detail: `HTTP status ${response.status}`
        };
      }

      state.within24Hours = body?.within24Hours === true;
      state.hasDescendants = body?.hasDescendants === true;
      if (body?.outcome === "immediate_hidden") {
        state.hidden = true;
      } else if (action === "withdraw") {
        state.withdrawn = true;
      } else if (body?.outcome === "delete_requested") {
        state.deleteRequested = true;
      }
      stateValue.textContent = describeState();
      withdrawButton.textContent = state.withdrawn ? "取り下げ済み" : "取り下げる";
      deleteRequestButton.textContent = deleteActionLabel();
      const outcomeMessage = buildOutcomeMessage(body, action);
      setMessage(outcomeMessage, "success");
      setSubmitting(false);

      const refreshFailures = [];
      try {
        const detailResult = await window.BmsChartDetail?.refreshAfterManagement?.({
          chartId: state.chartId,
          versionId: state.versionId,
          outcome: body?.outcome || ""
        });
        if (detailResult === false) {
          refreshFailures.push("selected-detail");
        }
      } catch (refreshError) {
        refreshFailures.push("selected-detail");
        console.warn("[version-management-refresh] selected detail refresh failed", {
          code: "SELECTED_DETAIL_REFRESH_FAILED",
          chartId: state.chartId,
          versionId: state.versionId,
          errorType: refreshError instanceof Error ? refreshError.name : typeof refreshError
        });
      }

      try {
        if (typeof loadCharts === "function") {
          const listResult = await loadCharts({
            selectedChartId: window.BmsChartDetail?.getSelection?.().chartId || ""
          });
          if (!listResult) {
            refreshFailures.push("recent-list");
          }
        }
      } catch (refreshError) {
        refreshFailures.push("recent-list");
        console.warn("[version-management-refresh] recent list refresh failed", {
          code: "RECENT_LIST_REFRESH_FAILED",
          chartId: state.chartId,
          versionId: state.versionId,
          errorType: refreshError instanceof Error ? refreshError.name : typeof refreshError
        });
      }

      if (refreshFailures.length > 0) {
        setMessage(`${outcomeMessage}\n操作は完了しましたが、表示の更新に失敗しました。ページを再読み込みしてください。`, "success");
      }
      return;
    } catch (error) {
      const code = error?.code || "REQUEST_FAILED";
      const errorMessage = error?.message || "管理操作に失敗しました。";
      const detail = error?.detail || "通信状況を確認してください。";
      console.error("[version-management] lifecycle request failed", {
        code,
        versionId: state.versionId,
        action,
        detail
      });
      setMessage(`${errorMessage}\ncode: ${code}\n${detail}`);
      setSubmitting(false);
    }
  }

  chartInteractionRoot.addEventListener("click", (event) => {
    const button = event.target.closest(".version-management-button");
    if (!button) {
      return;
    }
    event.preventDefault();
    openDialog(button);
  });

  withdrawButton.addEventListener("click", () => requestLifecycle("withdraw"));
  deleteRequestButton.addEventListener("click", () => requestLifecycle("delete-request"));
  closeButtons.forEach((button) => button.addEventListener("click", closeDialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDialog();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (state.submitting) {
      event.preventDefault();
    }
  });
  form.addEventListener("submit", (event) => event.preventDefault());
})();
