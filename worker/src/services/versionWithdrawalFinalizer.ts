import { Env, errorDetail } from "../utils/response";
import { WithdrawalDbStatus } from "../utils/versionWithdrawal";
import { WithdrawalHandlingMode } from "../utils/withdrawalHandling";

const DEFAULT_LEASE_MINUTES = 10;
const DEFAULT_RETRY_DELAY_MINUTES = 5;
const DEFAULT_DUE_LIMIT = 20;

type ProcessingMode = "delete" | "tombstone";

export type WithdrawalFinalizerHooks = {
  afterClaim?: (context: { withdrawalId: string; versionId: string }) => void | Promise<void>;
  afterProcessingMode?: (context: { withdrawalId: string; versionId: string }) => void | Promise<void>;
  beforeR2Delete?: (context: { withdrawalId: string; versionId: string; kind: R2ObjectKind }) => void | Promise<void>;
  afterR2Delete?: (context: { withdrawalId: string; versionId: string }) => void | Promise<void>;
  beforeD1Finalize?: (context: { withdrawalId: string; versionId: string; mode: ProcessingMode }) => void | Promise<void>;
};

export type WithdrawalFinalizerOptions = {
  now?: Date;
  leaseMinutes?: number;
  retryDelayMinutes?: number;
  expectedHandlingMode?: WithdrawalHandlingMode;
  hooks?: WithdrawalFinalizerHooks;
};

export type ProcessDueWithdrawalOptions = WithdrawalFinalizerOptions & { limit?: number };

type WithdrawalRow = {
  id: string;
  version_id: string;
  chart_id: string;
  status: WithdrawalDbStatus;
  request_mode: "immediate" | "deferred";
  handling_mode: WithdrawalHandlingMode;
  scheduled_at: string;
  processing_mode: ProcessingMode | null;
  processing_at: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  last_error_code: string | null;
  resolved_at: string | null;
};

export type VersionDeletionDependencies = {
  versionId: string;
  chartId: string;
  songId: string;
  r2Key: string;
  progressImageKey: string | null;
  versionIsHidden: boolean;
  chartIsHidden: boolean;
  withdrawnAt: string | null;
  deleteRequestedAt: string | null;
  fileDeletedAt: string | null;
  directChildCount: number;
  collapsedReferenceCount: number;
  legacyDeleteRequestCount: number;
  postLogReferenceCount: number;
  hasDeletionBlockers: boolean;
};

type R2ObjectKind = "chart_file" | "progress_image";
type VersionR2Object = { kind: R2ObjectKind; key: string };
type R2DeleteSummary = {
  objectCount: number;
  deletedCount: number;
  alreadyMissingCount: number;
  failedCount: number;
};

export type WithdrawalFinalizerResult = {
  withdrawalId: string;
  versionId: string;
  requestMode: "immediate" | "deferred";
  handlingMode: WithdrawalHandlingMode;
  status: WithdrawalDbStatus;
  outcome: "deleted" | "tombstoned" | "manual_review" | "processing" | "pending" | "canceled" | "not_claimed";
  processingMode: ProcessingMode | null;
  attemptCount: number;
  retryable: boolean;
  errorCode: string | null;
};

export type ProcessDueWithdrawalSummary = {
  selectedCount: number;
  processedCount: number;
  deletedCount: number;
  tombstonedCount: number;
  manualReviewCount: number;
  processingCount: number;
  skippedCount: number;
  results: WithdrawalFinalizerResult[];
};

class FinalizerError extends Error {
  constructor(
    readonly code: string,
    readonly stage: string,
    readonly retryable: boolean,
    message: string,
    readonly r2Summary?: R2DeleteSummary
  ) {
    super(message);
    this.name = "FinalizerError";
  }
}

function deletionBlockersSql(versionAlias = "versions"): string {
  // Public state is irrelevant here: every structural/legacy reference must preserve the row.
  return `(
    EXISTS (SELECT 1 FROM versions AS children WHERE children.parent_version_id = ${versionAlias}.id)
    OR EXISTS (SELECT 1 FROM versions AS refs WHERE refs.collapsed_by_version_id = ${versionAlias}.id)
    OR EXISTS (SELECT 1 FROM delete_requests AS requests WHERE requests.version_id = ${versionAlias}.id)
  )`;
}

