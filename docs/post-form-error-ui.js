(() => {
  "use strict";

  const errorBox = document.querySelector("#errorBox");
  const form = document.querySelector("#chartForm");
  const fileDropControl = document.querySelector("#chartFileDropControl");
  const fieldErrors = new Map();
  let revealSequence = 0;

  const fieldSpecs = {
    file: {
      target: "#chartFileDropControl",
      error: "#chartFileDropError",
      errorParent: "#chartFileDropControl",
      describedBy: ["#chartFileDropZone"],
      ariaInvalid: ["#chartFileDropZone"],
      highlight: ["#chartFileDropControl"]
    },
    title: inputSpec("#title"),
    artist: inputSpec("#artist"),
    originUrl: inputSpec("#originUrl"),
    difficulty: {
      target: "#difficultyPicker",
      errorParent: ".difficulty-field",
      describedBy: ["#difficultyPicker"],
      ariaInvalid: ["#difficultyPicker"],
      highlight: [".difficulty-field", "#difficultyPicker"]
    },
    chartName: inputSpec("#chartName"),
    author: inputSpec("#author"),
    progress: inputSpec("#progress"),
    progressMap: {
      target: "#progressMap",
      errorParent: ".progress-map-field",
      describedBy: ["#progressMap"],
      ariaInvalid: ["#progressMap"],
      highlight: [".progress-map-field", "#progressMap"]
    },
    completion: controlSpec("#completionStateControl", "#completeProgressButton", ".post-state-message"),
    isRejected: controlSpec("#rejectedProgressControl", "#isRejected", ".post-state-message"),
    allowAppend: controlSpec("#allowAppendControl", "#allowAppend", ".post-state-message"),
    comment: inputSpec("#comment"),
    password: inputSpec("#password"),
    turnstile: {
      target: ".turnstile-control",
      errorParent: ".turnstile-control",
      describedBy: ["#turnstileRetryButton"],
      ariaInvalid: ["#turnstileWidget"],
      highlight: [".turnstile-control"]
    },
    appendContext: {
      target: "#appendContext",
      errorParent: "#appendContext",
      describedBy: ["#appendContext"],
      ariaInvalid: ["#appendContext"],
      highlight: ["#appendContext"]
    }
  };

  const apiErrorFieldMap = {
    INVALID_EXTENSION: "file",
    FILE_TOO_LARGE: "file",
    DUPLICATE_FILE: "file",
    TITLE_ARTIST_MISMATCH: "file",
    ZIP_TOO_MANY_ENTRIES: "file",
    ZIP_UNSAFE_PATH: "file",
    ZIP_DUPLICATE_PATH: "file",
    ZIP_ENCRYPTED: "file",
    ZIP_UNSUPPORTED_COMPRESSION: "file",
    ZIP_UNSUPPORTED_FORMAT: "file",
    ZIP_INVALID: "file",
    ZIP_UNSUPPORTED_ENTRY_TYPE: "file",
    ZIP_TOO_MANY_FILES: "file",
    ZIP_ENTRY_TOO_LARGE: "file",
    ZIP_UNCOMPRESSED_TOO_LARGE: "file",
    ZIP_COMPRESSION_RATIO_TOO_HIGH: "file",
    ZIP_AUDIO_NOT_ALLOWED: "file",
    ZIP_NESTED_ARCHIVE: "file",
    ZIP_CHART_TOO_LARGE: "file",
    ZIP_FORBIDDEN_FILE: "file",
    ZIP_CHART_NOT_FOUND: "file",
    ZIP_MULTIPLE_CHART_FILES: "file",
    INVALID_ORIGIN_URL: "originUrl",
    ORIGIN_URL_TOO_LONG: "originUrl",
    CHART_ALREADY_EXISTS: "chartName",
    INVALID_PROGRESS: "progress",
    INVALID_PROGRESS_MAP: "progressMap",
    PROGRESS_MAP_BLOCK_COUNT_MISMATCH: "progressMap",
    PROGRESS_MAP_OUT_OF_RANGE: "progressMap",
    PROGRESS_MAP_UNCHANGED: "progressMap",
    ZIP_BMS_ANALYSIS_FAILED: "progressMap",
    ZIP_PROGRESS_MAP_MISMATCH: "progressMap",
    INITIAL_COMPLETION_NOT_ALLOWED: "completion",
    COMPLETION_ACTION_REQUIRED: "completion",
    COMPLETION_PROGRESS_TOO_LOW: "completion",
    FOLLOWUP_REJECTED_NOT_ALLOWED: "isRejected",
    INVALID_ALLOW_APPEND: "allowAppend",
    APPEND_POLICY_LOCKED_FOR_INCOMPLETE: "allowAppend",
    PASSWORD_REQUIRED: "password",
    TURNSTILE_REQUIRED: "turnstile",
    TURNSTILE_FAILED: "turnstile",
    TURNSTILE_UNAVAILABLE: "turnstile",
    TURNSTILE_SCRIPT_UNAVAILABLE: "turnstile",
    TURNSTILE_WIDGET_UNAVAILABLE: "turnstile",
    TURNSTILE_CONFIG_MISSING: "turnstile",
    PARENT_APPEND_DISABLED: "appendContext",
    PARENT_APPEND_CONFLICT: "appendContext",
    PARENT_VERSION_NOT_FOUND: "appendContext",
    PARENT_VERSION_CHART_MISMATCH: "appendContext",
    PARENT_LIFECYCLE_UNAVAILABLE: "appendContext"
  };

  function inputSpec(selector) {
    return {
      target: selector,
      errorParent: `${selector}-field-parent`,
      describedBy: [selector],
      ariaInvalid: [selector],
      highlight: [selector]
    };
  }

  function controlSpec(target, control, errorParent) {
    return {
      target,
      errorParent,
      describedBy: [control],
      ariaInvalid: [control, target],
      highlight: [target]
    };
  }

  function queryAll(selectors = []) {
    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  }

  function resolveErrorParent(fieldKey, spec) {
    if (spec.errorParent?.endsWith("-field-parent")) {
      return document.querySelector(spec.target)?.closest(".field") || null;
    }
    const target = document.querySelector(spec.target);
    if (spec.errorParent?.startsWith(".")) {
      return target?.querySelector(spec.errorParent)
        || target?.closest(spec.errorParent)
        || document.querySelector(spec.errorParent);
    }
    return document.querySelector(spec.errorParent) || target;
  }

  function errorId(fieldKey) {
    return fieldKey === "file" ? "chartFileDropError" : `postFieldError-${fieldKey}`;
  }

  function appendDescribedBy(element, id) {
    if (!element) return;
    const values = new Set((element.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    values.add(id);
    element.setAttribute("aria-describedby", Array.from(values).join(" "));
  }

  function ensureErrorElement(fieldKey) {
    const spec = fieldSpecs[fieldKey];
    if (!spec) return null;
    let element = spec.error ? document.querySelector(spec.error) : document.querySelector(`#${errorId(fieldKey)}`);
    if (!element) {
      const parent = resolveErrorParent(fieldKey, spec);
      if (!parent) return null;
      element = document.createElement("p");
      element.id = errorId(fieldKey);
      element.className = "post-field-error";
      element.setAttribute("role", "alert");
      element.hidden = true;
      parent.append(element);
    } else {
      element.classList.add("post-field-error");
      element.setAttribute("role", "alert");
    }
    queryAll(spec.describedBy).forEach((target) => appendDescribedBy(target, element.id));
    return element;
  }

  function setFieldState(fieldKey, invalid, message = "", source = "local") {
    const spec = fieldSpecs[fieldKey];
    const error = ensureErrorElement(fieldKey);
    if (!spec || !error) return false;
    queryAll(spec.ariaInvalid).forEach((target) => target.setAttribute("aria-invalid", invalid ? "true" : "false"));
    queryAll(spec.highlight).forEach((target) => {
      target.toggleAttribute("data-post-error-invalid", invalid);
      target.closest(".field")?.toggleAttribute("data-post-error-invalid", invalid);
    });
    error.textContent = invalid ? message : "";
    error.hidden = !invalid;
    if (invalid) {
      error.dataset.postErrorSource = source;
      fieldErrors.set(fieldKey, { source });
    } else {
      delete error.dataset.postErrorSource;
      fieldErrors.delete(fieldKey);
    }
    return true;
  }

  function clearField(fieldKey) {
    const source = fieldErrors.get(fieldKey)?.source;
    setFieldState(fieldKey, false);
    if (source && !Array.from(fieldErrors.values()).some((state) => state.source === source)) {
      clearOwnedSummary(source);
    }
  }

  function clearOwnedSummary(source) {
    if (!errorBox || errorBox.dataset.postErrorOwned !== "true") return;
    if (source && errorBox.dataset.postErrorSource !== source) return;
    errorBox.textContent = "";
    errorBox.hidden = true;
    delete errorBox.dataset.postErrorOwned;
    delete errorBox.dataset.postErrorSource;
  }

  function clearAll(options = {}) {
    const source = typeof options === "string" ? options : options.source;
    for (const [fieldKey, state] of Array.from(fieldErrors.entries())) {
      if (!source || state.source === source) clearField(fieldKey);
    }
    clearOwnedSummary(source);
  }

  function showSummary(message, source) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.dataset.postErrorOwned = "true";
    errorBox.dataset.postErrorSource = source;
  }

  function waitForLayout() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
  }

  function isVisible(element) {
    if (!element || element.hidden) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function focusWithoutScrolling(element) {
    if (!element || !isVisible(element) || element.disabled) return false;
    if (!element.matches("a[href], button, input:not([type='hidden']), textarea, select, [tabindex]")) {
      element.setAttribute("tabindex", "-1");
    }
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
    return document.activeElement === element;
  }

  function findFocusTarget(fieldKey, target) {
    if (fieldKey === "file") return document.querySelector("#chartFileDropZone");
    if (fieldKey === "difficulty") {
      return document.querySelector("#difficultyPicker .difficulty-tab[aria-pressed='true']:not(:disabled)")
        || document.querySelector("#difficultyPicker .difficulty-tab:not(:disabled)")
        || document.querySelector("#difficultyManual");
    }
    if (fieldKey === "progressMap") {
      return target.querySelector(".progress-map-block:not(:disabled)") || target;
    }
    if (fieldKey === "turnstile") {
      const retry = document.querySelector("#turnstileRetryButton");
      return retry && isVisible(retry) && !retry.disabled ? retry : null;
    }
    const control = target.matches("input, textarea, select, button")
      ? target
      : target.querySelector("input:not([type='hidden']):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)");
    return control && isVisible(control) ? control : target;
  }

  async function revealGeneral() {
    if (!errorBox) return;
    await waitForLayout();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    errorBox.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    focusWithoutScrolling(errorBox);
  }

  async function revealField(fieldKey) {
    const currentSequence = ++revealSequence;
    const spec = fieldSpecs[fieldKey];
    const target = spec ? document.querySelector(spec.target) : null;
    if (!spec || !target) {
      console.warn("[post-error-ui] target not found", {
        code: "POST_ERROR_TARGET_NOT_FOUND",
        fieldKey
      });
      showSummary("入力欄を表示できませんでした。ページを再読み込みして、もう一度お試しください。", "fallback");
      await revealGeneral();
      return false;
    }

    window.BmsPostFormUi?.open?.();
    if (fieldKey === "difficulty") window.BmsDifficultyUi?.expand?.();
    target.hidden = false;
    await waitForLayout();
    if (currentSequence !== revealSequence) return false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    const focusTarget = findFocusTarget(fieldKey, target);
    if (focusTarget) focusWithoutScrolling(focusTarget);
    return true;
  }

  function normalizeErrors(errors) {
    const unique = [];
    const seen = new Set();
    for (const error of Array.isArray(errors) ? errors : []) {
      const fieldKey = String(error?.fieldKey || "");
      const message = String(error?.message || "入力内容を確認してください。").trim();
      if (!fieldSpecs[fieldKey] || seen.has(fieldKey)) continue;
      seen.add(fieldKey);
      unique.push({ fieldKey, message, code: String(error?.code || "FIELD_INVALID") });
    }
    return unique.sort((left, right) => {
      const leftTarget = document.querySelector(fieldSpecs[left.fieldKey].target);
      const rightTarget = document.querySelector(fieldSpecs[right.fieldKey].target);
      if (!leftTarget || !rightTarget || leftTarget === rightTarget) return 0;
      return leftTarget.compareDocumentPosition(rightTarget) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function showValidationErrors(errors, options = {}) {
    const source = options.source || "local";
    const normalized = normalizeErrors(errors);
    if (options.replace !== false) clearAll({ source });
    normalized.forEach((error) => setFieldState(error.fieldKey, true, error.message, source));
    if (options.showSummary !== false && normalized.length > 0) {
      showSummary(options.summary || `入力内容を確認してください（${normalized.length}件）。`, source);
    }
    if (options.reveal !== false && normalized[0]) void revealField(normalized[0].fieldKey);
    return normalized;
  }

  function resolveApiField(code, mode) {
    if (mode === "append" && ["CHART_NOT_FOUND", "INVALID_CHART_ID"].includes(code)) return "appendContext";
    return apiErrorFieldMap[code] || null;
  }

  function showApiError(error, options = {}) {
    const code = String(error?.code || "REQUEST_FAILED");
    const message = String(error?.message || "処理に失敗しました。");
    const fieldKey = resolveApiField(code, options.mode);
    clearAll({ source: "api" });
    if (!fieldKey) {
      showSummary(`code: ${code}\nmessage: ${message}`, "api");
      if (options.reveal !== false) void revealGeneral();
      return { fieldKey: null, code };
    }
    showValidationErrors([{ fieldKey, message, code }], {
      source: "api",
      summary: `code: ${code}\nmessage: ${message}`,
      reveal: options.reveal
    });
    return { fieldKey, code };
  }

  function isValidOriginUrl(value) {
    const raw = String(value || "");
    if (/[\u0000-\u001f\u007f]/u.test(raw)) return false;
    const normalized = raw.trim();
    if (!normalized) return true;
    if (normalized.length > 2048 || /\s/u.test(normalized)) return false;
    try {
      const parsed = new URL(normalized);
      parsed.hash = "";
      return ["http:", "https:"].includes(parsed.protocol)
        && !parsed.username
        && !parsed.password
        && parsed.toString().length <= 2048;
    } catch {
      return false;
    }
  }

  const inputFieldKeys = {
    title: "title",
    artist: "artist",
    originUrl: "originUrl",
    chartName: "chartName",
    author: "author",
    progress: "progress",
    comment: "comment",
    password: "password",
    isRejected: "isRejected",
    allowAppend: "allowAppend"
  };

  function currentValueIsValid(fieldKey, input) {
    if (fieldKey === "originUrl") return isValidOriginUrl(input.value);
    if (fieldKey === "progress") {
      const value = input.value.trim();
      return value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
    }
    if (["isRejected", "allowAppend", "comment"].includes(fieldKey)) return true;
    if (fieldKey === "chartName") return input.value.trim() !== "" && Array.from(input.value.trim()).length <= 100;
    return input.value.trim() !== "";
  }

  form?.addEventListener("input", (event) => {
    const fieldKey = inputFieldKeys[event.target?.id];
    if (fieldKey && currentValueIsValid(fieldKey, event.target)) clearField(fieldKey);
  });
  form?.addEventListener("change", (event) => {
    const fieldKey = inputFieldKeys[event.target?.id];
    if (fieldKey && currentValueIsValid(fieldKey, event.target)) clearField(fieldKey);
  });
  fileDropControl && new MutationObserver(() => {
    if (fileDropControl.dataset.state === "ready") clearField("file");
  }).observe(fileDropControl, { attributes: true, attributeFilter: ["data-state"] });

  if (window.BmsTurnstile?.getToken) {
    const getToken = window.BmsTurnstile.getToken.bind(window.BmsTurnstile);
    window.BmsTurnstile.getToken = async (...args) => {
      const token = await getToken(...args);
      if (token) clearField("turnstile");
      return token;
    };
  }

  Object.keys(fieldSpecs).forEach(ensureErrorElement);

  window.BmsPostErrorUi = {
    apiErrorFieldMap: { ...apiErrorFieldMap },
    clearAll,
    clearField,
    isValidOriginUrl,
    revealField,
    showApiError,
    showValidationErrors
  };
})();
