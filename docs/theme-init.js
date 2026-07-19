(() => {
  "use strict";

  const storageKey = "bms-wip-charts:theme:v1";
  const allowedThemes = new Set(["white", "default", "dark"]);
  let theme = "default";

  const logStorageFailure = (code, stage, error) => {
    console.warn("[site-theme] storage operation failed", {
      code,
      stage,
      errorType: error instanceof Error ? error.name : typeof error
    });
  };

  try {
    const storedTheme = window.localStorage.getItem(storageKey);
    if (allowedThemes.has(storedTheme)) {
      theme = storedTheme;
    } else if (storedTheme !== null) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch (error) {
        logStorageFailure("THEME_STORAGE_REMOVE_FAILED", "init-invalid-value", error);
      }
    }
  } catch (error) {
    logStorageFailure("THEME_STORAGE_READ_FAILED", "init", error);
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
})();
