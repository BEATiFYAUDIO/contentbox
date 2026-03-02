import crypto from "node:crypto";

type BuyerSessionClaims = {
  v: 1;
  sid: string;
  exp: number;
};

function b64urlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64url");
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(String(input || ""), "base64url");
}

function signature(secret: string, payloadB64: string): string {
  return b64urlEncode(crypto.createHmac("sha256", secret).update(payloadB64).digest());
}

function safeEq(a: string, b: string): boolean {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function createBuyerSessionToken(sessionId: string, secret: string, expMs: number): string {
  const sid = String(sessionId || "").trim();
  if (!sid) throw new Error("session id required");
  const claims: BuyerSessionClaims = {
    v: 1,
    sid,
    exp: Math.max(Date.now() + 1_000, Math.floor(Number(expMs || 0)))
  };
  const payloadB64 = b64urlEncode(JSON.stringify(claims));
  const sigB64 = signature(String(secret || ""), payloadB64);
  return `${payloadB64}.${sigB64}`;
}

export function verifyBuyerSessionToken(
  token: string | null | undefined,
  secret: string
): { sid: string; exp: number } | null {
  try {
    const raw = String(token || "").trim();
    if (!raw) return null;
    const parts = raw.split(".");
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts;
    if (!payloadB64 || !sigB64) return null;
    const expected = signature(String(secret || ""), payloadB64);
    if (!safeEq(sigB64, expected)) return null;
    const parsed = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as BuyerSessionClaims;
    if (!parsed || parsed.v !== 1) return null;
    if (!parsed.sid || typeof parsed.sid !== "string") return null;
    if (!Number.isFinite(parsed.exp)) return null;
    if (Date.now() >= parsed.exp) return null;
    return { sid: parsed.sid, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function resolveBuyerSessionIdFromToken(token: string | null | undefined, secret: string): string | null {
  return verifyBuyerSessionToken(token, secret)?.sid || null;
}
