import { buildRequestFingerprint } from "../utils/requestFingerprint";
import { finalizeVersionWithdrawal } from "../services/versionWithdrawalFinalizer";
import { resolveVersionWithdrawal } from "../services/versionWithdrawalResolution";
import { apiError, Env, errorDetail, jsonResponse, methodNotAllowed, ok } from "../utils/response";
import { hashWithdrawalIdempotency, verifyPasswordHash } from "../utils/securityHash";
import {
  PublicLifecycleStatus,
  resolvePublicLifecycleStatus,
  WithdrawalDbStatus
} from "../utils/versionWithdrawal";
import {
  classifyWithdrawalHandling,
  requestModeForHandling,
  WithdrawalHandlingMode,
  withdrawalHandlingRequiresReason
} from "../utils/withdrawalHandling";

const INVALID_PASSWORD_LIMIT = 5;
const INVALID_PASSWORD_WINDOW_MINUTES = 10;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,200}$/;
const MIN_WITHDRAWAL_REASON_LENGTH = 10;
const MAX_WITHDRAWAL_REASON_LENGTH = 500;

export type VersionWithdrawalRouteAction = "withdrawal" | "cancel" | "lifecycle";

type Failure = {
  status: number;
  code: string;
  message: string;
};

type LogContext = {
  ipHash: string;
  uaHash: string;
  songId: string | null;
  chartId: string | null;
  versionId: string | null;
  fileSha256: string | null;
};

type ManagedVersionRow = {
  id: string;
  chart_id: string;
  song_id: string;
  password_hash: string;
  password_hash_version: number;
  file_sha256: string | null;
  is_hidden: number;
  chart_is_hidden: number;
  withdrawn_at: string | null;
  delete_requested_at: string | null;
  file_deleted_at: string | null;
  allow_append: number;
  collapsed_by_completion: number;
  progress_map_json: string | null;
  download_blocked: number;
  withdrawal_download_blocked: number;
  created_at: string;
};

type WithdrawalRow = {
  id: string;
  version_id: string;
  chart_id: string;
  status: WithdrawalDbStatus;
  request_mode: "immediate" | "deferred";
  handling_mode: WithdrawalHandlingMode;
  request_reason: string | null;
  requested_at: string;
  scheduled_at: string;
  canceled_at: string | null;
  resolved_at: string | null;
  can_cancel: number;
};

type DependencySnapshot = {
  within_24_hours: number;
  total_child_count: number;
  collapsed_reference_count: number;
  legacy_delete_request_count: number;
  legacy_pending_count: number;
};

type LifecycleView = {
  version: ManagedVersionRow;
  withdrawal: WithdrawalRow | null;
  dependencies: DependencySnapshot;
  lifecycleStatus: PublicLifecycleStatus;
  handlingMode: WithdrawalHandlingMode | null;
  requestPreview: WithdrawalHandlingMode | "unavailable" | "legacy_process";
  reasonRequired: boolean;
  canRequestWithdrawal: boolean;
  canCancelWithdrawal: boolean;
  downloadAvailable: boolean;
  appendAvailable: boolean;
};

type RequestBody = {
  password: string;
  idempotencyKey: string;
  reason: string;
};

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function emptyLogContext(ipHash: string, uaHash: string): LogContext {
  return {
    ipHash,
    uaHash,
    songId: null,
    chartId: null,
    versionId: null,
    fileSha256: null
  };
}