function noDeletionBlockersSql(versionAlias = "versions"): string {
  return `NOT ${deletionBlockersSql(versionAlias)}`;
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

async function selectWithdrawal(env: Env, withdrawalId: string): Promise<WithdrawalRow | null> {
  return env.DB.prepare(`
    SELECT
      id, version_id, chart_id, status, request_mode,
      COALESCE(handling_mode, CASE WHEN request_mode = 'immediate' THEN 'immediate_delete' ELSE 'grace_auto_delete' END) AS handling_mode,
      scheduled_at,
      processing_mode, processing_at, lease_token, lease_expires_at,
      attempt_count, last_error_code, resolved_at
    FROM version_withdrawals
    WHERE id = ?
    LIMIT 1
  `).bind(withdrawalId).first<WithdrawalRow>();
}

function resultFromRow(row: WithdrawalRow | null): WithdrawalFinalizerResult {
  if (!row) {
    return {
      withdrawalId: "",
      versionId: "",
      requestMode: "deferred",
      handlingMode: "grace_auto_delete",
      status: "processing",
      outcome: "not_claimed",
      processingMode: null,
      attemptCount: 0,
      retryable: false,
      errorCode: "WITHDRAWAL_NOT_FOUND"
    };
  }
  const outcome = row.status === "deleted"
    ? "deleted"
    : row.status === "tombstoned"
      ? "tombstoned"
      : row.status === "processing"
        ? "processing"
        : row.status === "pending"
          ? "pending"
          : row.status === "canceled"
            ? "canceled"
            : "not_claimed";
  return {
    withdrawalId: row.id,
    versionId: row.version_id,
    requestMode: row.request_mode,
    handlingMode: row.handling_mode,
    status: row.status,
    outcome,
    processingMode: row.processing_mode,
    attemptCount: Number(row.attempt_count ?? 0),
    retryable: row.status === "processing",
    errorCode: row.last_error_code
  };
}

export async function claimVersionWithdrawal(
  env: Env,
  withdrawalId: string,
  options: WithdrawalFinalizerOptions = {}
): Promise<{ claimed: boolean; row: WithdrawalRow | null; leaseToken: string | null }> {
  const now = options.now ?? new Date();
  const leaseMinutes = positiveInteger(options.leaseMinutes, DEFAULT_LEASE_MINUTES);
  const nowSql = toSqlTimestamp(now);
  const leaseExpiresSql = toSqlTimestamp(addMinutes(now, leaseMinutes));
  const leaseToken = crypto.randomUUID();
  const expectedHandlingMode = options.expectedHandlingMode ?? null;
  const result = await env.DB.prepare(`
    UPDATE version_withdrawals
    SET
      status = 'processing',
      processing_at = COALESCE(processing_at, ?),
      lease_token = ?,
      lease_expires_at = ?,
      attempt_count = attempt_count + 1,
      last_error_code = NULL,
      updated_at = ?
    WHERE id = ?
      AND (
        (
          status = 'pending'
          AND (
            handling_mode = 'immediate_delete'
            OR (handling_mode = 'grace_auto_delete' AND scheduled_at <= ?)
          )
        )
        OR (
          status = 'processing'
          AND handling_mode IN ('immediate_delete', 'grace_auto_delete')
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        )
      )
      AND (? IS NULL OR handling_mode = ?)
  `).bind(
    nowSql,
    leaseToken,
    leaseExpiresSql,
    nowSql,
    withdrawalId,
    nowSql,
    nowSql,
    expectedHandlingMode,
    expectedHandlingMode
  ).run();
  const row = await selectWithdrawal(env, withdrawalId);
  const claimed = Number(result.meta.changes ?? 0) === 1
    && row?.status === "processing"
    && row.lease_token === leaseToken;
  return { claimed, row, leaseToken: claimed ? leaseToken : null };
}

export async function inspectVersionDeletionDependencies(
  env: Env,
  versionId: string
): Promise<VersionDeletionDependencies | null> {
  const row = await env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.chart_id AS chart_id,
      charts.song_id AS song_id,
      versions.r2_key AS r2_key,
      versions.progress_image_key AS progress_image_key,
      versions.is_hidden AS version_is_hidden,
      charts.is_hidden AS chart_is_hidden,
      versions.withdrawn_at AS withdrawn_at,
      versions.delete_requested_at AS delete_requested_at,
      versions.file_deleted_at AS file_deleted_at,
      (SELECT COUNT(*) FROM versions AS children WHERE children.parent_version_id = versions.id) AS direct_child_count,
      (SELECT COUNT(*) FROM versions AS refs WHERE refs.collapsed_by_version_id = versions.id) AS collapsed_reference_count,
      (SELECT COUNT(*) FROM delete_requests AS requests WHERE requests.version_id = versions.id) AS legacy_delete_request_count,
      (SELECT COUNT(*) FROM post_logs AS logs WHERE logs.version_id = versions.id) AS post_log_reference_count,
      CASE WHEN ${deletionBlockersSql("versions")} THEN 1 ELSE 0 END AS has_deletion_blockers
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<{
    version_id: string;
    chart_id: string;
    song_id: string;
    r2_key: string;
    progress_image_key: string | null;
    version_is_hidden: number;
    chart_is_hidden: number;
    withdrawn_at: string | null;
    delete_requested_at: string | null;
    file_deleted_at: string | null;
    direct_child_count: number;
    collapsed_reference_count: number;
    legacy_delete_request_count: number;
    post_log_reference_count: number;
    has_deletion_blockers: number;
  }>();
  if (!row) return null;
  return {
    versionId: row.version_id,
    chartId: row.chart_id,
    songId: row.song_id,
    r2Key: row.r2_key,
    progressImageKey: row.progress_image_key,
    versionIsHidden: Number(row.version_is_hidden) === 1,
    chartIsHidden: Number(row.chart_is_hidden) === 1,
    withdrawnAt: row.withdrawn_at,
    deleteRequestedAt: row.delete_requested_at,
    fileDeletedAt: row.file_deleted_at,
    directChildCount: Number(row.direct_child_count ?? 0),
    collapsedReferenceCount: Number(row.collapsed_reference_count ?? 0),
    legacyDeleteRequestCount: Number(row.legacy_delete_request_count ?? 0),
    postLogReferenceCount: Number(row.post_log_reference_count ?? 0),
    hasDeletionBlockers: Number(row.has_deletion_blockers ?? 0) === 1
  };
}

export function hasDeletionBlockers(snapshot: VersionDeletionDependencies): boolean {
  return snapshot.hasDeletionBlockers;
}

export type VersionDeletionLifecycleConflictCode =
  | "LEGACY_LIFECYCLE_CONFLICT"
  | "EXTERNAL_VERSION_STATE_CONFLICT";

export function getVersionDeletionLifecycleConflictCode(
  snapshot: VersionDeletionDependencies
): VersionDeletionLifecycleConflictCode | null {
  if (snapshot.withdrawnAt) {
    return "LEGACY_LIFECYCLE_CONFLICT";
  }
  if (
    snapshot.versionIsHidden
    || snapshot.chartIsHidden
    || snapshot.fileDeletedAt
    || (snapshot.deleteRequestedAt !== null && snapshot.legacyDeleteRequestCount === 0)
  ) {
    return "EXTERNAL_VERSION_STATE_CONFLICT";
  }
  return null;
}

function assertNoExternalLifecycleConflict(snapshot: VersionDeletionDependencies): void {
  const conflictCode = getVersionDeletionLifecycleConflictCode(snapshot);
  if (conflictCode) {
    throw new FinalizerError(
      conflictCode,
      "dependency_inspection",
      false,
      conflictCode === "LEGACY_LIFECYCLE_CONFLICT"
        ? "The version entered the legacy withdrawal lifecycle."
        : "The version state was changed by another lifecycle operation."
    );
  }
}

export function collectVersionR2Objects(snapshot: VersionDeletionDependencies): VersionR2Object[] {
  const candidates: VersionR2Object[] = [
    { kind: "chart_file", key: snapshot.r2Key },
    ...(snapshot.progressImageKey
      ? [{ kind: "progress_image" as const, key: snapshot.progressImageKey }]
      : [])
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.key || seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });
}

