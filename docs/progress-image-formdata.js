(() => {
  const progressImageFieldName = "progressImage";
  const progressMapFieldName = "progressMap";

  function warnProgressImageAttach(detail) {
    console.warn("[progress-image-formdata] failed to attach progress image", {
      code: "PROGRESS_IMAGE_ATTACH_FAILED",
      detail
    });
  }

  function getRequestMethod(input, init) {
    return String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
  }

  function getRequestUrl(input) {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    if (input instanceof Request) {
      return input.url;
    }

    return String(input || "");
  }

  function isChartPostPath(pathname) {
    return pathname === "/api/charts" || /^\/api\/charts\/[^/]+\/versions$/.test(pathname);
  }

  function getContextMode(pathname) {
    return /^\/api\/charts\/[^/]+\/versions$/.test(pathname) ? "append" : "initial";
  }

  function parseProgressMapField(formData) {
    const value = formData.get(progressMapFieldName);
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    return JSON.parse(value);
  }

  async function appendProgressImageToFormData(formData, options = {}) {
    if (!(formData instanceof FormData)) {
      return false;
    }

    if (formData.has(progressImageFieldName)) {
      return true;
    }

    const progressMap = options.progressMap || parseProgressMapField(formData);
    if (!progressMap) {
      return false;
    }

    if (!window.BmsProgressImage?.createProgressImageBlob) {
      warnProgressImageAttach("BmsProgressImage.createProgressImageBlob is not available.");
      return false;
    }

    try {
      const blob = await window.BmsProgressImage.createProgressImageBlob(progressMap, {
        contextMode: options.contextMode || "saved"
      });

      if (!blob || blob.size <= 0) {
        warnProgressImageAttach("Generated progress image blob is empty.");
        return false;
      }

      formData.append(progressImageFieldName, blob, options.filename || "progress.png");
      return true;
    } catch (error) {
      warnProgressImageAttach(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function installFetchHook() {
    if (window.__bmsProgressImageFormDataHookInstalled) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      try {
        const method = getRequestMethod(input, init);
        const body = init?.body;
        const url = new URL(getRequestUrl(input), window.location.href);

        if (method === "POST" && body instanceof FormData && isChartPostPath(url.pathname)) {
          await appendProgressImageToFormData(body, {
            contextMode: getContextMode(url.pathname),
            filename: "progress.png"
          });
        }
      } catch (error) {
        warnProgressImageAttach(error instanceof Error ? error.message : String(error));
      }

      return originalFetch(input, init);
    };

    window.__bmsProgressImageFormDataHookInstalled = true;
  }

  window.BmsProgressImageFormData = {
    appendProgressImageToFormData
  };

  installFetchHook();
})();