async function writeLifecycleLog(
  env: Env,
  context: LogContext,
  result: "accepted" | "rejected",
  errorCode: string | null,
  operation: "request" | "cancel",
  outcome: string,
  requestMode: string | null = null,
  handlingMode: string | null = null
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO post_logs (
      id, action, song_id, chart_id, version_id, ip_hash, ua_hash, fingerprint_hash_version,
      file_sha256, result, error_code, detail
    ) VALUES (?, 'withdraw_version', ?, ?, ?, ?, ?, 2, ?, ?, ?, ?)
  `).bind(
    makeId("post_log"),
    context.songId,
    context.chartId,
    context.versionId,
    context.ipHash,
    context.uaHash,
    context.fileSha256,
    result,
    errorCode,
    [
      `operation=${operation}`,
      `requestMode=${requestMode ?? "none"}`,
      `handlingMode=${handlingMode ?? "none"}`,
      `outcome=${outcome}`,
      `errorCode=${errorCode ?? "none"}`
    ].join("; ")
  ).run();
}

async function fail(
  request: Request,
  env: Env,
  context: LogContext,
  operation: "request" | "cancel",
  failure: Failure
): Promise<Response> {
  try {
    await writeLifecycleLog(env, context, "rejected", failure.code, operation, "rejected");
  } catch (error) {
    console.error("[version-withdrawal-log] failed to write rejection", {
      code: "POST_LOG_WRITE_FAILED",
      operation,
      errorCode: failure.code,
      versionId: context.versionId,
      message: errorDetail(error)
    });
  }
  return apiError(request, env, failure.status, failure.code, failure.message, "Lifecycle operation was rejected.");
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    return null;
  }
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function parseRequestBody(request: Request): Promise<RequestBody | Failure> {
  const body = await parseJsonObject(request);
  if (!body) {
    return { status: 400, code: "INVALID_REQUEST", message: "リクエスト形式が不正です。" };
  }
  const password = typeof body.password === "string" ? body.password.trim() : "";
  if (!password) {
    return { status: 400, code: "PASSWORD_REQUIRED", message: "管理パスワードを入力してください。" };
  }
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return {
      status: 400,
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "取り下げ操作を確認できません。管理画面を開き直してください。"
    };
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  return { password, idempotencyKey, reason };
}

async function parseCancelBody(request: Request): Promise<{ password: string } | Failure> {
  const body = await parseJsonObject(request);
  if (!body) {
    return { status: 400, code: "INVALID_REQUEST", message: "リクエスト形式が不正です。" };
  }
  const password = typeof body.password === "string" ? body.password.trim() : "";
  return password
    ? { password }
    : { status: 400, code: "PASSWORD_REQUIRED", message: "管理パスワードを入力してください。" };
}

function isFailure(value: RequestBody | { password: string } | Failure): value is Failure {
  return "status" in value;
}

async function selectManagedVersion(env: Env, versionId: string): Promise<ManagedVersionRow | null> {
  return env.DB.prepare(`
    SELECT
      versions.id,
      versions.chart_id,
      charts.song_id,
      versions.password_hash,
      versions.password_hash_version,
      versions.file_sha256,
      versions.is_hidden,
      charts.is_hidden AS chart_is_hidden,
      versions.withdrawn_at,
      versions.delete_requested_at,
      versions.file_deleted_at,
      versions.allow_append,
      versions.collapsed_by_completion,
      versions.progress_map_json,
      versions.download_blocked,
      versions.withdrawal_download_blocked,
      versions.created_at
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<ManagedVersionRow>();
}

async function selectLatestWithdrawal(env: Env, versionId: string): Promise<WithdrawalRow | null> {
  return env.DB.prepare(`
    SELECT
      id, version_id, chart_id, status, request_mode,
      COALESCE(handling_mode, CASE WHEN request_mode = 'immediate' THEN 'immediate_delete' ELSE 'grace_auto_delete' END) AS handling_mode,
      request_reason, requested_at, scheduled_at,
      canceled_at, resolved_at,
      CASE
        WHEN status = 'pending'
          AND (
            COALESCE(handling_mode, CASE WHEN request_mode = 'deferred' THEN 'grace_auto_delete' END) = 'manual_review'
            OR (
              COALESCE(handling_mode, CASE WHEN request_mode = 'deferred' THEN 'grace_auto_delete' END) = 'grace_auto_delete'
              AND CURRENT_TIMESTAMP < scheduled_at
            )
          )
        THEN 1 ELSE 0
      END AS can_cancel
    FROM version_withdrawals
    WHERE version_id = ?
    ORDER BY requested_at DESC, id DESC
    LIMIT 1
  `).bind(versionId).first<WithdrawalRow>();
}

async function selectWithdrawalByIdempotencyHash(env: Env, hash: string): Promise<WithdrawalRow | null> {
  return env.DB.prepare(`
    SELECT
      id, version_id, chart_id, status, request_mode,
      COALESCE(handling_mode, CASE WHEN request_mode = 'immediate' THEN 'immediate_delete' ELSE 'grace_auto_delete' END) AS handling_mode,
      request_reason, requested_at, scheduled_at,
      canceled_at, resolved_at,
      CASE
        WHEN status = 'pending'
          AND (
            COALESCE(handling_mode, CASE WHEN request_mode = 'deferred' THEN 'grace_auto_delete' END) = 'manual_review'
            OR (
              COALESCE(handling_mode, CASE WHEN request_mode = 'deferred' THEN 'grace_auto_delete' END) = 'grace_auto_delete'
              AND CURRENT_TIMESTAMP < scheduled_at
            )
          )
        THEN 1 ELSE 0
      END AS can_cancel
    FROM version_withdrawals
    WHERE idempotency_key_hash = ?
      AND idempotency_hash_version = 2
    LIMIT 1
  `).bind(hash).first<WithdrawalRow>();
}

