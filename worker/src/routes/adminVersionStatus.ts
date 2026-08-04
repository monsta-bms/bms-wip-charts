import {
  AdminSubmissionState,
  inspectStoredProgressMap,
  normalizeStoredProgressMapForSubmissionState
} from "../utils/progressMap";
import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";
import {
  LifecycleProjection,
  lifecycleProjectionSql,
  resolvePublicLifecycleStatus
} from "../utils/versionWithdrawal";
import { COMPLETED_DESCENDANT_SUPERSESSION_REASON } from "../utils/versionAccess";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 100;
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;
const MAP_PROGRESS_MISMATCH_THRESHOLD = 10;

type StatusFilter = "all" | AdminSubmissionState | "inconsistent";

type VersionStatusRow = LifecycleProjection & {
  version_id: string;
  chart_id: string;
  parent_version_id: string | null;
  version_number: number;
  branch_label: string;
  branch_path: string;
  author: string;
  progress: number;
  progress_map_json: string | null;
  is_rejected: number;
  allow_append: number;
  is_hidden: number;
  file_deleted_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  withdrawn_at: string | null;
  delete_requested_at: string | null;
  chart_name: string;
  song_title: string;
  artist: string;
  child_version_count: number;
};

type StatusUpdateBody = {
  targetState?: unknown;
  progress?: unknown;
  allowAppend?: unknown;
  reason?: unknown;
  expectedUpdatedAt?: unknown;
};

type ValidStatusUpdate = {
  targetState: AdminSubmissionState;
  progress: number;
  allowAppend: boolean;
  reason: string;
  expectedUpdatedAt: string;
};

type PublicStatusItem = ReturnType<typeof toStatusItem>;

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parsePositiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}

function currentSubmissionState(row: Pick<VersionStatusRow, "is_rejected" | "completed_at">): AdminSubmissionState {
  if (row.is_rejected === 1) return "rejected_completed";
  if (row.completed_at) return "completed";
  return "incomplete";
}

function suspiciousReasons(row: VersionStatusRow, mapProgress: number | null): string[] {
  const reasons: string[] = [];
  if (row.is_rejected === 1 && mapProgress !== null && mapProgress < 100) {
    reasons.push("REJECTED_WITH_INCOMPLETE_PROGRESS_MAP");
  }
  if (row.is_rejected === 0 && !row.completed_at && row.progress === 100) {
    reasons.push("INCOMPLETE_WITH_FULL_PROGRESS");
  }
  if (row.is_rejected === 0 && row.completed_at && row.progress !== 100) {
    reasons.push("COMPLETED_WITH_NON_FULL_PROGRESS");
  }
  if (row.is_rejected === 1 && row.completed_at) {
    reasons.push("REJECTED_WITH_COMPLETED_AT");
  }
  if (row.is_rejected === 1 && row.progress !== 100) {
    reasons.push("REJECTED_WITH_NON_FULL_PROGRESS");
  }
  if (mapProgress !== null && Math.abs(row.progress - mapProgress) >= MAP_PROGRESS_MISMATCH_THRESHOLD) {
    reasons.push("PROGRESS_MAP_MISMATCH");
  }
  return reasons;
}

function toStatusItem(row: VersionStatusRow) {
  const map = inspectStoredProgressMap(row.progress_map_json, row.version_id);
  const reasons = suspiciousReasons(row, map.progress);
  const lifecycleStatus = resolvePublicLifecycleStatus(row);
  const canCorrect = row.is_hidden === 0
    && row.file_deleted_at === null
    && lifecycleStatus === "active";
  const versionLabel = row.version_number === 1
    ? "BASE"
    : (row.branch_label.trim() || `v${row.version_number}`);

  return {
    versionId: row.version_id,
    chartId: row.chart_id,
    songTitle: row.song_title,
    artist: row.artist,
    chartName: row.chart_name,
    versionLabel,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentState: currentSubmissionState(row),
    progress: row.progress,
    mapProgress: map.progress,
    mapProgressAvailable: map.available,
    allowAppend: row.allow_append === 1,
    isHidden: row.is_hidden === 1,
    lifecycleStatus,
    parentVersionId: row.parent_version_id,
    childVersionCount: Number(row.child_version_count ?? 0),
    suspicious: reasons.length > 0,
    suspiciousReasons: reasons,
    canCorrect
  };
}

