"use strict";

(() => {
  const pageSize = 50;
  const elements = {
    filters: document.querySelector("#adminVersionStatusFilters"),
    query: document.querySelector("#adminVersionStatusQuery"),
    suspiciousOnly: document.querySelector("#adminVersionStatusSuspiciousOnly"),
    stateFilter: document.querySelector("#adminVersionStatusState"),
    refresh: document.querySelector("#adminVersionStatusRefresh"),
    message: document.querySelector("#adminVersionStatusMessage"),
    list: document.querySelector("#adminVersionStatusList"),
    previous: document.querySelector("#adminVersionStatusPrevious"),
    next: document.querySelector("#adminVersionStatusNext"),
    page: document.querySelector("#adminVersionStatusPage"),
    dialog: document.querySelector("#adminVersionStatusDialog"),
    form: document.querySelector("#adminVersionStatusForm"),
    song: document.querySelector("#adminVersionStatusSong"),
    chart: document.querySelector("#adminVersionStatusChart"),
    version: document.querySelector("#adminVersionStatusVersion"),
    author: document.querySelector("#adminVersionStatusAuthor"),
    current: document.querySelector("#adminVersionStatusCurrent"),
    currentProgress: document.querySelector("#adminVersionStatusCurrentProgress"),
    mapProgress: document.querySelector("#adminVersionStatusMapProgress"),
    children: document.querySelector("#adminVersionStatusChildren"),
    currentAppend: document.querySelector("#adminVersionStatusCurrentAppend"),
    progress: document.querySelector("#adminVersionStatusProgress"),
    allowAppend: document.querySelector("#adminVersionStatusAllowAppend"),
    reason: document.querySelector("#adminVersionStatusReason"),
    warning: document.querySelector("#adminVersionStatusWarning"),
    before: document.querySelector("#adminVersionStatusBefore"),
    after: document.querySelector("#adminVersionStatusAfter"),
    dialogMessage: document.querySelector("#adminVersionStatusDialogMessage"),
    submit: document.querySelector("#adminVersionStatusSubmit")
  };

  if (Object.values(elements).some((element) => !element)) return;

  const state = {
    authenticated: false,
    loading: false,
    submitting: false,
    page: 1,
    total: 0,
    items: [],
    selected: null,
    returnFocus: null
  };

  const stateLabels = {
    incomplete: "制作途中",
    completed: "完成版",
    rejected_completed: "完成済み没譜面"
  };
  const reasonLabels = {
    REJECTED_WITH_INCOMPLETE_PROGRESS_MAP: "没譜面ですが、進捗マップが未完成の可能性があります。",
    INCOMPLETE_WITH_FULL_PROGRESS: "制作途中扱いですが、進捗が100%です。",
    COMPLETED_WITH_NON_FULL_PROGRESS: "完成版ですが、進捗が100%ではありません。",
    REJECTED_WITH_COMPLETED_AT: "完成版と没譜面の内部状態が重複しています。",
    REJECTED_WITH_NON_FULL_PROGRESS: "没譜面ですが、進捗が100%ではありません。",
    PROGRESS_MAP_MISMATCH: "保存進捗と進捗マップが一致していません。"
  };

  function create(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setMessage(message, kind = "error") {
    elements.message.textContent = message;
    elements.message.dataset.kind = kind;
    elements.message.hidden = !message;
  }

  function setDialogMessage(message) {
    elements.dialogMessage.textContent = message;
    elements.dialogMessage.hidden = !message;
  }

  function apiErrorMessage(error) {
    return [error?.message, error?.code, error?.detail].filter(Boolean).join("\n") || "管理APIの呼び出しに失敗しました。";
  }

  function setLoading(loading) {
    state.loading = loading;
    const pages = Math.max(1, Math.ceil(state.total / pageSize));
    elements.refresh.disabled = loading || !state.authenticated;
    elements.previous.disabled = loading || state.page <= 1;
    elements.next.disabled = loading || state.page >= pages;
    elements.filters.querySelectorAll("input, select, button").forEach((control) => {
      control.disabled = loading || !state.authenticated;
    });
    elements.list.classList.toggle("is-loading", loading);
  }

  function formatDate(value) {
    const source = String(value || "");
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(date)
      : "不明";
  }

  function renderItems() {
    elements.list.replaceChildren();
    if (state.items.length === 0) {
      elements.list.append(create("p", "admin-empty", "該当するversionはありません。"));
    }
    for (const item of state.items) {
      const row = create("article", "admin-version-status-row");
      const identity = create("div");
      identity.append(
        create("h3", "", item.songTitle || "曲名なし"),
        create("p", "", `${item.artist || "アーティスト不明"} / ${item.chartName || "差分名なし"}`),
        create("p", "admin-hash", `${item.versionLabel} / ${item.versionId}`),
        create("p", "", `${item.author || "作者不明"} / ${formatDate(item.createdAt)}`)
      );

      const status = create("div", "admin-version-status-meta");
      status.append(
        create("strong", "", stateLabels[item.currentState] || item.currentState),
        create("span", "", `progress: ${item.progress}%`),
        create("span", "", `マップ: ${item.mapProgressAvailable ? `${item.mapProgress}%` : "判定不可"}`),
        create("span", "", `追記受付: ${item.allowAppend ? "ON" : "OFF"}`),
        create("span", "", `公開状態: ${item.lifecycleStatus}`),
        create("span", "", `parent: ${item.parentVersionId ? "あり" : "なし"} / child: ${item.childVersionCount}`)
      );

      const review = create("div");
      const reasons = create("ul", "admin-version-status-reasons");
      if (!item.mapProgressAvailable) {
        reasons.append(create("li", "", "進捗マップ判定不可"));
      }
      for (const reason of item.suspiciousReasons || []) {
        reasons.append(create("li", "", reasonLabels[reason] || reason));
      }
      if (reasons.childElementCount === 0) reasons.append(create("li", "", "要確認理由なし"));
      review.append(reasons);

      const action = create("div", "admin-version-status-action");
      const button = create("button", "", "状態を修正");
      button.type = "button";
      button.disabled = !item.canCorrect;
      if (!item.canCorrect) button.title = "現在の公開状態では修正できません。";
      button.addEventListener("click", () => openDialog(item, button));
      action.append(button);
      row.append(identity, status, review, action);
      elements.list.append(row);
    }
    const pages = Math.max(1, Math.ceil(state.total / pageSize));
    elements.page.textContent = `${state.page} / ${pages}`;
    setLoading(false);
  }

  async function loadItems() {
    if (!state.authenticated || typeof window.adminApiRequest !== "function") return;
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams({
      q: elements.query.value.trim(),
      suspiciousOnly: String(elements.suspiciousOnly.checked),
      state: elements.stateFilter.value,
      page: String(state.page),
      pageSize: String(pageSize)
    });
    try {
      const body = await window.adminApiRequest(`/api/admin/versions/status-review?${params}`);
      state.items = Array.isArray(body?.items) ? body.items : [];
      state.total = Number(body?.total || 0);
      renderItems();
    } catch (error) {
      state.items = [];
      state.total = 0;
      renderItems();
      setMessage(apiErrorMessage(error));
    }
  }

  function selectedTarget() {
    return elements.form.querySelector('input[name="adminVersionStatusTarget"]:checked')?.value || "incomplete";
  }

  function previewText(target, progress, allowAppend) {
    return `${stateLabels[target] || target} / progress ${progress === "" ? "未入力" : progress}% / 追記${allowAppend ? "可" : "不可"}`;
  }

  function updateDialogControls({ resetProgress = false } = {}) {
    const item = state.selected;
    if (!item) return;
    const target = selectedTarget();
    if (target === "incomplete") {
      elements.progress.min = "0";
      elements.progress.max = "99";
      elements.progress.disabled = false;
      elements.allowAppend.checked = true;
      elements.allowAppend.disabled = true;
      if (resetProgress) {
        if (item.mapProgressAvailable && item.mapProgress < 100) {
          elements.progress.value = String(item.mapProgress);
        } else if (item.progress < 100) {
          elements.progress.value = String(Math.max(0, item.progress));
        } else {
          elements.progress.value = "";
        }
      }
    } else {
      elements.progress.min = "100";
      elements.progress.max = "100";
      elements.progress.value = "100";
      elements.progress.disabled = true;
      elements.allowAppend.disabled = false;
      if (resetProgress) elements.allowAppend.checked = item.allowAppend;
    }
    const progress = elements.progress.value;
    const difference = item.mapProgressAvailable && progress !== ""
      ? Math.abs(Number(progress) - Number(item.mapProgress))
      : 0;
    elements.warning.textContent = difference >= 10
      ? "管理者入力と進捗マップの算出値が大きく異なります。内容を確認してください。"
      : "";
    elements.warning.hidden = !elements.warning.textContent;
    elements.before.textContent = previewText(item.currentState, item.progress, item.allowAppend);
    elements.after.textContent = previewText(target, progress, elements.allowAppend.checked);
  }

  function openDialog(item, button) {
    state.selected = item;
    state.returnFocus = button;
    elements.song.textContent = item.songTitle || "不明";
    elements.chart.textContent = item.chartName || "不明";
    elements.version.textContent = `${item.versionLabel} / ${item.versionId}`;
    elements.author.textContent = item.author || "不明";
    elements.current.textContent = stateLabels[item.currentState] || item.currentState;
    elements.currentProgress.textContent = `${item.progress}%`;
    elements.mapProgress.textContent = item.mapProgressAvailable ? `${item.mapProgress}%` : "判定不可";
    elements.children.textContent = String(item.childVersionCount);
    elements.currentAppend.textContent = item.allowAppend ? "ON" : "OFF";
    const target = elements.form.querySelector(`input[name="adminVersionStatusTarget"][value="${item.currentState}"]`)
      || elements.form.querySelector('input[name="adminVersionStatusTarget"]');
    target.checked = true;
    elements.reason.value = "";
    setDialogMessage("");
    updateDialogControls({ resetProgress: true });
    elements.dialog.showModal();
    target.focus();
  }

  function closeDialog() {
    if (state.submitting) return;
    elements.dialog.close();
    state.returnFocus?.focus();
    state.selected = null;
  }

  async function submitStatus(event) {
    event.preventDefault();
    if (state.submitting || !state.selected) return;
    const targetState = selectedTarget();
    const progress = targetState === "incomplete" ? Number(elements.progress.value) : 100;
    const reason = elements.reason.value.trim();
    if (!Number.isInteger(progress) || progress < 0 || progress > (targetState === "incomplete" ? 99 : 100)) {
      setDialogMessage("progressを正しく入力してください。");
      return;
    }
    if ([...reason].length < 5 || [...reason].length > 500) {
      setDialogMessage("修正理由は5～500文字で入力してください。");
      return;
    }
    state.submitting = true;
    elements.submit.disabled = true;
    setDialogMessage("");
    try {
      await window.adminApiRequest(`/api/admin/versions/${encodeURIComponent(state.selected.versionId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          targetState,
          progress,
          allowAppend: targetState === "incomplete" ? true : elements.allowAppend.checked,
          reason,
          expectedUpdatedAt: state.selected.updatedAt
        })
      });
      state.submitting = false;
      elements.submit.disabled = false;
      closeDialog();
      setMessage("投稿状態を修正しました。", "success");
      await loadItems();
    } catch (error) {
      state.submitting = false;
      elements.submit.disabled = false;
      setDialogMessage(apiErrorMessage(error));
    }
  }

  window.addEventListener("admin-authenticated", () => {
    state.authenticated = true;
    state.page = 1;
    loadItems();
  });
  elements.filters.addEventListener("submit", (event) => {
    event.preventDefault();
    state.page = 1;
    loadItems();
  });
  elements.refresh.addEventListener("click", loadItems);
  elements.previous.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadItems();
    }
  });
  elements.next.addEventListener("click", () => {
    if (state.page < Math.ceil(state.total / pageSize)) {
      state.page += 1;
      loadItems();
    }
  });
  elements.form.querySelectorAll('input[name="adminVersionStatusTarget"]').forEach((input) => {
    input.addEventListener("change", () => updateDialogControls({ resetProgress: true }));
  });
  elements.progress.addEventListener("input", () => updateDialogControls());
  elements.allowAppend.addEventListener("change", () => updateDialogControls());
  elements.form.addEventListener("submit", submitStatus);
  document.querySelectorAll("[data-version-status-close]").forEach((button) => {
    button.addEventListener("click", closeDialog);
  });
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeDialog();
  });
  elements.dialog.addEventListener("cancel", (event) => {
    if (state.submitting) event.preventDefault();
  });

  setLoading(false);
})();