async function selectDependencies(env: Env, versionId: string): Promise<DependencySnapshot> {
  const row = await env.DB.prepare(`
    SELECT
      CASE WHEN versions.created_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END AS within_24_hours,
      (SELECT COUNT(*) FROM versions AS children WHERE children.parent_version_id = versions.id) AS total_child_count,
      (SELECT COUNT(*) FROM versions AS refs WHERE refs.collapsed_by_version_id = versions.id) AS collapsed_reference_count,
      (SELECT COUNT(*) FROM delete_requests AS requests WHERE requests.version_id = versions.id) AS legacy_delete_request_count,
      (SELECT COUNT(*) FROM delete_requests AS requests WHERE requests.version_id = versions.id AND requests.status = 'pending') AS legacy_pending_count
    FROM versions
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<DependencySnapshot>();

  return row ?? {
    within_24_hours: 0,
    total_child_count: 0,
    collapsed_reference_count: 0,
    legacy_delete_request_count: 0,
    legacy_pending_count: 0
  };
}

function hasUsableProgressMap(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.schemaVersion === 2
      && parsed.blockMode === "standardized_measure"
      && Array.isArray(parsed.blocks)
      && parsed.blocks.length > 0
      && Array.isArray(parsed.layers);
  } catch {
    return false;
  }
}

function deriveLifecycleStatus(
  version: ManagedVersionRow,
  withdrawal: WithdrawalRow | null,
  dependencies: DependencySnapshot
): PublicLifecycleStatus {
  if (withdrawal) {
    const status = resolvePublicLifecycleStatus({
      lifecycle_withdrawal_status: withdrawal.status,
      lifecycle_request_mode: withdrawal.request_mode,
      lifecycle_handling_mode: withdrawal.handling_mode,
      lifecycle_requested_at: withdrawal.requested_at,
      lifecycle_scheduled_at: withdrawal.scheduled_at,
      lifecycle_can_cancel: withdrawal.can_cancel,
      withdrawn_at: version.withdrawn_at,
      delete_requested_at: dependencies.legacy_pending_count > 0 ? version.delete_requested_at || "pending" : null
    });
    if (status !== "active") return status;
  }
  if (version.withdrawn_at) return "legacy_withdrawn";
  if (dependencies.legacy_pending_count > 0) return "legacy_delete_pending";
  return "active";
}

async function buildLifecycleView(env: Env, version: ManagedVersionRow): Promise<LifecycleView> {
  const [withdrawal, dependencies] = await Promise.all([
    selectLatestWithdrawal(env, version.id),
    selectDependencies(env, version.id)
  ]);
  const lifecycleStatus = deriveLifecycleStatus(version, withdrawal, dependencies);
  const publicVersion = version.is_hidden === 0
    && version.chart_is_hidden === 0
    && version.file_deleted_at === null;
  const hasDeletionDependencies = Number(dependencies.total_child_count) > 0
    || Number(dependencies.collapsed_reference_count) > 0
    || Number(dependencies.legacy_delete_request_count) > 0;
  const legacy = lifecycleStatus === "legacy_withdrawn" || lifecycleStatus === "legacy_delete_pending";
  const canRequestWithdrawal = publicVersion && lifecycleStatus === "active" && !legacy;
  const handlingMode = canRequestWithdrawal
    ? classifyWithdrawalHandling({
        within24Hours: Number(dependencies.within_24_hours) === 1,
        hasDeletionDependencies
      })
    : withdrawal?.handling_mode ?? null;
  const requestPreview = legacy
    ? "legacy_process"
    : !canRequestWithdrawal
      ? "unavailable"
      : handlingMode!;
  const blocksAccess = lifecycleStatus === "processing" || lifecycleStatus === "tombstoned";

  return {
    version,
    withdrawal,
    dependencies,
    lifecycleStatus,
    handlingMode,
    requestPreview,
    reasonRequired: handlingMode ? withdrawalHandlingRequiresReason(handlingMode) : false,
    canRequestWithdrawal,
    canCancelWithdrawal: withdrawal?.can_cancel === 1 && lifecycleStatus === "withdrawal_pending",
    downloadAvailable: publicVersion
      && version.download_blocked === 0
      && version.withdrawal_download_blocked === 0
      && !blocksAccess,
    appendAvailable: publicVersion
      && version.allow_append === 1
      && version.collapsed_by_completion === 0
      && hasUsableProgressMap(version.progress_map_json)
      && !blocksAccess
  };
}

function lifecycleResponseBody(view: LifecycleView): Record<string, unknown> {
  const exposesWithdrawalRequest = view.lifecycleStatus === "withdrawal_pending"
    || view.lifecycleStatus === "processing"
    || view.lifecycleStatus === "tombstoned";
  return {
    lifecycleStatus: view.lifecycleStatus,
    requestMode: exposesWithdrawalRequest ? view.withdrawal?.request_mode ?? null : null,
    handlingMode: view.handlingMode,
    requestedAt: exposesWithdrawalRequest ? view.withdrawal?.requested_at ?? null : null,
    scheduledAt: exposesWithdrawalRequest ? view.withdrawal?.scheduled_at ?? null : null,
    canRequestWithdrawal: view.canRequestWithdrawal,
    canCancelWithdrawal: view.canCancelWithdrawal,
    requestPreview: view.requestPreview,
    reasonRequired: view.reasonRequired,
    downloadAvailable: view.downloadAvailable,
    appendAvailable: view.appendAvailable
  };
}

function requestSuccessBody(view: LifecycleView, outcome: string): Record<string, unknown> {
  return {
    ok: true,
    outcome,
    ...lifecycleResponseBody(view)
  };
}

async function respondFromWithdrawalRow(
  request: Request,
  env: Env,
  withdrawal: WithdrawalRow
): Promise<Response> {
  const lifecycleStatus = withdrawal.status === "deleted"
    ? "deleted"
    : withdrawal.status === "tombstoned"
      ? "tombstoned"
      : withdrawal.status === "processing"
        ? "processing"
        : withdrawal.status === "pending"
          ? "withdrawal_pending"
          : "active";
  const outcome = withdrawal.status === "deleted"
    ? "immediate_deleted"
    : withdrawal.status === "tombstoned"
      ? "tombstoned"
      : withdrawal.status === "processing"
        ? "processing"
        : withdrawal.status === "pending"
          ? "already_pending"
          : "already_canceled";
  if (withdrawal.status === "pending" || withdrawal.status === "canceled") {
    const version = await selectManagedVersion(env, withdrawal.version_id);
    if (version) {
      const view = await buildLifecycleView(env, version);
      return ok(request, env, requestSuccessBody(view, outcome), {
        headers: { "Cache-Control": "no-store" }
      });
    }
  }
  return jsonResponse(request, env, {
    ok: true,
    outcome,
    lifecycleStatus,
    requestMode: withdrawal.request_mode,
    handlingMode: withdrawal.handling_mode,
    requestedAt: withdrawal.requested_at,
    scheduledAt: withdrawal.scheduled_at,
    canRequestWithdrawal: false,
    canCancelWithdrawal: withdrawal.can_cancel === 1,
    requestPreview: "unavailable",
    reasonRequired: withdrawalHandlingRequiresReason(withdrawal.handling_mode),
    // A terminal/idempotent replay may run after the version row is gone. Do not
    // infer current public capabilities from the audit row alone.
    downloadAvailable: false,
    appendAvailable: false
  }, {
    status: withdrawal.status === "processing" ? 202 : 200,
    headers: { "Cache-Control": "no-store" }
  });
}

async function isRateLimited(env: Env, context: LogContext): Promise<boolean> {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS failure_count
    FROM post_logs
    WHERE ip_hash = ?
      AND ua_hash = ?
      AND fingerprint_hash_version = 2
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

async function authenticate(
  request: Request,
  env: Env,
  context: LogContext,
  versionId: string,
  password: string,
  secret: string,
  operation: "request" | "cancel"
): Promise<{ version: ManagedVersionRow } | { response: Response }> {
  const version = await selectManagedVersion(env, versionId);
  if (!version) {
    return { response: await fail(request, env, context, operation, {
      status: 404,
      code: "VERSION_NOT_FOUND",
      message: "対象のversionが見つかりません。"
    }) };
  }
  context.songId = version.song_id;
  context.chartId = version.chart_id;
  context.versionId = version.id;
  context.fileSha256 = version.file_sha256;

  const passwordResult = await verifyPasswordHash(
    secret,
    password,
    version.password_hash,
    Number(version.password_hash_version)
  );
  if (passwordResult === "legacy") {
    return { response: await fail(request, env, context, operation, {
      status: 409,
      code: "MANAGEMENT_PASSWORD_EXPIRED",
      message: "セキュリティ更新により、この投稿の管理パスワードは失効しました。管理者へお問い合わせください。"
    }) };
  }
  if (passwordResult !== "verified") {
    return { response: await fail(request, env, context, operation, {
      status: 401,
      code: "INVALID_PASSWORD",
      message: "管理パスワードが違います。"
    }) };
  }
  return { version };
}

function publicEligibilityFailure(view: LifecycleView): Failure | null {
  if (view.version.is_hidden === 1 || view.version.chart_is_hidden === 1 || view.version.file_deleted_at) {
    return { status: 409, code: "WITHDRAWAL_NOT_ALLOWED", message: "この投稿は現在取り下げできません。" };
  }
  if (view.lifecycleStatus === "legacy_withdrawn" || view.lifecycleStatus === "legacy_delete_pending") {
    return {
      status: 409,
      code: "LEGACY_LIFECYCLE_ACTIVE",
      message: "この投稿は従来方式の取り下げ・削除処理中です。"
    };
  }
  if (view.lifecycleStatus === "processing") {
    return {
      status: 409,
      code: "LIFECYCLE_OPERATION_IN_PROGRESS",
      message: "取り下げ処理が開始されているため、操作できません。"
    };
  }
  if (view.lifecycleStatus === "tombstoned") {
    return { status: 409, code: "WITHDRAWAL_NOT_ALLOWED", message: "この投稿は現在取り下げできません。" };
  }
  return null;
}

function withdrawalReasonFailure(
  mode: WithdrawalHandlingMode,
  reason: string
): Failure | null {
  if (!withdrawalHandlingRequiresReason(mode)) return null;
  if (reason.length < MIN_WITHDRAWAL_REASON_LENGTH) {
    return {
      status: 400,
      code: "INVALID_WITHDRAWAL_REASON",
      message: "取り下げ理由を10文字以上で入力してください。"
    };
  }
  if (reason.length > MAX_WITHDRAWAL_REASON_LENGTH) {
    return {
      status: 400,
      code: "WITHDRAWAL_REASON_TOO_LONG",
      message: "取り下げ理由は500文字以内で入力してください。"
    };
  }
  return null;
}

async function insertWithdrawal(
  env: Env,
  view: LifecycleView,
  idempotencyHash: string,
  context: LogContext,
  handlingMode: WithdrawalHandlingMode,
  reason: string
): Promise<string | null> {
  const id = makeId("withdrawal");
  const requestMode = requestModeForHandling(handlingMode);
  const hasDependenciesSql = `(
    EXISTS (SELECT 1 FROM versions AS children WHERE children.parent_version_id = versions.id)
    OR EXISTS (SELECT 1 FROM versions AS refs WHERE refs.collapsed_by_version_id = versions.id)
    OR EXISTS (SELECT 1 FROM delete_requests AS requests WHERE requests.version_id = versions.id)
  )`;
  const handlingConditions = handlingMode === "manual_review"
    ? `AND ${hasDependenciesSql}`
    : handlingMode === "immediate_delete"
      ? `AND versions.created_at >= datetime('now', '-24 hours') AND NOT ${hasDependenciesSql}`
      : `AND versions.created_at < datetime('now', '-24 hours') AND NOT ${hasDependenciesSql}`;
  const scheduledAtSql = handlingMode === "grace_auto_delete"
    ? "datetime('now', '+7 days')"
    : "CURRENT_TIMESTAMP";
  const insert = env.DB.prepare(`
    INSERT INTO version_withdrawals (
      id, version_id, chart_id, status, request_mode, requested_at, scheduled_at,
      handling_mode, request_reason,
      processing_mode, attempt_count, idempotency_key_hash,
      idempotency_hash_version, requester_ip_hash, requester_ua_hash,
      fingerprint_hash_version, created_at, updated_at
    )
    SELECT
      ?, versions.id, versions.chart_id, 'pending', ?, CURRENT_TIMESTAMP,
      ${scheduledAtSql}, ?, ?,
      NULL, 0, ?, 2, ?, ?, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.id = ?
      AND versions.is_hidden = 0
      AND charts.is_hidden = 0
      AND versions.file_deleted_at IS NULL
      AND versions.withdrawn_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM delete_requests AS legacy
        WHERE legacy.version_id = versions.id AND legacy.status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM version_withdrawals AS active
        WHERE active.version_id = versions.id
          AND active.status IN ('pending', 'processing', 'tombstoned', 'deleted')
      )
      ${handlingConditions}
  `).bind(
    id,
    requestMode,
    handlingMode,
    handlingMode === "immediate_delete" ? null : reason,
    idempotencyHash,
    context.ipHash,
    context.uaHash,
    view.version.id
  );
  const statements = [insert];
  if (handlingMode !== "immediate_delete") {
    statements.push(env.DB.prepare(`
      UPDATE versions
      SET withdrawal_download_blocked = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND EXISTS (
          SELECT 1 FROM version_withdrawals
          WHERE id = ? AND status = 'pending' AND handling_mode = ?
        )
    `).bind(view.version.id, id, handlingMode));
  }
  const results = await env.DB.batch(statements);
  const inserted = Number(results[0]?.meta.changes ?? 0) === 1;
  const blocked = handlingMode === "immediate_delete"
    || Number(results[1]?.meta.changes ?? 0) === 1;
  if (inserted && !blocked) {
    throw new Error("The withdrawal was created without its dedicated download block.");
  }
  return inserted ? id : null;
}

async function respondFromExisting(
  request: Request,
  env: Env,
  context: LogContext,
  version: ManagedVersionRow,
  existing: WithdrawalRow,
  operation: "request" | "cancel"
): Promise<Response> {
  if (["processing", "tombstoned", "deleted"].includes(existing.status)) {
    return respondFromWithdrawalRow(request, env, existing);
  }
  const view = await buildLifecycleView(env, version);
  const outcome = existing.status === "pending"
    ? "already_pending"
    : existing.status === "canceled"
      ? "already_canceled"
      : existing.status;
  try {
    await writeLifecycleLog(
      env,
      context,
      "accepted",
      null,
      operation,
      outcome,
      existing.request_mode,
      existing.handling_mode
    );
  } catch (error) {
    console.error("[version-withdrawal-log] failed to write idempotent result", {
      code: "POST_LOG_WRITE_FAILED",
      operation,
      versionId: version.id,
      message: errorDetail(error)
    });
  }
  return ok(request, env, requestSuccessBody(view, outcome), { headers: { "Cache-Control": "no-store" } });
}

async function handleRequest(
  request: Request,
  env: Env,
  context: LogContext,
  version: ManagedVersionRow,
  idempotencyHash: string,
  reason: string
): Promise<Response> {
  const sameKey = await selectWithdrawalByIdempotencyHash(env, idempotencyHash);
  if (sameKey) {
    if (sameKey.version_id !== version.id) {
      return fail(request, env, context, "request", {
        status: 409,
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "取り下げ操作の識別情報が別の投稿で使用されています。管理画面を開き直してください。"
      });
    }
    return respondFromExisting(request, env, context, version, sameKey, "request");
  }

  let view = await buildLifecycleView(env, version);
  const eligibilityFailure = publicEligibilityFailure(view);
  if (eligibilityFailure) return fail(request, env, context, "request", eligibilityFailure);
  if (view.lifecycleStatus === "withdrawal_pending" && view.withdrawal) {
    return respondFromExisting(request, env, context, version, view.withdrawal, "request");
  }

  try {
    let handlingMode = view.handlingMode!;
    let reasonFailure = withdrawalReasonFailure(handlingMode, reason);
    if (reasonFailure) return fail(request, env, context, "request", reasonFailure);
    let insertedId = await insertWithdrawal(env, view, idempotencyHash, context, handlingMode, reason);
    if (!insertedId) {
      view = await buildLifecycleView(env, version);
      const refreshedFailure = publicEligibilityFailure(view);
      if (refreshedFailure) return fail(request, env, context, "request", refreshedFailure);
      if (view.lifecycleStatus === "withdrawal_pending" && view.withdrawal) {
        return respondFromExisting(request, env, context, version, view.withdrawal, "request");
      }
      handlingMode = view.handlingMode!;
      reasonFailure = withdrawalReasonFailure(handlingMode, reason);
      if (reasonFailure) return fail(request, env, context, "request", reasonFailure);
      insertedId = await insertWithdrawal(env, view, idempotencyHash, context, handlingMode, reason);
    }

    if (!insertedId) {
      const concurrent = await selectLatestWithdrawal(env, version.id);
      if (concurrent?.status === "pending") {
        return respondFromExisting(request, env, context, version, concurrent, "request");
      }
      return fail(request, env, context, "request", {
        status: 409,
        code: "WITHDRAWAL_STATE_CONFLICT",
        message: "投稿の状態が更新されました。画面を再読み込みして確認してください。"
      });
    }

    const created = await selectLatestWithdrawal(env, version.id);
    try {
      await writeLifecycleLog(
        env,
        context,
        "accepted",
        null,
        "request",
        "pending",
        requestModeForHandling(handlingMode),
        handlingMode
      );
    } catch (error) {
      console.error("[version-withdrawal-log] failed to write request result", {
        code: "POST_LOG_WRITE_FAILED",
        versionId: version.id,
        message: errorDetail(error)
      });
    }
    if (handlingMode === "immediate_delete") {
      const finalized = await finalizeVersionWithdrawal(env, insertedId);
      const latest = await selectWithdrawalByIdempotencyHash(env, idempotencyHash);
      if (latest) {
        return respondFromWithdrawalRow(request, env, latest);
      }
      console.error("[version-withdrawal-request] finalizer result could not be reloaded", {
        code: "WITHDRAWAL_FAILED",
        withdrawalId: finalized.withdrawalId,
        outcome: finalized.outcome
      });
      return jsonResponse(request, env, {
        ok: true,
        outcome: "processing",
        lifecycleStatus: "processing"
      }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }

    const refreshedVersion = await selectManagedVersion(env, version.id);
    const resultView = await buildLifecycleView(env, refreshedVersion ?? version);
    return ok(request, env, requestSuccessBody(
      resultView,
      created ? "withdrawal_pending" : "already_pending"
    ), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const sameKeyAfterFailure = await selectWithdrawalByIdempotencyHash(env, idempotencyHash);
    if (sameKeyAfterFailure) {
      if (sameKeyAfterFailure.version_id !== version.id) {
        return fail(request, env, context, "request", {
          status: 409,
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "取り下げ操作の識別情報が別の投稿で使用されています。管理画面を開き直してください。"
        });
      }
      return respondFromExisting(request, env, context, version, sameKeyAfterFailure, "request");
    }
    console.error("[version-withdrawal-request] failed", {
      code: "WITHDRAWAL_FAILED",
      versionId: version.id,
      message: errorDetail(error)
    });
    return fail(request, env, context, "request", {
      status: 500,
      code: "WITHDRAWAL_FAILED",
      message: "取り下げ申請の受付に失敗しました。"
    });
  }
}

async function handleCancel(
  request: Request,
  env: Env,
  context: LogContext,
  version: ManagedVersionRow
): Promise<Response> {
  let latest = await selectLatestWithdrawal(env, version.id);
  if (!latest) {
    return fail(request, env, context, "cancel", {
      status: 409,
      code: "WITHDRAWAL_NOT_PENDING",
      message: "取り消せる取り下げ申請がありません。"
    });
  }
  if (latest.status === "canceled") {
    return respondFromExisting(request, env, context, version, latest, "cancel");
  }
  if (latest.status === "processing") {
    return fail(request, env, context, "cancel", {
      status: 409,
      code: "LIFECYCLE_OPERATION_IN_PROGRESS",
      message: "取り下げ処理が開始されているため、取り消せません。"
    });
  }
  if (latest.status !== "pending") {
    return fail(request, env, context, "cancel", {
      status: 409,
      code: "WITHDRAWAL_NOT_PENDING",
      message: "取り消せる取り下げ申請がありません。"
    });
  }
  if (latest.handling_mode === "immediate_delete") {
    return fail(request, env, context, "cancel", {
      status: 409,
      code: "WITHDRAWAL_NOT_ALLOWED",
      message: "この削除処理待ちは取り消せません。"
    });
  }
  if (latest.can_cancel !== 1) {
    return fail(request, env, context, "cancel", {
      status: 409,
      code: "WITHDRAWAL_CANCEL_EXPIRED",
      message: "取り下げ申請の取消期限を過ぎています。"
    });
  }

  const resolution = await resolveVersionWithdrawal(env, {
    actor: "submitter_cancel",
    withdrawalId: latest.id,
    expectedVersionId: version.id
  });

  if (!resolution.ok) {
    latest = await selectLatestWithdrawal(env, version.id);
    if (latest?.status === "canceled") {
      return respondFromExisting(request, env, context, version, latest, "cancel");
    }
    if (latest?.status === "processing") {
      return fail(request, env, context, "cancel", {
        status: 409,
        code: "LIFECYCLE_OPERATION_IN_PROGRESS",
        message: "取り下げ処理が開始されているため、取り消せません。"
      });
    }
    if (latest?.status === "pending" && latest.can_cancel !== 1) {
      return fail(request, env, context, "cancel", {
        status: 409,
        code: "WITHDRAWAL_CANCEL_EXPIRED",
        message: "取り下げ申請の取消期限を過ぎています。"
      });
    }
    return fail(request, env, context, "cancel", {
      status: 409,
      code: "WITHDRAWAL_STATE_CONFLICT",
      message: "投稿の状態が更新されました。画面を再読み込みして確認してください。"
    });
  }

  const canceled = await selectLatestWithdrawal(env, version.id);
  const refreshedVersion = await selectManagedVersion(env, version.id);
  const view = await buildLifecycleView(env, refreshedVersion ?? version);
  try {
    await writeLifecycleLog(
      env,
      context,
      "accepted",
      null,
      "cancel",
      "canceled",
      canceled?.request_mode ?? "deferred",
      canceled?.handling_mode ?? null
    );
  } catch (error) {
    console.error("[version-withdrawal-log] failed to write cancellation", {
      code: "POST_LOG_WRITE_FAILED",
      versionId: version.id,
      message: errorDetail(error)
    });
  }
  return ok(request, env, requestSuccessBody(view, "canceled"), { headers: { "Cache-Control": "no-store" } });
}

async function handleLifecycleGet(request: Request, env: Env, versionId: string): Promise<Response> {
  const version = await selectManagedVersion(env, versionId);
  if (!version || version.is_hidden === 1 || version.chart_is_hidden === 1) {
    return apiError(request, env, 404, "VERSION_NOT_FOUND", "対象のversionが見つかりません。", "Version is not public.");
  }
  const view = await buildLifecycleView(env, version);
  return ok(request, env, lifecycleResponseBody(view), { headers: { "Cache-Control": "no-store" } });
}

export async function handleVersionWithdrawalRoute(
  request: Request,
  env: Env,
  versionId: string,
  action: VersionWithdrawalRouteAction
): Promise<Response> {
  const normalizedVersionId = versionId.trim();
  if (!normalizedVersionId) {
    return apiError(request, env, 404, "VERSION_NOT_FOUND", "対象のversionが見つかりません。", "versionId is empty.");
  }
  if (action === "lifecycle") {
    if (request.method !== "GET") return methodNotAllowed(request, env, request.method);
    try {
      return await handleLifecycleGet(request, env, normalizedVersionId);
    } catch (error) {
      console.error("[version-lifecycle-get] failed", {
        code: "WITHDRAWAL_FAILED",
        versionId: normalizedVersionId,
        message: errorDetail(error)
      });
      return apiError(request, env, 500, "WITHDRAWAL_FAILED", "取り下げ状態の取得に失敗しました。", "Lifecycle lookup failed.");
    }
  }
  if (request.method !== "POST") return methodNotAllowed(request, env, request.method);

  const abuseSecret = env.ABUSE_HASH_SECRET?.trim();
  const passwordSecret = env.PASSWORD_HASH_SECRET?.trim();
  const idempotencySecret = env.WITHDRAWAL_IDEMPOTENCY_SECRET?.trim();
  if (!abuseSecret || !passwordSecret || (action === "withdrawal" && !idempotencySecret)) {
    return apiError(request, env, 500, "SERVER_CONFIG_ERROR", "サーバー設定が不足しています。", "Required security hash secrets are not configured.");
  }
  const fingerprint = await buildRequestFingerprint(request, abuseSecret);
  const context = emptyLogContext(fingerprint.ipHash, fingerprint.uaHash);
  const parsed = action === "withdrawal" ? await parseRequestBody(request) : await parseCancelBody(request);
  if (isFailure(parsed)) {
    return fail(request, env, context, action === "withdrawal" ? "request" : "cancel", parsed);
  }

  try {
    let idempotencyHash: string | null = null;
    if (action === "withdrawal") {
      idempotencyHash = await hashWithdrawalIdempotency(
        idempotencySecret!,
        (parsed as RequestBody).idempotencyKey
      );
      const existing = await selectWithdrawalByIdempotencyHash(env, idempotencyHash);
      if (existing) {
        if (existing.version_id !== normalizedVersionId) {
          return fail(request, env, context, "request", {
            status: 409,
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "取り下げ操作の識別情報が別の投稿で使用されています。管理画面を開き直してください。"
          });
        }
        return respondFromWithdrawalRow(request, env, existing);
      }
    }

    if (await isRateLimited(env, context)) {
      return fail(request, env, context, action === "withdrawal" ? "request" : "cancel", {
        status: 429,
        code: "RATE_LIMITED",
        message: "管理パスワードの試行回数が上限を超えました。しばらく待ってから再試行してください。"
      });
    }
    const authenticated = await authenticate(
      request,
      env,
      context,
      normalizedVersionId,
      parsed.password,
      passwordSecret,
      action === "withdrawal" ? "request" : "cancel"
    );
    if ("response" in authenticated) return authenticated.response;

    if (action === "withdrawal") {
      return handleRequest(
        request,
        env,
        context,
        authenticated.version,
        idempotencyHash!,
        (parsed as RequestBody).reason
      );
    }
    return handleCancel(request, env, context, authenticated.version);
  } catch (error) {
    console.error("[version-withdrawal] unexpected failure", {
      code: "WITHDRAWAL_FAILED",
      action,
      versionId: normalizedVersionId,
      message: errorDetail(error)
    });
    return fail(request, env, context, action === "withdrawal" ? "request" : "cancel", {
      status: 500,
      code: "WITHDRAWAL_FAILED",
      message: "取り下げ操作に失敗しました。"
    });
  }
}
