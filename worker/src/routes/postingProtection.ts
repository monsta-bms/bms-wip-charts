import { buildRequestFingerprint } from "../utils/requestFingerprint";
import { apiError, Env, errorDetail } from "../utils/response";
import { enforcePreMultipartPostingBan } from "./bans";
import type { PostingAction } from "./bans";
import { enforcePreMultipartPostingRateLimit } from "./postingRateLimit";
import { enforcePreMultipartTurnstile } from "./turnstile";

export async function enforcePreMultipartPostingProtection(
  request: Request,
  env: Env,
  action: PostingAction,
  chartId: string | null = null
): Promise<Response | null> {
  const secret = env.ABUSE_HASH_SECRET?.trim();
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

  let fingerprint;
  try {
    fingerprint = await buildRequestFingerprint(request, secret);
  } catch (error) {
    console.error("[posting-protection] failed to build request fingerprint", {
      action,
      code: "BAN_CHECK_FAILED",
      stage: "pre_multipart",
      message: errorDetail(error)
    });
    return apiError(
      request,
      env,
      503,
      "BAN_CHECK_FAILED",
      "投稿可否の確認に失敗しました。",
      "Posting protection fingerprint generation failed."
    );
  }

  const banResponse = await enforcePreMultipartPostingBan(
    request,
    env,
    action,
    chartId,
    fingerprint
  );
  if (banResponse) {
    return banResponse;
  }

  const rateLimitResponse = await enforcePreMultipartPostingRateLimit(
    request,
    env,
    action,
    fingerprint,
    chartId
  );
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  return enforcePreMultipartTurnstile(
    request,
    env,
    action,
    fingerprint,
    chartId
  );
}
