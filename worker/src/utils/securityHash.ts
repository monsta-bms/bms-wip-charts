import { toHex } from "./hash";

export const SECURITY_HASH_KEY_VERSION = 2 as const;

export type SecurityHashDomain =
  | "password"
  | "abuse-subject"
  | "withdrawal-idempotency";

const encoder = new TextEncoder();

function requireSecret(secret: string): string {
  const normalized = secret.trim();
  if (!normalized) {
    throw new Error("Security hash secret is not configured.");
  }
  return normalized;
}

export async function hmacSha256Hex(
  secret: string,
  domain: SecurityHashDomain,
  canonicalInput: string,
  keyVersion: number = SECURITY_HASH_KEY_VERSION
): Promise<string> {
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new Error("Security hash key version is invalid.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(requireSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const message = `bms-wip-charts\u0000${domain}\u0000v${keyVersion}\u0000${canonicalInput}`;
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export function hashPassword(secret: string, password: string): Promise<string> {
  return hmacSha256Hex(secret, "password", `password:${password}`);
}

export type PasswordVerificationResult = "verified" | "invalid" | "legacy" | "unsupported";

export async function verifyPasswordHash(
  secret: string,
  password: string,
  storedHash: string,
  keyVersion: number
): Promise<PasswordVerificationResult> {
  if (keyVersion === 1) {
    return "legacy";
  }
  if (keyVersion !== SECURITY_HASH_KEY_VERSION) {
    return "unsupported";
  }
  const submittedHash = await hashPassword(secret, password);
  return timingSafeEqual(submittedHash, storedHash) ? "verified" : "invalid";
}

export function hashAbuseSubject(secret: string, subject: "ip" | "ua", marker: string): Promise<string> {
  return hmacSha256Hex(secret, "abuse-subject", `${subject}:${marker}`);
}

export function hashWithdrawalIdempotency(secret: string, idempotencyKey: string): Promise<string> {
  return hmacSha256Hex(secret, "withdrawal-idempotency", `key:${idempotencyKey}`);
}
