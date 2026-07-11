import {
  buildRequestFingerprint,
  getUnknownIpHash
} from "../utils/requestFingerprint";
import type { RequestFingerprint } from "../utils/requestFingerprint";
import { apiError, Env, errorDetail, methodNotAllowed, ok } from "../utils/response";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const HASH_PREVIEW_LENGTH = 12;
const MAX_BAN_REASON_LENGTH = 500;
const MAX_ADMIN_NOTE_LENGTH = 1000;

export type PostingAction = "create_chart" | "append_version";
type BanTargetType = "ip_hash" | "file_sha256";
type BanDuration = "24h" | "7d" | "30d" | "permanent";
type BanListState = "active" | "expired" | "disabled" | "all";

type ActiveBanRow = {
  ban_type: "ip_hash" | "ua_hash" | "file_sha256";
};

type AdminPostLogRow = {
  post_log_id: string;
  created_at: string;
  action: string;
  result: string;
  error_code: string | null;
  ip_hash: string;
  ua_hash: string;
  file_sha256: string | null;
  version_id: string | null;
  chart_id: string | null;
};

type BanSourceRow = {
  post_log_id: string;
  ip_hash: string;
  file_sha256: string | null;
};

type ExistingBanRow = {
  id: string;
  active: number;
  disabled_at: string | null;
  expired_at: string | null;
};

type AdminBanListRow = {
  ban_id: string;
  ban_type: string;
  ban_value_short: string;
  reason: string;
  stored_active: number;
  created_at: string;
  updated_at: string;
  expired_at: string | null;
  disabled_at: string | null;
  effective_state: "active" | "expired" | "disabled";
};

type LiftBanRow = {
  ban_id: string;
  ban_type: string;
  ban_value_short: string;
  active: number;
  disabled_at: string | null;
  expired_at: string | null;
};

type CreateBanBody = {
  sourcePostLogId: string;
  targetType: BanTargetType;
  reason: string;
  duration: BanDuration;
};

type BanLogContext = {
  banId?: string | null;
  targetType?: string | null;
  banValueShort?: string | null;
  sourcePostLogId?: string | null;
  reasonLength?: number;
  adminNoteLength?: number;
  duration?: string | null;
  expiresAt?: string | null;
  reactivated?: boolean;
  outcome?: string | null;
  errorCode?: string | null;
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

function shortHash(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  return `${normalized.slice(0, HASH_PREVIEW_LENGTH)}...`;
}

function toD1Timestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function expirationForDuration(duration: BanDuration): string | null {
  if (duration === "permanent") {
    return null;
  }
  const durationMs: Record<Exclude<BanDuration, "permanent">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000
  };
  return toD1Timestamp(new Date(Date.now() + durationMs[duration]));
}

function getHashSecret(env: Env): string | null {
  return env.HASH_SECRET?.trim() || null;
}

async function writeBanAdminLog(
  env: Env,
  action: "create_ban" | "lift_ban",
  level: "info" | "warning" | "error",
  code: string | null,
  context: BanLogContext
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO admin_logs (
        id, action, target_type, target_id, level, code, reason, detail
      ) VALUES (?, ?, 'ban', ?, ?, ?, ?, ?)
    `).bind(
      makeId("admin_log"),
      action,
      context.banId ?? context.sourcePostLogId ?? null,
      level,
      code,
      context.outcome ?? code,
      JSON.stringify({
        banId: context.banId ?? null,
        targetType: context.targetType ?? null,
        banValueShort: context.banValueShort ?? null,
        sourcePostLogId: context.sourcePostLogId ?? null,
        reasonLength: context.reasonLength ?? 0,
        adminNoteLength: context.adminNoteLength ?? 0,
        duration: context.duration ?? null,
        expiresAt: context.expiresAt ?? null,
        reactivated: context.reactivated ?? false,
        outcome: context.outcome ?? null,
        errorCode: context.errorCode ?? code
      })
    ).run();
  } catch (error) {
    console.error("[admin-ban-log] failed to write admin log", {
      action,
      code: "ADMIN_LOG_WRITE_FAILED",
      targetId: context.banId ?? context.sourcePostLogId ?? null,
      message: errorDetail(error)
    });
  }
}

async function writeBlockedPostLog(
  env: Env,
  action: PostingAction,
  ipHash: string,
  uaHash: string,
  chartId: string | null,
  banType: string
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO post_logs (
        id, action, song_id, chart_id, version_id, ip_hash, ua_hash,
        file_sha256, result, error_code, detail
      ) VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, 'rejected', 'POSTING_BLOCKED', ?)
    `).bind(
      makeId("post_log"),
      action,
      chartId,
      ipHash,
      uaHash,
      JSON.stringify({
        stage: "pre_multipart",
        banType,
        targetKind: "request_fingerprint",
        hasFileSha256: false,
        errorCode: "POSTING_BLOCKED"
      })
    ).run();
  } catch (error) {
    console.error("[posting-ban-log] failed to write blocked post log", {
      action,
      code: "POST_LOG_WRITE_FAILED",
      message: errorDetail(error)
    });
  }
}

