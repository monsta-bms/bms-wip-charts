import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";
import {
  COMPLETED_DESCENDANT_SUPERSESSION_REASON,
  isCompletedDescendantSupersession
} from "../utils/versionAccess";

export const MIN_CLEANUP_AGE_DAYS = 30;
export const SCHEDULED_CLEANUP_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const CLEANUP_CONFIRMATION = "DELETE_R2_FILE";
const CLEANUP_HIDDEN_REASONS = ["delete_request_approved", "deleted_within_24h"] as const;

type CleanupTrigger = "manual" | "cron";

type CleanupCandidateRow = {
  version_id: string;
  chart_id: string;
  song_title: string;
  chart_name: string;
  branch_path: string;
  author: string;
  hidden_reason: string;
  hidden_at: string;
  age_days: number;
  file_deleted_at: string | null;
  r2_key: string;
  file_name: string;
  file_size: number;
  file_sha256: string;
};

type CleanupTargetRow = {
  version_id: string;
  chart_id: string;
  is_hidden: number;
  download_blocked: number;
  download_block_reason: string | null;
  hidden_reason: string | null;
  hidden_at: string | null;
  file_deleted_at: string | null;
  file_delete_reason: string | null;
  r2_key: string | null;
  file_name: string;
  file_size: number;
  file_sha256: string;
  retention_elapsed: number;
};

type CleanupRequestBody = {
  confirm: string;
  olderThanDays: number;
  expectedHiddenAt: string;
  expectedFileSha256?: string;
};

type CleanupLogContext = {
  versionId: string;
  chartId?: string | null;
  hiddenReason?: string | null;
  hiddenAt?: string | null;
  olderThanDays: number;
  hasR2Key?: boolean | null;
  outcome?: string | null;
  errorCode?: string | null;
  fileDeletedAt?: string | null;
  fileSha256Present?: boolean | null;
  fileSize?: number | null;
  trigger?: CleanupTrigger;
  runId?: string | null;
  objectExisted?: boolean | null;
  d1Updated?: boolean | null;
};

type CleanupOptions = {
  olderThanDays: number;
  trigger: CleanupTrigger;
  runId?: string;
  expectedHiddenAt?: string;
  expectedFileSha256?: string;
};

