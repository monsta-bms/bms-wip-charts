import { Env } from "../utils/response";
import {
  getVersionDeletionLifecycleConflictCode,
  hasDeletionBlockers,
  inspectVersionDeletionDependencies
} from "./versionWithdrawalFinalizer";
import { WithdrawalHandlingMode } from "../utils/withdrawalHandling";

const DEFAULT_OBSERVE_LIMIT = 20;
const MAX_OBSERVE_LIMIT = 20;
const MAX_DIAGNOSTIC_LOGS = 5;
const OBSERVE_LOG_ACTION = "version_withdrawal_finalize";

export type WithdrawalCronMode = "off" | "observe";

export type WithdrawalCronModeResolution = {
  mode: WithdrawalCronMode;
  source: "configured" | "unset" | "invalid";
};

export type WithdrawalObserveClassification =
  | "would_delete"
  | "would_move_to_manual_review"
  | "would_retry_delete"
  | "would_retry_tombstone"
  | "manual_review"
  | "ignored";

type ObservableWithdrawalRow = {
  id: string;
  version_id: string;
  chart_id: string;
  status: "pending" | "processing" | "canceled" | "deleted" | "tombstoned";
  request_mode: "immediate" | "deferred";
  handling_mode: WithdrawalHandlingMode;
  scheduled_at: string;
  processing_mode: "delete" | "tombstone" | null;
  processing_at: string | null;
  lease_expires_at: string | null;
};

type ObservableVersionIdentity = {
  id: string;
  chart_id: string;
};

export type WithdrawalObserveResult = {
  withdrawalId: string;
  versionId: string;
  status: ObservableWithdrawalRow["status"];
  requestMode: ObservableWithdrawalRow["request_mode"];
  handlingMode: WithdrawalHandlingMode;
  scheduledAt: string;
  classification: WithdrawalObserveClassification;
  safeReasonCodes: string[];
  unexpectedError: boolean;
};

export type WithdrawalObserveSummary = {
  runId: string;
  operation: "withdrawal_cron_observe";
  mode: "observe";
  scheduledTime: string;
  scannedCount: number;
  candidateCount: number;
  wouldDeleteCount: number;
  wouldMoveToManualReviewCount: number;
  wouldRetryDeleteCount: number;
  wouldRetryTombstoneCount: number;
  manualReviewCount: number;
  ignoredCount: number;
  errorCount: number;
  truncated: boolean;
  durationMs: number;
  results: WithdrawalObserveResult[];
  fatalErrorCode: string | null;
};

export type WithdrawalObserveOptions = {
  now: Date;
  limit?: number;
  durationNow?: () => number;
  previewCandidate?: (
    env: Env,
    candidate: ObservableWithdrawalRow,
    now: Date
  ) => Promise<WithdrawalObserveResult>;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeObserveLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) <= 0) return DEFAULT_OBSERVE_LIMIT;
  return Math.min(Number(value), MAX_OBSERVE_LIMIT);
}

export function resolveWithdrawalCronMode(value: string | undefined): WithdrawalCronModeResolution {
  if (value === undefined) return { mode: "off", source: "unset" };
  if (value === "off" || value === "observe") return { mode: value, source: "configured" };
  return { mode: "off", source: "invalid" };
}

function isObservableCandidate(row: ObservableWithdrawalRow, nowSql: string): boolean {
  if (row.status === "pending") {
    return row.handling_mode === "immediate_delete"
      || (row.handling_mode === "grace_auto_delete" && row.scheduled_at <= nowSql);
  }
  return row.status === "processing"
    && row.handling_mode !== "manual_review"
    && (row.lease_expires_at === null || row.lease_expires_at <= nowSql);
}

export async function findObservableWithdrawalCandidates(
  env: Env,
  now: Date,
  limit = DEFAULT_OBSERVE_LIMIT
): Promise<{ rows: ObservableWithdrawalRow[]; scannedCount: number; truncated: boolean }> {
  const normalizedLimit = normalizeObserveLimit(limit);
  const nowSql = toSqlTimestamp(now);
  const result = await env.DB.prepare(`
    SELECT
      id,
      version_id,
      chart_id,
      status,
      request_mode,
      COALESCE(handling_mode, CASE WHEN request_mode = 'immediate' THEN 'immediate_delete' ELSE 'grace_auto_delete' END) AS handling_mode,
      scheduled_at,
      processing_mode,
      processing_at,
      lease_expires_at
    FROM version_withdrawals
    WHERE (
      status = 'pending'
      AND (
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
  `).bind(nowSql, nowSql, normalizedLimit + 1).all<ObservableWithdrawalRow>();
  const scannedRows = result.results;
  return {
    rows: scannedRows.slice(0, normalizedLimit),
    scannedCount: scannedRows.length,
    truncated: scannedRows.length > normalizedLimit
  };
}

