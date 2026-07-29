import type { RequestFingerprint } from "../utils/requestFingerprint";
import { apiError, Env, errorDetail } from "../utils/response";
import type { PostingAction } from "./bans";

const TURNSTILE_HEADER = "X-Turnstile-Token";
const TURNSTILE_ACTION = "chart_submit";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 5_000;
const MAX_VERIFY_ATTEMPTS = 2;

type TurnstileMode = "observe" | "required";
type TurnstileErrorCode =
  | "TURNSTILE_REQUIRED"
  | "TURNSTILE_FAILED"
  | "TURNSTILE_UNAVAILABLE";

type TurnstileClassification =
  | "missing_token"
  | "token_too_long"
  | "invalid_token"
  | "expired_or_reused"
  | "hostname_mismatch"
  | "action_mismatch"
  | "configuration_unavailable"
  | "siteverify_unavailable"
  | "siteverify_invalid_response";

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: unknown;
};

type ValidationResult =
  | { ok: true; retried: boolean }
  | {
      ok: false;
      code: TurnstileErrorCode;
      classification: TurnstileClassification;
      retried: boolean;
    };

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getTurnstileMode(env: Env): TurnstileMode {
  return env.TURNSTILE_MODE?.trim().toLowerCase() === "observe"
    ? "observe"
    : "required";
}

function getConfiguredHostnames(env: Env): Set<string> {
  const rawOrigins = env.ALLOWED_ORIGINS?.trim() || env.ALLOWED_ORIGIN?.trim() || "";
  const hostnames = new Set<string>();

  for (const origin of rawOrigins.split(",")) {
    const normalized = origin.trim();
    if (!normalized || normalized === "*") {
      continue;
    }

    try {
      hostnames.add(new URL(normalized).hostname.toLowerCase());
    } catch {
      // Invalid origins are handled by the existing CORS configuration path.
    }
  }

  return hostnames;
}

