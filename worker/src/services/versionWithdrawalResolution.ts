import { Env } from "../utils/response";
import { WithdrawalHandlingMode } from "../utils/withdrawalHandling";

export const ADMIN_WITHDRAWAL_REJECTION_REASON = "security_hash_cutover" as const;

type ResolutionActor = "submitter_cancel" | "admin_reject";

type ResolutionRow = {
  withdrawal_id: string;
  version_id: string;
  chart_id: string;
  status: string;
  handling_mode: WithdrawalHandlingMode;
  scheduled_at: string;
  updated_at: string;
  download_blocked: number;
  withdrawal_download_blocked: number;
  submitter_can_cancel: number;
};

type AdminAuditRow = {
  id: string;
};

export type VersionWithdrawalResolutionResult =
  | {
      ok: true;
      outcome: "canceled" | "rejected" | "already_canceled" | "already_rejected";
      withdrawalId: string;
      versionId: string;
      previousStatus: string;
      currentStatus: "canceled";
      handlingMode: WithdrawalHandlingMode;
      withdrawalBlockReleased: boolean;
      downloadRestored: boolean;
      auditId: string | null;
      auditRecorded: boolean;
    }
  | {
      ok: false;
      reason: "not_found" | "state_conflict" | "not_allowed";
      currentStatus: string | null;
      handlingMode: WithdrawalHandlingMode | null;
    };

