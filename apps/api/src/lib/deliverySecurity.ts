import path from "node:path";

const SENSITIVE_QUERY_KEYS = new Set(["t", "token", "receiptToken", "share"]);

export function redactSensitiveUrl(raw: unknown): string {
  const value = String(raw || "");
  if (!value) return value;
  try {
    const parsed = new URL(value, "http://contentbox.local");
    for (const key of SENSITIVE_QUERY_KEYS) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[redacted]");
    }
    const path = `${parsed.pathname}${parsed.search || ""}${parsed.hash || ""}`;
    return value.startsWith("http://") || value.startsWith("https://") ? parsed.toString() : path;
  } catch {
    return value.replace(/([?&](?:t|token|receiptToken|share)=)[^&\s]+/gi, "$1[redacted]");
  }
}

export function isPaidFullDeliverySessionAuthorized(input: {
  paidContent: boolean;
  access: "preview" | "full";
  tokenBuyerSessionId?: string | null;
  requestBuyerSessionId?: string | null;
}): boolean {
  if (!input.paidContent || input.access !== "full") return true;
  const tokenBuyerSessionId = String(input.tokenBuyerSessionId || "").trim();
  const requestBuyerSessionId = String(input.requestBuyerSessionId || "").trim();
  return Boolean(tokenBuyerSessionId && requestBuyerSessionId && tokenBuyerSessionId === requestBuyerSessionId);
}

export type DeliveryObjectKeyResult =
  | { ok: true; objectKey: string }
  | { ok: false; reason: string };

export function normalizeDeliveryObjectKey(raw: unknown): DeliveryObjectKeyResult {
  const objectKey = String(raw || "").trim();
  if (!objectKey) return { ok: false, reason: "empty_object_key" };
  if (objectKey.includes("\0")) return { ok: false, reason: "nul_byte" };
  if (objectKey.includes("\\")) return { ok: false, reason: "backslash_separator" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(objectKey)) return { ok: false, reason: "absolute_url" };
  if (objectKey.startsWith("/")) return { ok: false, reason: "absolute_path" };
  if (objectKey.includes("//")) return { ok: false, reason: "duplicate_slash" };
  if (/%(?:2f|5c)/i.test(objectKey)) return { ok: false, reason: "encoded_separator" };

  const parts = objectKey.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return { ok: false, reason: "path_traversal" };
  }

  const normalized = path.posix.normalize(objectKey);
  if (normalized !== objectKey || normalized.startsWith("../") || normalized === "..") {
    return { ok: false, reason: "normalization_mismatch" };
  }
  return { ok: true, objectKey: normalized };
}

export function resolveDeliveryPath(repoRootRaw: unknown, objectKeyRaw: unknown): { ok: true; absPath: string; objectKey: string } | { ok: false; reason: string } {
  const normalized = normalizeDeliveryObjectKey(objectKeyRaw);
  if (!normalized.ok) return normalized;
  const repoRoot = path.resolve(String(repoRootRaw || ""));
  if (!repoRoot) return { ok: false, reason: "missing_repo_root" };
  const absPath = path.resolve(repoRoot, normalized.objectKey);
  if (absPath !== repoRoot && !absPath.startsWith(`${repoRoot}${path.sep}`)) {
    return { ok: false, reason: "path_escape" };
  }
  return { ok: true, absPath, objectKey: normalized.objectKey };
}

export function evaluatePublicMediaDelivery(input: {
  paidContent: boolean;
  freeContent: boolean;
  deliveryAccess?: "preview" | "full" | null;
  isPublicPreviewAsset: boolean;
  isPublicCoverAsset: boolean;
}): { ok: true; mode: "preview" | "full" } | { ok: false; status: 402 | 403 | 404; code: string } {
  const deliveryAccess = input.deliveryAccess || null;
  if (deliveryAccess === "preview") {
    return { ok: true, mode: "preview" };
  }
  const mode: "preview" | "full" =
    deliveryAccess === "full" || (!deliveryAccess && input.freeContent) || input.isPublicCoverAsset
      ? "full"
      : "preview";
  if (input.paidContent && mode !== "full" && !input.isPublicPreviewAsset && !input.isPublicCoverAsset) {
    return { ok: false, status: 402, code: "PAYMENT_REQUIRED" };
  }
  if (mode === "preview" && !input.isPublicPreviewAsset && !input.isPublicCoverAsset) {
    return { ok: false, status: 404, code: "PREVIEW_ASSET_REQUIRED" };
  }
  return { ok: true, mode };
}

export function validatePublicDeliveryTokenClaims(
  claims: unknown,
  expected: {
    contentId: string;
    objectKey: string;
    paidContent: boolean;
    requiredAccess?: "preview" | "full" | null;
    requestBuyerSessionId?: string | null;
  }
): { ok: true; access: "preview" | "full" } | { ok: false; reason: string } {
  const decoded = claims as {
    scope?: string;
    contentId?: string;
    objectKey?: string;
    access?: string;
    buyerSessionId?: string | null;
  } | null;
  if (!decoded || decoded.scope !== "public_delivery") return { ok: false, reason: "invalid_scope" };
  const objectKey = normalizeDeliveryObjectKey(expected.objectKey);
  if (!objectKey.ok) return { ok: false, reason: "invalid_expected_object_key" };
  if (String(decoded.contentId || "") !== expected.contentId) return { ok: false, reason: "content_mismatch" };
  if (String(decoded.objectKey || "") !== objectKey.objectKey) return { ok: false, reason: "object_key_mismatch" };
  const access = decoded.access === "full" ? "full" : decoded.access === "preview" ? "preview" : null;
  if (!access) return { ok: false, reason: "invalid_access" };
  if (expected.requiredAccess && access !== expected.requiredAccess) return { ok: false, reason: "access_mismatch" };
  if (!isPaidFullDeliverySessionAuthorized({
    paidContent: expected.paidContent,
    access,
    tokenBuyerSessionId: decoded.buyerSessionId || null,
    requestBuyerSessionId: expected.requestBuyerSessionId || null
  })) {
    return { ok: false, reason: "session_mismatch" };
  }
  return { ok: true, access };
}