async function findFingerprintBan(
  env: Env,
  ipHash: string,
  uaHash: string
): Promise<ActiveBanRow | null> {
  return env.DB.prepare(`
    SELECT ban_type
    FROM bans
    WHERE active = 1
      AND disabled_at IS NULL
      AND (expired_at IS NULL OR expired_at > CURRENT_TIMESTAMP)
      AND (
        (ban_type = 'ip_hash' AND ban_value = ?)
        OR (ban_type = 'ua_hash' AND ban_value = ?)
      )
    ORDER BY CASE ban_type WHEN 'ip_hash' THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(ipHash, uaHash).first<ActiveBanRow>();
}

export async function enforcePreMultipartPostingBan(
  request: Request,
  env: Env,
  action: PostingAction,
  chartId: string | null = null,
  existingFingerprint?: RequestFingerprint
): Promise<Response | null> {
  const secret = getHashSecret(env);
  if (!secret) {
    return apiError(
      request,
      env,
      503,
      "BAN_CHECK_FAILED",
      "投稿可否の確認に失敗しました。",
      "Posting protection configuration is unavailable."
    );
  }

  const fingerprint = existingFingerprint ?? await buildRequestFingerprint(request, secret);
  let ban: ActiveBanRow | null;
  try {
    ban = await findFingerprintBan(env, fingerprint.ipHash, fingerprint.uaHash);
  } catch (error) {
    console.error("[posting-ban-check] failed before multipart parsing", {
      action,
      code: "BAN_CHECK_FAILED",
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      503,
      "BAN_CHECK_FAILED",
      "投稿可否の確認に失敗しました。",
      "Posting protection lookup failed."
    );
  }

  if (!ban) {
    return null;
  }

  await writeBlockedPostLog(
    env,
    action,
    fingerprint.ipHash,
    fingerprint.uaHash,
    chartId,
    ban.ban_type
  );
  return apiError(
    request,
    env,
    403,
    "POSTING_BLOCKED",
    "投稿が制限されています。",
    "Posting is not available."
  );
}

export async function findActiveFileBan(env: Env, fileSha256: string): Promise<boolean> {
  const row = await env.DB.prepare(`
    SELECT id
    FROM bans
    WHERE ban_type = 'file_sha256'
      AND ban_value = ?
      AND active = 1
      AND disabled_at IS NULL
      AND (expired_at IS NULL OR expired_at > CURRENT_TIMESTAMP)
    LIMIT 1
  `).bind(fileSha256).first<{ id: string }>();
  return row !== null;
}

export async function listAdminPostLogs(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }
  const secret = getHashSecret(env);
  if (!secret) {
    return apiError(request, env, 500, "CONFIG_MISSING", "管理機能の設定が不足しています。", "HASH_SECRET is not configured.");
  }

  const url = new URL(request.url);
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  try {
    const unknownIpHash = await getUnknownIpHash(secret);
    const totalRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM post_logs")
      .first<{ total: number }>();
    const result = await env.DB.prepare(`
      SELECT
        id AS post_log_id,
        created_at,
        action,
        result,
        error_code,
        ip_hash,
        ua_hash,
        file_sha256,
        version_id,
        chart_id
      FROM post_logs
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).bind(pageSize, offset).all<AdminPostLogRow>();

    return ok(request, env, {
      ok: true,
      items: result.results.map((row) => ({
        postLogId: row.post_log_id,
        createdAt: row.created_at,
        action: row.action,
        result: row.result,
        errorCode: row.error_code,
        ipHashShort: shortHash(row.ip_hash),
        uaHashShort: shortHash(row.ua_hash),
        fileSha256Short: shortHash(row.file_sha256),
        hasIpHash: Boolean(row.ip_hash),
        hasUaHash: Boolean(row.ua_hash),
        hasFileSha256: Boolean(row.file_sha256),
        canBanIp: Boolean(row.ip_hash) && row.ip_hash !== unknownIpHash,
        versionId: row.version_id,
        chartId: row.chart_id,
        detailSummary: row.error_code
          ? `${row.action} / ${row.result} / ${row.error_code}`
          : `${row.action} / ${row.result}`
      })),
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0)
    });
  } catch (error) {
    return apiError(request, env, 500, "POST_LOG_LIST_FAILED", "投稿ログの取得に失敗しました。", `D1 post log query failed: ${errorDetail(error)}`);
  }
}

