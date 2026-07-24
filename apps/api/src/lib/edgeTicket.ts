import crypto from "node:crypto";

type EdgeTicketClaims = {
  mh: string;
  fid: string;
  ok?: string;
  exp: number;
  b?: string;
  sid?: string;
};

function b64urlEncode(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64url");
}

export function mintEdgeTicketToken(claims: EdgeTicketClaims, secret: string): string {
  const payload = {
    mh: String(claims?.mh || "").trim(),
    fid: String(claims?.fid || "").trim(),
    ...(claims?.ok ? { ok: String(claims.ok).trim() } : {}),
    exp: Math.max(1, Math.floor(Number(claims?.exp || 0))),
    ...(claims?.b ? { b: String(claims.b).trim() } : {}),
    ...(claims?.sid ? { sid: String(claims.sid).trim() } : {})
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", String(secret || "")).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}