function matchesState(item: PublicStatusItem, state: StatusFilter): boolean {
  if (state === "all") return true;
  if (state === "inconsistent") return item.suspicious;
  return item.currentState === state;
}

function listError(request: Request, env: Env, detail: string): Response {
  return apiError(
    request,
    env,
    500,
    "ADMIN_VERSION_STATUS_LIST_FAILED",
    "投稿状態の確認一覧を取得できませんでした。",
    detail
  );
}

export async function listAdminVersionStatuses(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const suspiciousOnly = (url.searchParams.get("suspiciousOnly") ?? "true") !== "false";
  const requestedState = (url.searchParams.get("state") ?? "all") as StatusFilter;
  const allowedStates = new Set<StatusFilter>([
    "all",
    "incomplete",
    "completed",
    "rejected_completed",
    "inconsistent"
  ]);
  if (query.length > MAX_QUERY_LENGTH || !allowedStates.has(requestedState)) {
    return apiError(
      request,
      env,
      400,
      "ADMIN_VERSION_STATUS_LIST_FAILED",
      "検索条件が不正です。",
      `q must be at most ${MAX_QUERY_LENGTH} characters and state must be supported.`
    );
  }

  const page = parsePositiveInteger(url.searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER);
  const pageSize = parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const escapedQuery = `%${query.replace(/[%_\\]/gu, (character) => `\\${character}`)}%`;

  try {
    const result = await env.DB.prepare(`
      SELECT
        versions.id AS version_id,
        versions.chart_id AS chart_id,
        versions.parent_version_id AS parent_version_id,
        versions.version_number AS version_number,
        versions.branch_label AS branch_label,
        versions.branch_path AS branch_path,
        versions.author AS author,
        versions.progress AS progress,
        versions.progress_map_json AS progress_map_json,
        versions.is_rejected AS is_rejected,
        versions.allow_append AS allow_append,
        versions.is_hidden AS is_hidden,
        versions.file_deleted_at AS file_deleted_at,
        versions.created_at AS created_at,
        versions.updated_at AS updated_at,
        versions.completed_at AS completed_at,
        versions.withdrawn_at AS withdrawn_at,
        versions.delete_requested_at AS delete_requested_at,
        COALESCE(versions.chart_name, charts.chart_name) AS chart_name,
        songs.title AS song_title,
        songs.artist AS artist,
        (
          SELECT COUNT(*) FROM versions AS children
          WHERE children.parent_version_id = versions.id
        ) AS child_version_count,
        ${lifecycleProjectionSql("versions")}
      FROM versions
      INNER JOIN charts ON charts.id = versions.chart_id
      INNER JOIN songs ON songs.id = charts.song_id
      WHERE (? = '' OR songs.title LIKE ? ESCAPE '\\'
        OR songs.artist LIKE ? ESCAPE '\\'
        OR COALESCE(versions.chart_name, charts.chart_name) LIKE ? ESCAPE '\\'
        OR versions.author LIKE ? ESCAPE '\\'
        OR versions.id LIKE ? ESCAPE '\\'
        OR versions.chart_id LIKE ? ESCAPE '\\')
      ORDER BY versions.created_at DESC, versions.id DESC
    `).bind(query, escapedQuery, escapedQuery, escapedQuery, escapedQuery, escapedQuery, escapedQuery)
      .all<VersionStatusRow>();

    const filtered = (result.results ?? [])
      .map(toStatusItem)
      .filter((item) => matchesState(item, requestedState))
      .filter((item) => !suspiciousOnly || item.suspicious);
    const offset = (page - 1) * pageSize;

    return ok(request, env, {
      items: filtered.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: filtered.length
    });
  } catch (error) {
    console.error("[admin-version-status-list] failed to list version states", {
      code: "ADMIN_VERSION_STATUS_LIST_FAILED",
      stage: "status_review_query",
      errorType: error instanceof Error ? error.name : typeof error
    });
    return listError(request, env, `D1 query failed: ${errorDetail(error)}`);
  }
}

