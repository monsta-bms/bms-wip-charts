"use strict";

(() => {
  const form = document.querySelector("#chartForm");
  const panel = document.querySelector(".submit-panel");
  const incomplete = document.querySelector("#submissionStateIncomplete");
  const completed = document.querySelector("#submissionStateCompleted");
  const rejected = document.querySelector("#submissionStateRejected");
  const rejectedField = document.querySelector("#isRejected");
  const rows = {
    incomplete: document.querySelector("#incompleteStateControl"),
    completed: document.querySelector("#completionStateControl"),
    rejected_completed: document.querySelector("#rejectedProgressControl")
  };

  if (!form || !panel || !incomplete || !completed || !rejected || !rejectedField) {
    return;
  }

  function isAppendMode() {
    return panel.classList.contains("is-append-mode");
  }

  function selectedState() {
    if (completed.checked && isAppendMode()) return "completed";
    if (rejected.checked && !isAppendMode()) return "rejected_completed";
    return "incomplete";
  }

  function renderSelection() {
    const selected = selectedState();
    for (const [state, row] of Object.entries(rows)) {
      if (row) row.dataset.selected = String(state === selected);
    }
  }

  function syncCompatibilityField({ notify = true } = {}) {
    const nextRejected = selectedState() === "rejected_completed";
    const changed = rejectedField.checked !== nextRejected;
    rejectedField.checked = nextRejected;
    rejectedField.value = nextRejected ? "true" : "false";
    renderSelection();
    if (notify && (changed || nextRejected)) {
      rejectedField.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function syncMode() {
    const append = isAppendMode();
    incomplete.disabled = false;
    rejected.disabled = append;
    incomplete.setAttribute("aria-disabled", "false");
    rejected.setAttribute("aria-disabled", String(append));
    completed.disabled = !append;
    completed.setAttribute("aria-disabled", String(!append));
    if (append) {
      rejected.checked = false;
      if (!completed.checked) incomplete.checked = true;
    } else if (rejectedField.checked) {
      rejected.checked = true;
      completed.checked = false;
    } else {
      incomplete.checked = true;
      completed.checked = false;
    }
    syncCompatibilityField({ notify: false });
  }

  function setState(state, { notify = false } = {}) {
    if (state === "completed" && isAppendMode()) {
      completed.checked = true;
    } else if (state === "rejected_completed" && !isAppendMode()) {
      rejected.checked = true;
    } else {
      incomplete.checked = true;
    }
    syncCompatibilityField({ notify });
  }

  incomplete.addEventListener("change", () => {
    if (incomplete.checked) syncCompatibilityField();
  });
  completed.addEventListener("change", () => {
    if (completed.checked) syncCompatibilityField();
  });
  rejected.addEventListener("change", () => {
    if (rejected.checked) syncCompatibilityField();
  });
  form.addEventListener("reset", () => {
    queueMicrotask(() => {
      incomplete.checked = true;
      rejected.checked = false;
      syncCompatibilityField();
    });
  });

  new MutationObserver(syncMode).observe(panel, {
    attributes: true,
    attributeFilter: ["class"]
  });

  window.BmsSubmissionStatusUi = Object.freeze({
    selectedState,
    setState,
    syncMode
  });

  syncMode();
})();
