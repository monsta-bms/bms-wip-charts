import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";
import {
  createAdminBan,
  liftAdminBan,
  listAdminBans,
  listAdminPostLogs
} from "./bans";
import { deleteR2CleanupFile, listR2CleanupCandidates } from "./r2Cleanup";
import { backfillVersionSourceMetadata } from "./versionSourceMetadataBackfill";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_ADMIN_NOTE_LENGTH = 1000;
const ADMIN_ACTOR = "admin";

type DeleteRequestDecision = "approve" | "reject";

type DeleteRequestListRow = {
  request_id: string;
  request_status: string;
  request_message: string;
  request_created_at: string;
  version_id: string;
  chart_id: string;
  branch_path: string;
  author: string;
  progress: number;
  version_created_at: string;
  withdrawn_at: string | null;
  is_hidden: number;
  hidden_reason: string | null;
  download_blocked: number;
  download_block_reason: string | null;
  chart_name: string;
  song_title: string;
  child_version_count: number;
  total_child_version_count: number;
};

type DeleteRequestActionRow = {
  request_id: string;
  request_status: string;
  version_id: string;
  chart_id: string;
  is_hidden: number;
  hidden_reason: string | null;
  download_blocked: number;
  download_block_reason: string | null;
  child_version_count: number;
  total_child_version_count: number;
  other_pending_count: number;
};

type AdminNoteBody = {
  adminNote: string;
};

type AdminLogContext = {
  requestId: string;
  versionId?: string | null;
  chartId?: string | null;
  childVersionCount?: number;
  visibleChildVersionCount?: number;
  totalChildVersionCount?: number;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  outcome?: string | null;
  errorCode?: string | null;
  adminNoteLength?: number;
};

type ManualWithdrawalRow = {
  withdrawal_id: string;
  version_id: string;
  chart_id: string;
  status: "pending";
  branch_path: string;
  song_title: string;
  chart_name: string;
  requested_at: string;
  request_reason: string | null;
  direct_child_count: number;
  collapsed_reference_count: number;
  legacy_delete_request_count: number;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function tokensMatch(submitted: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const submittedBytes = encoder.encode(submitted);
  const expectedBytes = encoder.encode(expected);
  if (submittedBytes.byteLength !== expectedBytes.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < submittedBytes.byteLength; index += 1) {
    mismatch |= submittedBytes[index] ^ expectedBytes[index];
  }
  return mismatch === 0;
}

function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) {
    console.error("[admin-auth] ADMIN_TOKEN secret is not configured", {
      code: "CONFIG_MISSING",
      target: "ADMIN_TOKEN"
    });

    return apiError(
      request,
      env,
      500,
      "CONFIG_MISSING",
      "管理者認証の設定が不足しています。",
      "ADMIN_TOKEN secret is not configured."
    );
  }

  const token = getBearerToken(request);
  if (!token || !tokensMatch(token, env.ADMIN_TOKEN)) {
    return apiError(
      request,
      env,
      401,
      "ADMIN_AUTH_REQUIRED",
      "管理者認証が必要です。",
      "Authorization header must contain the configured admin Bearer token."
    );
  }

  return null;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