export async function deleteVersionR2Objects(
  env: Env,
  withdrawalId: string,
  versionId: string,
  objects: VersionR2Object[],
  hooks: WithdrawalFinalizerHooks = {}
): Promise<R2DeleteSummary> {
  let deletedCount = 0;
  let alreadyMissingCount = 0;
  let failedCount = 0;
  for (const object of objects) {
    try {
      await hooks.beforeR2Delete?.({ withdrawalId, versionId, kind: object.kind });
      const guardedSnapshot = await inspectVersionDeletionDependencies(env, versionId);
      if (!guardedSnapshot) {
        throw new FinalizerError(
          "WITHDRAWAL_VERSION_MISSING",
          "r2_delete_guard",
          false,
          "The processing withdrawal has no version row immediately before R2 cleanup.",
          { objectCount: objects.length, deletedCount, alreadyMissingCount, failedCount }
        );
      }
      assertNoExternalLifecycleConflict(guardedSnapshot);
      if (hasDeletionBlockers(guardedSnapshot)) {
        const cleanupStarted = deletedCount > 0 || alreadyMissingCount > 0;
        throw new FinalizerError(
          cleanupStarted
            ? "WITHDRAWAL_DEPENDENCY_RACE_AFTER_R2"
            : "WITHDRAWAL_DEPENDENCY_DETECTED_BEFORE_R2",
          cleanupStarted ? "r2_delete_guard_after_cleanup" : "r2_delete_guard",
          false,
          cleanupStarted
            ? "A deletion dependency appeared after R2 cleanup started."
            : "A deletion dependency appeared immediately before R2 cleanup.",
          { objectCount: objects.length, deletedCount, alreadyMissingCount, failedCount }
        );
      }
      const existing = await env.FILES.head(object.key);
      if (!existing) {
        alreadyMissingCount += 1;
        continue;
      }
      await env.FILES.delete(object.key);
      if (await env.FILES.head(object.key)) {
        throw new Error(`R2 object remained after deletion for kind=${object.kind}.`);
      }
      deletedCount += 1;
    } catch (error) {
      if (error instanceof FinalizerError) throw error;
      failedCount += 1;
    }
  }
  const summary = { objectCount: objects.length, deletedCount, alreadyMissingCount, failedCount };
  if (failedCount > 0) {
    throw new FinalizerError(
      "WITHDRAWAL_R2_DELETE_FAILED",
      "r2_delete",
      true,
      "One or more version-owned R2 objects could not be deleted.",
      summary
    );
  }
  return summary;
}

