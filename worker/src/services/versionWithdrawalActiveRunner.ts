import { Env } from "../utils/response";
import {
  finalizeVersionWithdrawal,
  WithdrawalFinalizerResult
} from "./versionWithdrawalFinalizer";

const DEFAULT_ACTIVE_LIMIT = 20;
const MAX_ACTIVE_LIMIT = 20;
const ACTIVE_LOG_ACTION = "version_withdrawal_finalize";

type ActiveWithdrawalCandidate = {
  id: string;
  version_id: string;
  status: "pending" | "processing";
  handling_mode: "grace_auto_delete" | "immediate_delete";
  scheduled_at: string;
};

export type ActiveWithdrawalCandidateSet = {
  rows: ActiveWithdrawalCandidate[];
  truncated: boolean;
};

export type WithdrawalActiveSummary = {
  runId: string;
  operation: "withdrawal_cron_active";
  mode: "active";
  scheduledTime: string;
  selectedCount: number;
  processedCount: number;
  deletedCount: number;
  manualReviewCount: number;
  processingCount: number;
  skippedCount: number;
  errorCount: number;
  immediateRecoverySelectedCount: number;
  tombstonedCount: number;
  truncated: boolean;
  durationMs: number;
  fatalErrorCode: string | null;
  results: WithdrawalFinalizerResult[];
};

export type WithdrawalActiveOptions = {
  now?: Date;
  limit?: number;
  durationNow?: () => number;
  selectCandidates?: (
    env: Env,
    now: Date,
    limit: number
  ) => Promise<ActiveWithdrawalCandidateSet>;
  finalizeCandidate?: (
    env: Env,
    withdrawalId: string,
    now: Date,
    handlingMode: ActiveWithdrawalCandidate["handling_mode"]
  ) => Promise<WithdrawalFinalizerResult>;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeActiveLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0) return DEFAULT_ACTIVE_LIMIT;
  return Math.min(Number(value), MAX_ACTIVE_LIMIT);
}

export async function findActiveWithdrawalCandidates(
  env: Env,
  now: Date,
  limit = DEFAULT_ACTIVE_LIMIT
): Promise<ActiveWithdrawalCandidateSet> {
  const normalizedLimit = normalizeActiveLimit(limit);
  const nowSql = toSqlTimestamp(now);
  const candidates = await env.DB.prepare(`
    SELECT id, version_id, status, handling_mode, scheduled_at
    FROM version_withdrawals
    WHERE (
      status = 'pending'
      AND (
        handling_mode = 'immediate_delete'
        OR (handling_mode = 'grace_auto_delete' AND scheduled_at <= ?)
      )
    ) OR (
      status = 'processing'
      AND handling_mode IN ('grace_auto_delete', 'immediate_delete')
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    )
    ORDER BY scheduled_at ASC, id ASC
    LIMIT ?
  `).bind(nowSql, nowSql, normalizedLimit + 1).all<ActiveWithdrawalCandidate>();
  const rows = candidates.results ?? [];
  return {
    rows: rows.slice(0, normalizedLimit),
    truncated: rows.length > normalizedLimit
  };
}

async function writeActiveLog(
  env: Env,
  targetType: "system" | "version",
  targetId: string,
  level: "info" | "warning" | "error",
  code: string | null,
  reason: string,
  detail: Record<string, unknown>
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO admin_logs (
      id, action, target_type, target_id, level, code, reason, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    makeId("admin_log"),
    ACTIVE_LOG_ACTION,
    targetType,
    targetId,
    level,
    code,
    reason,
    JSON.stringify(detail)
  ).run();
}

async function writeCandidateErrorLog(
  env: Env,
  runId: string,
  candidate: ActiveWithdrawalCandidate,
  code: string
): Promise<void> {
  try {
    await writeActiveLog(
      env,
      "version",
      candidate.version_id,
      "error",
      code,
      "candidate_failed",
      {
        operation: "withdrawal_cron_active_candidate",
        run_id: runId,
        withdrawal_id: candidate.id,
        version_id: candidate.version_id,
        status: candidate.status,
        scheduled_at: candidate.scheduled_at,
        handling_mode: candidate.handling_mode,
        error_code: code
      }
    );
  } catch {
    console.error("[withdrawal-active] candidate error log failed", {
      code: "WITHDRAWAL_ACTIVE_LOG_FAILED",
      runId,
      withdrawalId: candidate.id,
      versionId: candidate.version_id
    });
  }
}