async function readCreateBanBody(
  request: Request,
  env: Env
): Promise<{ ok: true; value: CreateBanBody } | { ok: false; code: string; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return { ok: false, code: "INVALID_BAN_TARGET_TYPE", response: apiError(request, env, 400, "INVALID_BAN_TARGET_TYPE", "BAN作成内容が不正です。", `Request body must be valid JSON: ${errorDetail(error)}`) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "INVALID_BAN_TARGET_TYPE", response: apiError(request, env, 400, "INVALID_BAN_TARGET_TYPE", "BAN作成内容が不正です。", "Request body must be a JSON object.") };
  }
  const record = body as Record<string, unknown>;
  const sourcePostLogId = typeof record.sourcePostLogId === "string" ? record.sourcePostLogId.trim() : "";
  const targetType = record.targetType;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  const duration = record.duration;
  if (!sourcePostLogId) {
    return { ok: false, code: "BAN_SOURCE_LOG_NOT_FOUND", response: apiError(request, env, 400, "BAN_SOURCE_LOG_NOT_FOUND", "対象ログを指定してください。", "sourcePostLogId is required.") };
  }
  if (targetType !== "ip_hash" && targetType !== "file_sha256") {
    return { ok: false, code: "INVALID_BAN_TARGET_TYPE", response: apiError(request, env, 400, "INVALID_BAN_TARGET_TYPE", "BAN対象種別が不正です。", "targetType must be ip_hash or file_sha256.") };
  }
  if (!reason || reason.length > MAX_BAN_REASON_LENGTH) {
    return { ok: false, code: "INVALID_BAN_REASON", response: apiError(request, env, 400, "INVALID_BAN_REASON", "BAN理由を確認してください。", `reason is required and must be ${MAX_BAN_REASON_LENGTH} characters or less.`) };
  }
  if (duration !== "24h" && duration !== "7d" && duration !== "30d" && duration !== "permanent") {
    return { ok: false, code: "INVALID_BAN_DURATION", response: apiError(request, env, 400, "INVALID_BAN_DURATION", "BAN期間が不正です。", "duration must be 24h, 7d, 30d, or permanent.") };
  }
  return { ok: true, value: { sourcePostLogId, targetType, reason, duration } };
}

async function selectBanSource(env: Env, postLogId: string): Promise<BanSourceRow | null> {
  return env.DB.prepare(`
    SELECT id AS post_log_id, ip_hash, file_sha256
    FROM post_logs
    WHERE id = ?
    LIMIT 1
  `).bind(postLogId).first<BanSourceRow>();
}