async function selectObservableWithdrawal(
  env: Env,
  withdrawalId: string
): Promise<ObservableWithdrawalRow | null> {
  return env.DB.prepare(`
    SELECT
      id,
      version_id,
      chart_id,
      status,
      request_mode,
      COALESCE(handling_mode, CASE WHEN request_mode = 'immediate' THEN 'immediate_delete' ELSE 'grace_auto_delete' END) AS handling_mode,
      scheduled_at,
      processing_mode,
      processing_at,
      lease_expires_at
    FROM version_withdrawals
    WHERE id = ?
    LIMIT 1
  `).bind(withdrawalId).first<ObservableWithdrawalRow>();
}

async function selectVersionIdentity(env: Env, versionId: string): Promise<ObservableVersionIdentity | null> {
  return env.DB.prepare(`
    SELECT id, chart_id
    FROM versions
    WHERE id = ?
    LIMIT 1
  `).bind(versionId).first<ObservableVersionIdentity>();
}

function makeResult(
  row: ObservableWithdrawalRow,
  classification: WithdrawalObserveClassification,
  safeReasonCodes: string[] = [],
  unexpectedError = false
): WithdrawalObserveResult {
  return {
    withdrawalId: row.id,
    versionId: row.version_id,
    status: row.status,
    requestMode: row.request_mode,
    handlingMode: row.handling_mode,
    scheduledAt: row.scheduled_at,
    classification,
    safeReasonCodes,
    unexpectedError
  };
}

export async function previewWithdrawalOutcome(
  env: Env,
  candidate: ObservableWithdrawalRow,
  now: Date
): Promise<WithdrawalObserveResult> {
  const nowSql = toSqlTimestamp(now);
  const current = await selectObservableWithdrawal(env, candidate.id);
  if (!current || !isObservableCandidate(current, nowSql)) {
    return makeResult(current ?? candidate, "ignored", ["WITHDRAWAL_OBSERVE_STATE_CHANGED"]);
  }
  if (current.version_id !== candidate.version_id || current.chart_id !== candidate.chart_id) {
    return makeResult(current, "manual_review", ["WITHDRAWAL_OBSERVE_CHART_MISMATCH"]);
  }

  const snapshot = await inspectVersionDeletionDependencies(env, current.version_id);
  if (!snapshot) {
    const identity = await selectVersionIdentity(env, current.version_id);
    if (!identity) {
      return makeResult(current, "manual_review", ["WITHDRAWAL_OBSERVE_VERSION_MISSING"]);
    }
    return makeResult(current, "manual_review", [
      identity.chart_id !== current.chart_id
        ? "WITHDRAWAL_OBSERVE_CHART_MISMATCH"
        : "WITHDRAWAL_OBSERVE_CHART_MISSING"
    ]);
  }
  if (snapshot.chartId !== current.chart_id) {
    return makeResult(current, "manual_review", ["WITHDRAWAL_OBSERVE_CHART_MISMATCH"]);
  }

  const conflictCode = getVersionDeletionLifecycleConflictCode(snapshot);
  if (conflictCode) {
    return makeResult(current, "manual_review", [
      conflictCode === "LEGACY_LIFECYCLE_CONFLICT"
        ? "WITHDRAWAL_OBSERVE_LEGACY_CONFLICT"
        : "WITHDRAWAL_OBSERVE_EXTERNAL_STATE_CONFLICT"
    ]);
  }

  const blocked = hasDeletionBlockers(snapshot);
  if (current.status === "processing") {
    return makeResult(current, blocked ? "would_move_to_manual_review" : "would_retry_delete");
  }
  return makeResult(current, blocked ? "would_move_to_manual_review" : "would_delete");
}

async function writeObserverLog(
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
    OBSERVE_LOG_ACTION,
    targetType,
    targetId,
    level,
    code,
    reason,
    JSON.stringify(detail)
  ).run();
}

async function writeWithdrawalObserveDiagnostics(
  env: Env,
  runId: string,
  results: WithdrawalObserveResult[]
): Promise<void> {
  const diagnostics = results
    .filter((result) => result.classification === "manual_review" || result.unexpectedError)
    .slice(0, MAX_DIAGNOSTIC_LOGS);
  for (const result of diagnostics) {
    try {
      const code = result.safeReasonCodes[0] ?? "WITHDRAWAL_OBSERVE_CANDIDATE_FAILED";
      await writeObserverLog(
        env,
        "version",
        result.versionId,
        result.unexpectedError ? "error" : "warning",
        code,
        result.unexpectedError ? "candidate_failed" : "manual_review",
        {
          operation: "withdrawal_cron_observe_candidate",
          run_id: runId,
          withdrawal_id: result.withdrawalId,
          version_id: result.versionId,
          status: result.status,
          request_mode: result.requestMode,
          handling_mode: result.handlingMode,
          scheduled_at: result.scheduledAt,
          classification: result.classification,
          safe_reason_codes: result.safeReasonCodes
        }
      );
    } catch {
      console.error("[withdrawal-observer] diagnostic log failed", {
        code: "WITHDRAWAL_OBSERVE_LOG_FAILED",
        withdrawalId: result.withdrawalId
      });
    }
  }
}

