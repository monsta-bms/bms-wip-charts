(() => {
  const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const testSitekey = "1x00000000000000000000AA";
  const action = "chart_submit";
  const challengeTimeoutMs = 120_000;

  const container = document.querySelector("#turnstileWidget");
  const status = document.querySelector("#turnstileStatus");
  const retryButton = document.querySelector("#turnstileRetryButton");
  const configuredSitekey = document
    .querySelector('meta[name="turnstile-sitekey"]')
    ?.getAttribute("content")
    ?.trim() || "";
  const isLocalhost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  const sitekey = configuredSitekey || (isLocalhost ? testSitekey : "");

  let scriptPromise = null;
  let widgetId = null;
  let token = "";
  let pendingChallenge = null;
  let scriptElement = null;

  function makeError(code, message, detail = message) {
    return { code, message, detail };
  }

  function setStatus(message = "", options = {}) {
    if (status) {
      status.textContent = message;
      status.hidden = !message;
      status.classList.toggle("is-error", Boolean(options.error));
    }
    if (retryButton) {
      retryButton.hidden = !options.retryable;
    }
  }

  function settlePending(error, nextToken = "") {
    if (!pendingChallenge) {
      return;
    }

    const current = pendingChallenge;
    pendingChallenge = null;
    window.clearTimeout(current.timeoutId);
    if (error) {
      current.reject(error);
    } else {
      current.resolve(nextToken);
    }
  }

  function removeFailedScript() {
    if (scriptElement && !window.turnstile) {
      scriptElement.remove();
    }
    scriptElement = null;
    scriptPromise = null;
  }

  function loadScript() {
    if (window.turnstile) {
      return Promise.resolve(window.turnstile);
    }
    if (scriptPromise) {
      return scriptPromise;
    }

    scriptPromise = new Promise((resolve, reject) => {
      scriptElement = document.createElement("script");
      scriptElement.src = scriptUrl;
      scriptElement.async = true;
      scriptElement.defer = true;
      scriptElement.dataset.bmsTurnstile = "true";
      scriptElement.addEventListener("load", () => {
        if (window.turnstile) {
          resolve(window.turnstile);
          return;
        }
        reject(makeError(
          "TURNSTILE_SCRIPT_UNAVAILABLE",
          "Turnstileを読み込めませんでした。再試行してください。"
        ));
      }, { once: true });
      scriptElement.addEventListener("error", () => {
        reject(makeError(
          "TURNSTILE_SCRIPT_UNAVAILABLE",
          "Turnstileを読み込めませんでした。再試行してください。"
        ));
      }, { once: true });
      document.head.append(scriptElement);
    }).catch((error) => {
      removeFailedScript();
      throw error;
    });

    return scriptPromise;
  }

  async function ensureWidget() {
    if (!container) {
      throw makeError(
        "TURNSTILE_WIDGET_UNAVAILABLE",
        "Turnstileの表示領域が見つかりません。"
      );
    }
    if (!sitekey) {
      const error = makeError(
        "TURNSTILE_CONFIG_MISSING",
        "Turnstileの設定が不足しています。"
      );
      setStatus(error.message, { error: true });
      throw error;
    }
    if (widgetId !== null) {
      return widgetId;
    }

    const turnstile = await loadScript();
    widgetId = turnstile.render(container, {
      sitekey,
      action,
      theme: "auto",
      size: "flexible",
      appearance: "interaction-only",
      execution: "execute",
      callback(nextToken) {
        token = typeof nextToken === "string" ? nextToken : "";
        if (!token) {
          settlePending(makeError(
            "TURNSTILE_FAILED",
            "Turnstile認証に失敗しました。再試行してください。"
          ));
          return;
        }
        setStatus();
        settlePending(null, token);
      },
      "expired-callback"() {
        token = "";
        if (widgetId !== null && window.turnstile) {
          window.turnstile.reset(widgetId);
        }
        settlePending(makeError(
          "TURNSTILE_FAILED",
          "Turnstile認証の有効期限が切れました。再試行してください。"
        ));
      },
      "error-callback"() {
        token = "";
        const error = makeError(
          "TURNSTILE_FAILED",
          "Turnstile認証を完了できませんでした。再試行してください。"
        );
        setStatus(error.message, { error: true, retryable: true });
        settlePending(error);
      }
    });

    return widgetId;
  }

  async function getToken() {
    const currentWidgetId = await ensureWidget();
    if (token) {
      return token;
    }
    if (pendingChallenge) {
      return pendingChallenge.promise;
    }

    setStatus("Turnstile認証を確認しています。", { error: false });
    let resolveChallenge;
    let rejectChallenge;
    const promise = new Promise((resolve, reject) => {
      resolveChallenge = resolve;
      rejectChallenge = reject;
    });
    const timeoutId = window.setTimeout(() => {
      token = "";
      const error = makeError(
        "TURNSTILE_FAILED",
        "Turnstile認証が時間内に完了しませんでした。再試行してください。"
      );
      setStatus(error.message, { error: true, retryable: true });
      settlePending(error);
    }, challengeTimeoutMs);

    pendingChallenge = {
      promise,
      resolve: resolveChallenge,
      reject: rejectChallenge,
      timeoutId
    };

    try {
      window.turnstile.execute(currentWidgetId);
    } catch (error) {
      const failure = makeError(
        "TURNSTILE_FAILED",
        "Turnstile認証を開始できませんでした。再試行してください。",
        error instanceof Error ? error.message : String(error)
      );
      setStatus(failure.message, { error: true, retryable: true });
      settlePending(failure);
    }

    return promise;
  }

  function reset() {
    token = "";
    if (pendingChallenge) {
      settlePending(makeError(
        "TURNSTILE_RESET",
        "Turnstile認証がリセットされました。"
      ));
    }
    if (widgetId !== null && window.turnstile) {
      try {
        window.turnstile.reset(widgetId);
      } catch {
        widgetId = null;
        if (container) {
          container.replaceChildren();
        }
      }
    }
    setStatus();
  }

  async function retry() {
    reset();
    removeFailedScript();
    setStatus("Turnstileを再読み込みしています。", { error: false });
    try {
      await ensureWidget();
      setStatus();
    } catch (error) {
      const failure = error?.message || "Turnstileを読み込めませんでした。";
      setStatus(failure, { error: true, retryable: true });
    }
  }

  retryButton?.addEventListener("click", retry);

  window.BmsTurnstile = {
    action,
    getToken,
    reset,
    retry
  };

  ensureWidget().catch((error) => {
    setStatus(
      error?.message || "Turnstileを読み込めませんでした。",
      { error: true, retryable: error?.code === "TURNSTILE_SCRIPT_UNAVAILABLE" }
    );
  });
})();
