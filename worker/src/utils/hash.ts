function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export async function hashWithSecret(value: string, secret: string): Promise<string> {
  if (!secret) {
    throw new Error("HASH_SECRET is not configured");
  }

  return sha256Hex(`${secret}:${value}`);
}