async function setProcessingMode(
  env: Env,
  withdrawalId: string,
  leaseToken: string,
  mode: ProcessingMode,
  now: Date
): Promise<void> {
  const result = await env.DB.prepare(`
    UPDATE version_withdrawals
    SET processing_mode = ?, updated_at = ?
    WHERE id = ? AND status = 'processing' AND lease_token = ?
  `).bind(mode, toSqlTimestamp(now), withdrawalId, leaseToken).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new FinalizerError(
      "WITHDRAWAL_LEASE_CONFLICT",
      "processing_mode",
      true,
      "The withdrawal lease changed before processing mode was stored."
    );
  }
}

async function moveWithdrawalToManualReview(
  env: Env,
  withdrawal: WithdrawalRow,
  leaseToken: string,
  now: Date,
  options: {
    errorCode?: string | null;
    fallbackReason?: string;
    requireVersion?: boolean;
  } = {}
): Promise<WithdrawalFinalizerResult | null> {
  const nowSql = toSqlTimestamp(now);
  const errorCode = options.errorCode ?? null;
  const fallbackReason = options.fallbackReason
    ?? "申請確定後に派生版または参照が追加されたため、管理者確認へ移行しました。";
  const requireVersion = options.requireVersion ?? true;
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE versions
      SET withdrawal_download_blocked = 1, updated_at = ?
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM version_withdrawals
          WHERE id = ? AND status = 'processing' AND lease_token = ?
        )
    `).bind(nowSql, withdrawal.version_id, withdrawal.id, leaseToken),
    env.DB.prepare(`
      UPDATE version_withdrawals
      SET
        status = 'pending',
        handling_mode = 'manual_review',
        request_reason = COALESCE(
          request_reason,
          ?
        ),
        processing_mode = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = ?,
        updated_at = ?
      WHERE id = ? AND status = 'processing' AND lease_token = ?
        ${requireVersion ? `AND EXISTS (
          SELECT 1 FROM versions
          WHERE id = ? AND withdrawal_download_blocked = 1
        )` : ""}
    `).bind(
      fallbackReason,
      errorCode,
      nowSql,
      withdrawal.id,
      leaseToken,
      ...(requireVersion ? [withdrawal.version_id] : [])
    )
  ]);
  if (
    (requireVersion && Number(results[0]?.meta.changes ?? 0) !== 1)
    || Number(results[1]?.meta.changes ?? 0) !== 1
  ) {
    return null;
  }
  const row = await selectWithdrawal(env, withdrawal.id);
  if (!row || row.status !== "pending" || row.handling_mode !== "manual_review") return null;
  return {
    ...resultFromRow(row),
    outcome: "manual_review",
    retryable: false,
    errorCode
  };
}

export async function finalizeVersionDeletion(
  env: Env,
  withdrawal: WithdrawalRow,
  leaseToken: string,
  snapshot: VersionDeletionDependencies,
  now: Date
): Promise<WithdrawalFinalizerResult | null> {
  const nowSql = toSqlTimestamp(now);
  const results = await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM versions
      WHERE id = ?
        AND is_hidden = 0
        AND withdrawn_at IS NULL
        AND file_deleted_at IS NULL
        AND delete_requested_at IS NULL
        AND EXISTS (
          SELECT 1 FROM charts
          WHERE charts.id = versions.chart_id AND charts.is_hidden = 0
        )
        AND ${noDeletionBlockersSql("versions")}
        AND EXISTS (
          SELECT 1 FROM version_withdrawals
          WHERE id = ? AND status = 'processing' AND lease_token = ? AND processing_mode = 'delete'
        )
    `).bind(snapshot.versionId, withdrawal.id, leaseToken),
    env.DB.prepare(`
      UPDATE version_withdrawals
      SET
        status = 'deleted', processing_mode = 'delete', resolved_at = ?,
        lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL, updated_at = ?
      WHERE id = ? AND status = 'processing' AND lease_token = ?
        AND NOT EXISTS (SELECT 1 FROM versions WHERE versions.id = ?)
    `).bind(nowSql, nowSql, withdrawal.id, leaseToken, snapshot.versionId),
    env.DB.prepare(`
      DELETE FROM charts
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM versions WHERE versions.chart_id = charts.id)
    `).bind(snapshot.chartId),
    env.DB.prepare(`
      DELETE FROM songs
      WHERE id = ? AND NOT EXISTS (SELECT 1 FROM charts WHERE charts.song_id = songs.id)
    `).bind(snapshot.songId)
  ]);
  if (Number(results[0]?.meta.changes ?? 0) === 1 && Number(results[1]?.meta.changes ?? 0) === 1) {
    return resultFromRow(await selectWithdrawal(env, withdrawal.id));
  }
  return null;
}

