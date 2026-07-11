import { hashWithSecret } from "../utils/hash";
import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";

const MAX_DELETE_REQUEST_REASON_LENGTH = 500;
const INVALID_PASSWORD_LIMIT = 5;
const INVALID_PASSWORD_WINDOW_MINUTES = 10;

type LifecycleAction = "withdraw_version" | "request_delete";
type RouteAction = "withdraw" | "delete-request";

type VersionLifecycleRow = {
  id: string;
  chart_id: string;
  song_id: string;
  password_hash: string;
  file_sha256: string | null;
  is_hidden: number;
  withdrawn_at: string | null;
};

type LifecycleContext = {
  ipHash: string;
  uaHash: string;
  songId?: string | null;
  chartId?: string | null;
  versionId?: string | null;
  fileSha256?: string | null;
};

type LifecycleRequestBody = {
  password: string;
  reason: string;
};

type Failure = {
  status: number;
  code: string;
  message: string;
  detail: string;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getClientIpMarker(request: Request): string {
  return request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "unknown";
}

function getUserAgentMarker(request: Request): string {
  return request.headers.get("User-Agent")?.trim() || "unknown";
}

async function buildLifecycleContext(request: Request, secret: string): Promise<LifecycleContext> {
  return {
    ipHash: await hashWithSecret(`ip:${getClientIpMarker(request)}`, secret),
    uaHash: await hashWithSecret(`ua:${getUserAgentMarker(request)}`, secret)
  };
}

async function writePostLog(
  env: Env,
  context: LifecycleContext,
  action: LifecycleAction,
  result: "accepted" | "rejected",
  errorCode: string | null,
  detail: string
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO post_logs (
      id,
      action,
      song_id,
      chart_id,
      version_id,
      ip_hash,
      ua_hash,
      file_sha256,
      result,
      error_code,
      detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    makeId("post_log"),
    action,
    context.songId ?? null,
    context.chartId ?? null,
    context.versionId ?? null,
    context.ipHash,
    context.uaHash,
    context.fileSha256 ?? null,
    result,
    errorCode,
    detail
  ).run();
}

async function failLifecycle(
  request: Request,
  env: Env,
  context: LifecycleContext,
  action: LifecycleAction,
  failure: Failure
): Promise<Response> {
  try {
    await writePostLog(env, context, action, "rejected", failure.code, failure.detail);
  } catch (error) {
    console.error("[version-lifecycle-post-log] failed to write rejected operation log", {
      code: "POST_LOG_WRITE_FAILED",
      action,
      errorCode: failure.code,
      versionId: context.versionId ?? null,
      message: errorDetail(error)
    });
  }

  return apiError(request, env, failure.status, failure.code, failure.message, failure.detail);
}

async function parseRequestBody(
  request: Request
): Promise<{ ok: true; value: LifecycleRequestBody } | { ok: false; failure: Failure }> {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_REQUEST",
        message: "リクエスト形式が不正です。",
        detail: "Content-Type must be application/json."
      }
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_REQUEST",
        message: "リクエスト形式が不正です。",
        detail: `Request body must be valid JSON: ${errorDetail(error)}`
      }
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_REQUEST",
        message: "リクエスト形式が不正です。",
        detail: "Request body must be a JSON object."
      }
    };
  }

  const record = body as Record<string, unknown>;
  const password = typeof record.password === "string" ? record.password.trim() : "";
  if (!password) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "PASSWORD_REQUIRED",
        message: "管理パスワードを入力してください。",
        detail: "password is required."
      }
    };
  }

  if (record.reason !== undefined && typeof record.reason !== "string") {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_DELETE_REQUEST_REASON",
        message: "削除申請理由が不正です。",
        detail: "reason must be a string when provided."
      }
    };
  }

  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (reason.length > MAX_DELETE_REQUEST_REASON_LENGTH) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "INVALID_DELETE_REQUEST_REASON",
        message: "削除申請理由が長すぎます。",
        detail: `reason must be ${MAX_DELETE_REQUEST_REASON_LENGTH} characters or less.`
      }
    };
  }

  return { ok: true, value: { password, reason } };
}

async function isRateLimited(env: Env, context: LifecycleContext): Promise<boolean> {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS failure_count
    FROM post_logs
    WHERE ip_hash = ?
      AND ua_hash = ?
      AND action IN ('withdraw_version', 'request_delete')
      AND result = 'rejected'
      AND error_code = 'INVALID_PASSWORD'
      AND created_at >= datetime('now', ?)
  `).bind(
    context.ipHash,
    context.uaHash,
    `-${INVALID_PASSWORD_WINDOW_MINUTES} minutes`
  ).first<{ failure_count: number }>();

  return Number(row?.failure_count ?? 0) >= INVALID_PASSWORD_LIMIT;
}

async function selectVersion(env: Env, versionId: string): Promise<VersionLifecycleRow | null> {
  return env.DB.prepare(`
    SELECT
      versions.id,
      versions.chart_id,
      charts.song_id,
      versions.password_hash,
      versions.file_sha256,
      versions.is_hidden,
      versions.withdrawn_at
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<VersionLifecycleRow>();
}

