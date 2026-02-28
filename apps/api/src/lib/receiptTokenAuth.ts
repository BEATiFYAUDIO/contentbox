import crypto from "node:crypto";

type ReqLike = {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

type IntentLike = {
  receiptToken?: string | null;
  receiptTokenExpiresAt?: Date | string | null;
};

function toToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function isHexToken(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value) && value.length > 0;
}

export function readReceiptTokenFromRequest(req: ReqLike): string {
  const h = req?.headers?.["x-receipt-token"];
  const headerToken = Array.isArray(h) ? toToken(h[0]) : toToken(h);
  if (headerToken) return headerToken;
  return toToken(req?.query?.receiptToken);
}

export function timingSafeReceiptTokenEqual(expectedRaw: string | null | undefined, actualRaw: string | null | undefined): boolean {
  const expected = toToken(expectedRaw).toLowerCase();
  const actual = toToken(actualRaw).toLowerCase();
  if (!isHexToken(expected) || !isHexToken(actual)) return false;
  if (expected.length !== actual.length) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function authorizeIntentByReceiptToken(req: ReqLike, intent: IntentLike, nowMs = Date.now()): boolean {
  const provided = readReceiptTokenFromRequest(req);
  if (!provided) return false;
  const expected = toToken(intent?.receiptToken);
  if (!expected) return false;
  if (!timingSafeReceiptTokenEqual(expected, provided)) return false;
  const expires = intent?.receiptTokenExpiresAt ? new Date(intent.receiptTokenExpiresAt).getTime() : null;
  if (typeof expires === "number" && Number.isFinite(expires) && expires <= nowMs) return false;
  return true;
}

