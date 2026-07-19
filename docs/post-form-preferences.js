(() => {
  "use strict";

  const AUTHOR_STORAGE_KEY = "bms-wip-charts:author:v1";
  const PASSWORD_STORAGE_KEY = "bms-wip-charts-admin-password";

  const authorInput = document.querySelector("#author");
  const saveAuthorInput = document.querySelector("#saveAuthor");
  const passwordInput = document.querySelector("#password");
  const savePasswordInput = document.querySelector("#savePassword");
  const clearButton = document.querySelector("#clearPostPreferences");
  const status = document.querySelector("#postPreferencesStatus");

  function errorType(error) {
    return error instanceof Error ? error.name : typeof error;
  }

  function logFailure(code, stage, error) {
    console.warn("[post-preferences] storage operation failed", {
      code,
      stage,
      errorType: errorType(error)
    });
  }

  function setStatus(message, { error = false } = {}) {
    if (!status) {
      return;
    }
    status.textContent = message || "";
    status.hidden = !message;
    status.classList.toggle("is-error", Boolean(message && error));
  }

  function readStored(key, stage) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch (error) {
      logFailure("POST_PREFERENCES_READ_FAILED", stage, error);
      return "";
    }
  }

  function writeStored(key, value, stage) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      logFailure("POST_PREFERENCES_WRITE_FAILED", stage, error);
      return false;
    }
  }

  function removeStored(key, stage) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      logFailure("POST_PREFERENCES_REMOVE_FAILED", stage, error);
      return false;
    }
  }

  function getStoredAuthor() {
    return readStored(AUTHOR_STORAGE_KEY, "read-author");
  }

  function getStoredPassword() {
    return readStored(PASSWORD_STORAGE_KEY, "read-password");
  }

  function markRestoredDefaults() {
    if (authorInput) {
      authorInput.defaultValue = authorInput.value;
    }
    if (passwordInput) {
      passwordInput.defaultValue = passwordInput.value;
    }
    if (saveAuthorInput) {
      saveAuthorInput.defaultChecked = saveAuthorInput.checked;
    }
    if (savePasswordInput) {
      savePasswordInput.defaultChecked = savePasswordInput.checked;
    }
  }

  function restore({ markDefaults = true } = {}) {
    const author = getStoredAuthor();
    const password = getStoredPassword();

    if (authorInput) {
      authorInput.value = author;
    }
    if (saveAuthorInput) {
      saveAuthorInput.checked = Boolean(author);
    }
    if (passwordInput) {
      passwordInput.value = password;
    }
    if (savePasswordInput) {
      savePasswordInput.checked = Boolean(password);
    }
    if (markDefaults) {
      markRestoredDefaults();
    }

    return { author, password };
  }

  function removeAuthor({ updateCheckbox = true } = {}) {
    const ok = removeStored(AUTHOR_STORAGE_KEY, "remove-author");
    if (updateCheckbox && saveAuthorInput) {
      saveAuthorInput.checked = false;
    }
    return ok;
  }

  function removePassword({ updateCheckbox = true } = {}) {
    const ok = removeStored(PASSWORD_STORAGE_KEY, "remove-password");
    if (updateCheckbox && savePasswordInput) {
      savePasswordInput.checked = false;
    }
    return ok;
  }

  function commitAfterSuccess(values = {}) {
    const author = String(values.author || "").trim();
    const password = String(values.password || "");
    let ok = true;

    if (values.saveAuthor && author) {
      ok = writeStored(AUTHOR_STORAGE_KEY, author, "commit-author-after-success") && ok;
    } else {
      ok = removeStored(AUTHOR_STORAGE_KEY, "commit-author-disabled") && ok;
    }

    if (values.savePassword && password) {
      ok = writeStored(PASSWORD_STORAGE_KEY, password, "commit-password-after-success") && ok;
    } else {
      ok = removeStored(PASSWORD_STORAGE_KEY, "commit-password-disabled") && ok;
    }

    if (!ok) {
      setStatus("投稿は完了しましたが、この端末への保存に失敗しました。", { error: true });
    } else {
      setStatus("");
    }

    return { ok };
  }

  function clearStored() {
    const authorRemoved = removeStored(AUTHOR_STORAGE_KEY, "clear-author");
    const passwordRemoved = removeStored(PASSWORD_STORAGE_KEY, "clear-password");
    if (saveAuthorInput) {
      saveAuthorInput.checked = false;
    }
    if (savePasswordInput) {
      savePasswordInput.checked = false;
    }

    const ok = authorRemoved && passwordRemoved;
    setStatus(
      ok
        ? "この端末の保存情報を削除しました。"
        : "この端末の保存情報を削除できませんでした。",
      { error: !ok }
    );
    window.BmsPostFormUi?.updateSummary?.();
    return { ok };
  }

  saveAuthorInput?.addEventListener("change", () => {
    if (!saveAuthorInput.checked) {
      removeAuthor({ updateCheckbox: false });
    }
    setStatus("");
    window.BmsPostFormUi?.updateSummary?.();
  });

  savePasswordInput?.addEventListener("change", () => {
    if (!savePasswordInput.checked) {
      removePassword({ updateCheckbox: false });
    }
    setStatus("");
    window.BmsPostFormUi?.updateSummary?.();
  });

  clearButton?.addEventListener("click", () => {
    const confirmed = window.confirm("この端末に保存した差分作者と管理パスワードを削除しますか？");
    if (confirmed) {
      clearStored();
    }
  });

  window.BmsPostPreferences = {
    clearStored,
    commitAfterSuccess,
    getStoredAuthor,
    getStoredPassword,
    markRestoredDefaults,
    removeAuthor,
    removePassword,
    restore,
    setStatus
  };

  restore();
})();