async function authenticateVersion(
  request: Request,
  env: Env,
  context: LifecycleContext,
  action: LifecycleAction,
  versionId: string,
  password: string,
  secret: string
): Promise<{ ok: true; value: VersionLifecycleRow } | { ok: false; response: Response }> {
  let version: VersionLifecycleRow | null;
  try {
    version = await selectVersion(env, versionId);
  } catch (error) {
    console.error("[version-lifecycle-lookup] failed to read version", {
      code: "D1_QUERY_FAILED",
      action,
      versionId,
      message: errorDetail(error)
    });
    return {
      ok: false,
      response: await failLifecycle(request, env, context, action, {
        status: 500,
        code: action === "withdraw_version" ? "WITHDRAW_FAILED" : "DELETE_REQUEST_FAILED",
        message: "対象versionの確認に失敗しました。",
        detail: `D1 version lookup failed: ${errorDetail(error)}`
      })
    };
  }

  if (!version || version.is_hidden === 1) {
    return {
      ok: false,
      response: await failLifecycle(request, env, context, action, {
        status: 404,
        code: "VERSION_NOT_FOUND",
        message: "対象のversionが見つかりません。",
        detail: "versionId was not found or is hidden."
      })
    };
  }

  context.songId = version.song_id;
  context.chartId = version.chart_id;
  context.versionId = version.id;
  context.fileSha256 = version.file_sha256;

  const submittedHash = await hashWithSecret(`password:${password}`, secret);
  if (submittedHash !== version.password_hash) {
    return {
      ok: false,
      response: await failLifecycle(request, env, context, action, {
        status: 401,
        code: "INVALID_PASSWORD",
        message: "管理パスワードが違います。",
        detail: "Submitted password does not match the version password hash."
      })
    };
  }

  return { ok: true, value: version };
}

async function handleWithdraw(
  request: Request,
  env: Env,
  context: LifecycleContext,
  version: VersionLifecycleRow
): Promise<Response> {
  if (version.withdrawn_at) {
    return failLifecycle(request, env, context, "withdraw_version", {
      status: 409,
      code: "VERSION_ALREADY_WITHDRAWN",
      message: "このversionは取り下げ済みです。",
      detail: `versionId is already withdrawn: ${version.id}`
    });
  }

  try {
    const result = await env.DB.prepare(`
      UPDATE versions
      SET
        withdrawn_at = CURRENT_TIMESTAMP,
        download_blocked = 1,
        download_block_reason = CASE
          WHEN download_blocked = 0 OR download_block_reason IS NULL THEN 'withdrawn'
          ELSE download_block_reason
        END,
        download_blocked_at = COALESCE(download_blocked_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND withdrawn_at IS NULL
    `).bind(version.id).run();

    if (Number(result.meta.changes ?? 0) === 0) {
      return failLifecycle(request, env, context, "withdraw_version", {
        status: 409,
        code: "VERSION_ALREADY_WITHDRAWN",
        message: "このversionは取り下げ済みです。",
        detail: `versionId was withdrawn by another request: ${version.id}`
      });
    }

    const updated = await env.DB.prepare(`
      SELECT withdrawn_at
      FROM versions
      WHERE id = ?
      LIMIT 1
    `).bind(version.id).first<{ withdrawn_at: string | null }>();

    try {
      await writePostLog(
        env,
        context,
        "withdraw_version",
        "accepted",
        null,
        `Version withdrawn. versionId=${version.id}; chartId=${version.chart_id}; r2Deleted=false; progressImageDeleted=false`
      );
    } catch (logError) {
      console.error("[version-lifecycle-post-log] failed to write accepted withdraw log", {
        code: "POST_LOG_WRITE_FAILED",
        versionId: version.id,
        message: errorDetail(logError)
      });
    }

    return ok(request, env, {
      ok: true,
      versionId: version.id,
      withdrawn: true,
      withdrawnAt: updated?.withdrawn_at ?? null
    });
  } catch (error) {
    console.error("[version-withdraw] failed to update version", {
      code: "WITHDRAW_FAILED",
      versionId: version.id,
      message: errorDetail(error)
    });
    return failLifecycle(request, env, context, "withdraw_version", {
      status: 500,
      code: "WITHDRAW_FAILED",
      message: "versionの取り下げに失敗しました。",
      detail: `D1 withdraw update failed: ${errorDetail(error)}`
    });
  }
}

