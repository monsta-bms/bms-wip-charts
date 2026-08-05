(() => {
  "use strict";

  if (window.BmsTheme) {
    return;
  }

  const storageKey = "bms-wip-charts:theme:v1";
  const themes = Object.freeze(["white", "default", "dark"]);
  const themeLabels = Object.freeze({
    white: "ホワイト",
    default: "デフォルト",
    dark: "ダーク"
  });
  const allowedThemes = new Set(themes);
  let currentTheme = allowedThemes.has(document.documentElement.dataset.theme)
    ? document.documentElement.dataset.theme
    : "default";

  function logStorageFailure(code, stage, error) {
    console.warn("[site-theme] storage operation failed", {
      code,
      stage,
      errorType: error instanceof Error ? error.name : typeof error
    });
  }

  function readStoredTheme() {
    try {
      const storedTheme = window.localStorage.getItem(storageKey);
      if (allowedThemes.has(storedTheme)) {
        return storedTheme;
      }
      if (storedTheme !== null) {
        try {
          window.localStorage.removeItem(storageKey);
        } catch (error) {
          logStorageFailure("THEME_STORAGE_REMOVE_FAILED", "restore-invalid-value", error);
        }
      }
    } catch (error) {
      logStorageFailure("THEME_STORAGE_READ_FAILED", "restore", error);
    }
    return "default";
  }

  function storeTheme(theme) {
    try {
      window.localStorage.setItem(storageKey, theme);
    } catch (error) {
      logStorageFailure("THEME_STORAGE_WRITE_FAILED", "set-theme", error);
    }
  }

  function ensureStatusRegion() {
    let status = document.querySelector("[data-theme-status]");
    if (status || !document.body) {
      return status;
    }
    status = document.createElement("p");
    status.className = "theme-status";
    status.dataset.themeStatus = "true";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    document.body.append(status);
    return status;
  }

  function syncControls() {
    document.querySelectorAll("[data-theme-select]").forEach((select) => {
      if (select.value !== currentTheme) {
        select.value = currentTheme;
      }
    });
  }

  function syncThemeLinks(root = document) {
    root.querySelectorAll('a[href*="/difficulty-tables/"]').forEach((link) => {
      try {
        const url = new URL(link.href, document.baseURI);
        if (!url.pathname.startsWith("/difficulty-tables/")) {
          return;
        }
        url.searchParams.set("theme", currentTheme);
        link.href = url.href;
      } catch {
        // Invalid third-party links are left untouched.
      }
    });
  }

  function applyTheme(theme, options = {}) {
    const nextTheme = allowedThemes.has(theme) ? theme : "default";
    const changed = currentTheme !== nextTheme;
    currentTheme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme === "dark" ? "dark" : "light";

    if (options.persist !== false) {
      storeTheme(nextTheme);
    }
    syncControls();
    syncThemeLinks();

    if (options.announce) {
      const status = ensureStatusRegion();
      if (status) {
        status.textContent = `表示テーマを${themeLabels[nextTheme]}に変更しました。`;
      }
    }
    if (changed && options.dispatch !== false) {
      window.dispatchEvent(new CustomEvent("bms:themechange", {
        detail: { theme: nextTheme }
      }));
    }
    return nextTheme;
  }

  function setTheme(theme) {
    return applyTheme(theme, { persist: true, announce: true, dispatch: true });
  }

  function getTheme() {
    return currentTheme;
  }

  function getTurnstileTheme() {
    return currentTheme === "dark" ? "dark" : "light";
  }

  function mountControl(root) {
    if (!root) {
      return null;
    }
    const existing = root.matches?.("[data-theme-control-mounted]")
      ? root
      : root.querySelector?.("[data-theme-control-mounted]");
    if (existing) {
      syncControls();
      return existing;
    }

    const control = root.matches?.("[data-theme-control]") ? root : document.createElement("div");
    control.classList.add("theme-control");
    control.dataset.themeControlMounted = "true";

    const label = document.createElement("label");
    label.className = "theme-control-field";
    const labelText = document.createElement("span");
    labelText.className = "theme-control-label";
    labelText.textContent = "テーマ";
    const select = document.createElement("select");
    select.className = "theme-control-select";
    select.dataset.themeSelect = "true";
    select.setAttribute("aria-label", "表示テーマ");
    themes.forEach((theme) => {
      const option = document.createElement("option");
      option.value = theme;
      option.textContent = themeLabels[theme];
      select.append(option);
    });
    select.value = currentTheme;
    select.addEventListener("change", () => setTheme(select.value));
    label.append(labelText, select);
    control.replaceChildren(label);

    if (control !== root) {
      root.append(control);
    }
    syncControls();
    syncThemeLinks(root);
    return control;
  }

  function restore() {
    return applyTheme(readStoredTheme(), {
      persist: false,
      announce: false,
      dispatch: true
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) {
      return;
    }
    const nextTheme = event.newValue === null
      ? "default"
      : (allowedThemes.has(event.newValue) ? event.newValue : "default");
    if (event.newValue !== null && !allowedThemes.has(event.newValue)) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch (error) {
        logStorageFailure("THEME_STORAGE_REMOVE_FAILED", "storage-event", error);
      }
    }
    applyTheme(nextTheme, { persist: false, announce: false, dispatch: true });
  });

  window.BmsTheme = Object.freeze({
    getTheme,
    setTheme,
    getTurnstileTheme,
    mountControl,
    restore,
    syncThemeLinks
  });

  document.querySelectorAll("[data-theme-control]").forEach(mountControl);
  syncThemeLinks();
})();
