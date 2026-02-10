function normalizeBase64(input: string): string {
  let s = String(input || "").trim();
  if (!s) throw new Error("Empty base64 hash");
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  return s;
}

export function is32ByteHex(hex: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hex);
}

export function base64ToHex(b64: string): string {
  const normalized = normalizeBase64(b64);
  const buf = Buffer.from(normalized, "base64");
  if (buf.length !== 32) throw new Error("Invalid r_hash length (expected 32 bytes)");
  return buf.toString("hex");
}

export function hexToBase64(hex: string): string {
  if (!is32ByteHex(hex)) throw new Error("Invalid hex r_hash (expected 32 bytes)");
  return Buffer.from(hex, "hex").toString("base64");
}

export function normalizeProviderIdFromLnd(rHashB64: string): string {
  return base64ToHex(rHashB64);
}

export function providerIdToLndBase64(providerId: string): string {
  if (is32ByteHex(providerId)) return hexToBase64(providerId);
  const normalized = normalizeBase64(providerId);
  const buf = Buffer.from(normalized, "base64");
  if (buf.length !== 32) throw new Error("Invalid r_hash length (expected 32 bytes)");
  return normalized;
}
