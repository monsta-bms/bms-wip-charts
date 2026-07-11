import type { RequestFingerprint } from "../utils/requestFingerprint";
import { apiError, Env, errorDetail, jsonResponse } from "../utils/response";
import type { PostingAction } from "./bans";

const CLIENT_REJECTED_ERROR_CODES = [
  "INVALID_FORM",
  "PASSWORD_REQUIRED",
  "INVALID_EXTENSION",
  "FILE_TOO_LARGE",
  "INVALID_PROGRESS",
  "INVALID_REJECTED_FLAG_FOR_FOLLOWUP",
  "INVALID_PROGRESS_MAP",
  "PROGRESS_MAP_OUT_OF_RANGE",
  "PROGRESS_MAP_BLOCK_COUNT_MISMATCH",
  "PROGRESS_MAP_UNCHANGED",
  "CHART_NOT_FOUND",
  "PARENT_VERSION_NOT_FOUND",
  "PARENT_VERSION_CHART_MISMATCH",
  "REJECTED_CHART_CANNOT_BE_EXTENDED",
  "TITLE_ARTIST_MISMATCH",
  "DUPLICATE_FILE",
  "CHART_ALREADY_EXISTS"
] as const;

type CounterKey =
  | "create_10m"
  | "create_1h"
  | "create_24h"
  | "append_10m"
  | "append_1h"
  | "append_24h"
  | "client_rejected_10m"
  | "client_rejected_1h";

type RuleDefinition = {
  name: CounterKey;
  windowSeconds: number;
  limit: number;
};

type RateAggregateRow = {
  now_unix: number | null;
  [key: string]: number | null;
};

type ViolatedRule = RuleDefinition & {
  count: number;
  retryAfterSeconds: number;
};

const ACCEPTED_RULES: Record<PostingAction, RuleDefinition[]> = {
  create_chart: [
    { name: "create_10m", windowSeconds: 10 * 60, limit: 3 },
    { name: "create_1h", windowSeconds: 60 * 60, limit: 10 },
    { name: "create_24h", windowSeconds: 24 * 60 * 60, limit: 30 }
  ],
  append_version: [
    { name: "append_10m", windowSeconds: 10 * 60, limit: 5 },
    { name: "append_1h", windowSeconds: 60 * 60, limit: 20 },
    { name: "append_24h", windowSeconds: 24 * 60 * 60, limit: 60 }
  ]
};

const CLIENT_REJECTED_RULES: RuleDefinition[] = [
  { name: "client_rejected_10m", windowSeconds: 10 * 60, limit: 10 },
  { name: "client_rejected_1h", windowSeconds: 60 * 60, limit: 30 }
];

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}

function countKey(rule: RuleDefinition): string {
  return `${rule.name}_count`;
}

function oldestKey(rule: RuleDefinition): string {
  return `${rule.name}_oldest`;
}

function calculateRetryAfterSeconds(
  rule: RuleDefinition,
  oldestUnix: number | null,
  nowUnix: number
): number {
  if (oldestUnix === null || !Number.isFinite(oldestUnix)) {
    return rule.windowSeconds;
  }

  const elapsedSeconds = Math.max(0, nowUnix - Number(oldestUnix));
  const remainingSeconds = Math.ceil(rule.windowSeconds - elapsedSeconds);
  return Math.max(1, Math.min(rule.windowSeconds, remainingSeconds));
}

function findViolatedRules(
  row: RateAggregateRow,
  action: PostingAction
): ViolatedRule[] {
  const nowCandidate = row.now_unix === null ? Number.NaN : Number(row.now_unix);
  const nowUnix = Number.isFinite(nowCandidate)
    ? nowCandidate
    : Math.floor(Date.now() / 1000);

  return [...ACCEPTED_RULES[action], ...CLIENT_REJECTED_RULES]
    .map((rule) => {
      const count = Number(row[countKey(rule)] ?? 0);
      if (!Number.isFinite(count) || count < rule.limit) {
        return null;
      }

      const oldestValue = row[oldestKey(rule)];
      const oldestUnix = oldestValue === null || oldestValue === undefined
        ? null
        : Number(oldestValue);
      return {
        ...rule,
        count,
        retryAfterSeconds: calculateRetryAfterSeconds(rule, oldestUnix, nowUnix)
      };
    })
    .filter((rule): rule is ViolatedRule => rule !== null);
}