async function writeAdminLog(
  env: Env,
  action: "approve_delete_request" | "reject_delete_request",
  level: "info" | "warning" | "error",
  code: string | null,
  context: AdminLogContext
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
      ) VALUES (?, ?, 'delete_request', ?, ?, ?, ?, ?)
    `).bind(
      makeId("admin_log"),
      action,
      context.requestId,
      level,
      code,
      context.outcome ?? code,
      JSON.stringify({
        requestId: context.requestId,
        versionId: context.versionId ?? null,
        chartId: context.chartId ?? null,
        childVersionCount: context.childVersionCount ?? null,
        visibleChildVersionCount:
          context.visibleChildVersionCount ?? context.childVersionCount ?? null,
        totalChildVersionCount: context.totalChildVersionCount ?? null,
        beforeStatus: context.beforeStatus ?? null,
        afterStatus: context.afterStatus ?? null,
        outcome: context.outcome ?? null,
        errorCode: context.errorCode ?? code,
        adminNoteLength: context.adminNoteLength ?? 0
      })
    ).run();
  } catch (error) {
    console.error("[admin-delete-request-log] failed to write admin log", {
      action,
      code: "ADMIN_LOG_WRITE_FAILED",
      requestId: context.requestId,
      message: errorDetail(error)
    });
  }
}

async function selectDeleteRequest(env: Env, requestId: string): Promise<DeleteRequestActionRow | null> {
  return env.DB.prepare(`
    SELECT
      delete_requests.id AS request_id,
      delete_requests.status AS request_status,
      versions.id AS version_id,
      versions.chart_id AS chart_id,
      versions.is_hidden AS is_hidden,
      versions.hidden_reason AS hidden_reason,
      versions.download_blocked AS download_blocked,
      versions.download_block_reason AS download_block_reason,
      (
        SELECT COUNT(*)
        FROM versions AS children
        WHERE children.parent_version_id = versions.id
          AND COALESCE(children.is_hidden, 0) = 0
      ) AS child_version_count,
      (
        SELECT COUNT(*)
        FROM versions AS children
        WHERE children.parent_version_id = versions.id
      ) AS total_child_version_count,
      (
        SELECT COUNT(*)
        FROM delete_requests AS other_requests
        WHERE other_requests.version_id = versions.id
          AND other_requests.status = 'pending'
          AND other_requests.id <> delete_requests.id
      ) AS other_pending_count
    FROM delete_requests
    INNER JOIN versions ON versions.id = delete_requests.version_id
    WHERE delete_requests.id = ?
    LIMIT 1
  `).bind(requestId).first<DeleteRequestActionRow>();
}

async function listPendingDeleteRequests(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim() || "pending";
  if (status !== "pending") {
    return apiError(
      request,
      env,
      400,
      "INVALID_REQUEST",
      "一覧条件が不正です。",
      "ADMIN-DELETE-01 supports status=pending only."
    );
  }

  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(
    parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const offset = (page - 1) * pageSize;

  try {
    const totalRow = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM delete_requests
      WHERE status = 'pending'
    `).first<{ total: number }>();

    const result = await env.DB.prepare(`
      SELECT
        delete_requests.id AS request_id,
        delete_requests.status AS request_status,
        delete_requests.message AS request_message,
        delete_requests.created_at AS request_created_at,
        versions.id AS version_id,
        versions.chart_id AS chart_id,
        versions.branch_path AS branch_path,
        versions.author AS author,
        versions.progress AS progress,
        versions.created_at AS version_created_at,
        versions.withdrawn_at AS withdrawn_at,
        versions.is_hidden AS is_hidden,
        versions.hidden_reason AS hidden_reason,
        versions.download_blocked AS download_blocked,
        versions.download_block_reason AS download_block_reason,
        COALESCE(versions.chart_name, charts.chart_name) AS chart_name,
        songs.title AS song_title,
        (
          SELECT COUNT(*)
          FROM versions AS children
          WHERE children.parent_version_id = versions.id
            AND COALESCE(children.is_hidden, 0) = 0
        ) AS child_version_count,
        (
          SELECT COUNT(*)
          FROM versions AS children
          WHERE children.parent_version_id = versions.id
        ) AS total_child_version_count
      FROM delete_requests
      INNER JOIN versions ON versions.id = delete_requests.version_id
      INNER JOIN charts ON charts.id = versions.chart_id
      INNER JOIN songs ON songs.id = charts.song_id
      WHERE delete_requests.status = 'pending'
      ORDER BY delete_requests.created_at ASC, delete_requests.id ASC
      LIMIT ? OFFSET ?
    `).bind(pageSize, offset).all<DeleteRequestListRow>();

    return ok(request, env, {
      ok: true,
      items: result.results.map((row) => ({
        requestId: row.request_id,
        status: row.request_status,
        message: row.request_message,
        createdAt: row.request_created_at,
        versionId: row.version_id,
        chartId: row.chart_id,
        songTitle: row.song_title,
        chartName: row.chart_name,
        versionLabel: buildVersionPathLabel(row.branch_path),
        branchPath: row.branch_path,
        author: row.author,
        progress: Number(row.progress),
        versionCreatedAt: row.version_created_at,
        withdrawn: row.withdrawn_at !== null,
        isHidden: Number(row.is_hidden) === 1,
        hiddenReason: row.hidden_reason,
        downloadBlocked: Number(row.download_blocked) === 1,
        downloadBlockReason: row.download_block_reason,
        childVersionCount: Number(row.child_version_count),
        visibleChildVersionCount: Number(row.child_version_count),
        totalChildVersionCount: Number(row.total_child_version_count),
        canApprove: Number(row.child_version_count) === 0
      })),
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0)
    });
  } catch (error) {
    console.error("[admin-delete-request-list] failed to read pending requests", {
      code: "DELETE_REQUEST_LIST_FAILED",
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "DELETE_REQUEST_LIST_FAILED",
      "削除申請一覧の取得に失敗しました。",
      `D1 pending delete request query failed: ${errorDetail(error)}`
    );
  }
}

