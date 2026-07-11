(() => {
  const pageSize = 50;
  const logList = document.querySelector("#adminBanLogList");
  const logSummary = document.querySelector("#adminBanLogsSummary");
  const logRefresh = document.querySelector("#adminBanLogsRefresh");
  const logPrevious = document.querySelector("#adminBanLogsPrevious");
  const logNext = document.querySelector("#adminBanLogsNext");
  const logPageStatus = document.querySelector("#adminBanLogsPageStatus");
  const banList = document.querySelector("#adminBanList");
  const banSummary = document.querySelector("#adminBansSummary");
  const banRefresh = document.querySelector("#adminBansRefresh");
  const banPrevious = document.querySelector("#adminBansPrevious");
  const banNext = document.querySelector("#adminBansNext");
  const banPageStatus = document.querySelector("#adminBansPageStatus");
  const banState = document.querySelector("#adminBanState");
  const createDialog = document.querySelector("#adminBanCreateDialog");
  const createForm = document.querySelector("#adminBanCreateForm");
  const createSource = document.querySelector("#adminBanSourceLog");
  const createTarget = document.querySelector("#adminBanTarget");
  const createHash = document.querySelector("#adminBanHashShort");
  const createWarning = document.querySelector("#adminBanTargetWarning");
  const createReason = document.querySelector("#adminBanReason");
  const createDuration = document.querySelector("#adminBanDuration");
  const createMessage = document.querySelector("#adminBanCreateMessage");
  const createSubmit = document.querySelector("#adminBanCreateSubmit");
  const liftDialog = document.querySelector("#adminBanLiftDialog");
  const liftForm = document.querySelector("#adminBanLiftForm");
  const liftTarget = document.querySelector("#adminBanLiftTarget");
  const liftNote = document.querySelector("#adminBanLiftNote");
  const liftMessage = document.querySelector("#adminBanLiftMessage");
  const liftSubmit = document.querySelector("#adminBanLiftSubmit");
  const createCloseButtons = Array.from(document.querySelectorAll("[data-ban-create-close]"));
  const liftCloseButtons = Array.from(document.querySelectorAll("[data-ban-lift-close]"));

  if (!logList || !banList || !createDialog || !liftDialog) {
    return;
  }

  const state = {
    logPage: 1,
    logTotal: 0,
    banPage: 1,
    banTotal: 0,
    authenticated: false,
    selectedLog: null,
    selectedTargetType: null,
    selectedBan: null,
    loadingLogs: false,
    loadingBans: false
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function request(path, options) {
    if (typeof window.adminApiRequest !== "function") {
      return Promise.reject({ code: "ADMIN_AUTH_REQUIRED", message: "ADMIN_TOKENで認証してください。" });
    }
    return window.adminApiRequest(path, options);
  }

  function formatDate(value) {
    const source = String(value || "").trim();
    if (!source) return "不明";
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    if (!Number.isFinite(date.getTime())) return source;
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

  function showDialog(dialog) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function setLogsLoading(value) {
    state.loadingLogs = value;
    logRefresh.disabled = value || !state.authenticated;
    const pages = Math.max(1, Math.ceil(state.logTotal / pageSize));
    logPrevious.disabled = value || state.logPage <= 1;
    logNext.disabled = value || state.logPage >= pages;
  }

  function setBansLoading(value) {
    state.loadingBans = value;
    banRefresh.disabled = value || !state.authenticated;
    banState.disabled = value;
    const pages = Math.max(1, Math.ceil(state.banTotal / pageSize));
    banPrevious.disabled = value || state.banPage <= 1;
    banNext.disabled = value || state.banPage >= pages;
  }

  function openCreateDialog(item, targetType) {
    state.selectedLog = item;
    state.selectedTargetType = targetType;
    createSource.textContent = item.postLogId;
    createTarget.textContent = targetType === "ip_hash" ? "IP hash" : "file SHA-256";
    createHash.textContent = targetType === "ip_hash" ? item.ipHashShort : item.fileSha256Short;
    createWarning.textContent = targetType === "ip_hash"
      ? "共有回線を利用する別ユーザーも投稿できなくなる可能性があります。"
      : "同じ内容のファイルだけを投稿禁止にします。";
    createReason.value = "";
    createDuration.value = "7d";
    createMessage.hidden = true;
    showDialog(createDialog);
    window.setTimeout(() => createReason.focus(), 0);
  }

  function buildLogRow(item) {
    const row = element("article", "admin-ban-log-row");
    const eventCell = element("div", "admin-cell");
    eventCell.append(
      element("p", "admin-primary", formatDate(item.createdAt)),
      element("p", "admin-secondary", `${item.action} / ${item.result}`),
      element("p", "admin-secondary", item.errorCode || "errorなし")
    );
    const targetCell = element("div", "admin-cell");
    targetCell.append(
      element("p", "admin-primary", item.versionId || item.chartId || "対象IDなし"),
      element("p", "admin-secondary", item.detailSummary || "")
    );
    const hashCell = element("div", "admin-cell admin-hash-list");
    hashCell.append(
      element("p", "admin-secondary", `IP: ${item.ipHashShort || "なし"}`),
      element("p", "admin-secondary", `UA: ${item.uaHashShort || "なし"}`),
      element("p", "admin-secondary", `file: ${item.fileSha256Short || "なし"}`)
    );
    const actionCell = element("div", "admin-ban-actions");
    const ipButton = element("button", "secondary-button", "IPをBAN");
    ipButton.type = "button";
    ipButton.disabled = !item.canBanIp;
    ipButton.title = item.canBanIp
      ? "この投稿ログのIP hashをBAN"
      : "IP hashがないか、unknown由来のためBANできません";
    ipButton.addEventListener("click", () => openCreateDialog(item, "ip_hash"));
    const fileButton = element("button", "secondary-button", "ファイルをBAN");
    fileButton.type = "button";
    fileButton.disabled = !item.hasFileSha256;
    fileButton.title = item.hasFileSha256
      ? "この投稿ログのfile SHA-256をBAN"
      : "file SHA-256が記録されていません";
    fileButton.addEventListener("click", () => openCreateDialog(item, "file_sha256"));
    actionCell.append(ipButton, fileButton);
    row.append(eventCell, targetCell, hashCell, actionCell);
    return row;
  }

  function renderLogs(items) {
    logList.replaceChildren();
    if (!items.length) logList.append(element("p", "admin-empty", "投稿ログはありません。"));
    else items.forEach((item) => logList.append(buildLogRow(item)));
    const pages = Math.max(1, Math.ceil(state.logTotal / pageSize));
    logSummary.textContent = `${state.logTotal}件。管理画面には短縮ハッシュだけを表示しています。`;
    logPageStatus.textContent = `${state.logPage} / ${pages}`;
    setLogsLoading(false);
  }

  async function loadLogs() {
    if (!state.authenticated) return;
    setLogsLoading(true);
    try {
      const body = await request(`/api/admin/post-logs?page=${state.logPage}&pageSize=${pageSize}`);
      state.logTotal = Number(body?.total || 0);
      renderLogs(Array.isArray(body?.items) ? body.items : []);
    } catch (error) {
      logList.replaceChildren(element("p", "admin-empty", `${error?.message || "投稿ログを取得できませんでした。"} (${error?.code || "REQUEST_FAILED"})`));
      setLogsLoading(false);
    }
  }

  function openLiftDialog(item) {
    state.selectedBan = item;
    liftTarget.textContent = `${item.banType} / ${item.banValueShort}`;
    liftNote.value = "";
    liftMessage.hidden = true;
    showDialog(liftDialog);
    window.setTimeout(() => liftNote.focus(), 0);
  }

  function buildBanRow(item) {
    const row = element("article", "admin-ban-row");
    const targetCell = element("div", "admin-cell");
    targetCell.append(
      element("p", "admin-primary", item.banType),
      element("p", "admin-secondary admin-hash", item.banValueShort)
    );
    const reasonCell = element("div", "admin-cell");
    reasonCell.append(
      element("p", "admin-primary", item.reason),
      element("p", "admin-secondary", `作成: ${formatDate(item.createdAt)}`),
      element("p", "admin-secondary", `期限: ${item.expiredAt ? formatDate(item.expiredAt) : "無期限"}`)
    );
    const stateCell = element("div", "admin-cell");
    stateCell.append(
      element("span", `admin-state is-ban-${item.state}`, item.state),
      element("p", "admin-secondary", item.disabledAt ? `解除: ${formatDate(item.disabledAt)}` : "")
    );
    const actionCell = element("div", "admin-ban-actions");
    const liftButton = element("button", "admin-ban-lift-button", "解除");
    liftButton.type = "button";
    liftButton.disabled = item.state === "disabled";
    liftButton.addEventListener("click", () => openLiftDialog(item));
    actionCell.append(liftButton);
    row.append(targetCell, reasonCell, stateCell, actionCell);
    return row;
  }

  function renderBans(items) {
    banList.replaceChildren();
    if (!items.length) banList.append(element("p", "admin-empty", "該当するBANはありません。"));
    else items.forEach((item) => banList.append(buildBanRow(item)));
    const pages = Math.max(1, Math.ceil(state.banTotal / pageSize));
    banSummary.textContent = `${banState.value}: ${state.banTotal}件`;
    banPageStatus.textContent = `${state.banPage} / ${pages}`;
    setBansLoading(false);
  }

  async function loadBans() {
    if (!state.authenticated) return;
    setBansLoading(true);
    try {
      const body = await request(`/api/admin/bans?state=${encodeURIComponent(banState.value)}&page=${state.banPage}&pageSize=${pageSize}`);
      state.banTotal = Number(body?.total || 0);
      renderBans(Array.isArray(body?.items) ? body.items : []);
    } catch (error) {
      banList.replaceChildren(element("p", "admin-empty", `${error?.message || "BAN一覧を取得できませんでした。"} (${error?.code || "REQUEST_FAILED"})`));
      setBansLoading(false);
    }
  }

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.selectedLog || !state.selectedTargetType) return;
    const reason = createReason.value.trim();
    if (!reason) {
      createMessage.textContent = "BAN理由を入力してください。";
      createMessage.hidden = false;
      return;
    }
    createSubmit.disabled = true;
    try {
      await request("/api/admin/bans", {
        method: "POST",
        body: JSON.stringify({
          sourcePostLogId: state.selectedLog.postLogId,
          targetType: state.selectedTargetType,
          reason,
          duration: createDuration.value
        })
      });
      closeDialog(createDialog);
      state.banPage = 1;
      await Promise.all([loadBans(), loadLogs()]);
    } catch (error) {
      createMessage.textContent = `${error?.message || "BANを作成できませんでした。"}\ncode: ${error?.code || "REQUEST_FAILED"}`;
      createMessage.hidden = false;
    } finally {
      createSubmit.disabled = false;
    }
  });

  liftForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.selectedBan) return;
    const adminNote = liftNote.value.trim();
    if (!adminNote) {
      liftMessage.textContent = "解除理由を入力してください。";
      liftMessage.hidden = false;
      return;
    }
    liftSubmit.disabled = true;
    try {
      await request(`/api/admin/bans/${encodeURIComponent(state.selectedBan.banId)}/lift`, {
        method: "POST",
        body: JSON.stringify({ adminNote })
      });
      closeDialog(liftDialog);
      await loadBans();
    } catch (error) {
      liftMessage.textContent = `${error?.message || "BANを解除できませんでした。"}\ncode: ${error?.code || "REQUEST_FAILED"}`;
      liftMessage.hidden = false;
    } finally {
      liftSubmit.disabled = false;
    }
  });

  createCloseButtons.forEach((button) => button.addEventListener("click", () => closeDialog(createDialog)));
  liftCloseButtons.forEach((button) => button.addEventListener("click", () => closeDialog(liftDialog)));
  logRefresh.addEventListener("click", loadLogs);
  banRefresh.addEventListener("click", loadBans);
  logPrevious.addEventListener("click", () => { if (state.logPage > 1) { state.logPage -= 1; loadLogs(); } });
  logNext.addEventListener("click", () => {
    if (state.logPage < Math.max(1, Math.ceil(state.logTotal / pageSize))) { state.logPage += 1; loadLogs(); }
  });
  banPrevious.addEventListener("click", () => { if (state.banPage > 1) { state.banPage -= 1; loadBans(); } });
  banNext.addEventListener("click", () => {
    if (state.banPage < Math.max(1, Math.ceil(state.banTotal / pageSize))) { state.banPage += 1; loadBans(); }
  });
  banState.addEventListener("change", () => { state.banPage = 1; loadBans(); });
  window.addEventListener("admin-authenticated", () => {
    state.authenticated = true;
    state.logPage = 1;
    state.banPage = 1;
    logRefresh.disabled = false;
    banRefresh.disabled = false;
    Promise.all([loadLogs(), loadBans()]);
  });
})();