export type ScheduledCleanupSummary = {
  runId: string;
  candidateCount: number;
  processedCount: number;
  deletedCount: number;
  missingReconciledCount: number;
  skippedCount: number;
  failedCount: number;
  limit: number;
  durationMs: number;
  scheduledTime: number;
  cron: string;
  errorCodes: Record<string, number>;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCleanupAge(value: string | null): number {
  return Math.max(MIN_CLEANUP_AGE_DAYS, parsePositiveInteger(value, MIN_CLEANUP_AGE_DAYS));
}

function branchSegmentToNumber(segment: string): number | null {
  const normalized = segment.trim().toLowerCase();
  if (!/^[a-z]+$/.test(normalized)) {
    return null;
  }

  let value = 0;
  for (const character of normalized) {
    value = value * 26 + character.charCodeAt(0) - 96;
  }
  return value;
}

function buildVersionPathLabel(branchPath: string): string {
  const normalized = branchPath.trim();
  if (!normalized || normalized === "root") {
    return "BASE";
  }

  const segments = normalized.replace(/^root\/?/, "").split("/").filter(Boolean);
  const numbers = segments.map(branchSegmentToNumber);
  if (numbers.length === 0 || numbers.some((value) => value === null)) {
    return normalized;
  }
  return numbers.join("-");
}

async function writeCleanupLog(
  env: Env,
  action: "r2_cleanup_delete_file" | "r2_cleanup_delete_file_failed",
  level: "info" | "warning" | "error",
  code: string | null,
  context: CleanupLogContext
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_logs (
        id,
        action,
        target_type,
        target_id,
        level,
        code,
        reason,
        detail
      ) VALUES (?, ?, 'version', ?, ?, ?, ?, ?)
    `).bind(
      makeId("admin_log"),
      action,
      context.versionId,
      level,
      code,
      context.outcome ?? code,
      JSON.stringify({
        versionId: context.versionId,
        chartId: context.chartId ?? null,
        hiddenReason: context.hiddenReason ?? null,
        hiddenAt: context.hiddenAt ?? null,
        olderThanDays: context.olderThanDays,
        hasR2Key: context.hasR2Key ?? null,
        outcome: context.outcome ?? null,
        errorCode: context.errorCode ?? code,
        fileDeletedAt: context.fileDeletedAt ?? null,
        fileSha256Present: context.fileSha256Present ?? null,
        fileSize: context.fileSize ?? null,
        trigger: context.trigger ?? "manual",
        runId: context.runId ?? null,
        objectExisted: context.objectExisted ?? null,
        d1Updated: context.d1Updated ?? null
      })
    ).run();
  } catch (error) {
    console.error("[admin-r2-cleanup-log] failed to write admin log", {
      action,
      code: "ADMIN_LOG_WRITE_FAILED",
      versionId: context.versionId,
      message: errorDetail(error)
    });
  }
}

function cleanupEligibilitySql(alias: string): string {
  const prefix = alias ? `${alias}.` : "";
  return `
    ${prefix}is_hidden = 1
    AND ${prefix}download_blocked = 1
    AND COALESCE(${prefix}download_block_reason, '') <> '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}'
    AND ${prefix}file_deleted_at IS NULL
    AND ${prefix}hidden_at IS NOT NULL
    AND ${prefix}hidden_at <= datetime('now', '-' || ? || ' days')
    AND ${prefix}hidden_reason IN ('${CLEANUP_HIDDEN_REASONS[0]}', '${CLEANUP_HIDDEN_REASONS[1]}')
  `;
}

async function readCleanupBody(
  request: Request,
  env: Env
): Promise<
  { ok: true; value: CleanupRequestBody }
  | { ok: false; code: string; response: Response }
> {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      code: "CLEANUP_CONFIRM_REQUIRED",
      response: apiError(
        request,
        env,
        400,
        "CLEANUP_CONFIRM_REQUIRED",
        "削除確認の形式が不正です。",
        "Content-Type must be application/json."
      )
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return {
      ok: false,
      code: "CLEANUP_CONFIRM_REQUIRED",
      response: apiError(
        request,
        env,
        400,
        "CLEANUP_CONFIRM_REQUIRED",
        "削除確認の形式が不正です。",
        `Request body must be valid JSON: ${errorDetail(error)}`
      )
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "CLEANUP_CONFIRM_REQUIRED",
      response: apiError(
        request,
        env,
        400,
        "CLEANUP_CONFIRM_REQUIRED",
        "削除確認の形式が不正です。",
        "Request body must be a JSON object."
      )
    };
  }

  const value = body as Record<string, unknown>;
  const confirm = typeof value.confirm === "string" ? value.confirm : "";
  if (confirm !== CLEANUP_CONFIRMATION) {
    return {
      ok: false,
      code: "CLEANUP_CONFIRM_REQUIRED",
      response: apiError(
        request,
        env,
        400,
        "CLEANUP_CONFIRM_REQUIRED",
        "確認文字列が一致しません。",
        `confirm must equal ${CLEANUP_CONFIRMATION}.`
      )
    };
  }

  const olderThanDays = Number(value.olderThanDays);
  if (!Number.isInteger(olderThanDays) || olderThanDays < MIN_CLEANUP_AGE_DAYS) {
    return {
      ok: false,
      code: "CLEANUP_TARGET_NOT_ELIGIBLE",
      response: apiError(
        request,
        env,
        400,
        "CLEANUP_TARGET_NOT_ELIGIBLE",
        "保持期間の指定が不正です。",
        `olderThanDays must be an integer greater than or equal to ${MIN_CLEANUP_AGE_DAYS}.`
      )
    };
  }

  const expectedHiddenAt = typeof value.expectedHiddenAt === "string"
    ? value.expectedHiddenAt.trim()
    : "";
  const expectedFileSha256 = typeof value.expectedFileSha256 === "string"
    ? value.expectedFileSha256.trim()
    : undefined;

  if (!expectedHiddenAt) {
    return {
      ok: false,
      code: "CLEANUP_EXPECTED_VALUE_MISMATCH",
      response: apiError(
        request,
        env,
        409,
        "CLEANUP_EXPECTED_VALUE_MISMATCH",
        "対象versionの状態を再確認してください。",
        "expectedHiddenAt is required."
      )
    };
  }

  return {
    ok: true,
    value: { confirm, olderThanDays, expectedHiddenAt, expectedFileSha256 }
  };
}

async function selectCleanupTarget(
  env: Env,
  versionId: string,
  olderThanDays: number
): Promise<CleanupTargetRow | null> {
  return env.DB.prepare(`
    SELECT
      id AS version_id,
      chart_id,
      is_hidden,
      download_blocked,
      download_block_reason,
      hidden_reason,
      hidden_at,
      file_deleted_at,
      file_delete_reason,
      r2_key,
      file_name,
      file_size,
      file_sha256,
      CASE
        WHEN hidden_at IS NOT NULL
          AND hidden_at <= datetime('now', '-' || ? || ' days')
          THEN 1
        ELSE 0
      END AS retention_elapsed
    FROM versions
    WHERE id = ?
    LIMIT 1
  `).bind(olderThanDays, versionId).first<CleanupTargetRow>();
}

function isCleanupEligible(row: CleanupTargetRow): boolean {
  return Number(row.is_hidden) === 1
    && Number(row.download_blocked) === 1
    && !isCompletedDescendantSupersession(row.download_block_reason)
    && row.hidden_at !== null
    && Number(row.retention_elapsed) === 1
    && CLEANUP_HIDDEN_REASONS.includes(
      (row.hidden_reason ?? "") as (typeof CLEANUP_HIDDEN_REASONS)[number]
    );
}

export async function listR2CleanupCandidates(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }

  const url = new URL(request.url);
  const olderThanDays = normalizeCleanupAge(url.searchParams.get("olderThanDays"));
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(
    parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const offset = (page - 1) * pageSize;

  try {
    const whereClause = cleanupEligibilitySql("versions");
    const totalRow = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM versions
      WHERE ${whereClause}
    `).bind(olderThanDays).first<{ total: number }>();

    const result = await env.DB.prepare(`
      SELECT
        versions.id AS version_id,
        versions.chart_id AS chart_id,
        songs.title AS song_title,
        COALESCE(versions.chart_name, charts.chart_name) AS chart_name,
        versions.branch_path AS branch_path,
        versions.author AS author,
        versions.hidden_reason AS hidden_reason,
        versions.hidden_at AS hidden_at,
        CAST(julianday('now') - julianday(versions.hidden_at) AS INTEGER) AS age_days,
        versions.file_deleted_at AS file_deleted_at,
        versions.r2_key AS r2_key,
        versions.file_name AS file_name,
        versions.file_size AS file_size,
        versions.file_sha256 AS file_sha256
      FROM versions
      INNER JOIN charts ON charts.id = versions.chart_id
      INNER JOIN songs ON songs.id = charts.song_id
      WHERE ${whereClause}
      ORDER BY versions.hidden_at ASC, versions.id ASC
      LIMIT ? OFFSET ?
    `).bind(olderThanDays, pageSize, offset).all<CleanupCandidateRow>();

    return ok(request, env, {
      ok: true,
      items: result.results.map((row) => ({
        versionId: row.version_id,
        chartId: row.chart_id,
        songTitle: row.song_title,
        chartName: row.chart_name,
        versionLabel: buildVersionPathLabel(row.branch_path),
        branchPath: row.branch_path,
        author: row.author,
        hiddenReason: row.hidden_reason,
        hiddenAt: row.hidden_at,
        ageDays: Number(row.age_days),
        fileDeletedAt: row.file_deleted_at,
        hasR2Key: Boolean(row.r2_key?.trim()),
        fileName: row.file_name,
        fileSize: Number(row.file_size),
        fileSha256: row.file_sha256
      })),
      olderThanDays,
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0)
    });
  } catch (error) {
    console.error("[admin-r2-cleanup-list] failed to read cleanup candidates", {
      code: "CLEANUP_CANDIDATE_LIST_FAILED",
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "CLEANUP_CANDIDATE_LIST_FAILED",
      "R2 cleanup候補の取得に失敗しました。",
      `D1 cleanup candidate query failed: ${errorDetail(error)}`
    );
  }
}