export async function writeWithdrawalObserveSummary(
  env: Env,
  summary: WithdrawalObserveSummary
): Promise<void> {
  await writeObserverLog(
    env,
    "system",
    summary.runId,
    summary.fatalErrorCode ? "error" : summary.errorCount > 0 || summary.manualReviewCount > 0
      ? "warning"
      : "info",
    summary.fatalErrorCode,
    summary.fatalErrorCode ? "failed" : summary.errorCount > 0 || summary.manualReviewCount > 0
      ? "completed_with_review"
      : "completed",
    {
      operation: summary.operation,
      mode: summary.mode,
      scheduled_time: summary.scheduledTime,
      scanned_count: summary.scannedCount,
      candidate_count: summary.candidateCount,
      would_delete_count: summary.wouldDeleteCount,
      would_move_to_manual_review_count: summary.wouldMoveToManualReviewCount,
      would_retry_delete_count: summary.wouldRetryDeleteCount,
      would_retry_tombstone_count: summary.wouldRetryTombstoneCount,
      manual_review_count: summary.manualReviewCount,
      ignored_count: summary.ignoredCount,
      error_count: summary.errorCount,
      truncated: summary.truncated,
      duration_ms: summary.durationMs,
      fatal_error_code: summary.fatalErrorCode
    }
  );
}

function countClassifications(summary: WithdrawalObserveSummary): void {
  for (const result of summary.results) {
    if (result.classification === "would_delete") summary.wouldDeleteCount += 1;
    else if (result.classification === "would_move_to_manual_review") summary.wouldMoveToManualReviewCount += 1;
    else if (result.classification === "would_retry_delete") summary.wouldRetryDeleteCount += 1;
    else if (result.classification === "would_retry_tombstone") summary.wouldRetryTombstoneCount += 1;
    else if (result.classification === "manual_review") summary.manualReviewCount += 1;
    else summary.ignoredCount += 1;
    if (result.unexpectedError) summary.errorCount += 1;
  }
}

export async function observeDueVersionWithdrawals(
  env: Env,
  options: WithdrawalObserveOptions
): Promise<WithdrawalObserveSummary> {
  const durationNow = options.durationNow ?? (() => Date.now());
  // Scheduled runs always use the default; injection keeps candidate isolation testable.
  const previewCandidate = options.previewCandidate ?? previewWithdrawalOutcome;
  const startedAt = durationNow();
  const now = new Date(options.now.getTime());
  const summary: WithdrawalObserveSummary = {
    runId: makeId("withdrawal_observe"),
    operation: "withdrawal_cron_observe",
    mode: "observe",
    scheduledTime: now.toISOString(),
    scannedCount: 0,
    candidateCount: 0,
    wouldDeleteCount: 0,
    wouldMoveToManualReviewCount: 0,
    wouldRetryDeleteCount: 0,
    wouldRetryTombstoneCount: 0,
    manualReviewCount: 0,
    ignoredCount: 0,
    errorCount: 0,
    truncated: false,
    durationMs: 0,
    results: [],
    fatalErrorCode: null
  };

  try {
    const candidates = await findObservableWithdrawalCandidates(env, now, options.limit);
    summary.scannedCount = candidates.scannedCount;
    summary.candidateCount = candidates.rows.length;
    summary.truncated = candidates.truncated;
    for (const candidate of candidates.rows) {
      try {
        summary.results.push(await previewCandidate(env, candidate, now));
      } catch {
        summary.results.push(makeResult(
          candidate,
          "manual_review",
          ["WITHDRAWAL_OBSERVE_CANDIDATE_FAILED"],
          true
        ));
      }
    }
    countClassifications(summary);
    await writeWithdrawalObserveDiagnostics(env, summary.runId, summary.results);
  } catch {
    summary.fatalErrorCode = "WITHDRAWAL_OBSERVE_FAILED";
    summary.errorCount += 1;
    console.error("[withdrawal-observer] observe run failed", {
      code: summary.fatalErrorCode,
      runId: summary.runId
    });
  } finally {
    summary.durationMs = Math.max(0, Math.round(durationNow() - startedAt));
    try {
      await writeWithdrawalObserveSummary(env, summary);
    } catch {
      console.error("[withdrawal-observer] summary log failed", {
        code: "WITHDRAWAL_OBSERVE_LOG_FAILED",
        runId: summary.runId
      });
    }
  }
  return summary;
}
