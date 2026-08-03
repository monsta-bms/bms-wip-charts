import { buildRequestFingerprint } from "../utils/requestFingerprint";
import {
  apiError,
  Env,
  errorDetail,
  jsonResponse,
  methodNotAllowed,
  ok
} from "../utils/response";
import { publicWithdrawalExclusionSql } from "../utils/versionWithdrawal";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_BODY_CODE_POINTS = 500;
const FINGERPRINT_HASH_VERSION = 2;
const RATE_RULES = [
  { window: "-10 minutes", limit: 3, seconds: 10 * 60 },
  { window: "-1 hour", limit: 10, seconds: 60 * 60 }
] as const;

type PublicVersionRow = {
  version_id: string;
  available: number;
};

type CommentRow = {
  id: string;
  body: string;
  created_at: string;
};

type CountRow = {
  total: number;
};

type RateRow = {
  count_10m: number;
  count_1h: number;
};

type CommentBody = {
  body?: unknown;
};

function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function fail(
  request: Request,
  env: Env,
  status: number,
  code: string,
  message: string,
  detail: string
): Response {
  return withNoStore(apiError(request, env, status, code, message, detail));
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  maximum?: number
): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    return null;
  }
  return parsed;
}

function mapComment(row: CommentRow): { id: string; body: string; createdAt: string } {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at
  };
}

async function readPublicVersion(env: Env, versionId: string): Promise<PublicVersionRow | null> {
  return env.DB.prepare(`
    SELECT
      versions.id AS version_id,
      CASE
        WHEN charts.is_hidden = 0
          AND versions.is_hidden = 0
          AND ${publicWithdrawalExclusionSql("versions")}
        THEN 1
        ELSE 0
      END AS available
    FROM versions
    INNER JOIN charts ON charts.id = versions.chart_id
    WHERE versions.id = ?
    LIMIT 1
  `).bind(versionId).first<PublicVersionRow>();
}

