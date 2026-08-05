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
  const saveAuthorInput = document.querySelector("#saveAuthor");
  const savePasswordInput = document.querySelector("#savePassword");
  const progressMap = document.querySelector("#progressMap");
  const errorBox = document.querySelector("#errorBox");
  const launcher = document.querySelector(".post-form-launcher");
  const launcherDropCopy = document.querySelector("#postFormLauncherDropCopy");
  const fileDropControl = document.querySelector("#chartFileDropControl");
  const fileInfoSection = fileDropControl?.closest(".file-info-section");
  const fileDropZone = document.querySelector("#chartFileDropZone");
  const fileDropPrimary = document.querySelector("#chartFileDropPrimary");
  const fileDropFileName = document.querySelector("#chartFileDropFileName");
  const fileDropInternalName = document.querySelector("#chartFileDropInternalName");
  const fileDropHelp = document.querySelector("#chartFileDropHelp");
  const fileDropActions = document.querySelector("#chartFileDropActions");
  const fileChangeButton = document.querySelector("#chartFileChangeButton");
  const fileClearButton = document.querySelector("#chartFileClearButton");
  const fileDropError = document.querySelector("#chartFileDropError");
  const deferredSections = Array.from(form?.querySelectorAll("[data-post-requires-file]") || []);

  if (!panel || !form || !body || !toggle || !summary) {
    return;
  }

  const allowedFileExtensions = new Set([".bms", ".bme", ".bml", ".zip"]);
  const bmsFileLimit = 2 * 1024 * 1024;
  const zipFileLimit = 5 * 1024 * 1024;
  let manuallyCollapsed = false;
  let lastFormActionAt = 0;
  let launcherDragDepth = 0;
  let dropZoneDragDepth = 0;
  let dropStateBeforeDrag = "empty";
  let dropDetailBeforeDrag = {};
  let lastDropDetail = {};

  function syncDeferredSections() {
    const hasSelectedFile = Boolean(fileInput?.files?.length);
    deferredSections.forEach((section) => {
      section.hidden = !hasSelectedFile;
    });
    form.classList.toggle("has-selected-chart-file", hasSelectedFile);
  }

  function isFileDrag(event) {
    return Array.from(event?.dataTransfer?.types || []).includes("Files");
  }

  function getFileExtension(fileName) {
    const normalized = String(fileName || "").toLowerCase();
    const dotIndex = normalized.lastIndexOf(".");
    return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
  }

  function validateSelectedFile(file) {
    if (!(file instanceof File)) {
      return { valid: false, code: "FILE_NOT_SELECTED", message: "譜面ファイルを選択してください。" };
    }

    const extension = getFileExtension(file.name);
    if (!allowedFileExtensions.has(extension)) {
      return { valid: false, code: "INVALID_FILE_TYPE", message: "投稿できるのは .bms / .bme / .bml / .zip です。" };
    }

    const limit = extension === ".zip" ? zipFileLimit : bmsFileLimit;
    if (file.size > limit) {
      return {
        valid: false,
        code: "FILE_TOO_LARGE",
        message: extension === ".zip" ? "ZIPは5MB以下にしてください。" : "BMSファイルは2MB以下にしてください。"
      };
    }

    return { valid: true, extension };
  }

  function formatFileSize(size) {
    if (!Number.isFinite(size) || size < 0) {
      return "";
    }
    if (size < 1024 * 1024) {
      return `${Math.max(1, Math.round(size / 1024))}KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  }

  function setDropState(state, detail = {}) {
    if (!fileDropControl || !fileDropPrimary || !fileDropHelp) {
      return;
    }

    const retainedPostError = fileDropError?.dataset.postErrorSource && fileDropError.textContent
      ? { message: fileDropError.textContent, source: fileDropError.dataset.postErrorSource }
      : null;
    const restoreRetainedPostError = () => {
      if (!retainedPostError || !fileDropError) return;
      fileDropError.textContent = retainedPostError.message;
      fileDropError.dataset.postErrorSource = retainedPostError.source;
      fileDropError.hidden = false;
    };

    if (state !== "drag") {
      lastDropDetail = detail;
    }
    const selectedFile = detail.file || fileInput?.files?.[0] || null;
    fileDropControl.dataset.state = state;
    if (fileInfoSection) {
      fileInfoSection.dataset.fileState = state;
    }
    fileDropControl.setAttribute("aria-busy", state === "analyzing" ? "true" : "false");
    fileDropFileName.hidden = true;
    fileDropFileName.removeAttribute("title");
    fileDropInternalName.hidden = true;
    fileDropInternalName.setAttribute("aria-hidden", "true");
    fileDropInternalName.removeAttribute("title");
    fileDropControl.classList.remove("has-internal-file");
    fileDropActions.hidden = true;
    fileDropError.hidden = true;
    fileDropError.textContent = "";

    if (state === "drag") {
      fileDropPrimary.textContent = "ここに離してください";
      fileDropHelp.textContent = ".bms / .bme / .bml / .zip";
      return;
    }

    if (state === "analyzing") {
      fileDropPrimary.textContent = "解析中…";
      fileDropFileName.textContent = selectedFile?.name || "選択したファイル";
      fileDropFileName.title = fileDropFileName.textContent;
      fileDropFileName.hidden = false;
      fileDropHelp.textContent = "譜面情報と進捗ブロックを確認しています";
      restoreRetainedPostError();
      return;
    }

    if (state === "ready") {
      const blockCount = Number.isInteger(detail.blockCount) ? detail.blockCount : 0;
      const sourceFileName = String(detail.sourceFileName || "").trim();
      const hasInternalFile = Boolean(sourceFileName && sourceFileName !== selectedFile?.name);
      fileDropPrimary.textContent = "✓ 解析完了";
      fileDropFileName.textContent = selectedFile?.name || "選択したファイル";
      fileDropFileName.title = fileDropFileName.textContent;
      fileDropFileName.hidden = false;
      if (hasInternalFile) {
        fileDropInternalName.textContent = `ZIP内: ${sourceFileName}`;
        fileDropInternalName.title = sourceFileName;
        fileDropInternalName.removeAttribute("aria-hidden");
        fileDropInternalName.hidden = false;
      }
      fileDropControl.classList.toggle("has-internal-file", hasInternalFile);
      fileDropHelp.textContent = [
        blockCount > 0 ? `${blockCount} blocks` : "進捗マップなし",
        selectedFile ? formatFileSize(selectedFile.size) : "",
        detail.miniViewAvailable === false ? "ミニビュー非対応" : ""
      ].filter(Boolean).join(" / ");
      fileDropActions.hidden = false;
      return;
    }

    if (state === "error") {
      fileDropPrimary.textContent = selectedFile ? "ファイルを確認できませんでした" : "ファイルを選択できませんでした";
      if (selectedFile) {
        fileDropFileName.textContent = selectedFile.name;
        fileDropFileName.hidden = false;
        fileDropActions.hidden = false;
      }
      fileDropHelp.textContent = "別のファイルを選択するか、内容を確認してください";
      fileDropError.textContent = detail.message || "ファイルを解析できませんでした。";
      fileDropError.hidden = false;
      return;
    }

    fileDropControl.dataset.state = "empty";
    fileDropPrimary.textContent = "クリックまたはドロップ";
    fileDropHelp.innerHTML = ".bms / .bme / .bml / .zip<br>最大5MB（BMS単体は2MB）";
    restoreRetainedPostError();
  }

  function setFileError(message, file = fileInput?.files?.[0]) {
    setDropState("error", { file, message });
    window.BmsPostErrorUi?.showValidationErrors?.([
      { fieldKey: "file", message, code: "FILE_ANALYSIS_FAILED" }
    ], { source: "local", reveal: false, showSummary: false, replace: false });
  }

  function assignDroppedFile(file) {
    const validation = validateSelectedFile(file);
    if (!validation.valid) {
      console.warn("[post-file-drop] rejected", { code: validation.code });
      setOpen(true);
      setFileError(validation.message, fileInput?.files?.[0] || file);
      return;
    }

    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_error) {
      console.warn("[post-file-drop] assignment failed", { code: "FILE_ASSIGN_FAILED" });
      setOpen(true);
      setFileError("ファイルを選択欄へ反映できませんでした。クリックして選択してください。");
    }
  }

  function handleFileDrop(event) {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length !== 1) {
      console.warn("[post-file-drop] rejected", { code: "FILE_COUNT_INVALID", count: files.length });
      setOpen(true);
      setFileError("譜面ファイルは1件だけドロップしてください。");
      return;
    }
    setOpen(true);
    assignDroppedFile(files[0]);
  }

  function getStoredPassword() {
    return window.BmsPostPreferences?.getStoredPassword?.() || "";
  }

  function getStoredAuthor() {
    return window.BmsPostPreferences?.getStoredAuthor?.() || "";
  }

  function isAppendMode() {
    return panel.classList.contains("is-append-mode");
  }

  function isControlChanged(control) {
    if (!control || control.disabled || !control.name) {
      return false;
    }

    if (control === saveAuthorInput || control === savePasswordInput) {
      return false;
    }

    if (control === authorInput) {
      const storedAuthor = getStoredAuthor();
      if (storedAuthor && saveAuthorInput?.checked && control.value === storedAuthor) {
        return false;
      }
      return control.value !== control.defaultValue;
    }

    if (control === passwordInput) {
      const storedPassword = getStoredPassword();
      const isRestoredPassword = Boolean(
        storedPassword
        && savePasswordInput?.checked
        && control.value === storedPassword
      );
      return isRestoredPassword ? false : control.value !== control.defaultValue;
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

    if (fileName) {
      items.push(fileName);
    }
    if (difficulty) {
      items.push(`\u96e3\u6613\u5ea6 ${difficulty}`);
    }
    summary.textContent = items.length
      ? `\u7de8\u96c6\u4e2d: ${items.join(" / ")}`
      : "";
    summary.hidden = !summary.textContent || !body.hidden;
  }

  function markClean() {
    Array.from(form.elements).forEach((control) => {
      if (!control || control.type === "file" || control.type === "button"
        || control.type === "submit" || control.type === "reset") {
        return;
      }

      if (control.type === "checkbox" || control.type === "radio") {
        control.defaultChecked = control.checked;
      } else if ("defaultValue" in control) {
        control.defaultValue = control.value;
      }
    });
    lastFormActionAt = 0;
    manuallyCollapsed = false;
    updateSummary();
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

  fileDropZone?.addEventListener("click", () => fileInput?.click());
  fileChangeButton?.addEventListener("click", () => fileInput?.click());
  fileClearButton?.addEventListener("click", () => {
    if (!fileInput) {
      return;
    }
    fileInput.value = "";
    setDropState("empty");
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    updateSummary();
    fileDropZone?.focus();
  });

  fileDropZone?.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (dropZoneDragDepth === 0) {
      dropStateBeforeDrag = fileDropControl?.dataset.state || "empty";
      dropDetailBeforeDrag = lastDropDetail;
    }
    dropZoneDragDepth += 1;
    setDropState("drag");
  });
  fileDropZone?.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  fileDropZone?.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    dropZoneDragDepth = Math.max(0, dropZoneDragDepth - 1);
    if (dropZoneDragDepth === 0) {
      setDropState(dropStateBeforeDrag, dropDetailBeforeDrag);
    }
  });
  fileDropZone?.addEventListener("drop", (event) => {
    dropZoneDragDepth = 0;
    handleFileDrop(event);
  });

  launcher?.addEventListener("dragenter", (event) => {
    if (!body.hidden || !isFileDrag(event)) return;
    event.preventDefault();
    launcherDragDepth += 1;
    panel.classList.add("is-file-dragover");
    if (launcherDropCopy) launcherDropCopy.hidden = false;
  });
  launcher?.addEventListener("dragover", (event) => {
    if (!body.hidden || !isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  launcher?.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    launcherDragDepth = Math.max(0, launcherDragDepth - 1);
    if (launcherDragDepth === 0) {
      panel.classList.remove("is-file-dragover");
      if (launcherDropCopy) launcherDropCopy.hidden = true;
    }
  });
  launcher?.addEventListener("drop", (event) => {
    launcherDragDepth = 0;
    panel.classList.remove("is-file-dragover");
    if (launcherDropCopy) launcherDropCopy.hidden = true;
    if (body.hidden) {
      handleFileDrop(event);
    }
  });

  document.addEventListener("dragover", (event) => {
    if (isFileDrag(event)) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (isFileDrag(event)) event.preventDefault();
  });

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
    syncDeferredSections();
    if (fileDropControl?.dataset.state === "error") {
      // The parser already supplied a user-safe error for this selection.
    } else if (fileInput.files?.[0]) {
      setDropState("analyzing", { file: fileInput.files[0] });
    } else {
      setDropState("empty");
    }
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
      setDropState("empty");
      syncDeferredSections();
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
    syncDeferredSections();
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
    markClean,
    open: openAndReveal,
    updateSummary
  };

  window.BmsPostFileUi = {
    setAnalyzing: (file) => setDropState("analyzing", { file }),
    setEmpty: () => setDropState("empty"),
    setError: setFileError,
    setReady: (detail = {}) => {
      setDropState("ready", detail);
      window.BmsPostErrorUi?.clearField?.("file");
    },
    validateFile: validateSelectedFile
  };

  if (window.location.hash.toLowerCase() === "#post" || isAppendMode() || isDirty()) {
    setOpen(true);
  } else {
    setOpen(false);
  }
  syncDeferredSections();
})();