async function writeFinalizerLog(
  env: Env,
  withdrawal: WithdrawalRow,
  level: "info" | "warning" | "error",
  outcome: string,
  stage: string,
  errorCode: string | null,
  retryable: boolean,
  r2Summary?: R2DeleteSummary
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_logs (id, action, target_type, target_id, level, code, reason, detail)
      VALUES (?, 'version_withdrawal_finalize', 'version', ?, ?, ?, ?, ?)
    `).bind(
      makeId("admin_log"),
      withdrawal.version_id,
      level,
      errorCode,
      outcome,
      JSON.stringify({
        operation: "finalize_version_withdrawal",
        withdrawalId: withdrawal.id,
        versionId: withdrawal.version_id,
        requestMode: withdrawal.request_mode,
        handlingMode: withdrawal.handling_mode,
        processingMode: withdrawal.processing_mode,
        outcome,
        stage,
        errorCode,
        attemptCount: Number(withdrawal.attempt_count ?? 0),
        retryable,
        r2ObjectCount: r2Summary?.objectCount ?? null,
        r2DeletedCount: r2Summary?.deletedCount ?? null,
        r2AlreadyMissingCount: r2Summary?.alreadyMissingCount ?? null,
        r2FailedCount: r2Summary?.failedCount ?? null
      })
    ).run();
  } catch (error) {
    console.error("[version-withdrawal-finalizer-log] failed", {
      code: "ADMIN_LOG_WRITE_FAILED",
      withdrawalId: withdrawal.id,
      versionId: withdrawal.version_id,
      message: errorDetail(error)
    });
  }
}

async function releaseFailedLease(
  env: Env,
  withdrawal: WithdrawalRow,
  leaseToken: string,
  errorCode: string,
  now: Date,
  retryDelayMinutes: number
): Promise<WithdrawalRow> {
  await env.DB.prepare(`
    UPDATE version_withdrawals
    SET last_error_code = ?, lease_token = NULL, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'processing' AND lease_token = ?
  `).bind(
    errorCode,
    toSqlTimestamp(addMinutes(now, retryDelayMinutes)),
    toSqlTimestamp(now),
    withdrawal.id,
    leaseToken
  ).run();
  return await selectWithdrawal(env, withdrawal.id) ?? withdrawal;
}

export async function finalizeVersionWithdrawal(
  env: Env,
  withdrawalId: string,
  options: WithdrawalFinalizerOptions = {}
): Promise<WithdrawalFinalizerResult> {
  const now = options.now ?? new Date();
  const retryDelayMinutes = positiveInteger(options.retryDelayMinutes, DEFAULT_RETRY_DELAY_MINUTES);
  const claim = await claimVersionWithdrawal(env, withdrawalId, { ...options, now });
  if (!claim.claimed || !claim.row || !claim.leaseToken) {
    const result = resultFromRow(claim.row);
    if (!claim.row) result.withdrawalId = withdrawalId;
    if (options.expectedHandlingMode) {
      result.outcome = "not_claimed";
      result.retryable = false;
    }
    return result;
  }

  const withdrawal = claim.row;
  const leaseToken = claim.leaseToken;
  let r2Summary: R2DeleteSummary | undefined;
  try {
    await options.hooks?.afterClaim?.({
      withdrawalId: withdrawal.id,
      versionId: withdrawal.version_id
    });
    let snapshot = await inspectVersionDeletionDependencies(env, withdrawal.version_id);
    if (!snapshot) {
      throw new FinalizerError(
        "WITHDRAWAL_VERSION_MISSING",
        "dependency_inspection",
        false,
        "The processing withdrawal has no version row."
      );
    }
    assertNoExternalLifecycleConflict(snapshot);

    if (hasDeletionBlockers(snapshot)) {
      const moved = await moveWithdrawalToManualReview(env, withdrawal, leaseToken, now);
      if (!moved) {
        throw new FinalizerError(
          "WITHDRAWAL_D1_FINALIZE_FAILED",
          "move_to_manual_review",
          true,
          "The withdrawal could not be moved to manual review."
        );
      }
      const finalRow = await selectWithdrawal(env, withdrawal.id) ?? withdrawal;
      await writeFinalizerLog(env, finalRow, "info", "manual_review", "dependency_recheck", null, false);
      return moved;
    }

    let mode: ProcessingMode = "delete";
    await setProcessingMode(env, withdrawal.id, leaseToken, mode, now);
    withdrawal.processing_mode = mode;
    await options.hooks?.afterProcessingMode?.({
      withdrawalId: withdrawal.id,
      versionId: withdrawal.version_id
    });

    snapshot = await inspectVersionDeletionDependencies(env, withdrawal.version_id);
    if (!snapshot) {
      throw new FinalizerError(
        "WITHDRAWAL_VERSION_MISSING",
        "pre_r2_reinspection",
        false,
        "The processing withdrawal has no version row before R2 cleanup."
      );
    }
    assertNoExternalLifecycleConflict(snapshot);
    if (hasDeletionBlockers(snapshot)) {
      const moved = await moveWithdrawalToManualReview(env, withdrawal, leaseToken, now);
      if (!moved) {
        throw new FinalizerError(
          "WITHDRAWAL_D1_FINALIZE_FAILED",
          "move_to_manual_review",
          true,
          "The withdrawal could not be moved to manual review."
        );
      }
      const finalRow = await selectWithdrawal(env, withdrawal.id) ?? withdrawal;
      await writeFinalizerLog(env, finalRow, "info", "manual_review", "pre_r2_reinspection", null, false);
      return moved;
    }

    try {
      r2Summary = await deleteVersionR2Objects(
        env,
        withdrawal.id,
        withdrawal.version_id,
        collectVersionR2Objects(snapshot),
        options.hooks
      );
    } catch (error) {
      if (error instanceof FinalizerError) {
        r2Summary = error.r2Summary ?? r2Summary;
        throw error;
      }
      throw new FinalizerError("WITHDRAWAL_R2_DELETE_FAILED", "r2_delete", true, errorDetail(error));
    }
    await options.hooks?.afterR2Delete?.({
      withdrawalId: withdrawal.id,
      versionId: withdrawal.version_id
    });

    snapshot = await inspectVersionDeletionDependencies(env, withdrawal.version_id);
    if (!snapshot) {
      throw new FinalizerError(
        "WITHDRAWAL_VERSION_MISSING",
        "pre_d1_reinspection",
        false,
        "The version disappeared after R2 cleanup."
      );
    }
    assertNoExternalLifecycleConflict(snapshot);
    if (hasDeletionBlockers(snapshot)) {
      throw new FinalizerError(
        "WITHDRAWAL_DEPENDENCY_RACE_AFTER_R2",
        "post_r2_dependency_recheck",
        false,
        "A deletion dependency appeared after R2 cleanup."
      );
    }

    await options.hooks?.beforeD1Finalize?.({
      withdrawalId: withdrawal.id,
      versionId: withdrawal.version_id,
      mode
    });

    let terminal = await finalizeVersionDeletion(env, withdrawal, leaseToken, snapshot, now);

    if (!terminal) {
      const refreshed = await inspectVersionDeletionDependencies(env, withdrawal.version_id);
      if (refreshed && hasDeletionBlockers(refreshed)) {
        throw new FinalizerError(
          "WITHDRAWAL_DEPENDENCY_RACE_AFTER_R2",
          "d1_finalize",
          false,
          "A deletion dependency appeared before the terminal D1 update."
        );
      }
    }

    if (!terminal) {
      const latest = await selectWithdrawal(env, withdrawal.id);
      if (latest?.status === "deleted" || latest?.status === "tombstoned") {
        terminal = resultFromRow(latest);
      } else if (!await inspectVersionDeletionDependencies(env, withdrawal.version_id)) {
        throw new FinalizerError(
          "WITHDRAWAL_VERSION_MISSING",
          "d1_finalize",
          false,
          "The version disappeared without a terminal lifecycle update."
        );
      } else {
        throw new FinalizerError(
          "WITHDRAWAL_D1_FINALIZE_FAILED",
          "d1_finalize",
          true,
          "The terminal D1 transaction did not update the expected rows."
        );
      }
    }

    const finalRow = await selectWithdrawal(env, withdrawal.id) ?? withdrawal;
    await writeFinalizerLog(env, finalRow, "info", terminal.outcome, "complete", null, false, r2Summary);
    return terminal;
  } catch (error) {
    const failure = error instanceof FinalizerError
      ? error
      : new FinalizerError("WITHDRAWAL_D1_FINALIZE_FAILED", "unexpected", true, errorDetail(error));
    if (!failure.retryable) {
      let reviewed: WithdrawalFinalizerResult | null = null;
      try {
        reviewed = await moveWithdrawalToManualReview(
          env,
          withdrawal,
          leaseToken,
          now,
          {
            errorCode: failure.code,
            fallbackReason: "自動削除処理で安全に完了できなかったため、管理者確認へ移行しました。",
            requireVersion: false
          }
        );
      } catch {
        console.error("[version-withdrawal-finalizer] manual review transition failed", {
          code: "WITHDRAWAL_REVIEW_TRANSITION_FAILED",
          withdrawalId: withdrawal.id,
          versionId: withdrawal.version_id,
          stage: failure.stage
        });
      }
      if (reviewed) {
        const reviewedRow = await selectWithdrawal(env, withdrawal.id) ?? withdrawal;
        await writeFinalizerLog(
          env,
          reviewedRow,
          "error",
          "manual_review",
          failure.stage,
          failure.code,
          false,
          r2Summary ?? failure.r2Summary
        );
        return reviewed;
      }
    }
    const failedRow = await releaseFailedLease(
      env,
      withdrawal,
      leaseToken,
      failure.retryable ? failure.code : "WITHDRAWAL_REVIEW_TRANSITION_FAILED",
      now,
      retryDelayMinutes
    );
    await writeFinalizerLog(
      env,
      failedRow,
      "warning",
      "processing",
      failure.stage,
      failure.retryable ? failure.code : "WITHDRAWAL_REVIEW_TRANSITION_FAILED",
      true,
      r2Summary ?? failure.r2Summary
    );
    return {
      ...resultFromRow(failedRow),
      outcome: "processing",
      status: "processing",
      retryable: true,
      errorCode: failure.retryable ? failure.code : "WITHDRAWAL_REVIEW_TRANSITION_FAILED"
    };
  }
}

export async function processDueVersionWithdrawals(
  env: Env,
  options: ProcessDueWithdrawalOptions = {}
): Promise<ProcessDueWithdrawalSummary> {
  const now = options.now ?? new Date();
  const limit = Math.min(100, positiveInteger(options.limit, DEFAULT_DUE_LIMIT));
  const result = await env.DB.prepare(`
    SELECT id
    FROM version_withdrawals
    WHERE (
      status = 'pending' AND (
        handling_mode = 'immediate_delete'
        OR (handling_mode = 'grace_auto_delete' AND scheduled_at <= ?)
      )
    ) OR (
      status = 'processing'
      AND handling_mode IN ('immediate_delete', 'grace_auto_delete')
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    )
    ORDER BY scheduled_at ASC, id ASC
    LIMIT ?
  `).bind(toSqlTimestamp(now), toSqlTimestamp(now), limit).all<{ id: string }>();
  const ids = (result.results ?? []).map((row) => row.id);
  const results: WithdrawalFinalizerResult[] = [];
  for (const id of ids) {
    results.push(await finalizeVersionWithdrawal(env, id, { ...options, now }));
  }
  return {
    selectedCount: ids.length,
    processedCount: results.filter((item) => item.outcome !== "not_claimed").length,
    deletedCount: results.filter((item) => item.outcome === "deleted").length,
    tombstonedCount: results.filter((item) => item.outcome === "tombstoned").length,
    manualReviewCount: results.filter((item) => item.outcome === "manual_review").length,
    processingCount: results.filter((item) => item.outcome === "processing").length,
    skippedCount: results.filter((item) => ["not_claimed", "pending", "canceled"].includes(item.outcome)).length,
    results
  };
}