async function listManualWithdrawalRequests(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(request, env, request.method);
  const url = new URL(request.url);
  const handlingMode = url.searchParams.get("handlingMode")?.trim() || "manual_review";
  if (handlingMode !== "manual_review") {
    return apiError(
      request,
      env,
      400,
      "INVALID_REQUEST",
      "一覧条件が不正です。",
      "Only handlingMode=manual_review is supported."
    );
  }
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(
    parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const offset = (page - 1) * pageSize;
  try {
    const totalRow = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM version_withdrawals
      WHERE status = 'pending' AND handling_mode = 'manual_review'
    `).first<{ total: number }>();
    const result = await env.DB.prepare(`
      SELECT
        withdrawals.id AS withdrawal_id,
        withdrawals.version_id,
        withdrawals.chart_id,
        withdrawals.status,
        withdrawals.requested_at,
        withdrawals.request_reason,
        versions.branch_path,
        songs.title AS song_title,
        COALESCE(versions.chart_name, charts.chart_name) AS chart_name,
        (SELECT COUNT(*) FROM versions AS children WHERE children.parent_version_id = versions.id) AS direct_child_count,
        (SELECT COUNT(*) FROM versions AS refs WHERE refs.collapsed_by_version_id = versions.id) AS collapsed_reference_count,
        (SELECT COUNT(*) FROM delete_requests AS requests WHERE requests.version_id = versions.id) AS legacy_delete_request_count
      FROM version_withdrawals AS withdrawals
      INNER JOIN versions ON versions.id = withdrawals.version_id
      INNER JOIN charts ON charts.id = versions.chart_id
      INNER JOIN songs ON songs.id = charts.song_id
      WHERE withdrawals.status = 'pending'
        AND withdrawals.handling_mode = 'manual_review'
      ORDER BY withdrawals.requested_at ASC, withdrawals.id ASC
      LIMIT ? OFFSET ?
    `).bind(pageSize, offset).all<ManualWithdrawalRow>();
    return ok(request, env, {
      ok: true,
      items: result.results.map((row) => ({
        withdrawalId: row.withdrawal_id,
        versionId: row.version_id,
        chartId: row.chart_id,
        songTitle: row.song_title,
        chartName: row.chart_name,
        versionLabel: buildVersionPathLabel(row.branch_path),
        requestedAt: row.requested_at,
        reason: row.request_reason || "理由未登録（旧申請または即時処理中の競合）",
        handlingMode: "manual_review",
        status: row.status,
        hasDependencies: Number(row.direct_child_count) > 0
          || Number(row.collapsed_reference_count) > 0
          || Number(row.legacy_delete_request_count) > 0,
        directChildCount: Number(row.direct_child_count),
        collapsedReferenceCount: Number(row.collapsed_reference_count),
        legacyDeleteRequestCount: Number(row.legacy_delete_request_count)
      })),
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0)
    });
  } catch (error) {
    console.error("[admin-withdrawal-list] failed", {
      code: "WITHDRAWAL_LIST_FAILED",
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      500,
      "WITHDRAWAL_LIST_FAILED",
      "取り下げ申請一覧の取得に失敗しました。",
      `D1 manual withdrawal query failed: ${errorDetail(error)}`
    );
  }
}

async function approveDeleteRequest(
  request: Request,
  env: Env,
  requestId: string,
  body: AdminNoteBody
): Promise<Response> {
  const logAction = "approve_delete_request" as const;
  let current: DeleteRequestActionRow | null;
  try {
    current = await selectDeleteRequest(env, requestId);
  } catch (error) {
    await writeAdminLog(env, logAction, "error", "DELETE_REQUEST_APPROVE_FAILED", {
      requestId,
      errorCode: "DELETE_REQUEST_APPROVE_FAILED",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      500,
      "DELETE_REQUEST_APPROVE_FAILED",
      "削除申請の承認に失敗しました。",
      `D1 delete request lookup failed: ${errorDetail(error)}`
    );
  }

  if (!current) {
    await writeAdminLog(env, logAction, "warning", "DELETE_REQUEST_NOT_FOUND", {
      requestId,
      errorCode: "DELETE_REQUEST_NOT_FOUND",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      404,
      "DELETE_REQUEST_NOT_FOUND",
      "削除申請が見つかりません。",
      "requestId was not found."
    );
  }

  const childVersionCount = Number(current.child_version_count);
  const totalChildVersionCount = Number(current.total_child_version_count);
  if (current.request_status !== "pending") {
    await writeAdminLog(env, logAction, "warning", "DELETE_REQUEST_ALREADY_HANDLED", {
      requestId,
      versionId: current.version_id,
      chartId: current.chart_id,
      childVersionCount,
      totalChildVersionCount,
      beforeStatus: current.request_status,
      afterStatus: current.request_status,
      errorCode: "DELETE_REQUEST_ALREADY_HANDLED",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      409,
      "DELETE_REQUEST_ALREADY_HANDLED",
      "この削除申請は処理済みです。",
      `Current status is ${current.request_status}.`
    );
  }

  if (childVersionCount > 0) {
    await writeAdminLog(env, logAction, "warning", "DELETE_REQUEST_HAS_DESCENDANTS", {
      requestId,
      versionId: current.version_id,
      chartId: current.chart_id,
      childVersionCount,
      totalChildVersionCount,
      beforeStatus: current.request_status,
      afterStatus: current.request_status,
      errorCode: "DELETE_REQUEST_HAS_DESCENDANTS",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      409,
      "DELETE_REQUEST_HAS_DESCENDANTS",
      "派生versionがあるため承認できません。",
      `The target version has ${childVersionCount} visible direct child version(s).`
    );
  }

  const wasHidden = Number(current.is_hidden) === 1;
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE versions
        SET
          is_hidden = 1,
          hidden_at = COALESCE(hidden_at, CURRENT_TIMESTAMP),
          hidden_reason = CASE
            WHEN is_hidden = 1 THEN hidden_reason
            ELSE 'delete_request_approved'
          END,
          download_blocked = 1,
          download_block_reason = CASE
            WHEN download_blocked = 1 AND download_block_reason IS NOT NULL
              THEN download_block_reason
            ELSE 'delete_requested'
          END,
          download_blocked_at = COALESCE(download_blocked_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM delete_requests
            WHERE id = ?
              AND version_id = versions.id
              AND status = 'pending'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM versions AS children
            WHERE children.parent_version_id = versions.id
              AND COALESCE(children.is_hidden, 0) = 0
          )
      `).bind(current.version_id, requestId),
      env.DB.prepare(`
        UPDATE delete_requests
        SET
          status = 'approved',
          handled_at = CURRENT_TIMESTAMP,
          handled_by = ?,
          admin_note = ?
        WHERE id = ?
          AND status = 'pending'
          AND EXISTS (
            SELECT 1
            FROM versions
            WHERE versions.id = delete_requests.version_id
              AND versions.is_hidden = 1
          )
      `).bind(ADMIN_ACTOR, body.adminNote || null, requestId)
    ]);

    if (Number(results[1]?.meta.changes ?? 0) !== 1) {
      const latest = await selectDeleteRequest(env, requestId);
      const errorCode = latest?.request_status !== "pending"
        ? "DELETE_REQUEST_ALREADY_HANDLED"
        : Number(latest?.child_version_count ?? 0) > 0
          ? "DELETE_REQUEST_HAS_DESCENDANTS"
          : "DELETE_REQUEST_APPROVE_FAILED";
      const status = errorCode === "DELETE_REQUEST_APPROVE_FAILED" ? 500 : 409;
      await writeAdminLog(env, logAction, status === 500 ? "error" : "warning", errorCode, {
        requestId,
        versionId: current.version_id,
        chartId: current.chart_id,
        childVersionCount: Number(latest?.child_version_count ?? childVersionCount),
        totalChildVersionCount: Number(
          latest?.total_child_version_count ?? totalChildVersionCount
        ),
        beforeStatus: current.request_status,
        afterStatus: latest?.request_status ?? null,
        errorCode,
        adminNoteLength: body.adminNote.length
      });
      return apiError(
        request,
        env,
        status,
        errorCode,
        errorCode === "DELETE_REQUEST_HAS_DESCENDANTS"
          ? "派生versionがあるため承認できません。"
          : errorCode === "DELETE_REQUEST_ALREADY_HANDLED"
            ? "この削除申請は処理済みです。"
            : "削除申請の承認に失敗しました。",
        "The delete request state changed before approval completed."
      );
    }

    const outcome = wasHidden ? "already_hidden" : "version_hidden";
    await writeAdminLog(env, logAction, "info", null, {
      requestId,
      versionId: current.version_id,
      chartId: current.chart_id,
      childVersionCount,
      totalChildVersionCount,
      beforeStatus: "pending",
      afterStatus: "approved",
      outcome,
      adminNoteLength: body.adminNote.length
    });
    return ok(request, env, {
      ok: true,
      requestId,
      versionId: current.version_id,
      status: "approved",
      outcome
    });
  } catch (error) {
    await writeAdminLog(env, logAction, "error", "DELETE_REQUEST_APPROVE_FAILED", {
      requestId,
      versionId: current.version_id,
      chartId: current.chart_id,
      childVersionCount,
      totalChildVersionCount,
      beforeStatus: current.request_status,
      errorCode: "DELETE_REQUEST_APPROVE_FAILED",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      500,
      "DELETE_REQUEST_APPROVE_FAILED",
      "削除申請の承認に失敗しました。",
      `D1 approval update failed: ${errorDetail(error)}`
    );
  }
}