function updateError(
  request: Request,
  env: Env,
  status: number,
  code: string,
  message: string,
  detail: string
): Response {
  return apiError(request, env, status, code, message, detail);
}

async function parseUpdateBody(request: Request, env: Env): Promise<ValidStatusUpdate | Response> {
  let body: StatusUpdateBody;
  try {
    body = await request.json<StatusUpdateBody>();
  } catch {
    return updateError(
      request,
      env,
      400,
      "ADMIN_VERSION_STATUS_INVALID_TARGET",
      "修正内容が不正です。",
      "Request body must be valid JSON."
    );
  }

  if (!body || typeof body !== "object" || !["incomplete", "completed", "rejected_completed"].includes(String(body.targetState))) {
    return updateError(
      request,
      env,
      400,
      "ADMIN_VERSION_STATUS_INVALID_TARGET",
      "修正先の投稿状態が不正です。",
      "targetState must be incomplete, completed, or rejected_completed."
    );
  }
  const targetState = body.targetState as AdminSubmissionState;

  if (body.progress === undefined || body.progress === null) {
    return updateError(
      request,
      env,
      400,
      "ADMIN_VERSION_STATUS_PROGRESS_REQUIRED",
      "進捗度を指定してください。",
      "progress is required."
    );
  }
  const progress = Number(body.progress);
  const progressValid = Number.isSafeInteger(progress)
    && (targetState === "incomplete" ? progress >= 0 && progress <= 99 : progress === 100);
  if (!progressValid || typeof body.allowAppend !== "boolean" || (targetState === "incomplete" && !body.allowAppend)) {
    return updateError(
      request,
      env,
      400,
      "ADMIN_VERSION_STATUS_PROGRESS_INVALID",
      "投稿状態と進捗度または追記受付の組み合わせが不正です。",
      "Incomplete requires progress 0-99 and allowAppend true; other states require progress 100."
    );
  }

  if (typeof body.reason !== "string" || !body.reason.trim()) {
    return updateError(
      request,
      env,
      400,
      "ADMIN_VERSION_STATUS_REASON_REQUIRED",
      "修正理由を入力してください。",
      "reason is required."
    );
  }
  const reason = body.reason.trim();
  const reasonLength = [...reason].length;
  if (reasonLength < MIN_REASON_LENGTH || reasonLength > MAX_REASON_LENGTH) {
    return updateError(
      request,
      env,
      400,
      "ADMIN_VERSION_STATUS_REASON_INVALID",
      "修正理由は5～500文字で入力してください。",
      `reason length must be ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} characters.`
    );
  }
  if (typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt.trim()) {
    return updateError(
      request,
      env,
      409,
      "ADMIN_VERSION_STATE_CONFLICT",
      "対象versionの更新時刻を確認できません。",
      "expectedUpdatedAt is required."
    );
  }

  return {
    targetState,
    progress,
    allowAppend: body.allowAppend,
    reason,
    expectedUpdatedAt: body.expectedUpdatedAt.trim()
  };
}

async function findVersionStatus(env: Env, versionId: string): Promise<VersionStatusRow | null> {
  return env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      versions.chart_id AS chart_id,
      versions.parent_version_id AS parent_version_id,
      versions.version_number AS version_number,
      versions.branch_label AS branch_label,
      versions.branch_path AS branch_path,
      versions.author AS author,
      versions.progress AS progress,
      versions.progress_map_json AS progress_map_json,
      versions.is_rejected AS is_rejected,
      versions.allow_append AS allow_append,
      versions.is_hidden AS is_hidden,
      versions.file_deleted_at AS file_deleted_at,
      versions.created_at AS created_at,
      versions.updated_at AS updated_at,
      versions.completed_at AS completed_at,
      versions.withdrawn_at AS withdrawn_at,
      versions.delete_requested_at AS delete_requested_at,
      COALESCE(versions.chart_name, charts.chart_name) AS chart_name,
      songs.title AS song_title,
      songs.artist AS artist,
      (SELECT COUNT(*) FROM versions AS children WHERE children.parent_version_id = versions.id) AS child_version_count,
      ${lifecycleProjectionSql("versions")}
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    INNER JOIN songs ON songs.id = charts.song_id
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<VersionStatusRow>();
}

