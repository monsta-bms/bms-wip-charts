(() => {
  "use strict";

  const form = document.getElementById("chartForm");
  const summary = document.getElementById("postReviewSummary");
  const optionalFields = document.getElementById("optionalSongFields");
  const rejectedDescription = document.getElementById("rejectedStateDescription");
  let optionalWatchSequence = 0;
  if (!form || !summary) return;

  const fields = Object.freeze([
    { label: "ファイル", target: "chartFileDropZone", value: () => document.getElementById("chartFile")?.files?.[0]?.name || "未選択" },
    { label: "曲名", target: "title", value: () => valueOf("title") || "未入力" },
    { label: "差分名", target: "chartName", value: () => valueOf("chartName") || "未入力" },
    { label: "作者", target: "author", value: () => valueOf("author") || "未入力" },
    { label: "難易度", target: "difficultyPicker", focus: "difficultyChangeButton", value: () => valueOf("difficulty") || "未選択" },
    { label: "投稿状態", target: "postStatePanelTitle", focus: "submissionStateIncomplete", value: submissionStateLabel },
    { label: "進捗", target: "progress", value: () => `${normalizeProgress(valueOf("progress"))}%` },
    { label: "追記受付", target: "allowAppend", value: () => document.getElementById("allowAppend")?.checked ? "受け付ける" : "受け付けない" },
    { label: "管理パスワード", target: "password", value: () => valueOf("password") ? "設定済み" : "未設定" }
  ]);

  function valueOf(id) {
    return String(document.getElementById(id)?.value || "").trim();
  }

  function normalizeProgress(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
  }

  function submissionStateLabel() {
    const selected = form.querySelector('input[name="submissionState"]:checked')?.value;
    if (selected === "completed") return "完成版";
    if (selected === "rejected_completed") return "完成済み没譜面";
    return "制作途中";
  }

  function makeRow(field) {
    const wrapper = document.createElement("div");
    wrapper.className = "post-review-row";
    const term = document.createElement("dt");
    term.textContent = field.label;
    const description = document.createElement("dd");
    const value = document.createElement("span");
    value.className = "post-review-value";
    value.textContent = field.value();
    const change = document.createElement("button");
    change.className = "post-review-change";
    change.type = "button";
    change.dataset.reviewTarget = field.target;
    if (field.focus) change.dataset.reviewFocus = field.focus;
    change.textContent = "変更";
    change.setAttribute("aria-label", `${field.label}を変更`);
    description.append(value, change);
    wrapper.append(term, description);
    return wrapper;
  }

  function render() {
    summary.replaceChildren(...fields.map(makeRow));
    if (rejectedDescription) {
      rejectedDescription.textContent = submissionStateLabel() === "完成済み没譜面"
        ? "進捗を100%として投稿します。"
        : "完成済みの没譜面として投稿します。";
    }
  }

  function revealOptionalFields() {
    if (!optionalFields) return;
    optionalFields.open = ["subtitle", "subartist", "originUrl"].some((id) => Boolean(valueOf(id)));
  }

  function watchParsedOptionalFields() {
    const sequence = ++optionalWatchSequence;
    let attempts = 0;
    const check = () => {
      if (sequence !== optionalWatchSequence) return;
      revealOptionalFields();
      render();
      attempts += 1;
      if (attempts < 24 && !optionalFields?.open) window.setTimeout(check, 250);
    };
    window.setTimeout(check, 0);
  }

  function focusField(targetId, focusId) {
    const target = document.getElementById(targetId);
    if (!target) {
      console.warn("[post-form-review] target not found", {
        code: "POST_REVIEW_TARGET_NOT_FOUND",
        targetId
      });
      return;
    }
    if (optionalFields?.contains(target)) optionalFields.open = true;
    if (targetId === "difficultyPicker") window.BmsDifficultyUi?.expand?.();
    const focusTarget = document.getElementById(focusId) || target;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    window.requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
  }

  summary.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-review-target]");
    if (!button) return;
    focusField(button.dataset.reviewTarget, button.dataset.reviewFocus);
  });

  form.addEventListener("input", () => {
    revealOptionalFields();
    render();
  });
  form.addEventListener("change", () => {
    revealOptionalFields();
    render();
  });
  document.getElementById("chartFile")?.addEventListener("change", watchParsedOptionalFields);
  form.addEventListener("reset", () => window.requestAnimationFrame(() => {
    revealOptionalFields();
    render();
  }));

  const observed = [
    document.getElementById("chartFileDropControl"),
    document.getElementById("incompleteStateControl"),
    document.getElementById("completionStateControl"),
    document.getElementById("rejectedProgressControl")
  ].filter(Boolean);
  const observer = new MutationObserver(render);
  observed.forEach((element) => observer.observe(element, {
    attributes: true,
    attributeFilter: ["data-state", "data-selected", "hidden", "aria-disabled"]
  }));

  window.addEventListener("pageshow", () => {
    revealOptionalFields();
    render();
  });
  revealOptionalFields();
  render();
})();
