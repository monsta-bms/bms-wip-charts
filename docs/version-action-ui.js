(function initializeVersionActionUi(factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module?.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.BmsVersionActionUi = api;
  }
})(function createVersionActionUiApi() {
  "use strict";

  const createdControls = new WeakSet();

  function getOptions(options) {
    return options && typeof options === "object" ? options : {};
  }

  function getDocument(options) {
    if (options.document && typeof options.document.createElement === "function") {
      return options.document;
    }
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      return document;
    }
    return null;
  }

  function markCreated(element) {
    createdControls.add(element);
    return element;
  }

  function setBooleanDataset(element, name, value) {
    element.dataset[name] = value === true ? "true" : "false";
  }

  function createDisabledAppend(targetDocument, text, className = "secondary") {
    const button = targetDocument.createElement("button");
    button.className = className;
    button.type = "button";
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.textContent = text;
    return markCreated(button);
  }

  function createAppendControl(model, rawOptions = {}) {
    const options = getOptions(rawOptions);
    const targetDocument = getDocument(options);
    if (!targetDocument) {
      return null;
    }

    if (options.placeholder === true) {
      const placeholder = createDisabledAppend(
        targetDocument,
        model?.canShowActions === true ? "追記" : "追記不可"
      );
      placeholder.removeAttribute("aria-disabled");
      return placeholder;
    }

    if (model?.canShowActions !== true) {
      return null;
    }

    const append = model.append;
    if (!append || typeof append !== "object") {
      return createDisabledAppend(targetDocument, "追記不可");
    }

    if (append.reason === "superseded_intermediate") {
      const button = createDisabledAppend(
        targetDocument,
        "追記不可",
        "secondary append-disabled-intermediate"
      );
      button.removeAttribute("aria-disabled");
      button.title = "完成版に置き換え済みの中間履歴のため追記できません";
      return button;
    }

    if (append.reason === "append_disabled") {
      const button = createDisabledAppend(
        targetDocument,
        "追記停止",
        "secondary append-policy-disabled-button"
      );
      const parentVersionId = typeof model.versionId === "string" ? model.versionId : "";
      button.setAttribute("aria-describedby", `append-policy-description-${parentVersionId}`);
      return button;
    }

    if (append.reason === "legacy_progress_map") {
      return createDisabledAppend(targetDocument, "旧形式");
    }

    const chartId = typeof options.chartId === "string" ? options.chartId : "";
    const parentVersionId = typeof model.versionId === "string" ? model.versionId : "";
    if (append.available !== true || !chartId || !parentVersionId) {
      return createDisabledAppend(targetDocument, "追記不可");
    }

    const button = targetDocument.createElement("button");
    button.className = "secondary append-version-button";
    button.type = "button";
    button.dataset.chartId = chartId;
    button.dataset.parentVersionId = parentVersionId;
    button.textContent = "追記";
    button.setAttribute("aria-label", "追記投稿を開始");
    return markCreated(button);
  }

  function createManagementControl(model, rawOptions = {}) {
    const options = getOptions(rawOptions);
    const targetDocument = getDocument(options);
    const versionId = typeof model?.versionId === "string" ? model.versionId : "";
    if (!targetDocument || model?.management?.visible !== true || !versionId) {
      return null;
    }

    const versionLabel = typeof options.versionLabel === "string" && options.versionLabel
      ? options.versionLabel
      : "ver?.?";
    const button = targetDocument.createElement("button");
    button.className = "secondary version-management-button";
    button.type = "button";
    button.textContent = "削除";
    button.title = `${versionLabel} の削除確認を開く`;
    button.setAttribute("aria-label", `${versionLabel} の削除確認を開く`);
    button.dataset.versionId = versionId;
    button.dataset.chartId = typeof options.chartId === "string" ? options.chartId : "";
    button.dataset.versionLabel = versionLabel;
    button.dataset.author = typeof options.author === "string" && options.author ? options.author : "未入力";
    setBooleanDataset(button, "withdrawn", options.withdrawn);
    setBooleanDataset(button, "deleteRequested", options.deleteRequested);
    setBooleanDataset(button, "allowAppend", model.append?.allowedByPolicy);
    setBooleanDataset(button, "appendAvailable", model.append?.available);
    setBooleanDataset(button, "downloadAvailable", model.download?.available);
    button.dataset.lifecycleStatus = typeof model.lifecycle?.state === "string"
      ? model.lifecycle.state
      : "unknown";
    button.dataset.requestMode = typeof options.requestMode === "string" ? options.requestMode : "";
    button.dataset.handlingMode = typeof model.lifecycle?.handlingMode === "string"
      ? model.lifecycle.handlingMode
      : "";
    button.dataset.scheduledAt = typeof options.scheduledAt === "string" ? options.scheduledAt : "";
    setBooleanDataset(button, "canCancelWithdrawal", options.canCancelWithdrawal);
    button.dataset.createdAt = typeof options.createdAt === "string" ? options.createdAt : "";
    setBooleanDataset(button, "within24Hours", options.within24Hours);
    setBooleanDataset(button, "hasDescendants", options.hasDescendants);
    return markCreated(button);
  }

  function createCommentControl(model, rawOptions = {}) {
    const options = getOptions(rawOptions);
    const targetDocument = getDocument(options);
    const versionId = typeof model?.versionId === "string" ? model.versionId : "";
    if (!targetDocument || model?.comments?.available !== true || !versionId) {
      return null;
    }

    const count = Number.isSafeInteger(model.comments.count) && model.comments.count >= 0
      ? model.comments.count
      : 0;
    const versionLabel = typeof options.versionLabel === "string" && options.versionLabel
      ? options.versionLabel
      : "版";
    const button = targetDocument.createElement("button");
    button.className = "secondary version-comment-button";
    button.type = "button";
    button.dataset.versionId = versionId;
    button.dataset.commentCount = String(count);
    button.dataset.songTitle = typeof options.songTitle === "string" ? options.songTitle : "";
    button.dataset.chartName = typeof options.chartName === "string" ? options.chartName : "";
    button.dataset.versionLabel = versionLabel;
    button.dataset.author = typeof options.author === "string" ? options.author : "";
    button.dataset.authorComment = typeof options.authorComment === "string" ? options.authorComment : "";
    if (model.comments.latest) {
      button.dataset.latestComment = model.comments.latest.body;
      button.dataset.latestCommentCreatedAt = model.comments.latest.createdAt;
    }
    button.setAttribute("aria-label", `コメントを開く、${count}件（${versionLabel}）`);
    const label = targetDocument.createElement("span");
    label.className = "version-comment-button-label";
    label.textContent = "💬";
    label.setAttribute("aria-hidden", "true");
    const countElement = targetDocument.createElement("span");
    countElement.className = "version-comment-count";
    countElement.textContent = String(count);
    countElement.setAttribute("aria-hidden", "true");
    button.append(label, countElement);
    return markCreated(button);
  }

  function createLifecycleIndicator(model, rawOptions = {}) {
    const options = getOptions(rawOptions);
    const targetDocument = getDocument(options);
    const state = model?.lifecycle?.state;
    const handlingMode = model?.lifecycle?.handlingMode;
    if (!targetDocument || state === "active" || state === "unknown" || typeof state !== "string") {
      return null;
    }

    let className = "";
    let text = "";
    if (options.variant === "detail") {
      className = "version-withdrawal-detail";
      if (state === "withdrawal_pending" && handlingMode === "immediate_delete") text = "削除処理待ち / 取消不可";
      else if (state === "withdrawal_pending" && handlingMode === "manual_review") text = "DL停止・管理者確認待ち";
      else if (state === "withdrawal_pending" && handlingMode === "grace_auto_delete") text = "DL停止・自動削除待ち";
      else if (state === "processing") text = "取り下げ処理中";
      else if (state === "tombstoned") text = "派生版を維持するため、版ツリー上の履歴だけ残っています。";
      else if (state === "deleted") text = "削除済み";
    } else if (options.variant === "help") {
      className = "version-withdrawal-help";
      if (state === "withdrawal_pending" && handlingMode === "manual_review") {
        text = "申請理由と派生版の状態を管理者が確認します。";
      } else if (state === "withdrawal_pending" && handlingMode === "grace_auto_delete") {
        const scheduledLabel = typeof options.scheduledLabel === "string" && options.scheduledLabel
          ? options.scheduledLabel
          : "日時不明";
        text = `${scheduledLabel}以降、追記や参照がなければ自動削除します。`;
      }
    } else {
      if (state === "withdrawal_pending") {
        className = "withdrawal-pending-badge";
        if (handlingMode === "grace_auto_delete") text = "DL停止・自動削除待ち";
        else if (handlingMode === "manual_review") text = "DL停止・管理者確認待ち";
        else if (handlingMode === "immediate_delete") text = "取り下げ申請中";
      } else if (state === "processing") {
        className = "withdrawal-processing-badge";
        text = "取り下げ処理中";
      } else if (state === "tombstoned") {
        className = "withdrawal-tombstone-badge";
        text = "履歴のみ";
      } else if (state === "deleted") {
        className = "withdrawal-tombstone-badge";
        text = "削除済み";
      }
    }

    if (!className || !text) {
      return null;
    }
    const indicator = targetDocument.createElement("span");
    indicator.className = className;
    indicator.textContent = text;
    return markCreated(indicator);
  }

  function replaceControlIfChanged(existing, next, rawOptions = {}) {
    const options = getOptions(rawOptions);
    if (next && !createdControls.has(next)) {
      return existing || null;
    }
    if (existing && next && existing.outerHTML === next.outerHTML) {
      return existing;
    }
    if (existing && next) {
      existing.replaceWith(next);
      return next;
    }
    if (existing) {
      existing.remove();
      return null;
    }
    if (next && options.parent && typeof options.parent.insertBefore === "function") {
      options.parent.insertBefore(next, options.before || null);
      return next;
    }
    return null;
  }

  return Object.freeze({
    createAppendControl,
    createManagementControl,
    createCommentControl,
    createLifecycleIndicator,
    replaceControlIfChanged
  });
});
