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
    incomplete.disabled = append;
    rejected.disabled = append;
    incomplete.setAttribute("aria-disabled", String(append));
    rejected.setAttribute("aria-disabled", String(append));
    completed.disabled = true;
    completed.setAttribute("aria-disabled", "true");
    if (append) {
      incomplete.checked = true;
      rejected.checked = false;
    } else if (rejectedField.checked) {
      rejected.checked = true;
    } else if (!incomplete.checked && !rejected.checked) {
      incomplete.checked = true;
    }
    syncCompatibilityField({ notify: false });
  }

  incomplete.addEventListener("change", () => {
    if (incomplete.checked) syncCompatibilityField();
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

  syncMode();
})();
