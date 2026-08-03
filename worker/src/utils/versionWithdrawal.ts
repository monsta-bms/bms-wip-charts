export type WithdrawalDbStatus =
  | "pending"
  | "processing"
  | "canceled"
  | "deleted"
  | "tombstoned";

export type PublicLifecycleStatus =
  | "active"
  | "withdrawal_pending"
  | "processing"
  | "legacy_withdrawn"
  | "legacy_delete_pending"
  | "tombstoned";

export type LifecycleProjection = {
  lifecycle_withdrawal_status: WithdrawalDbStatus | null;
  lifecycle_request_mode: "immediate" | "deferred" | null;
  lifecycle_handling_mode: "immediate_delete" | "grace_auto_delete" | "manual_review" | null;
  lifecycle_requested_at: string | null;
  lifecycle_scheduled_at: string | null;
  lifecycle_can_cancel: number | null;
};

export type VersionLifecycleAccess = {
  publicContent: boolean;
  download: boolean;
  append: boolean;
  management: boolean;
  fixedMessage: string | null;
};

export function resolveVersionLifecycleAccess(status: PublicLifecycleStatus): VersionLifecycleAccess {
  if (status === "processing") {
    return {
      publicContent: false,
      download: false,
      append: false,
      management: false,
      fixedMessage: "取り下げ処理中"
    };
  }
  if (status === "tombstoned") {
    return {
      publicContent: false,
      download: false,
      append: false,
      management: false,
      fixedMessage: "投稿者により取り下げられました"
    };
  }
  return {
    publicContent: true,
    download: true,
    append: true,
    management: true,
    fixedMessage: null
  };
}

export function isVersionContentAccessible(status: PublicLifecycleStatus | string | null): boolean {
  return !["processing", "tombstoned", "deleted"].includes(status || "");
}

export function sanitizePublicVersion<T extends Record<string, unknown>>(
  version: T,
  status: PublicLifecycleStatus
): T | Record<string, unknown> {
  const access = resolveVersionLifecycleAccess(status);
  if (access.publicContent) return version;

  return {
    id: version.id ?? null,
    parentVersionId: version.parentVersionId ?? null,
    versionNumber: version.versionNumber ?? null,
    branchLabel: version.branchLabel ?? "",
    branchPath: version.branchPath ?? "",
    displayVersion: version.displayVersion ?? "",
    createdAt: version.createdAt ?? null,
    lifecycleStatus: status,
    lifecycleMessage: access.fixedMessage,
    lifecycleHelp: status === "tombstoned"
      ? "派生版を維持するため、版ツリー上の履歴だけ残っています。"
      : "処理完了までしばらくお待ちください。",
    publicDataRedacted: true,
    chartName: "",
    author: "",
    authorsJson: null,
    progress: 0,
    playNotes: null,
    firstNoteMeasure: null,
    lastNoteMeasure: null,
    targetMeasureCount: null,
    measureNotes: null,
    miniView: { available: false, mode: null, url: null },
    progressMap: null,
    progressImage: null,
    completed: false,
    completedAt: null,
    withdrawn: false,
    withdrawnAt: null,
    deleteRequested: false,
    deleteRequestedAt: null,
    requestMode: null,
    handlingMode: null,
    withdrawalRequestedAt: null,
    scheduledAt: null,
    canCancelWithdrawal: false,
    hidden: false,
    hiddenReason: null,
    hiddenAt: null,
    downloadBlocked: true,
    downloadBlockReason: null,
    downloadBlockedAt: null,
    collapsedByCompletion: false,
    collapsedReason: null,
    collapsedAt: null,
    collapsedByVersionId: null,
    comment: "",
    commentCount: 0,
    latestComment: null,
    difficulty: null,
    level: null,
    title: "",
    subtitle: "",
    artist: "",
    subartist: "",
    md5: null,
    originUrl: null,
    isRejected: false,
    allowAppend: false,
    appendAvailable: false,
    downloadAvailable: false,
    managementAvailable: false,
    file: null,
    within24Hours: false,
    hasChildVersions: false,
    hasDescendants: false,
    childVersionCount: 0,
    visibleChildVersionCount: 0,
    totalChildVersionCount: 0,
    updatedAt: null
  };
}