export async function writeWithdrawalActiveSummary(
  env: Env,
  summary: WithdrawalActiveSummary
): Promise<void> {
  const summaryCode = summary.fatalErrorCode
    ?? (summary.tombstonedCount > 0 ? "WITHDRAWAL_ACTIVE_TOMBSTONE_DETECTED" : null);
  const reason = summary.fatalErrorCode
    ? "failed"
    : summary.errorCount > 0
      ? "completed_with_errors"
      : "completed";
  await writeActiveLog(
    env,
    "system",
    summary.runId,
    summaryCode ? "error" : summary.errorCount > 0 ? "warning" : "info",
    summaryCode,
    reason,
    {
      operation: summary.operation,
      mode: summary.mode,
      scheduled_time: summary.scheduledTime,
      selected_count: summary.selectedCount,
      processed_count: summary.processedCount,
      deleted_count: summary.deletedCount,
      manual_review_count: summary.manualReviewCount,
      processing_count: summary.processingCount,
      skipped_count: summary.skippedCount,
      error_count: summary.errorCount,
      immediate_recovery_selected_count: summary.immediateRecoverySelectedCount,
      tombstoned_count: summary.tombstonedCount,
      truncated: summary.truncated,
      duration_ms: summary.durationMs,
      fatal_error_code: summary.fatalErrorCode
    }
  );
}

function countResult(summary: WithdrawalActiveSummary, result: WithdrawalFinalizerResult): void {
  summary.results.push(result);
  if (["deleted", "manual_review", "processing", "tombstoned"].includes(result.outcome)) {
    summary.processedCount += 1;
  } else {
    summary.skippedCount += 1;
  }
  if (result.outcome === "deleted") summary.deletedCount += 1;
  else if (result.outcome === "manual_review") summary.manualReviewCount += 1;
  else if (result.outcome === "processing") summary.processingCount += 1;
  else if (result.outcome === "tombstoned") summary.tombstonedCount += 1;
  if (result.errorCode || result.outcome === "tombstoned") summary.errorCount += 1;
}

export async function runActiveDueVersionWithdrawals(
  env: Env,
  options: WithdrawalActiveOptions = {}
): Promise<WithdrawalActiveSummary> {
  const durationNow = options.durationNow ?? (() => Date.now());
  const selectCandidates = options.selectCandidates ?? findActiveWithdrawalCandidates;
  const finalizeCandidate = options.finalizeCandidate ?? ((candidateEnv, withdrawalId, now, handlingMode) => (
    finalizeVersionWithdrawal(candidateEnv, withdrawalId, {
      now,
      expectedHandlingMode: handlingMode
    })
  ));
  const startedAt = durationNow();
  const now = new Date((options.now ?? new Date()).getTime());
  const limit = normalizeActiveLimit(options.limit);
  const summary: WithdrawalActiveSummary = {
    runId: makeId("withdrawal_active"),
    operation: "withdrawal_cron_active",
    mode: "active",
    scheduledTime: now.toISOString(),
    selectedCount: 0,
    processedCount: 0,
    deletedCount: 0,
    manualReviewCount: 0,
    processingCount: 0,
    skippedCount: 0,
    errorCount: 0,
    immediateRecoverySelectedCount: 0,
    tombstonedCount: 0,
    truncated: false,
    durationMs: 0,
    fatalErrorCode: null,
    results: []
  };

  try {
    const candidates = await selectCandidates(env, now, limit);
    summary.selectedCount = candidates.rows.length;
    summary.immediateRecoverySelectedCount = candidates.rows.filter(
      (candidate) => candidate.handling_mode === "immediate_delete"
    ).length;
    summary.truncated = candidates.truncated;
    for (const candidate of candidates.rows) {
      try {
        const result = await finalizeCandidate(env, candidate.id, now, candidate.handling_mode);
        countResult(summary, result);
        if (result.outcome === "tombstoned") {
          console.error("[withdrawal-active] unexpected tombstone result", {
            code: "WITHDRAWAL_ACTIVE_TOMBSTONE_DETECTED",
            runId: summary.runId,
            withdrawalId: candidate.id,
            versionId: candidate.version_id
          });
        }
      } catch {
        summary.skippedCount += 1;
        summary.errorCount += 1;
        await writeCandidateErrorLog(
          env,
          summary.runId,
          candidate,
          "WITHDRAWAL_ACTIVE_CANDIDATE_FAILED"
        );
      }
    }
  } catch {
    summary.fatalErrorCode = "WITHDRAWAL_ACTIVE_FAILED";
    summary.errorCount += 1;
    console.error("[withdrawal-active] active run failed", {
      code: summary.fatalErrorCode,
      runId: summary.runId
    });
  } finally {
    summary.durationMs = Math.max(0, Math.round(durationNow() - startedAt));
    try {
      await writeWithdrawalActiveSummary(env, summary);
    } catch {
      console.error("[withdrawal-active] summary log failed", {
        code: "WITHDRAWAL_ACTIVE_LOG_FAILED",
        runId: summary.runId
      });
    }
  }
  return summary;
}