async function rejectDeleteRequest(
  request: Request,
  env: Env,
  requestId: string,
  body: AdminNoteBody
): Promise<Response> {
  const logAction = "reject_delete_request" as const;
  let current: DeleteRequestActionRow | null;
  try {
    current = await selectDeleteRequest(env, requestId);
  } catch (error) {
    await writeAdminLog(env, logAction, "error", "DELETE_REQUEST_REJECT_FAILED", {
      requestId,
      errorCode: "DELETE_REQUEST_REJECT_FAILED",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      500,
      "DELETE_REQUEST_REJECT_FAILED",
      "削除申請の却下に失敗しました。",
      `D1 delete request lookup failed: ${errorDetail(error)}`
    );
  }

  if (!current) {
    await writeAdminLog(env, logAction, "warning", "DELETE_REQUEST_NOT_FOUND", {
      requestId,
      errorCode: "DELETE_REQUEST_NOT_FOUND",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      404,
      "DELETE_REQUEST_NOT_FOUND",
      "削除申請が見つかりません。",
      "requestId was not found."
    );
  }

  const childVersionCount = Number(current.child_version_count);
  const totalChildVersionCount = Number(current.total_child_version_count);
  if (current.request_status !== "pending") {
    await writeAdminLog(env, logAction, "warning", "DELETE_REQUEST_ALREADY_HANDLED", {
      requestId,
      versionId: current.version_id,
      chartId: current.chart_id,
      childVersionCount,
      totalChildVersionCount,
      beforeStatus: current.request_status,
      afterStatus: current.request_status,
      errorCode: "DELETE_REQUEST_ALREADY_HANDLED",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      409,
      "DELETE_REQUEST_ALREADY_HANDLED",
      "この削除申請は処理済みです。",
      `Current status is ${current.request_status}.`
    );
  }

  const shouldRestoreDownload = current.download_block_reason === "delete_requested"
    && Number(current.other_pending_count) === 0;
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE delete_requests
        SET
          status = 'rejected',
          handled_at = CURRENT_TIMESTAMP,
          handled_by = ?,
          admin_note = ?
        WHERE id = ?
          AND status = 'pending'
      `).bind(ADMIN_ACTOR, body.adminNote, requestId),
      env.DB.prepare(`
        UPDATE versions
        SET
          delete_requested_at = CASE
            WHEN NOT EXISTS (
              SELECT 1
              FROM delete_requests AS pending_requests
              WHERE pending_requests.version_id = versions.id
                AND pending_requests.status = 'pending'
            ) THEN NULL
            ELSE delete_requested_at
          END,
          download_blocked = CASE
            WHEN download_block_reason = 'delete_requested'
              AND NOT EXISTS (
                SELECT 1
                FROM delete_requests AS pending_requests
                WHERE pending_requests.version_id = versions.id
                  AND pending_requests.status = 'pending'
              ) THEN 0
            ELSE download_blocked
          END,
          download_block_reason = CASE
            WHEN download_block_reason = 'delete_requested'
              AND NOT EXISTS (
                SELECT 1
                FROM delete_requests AS pending_requests
                WHERE pending_requests.version_id = versions.id
                  AND pending_requests.status = 'pending'
              ) THEN NULL
            ELSE download_block_reason
          END,
          download_blocked_at = CASE
            WHEN download_block_reason = 'delete_requested'
              AND NOT EXISTS (
                SELECT 1
                FROM delete_requests AS pending_requests
                WHERE pending_requests.version_id = versions.id
                  AND pending_requests.status = 'pending'
              ) THEN NULL
            ELSE download_blocked_at
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM delete_requests
            WHERE id = ?
              AND version_id = versions.id
              AND status = 'rejected'
          )
      `).bind(current.version_id, requestId)
    ]);

    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      const latest = await selectDeleteRequest(env, requestId);
      await writeAdminLog(env, logAction, "warning", "DELETE_REQUEST_ALREADY_HANDLED", {
        requestId,
        versionId: current.version_id,
        chartId: current.chart_id,
        childVersionCount,
        totalChildVersionCount,
        beforeStatus: current.request_status,
        afterStatus: latest?.request_status ?? null,
        errorCode: "DELETE_REQUEST_ALREADY_HANDLED",
        adminNoteLength: body.adminNote.length
      });
      return apiError(
        request,
        env,
        409,
        "DELETE_REQUEST_ALREADY_HANDLED",
        "この削除申請は処理済みです。",
        `Current status is ${latest?.request_status ?? "unknown"}.`
      );
    }

    await writeAdminLog(env, logAction, "info", null, {
      requestId,
      versionId: current.version_id,
      chartId: current.chart_id,
      childVersionCount,
      totalChildVersionCount,
      beforeStatus: "pending",
      afterStatus: "rejected",
      outcome: shouldRestoreDownload ? "request_rejected_download_restored" : "request_rejected",
      adminNoteLength: body.adminNote.length
    });
    return ok(request, env, {
      ok: true,
      requestId,
      versionId: current.version_id,
      status: "rejected",
      outcome: "request_rejected",
      downloadRestored: shouldRestoreDownload
    });
  } catch (error) {
    await writeAdminLog(env, logAction, "error", "DELETE_REQUEST_REJECT_FAILED", {
      requestId,
      versionId: current.version_id,
      chartId: current.chart_id,
      childVersionCount,
      totalChildVersionCount,
      beforeStatus: current.request_status,
      errorCode: "DELETE_REQUEST_REJECT_FAILED",
      adminNoteLength: body.adminNote.length
    });
    return apiError(
      request,
      env,
      500,
      "DELETE_REQUEST_REJECT_FAILED",
      "削除申請の却下に失敗しました。",
      `D1 rejection update failed: ${errorDetail(error)}`
    );
  }
}

async function handleDecision(
  request: Request,
  env: Env,
  requestId: string,
  decision: DeleteRequestDecision
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }

  const parsed = await parseAdminNoteWithEnv(request, env, decision === "reject");
  if (!parsed.ok) {
    await writeAdminLog(
      env,
      decision === "approve" ? "approve_delete_request" : "reject_delete_request",
      "warning",
      "INVALID_ADMIN_NOTE",
      { requestId, errorCode: "INVALID_ADMIN_NOTE" }
    );
    return parsed.response;
  }

  return decision === "approve"
    ? approveDeleteRequest(request, env, requestId, parsed.value)
    : rejectDeleteRequest(request, env, requestId, parsed.value);
}

async function parseAdminNoteWithEnv(
  request: Request,
  env: Env,
  required: boolean
): Promise<{ ok: true; value: AdminNoteBody } | { ok: false; response: Response }> {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_ADMIN_NOTE",
        "管理メモの形式が不正です。",
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
      response: apiError(
        request,
        env,
        400,
        "INVALID_ADMIN_NOTE",
        "管理メモの形式が不正です。",
        `Request body must be valid JSON: ${errorDetail(error)}`
      )
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_ADMIN_NOTE",
        "管理メモの形式が不正です。",
        "Request body must be a JSON object."
      )
    };
  }

  const value = (body as Record<string, unknown>).adminNote;
  if (value !== undefined && typeof value !== "string") {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_ADMIN_NOTE",
        "管理メモの形式が不正です。",
        "adminNote must be a string."
      )
    };
  }

  const adminNote = typeof value === "string" ? value.trim() : "";
  if ((required && !adminNote) || adminNote.length > MAX_ADMIN_NOTE_LENGTH) {
    return {
      ok: false,
      response: apiError(
        request,
        env,
        400,
        "INVALID_ADMIN_NOTE",
        "管理メモを確認してください。",
        required && !adminNote
          ? "adminNote is required when rejecting a delete request."
          : `adminNote must be ${MAX_ADMIN_NOTE_LENGTH} characters or less.`
      )
    };
  }

  return { ok: true, value: { adminNote } };
}

export async function handleAdminRoute(
  request: Request,
  env: Env,
  segments: string[]
): Promise<Response> {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  if (segments.length === 1 && segments[0] === "delete-requests") {
    if (request.method !== "GET") {
      return methodNotAllowed(request, env, request.method);
    }
    return listPendingDeleteRequests(request, env);
  }

  if (segments.length === 1 && segments[0] === "version-withdrawals") {
    return listManualWithdrawalRequests(request, env);
  }

  if (
    segments.length === 2
    && segments[0] === "version-source-metadata"
    && segments[1] === "backfill"
  ) {
    if (request.method !== "POST") {
      return methodNotAllowed(request, env, request.method);
    }
    return backfillVersionSourceMetadata(request, env);
  }

  if (segments.length === 1 && segments[0] === "post-logs") {
    return listAdminPostLogs(request, env);
  }

  if (segments.length === 1 && segments[0] === "bans") {
    if (request.method === "GET") {
      return listAdminBans(request, env);
    }
    if (request.method === "POST") {
      return createAdminBan(request, env);
    }
    return methodNotAllowed(request, env, request.method);
  }

  if (
    segments.length === 3
    && segments[0] === "bans"
    && segments[2] === "lift"
  ) {
    return liftAdminBan(request, env, segments[1]);
  }

  if (segments.length === 1 && segments[0] === "r2-cleanup-candidates") {
    return listR2CleanupCandidates(request, env);
  }

  if (
    segments.length === 3
    && segments[0] === "r2-cleanup"
    && segments[2] === "delete-file"
  ) {
    return deleteR2CleanupFile(request, env, segments[1]);
  }

  if (
    segments.length === 3
    && segments[0] === "delete-requests"
    && (segments[2] === "approve" || segments[2] === "reject")
  ) {
    return handleDecision(
      request,
      env,
      segments[1],
      segments[2] as DeleteRequestDecision
    );
  }

  if (segments.length === 1 && request.method === "POST" && segments[0] === "hide-version") {
    return ok(request, env, {
      hidden: false,
      mode: "stub",
      message: "Version hiding is not implemented in Phase 9."
    });
  }

  return apiError(
    request,
    env,
    404,
    "ADMIN_ROUTE_NOT_FOUND",
    "管理APIが見つかりません。",
    `Unknown admin route: ${segments.join("/")}`
  );
}