export async function createAdminBan(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }
  const parsed = await readCreateBanBody(request, env);
  if (!parsed.ok) {
    await writeBanAdminLog(env, "create_ban", "warning", parsed.code, { errorCode: parsed.code });
    return parsed.response;
  }
  const secret = getHashSecret(env);
  if (!secret) {
    return apiError(request, env, 500, "CONFIG_MISSING", "管理機能の設定が不足しています。", "HASH_SECRET is not configured.");
  }

  const input = parsed.value;
  let source: BanSourceRow | null;
  try {
    source = await selectBanSource(env, input.sourcePostLogId);
  } catch (error) {
    await writeBanAdminLog(env, "create_ban", "error", "BAN_CREATE_FAILED", { sourcePostLogId: input.sourcePostLogId, targetType: input.targetType, reasonLength: input.reason.length, duration: input.duration, errorCode: "BAN_CREATE_FAILED" });
    return apiError(request, env, 500, "BAN_CREATE_FAILED", "BAN作成に失敗しました。", `D1 source log lookup failed: ${errorDetail(error)}`);
  }
  if (!source) {
    await writeBanAdminLog(env, "create_ban", "warning", "BAN_SOURCE_LOG_NOT_FOUND", { sourcePostLogId: input.sourcePostLogId, targetType: input.targetType, reasonLength: input.reason.length, duration: input.duration, errorCode: "BAN_SOURCE_LOG_NOT_FOUND" });
    return apiError(request, env, 404, "BAN_SOURCE_LOG_NOT_FOUND", "対象の投稿ログが見つかりません。", "sourcePostLogId was not found.");
  }

  const banValue = input.targetType === "ip_hash" ? source.ip_hash : source.file_sha256;
  const unknownIpHash = await getUnknownIpHash(secret);
  if (!banValue || (input.targetType === "ip_hash" && banValue === unknownIpHash)) {
    await writeBanAdminLog(env, "create_ban", "warning", "BAN_SOURCE_HASH_NOT_AVAILABLE", { sourcePostLogId: input.sourcePostLogId, targetType: input.targetType, reasonLength: input.reason.length, duration: input.duration, errorCode: "BAN_SOURCE_HASH_NOT_AVAILABLE" });
    return apiError(request, env, 409, "BAN_SOURCE_HASH_NOT_AVAILABLE", "このログからBAN対象を取得できません。", "The selected source hash is missing or represents an unknown IP marker.");
  }

  const expiresAt = expirationForDuration(input.duration);
  const valueShort = shortHash(banValue);
  let existing: ExistingBanRow | null;
  try {
    existing = await env.DB.prepare(`
      SELECT id, active, disabled_at, expired_at
      FROM bans
      WHERE ban_type = ? AND ban_value = ?
      LIMIT 1
    `).bind(input.targetType, banValue).first<ExistingBanRow>();

    const banId = existing?.id ?? makeId("ban");
    if (existing) {
      await env.DB.prepare(`
        UPDATE bans
        SET reason = ?, active = 1, expired_at = ?, disabled_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(input.reason, expiresAt, banId).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO bans (id, ban_type, ban_value, reason, active, expired_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).bind(banId, input.targetType, banValue, input.reason, expiresAt).run();
    }

    await writeBanAdminLog(env, "create_ban", "info", null, {
      banId,
      targetType: input.targetType,
      banValueShort: valueShort,
      sourcePostLogId: input.sourcePostLogId,
      reasonLength: input.reason.length,
      duration: input.duration,
      expiresAt,
      reactivated: existing !== null,
      outcome: existing ? "ban_reactivated" : "ban_created"
    });
    return ok(request, env, {
      ok: true,
      banId,
      banType: input.targetType,
      banValueShort: valueShort,
      active: true,
      expiredAt: expiresAt,
      reactivated: existing !== null,
      outcome: existing ? "ban_reactivated" : "ban_created"
    });
  } catch (error) {
    await writeBanAdminLog(env, "create_ban", "error", "BAN_CREATE_FAILED", { sourcePostLogId: input.sourcePostLogId, targetType: input.targetType, banValueShort: valueShort, reasonLength: input.reason.length, duration: input.duration, expiresAt, errorCode: "BAN_CREATE_FAILED" });
    return apiError(request, env, 500, "BAN_CREATE_FAILED", "BAN作成に失敗しました。", `D1 ban upsert failed: ${errorDetail(error)}`);
  }
}

function parseBanListState(value: string | null): BanListState | null {
  const normalized = value?.trim() || "active";
  return normalized === "active" || normalized === "expired" || normalized === "disabled" || normalized === "all"
    ? normalized
    : null;
}

export async function listAdminBans(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(request, env, request.method);
  }
  const url = new URL(request.url);
  const state = parseBanListState(url.searchParams.get("state"));
  if (!state) {
    return apiError(request, env, 400, "INVALID_BAN_STATE", "BAN一覧条件が不正です。", "state must be active, expired, disabled, or all.");
  }
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;
  const effectiveStateSql = `CASE
    WHEN active = 0 OR disabled_at IS NOT NULL THEN 'disabled'
    WHEN expired_at IS NOT NULL AND expired_at <= CURRENT_TIMESTAMP THEN 'expired'
    ELSE 'active'
  END`;
  const whereSql = state === "all" ? "1 = 1" : `${effectiveStateSql} = ?`;
  const bindings: Array<string | number> = state === "all" ? [] : [state];

  try {
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM bans WHERE ${whereSql}`)
      .bind(...bindings).first<{ total: number }>();
    const result = await env.DB.prepare(`
      SELECT
        id AS ban_id,
        ban_type,
        substr(ban_value, 1, ${HASH_PREVIEW_LENGTH}) || '...' AS ban_value_short,
        reason,
        active AS stored_active,
        created_at,
        updated_at,
        expired_at,
        disabled_at,
        ${effectiveStateSql} AS effective_state
      FROM bans
      WHERE ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, pageSize, offset).all<AdminBanListRow>();

    return ok(request, env, {
      ok: true,
      items: result.results.map((row) => ({
        banId: row.ban_id,
        banType: row.ban_type,
        banValueShort: row.ban_value_short,
        reason: row.reason,
        active: row.effective_state === "active",
        storedActive: Number(row.stored_active) === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiredAt: row.expired_at,
        disabledAt: row.disabled_at,
        state: row.effective_state
      })),
      state,
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0)
    });
  } catch (error) {
    return apiError(request, env, 500, "BAN_LIST_FAILED", "BAN一覧の取得に失敗しました。", `D1 ban list query failed: ${errorDetail(error)}`);
  }
}

async function readLiftNote(
  request: Request,
  env: Env
): Promise<{ ok: true; adminNote: string } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return { ok: false, response: apiError(request, env, 400, "BAN_LIFT_FAILED", "解除理由が不正です。", `Request body must be valid JSON: ${errorDetail(error)}`) };
  }
  const adminNote = body && typeof body === "object" && !Array.isArray(body)
    && typeof (body as Record<string, unknown>).adminNote === "string"
    ? ((body as Record<string, unknown>).adminNote as string).trim()
    : "";
  if (!adminNote || adminNote.length > MAX_ADMIN_NOTE_LENGTH) {
    return { ok: false, response: apiError(request, env, 400, "BAN_LIFT_FAILED", "解除理由を確認してください。", `adminNote is required and must be ${MAX_ADMIN_NOTE_LENGTH} characters or less.`) };
  }
  return { ok: true, adminNote };
}

export async function liftAdminBan(
  request: Request,
  env: Env,
  banId: string
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(request, env, request.method);
  }
  const note = await readLiftNote(request, env);
  if (!note.ok) {
    await writeBanAdminLog(env, "lift_ban", "warning", "BAN_LIFT_FAILED", { banId, errorCode: "BAN_LIFT_FAILED" });
    return note.response;
  }

  let ban: LiftBanRow | null;
  try {
    ban = await env.DB.prepare(`
      SELECT id AS ban_id, ban_type, substr(ban_value, 1, ${HASH_PREVIEW_LENGTH}) || '...' AS ban_value_short,
        active, disabled_at, expired_at
      FROM bans
      WHERE id = ?
      LIMIT 1
    `).bind(banId).first<LiftBanRow>();
  } catch (error) {
    await writeBanAdminLog(env, "lift_ban", "error", "BAN_LIFT_FAILED", { banId, adminNoteLength: note.adminNote.length, errorCode: "BAN_LIFT_FAILED" });
    return apiError(request, env, 500, "BAN_LIFT_FAILED", "BAN解除に失敗しました。", `D1 ban lookup failed: ${errorDetail(error)}`);
  }
  if (!ban) {
    await writeBanAdminLog(env, "lift_ban", "warning", "BAN_NOT_FOUND", { banId, adminNoteLength: note.adminNote.length, errorCode: "BAN_NOT_FOUND" });
    return apiError(request, env, 404, "BAN_NOT_FOUND", "BANが見つかりません。", "banId was not found.");
  }
  if (Number(ban.active) === 0 || ban.disabled_at !== null) {
    await writeBanAdminLog(env, "lift_ban", "info", null, { banId, targetType: ban.ban_type, banValueShort: ban.ban_value_short, adminNoteLength: note.adminNote.length, outcome: "already_lifted" });
    return ok(request, env, { ok: true, banId, outcome: "already_lifted", disabledAt: ban.disabled_at });
  }

  try {
    await env.DB.prepare(`
      UPDATE bans
      SET active = 0, disabled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND active = 1 AND disabled_at IS NULL
    `).bind(banId).run();
    const updated = await env.DB.prepare("SELECT disabled_at FROM bans WHERE id = ? LIMIT 1")
      .bind(banId).first<{ disabled_at: string | null }>();
    await writeBanAdminLog(env, "lift_ban", "info", null, { banId, targetType: ban.ban_type, banValueShort: ban.ban_value_short, adminNoteLength: note.adminNote.length, outcome: "ban_lifted" });
    return ok(request, env, { ok: true, banId, outcome: "ban_lifted", disabledAt: updated?.disabled_at ?? null });
  } catch (error) {
    await writeBanAdminLog(env, "lift_ban", "error", "BAN_LIFT_FAILED", { banId, targetType: ban.ban_type, banValueShort: ban.ban_value_short, adminNoteLength: note.adminNote.length, errorCode: "BAN_LIFT_FAILED" });
    return apiError(request, env, 500, "BAN_LIFT_FAILED", "BAN解除に失敗しました。", `D1 ban update failed: ${errorDetail(error)}`);
  }
}
