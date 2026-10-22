import type { Env } from "./response";
import { verifyPasswordHash, type PasswordVerificationResult } from "./securityHash";

export const INVALID_PASSWORD_LIMIT = 5;
export const INVALID_PASSWORD_VERSION_LIMIT = 20;
export const INVALID_PASSWORD_WINDOW_MINUTES = 10;
const PENDING_CODE = "PASSWORD_CHECK_PENDING";

type AttemptContext = {
  action: "withdraw_version" | "request_delete";
  ipHash: string;
  uaHash: string;
  versionId: string;
  chartId: string;
  songId: string;
  fileSha256: string | null;
};

// Reserve before checking a password, in the same statement that tests the
// counters. In-flight requests count too, so concurrent requests cannot all
// pass a SELECT performed before the first failed password is logged.
export async function checkManagementPassword(
  env: Env,
  context: AttemptContext,
  secret: string,
  password: string,
  storedHash: string,
  hashVersion: number
): Promise<{ limited: true } | { limited: false; result: PasswordVerificationResult; attemptId: string }> {
  const attemptId = `password_attempt_${crypto.randomUUID()}`;
  const inserted = await env.DB.prepare(`
    WITH recent AS (
      SELECT ip_hash, version_id
      FROM post_logs
      WHERE fingerprint_hash_version = 2
        AND action IN ('withdraw_version', 'request_delete')
        AND result = 'rejected'
        AND error_code IN ('INVALID_PASSWORD', '${PENDING_CODE}')
        AND created_at >= datetime('now', ?)
    )
    INSERT INTO post_logs (
      id, action, song_id, chart_id, version_id, ip_hash, ua_hash,
      fingerprint_hash_version, file_sha256, result, error_code, detail
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, 2, ?, 'rejected', '${PENDING_CODE}',
      'Management password verification is pending.'
    WHERE (SELECT COUNT(*) FROM recent WHERE ip_hash = ?) < ?
      AND (SELECT COUNT(*) FROM recent WHERE version_id = ?) < ?
  `).bind(
    `-${INVALID_PASSWORD_WINDOW_MINUTES} minutes`,
    attemptId, context.action, context.songId, context.chartId, context.versionId,
    context.ipHash, context.uaHash, context.fileSha256,
    context.ipHash, INVALID_PASSWORD_LIMIT,
    context.versionId, INVALID_PASSWORD_VERSION_LIMIT
  ).run();
  if (Number(inserted.meta.changes ?? 0) !== 1) return { limited: true };

  let result: PasswordVerificationResult;
  try {
    result = await verifyPasswordHash(secret, password, storedHash, hashVersion);
  } catch (error) {
    await releaseManagementPasswordAttempt(env, attemptId);
    throw error;
  }
  if (result === "verified" || result === "legacy") {
    await releaseManagementPasswordAttempt(env, attemptId);
  }
  // Invalid/unsupported passwords keep their reservation until the caller
  // turns it into the existing INVALID_PASSWORD audit log. If that write fails,
  // the reservation still counts for ten minutes (fail closed).
  return { limited: false, result, attemptId };
}

async function releaseManagementPasswordAttempt(env: Env, attemptId: string): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM post_logs WHERE id = ? AND error_code = '${PENDING_CODE}'
  `).bind(attemptId).run();
}

export async function finishManagementPasswordFailure(
  env: Env,
  attemptId: string,
  detail: string
): Promise<void> {
  const result = await env.DB.prepare(`
    UPDATE post_logs
    SET error_code = 'INVALID_PASSWORD', detail = ?
    WHERE id = ? AND error_code = '${PENDING_CODE}'
  `).bind(detail, attemptId).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new Error("Management password attempt reservation could not be finalized.");
  }
}