function getExpectedHostnames(request: Request, env: Env): Set<string> {
  const configured = getConfiguredHostnames(env);
  const origin = request.headers.get("Origin")?.trim();
  if (!origin) {
    return configured;
  }

  try {
    const requestHostname = new URL(origin).hostname.toLowerCase();
    return configured.has(requestHostname)
      ? new Set([requestHostname])
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function parseErrorCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function classifySiteverifyFailure(errorCodes: string[]): {
  code: TurnstileErrorCode;
  classification: TurnstileClassification;
  retryable: boolean;
} {
  if (errorCodes.includes("internal-error")) {
    return {
      code: "TURNSTILE_UNAVAILABLE",
      classification: "siteverify_unavailable",
      retryable: true
    };
  }

  if (
    errorCodes.includes("missing-input-secret") ||
    errorCodes.includes("invalid-input-secret") ||
    errorCodes.includes("bad-request")
  ) {
    return {
      code: "TURNSTILE_UNAVAILABLE",
      classification: "configuration_unavailable",
      retryable: false
    };
  }

  if (errorCodes.includes("timeout-or-duplicate")) {
    return {
      code: "TURNSTILE_FAILED",
      classification: "expired_or_reused",
      retryable: false
    };
  }

  return {
    code: "TURNSTILE_FAILED",
    classification: "invalid_token",
    retryable: false
  };
}

async function validateTurnstile(
  request: Request,
  env: Env,
  token: string
): Promise<ValidationResult> {
  if (token.length > TOKEN_MAX_LENGTH) {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      classification: "token_too_long",
      retried: false
    };
  }

  const secret = env.TURNSTILE_SECRET?.trim();
  const expectedHostnames = getExpectedHostnames(request, env);
  if (!secret || expectedHostnames.size === 0) {
    return {
      ok: false,
      code: "TURNSTILE_UNAVAILABLE",
      classification: "configuration_unavailable",
      retried: false
    };
  }

  const idempotencyKey = crypto.randomUUID();
  let siteverify: SiteverifyResponse | null = null;
  let retried = false;

  for (let attempt = 0; attempt < MAX_VERIFY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          response: token,
          idempotency_key: idempotencyKey
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        if (attempt + 1 < MAX_VERIFY_ATTEMPTS && response.status >= 500) {
          retried = true;
          continue;
        }
        return {
          ok: false,
          code: "TURNSTILE_UNAVAILABLE",
          classification: "siteverify_unavailable",
          retried
        };
      }

      try {
        siteverify = await response.json<SiteverifyResponse>();
      } catch {
        return {
          ok: false,
          code: "TURNSTILE_UNAVAILABLE",
          classification: "siteverify_invalid_response",
          retried
        };
      }

      if (siteverify.success === true) {
        break;
      }

      const classified = classifySiteverifyFailure(parseErrorCodes(siteverify["error-codes"]));
      if (classified.retryable && attempt + 1 < MAX_VERIFY_ATTEMPTS) {
        retried = true;
        continue;
      }
      return {
        ok: false,
        code: classified.code,
        classification: classified.classification,
        retried
      };
    } catch {
      if (attempt + 1 < MAX_VERIFY_ATTEMPTS) {
        retried = true;
        continue;
      }
      return {
        ok: false,
        code: "TURNSTILE_UNAVAILABLE",
        classification: "siteverify_unavailable",
        retried
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (!siteverify || siteverify.success !== true) {
    return {
      ok: false,
      code: "TURNSTILE_UNAVAILABLE",
      classification: "siteverify_invalid_response",
      retried
    };
  }

  const hostname = siteverify.hostname?.trim().toLowerCase() || "";
  if (!expectedHostnames.has(hostname)) {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      classification: "hostname_mismatch",
      retried
    };
  }

  if (siteverify.action !== TURNSTILE_ACTION) {
    return {
      ok: false,
      code: "TURNSTILE_FAILED",
      classification: "action_mismatch",
      retried
    };
  }

  return { ok: true, retried };
}

async function writeTurnstileRejectionLog(
  env: Env,
  action: PostingAction,
  chartId: string | null,
  fingerprint: RequestFingerprint,
  code: TurnstileErrorCode,
  classification: TurnstileClassification,
  retried: boolean
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO post_logs (
        id, action, song_id, chart_id, version_id, ip_hash, ua_hash, fingerprint_hash_version,
        file_sha256, result, error_code, detail
      ) VALUES (?, ?, NULL, ?, NULL, ?, ?, 2, NULL, 'rejected', ?, ?)
    `).bind(
      makeId("post_log"),
      action,
      chartId,
      fingerprint.ipHash,
      fingerprint.uaHash,
      code,
      JSON.stringify({
        stage: "pre_multipart_turnstile",
        classification,
        retried,
        errorCode: code
      })
    ).run();
  } catch (error) {
    console.error("[turnstile-log] failed to write rejected post log", {
      action,
      code: "POST_LOG_WRITE_FAILED",
      stage: "pre_multipart_turnstile",
      message: errorDetail(error)
    });
  }
}

function turnstileErrorResponse(
  request: Request,
  env: Env,
  code: TurnstileErrorCode
): Response {
  if (code === "TURNSTILE_REQUIRED") {
    return apiError(
      request,
      env,
      400,
      code,
      "Turnstile認証を完了してください。",
      "Turnstile token is required."
    );
  }

  if (code === "TURNSTILE_FAILED") {
    return apiError(
      request,
      env,
      403,
      code,
      "Turnstile認証に失敗しました。再試行してください。",
      "Turnstile validation failed."
    );
  }

  return apiError(
    request,
    env,
    503,
    code,
    "Turnstile認証を利用できません。時間をおいて再試行してください。",
    "Turnstile validation is temporarily unavailable."
  );
}

export async function enforcePreMultipartTurnstile(
  request: Request,
  env: Env,
  action: PostingAction,
  fingerprint: RequestFingerprint,
  chartId: string | null = null
): Promise<Response | null> {
  const mode = getTurnstileMode(env);
  const token = request.headers.get(TURNSTILE_HEADER)?.trim() || "";

  if (
    mode === "required" &&
    (!env.TURNSTILE_SECRET?.trim() || getExpectedHostnames(request, env).size === 0)
  ) {
    await writeTurnstileRejectionLog(
      env,
      action,
      chartId,
      fingerprint,
      "TURNSTILE_UNAVAILABLE",
      "configuration_unavailable",
      false
    );
    return turnstileErrorResponse(request, env, "TURNSTILE_UNAVAILABLE");
  }

  if (!token) {
    if (mode === "observe") {
      console.info("[turnstile-observe] token was not provided", {
        action,
        stage: "pre_multipart_turnstile",
        classification: "missing_token"
      });
      return null;
    }

    await writeTurnstileRejectionLog(
      env,
      action,
      chartId,
      fingerprint,
      "TURNSTILE_REQUIRED",
      "missing_token",
      false
    );
    return turnstileErrorResponse(request, env, "TURNSTILE_REQUIRED");
  }

  const validation = await validateTurnstile(request, env, token);
  if (validation.ok) {
    return null;
  }

  if (mode === "observe") {
    console.warn("[turnstile-observe] validation did not pass", {
      action,
      stage: "pre_multipart_turnstile",
      classification: validation.classification,
      retried: validation.retried
    });
    return null;
  }

  await writeTurnstileRejectionLog(
    env,
    action,
    chartId,
    fingerprint,
    validation.code,
    validation.classification,
    validation.retried
  );
  return turnstileErrorResponse(request, env, validation.code);
}
