import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";

const MIN_CLEANUP_AGE_DAYS = 30;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const CLEANUP_CONFIRMATION = "DELETE_R2_FILE";

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
        fileSize: context.fileSize ?? null
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
    && row.hidden_at !== null
    && Number(row.retention_elapsed) === 1
    && ["delete_request_approved", "deleted_within_24h"].includes(row.hidden_reason ?? "");
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
    const whereClause = `
      versions.is_hidden = 1
      AND versions.download_blocked = 1
      AND versions.file_deleted_at IS NULL
      AND versions.hidden_at IS NOT NULL
      AND versions.hidden_at <= datetime('now', '-' || ? || ' days')
      AND versions.hidden_reason IN ('delete_request_approved', 'deleted_within_24h')
    `;
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
        charts.chart_name AS chart_name,
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

async function markFileDeleted(
  env: Env,
  row: CleanupTargetRow,
  olderThanDays: number,
  reason: "r2_cleanup_deleted" | "r2_object_missing_during_cleanup"
): Promise<string> {
  const result = await env.DB.prepare(`
    UPDATE versions
    SET
      file_deleted_at = CURRENT_TIMESTAMP,
      file_delete_reason = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND file_deleted_at IS NULL
      AND is_hidden = 1
      AND download_blocked = 1
      AND hidden_at = ?
      AND file_sha256 = ?
      AND hidden_at <= datetime('now', '-' || ? || ' days')
      AND hidden_reason IN ('delete_request_approved', 'deleted_within_24h')
  `).bind(
    reason,
    row.version_id,
    row.hidden_at,
    row.file_sha256,
    olderThanDays
  ).run();

  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new Error("Cleanup target changed before the D1 file deletion marker was written.");
  }

  const updated = await env.DB.prepare(`
    SELECT file_deleted_at
    FROM versions
    WHERE id = ?
    LIMIT 1
  `).bind(row.version_id).first<{ file_deleted_at: string | null }>();
  if (!updated?.file_deleted_at) {
    throw new Error("D1 update completed without file_deleted_at.");
  }
  return updated.file_deleted_at;
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
      errorCode: parsed.code
    });
    return parsed.response;
  }

  const body = parsed.value;
  let row: CleanupTargetRow | null;
  try {
    row = await selectCleanupTarget(env, versionId, body.olderThanDays);
  } catch (error) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_D1_UPDATE_FAILED", {
      versionId,
      olderThanDays: body.olderThanDays,
      errorCode: "CLEANUP_D1_UPDATE_FAILED"
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
      errorCode: "VERSION_NOT_FOUND"
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
    fileSize: Number(row.file_size)
  };

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

  if (row.hidden_at !== body.expectedHiddenAt
    || (body.expectedFileSha256 !== undefined && row.file_sha256 !== body.expectedFileSha256)) {
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
      outcome: "already_deleted"
    });
    return ok(request, env, {
      ok: true,
      versionId: row.version_id,
      chartId: row.chart_id,
      outcome: "already_deleted",
      fileDeletedAt: row.file_deleted_at,
      fileDeleteReason: row.file_delete_reason,
      progressImagePreserved: true
    });
  }

  const r2Key = row.r2_key?.trim() ?? "";
  let outcome: "r2_file_deleted" | "r2_object_missing_reconciled";
  let deleteReason: "r2_cleanup_deleted" | "r2_object_missing_during_cleanup";
  let missingReason: "r2_key_missing" | "r2_object_missing" | null = null;

  if (!r2Key) {
    outcome = "r2_object_missing_reconciled";
    deleteReason = "r2_object_missing_during_cleanup";
    missingReason = "r2_key_missing";
  } else {
    let object: R2Object | null;
    try {
      object = await env.FILES.head(r2Key);
    } catch {
      await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_R2_DELETE_FAILED", {
        ...logBase,
        errorCode: "CLEANUP_R2_DELETE_FAILED"
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
    } else {
      try {
        await env.FILES.delete(r2Key);
        const remaining = await env.FILES.head(r2Key);
        if (remaining) {
          throw new Error("R2 object still exists after delete resolved.");
        }
      } catch {
        await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_R2_DELETE_FAILED", {
          ...logBase,
          errorCode: "CLEANUP_R2_DELETE_FAILED"
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
  try {
    fileDeletedAt = await markFileDeleted(env, row, body.olderThanDays, deleteReason);
  } catch (error) {
    await writeCleanupLog(env, "r2_cleanup_delete_file_failed", "error", "CLEANUP_D1_UPDATE_FAILED", {
      ...logBase,
      outcome,
      errorCode: "CLEANUP_D1_UPDATE_FAILED"
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
    errorCode: missingReason === "r2_key_missing" ? "CLEANUP_R2_KEY_MISSING" : null
  });
  return ok(request, env, {
    ok: true,
    versionId: row.version_id,
    chartId: row.chart_id,
    outcome,
    missingReason,
    fileDeletedAt,
    fileDeleteReason: deleteReason,
    progressImagePreserved: true
  });
}