async function readRateAggregates(
  env: Env,
  ipHash: string
): Promise<RateAggregateRow> {
  const placeholders = CLIENT_REJECTED_ERROR_CODES.map(() => "?").join(", ");
  const row = await env.DB.prepare(`
    WITH recent AS (
      SELECT
        action,
        result,
        error_code,
        unixepoch(created_at) AS created_unix
      FROM post_logs
      WHERE ip_hash = ?
        AND action IN ('create_chart', 'append_version')
        AND created_at >= datetime('now', '-24 hours')
    ), classified AS (
      SELECT
        action,
        result,
        created_unix,
        CASE
          WHEN result = 'rejected' AND error_code IN (${placeholders}) THEN 1
          ELSE 0
        END AS is_client_rejected
      FROM recent
    )
    SELECT
      unixepoch('now') AS now_unix,
      COALESCE(SUM(CASE WHEN action = 'create_chart' AND result = 'accepted' AND created_unix >= unixepoch('now', '-10 minutes') THEN 1 ELSE 0 END), 0) AS create_10m_count,
      MIN(CASE WHEN action = 'create_chart' AND result = 'accepted' AND created_unix >= unixepoch('now', '-10 minutes') THEN created_unix END) AS create_10m_oldest,
      COALESCE(SUM(CASE WHEN action = 'create_chart' AND result = 'accepted' AND created_unix >= unixepoch('now', '-1 hour') THEN 1 ELSE 0 END), 0) AS create_1h_count,
      MIN(CASE WHEN action = 'create_chart' AND result = 'accepted' AND created_unix >= unixepoch('now', '-1 hour') THEN created_unix END) AS create_1h_oldest,
      COALESCE(SUM(CASE WHEN action = 'create_chart' AND result = 'accepted' THEN 1 ELSE 0 END), 0) AS create_24h_count,
      MIN(CASE WHEN action = 'create_chart' AND result = 'accepted' THEN created_unix END) AS create_24h_oldest,
      COALESCE(SUM(CASE WHEN action = 'append_version' AND result = 'accepted' AND created_unix >= unixepoch('now', '-10 minutes') THEN 1 ELSE 0 END), 0) AS append_10m_count,
      MIN(CASE WHEN action = 'append_version' AND result = 'accepted' AND created_unix >= unixepoch('now', '-10 minutes') THEN created_unix END) AS append_10m_oldest,
      COALESCE(SUM(CASE WHEN action = 'append_version' AND result = 'accepted' AND created_unix >= unixepoch('now', '-1 hour') THEN 1 ELSE 0 END), 0) AS append_1h_count,
      MIN(CASE WHEN action = 'append_version' AND result = 'accepted' AND created_unix >= unixepoch('now', '-1 hour') THEN created_unix END) AS append_1h_oldest,
      COALESCE(SUM(CASE WHEN action = 'append_version' AND result = 'accepted' THEN 1 ELSE 0 END), 0) AS append_24h_count,
      MIN(CASE WHEN action = 'append_version' AND result = 'accepted' THEN created_unix END) AS append_24h_oldest,
      COALESCE(SUM(CASE WHEN is_client_rejected = 1 AND created_unix >= unixepoch('now', '-10 minutes') THEN 1 ELSE 0 END), 0) AS client_rejected_10m_count,
      MIN(CASE WHEN is_client_rejected = 1 AND created_unix >= unixepoch('now', '-10 minutes') THEN created_unix END) AS client_rejected_10m_oldest,
      COALESCE(SUM(CASE WHEN is_client_rejected = 1 AND created_unix >= unixepoch('now', '-1 hour') THEN 1 ELSE 0 END), 0) AS client_rejected_1h_count,
      MIN(CASE WHEN is_client_rejected = 1 AND created_unix >= unixepoch('now', '-1 hour') THEN created_unix END) AS client_rejected_1h_oldest
    FROM classified
  `).bind(ipHash, ...CLIENT_REJECTED_ERROR_CODES).first<RateAggregateRow>();

  if (!row) {
    throw new Error("Posting rate aggregate query returned no row.");
  }
  return row;
}

