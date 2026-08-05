(() => {
  "use strict";

  const PRODUCTION_API_BASE_URL = "https://bms-wip-charts-worker.monsta3228gsl.workers.dev";
  const API_BASE_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:8788"
    : PRODUCTION_API_BASE_URL;
  const PAGE_SIZE = 20;
  const MAX_BODY_CODE_POINTS = 500;
  const focusableSelector = [
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  const state = {
    dialog: null,
    source: null,
    versionId: "",
    page: 0,
    total: 0,
    items: [],
    loading: false,
    submitting: false,
    requestRevision: 0,
    abortController: null,
    context: null
  };

  function codePointLength(value) {
    return Array.from(String(value ?? "")).length;
  }

  function computeApiUrl(path) {
    return new URL(path, `${API_BASE_URL}/`).toString();
  }

  function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function ensureDialog() {
    if (state.dialog?.isConnected) return state.dialog;

    const dialog = createElement("dialog", "version-comment-dialog");
    dialog.id = "versionCommentDialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "versionCommentDialogTitle");
    dialog.innerHTML = `
      <div class="version-comment-dialog-panel">
        <header class="version-comment-dialog-header">
          <div>
            <p class="version-comment-dialog-kicker">版コメント</p>
            <h2 id="versionCommentDialogTitle">この差分へのコメント</h2>
          </div>
          <button class="version-comment-dialog-close" type="button" data-version-comment-close aria-label="コメント画面を閉じる">×</button>
        </header>
        <dl class="version-comment-target" aria-label="コメント対象">
          <div><dt>曲名</dt><dd data-comment-target-song></dd></div>
          <div><dt>差分名</dt><dd data-comment-target-chart></dd></div>
          <div><dt>版</dt><dd data-comment-target-version></dd></div>
          <div><dt>作者</dt><dd data-comment-target-author></dd></div>
        </dl>
        <section class="version-comment-author" aria-labelledby="versionCommentAuthorTitle">
          <h3 id="versionCommentAuthorTitle">投稿者コメント</h3>
          <p data-comment-author-body></p>
        </section>
        <section class="version-comment-public" aria-labelledby="versionCommentPublicTitle">
          <div class="version-comment-public-heading">
            <h3 id="versionCommentPublicTitle">公開コメント <span data-comment-total>0</span>件</h3>
            <p data-comment-status role="status" aria-live="polite"></p>
          </div>
          <div class="version-comment-list" data-comment-list></div>
          <button class="secondary version-comment-load-more" type="button" data-comment-load-more hidden>さらに読み込む</button>
        </section>
        <form class="version-comment-form" data-comment-form>
          <label for="versionCommentBody">コメントを追加</label>
          <textarea id="versionCommentBody" name="body" rows="4" data-maxlength="500" aria-describedby="versionCommentCounter versionCommentFormHelp" placeholder="この差分へのコメントを入力"></textarea>
          <div class="version-comment-form-meta">
            <span id="versionCommentFormHelp">公開される内容だけを入力してください。</span>
            <span id="versionCommentCounter" data-comment-counter>0 / 500</span>
          </div>
          <p class="version-comment-form-error" data-comment-error role="alert" hidden></p>
          <div class="version-comment-form-actions">
            <button class="primary" type="submit" data-comment-submit disabled>コメントを送信</button>
          </div>
        </form>
      </div>
    `;
    document.body.append(dialog);
    state.dialog = dialog;

    dialog.querySelector("[data-version-comment-close]")?.addEventListener("click", closeDialog);
    dialog.querySelector("[data-comment-load-more]")?.addEventListener("click", () => {
      if (!state.loading && state.items.length < state.total) void loadComments(state.page + 1, true);
    });
    dialog.querySelector("[data-comment-form]")?.addEventListener("submit", submitComment);
    dialog.querySelector("textarea")?.addEventListener("input", handleInput);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("keydown", trapFocus);
    return dialog;
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const focusable = [...state.dialog.querySelectorAll(focusableSelector)]
      .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function readContext(source) {
    return {
      versionId: String(source?.dataset.versionId || ""),
      songTitle: String(source?.dataset.songTitle || "曲名不明"),
      chartName: String(source?.dataset.chartName || "差分名不明"),
      versionLabel: String(source?.dataset.versionLabel || "版不明"),
      author: String(source?.dataset.author || "未入力"),
      authorComment: String(source?.dataset.authorComment || "")
    };
  }

  function setText(selector, value) {
    const element = state.dialog.querySelector(selector);
    if (element) element.textContent = String(value ?? "");
  }

  function resetDialog(context) {
    state.context = context;
    state.versionId = context.versionId;
    state.page = 0;
    state.total = 0;
    state.items = [];
    state.loading = false;
    state.submitting = false;
    setText("[data-comment-target-song]", context.songTitle || "曲名不明");
    setText("[data-comment-target-chart]", context.chartName || "差分名不明");
    setText("[data-comment-target-version]", context.versionLabel || "版不明");
    setText("[data-comment-target-author]", context.author || "未入力");
    setText("[data-comment-author-body]", context.authorComment || "投稿者コメントはありません。");
    setText("[data-comment-total]", "0");
    setText("[data-comment-status]", "コメントを読み込んでいます。");
    const list = state.dialog.querySelector("[data-comment-list]");
    if (list) list.replaceChildren();
    const loadMore = state.dialog.querySelector("[data-comment-load-more]");
    if (loadMore) loadMore.hidden = true;
    const textarea = state.dialog.querySelector("textarea");
    if (textarea) textarea.value = "";
    clearFormError();
    updateFormState();
  }

  function openDialog(source) {
    const context = readContext(source);
    if (!context.versionId) return;
    const dialog = ensureDialog();
    state.source = source;
    state.abortController?.abort();
    state.requestRevision += 1;
    resetDialog(context);
    document.body.classList.add("version-comment-dialog-open");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector("[data-version-comment-close]")?.focus();
    void loadComments(1, false);
  }

  function closeDialog() {
    state.abortController?.abort();
    state.abortController = null;
    state.requestRevision += 1;
    if (state.dialog?.open && typeof state.dialog.close === "function") state.dialog.close();
    else state.dialog?.removeAttribute("open");
    document.body.classList.remove("version-comment-dialog-open");
    const source = state.source;
    state.source = null;
    if (source?.isConnected && typeof source.focus === "function") source.focus();
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function friendlyError(error) {
    const code = String(error?.code || "VERSION_COMMENT_REQUEST_FAILED");
    const messages = {
      VERSION_COMMENT_BODY_REQUIRED: "コメントを入力してください。",
      VERSION_COMMENT_BODY_TOO_LONG: "コメントは500文字以内で入力してください。",
      VERSION_COMMENT_VERSION_NOT_FOUND: "対象の差分が見つかりません。",
      VERSION_COMMENT_VERSION_UNAVAILABLE: "この差分には現在コメントできません。",
      VERSION_COMMENT_RATE_LIMITED: "短時間にコメントが続いています。しばらく待ってください。",
      VERSION_COMMENT_POSTING_BLOCKED: "この環境からはコメントを投稿できません。",
      VERSION_COMMENT_TURNSTILE_REQUIRED: "Bot確認を完了してください。",
      VERSION_COMMENT_TURNSTILE_FAILED: "Bot確認に失敗しました。もう一度お試しください。",
      VERSION_COMMENT_DB_FAILED: "コメントを処理できませんでした。しばらく待って再度お試しください。"
    };
    return { code, message: messages[code] || "コメントを処理できませんでした。再度お試しください。" };
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(computeApiUrl(path), options);
    const body = await readJson(response);
    if (!response.ok) throw body || { code: "VERSION_COMMENT_REQUEST_FAILED" };
    return body;
  }

  function formatCommentDate(value) {
    const source = String(value || "");
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    if (!Number.isFinite(date.getTime())) return source;
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function createCommentItem(comment) {
    const article = createElement("article", "version-comment-item");
    article.dataset.commentId = String(comment.id || "");
    const body = createElement("p", "version-comment-item-body");
    body.textContent = String(comment.body || "");
    const time = createElement("time", "version-comment-item-date", formatCommentDate(comment.createdAt));
    time.dateTime = String(comment.createdAt || "");
    article.append(body, time);
    return article;
  }

  function renderComments(append) {
    const list = state.dialog.querySelector("[data-comment-list]");
    if (!list) return;
    if (!append) list.replaceChildren();
    const renderedIds = new Set([...list.querySelectorAll("[data-comment-id]")].map((item) => item.dataset.commentId));
    state.items.forEach((comment) => {
      if (!renderedIds.has(String(comment.id || ""))) list.append(createCommentItem(comment));
    });
    if (state.total === 0) {
      list.append(createElement("p", "version-comment-empty", "まだコメントはありません。"));
    }
    setText("[data-comment-total]", state.total);
    setText("[data-comment-status]", state.total > 0 ? `${state.items.length}件を表示しています。` : "");
    const loadMore = state.dialog.querySelector("[data-comment-load-more]");
    if (loadMore) {
      loadMore.hidden = state.items.length >= state.total;
      loadMore.disabled = state.loading;
      loadMore.textContent = state.loading ? "読み込み中…" : "さらに読み込む";
    }
  }

  async function loadComments(page, append) {
    if (!state.versionId || state.loading) return;
    state.loading = true;
    const revision = state.requestRevision;
    const abortController = new AbortController();
    state.abortController?.abort();
    state.abortController = abortController;
    const loadMore = state.dialog.querySelector("[data-comment-load-more]");
    if (loadMore) loadMore.disabled = true;
    try {
      const data = await fetchJson(
        `/api/versions/${encodeURIComponent(state.versionId)}/comments?page=${page}&pageSize=${PAGE_SIZE}`,
        { signal: abortController.signal }
      );
      if (revision !== state.requestRevision) return;
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      state.items = append ? [...state.items, ...nextItems] : nextItems;
      state.page = Number(data?.page) || page;
      state.total = Number(data?.total) || 0;
      renderComments(append);
    } catch (error) {
      if (error?.name === "AbortError" || revision !== state.requestRevision) return;
      const friendly = friendlyError(error);
      setText("[data-comment-status]", `${friendly.message}（${friendly.code}）`);
      console.error("[version-comment-list] failed to load comments", {
        code: friendly.code,
        stage: "list",
        versionId: state.versionId
      });
    } finally {
      if (revision === state.requestRevision) {
        state.loading = false;
        state.abortController = null;
        if (loadMore) loadMore.disabled = false;
      }
    }
  }

  function clearFormError() {
    const error = state.dialog?.querySelector("[data-comment-error]");
    if (!error) return;
    error.textContent = "";
    error.hidden = true;
  }

  function showFormError(value) {
    const error = state.dialog?.querySelector("[data-comment-error]");
    if (!error) return;
    error.textContent = value;
    error.hidden = false;
  }

  function updateFormState() {
    const textarea = state.dialog?.querySelector("textarea");
    const counter = state.dialog?.querySelector("[data-comment-counter]");
    const submit = state.dialog?.querySelector("[data-comment-submit]");
    if (!textarea || !counter || !submit) return;
    const length = codePointLength(textarea.value);
    counter.textContent = `${length} / ${MAX_BODY_CODE_POINTS}`;
    counter.classList.toggle("is-over-limit", length > MAX_BODY_CODE_POINTS);
    submit.disabled = state.submitting || !textarea.value.trim() || length > MAX_BODY_CODE_POINTS;
    submit.textContent = state.submitting ? "送信中…" : "コメントを送信";
  }

  function handleInput(event) {
    const textarea = event.currentTarget;
    const points = Array.from(textarea.value);
    if (points.length > MAX_BODY_CODE_POINTS) {
      const selection = textarea.selectionStart;
      textarea.value = points.slice(0, MAX_BODY_CODE_POINTS).join("");
      textarea.setSelectionRange(Math.min(selection, textarea.value.length), Math.min(selection, textarea.value.length));
    }
    clearFormError();
    updateFormState();
  }

  function updatePublicCommentSummaries(comment, total) {
    const versionId = state.versionId;
    document.querySelectorAll(".version-comment-button").forEach((button) => {
      if (button.dataset.versionId !== versionId) return;
      button.dataset.commentCount = String(total);
      button.dataset.latestComment = String(comment.body || "");
      button.dataset.latestCommentCreatedAt = String(comment.createdAt || "");
      const count = button.querySelector(".version-comment-count");
      if (count) count.textContent = String(total);
      const label = button.dataset.versionLabel || "版";
      button.setAttribute("aria-label", `${label} のコメント ${total}件を開く`);
    });
    document.querySelectorAll(".version-comment-latest-preview").forEach((preview) => {
      if (preview.dataset.versionId !== versionId) return;
      preview.hidden = false;
      const container = preview.parentElement;
      if (container) {
        container.hidden = false;
      }
      const text = preview.querySelector(".version-comment-latest-text");
      if (text) text.textContent = String(comment.body || "");
    });
  }

  async function submitComment(event) {
    event.preventDefault();
    if (state.submitting || !state.versionId) return;
    const textarea = state.dialog.querySelector("textarea");
    const body = String(textarea?.value || "").trim();
    const length = codePointLength(body);
    if (!body || length > MAX_BODY_CODE_POINTS) {
      updateFormState();
      return;
    }

    state.submitting = true;
    clearFormError();
    updateFormState();
    try {
      const data = await fetchJson(`/api/versions/${encodeURIComponent(state.versionId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      });
      const comment = data?.comment;
      if (!comment || typeof comment.body !== "string") throw { code: "VERSION_COMMENT_REQUEST_FAILED" };
      state.items.push(comment);
      state.total = Number(data?.total) || state.items.length;
      textarea.value = "";
      state.dialog.querySelector(".version-comment-empty")?.remove();
      state.dialog.querySelector("[data-comment-list]")?.append(createCommentItem(comment));
      setText("[data-comment-total]", state.total);
      setText("[data-comment-status]", "コメントを投稿しました。");
      updatePublicCommentSummaries(comment, state.total);
      textarea.focus();
    } catch (error) {
      const friendly = friendlyError(error);
      showFormError(`${friendly.message}（${friendly.code}）`);
      console.error("[version-comment-create] failed to submit comment", {
        code: friendly.code,
        stage: "post",
        versionId: state.versionId
      });
    } finally {
      state.submitting = false;
      updateFormState();
    }
  }

  function copyContextToDataset(element, context) {
    element.dataset.versionId = String(context.versionId || "");
    element.dataset.songTitle = String(context.songTitle || "");
    element.dataset.chartName = String(context.chartName || "");
    element.dataset.versionLabel = String(context.versionLabel || "");
    element.dataset.author = String(context.author || "");
    element.dataset.authorComment = String(context.authorComment || "");
  }

  function mountAuthorComment(container, comment, context = {}) {
    if (!container) return null;
    const body = String(comment || "");
    const latest = context.latestComment;
    const hasAuthorComment = Boolean(body.trim());
    const hasLatestComment = Boolean(String(latest?.body ?? body.slice(0, 0)).trim());
    container.replaceChildren();
    container.hidden = !hasAuthorComment && !hasLatestComment;
    if (!hasAuthorComment) {
      const empty = createElement("span", "author-comment-empty", "—");
      empty.hidden = true;
      container.append(empty);
    } else {
      const button = createElement("button", "author-comment-preview");
      button.type = "button";
      copyContextToDataset(button, { ...context, authorComment: body });
      button.setAttribute("aria-label", "投稿者コメントの全文と版コメントを開く");
      const label = createElement("span", "author-comment-preview-label", "投稿者コメント");
      const text = createElement("span", "author-comment-preview-text");
      text.textContent = body;
      const more = createElement("span", "author-comment-full-button", "全文を見る");
      more.hidden = true;
      button.append(label, text, more);
      container.append(button);
      requestAnimationFrame(() => {
        if (!text.isConnected) return;
        const clipped = text.scrollHeight > text.clientHeight + 1;
        button.classList.toggle("is-clipped", clipped);
        more.hidden = !clipped;
      });
    }

    const latestPreview = createElement("button", "version-comment-latest-preview");
    latestPreview.type = "button";
    latestPreview.hidden = !hasLatestComment;
    copyContextToDataset(latestPreview, { ...context, authorComment: body });
    latestPreview.dataset.versionId = String(context.versionId || "");
    latestPreview.setAttribute("aria-label", "最新の公開コメントとコメント一覧を開く");
    const latestLabel = createElement("span", "version-comment-latest-label", "最新コメント");
    const latestText = createElement("span", "version-comment-latest-text");
    latestText.textContent = String(latest?.body || "");
    latestPreview.append(latestLabel, latestText);
    container.append(latestPreview);
    return container;
  }

  document.addEventListener("click", (event) => {
    const source = event.target.closest(
      ".version-comment-button, .author-comment-preview, .version-comment-latest-preview"
    );
    if (!source) return;
    event.preventDefault();
    openDialog(source);
  });

  window.BmsVersionCommentUi = Object.freeze({
    mountAuthorComment,
    open: openDialog,
    close: closeDialog,
    codePointLength
  });
})();