async function listScheduledCleanupCandidateIds(
  env: Env,
  olderThanDays: number,
  limit: number
): Promise<string[]> {
  const result = await env.DB.prepare(`
    SELECT versions.id AS version_id
    FROM versions
    WHERE ${cleanupEligibilitySql("versions")}
    ORDER BY versions.hidden_at ASC, versions.id ASC
    LIMIT ?
  `).bind(olderThanDays, limit).all<{ version_id: string }>();
  return result.results.map((row) => row.version_id);
}

async function writeScheduledCleanupSummary(
  env: Env,
  summary: ScheduledCleanupSummary,
  fatalErrorCode: string | null
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_logs (
        id,
        action,
        target_type,
        target_id,
        level,
        code,
        reason,
        detail
      ) VALUES (?, 'r2_cleanup_cron_run', 'system', ?, ?, ?, ?, ?)
    `).bind(
      makeId("admin_log"),
      summary.runId,
      fatalErrorCode ? "error" : summary.failedCount > 0 ? "warning" : "info",
      fatalErrorCode,
      fatalErrorCode ? "failed" : summary.failedCount > 0 ? "completed_with_errors" : "completed",
      JSON.stringify({
        trigger: "cron",
        runId: summary.runId,
        candidateCount: summary.candidateCount,
        processedCount: summary.processedCount,
        deletedCount: summary.deletedCount,
        missingReconciledCount: summary.missingReconciledCount,
        skippedCount: summary.skippedCount,
        failedCount: summary.failedCount,
        limit: summary.limit,
        durationMs: summary.durationMs,
        scheduledTime: summary.scheduledTime,
        cron: summary.cron,
        errorCodes: summary.errorCodes,
        fatalErrorCode
      })
    ).run();
  } catch (error) {
    console.error("[r2-cleanup-cron-log] failed to write summary log", {
      code: "ADMIN_LOG_WRITE_FAILED",
      runId: summary.runId,
      message: errorDetail(error)
    });
  }
}

async function markFileDeleted(
  env: Env,
  row: CleanupTargetRow,
  olderThanDays: number,
  reason: "r2_cleanup_deleted" | "r2_object_missing_during_cleanup"
): Promise<
  { outcome: "updated"; fileDeletedAt: string }
  | { outcome: "concurrent_completed"; fileDeletedAt: string; fileDeleteReason: string | null }
> {
  const result = await env.DB.prepare(`
    UPDATE versions
    SET
      file_deleted_at = CURRENT_TIMESTAMP,
      file_delete_reason = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND file_deleted_at IS NULL
      AND hidden_at = ?
      AND file_sha256 = ?
      AND ${cleanupEligibilitySql("")}
  `).bind(
    reason,
    row.version_id,
    row.hidden_at,
    row.file_sha256,
    olderThanDays
  ).run();

  const updated = await env.DB.prepare(`
    SELECT file_deleted_at, file_delete_reason
    FROM versions
    WHERE id = ?
    LIMIT 1
  `).bind(row.version_id).first<{
    file_deleted_at: string | null;
    file_delete_reason: string | null;
  }>();

  if (Number(result.meta.changes ?? 0) === 0) {
    if (updated?.file_deleted_at) {
      return {
        outcome: "concurrent_completed",
        fileDeletedAt: updated.file_deleted_at,
        fileDeleteReason: updated.file_delete_reason
      };
    }
    throw new Error("Cleanup target changed before the D1 file deletion marker was written.");
  }

  if (!updated?.file_deleted_at) {
    throw new Error("D1 update completed without file_deleted_at.");
  }
  return { outcome: "updated", fileDeletedAt: updated.file_deleted_at };
}

async function cleanupR2File(
  request: Request,
  env: Env,
  versionId: string,
  options: CleanupOptions
): Promise<Response> {
  const body = options;
  let row: CleanupTargetRow | null;
  try {
    row = await selectCleanupTarget(env, versionId, body.olderThanDays);
  } catch (error) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_D1_UPDATE_FAILED", {
      versionId,
      olderThanDays: body.olderThanDays,
      errorCode: "CLEANUP_D1_UPDATE_FAILED",
      trigger: options.trigger,
      runId: options.runId ?? null,
      d1Updated: false
    });
    return apiError(
      request,
      env,
      500,
      "CLEANUP_D1_UPDATE_FAILED",
      "対象versionの確認に失敗しました。",
      `D1 cleanup target lookup failed: ${errorDetail(error)}`
    );
  }

  if (!row) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "warning", "VERSION_NOT_FOUND", {
      versionId,
      olderThanDays: body.olderThanDays,
      errorCode: "VERSION_NOT_FOUND",
      trigger: options.trigger,
      runId: options.runId ?? null,
      d1Updated: false
    });
    return apiError(request, env, 404, "VERSION_NOT_FOUND", "versionが見つかりません。", "versionId was not found.");
  }

  const logBase: CleanupLogContext = {
    versionId: row.version_id,
    chartId: row.chart_id,
    hiddenReason: row.hidden_reason,
    hiddenAt: row.hidden_at,
    olderThanDays: body.olderThanDays,
    hasR2Key: Boolean(row.r2_key?.trim()),
    fileDeletedAt: row.file_deleted_at,
    fileSha256Present: Boolean(row.file_sha256),
    fileSize: Number(row.file_size),
    trigger: options.trigger,
    runId: options.runId ?? null,
    d1Updated: false
  };

  if (!isCleanupEligible(row) && options.trigger === "cron") {
    await writeCleanupLog(env, "r2_cleanup_delete_file", "warning", null, {
      ...logBase,
      outcome: "skipped_state_changed",
      d1Updated: false
    });
    return ok(request, env, {
      ok: true,
      versionId: row.version_id,
      chartId: row.chart_id,
      outcome: "skipped_state_changed",
      fileDeletedAt: row.file_deleted_at,
      fileDeleteReason: row.file_delete_reason,
      objectExisted: null,
      d1Updated: false,
      progressImagePreserved: true
    });
  }

  if (!isCleanupEligible(row)) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "warning", "CLEANUP_TARGET_NOT_ELIGIBLE", {
      ...logBase,
      errorCode: "CLEANUP_TARGET_NOT_ELIGIBLE"
    });
    return apiError(
      request,
      env,
      409,
      "CLEANUP_TARGET_NOT_ELIGIBLE",
      "このversionはR2 cleanup対象ではありません。",
      "The current D1 state does not satisfy the cleanup allowlist and retention rules."
    );
  }

  if (body.expectedHiddenAt !== undefined && (
    row.hidden_at !== body.expectedHiddenAt
    || (body.expectedFileSha256 !== undefined && row.file_sha256 !== body.expectedFileSha256)
  )) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "warning", "CLEANUP_EXPECTED_VALUE_MISMATCH", {
      ...logBase,
      errorCode: "CLEANUP_EXPECTED_VALUE_MISMATCH"
    });
    return apiError(
      request,
      env,
      409,
      "CLEANUP_EXPECTED_VALUE_MISMATCH",
      "対象versionの状態が一覧取得時から変わっています。",
      "expectedHiddenAt or expectedFileSha256 does not match the current D1 value."
    );
  }

  if (row.file_deleted_at) {
    await writeCleanupLog(env, "r2_cleanup_delete_file", "info", null, {
      ...logBase,
      outcome: "already_deleted",
      d1Updated: false
    });
    return ok(request, env, {
      ok: true,
      versionId: row.version_id,
      chartId: row.chart_id,
      outcome: "already_deleted",
      fileDeletedAt: row.file_deleted_at,
      fileDeleteReason: row.file_delete_reason,
      objectExisted: null,
      d1Updated: false,
      progressImagePreserved: true
    });
  }

  const r2Key = row.r2_key?.trim() ?? "";
  let outcome: "r2_file_deleted" | "r2_object_missing_reconciled" | "concurrent_completed";
  let deleteReason: "r2_cleanup_deleted" | "r2_object_missing_during_cleanup";
  let missingReason: "r2_key_missing" | "r2_object_missing" | null = null;
  let objectExisted: boolean | null = null;

  if (!r2Key) {
    outcome = "r2_object_missing_reconciled";
    deleteReason = "r2_object_missing_during_cleanup";
    missingReason = "r2_key_missing";
    objectExisted = false;
  } else {
    let object: R2Object | null;
    try {
      object = await env.FILES.head(r2Key);
    } catch {
      await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_R2_DELETE_FAILED", {
        ...logBase,
        errorCode: "CLEANUP_R2_DELETE_FAILED",
        objectExisted,
        d1Updated: false
      });
      return apiError(
        request,
        env,
        500,
        "CLEANUP_R2_DELETE_FAILED",
        "R2譜面ファイルの確認に失敗しました。",
        "R2 head failed before cleanup. See Worker logs for the operation error."
      );
    }

    if (!object) {
      outcome = "r2_object_missing_reconciled";
      deleteReason = "r2_object_missing_during_cleanup";
      missingReason = "r2_object_missing";
      objectExisted = false;
    } else {
      objectExisted = true;
      try {
        await env.FILES.delete(r2Key);
        const remaining = await env.FILES.head(r2Key);
        if (remaining) {
          throw new Error("R2 object still exists after delete resolved.");
        }
      } catch {
        await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_R2_DELETE_FAILED", {
          ...logBase,
          errorCode: "CLEANUP_R2_DELETE_FAILED",
          objectExisted,
          d1Updated: false
        });
        return apiError(
          request,
          env,
          500,
          "CLEANUP_R2_DELETE_FAILED",
          "R2譜面ファイルの削除に失敗しました。",
          "R2 delete or verification failed. See Worker logs for the operation error."
        );
      }
      outcome = "r2_file_deleted";
      deleteReason = "r2_cleanup_deleted";
    }
  }

  let fileDeletedAt: string;
  let fileDeleteReason: string | null = deleteReason;
  let d1Updated = false;
  try {
    const markResult = await markFileDeleted(env, row, body.olderThanDays, deleteReason);
    fileDeletedAt = markResult.fileDeletedAt;
    if (markResult.outcome === "concurrent_completed") {
      outcome = "concurrent_completed";
      fileDeleteReason = markResult.fileDeleteReason;
    } else {
      d1Updated = true;
    }
  } catch (error) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_D1_UPDATE_FAILED", {
      ...logBase,
      outcome,
      errorCode: "CLEANUP_D1_UPDATE_FAILED",
      objectExisted,
      d1Updated: false
    });
    return apiError(
      request,
      env,
      500,
      "CLEANUP_D1_UPDATE_FAILED",
      "R2削除結果のD1記録に失敗しました。",
      `D1 cleanup marker update failed: ${errorDetail(error)}`
    );
  }

  await writeCleanupLog(env, "r2_cleanup_delete_file", "info", null, {
    ...logBase,
    outcome,
    fileDeletedAt,
    errorCode: missingReason === "r2_key_missing" ? "CLEANUP_R2_KEY_MISSING" : null,
    objectExisted,
    d1Updated
  });
  return ok(request, env, {
    ok: true,
    versionId: row.version_id,
    chartId: row.chart_id,
    outcome,
    missingReason,
    fileDeletedAt,
    fileDeleteReason,
    objectExisted,
    d1Updated,
    progressImagePreserved: true
  });
}

export async function deleteR2CleanupFile(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }

  const parsed = await readCleanupBody(request, env);
  if (!parsed.ok) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "warning", parsed.code, {
      versionId,
      olderThanDays: MIN_CLEANUP_AGE_DAYS,
      errorCode: parsed.code,
      trigger: "manual",
      d1Updated: false
    });
    return parsed.response;
  }

  return cleanupR2File(request, env, versionId, {
    olderThanDays: parsed.value.olderThanDays,
    trigger: "manual",
    expectedHiddenAt: parsed.value.expectedHiddenAt,
    expectedFileSha256: parsed.value.expectedFileSha256
  });
}

function incrementErrorCode(summary: ScheduledCleanupSummary, code: string): void {
  summary.errorCodes[code] = (summary.errorCodes[code] ?? 0) + 1;
}

async function readCleanupResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function runScheduledR2Cleanup(
  env: Env,
  scheduledTime: number,
  cron: string
): Promise<ScheduledCleanupSummary> {
  const startedAt = Date.now();
  const runId = makeId("r2_cleanup_run");
  const summary: ScheduledCleanupSummary = {
    runId,
    candidateCount: 0,
    processedCount: 0,
    deletedCount: 0,
    missingReconciledCount: 0,
    skippedCount: 0,
    failedCount: 0,
    limit: SCHEDULED_CLEANUP_LIMIT,
    durationMs: 0,
    scheduledTime,
    cron,
    errorCodes: {}
  };

  let versionIds: string[];
  try {
    versionIds = await listScheduledCleanupCandidateIds(
      env,
      MIN_CLEANUP_AGE_DAYS,
      SCHEDULED_CLEANUP_LIMIT
    );
    summary.candidateCount = versionIds.length;
  } catch (error) {
    incrementErrorCode(summary, "CLEANUP_CANDIDATE_LIST_FAILED");
    summary.durationMs = Date.now() - startedAt;
    await writeScheduledCleanupSummary(env, summary, "CLEANUP_CANDIDATE_LIST_FAILED");
    console.error("[r2-cleanup-cron] candidate lookup failed", {
      code: "CLEANUP_CANDIDATE_LIST_FAILED",
      runId,
      message: errorDetail(error)
    });
    throw new Error("Scheduled R2 cleanup candidate lookup failed.");
  }

  for (const versionId of versionIds) {
    summary.processedCount += 1;
    try {
      const internalRequest = new Request(
        `https://internal.invalid/api/admin/r2-cleanup/${encodeURIComponent(versionId)}/delete-file`,
        { method: "POST" }
      );
      const response = await cleanupR2File(internalRequest, env, versionId, {
        olderThanDays: MIN_CLEANUP_AGE_DAYS,
        trigger: "cron",
        runId
      });
      const body = await readCleanupResponse(response);
      const outcome = typeof body.outcome === "string" ? body.outcome : "";

      if (!response.ok) {
        summary.failedCount += 1;
        incrementErrorCode(
          summary,
          typeof body.code === "string" ? body.code : "CLEANUP_ITEM_FAILED"
        );
      } else if (outcome === "r2_file_deleted") {
        summary.deletedCount += 1;
      } else if (outcome === "r2_object_missing_reconciled") {
        summary.missingReconciledCount += 1;
      } else {
        summary.skippedCount += 1;
      }
    } catch (error) {
      summary.failedCount += 1;
      incrementErrorCode(summary, "CLEANUP_ITEM_FAILED");
      await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_ITEM_FAILED", {
        versionId,
        olderThanDays: MIN_CLEANUP_AGE_DAYS,
        trigger: "cron",
        runId,
        outcome: "failed",
        errorCode: "CLEANUP_ITEM_FAILED",
        d1Updated: false
      });
      console.error("[r2-cleanup-cron] cleanup item failed unexpectedly", {
        code: "CLEANUP_ITEM_FAILED",
        runId,
        versionId,
        message: errorDetail(error)
      });
    }
  }

  summary.durationMs = Date.now() - startedAt;
  await writeScheduledCleanupSummary(env, summary, null);
  return summary;
}
