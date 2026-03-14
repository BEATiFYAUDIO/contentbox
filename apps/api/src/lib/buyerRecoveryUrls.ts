type BuyerRecoveryInput = {
  canonicalOrigin: string;
  creatorId?: string | null;
  contentId?: string | null;
  paymentId?: string | null;
  receiptToken?: string | null;
  entitlementId?: string | null;
  libraryToken?: string | null;
};

function normalizeOrigin(origin: string): string {
  return String(origin || "").trim().replace(/\/+$/, "");
}

function joinOrigin(base: string, routePath: string): string {
  const b = normalizeOrigin(base);
  const p = String(routePath || "").trim();
  if (!b) return p;
  if (!p) return b;
  if (/^https?:\/\//i.test(p)) return p;
  return `${b}${p.startsWith("/") ? p : `/${p}`}`;
}

export type BuyerRecoveryUrls = {
  canonicalCommerceOrigin: string;
  buyUrl: string | null;
  receiptUrl: string | null;
  receiptStatusUrl: string | null;
  libraryUrl: string | null;
  replayUrl: string | null;
};

export function buildCanonicalBuyerRecoveryUrls(input: BuyerRecoveryInput): BuyerRecoveryUrls {
  const canonicalOrigin = normalizeOrigin(input.canonicalOrigin);
  const creatorId = String(input.creatorId || "").trim() || null;
  const contentId = String(input.contentId || "").trim() || null;
  const paymentId = String(input.paymentId || "").trim() || null;
  const receiptToken = String(input.receiptToken || "").trim() || null;
  const entitlementId = String(input.entitlementId || "").trim() || null;
  const libraryToken = String(input.libraryToken || receiptToken || "").trim() || null;
  const scopedBase = creatorId ? `/c/${encodeURIComponent(creatorId)}` : "";
  const buyPath = contentId ? `${scopedBase}/buy/${encodeURIComponent(contentId)}` : null;
  const receiptPath = paymentId
    ? `${scopedBase}/receipt/${encodeURIComponent(paymentId)}`
    : receiptToken
      ? `${scopedBase}/receipt/${encodeURIComponent(receiptToken)}`
      : null;
  const receiptStatusPath = receiptToken
    ? `${scopedBase}/buy/receipts/${encodeURIComponent(receiptToken)}/status`
    : paymentId
      ? `${scopedBase}/buy/receipts/${encodeURIComponent(paymentId)}/status`
      : null;
  const libraryPath = libraryToken
    ? `${scopedBase}/library/${encodeURIComponent(libraryToken)}`
    : `${scopedBase}/library`;
  const replayPath = entitlementId ? `${scopedBase}/replay/${encodeURIComponent(entitlementId)}` : null;

  return {
    canonicalCommerceOrigin: canonicalOrigin,
    buyUrl: buyPath ? joinOrigin(canonicalOrigin, buyPath) : null,
    receiptStatusUrl: receiptStatusPath ? joinOrigin(canonicalOrigin, receiptStatusPath) : null,
    receiptUrl: receiptPath ? joinOrigin(canonicalOrigin, receiptPath) : null,
    libraryUrl: joinOrigin(canonicalOrigin, libraryPath),
    replayUrl: replayPath ? joinOrigin(canonicalOrigin, replayPath) : null
  };
}
