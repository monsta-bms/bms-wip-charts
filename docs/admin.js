(() => {
  const apiBaseUrl = window.API_BASE_URL || "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const pageSize = 50;
  const authForm = document.querySelector("#adminAuthForm");
  const tokenInput = document.querySelector("#adminToken");
  const refreshButton = document.querySelector("#adminRefreshButton");
  const statusElement = document.querySelector("#adminStatus");
  const summaryElement = document.querySelector("#adminQueueSummary");
  const listElement = document.querySelector("#adminRequestList");
  const previousButton = document.querySelector("#adminPreviousPage");
  const nextButton = document.querySelector("#adminNextPage");
  const pageStatus = document.querySelector("#adminPageStatus");
  const dialog = document.querySelector("#adminDecisionDialog");
  const decisionForm = document.querySelector("#adminDecisionForm");
  const decisionType = document.querySelector("#adminDecisionType");
  const decisionTitle = document.querySelector("#adminDecisionTitle");
  const decisionSong = document.querySelector("#adminDecisionSong");
  const decisionChart = document.querySelector("#adminDecisionChart");
  const decisionVersion = document.querySelector("#adminDecisionVersion");
  const decisionChildren = document.querySelector("#adminDecisionChildren");
  const decisionNote = document.querySelector("#adminDecisionNote");
  const decisionHint = document.querySelector("#adminDecisionHint");
  const decisionMessage = document.querySelector("#adminDecisionMessage");
  const decisionSubmit = document.querySelector("#adminDecisionSubmit");
  const closeButtons = Array.from(document.querySelectorAll("[data-admin-dialog-close]"));

  if (!authForm || !tokenInput || !listElement || !dialog || !decisionForm) {
    return;
  }

  const state = {
    token: "",
    page: 1,
    total: 0,
    items: [],
    selected: null,
    decision: null,
    loading: false
  };

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function parseApiDate(value) {
    const source = String(value || "").trim();
    if (!source) {
      return null;
    }
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatDateTime(value) {
    const date = parseApiDate(value);
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

  function setStatus(message, kind = "error") {
    statusElement.textContent = message;
    statusElement.dataset.kind = kind;
    statusElement.hidden = !message;
  }

  function setLoading(loading) {
    state.loading = loading;
    tokenInput.disabled = loading;
    refreshButton.disabled = loading || !state.token;
    previousButton.disabled = loading || state.page <= 1;
    const pageCount = Math.max(1, Math.ceil(state.total / pageSize));
    nextButton.disabled = loading || state.page >= pageCount;
    listElement.classList.toggle("is-loading", loading);
  }

  async function requestJson(path, options = {}) {
    const response = await fetch(new URL(path, apiBaseUrl).toString(), {
      ...options,
      headers: {
        Authorization: `Bearer ${state.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
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
        message: "管理APIの呼び出しに失敗しました。",
        detail: `HTTP status ${response.status}`
      };
    }
    return body;
  }

  function addState(container, label, kind = "") {
    const badge = createElement("span", `admin-state${kind ? ` ${kind}` : ""}`, label);
    container.append(badge);
  }

  function buildRequestRow(item) {
    const row = createElement("article", "admin-request-row");
    const visibleChildVersionCount = Number(
      item.visibleChildVersionCount ?? item.childVersionCount ?? 0
    );
    const totalChildVersionCount = Number(
      item.totalChildVersionCount ?? visibleChildVersionCount
    );
    if (!item.canApprove) {
      row.classList.add("is-blocked");
    }

    const requestCell = createElement("div", "admin-cell");
    requestCell.append(
      createElement("p", "admin-primary", formatDateTime(item.createdAt)),
      createElement("p", "admin-secondary", `申請ID: ${item.requestId}`)
    );
    const message = createElement("p", "admin-message", item.message || "理由なし");
    message.title = item.message || "理由なし";
    requestCell.append(message);

    const versionCell = createElement("div", "admin-cell");
    versionCell.append(
      createElement("p", "admin-primary", `${item.songTitle} / ${item.chartName}`),
      createElement("p", "admin-secondary", `版 ${item.versionLabel} · ${item.author} · progress ${item.progress}%`),
      createElement("p", "admin-secondary", `version作成: ${formatDateTime(item.versionCreatedAt)}`)
    );

    const stateCell = createElement("div", "admin-cell");
    const stateList = createElement("p", "admin-state-list");
    addState(
      stateList,
      `公開中の子 ${visibleChildVersionCount}`,
      visibleChildVersionCount > 0 ? "is-warning" : ""
    );
    addState(stateList, `履歴上の子 ${totalChildVersionCount}`);
    if (item.isHidden) {
      addState(stateList, "非表示済み", "is-hidden");
    }
    if (item.withdrawn) {
      addState(stateList, "取り消し済み");
    }
    if (item.downloadBlocked) {
      addState(stateList, "DL不可");
    }
    stateCell.append(stateList);
    if (item.downloadBlockReason) {
      stateCell.append(createElement("p", "admin-secondary", `理由: ${item.downloadBlockReason}`));
    }

    const actionCell = createElement("div", "admin-actions");
    const approveButton = createElement("button", "admin-approve-button", "承認");
    approveButton.type = "button";
    approveButton.disabled = !item.canApprove;
    approveButton.title = item.canApprove
      ? "削除申請を承認してversionを論理非表示にする"
      : "派生versionがあるため承認できません";
    approveButton.addEventListener("click", () => openDecision(item, "approve"));
    const rejectButton = createElement("button", "admin-reject-button", "却下");
    rejectButton.type = "button";
    rejectButton.addEventListener("click", () => openDecision(item, "reject"));
    actionCell.append(approveButton, rejectButton);

    row.append(requestCell, versionCell, stateCell, actionCell);
    return row;
  }

  function renderList() {
    listElement.replaceChildren();
    if (state.items.length === 0) {
      listElement.append(createElement("p", "admin-empty", "pending削除申請はありません。"));
    } else {
      state.items.forEach((item) => listElement.append(buildRequestRow(item)));
    }
    const pageCount = Math.max(1, Math.ceil(state.total / pageSize));
    summaryElement.textContent = `${state.total}件 · 古い申請から表示`;
    pageStatus.textContent = `${state.page} / ${pageCount}`;
    previousButton.disabled = state.loading || state.page <= 1;
    nextButton.disabled = state.loading || state.page >= pageCount;
  }

  async function loadRequests() {
    if (!state.token) {
      setStatus("ADMIN_TOKENを入力してください。", "error");
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const body = await requestJson(
        `/api/admin/delete-requests?status=pending&page=${state.page}&pageSize=${pageSize}`
      );
      state.items = Array.isArray(body?.items) ? body.items : [];
      state.total = Number(body?.total || 0);
      renderList();
      setStatus(`pending削除申請を${state.items.length}件読み込みました。`, "success");
    } catch (error) {
      const code = error?.code || "REQUEST_FAILED";
      const message = error?.message || "削除申請一覧の取得に失敗しました。";
      const detail = error?.detail || "通信状態を確認してください。";
      setStatus(`${message}\ncode: ${code}\n${detail}`, "error");
      if (code === "ADMIN_AUTH_REQUIRED") {
        state.token = "";
      }
    } finally {
      setLoading(false);
    }
  }

  function openDecision(item, decision) {
    if (decision === "approve" && !item.canApprove) {
      setStatus("派生versionがある申請は承認できません。却下は可能です。", "error");
      return;
    }
    state.selected = item;
    state.decision = decision;
    dialog.classList.toggle("is-rejecting", decision === "reject");
    decisionType.textContent = decision === "approve" ? "APPROVE" : "REJECT";
    decisionTitle.textContent = decision === "approve" ? "削除申請を承認" : "削除申請を却下";
    decisionSong.textContent = item.songTitle;
    decisionChart.textContent = item.chartName;
    decisionVersion.textContent = `${item.versionLabel} / ${item.versionId}`;
    const visibleChildVersionCount = Number(
      item.visibleChildVersionCount ?? item.childVersionCount ?? 0
    );
    const totalChildVersionCount = Number(
      item.totalChildVersionCount ?? visibleChildVersionCount
    );
    decisionChildren.textContent = `公開中 ${visibleChildVersionCount}件 / 履歴上 ${totalChildVersionCount}件`;
    decisionNote.value = "";
    decisionNote.required = decision === "reject";
    decisionHint.textContent = decision === "approve"
      ? "承認するとversionを論理非表示にします。R2ファイルと進捗画像は削除しません。"
      : "却下理由の管理メモは必須です。delete_requested由来のDL制限だけを解除します。";
    decisionSubmit.textContent = decision === "approve" ? "承認する" : "却下する";
    decisionMessage.textContent = "";
    decisionMessage.hidden = true;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    window.setTimeout(() => decisionNote.focus(), 0);
  }

  function closeDecision() {
    if (decisionSubmit.disabled) {
      return;
    }
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    state.selected = null;
    state.decision = null;
  }

  async function submitDecision(event) {
    event.preventDefault();
    if (!state.selected || !state.decision) {
      return;
    }
    const adminNote = decisionNote.value.trim();
    if (state.decision === "reject" && !adminNote) {
      decisionMessage.textContent = "却下時は管理メモを入力してください。";
      decisionMessage.hidden = false;
      decisionNote.focus();
      return;
    }

    decisionSubmit.disabled = true;
    closeButtons.forEach((button) => { button.disabled = true; });
    decisionMessage.hidden = true;
    try {
      const body = await requestJson(
        `/api/admin/delete-requests/${encodeURIComponent(state.selected.requestId)}/${state.decision}`,
        { method: "POST", body: JSON.stringify({ adminNote }) }
      );
      const actionLabel = state.decision === "approve" ? "承認" : "却下";
      closeButtons.forEach((button) => { button.disabled = false; });
      decisionSubmit.disabled = false;
      closeDecision();
      await loadRequests();
      setStatus(
        `${actionLabel}しました。requestId: ${body.requestId}\noutcome: ${body.outcome}`,
        "success"
      );
    } catch (error) {
      const code = error?.code || "REQUEST_FAILED";
      decisionMessage.textContent = `${error?.message || "処理に失敗しました。"}\ncode: ${code}\n${error?.detail || ""}`;
      decisionMessage.hidden = false;
      if (code === "DELETE_REQUEST_HAS_DESCENDANTS" && state.selected) {
        state.selected.canApprove = false;
      }
    } finally {
      closeButtons.forEach((button) => { button.disabled = false; });
      decisionSubmit.disabled = false;
    }
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.token = tokenInput.value.trim();
    tokenInput.value = "";
    state.page = 1;
    await loadRequests();
  });
  refreshButton.addEventListener("click", loadRequests);
  previousButton.addEventListener("click", async () => {
    if (state.page > 1) {
      state.page -= 1;
      await loadRequests();
    }
  });
  nextButton.addEventListener("click", async () => {
    const pageCount = Math.max(1, Math.ceil(state.total / pageSize));
    if (state.page < pageCount) {
      state.page += 1;
      await loadRequests();
    }
  });
  decisionForm.addEventListener("submit", submitDecision);
  closeButtons.forEach((button) => button.addEventListener("click", closeDecision));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeDecision();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (decisionSubmit.disabled) {
      event.preventDefault();
    }
  });
})();
