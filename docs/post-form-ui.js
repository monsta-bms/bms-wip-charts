(() => {
  "use strict";

  const panel = document.querySelector(".submit-panel");
  const form = document.querySelector("#chartForm");
  const body = document.querySelector("#postFormBody");
  const toggle = document.querySelector("#postFormToggle");
  const summary = document.querySelector("#postFormDraftSummary");
  const fileInput = document.querySelector("#chartFile");
  const difficultyInput = document.querySelector("#difficulty");
  const authorInput = document.querySelector("#author");
  const passwordInput = document.querySelector("#password");
  const savePasswordInput = document.querySelector("#savePassword");
  const progressMap = document.querySelector("#progressMap");
  const errorBox = document.querySelector("#errorBox");

  if (!panel || !form || !body || !toggle || !summary) {
    return;
  }

  const passwordStorageKey = "bms-wip-charts-admin-password";
  let manuallyCollapsed = false;
  let lastFormActionAt = 0;

  function getStoredPassword() {
    try {
      return window.localStorage.getItem(passwordStorageKey) || "";
    } catch (_error) {
      return "";
    }
  }

  function isAppendMode() {
    return panel.classList.contains("is-append-mode");
  }

  function isControlChanged(control) {
    if (!control || control.disabled || !control.name) {
      return false;
    }

    if (control === savePasswordInput) {
      return false;
    }

    if (control === passwordInput) {
      const storedPassword = getStoredPassword();
      const isRestoredPassword = Boolean(
        storedPassword
        && savePasswordInput?.checked
        && control.value === storedPassword
      );
      return Boolean(control.value) && !isRestoredPassword;
    }

    if (control.type === "file") {
      return Boolean(control.files?.length);
    }

    if (control.type === "checkbox" || control.type === "radio") {
      return control.checked !== control.defaultChecked;
    }

    if (control.type === "button" || control.type === "submit" || control.type === "reset") {
      return false;
    }

    if (control.type === "hidden" && control !== difficultyInput) {
      return false;
    }

    const defaultValue = control.defaultValue ?? "";
    return control.value !== defaultValue;
  }

  function isDirty() {
    if (isAppendMode() || fileInput?.files?.length) {
      return true;
    }

    return Array.from(form.elements).some((control) => isControlChanged(control));
  }

  function updateSummary() {
    const items = [];
    const fileName = fileInput?.files?.[0]?.name?.trim();
    const difficulty = difficultyInput?.value?.trim();
    const author = authorInput?.value?.trim();

    if (fileName) {
      items.push(fileName);
    }
    if (difficulty) {
      items.push(`\u96e3\u6613\u5ea6 ${difficulty}`);
    }
    if (author) {
      items.push(`\u4f5c\u8005 ${author}`);
    }

    summary.textContent = items.length
      ? `\u7de8\u96c6\u4e2d: ${items.join(" / ")}`
      : (isDirty() ? "\u7de8\u96c6\u4e2d" : "");
    summary.hidden = !summary.textContent || !body.hidden;
  }

  function setOpen(open, { focusToggle = false } = {}) {
    const shouldOpen = Boolean(open) || isAppendMode();
    body.hidden = !shouldOpen;
    panel.classList.toggle("is-form-open", shouldOpen);
    toggle.setAttribute("aria-expanded", String(shouldOpen));
    toggle.textContent = shouldOpen
      ? "\u6295\u7a3f\u30d5\u30a9\u30fc\u30e0\u3092\u9589\u3058\u308b"
      : "\uff0b \u5dee\u5206\u3092\u6295\u7a3f\u3059\u308b";
    toggle.disabled = isAppendMode();
    toggle.title = isAppendMode() ? "\u8ffd\u8a18\u6295\u7a3f\u4e2d\u306f\u9589\u3058\u3089\u308c\u307e\u305b\u3093" : "";

    if (shouldOpen) {
      manuallyCollapsed = false;
    }
    updateSummary();

    if (focusToggle) {
      toggle.focus();
    }
  }

  function openAndReveal() {
    setOpen(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    });
  }

  toggle.addEventListener("click", () => {
    if (isAppendMode()) {
      setOpen(true);
      return;
    }

    if (body.hidden) {
      setOpen(true);
      return;
    }

    manuallyCollapsed = true;
    setOpen(false, { focusToggle: true });
  });

  fileInput?.addEventListener("change", () => {
    lastFormActionAt = fileInput.files?.length ? Date.now() : 0;
    manuallyCollapsed = false;
    setOpen(true);
    updateSummary();
  });

  form.addEventListener("input", updateSummary);
  form.addEventListener("change", updateSummary);
  form.addEventListener("submit", () => {
    lastFormActionAt = Date.now();
    setOpen(true);
  }, true);
  form.addEventListener("invalid", () => {
    lastFormActionAt = Date.now();
    setOpen(true);
  }, true);
  form.addEventListener("reset", () => {
    lastFormActionAt = 0;
    window.setTimeout(() => {
      manuallyCollapsed = false;
      setOpen(isAppendMode() || isDirty());
      updateSummary();
    }, 0);
  });

  const panelObserver = new MutationObserver(() => {
    if (isAppendMode()) {
      setOpen(true);
    } else {
      toggle.disabled = false;
      toggle.title = "";
      updateSummary();
    }
  });
  panelObserver.observe(panel, { attributes: true, attributeFilter: ["class"] });

  if (progressMap) {
    const progressObserver = new MutationObserver(() => {
      if (progressMap.dataset.state === "loading" && !manuallyCollapsed) {
        setOpen(true);
      }
    });
    progressObserver.observe(progressMap, { attributes: true, attributeFilter: ["data-state"] });
  }

  if (errorBox) {
    const errorObserver = new MutationObserver(() => {
      const followsFormAction = Date.now() - lastFormActionAt < 120000;
      if (!errorBox.hidden && (followsFormAction || isAppendMode())) {
        setOpen(true);
      }
    });
    errorObserver.observe(errorBox, { attributes: true, childList: true, subtree: true });
  }

  window.addEventListener("bms:open-post-form", openAndReveal);
  window.addEventListener("hashchange", () => {
    if (window.location.hash.toLowerCase() === "#post") {
      openAndReveal();
    }
  });
  window.addEventListener("pageshow", () => {
    if (isDirty()) {
      setOpen(true);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty()) {
      return;
    }
    event.preventDefault();
    event.returnValue = "";
  });

  window.BmsPostFormUi = {
    close: () => {
      if (!isAppendMode()) {
        manuallyCollapsed = true;
        setOpen(false);
      }
    },
    isDirty,
    open: openAndReveal,
    updateSummary
  };

  if (window.location.hash.toLowerCase() === "#post" || isAppendMode() || isDirty()) {
    setOpen(true);
  } else {
    setOpen(false);
  }
})();