async function requirePublicVersion(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response | null> {
  let version: PublicVersionRow | null;
  try {
    version = await readPublicVersion(env, versionId);
  } catch (error) {
    console.error("[version-comment-version-read] failed to read target version", {
      code: "VERSION_COMMENT_DB_FAILED",
      stage: "target_version",
      versionId,
      message: errorDetail(error)
    });
    return fail(
      request,
      env,
      500,
      "VERSION_COMMENT_DB_FAILED",
      "コメント対象の確認に失敗しました。",
      "Failed to read the target version."
    );
  }

  if (!version) {
    return fail(
      request,
      env,
      404,
      "VERSION_COMMENT_VERSION_NOT_FOUND",
      "コメント対象の差分が見つかりません。",
      "The requested version does not exist."
    );
  }
  if (version.available !== 1) {
    return fail(
      request,
      env,
      409,
      "VERSION_COMMENT_VERSION_UNAVAILABLE",
      "この差分には現在コメントできません。",
      "The requested version is not publicly available."
    );
  }
  return null;
}

async function handleGetComments(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response> {
  const url = new URL(request.url);
  const page = parsePositiveInteger(url.searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (page === null || pageSize === null) {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_INVALID_REQUEST",
      "コメント一覧の指定が不正です。",
      `page must be positive and pageSize must be between 1 and ${MAX_PAGE_SIZE}.`
    );
  }
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_INVALID_REQUEST",
      "コメント一覧の指定が不正です。",
      "page and pageSize produce an unsafe offset."
    );
  }

  const unavailable = await requirePublicVersion(request, env, versionId);
  if (unavailable) return unavailable;

  try {
    const [rows, count] = await Promise.all([
      env.DB.prepare(`
        SELECT id, body, created_at
        FROM version_comments
        WHERE version_id = ? AND is_hidden = 0
        ORDER BY created_at ASC, id ASC
        LIMIT ? OFFSET ?
      `).bind(versionId, pageSize, offset).all<CommentRow>(),
      env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM version_comments
        WHERE version_id = ? AND is_hidden = 0
      `).bind(versionId).first<CountRow>()
    ]);
    return withNoStore(ok(request, env, {
      versionId,
      items: (rows.results ?? []).map(mapComment),
      page,
      pageSize,
      total: Number(count?.total ?? 0)
    }));
  } catch (error) {
    console.error("[version-comment-list-read] failed to read comments", {
      code: "VERSION_COMMENT_DB_FAILED",
      stage: "list",
      versionId,
      page,
      pageSize,
      message: errorDetail(error)
    });
    return fail(
      request,
      env,
      500,
      "VERSION_COMMENT_DB_FAILED",
      "コメント一覧を読み込めませんでした。",
      "Failed to read version comments."
    );
  }
}

async function parseCommentBody(
  request: Request,
  env: Env
): Promise<{ body: string } | Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_INVALID_REQUEST",
      "コメントの送信内容が不正です。",
      "Request body must be a JSON object."
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_INVALID_REQUEST",
      "コメントの送信内容が不正です。",
      "Request body must be a JSON object."
    );
  }

  const rawBody = (parsed as CommentBody).body;
  if (typeof rawBody !== "string") {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_BODY_REQUIRED",
      "コメントを入力してください。",
      "body must be a non-empty string."
    );
  }
  const body = rawBody.replace(/\r\n?/g, "\n").trim();
  if (!body) {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_BODY_REQUIRED",
      "コメントを入力してください。",
      "body must contain at least one non-whitespace character."
    );
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(body)) {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_INVALID_REQUEST",
      "コメントに使用できない文字が含まれています。",
      "body contains unsupported control characters."
    );
  }
  if (Array.from(body).length > MAX_BODY_CODE_POINTS) {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_BODY_TOO_LONG",
      `コメントは${MAX_BODY_CODE_POINTS}文字以内で入力してください。`,
      `body must be ${MAX_BODY_CODE_POINTS} Unicode code points or less.`
    );
  }
  return { body };
}

async function readRateLimit(
  env: Env,
  ipHash: string,
  uaHash: string
): Promise<RateRow> {
  const row = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-10 minutes') THEN 1 ELSE 0 END), 0) AS count_10m,
      COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-1 hour') THEN 1 ELSE 0 END), 0) AS count_1h
    FROM version_comments
    WHERE ip_hash = ?
      AND ua_hash = ?
      AND fingerprint_hash_version = ?
      AND created_at >= datetime('now', '-1 hour')
  `).bind(ipHash, uaHash, FINGERPRINT_HASH_VERSION).first<RateRow>();
  return row ?? { count_10m: 0, count_1h: 0 };
}

function violatedRateRule(row: RateRow): typeof RATE_RULES[number] | null {
  const counts = [Number(row.count_10m ?? 0), Number(row.count_1h ?? 0)];
  return RATE_RULES.find((rule, index) => counts[index] >= rule.limit) ?? null;
}

async function handlePostComment(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response> {
  const parsed = await parseCommentBody(request, env);
  if (parsed instanceof Response) return parsed;

  const unavailable = await requirePublicVersion(request, env, versionId);
  if (unavailable) return unavailable;

  const abuseSecret = env.ABUSE_HASH_SECRET?.trim();
  if (!abuseSecret) {
    return fail(
      request,
      env,
      503,
      "VERSION_COMMENT_DB_FAILED",
      "コメント投稿の安全確認を利用できません。",
      "Comment posting protection is unavailable."
    );
  }

  try {
    const fingerprint = await buildRequestFingerprint(request, abuseSecret);
    const [ban, rate] = await Promise.all([
      env.DB.prepare(`
        SELECT ban_type
        FROM bans
        WHERE active = 1
          AND ban_hash_version = ?
          AND disabled_at IS NULL
          AND (expired_at IS NULL OR expired_at > CURRENT_TIMESTAMP)
          AND (
            (ban_type = 'ip_hash' AND ban_value = ?)
            OR (ban_type = 'ua_hash' AND ban_value = ?)
          )
        LIMIT 1
      `).bind(FINGERPRINT_HASH_VERSION, fingerprint.ipHash, fingerprint.uaHash).first<{ ban_type: string }>(),
      readRateLimit(env, fingerprint.ipHash, fingerprint.uaHash)
    ]);

    if (ban) {
      return fail(
        request,
        env,
        403,
        "VERSION_COMMENT_POSTING_BLOCKED",
        "この環境からはコメントを投稿できません。",
        "Comment posting is blocked by an active moderation rule."
      );
    }
    const rateRule = violatedRateRule(rate);
    if (rateRule) {
      const response = jsonResponse(request, env, {
        code: "VERSION_COMMENT_RATE_LIMITED",
        message: "短時間にコメントが続いています。しばらく待ってから再度お試しください。",
        detail: "Comment rate limit exceeded."
      }, {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(rateRule.seconds)
        }
      });
      return response;
    }

    const commentId = `version_comment_${crypto.randomUUID()}`;
    const insert = await env.DB.prepare(`
      INSERT INTO version_comments (
        id, version_id, body, ip_hash, ua_hash, fingerprint_hash_version
      )
      SELECT ?, versions.id, ?, ?, ?, ?
      FROM versions
      INNER JOIN charts ON charts.id = versions.chart_id
      WHERE versions.id = ?
        AND charts.is_hidden = 0
        AND versions.is_hidden = 0
        AND ${publicWithdrawalExclusionSql("versions")}
    `).bind(
      commentId,
      parsed.body,
      fingerprint.ipHash,
      fingerprint.uaHash,
      FINGERPRINT_HASH_VERSION,
      versionId
    ).run();

    if (Number(insert.meta.changes ?? 0) !== 1) {
      return fail(
        request,
        env,
        409,
        "VERSION_COMMENT_VERSION_UNAVAILABLE",
        "この差分には現在コメントできません。",
        "The target version became unavailable before the write."
      );
    }

    const [comment, total] = await Promise.all([
      env.DB.prepare(`
        SELECT id, body, created_at
        FROM version_comments
        WHERE id = ? AND is_hidden = 0
      `).bind(commentId).first<CommentRow>(),
      env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM version_comments
        WHERE version_id = ? AND is_hidden = 0
      `).bind(versionId).first<CountRow>()
    ]);
    if (!comment) throw new Error("Inserted comment could not be read back.");

    return withNoStore(ok(request, env, {
      ok: true,
      comment: mapComment(comment),
      total: Number(total?.total ?? 0)
    }, { status: 201 }));
  } catch (error) {
    console.error("[version-comment-create] failed to create comment", {
      code: "VERSION_COMMENT_DB_FAILED",
      stage: "post",
      versionId,
      bodyLength: Array.from(parsed.body).length,
      message: errorDetail(error)
    });
    return fail(
      request,
      env,
      500,
      "VERSION_COMMENT_DB_FAILED",
      "コメントを投稿できませんでした。",
      "Failed to create the version comment."
    );
  }
}

export async function handleVersionCommentsRoute(
  request: Request,
  env: Env,
  versionId: string
): Promise<Response> {
  if (!versionId || versionId.length > 160) {
    return fail(
      request,
      env,
      400,
      "VERSION_COMMENT_INVALID_REQUEST",
      "差分IDが不正です。",
      "versionId must be between 1 and 160 characters."
    );
  }
  if (request.method === "GET") return handleGetComments(request, env, versionId);
  if (request.method === "POST") return handlePostComment(request, env, versionId);
  return withNoStore(methodNotAllowed(request, env, request.method));
}