function notFoundResponse(request: Request, env: Env): Response {
  return updateError(
    request,
    env,
    404,
    "ADMIN_VERSION_STATUS_NOT_FOUND",
    "対象versionが見つかりません。",
    "The requested version does not exist."
  );
}

function unavailableResponse(request: Request, env: Env): Response {
  return updateError(
    request,
    env,
    409,
    "ADMIN_VERSION_STATUS_UNAVAILABLE",
    "現在の公開状態では投稿状態を修正できません。",
    "Hidden, deleted, processing, tombstoned, or withdrawal-pending versions cannot be corrected."
  );
}

function conflictResponse(request: Request, env: Env): Response {
  return updateError(
    request,
    env,
    409,
    "ADMIN_VERSION_STATE_CONFLICT",
    "対象versionが表示後に更新されました。再読み込みしてください。",
    "updatedAt no longer matches expectedUpdatedAt."
  );
}

function buildReconciliationStatement(
  env: Env,
  chartId: string,
  targetVersionId: string,
  updatedAt: string
): D1PreparedStatement {
  return env.DB.prepare(`
    UPDATE versions AS candidate
    SET
      collapsed_by_completion = CASE
        WHEN candidate.collapsed_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN 0
        ELSE candidate.collapsed_by_completion
      END,
      collapsed_reason = CASE
        WHEN candidate.collapsed_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN NULL
        ELSE candidate.collapsed_reason
      END,
      collapsed_at = CASE
        WHEN candidate.collapsed_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN NULL
        ELSE candidate.collapsed_at
      END,
      collapsed_by_version_id = CASE
        WHEN candidate.collapsed_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN NULL
        ELSE candidate.collapsed_by_version_id
      END,
      download_blocked = CASE
        WHEN candidate.download_block_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN 0
        ELSE candidate.download_blocked
      END,
      download_block_reason = CASE
        WHEN candidate.download_block_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN NULL
        ELSE candidate.download_block_reason
      END,
      download_blocked_at = CASE
        WHEN candidate.download_block_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN NULL
        ELSE candidate.download_blocked_at
      END,
      updated_at = CASE
        WHEN candidate.id = ? THEN candidate.updated_at
        WHEN candidate.collapsed_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}'
          OR candidate.download_block_reason = '${COMPLETED_DESCENDANT_SUPERSESSION_REASON}' THEN ?
        ELSE candidate.updated_at
      END
    WHERE candidate.chart_id = ?
      AND EXISTS (SELECT 1 FROM versions AS target WHERE target.id = ? AND target.updated_at = ?)
  `).bind(targetVersionId, updatedAt, chartId, targetVersionId, updatedAt);
}