async function handleDeleteRequest(
  request: Request,
  env: Env,
  context: LifecycleContext,
  version: VersionLifecycleRow,
  reason: string
): Promise<Response> {
  try {
    const existing = await env.DB.prepare(`
      SELECT id
      FROM delete_requests
      WHERE version_id = ?
        AND status = 'pending'
      LIMIT 1
    `).bind(version.id).first<{ id: string }>();

    if (existing) {
      return failLifecycle(request, env, context, "request_delete", {
        status: 409,
        code: "DELETE_REQUEST_ALREADY_EXISTS",
        message: "このversionは削除申請中です。",
        detail: `A pending delete request already exists for versionId=${version.id}.`
      });
    }

    const requestId = makeId("delete_request");
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO delete_requests (
          id,
          version_id,
          chart_id,
          message,
          requester_ip_hash,
          requester_ua_hash,
          status
        )
        SELECT ?, ?, ?, ?, ?, ?, 'pending'
        WHERE NOT EXISTS (
          SELECT 1
          FROM delete_requests
          WHERE version_id = ?
            AND status = 'pending'
        )
      `).bind(
        requestId,
        version.id,
        version.chart_id,
        reason,
        context.ipHash,
        context.uaHash,
        version.id
      ),
      env.DB.prepare(`
        UPDATE versions
        SET
          delete_requested_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND EXISTS (
            SELECT 1
            FROM delete_requests
            WHERE id = ?
          )
      `).bind(version.id, requestId)
    ]);

    if (Number(results[0]?.meta.changes ?? 0) === 0) {
      return failLifecycle(request, env, context, "request_delete", {
        status: 409,
        code: "DELETE_REQUEST_ALREADY_EXISTS",
        message: "このversionは削除申請中です。",
        detail: `A pending delete request was created by another request for versionId=${version.id}.`
      });
    }

    const updated = await env.DB.prepare(`
      SELECT delete_requested_at
      FROM versions
      WHERE id = ?
      LIMIT 1
    `).bind(version.id).first<{ delete_requested_at: string | null }>();

    try {
      await writePostLog(
        env,
        context,
        "request_delete",
        "accepted",
        null,
        `Delete requested. versionId=${version.id}; chartId=${version.chart_id}; reasonProvided=${reason.length > 0}; reasonLength=${reason.length}; r2Deleted=false; progressImageDeleted=false`
      );
    } catch (logError) {
      console.error("[version-lifecycle-post-log] failed to write accepted delete request log", {
        code: "POST_LOG_WRITE_FAILED",
        versionId: version.id,
        message: errorDetail(logError)
      });
    }

    return ok(request, env, {
      ok: true,
      versionId: version.id,
      deleteRequested: true,
      deleteRequestedAt: updated?.delete_requested_at ?? null
    });
  } catch (error) {
    console.error("[version-delete-request] failed to create delete request", {
      code: "DELETE_REQUEST_FAILED",
      versionId: version.id,
      message: errorDetail(error)
    });
    return failLifecycle(request, env, context, "request_delete", {
      status: 500,
      code: "DELETE_REQUEST_FAILED",
      message: "削除申請の受付に失敗しました。",
      detail: `D1 delete request write failed: ${errorDetail(error)}`
    });
  }
}

export async function handleVersionLifecycleRoute(
  request: Request,
  env: Env,
  versionId: string,
  routeAction: RouteAction
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }

  const normalizedVersionId = versionId.trim();
  const action: LifecycleAction = routeAction === "withdraw" ? "withdraw_version" : "request_delete";
  if (!normalizedVersionId) {
    return apiError(request, env, 404, "VERSION_NOT_FOUND", "対象のversionが見つかりません。", "versionId path parameter is empty.");
  }

  const secret = env.HASH_SECRET?.trim();
  if (!secret) {
    console.error("[version-lifecycle-config] HASH_SECRET secret is not configured", {
      code: "SERVER_CONFIG_ERROR",
      action
    });
    return apiError(request, env, 500, "SERVER_CONFIG_ERROR", "サーバー設定が不足しています。", "HASH_SECRET secret is not configured.");
  }

  const context = await buildLifecycleContext(request, secret);
  const parsed = await parseRequestBody(request);
  if (!parsed.ok) {
    return failLifecycle(request, env, context, action, parsed.failure);
  }

  try {
    if (await isRateLimited(env, context)) {
      return failLifecycle(request, env, context, action, {
        status: 429,
        code: "RATE_LIMITED",
        message: "管理パスワードの試行回数が上限を超えました。しばらく待ってから再試行してください。",
        detail: `At least ${INVALID_PASSWORD_LIMIT} invalid password attempts were recorded in the last ${INVALID_PASSWORD_WINDOW_MINUTES} minutes.`
      });
    }
  } catch (error) {
    console.error("[version-lifecycle-rate-limit] failed to read password failure logs", {
      code: "RATE_LIMIT_CHECK_FAILED",
      action,
      message: errorDetail(error)
    });
    return failLifecycle(request, env, context, action, {
      status: 500,
      code: routeAction === "withdraw" ? "WITHDRAW_FAILED" : "DELETE_REQUEST_FAILED",
      message: "管理操作の事前確認に失敗しました。",
      detail: `Password rate-limit check failed: ${errorDetail(error)}`
    });
  }

  const authenticated = await authenticateVersion(
    request,
    env,
    context,
    action,
    normalizedVersionId,
    parsed.value.password,
    secret
  );
  if (!authenticated.ok) {
    return authenticated.response;
  }

  if (routeAction === "withdraw") {
    return handleWithdraw(request, env, context, authenticated.value);
  }

  return handleDeleteRequest(request, env, context, authenticated.value, parsed.value.reason);
}