export function publicWithdrawalExclusionSql(versionAlias = "versions"): string {
  return `NOT EXISTS (
    SELECT 1
    FROM version_withdrawals AS public_withdrawals
    WHERE public_withdrawals.version_id = ${versionAlias}.id
      AND public_withdrawals.status IN ('processing', 'tombstoned', 'deleted')
  )`;
}

export function difficultyTableWithdrawalExclusionSql(versionAlias = "versions"): string {
  return `NOT EXISTS (
    SELECT 1
    FROM version_withdrawals AS difficulty_withdrawals
    WHERE difficulty_withdrawals.version_id = ${versionAlias}.id
      AND difficulty_withdrawals.status IN ('pending', 'processing', 'tombstoned', 'deleted')
  )`;
}

export function appendLifecycleAllowedSql(versionAlias = "versions"): string {
  return `NOT EXISTS (
    SELECT 1
    FROM version_withdrawals AS append_withdrawals
    WHERE append_withdrawals.version_id = ${versionAlias}.id
      AND append_withdrawals.status IN ('processing', 'tombstoned', 'deleted')
  )`;
}

export function lifecycleProjectionSql(versionAlias = "versions"): string {
  const latest = (column: string) => `(
    SELECT lifecycle.${column}
    FROM version_withdrawals AS lifecycle
    WHERE lifecycle.version_id = ${versionAlias}.id
    ORDER BY lifecycle.requested_at DESC, lifecycle.id DESC
    LIMIT 1
  )`;
  const publicRequestMetadata = (expression: string) => `CASE
      WHEN ${latest("status")} IN ('pending', 'processing', 'tombstoned', 'deleted') THEN ${expression}
      ELSE NULL
    END`;
  const handlingMode = `COALESCE(
      ${latest("handling_mode")},
      CASE
        WHEN ${latest("request_mode")} = 'immediate' THEN 'immediate_delete'
        WHEN ${latest("request_mode")} = 'deferred' THEN 'grace_auto_delete'
        ELSE NULL
      END
    )`;

  return `
    ${latest("status")} AS lifecycle_withdrawal_status,
    ${publicRequestMetadata(latest("request_mode"))} AS lifecycle_request_mode,
    ${publicRequestMetadata(handlingMode)} AS lifecycle_handling_mode,
    ${publicRequestMetadata(latest("requested_at"))} AS lifecycle_requested_at,
    ${publicRequestMetadata(latest("scheduled_at"))} AS lifecycle_scheduled_at,
    CASE
      WHEN ${latest("status")} = 'pending'
        AND (
          COALESCE(${latest("handling_mode")}, CASE WHEN ${latest("request_mode")} = 'deferred' THEN 'grace_auto_delete' END) = 'manual_review'
          OR (
            COALESCE(${latest("handling_mode")}, CASE WHEN ${latest("request_mode")} = 'deferred' THEN 'grace_auto_delete' END) = 'grace_auto_delete'
            AND CURRENT_TIMESTAMP < ${latest("scheduled_at")}
          )
        )
      THEN 1
      ELSE 0
    END AS lifecycle_can_cancel
  `;
}

export function resolvePublicLifecycleStatus(
  row: LifecycleProjection & {
    withdrawn_at?: string | null;
    delete_requested_at?: string | null;
  }
): PublicLifecycleStatus {
  if (row.lifecycle_withdrawal_status === "pending") {
    return "withdrawal_pending";
  }
  if (row.lifecycle_withdrawal_status === "processing") {
    return "processing";
  }
  if (row.lifecycle_withdrawal_status === "tombstoned" || row.lifecycle_withdrawal_status === "deleted") {
    return "tombstoned";
  }
  if (row.withdrawn_at) {
    return "legacy_withdrawn";
  }
  if (row.delete_requested_at) {
    return "legacy_delete_pending";
  }
  return "active";
}