async function writeRateLimitedPostLog(
  env: Env,
  action: PostingAction,
  chartId: string | null,
  fingerprint: RequestFingerprint,
  representativeRule: ViolatedRule
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO post_logs (
        id, action, song_id, chart_id, version_id, ip_hash, ua_hash,
        file_sha256, result, error_code, detail
      ) VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, 'rejected', 'POST_RATE_LIMITED', ?)
    `).bind(
      makeId("post_log"),
      action,
      chartId,
      fingerprint.ipHash,
      fingerprint.uaHash,
      JSON.stringify({
        stage: "pre_multipart",
        rule: representativeRule.name,
        windowSeconds: representativeRule.windowSeconds,
        limit: representativeRule.limit,
        count: representativeRule.count,
        errorCode: "POST_RATE_LIMITED"
      })
    ).run();
  } catch (error) {
    console.error("[posting-rate-limit-log] failed to write rejected post log", {
      action,
      code: "POST_LOG_WRITE_FAILED",
      stage: "post_rate_limit",
      message: errorDetail(error)
    });
  }
}

export async function enforcePreMultipartPostingRateLimit(
  request: Request,
  env: Env,
  action: PostingAction,
  fingerprint: RequestFingerprint,
  chartId: string | null = null
): Promise<Response | null> {
  if (!fingerprint.ipKnown) {
    if (isLocalRequest(request)) {
      return null;
    }

    console.error("[posting-rate-limit] request IP marker is unavailable", {
      action,
      code: "POST_RATE_LIMIT_CHECK_FAILED",
      stage: "pre_multipart",
      ipSource: fingerprint.ipSource
    });
    return apiError(
      request,
      env,
      503,
      "POST_RATE_LIMIT_CHECK_FAILED",
      "投稿回数の確認に失敗しました。しばらく待ってから再試行してください。",
      "Posting rate limit lookup failed."
    );
  }

  let aggregates: RateAggregateRow;
  try {
    aggregates = await readRateAggregates(env, fingerprint.ipHash);
  } catch (error) {
    console.error("[posting-rate-limit] failed to read posting logs", {
      action,
      code: "POST_RATE_LIMIT_CHECK_FAILED",
      stage: "pre_multipart",
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      503,
      "POST_RATE_LIMIT_CHECK_FAILED",
      "投稿回数の確認に失敗しました。しばらく待ってから再試行してください。",
      "Posting rate limit lookup failed."
    );
  }

  const violatedRules = findViolatedRules(aggregates, action);
  if (violatedRules.length === 0) {
    return null;
  }

  const representativeRule = violatedRules.reduce((longest, current) =>
    current.retryAfterSeconds > longest.retryAfterSeconds ? current : longest
  );
  const retryAfterSeconds = representativeRule.retryAfterSeconds;
  await writeRateLimitedPostLog(env, action, chartId, fingerprint, representativeRule);

  return jsonResponse(
    request,
    env,
    {
      code: "POST_RATE_LIMITED",
      message: "短時間の投稿数が多すぎます。しばらく待ってから再試行してください。",
      detail: "Posting rate limit exceeded.",
      retryAfterSeconds
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store"
      }
    }
  );
}
