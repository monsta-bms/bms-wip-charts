(() => {
  const apiBaseUrl = window.API_BASE_URL || "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const passwordStorageKey = "bms-wip-charts-admin-password";
  const reasonMaxLength = 500;
  const chartList = document.querySelector("#chartList");
  const dialog = document.querySelector("#versionManagementDialog");

  if (!chartList || !dialog) {
    return;
  }

  const form = dialog.querySelector("#versionManagementForm");
  const title = dialog.querySelector("#versionManagementTitle");
  const versionValue = dialog.querySelector("#versionManagementVersion");
  const authorValue = dialog.querySelector("#versionManagementAuthor");
  const stateValue = dialog.querySelector("#versionManagementState");
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
    withdrawn: false,
    deleteRequested: false,
    submitting: false
  };

  function readSavedPassword() {
    try {
      return localStorage.getItem(passwordStorageKey) || "";
    } catch (error) {
      console.warn("[version-management-password] failed to read saved password", {
        message: error instanceof Error ? error.message : String(error)
      });
      return "";
    }
  }

  function setMessage(text, kind = "error") {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = !text;
  }

  function setSubmitting(submitting) {
    state.submitting = submitting;
    passwordInput.disabled = submitting;
    reasonInput.disabled = submitting || state.deleteRequested;
    withdrawConfirm.disabled = submitting || state.withdrawn;
    withdrawButton.disabled = submitting || state.withdrawn;
    deleteRequestButton.disabled = submitting || state.deleteRequested;
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
    return values.length > 0 ? values.join(" / ") : "公開中";
  }

  function openDialog(button) {
    state.versionId = button.dataset.versionId || "";
    state.chartId = button.dataset.chartId || "";
    state.versionLabel = button.dataset.versionLabel || "-";
    state.author = button.dataset.author || "未入力";
    state.withdrawn = button.dataset.withdrawn === "true";
    state.deleteRequested = button.dataset.deleteRequested === "true";

    title.textContent = `投稿管理: ${state.versionLabel}`;
    versionValue.textContent = state.versionLabel;
    authorValue.textContent = state.author;
    stateValue.textContent = describeState();
    passwordInput.value = readSavedPassword();
    reasonInput.value = "";
    withdrawConfirm.checked = false;
    setMessage("");
    setSubmitting(false);

    withdrawButton.textContent = state.withdrawn ? "取り下げ済み" : "取り下げる";
    deleteRequestButton.textContent = state.deleteRequested ? "削除申請中" : "削除を申請";
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

      setMessage(action === "withdraw" ? "取り下げました。" : "削除申請を受け付けました。", "success");
      if (typeof loadCharts === "function") {
        await loadCharts();
      }
      window.setTimeout(() => {
        setSubmitting(false);
        closeDialog();
      }, 500);
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

  chartList.addEventListener("click", (event) => {
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

