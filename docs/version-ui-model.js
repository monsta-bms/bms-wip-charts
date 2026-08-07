(function initializeVersionUiModel(factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module?.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.BmsVersionUiModel = api;
  }
})(function createVersionUiModelApi() {
  "use strict";

  const UNKNOWN_LIFECYCLE = "unknown";
  const OPERABLE_LIFECYCLES = new Set(["active", "withdrawal_pending"]);
  const KNOWN_LIFECYCLES = new Set([
    "active",
    "withdrawal_pending",
    "processing",
    "tombstoned",
    "deleted",
    "legacy_withdrawn",
    "legacy_delete_pending"
  ]);
  const KNOWN_HANDLING_MODES = new Set([
    "immediate_delete",
    "grace_auto_delete",
    "manual_review"
  ]);
  const COMPLETED_COLLAPSE_REASON = "superseded_by_completed_descendant";

  function freezeRecord(value) {
    return Object.freeze(value);
  }

  function hasOwn(source, key) {
    return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
  }

  function collectAliasValues(source, keys) {
    return keys
      .filter((key) => hasOwn(source, key))
      .map((key) => source[key]);
  }

  function readBooleanAliases(source, keys, { required = false, strict = false } = {}) {
    const values = collectAliasValues(source, keys);
    if (values.length === 0) {
      return freezeRecord({ present: false, valid: !required, value: false });
    }

    const normalized = [];
    for (const value of values) {
      if (value === true || (!strict && value === 1)) {
        normalized.push(true);
      } else if (value === false || (!strict && value === 0)) {
        normalized.push(false);
      } else {
        return freezeRecord({ present: true, valid: false, value: false });
      }
    }

    const first = normalized[0];
    return freezeRecord({
      present: true,
      valid: normalized.every((value) => value === first),
      value: first
    });
  }

  function readStringAliases(source, keys, { nullAsMissing = false } = {}) {
    const values = collectAliasValues(source, keys)
      .filter((value) => !nullAsMissing || (value !== null && value !== undefined));
    if (values.length === 0) {
      return freezeRecord({ present: false, valid: true, value: "" });
    }
    if (values.some((value) => typeof value !== "string")) {
      return freezeRecord({ present: true, valid: false, value: "" });
    }

    const normalized = values.map((value) => value.trim());
    const first = normalized[0];
    return freezeRecord({
      present: true,
      valid: normalized.every((value) => value === first),
      value: first
    });
  }

  function normalizeExternalHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    try {
      const url = new URL(value.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  function normalizeWorkerDownloadUrl(value, workerBaseUrl) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    try {
      const workerBase = new URL(workerBaseUrl);
      if (!["http:", "https:"].includes(workerBase.protocol) || workerBase.username || workerBase.password) {
        return null;
      }

      const url = new URL(value.trim(), workerBase);
      const filePathPrefix = "/api/files/";
      const fileIdPath = url.pathname.startsWith(filePathPrefix)
        ? url.pathname.slice(filePathPrefix.length)
        : "";
      if (!["http:", "https:"].includes(url.protocol)
        || url.origin !== workerBase.origin
        || url.username
        || url.password
        || !fileIdPath
        || fileIdPath.includes("/")
        || url.search
        || url.hash) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  function normalizeLifecycleState(value) {
    return typeof value === "string" && KNOWN_LIFECYCLES.has(value)
      ? value
      : UNKNOWN_LIFECYCLE;
  }

  function lifecycleLabel(state, handlingMode) {
    if (state === "active") return "公開中";
    if (state === "processing") return "取り下げ処理中";
    if (state === "tombstoned") return "履歴のみ";
    if (state === "deleted") return "削除済み";
    if (state === "legacy_withdrawn") return "取り下げ";
    if (state === "legacy_delete_pending") return "削除申請中";
    if (state === "withdrawal_pending") {
      if (handlingMode === "grace_auto_delete") return "DL停止・自動削除待ち";
      if (handlingMode === "manual_review") return "DL停止・管理者確認待ち";
      if (handlingMode === "immediate_delete") return "削除処理待ち";
    }
    return "状態不明";
  }

  function unavailableLink(reason) {
    return freezeRecord({ available: false, url: null, reason });
  }

  function getVersionId(version) {
    const id = readStringAliases(version, ["id", "versionId", "version_id"]);
    return freezeRecord({
      valid: id.valid && Boolean(id.value),
      value: id.valid ? id.value : ""
    });
  }

  function getLifecycle(version) {
    const raw = readStringAliases(version, ["lifecycleStatus", "lifecycle_status"]);
    const state = raw.valid ? normalizeLifecycleState(raw.value) : UNKNOWN_LIFECYCLE;
    const handling = readStringAliases(version, ["handlingMode", "handling_mode"], { nullAsMissing: true });
    const handlingMode = handling.valid && KNOWN_HANDLING_MODES.has(handling.value)
      ? handling.value
      : null;
    const handlingProvided = handling.present && Boolean(handling.value);
    const handlingConsistent = handling.valid
      && (state === "withdrawal_pending"
        ? Boolean(handlingMode)
        : state === "active"
          ? !handlingProvided
          : true);

    return freezeRecord({
      state,
      handlingMode,
      known: state !== UNKNOWN_LIFECYCLE,
      consistent: raw.valid && handlingConsistent,
      label: lifecycleLabel(state, handlingMode)
    });
  }

  function getProgressPresentation(version) {
    const rawProgress = Number(version?.progress);
    const progress = Number.isFinite(rawProgress)
      ? Math.max(0, Math.min(100, Math.round(rawProgress)))
      : 0;
    const rejected = readBooleanAliases(version, ["isRejected", "is_rejected"], { strict: true });
    const completed = readBooleanAliases(version, ["completed"], { strict: true });
    const completedAt = readStringAliases(version, ["completedAt", "completed_at"], { nullAsMissing: true });
    const rejectedState = rejected.valid && rejected.value;
    const completedState = !rejectedState
      && ((completed.valid && completed.value) || (completedAt.valid && Boolean(completedAt.value)));
    const state = rejectedState
      ? "rejected_completed"
      : completedState
        ? "completed"
        : "incomplete";
    const completedTone = progress === 100 && (state === "completed" || state === "rejected_completed");

    return freezeRecord({
      value: progress,
      state,
      completedTone
    });
  }

  function resolveActionState(version, versionId, lifecycle) {
    const hidden = readBooleanAliases(version, ["hidden", "isHidden", "is_hidden"]);
    const redacted = readBooleanAliases(version, ["publicDataRedacted", "public_data_redacted"]);
    const explicitlyHidden = readBooleanAliases(version, [
      "publicActionsHidden",
      "public_actions_hidden",
      "actionsHidden",
      "actions_hidden"
    ]);
    const explicitCanShow = readBooleanAliases(version, ["canShowActions", "can_show_actions"]);

    if (!versionId.valid) return freezeRecord({ available: false, reason: "missing_version_id" });
    if (!hidden.valid || !redacted.valid || !explicitlyHidden.valid || !explicitCanShow.valid) {
      return freezeRecord({ available: false, reason: "inconsistent_data" });
    }
    if (hidden.value) return freezeRecord({ available: false, reason: "hidden" });
    if (redacted.value) return freezeRecord({ available: false, reason: "redacted" });
    if (explicitlyHidden.value || (explicitCanShow.present && !explicitCanShow.value)) {
      return freezeRecord({ available: false, reason: "actions_hidden" });
    }
    if (!lifecycle.known) return freezeRecord({ available: false, reason: "unknown_state" });
    if (!lifecycle.consistent) return freezeRecord({ available: false, reason: "inconsistent_data" });
    if (!OPERABLE_LIFECYCLES.has(lifecycle.state)) {
      return freezeRecord({ available: false, reason: "lifecycle_blocked" });
    }
    return freezeRecord({ available: true, reason: "available" });
  }

  function buildVersionUiModel(version, options = {}) {
    const source = version && typeof version === "object" ? version : {};
    const versionId = getVersionId(source);
    const lifecycle = getLifecycle(source);
    const progress = getProgressPresentation(source);
    let actionState = resolveActionState(source, versionId, lifecycle);

    const downloadBlocked = readBooleanAliases(source, ["downloadBlocked", "download_blocked"], { required: true });
    const downloadBlockReason = readStringAliases(source, ["downloadBlockReason", "download_block_reason"], {
      nullAsMissing: true
    });
    const completionDerivedDownloadBlock = downloadBlockReason.valid
      && downloadBlockReason.value === COMPLETED_COLLAPSE_REASON;
    const effectiveDownloadBlocked = downloadBlocked.value && !completionDerivedDownloadBlock;
    const withdrawalDownloadBlocked = readBooleanAliases(source, [
      "withdrawalDownloadBlocked",
      "withdrawal_download_blocked"
    ]);
    const explicitDownloadAvailable = readBooleanAliases(source, ["downloadAvailable", "download_available"]);
    const allowAppend = readBooleanAliases(source, ["allowAppend", "allow_append"], {
      required: true,
      strict: true
    });
    const explicitAppendAvailable = readBooleanAliases(source, ["appendAvailable", "append_available"]);
    const explicitManagementAvailable = readBooleanAliases(source, ["managementAvailable", "management_available"]);

    const contradictoryAvailability = (explicitDownloadAvailable.present
        && explicitDownloadAvailable.value
        && ((!downloadBlocked.valid || effectiveDownloadBlocked) || withdrawalDownloadBlocked.value))
      || (explicitAppendAvailable.present
        && explicitAppendAvailable.value
        && (!allowAppend.valid || !allowAppend.value))
      || (explicitManagementAvailable.present
        && explicitManagementAvailable.value
        && (!lifecycle.known || !OPERABLE_LIFECYCLES.has(lifecycle.state)));
    if (!explicitDownloadAvailable.valid
      || !withdrawalDownloadBlocked.valid
      || !explicitAppendAvailable.valid
      || !explicitManagementAvailable.valid
      || contradictoryAvailability) {
      actionState = freezeRecord({ available: false, reason: "inconsistent_data" });
    }

    const rawOriginUrl = source.originUrl ?? source.origin_url ?? null;
    const normalizedOriginUrl = normalizeExternalHttpUrl(rawOriginUrl);
    const originLink = !actionState.available
      ? unavailableLink(actionState.reason)
      : normalizedOriginUrl
        ? freezeRecord({ available: true, url: normalizedOriginUrl, reason: "available" })
        : unavailableLink(rawOriginUrl === null || rawOriginUrl === undefined || rawOriginUrl === ""
          ? "missing_url"
          : "invalid_url");

    const rawDownloadUrl = source.file?.downloadUrl
      ?? source.file?.download_url
      ?? source.downloadUrl
      ?? source.download_url
      ?? null;
    const normalizedDownloadUrl = normalizeWorkerDownloadUrl(rawDownloadUrl, options.workerBaseUrl);
    let downloadReason = "available";
    if (!actionState.available) downloadReason = actionState.reason;
    else if (!downloadBlocked.valid) downloadReason = "download_state_unknown";
    else if (effectiveDownloadBlocked || withdrawalDownloadBlocked.value
      || (explicitDownloadAvailable.present && !explicitDownloadAvailable.value)) {
      downloadReason = "download_blocked";
    } else if (rawDownloadUrl === null || rawDownloadUrl === undefined || rawDownloadUrl === "") {
      downloadReason = "missing_url";
    } else if (!normalizedDownloadUrl) downloadReason = "invalid_url";
    const downloadAvailable = downloadReason === "available";
    const download = freezeRecord({
      available: downloadAvailable,
      url: downloadAvailable ? normalizedDownloadUrl : null,
      label: downloadAvailable ? "DL" : "DL不可",
      reason: downloadReason
    });

    const collapsed = readBooleanAliases(source, ["collapsedByCompletion", "collapsed_by_completion"]);
    const collapsedReason = readStringAliases(source, ["collapsedReason", "collapsed_reason"], { nullAsMissing: true });
    const completionDerivedCollapse = collapsedReason.valid
      && collapsedReason.value === COMPLETED_COLLAPSE_REASON;
    const effectiveCollapsed = collapsed.valid && collapsed.value && !completionDerivedCollapse;
    let appendReason = "available";
    let appendLabel = "追記投稿";
    if (!actionState.available) {
      appendReason = actionState.reason;
      appendLabel = "追記不可";
    } else if (!collapsed.valid || !collapsedReason.valid) {
      appendReason = "inconsistent_data";
      appendLabel = "追記不可";
    } else if (effectiveCollapsed) {
      appendReason = "inconsistent_data";
      appendLabel = "追記不可";
    } else if (!allowAppend.valid) {
      appendReason = "invalid_allow_append";
      appendLabel = "追記不可";
    } else if (!allowAppend.value) {
      appendReason = "append_disabled";
      appendLabel = "追記停止";
    } else if (options.hasProgressMap !== true) {
      appendReason = "legacy_progress_map";
      appendLabel = "旧形式";
    }
    const append = freezeRecord({
      available: appendReason === "available",
      allowedByPolicy: allowAppend.valid && allowAppend.value,
      hasProgressMap: options.hasProgressMap === true,
      label: appendLabel,
      reason: appendReason
    });

    const managementVisible = actionState.available
      && OPERABLE_LIFECYCLES.has(lifecycle.state)
      && (!explicitManagementAvailable.present || explicitManagementAvailable.value);
    const management = freezeRecord({
      visible: managementVisible,
      reason: managementVisible ? "available" : actionState.available ? "management_unavailable" : actionState.reason
    });
    const favorite = freezeRecord({
      available: actionState.available,
      reason: actionState.available ? "available" : actionState.reason
    });
    const rawCommentCount = source.commentCount ?? source.comment_count;
    const parsedCommentCount = rawCommentCount === undefined || rawCommentCount === null
      ? 0
      : Number(rawCommentCount);
    const commentCount = Number.isSafeInteger(parsedCommentCount) && parsedCommentCount >= 0
      ? parsedCommentCount
      : 0;
    const rawLatestComment = source.latestComment ?? source.latest_comment;
    const latestComment = rawLatestComment
      && typeof rawLatestComment === "object"
      && typeof rawLatestComment.body === "string"
      && rawLatestComment.body.trim()
      && typeof (rawLatestComment.createdAt ?? rawLatestComment.created_at) === "string"
      ? freezeRecord({
          body: rawLatestComment.body,
          createdAt: rawLatestComment.createdAt ?? rawLatestComment.created_at
        })
      : null;
    const comments = freezeRecord({
      available: actionState.available,
      count: commentCount,
      latest: latestComment,
      reason: actionState.available ? "available" : actionState.reason
    });

    return freezeRecord({
      versionId: versionId.value,
      canShowActions: actionState.available,
      actionReason: actionState.reason,
      originLink,
      download,
      append,
      progress,
      lifecycle,
      management,
      favorite,
      comments
    });
  }

  return freezeRecord({
    buildVersionUiModel,
    normalizeExternalHttpUrl,
    normalizeWorkerDownloadUrl,
    normalizeLifecycleState
  });
});
