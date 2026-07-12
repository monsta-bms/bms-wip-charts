export const MAX_ORIGIN_URL_LENGTH = 2048;

type OriginUrlFailureCode = "INVALID_ORIGIN_URL" | "ORIGIN_URL_TOO_LONG";

export type OriginUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; code: OriginUrlFailureCode; detail: string };

export function normalizeOriginUrl(rawValue: string | null | undefined): OriginUrlResult {
  const raw = rawValue ?? "";

  if (/[\u0000-\u001f\u007f]/u.test(raw)) {
    return {
      ok: false,
      code: "INVALID_ORIGIN_URL",
      detail: "originUrl must not contain control characters."
    };
  }

  const value = raw.trim();
  if (!value) {
    return { ok: true, value: null };
  }

  if (value.length > MAX_ORIGIN_URL_LENGTH) {
    return {
      ok: false,
      code: "ORIGIN_URL_TOO_LONG",
      detail: `originUrl must be ${MAX_ORIGIN_URL_LENGTH} characters or less.`
    };
  }

  if (/\s/u.test(value)) {
    return {
      ok: false,
      code: "INVALID_ORIGIN_URL",
      detail: "originUrl must not contain unencoded whitespace."
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      code: "INVALID_ORIGIN_URL",
      detail: "originUrl must be an absolute HTTP or HTTPS URL."
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "INVALID_ORIGIN_URL",
      detail: "originUrl protocol must be HTTP or HTTPS."
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: "INVALID_ORIGIN_URL",
      detail: "originUrl must not contain username or password credentials."
    };
  }

  parsed.hash = "";
  const normalized = parsed.toString();
  if (normalized.length > MAX_ORIGIN_URL_LENGTH) {
    return {
      ok: false,
      code: "ORIGIN_URL_TOO_LONG",
      detail: `Normalized originUrl must be ${MAX_ORIGIN_URL_LENGTH} characters or less.`
    };
  }

  return { ok: true, value: normalized };
}