type ResolveOptions = {
  actor: ResolutionActor;
  withdrawalId: string;
  expectedVersionId?: string;
  adminNoteLength?: number;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function selectResolutionRow(
  env: Env,
  withdrawalId: string
): Promise<ResolutionRow | null> {
  return env.DB.prepare(`
    SELECT
      withdrawals.id AS withdrawal_id,
      withdrawals.version_id,
      withdrawals.chart_id,
      withdrawals.status,
      COALESCE(
        withdrawals.handling_mode,
        CASE
          WHEN withdrawals.request_mode = 'immediate' THEN 'immediate_delete'
          ELSE 'grace_auto_delete'
        END
      ) AS handling_mode,
      withdrawals.scheduled_at,
      withdrawals.updated_at,
      versions.download_blocked,
      versions.withdrawal_download_blocked,
      CASE
        WHEN withdrawals.status = 'pending'
          AND (
            withdrawals.handling_mode = 'manual_review'
            OR (
              withdrawals.handling_mode = 'grace_auto_delete'
              AND CURRENT_TIMESTAMP < withdrawals.scheduled_at
            )
          )
        THEN 1 ELSE 0
      END AS submitter_can_cancel
    FROM version_withdrawals AS withdrawals
    INNER JOIN versions ON versions.id = withdrawals.version_id
    WHERE withdrawals.id = ?
    LIMIT 1
  `).bind(withdrawalId).first<ResolutionRow>();
}

async function selectAdminAudit(env: Env, withdrawalId: string): Promise<AdminAuditRow | null> {
  return env.DB.prepare(`
    SELECT id
    FROM admin_logs
    WHERE action = 'reject_version_withdrawal'
      AND target_type = 'version_withdrawal'
      AND target_id = ?
      AND reason = ?
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).bind(withdrawalId, ADMIN_WITHDRAWAL_REJECTION_REASON).first<AdminAuditRow>();
}

function isAllowed(row: ResolutionRow, actor: ResolutionActor): boolean {
  if (actor === "admin_reject") {
    return row.handling_mode === "manual_review";
  }
  return Number(row.submitter_can_cancel) === 1;
}

function successResult(
  row: ResolutionRow,
  actor: ResolutionActor,
  outcome: "canceled" | "rejected" | "already_canceled" | "already_rejected",
  auditId: string | null,
  auditRecorded: boolean,
  withdrawalDownloadBlocked: number
): VersionWithdrawalResolutionResult {
  return {
    ok: true,
    outcome,
    withdrawalId: row.withdrawal_id,
    versionId: row.version_id,
    previousStatus: row.status,
    currentStatus: "canceled",
    handlingMode: row.handling_mode,
    withdrawalBlockReleased:
      Number(row.withdrawal_download_blocked) === 1 && withdrawalDownloadBlocked === 0,
    downloadRestored:
      Number(row.download_blocked) === 0 && withdrawalDownloadBlocked === 0,
    auditId: actor === "admin_reject" ? auditId : null,
    auditRecorded: actor === "admin_reject" && auditRecorded
  };
}

/**
 * Resolves a pending withdrawal without deleting D1 or R2 data. The same
 * transaction is used by submitter cancellation and administrator rejection so
 * the dedicated withdrawal download block is the only block that can be lifted.
 */
export async function resolveVersionWithdrawal(
  env: Env,
  options: ResolveOptions
): Promise<VersionWithdrawalResolutionResult> {
  const row = await selectResolutionRow(env, options.withdrawalId);
  if (!row || (options.expectedVersionId && row.version_id !== options.expectedVersionId)) {
    return { ok: false, reason: "not_found", currentStatus: null, handlingMode: null };
  }

  const existingAudit = options.actor === "admin_reject"
    ? await selectAdminAudit(env, row.withdrawal_id)
    : null;
  if (row.status === "canceled") {
    if (options.actor === "admin_reject" && !existingAudit) {
      return {
        ok: false,
        reason: "state_conflict",
        currentStatus: row.status,
        handlingMode: row.handling_mode
      };
    }
    return successResult(
      row,
      options.actor,
      options.actor === "admin_reject" ? "already_rejected" : "already_canceled",
      existingAudit?.id ?? null,
      false,
      Number(row.withdrawal_download_blocked)
    );
  }
  if (row.status !== "pending") {
    return {
      ok: false,
      reason: "state_conflict",
      currentStatus: row.status,
      handlingMode: row.handling_mode
    };
  }
  if (!isAllowed(row, options.actor)) {
    return {
      ok: false,
      reason: "not_allowed",
      currentStatus: row.status,
      handlingMode: row.handling_mode
    };
  }

  const auditId = options.actor === "admin_reject" ? makeId("admin_log") : null;
  const statements: D1PreparedStatement[] = [];
  if (auditId) {
    statements.push(env.DB.prepare(`
      INSERT INTO admin_logs (
        id, action, target_type, target_id, level, code, reason, detail
      )
      SELECT
        ?, 'reject_version_withdrawal', 'version_withdrawal', withdrawals.id,
        'info', NULL, ?, ?
      FROM version_withdrawals AS withdrawals
      WHERE withdrawals.id = ?
        AND withdrawals.version_id = ?
        AND withdrawals.status = 'pending'
        AND withdrawals.handling_mode = 'manual_review'
        AND withdrawals.updated_at = ?
        AND EXISTS (
          SELECT 1 FROM versions WHERE id = withdrawals.version_id
        )
    `).bind(
      auditId,
      ADMIN_WITHDRAWAL_REJECTION_REASON,
      JSON.stringify({
        actor: "admin",
        previousStatus: "pending",
        currentStatus: "canceled",
        handlingMode: row.handling_mode,
        reasonCode: ADMIN_WITHDRAWAL_REJECTION_REASON,
        adminNoteLength: Math.max(0, options.adminNoteLength ?? 0),
        withdrawalBlockReleaseRequested: true,
        independentDownloadBlockPreserved: true
      }),
      row.withdrawal_id,
      row.version_id,
      row.updated_at
    ));
  }

  statements.push(env.DB.prepare(`
    UPDATE version_withdrawals
    SET
      status = 'canceled',
      canceled_at = CURRENT_TIMESTAMP,
      resolved_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND version_id = ?
      AND status = 'pending'
      AND updated_at = ?
      AND EXISTS (
        SELECT 1 FROM versions WHERE id = version_withdrawals.version_id
      )
      AND (
        (? = 'admin_reject' AND handling_mode = 'manual_review')
        OR (
          ? = 'submitter_cancel'
          AND (
            handling_mode = 'manual_review'
            OR (handling_mode = 'grace_auto_delete' AND CURRENT_TIMESTAMP < scheduled_at)
          )
        )
      )
  `).bind(
    row.withdrawal_id,
    row.version_id,
    row.updated_at,
    options.actor,
    options.actor
  ));
  const updateIndex = statements.length - 1;

  statements.push(env.DB.prepare(`
    UPDATE versions
    SET withdrawal_download_blocked = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND EXISTS (
        SELECT 1
        FROM version_withdrawals
        WHERE id = ?
          AND version_id = versions.id
          AND status = 'canceled'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM version_withdrawals AS active
        WHERE active.version_id = versions.id
          AND active.status IN ('pending', 'processing')
      )
  `).bind(row.version_id, row.withdrawal_id));

  const results = await env.DB.batch(statements);
  if (Number(results[updateIndex]?.meta.changes ?? 0) !== 1) {
    const latest = await selectResolutionRow(env, row.withdrawal_id);
    const latestAudit = options.actor === "admin_reject"
      ? await selectAdminAudit(env, row.withdrawal_id)
      : null;
    if (latest?.status === "canceled"
      && (options.actor !== "admin_reject" || latestAudit)) {
      return successResult(
        latest,
        options.actor,
        options.actor === "admin_reject" ? "already_rejected" : "already_canceled",
        latestAudit?.id ?? null,
        false,
        Number(latest.withdrawal_download_blocked)
      );
    }
    return {
      ok: false,
      reason: "state_conflict",
      currentStatus: latest?.status ?? null,
      handlingMode: latest?.handling_mode ?? null
    };
  }

  const refreshed = await selectResolutionRow(env, row.withdrawal_id);
  return successResult(
    row,
    options.actor,
    options.actor === "admin_reject" ? "rejected" : "canceled",
    auditId,
    Boolean(auditId),
    Number(refreshed?.withdrawal_download_blocked ?? row.withdrawal_download_blocked)
  );
}
