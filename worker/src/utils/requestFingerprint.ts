import { hashAbuseSubject } from "./securityHash";

export type RequestFingerprint = {
  ipHash: string;
  uaHash: string;
  ipKnown: boolean;
  ipSource: "cf_connecting_ip" | "x_forwarded_for" | "unknown";
};

function getClientIpMarker(request: Request): {
  marker: string;
  known: boolean;
  source: RequestFingerprint["ipSource"];
} {
  const cfIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cfIp) {
    return { marker: cfIp, known: true, source: "cf_connecting_ip" };
  }

  // Local development compatibility only. Production requests are expected to have CF-Connecting-IP.
  const forwardedFor = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (forwardedFor) {
    return { marker: forwardedFor, known: true, source: "x_forwarded_for" };
  }

  return { marker: "unknown", known: false, source: "unknown" };
}

function getUserAgentMarker(request: Request): string {
  return request.headers.get("User-Agent")?.trim() || "unknown";
}

export async function buildRequestFingerprint(
  request: Request,
  secret: string
): Promise<RequestFingerprint> {
  const ip = getClientIpMarker(request);
  return {
    ipHash: await hashAbuseSubject(secret, "ip", ip.marker),
    uaHash: await hashAbuseSubject(secret, "ua", getUserAgentMarker(request)),
    ipKnown: ip.known,
    ipSource: ip.source
  };
}

export async function getUnknownIpHash(secret: string): Promise<string> {
  return hashAbuseSubject(secret, "ip", "unknown");
}