export async function updateAdminVersionStatus(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response> {
  if (request.method !== "PATCH") {
    return methodNotAllowed(request, env, request.method);
  }

  const parsed = await parseUpdateBody(request, env);
  if (parsed instanceof Response) return parsed;

  let beforeRow: VersionStatusRow | null;
  try {
    beforeRow = await findVersionStatus(env, versionId);
  } catch (error) {
    console.error("[admin-version-status-update] failed to load target version", {
      code: "ADMIN_VERSION_STATUS_UPDATE_FAILED",
      stage: "load_target",
      versionId,
      errorType: error instanceof Error ? error.name : typeof error
    });
    return updateError(
      request,
      env,
      500,
      "ADMIN_VERSION_STATUS_UPDATE_FAILED",
      "対象versionの確認に失敗しました。",
      `D1 target query failed: ${errorDetail(error)}`
    );
  }
  if (!beforeRow) return notFoundResponse(request, env);

  const beforeItem = toStatusItem(beforeRow);
  if (!beforeItem.canCorrect) return unavailableResponse(request, env);
  if (beforeRow.updated_at !== parsed.expectedUpdatedAt) return conflictResponse(request, env);

  const normalizedMap = normalizeStoredProgressMapForSubmissionState({
    rawProgressMap: beforeRow.progress_map_json,
    versionId,
    targetState: parsed.targetState,
    progress: parsed.progress
  });
  const updatedAt = new Date().toISOString();
  const completedAt = parsed.targetState === "completed"
    ? (beforeRow.completed_at ?? beforeRow.created_at)
    : null;
  const beforeState = currentSubmissionState(beforeRow);
  const isRejected = parsed.targetState === "rejected_completed" ? 1 : 0;
  const detail = JSON.stringify({
    versionId,
    chartId: beforeRow.chart_id,
    beforeState,
    afterState: parsed.targetState,
    beforeProgress: beforeRow.progress,
    afterProgress: parsed.progress,
    beforeAllowAppend: beforeRow.allow_append === 1,
    afterAllowAppend: parsed.allowAppend,
    mapProgress: normalizedMap.progress,
    reasonLength: [...parsed.reason].length,
    completionReconciled: true,
    updatedAt
  });

  const targetUpdate = env.DB.prepare(`
    UPDATE versions
    SET
      is_rejected = ?,
      completed_at = ?,
      progress = ?,
      allow_append = ?,
      progress_map_json = ?,
      updated_at = ?
    WHERE id = ?
      AND updated_at = ?
      AND is_hidden = 0
      AND file_deleted_at IS NULL
      AND withdrawn_at IS NULL
      AND delete_requested_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM version_withdrawals AS lifecycle
        WHERE lifecycle.version_id = versions.id
          AND lifecycle.status IN ('pending', 'processing', 'tombstoned', 'deleted')
      )
  `).bind(
    isRejected,
    completedAt,
    parsed.progress,
    parsed.allowAppend ? 1 : 0,
    normalizedMap.progressMapJson,
    updatedAt,
    versionId,
    parsed.expectedUpdatedAt
  );
  const reconciliation = buildReconciliationStatement(env, beforeRow.chart_id, versionId, updatedAt);
  const chartUpdate = env.DB.prepare(`
    UPDATE charts SET updated_at = ?
    WHERE id = ? AND EXISTS (SELECT 1 FROM versions WHERE id = ? AND updated_at = ?)
  `).bind(updatedAt, beforeRow.chart_id, versionId, updatedAt);
  const adminLog = env.DB.prepare(`
    INSERT INTO admin_logs (id, action, target_type, target_id, level, code, reason, detail)
    SELECT ?, 'correct_version_submission_state', 'version', ?, 'info', NULL, ?, ?
    WHERE EXISTS (SELECT 1 FROM versions WHERE id = ? AND updated_at = ?)
  `).bind(makeId("admin_log"), versionId, parsed.reason, detail, versionId, updatedAt);

  try {
    const results = await env.DB.batch([targetUpdate, reconciliation, chartUpdate, adminLog]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      const latest = await findVersionStatus(env, versionId);
      if (!latest) return notFoundResponse(request, env);
      if (!toStatusItem(latest).canCorrect) return unavailableResponse(request, env);
      return conflictResponse(request, env);
    }
  } catch (error) {
    console.error("[admin-version-status-update] transaction failed", {
      code: "ADMIN_VERSION_STATUS_RECONCILE_FAILED",
      stage: "status_update_batch",
      versionId,
      chartId: beforeRow.chart_id,
      errorType: error instanceof Error ? error.name : typeof error
    });
    return updateError(
      request,
      env,
      500,
      "ADMIN_VERSION_STATUS_RECONCILE_FAILED",
      "投稿状態の修正transactionに失敗しました。",
      `D1 batch failed: ${errorDetail(error)}`
    );
  }

  return ok(request, env, {
    versionId,
    chartId: beforeRow.chart_id,
    before: {
      state: beforeState,
      progress: beforeRow.progress,
      allowAppend: beforeRow.allow_append === 1
    },
    after: {
      state: parsed.targetState,
      progress: parsed.progress,
      allowAppend: parsed.allowAppend
    },
    updatedAt
  });
}
