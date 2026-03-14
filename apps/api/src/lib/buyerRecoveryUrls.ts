type BuyerRecoveryInput = {
  canonicalOrigin: string;
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
  const contentId = String(input.contentId || "").trim() || null;
  const paymentId = String(input.paymentId || "").trim() || null;
  const receiptToken = String(input.receiptToken || "").trim() || null;
  const entitlementId = String(input.entitlementId || "").trim() || null;
  const libraryToken = String(input.libraryToken || receiptToken || "").trim() || null;

  return {
    canonicalCommerceOrigin: canonicalOrigin,
    buyUrl: contentId ? joinOrigin(canonicalOrigin, `/buy/${encodeURIComponent(contentId)}`) : null,
    receiptStatusUrl: receiptToken
      ? joinOrigin(canonicalOrigin, `/buy/receipts/${encodeURIComponent(receiptToken)}/status`)
      : paymentId
        ? joinOrigin(canonicalOrigin, `/buy/receipts/${encodeURIComponent(paymentId)}/status`)
        : null,
    receiptUrl: paymentId
      ? joinOrigin(canonicalOrigin, `/receipt/${encodeURIComponent(paymentId)}`)
      : receiptToken
        ? joinOrigin(canonicalOrigin, `/receipt/${encodeURIComponent(receiptToken)}`)
        : null,
    libraryUrl: libraryToken
      ? joinOrigin(canonicalOrigin, `/library/${encodeURIComponent(libraryToken)}`)
      : joinOrigin(canonicalOrigin, "/library"),
    replayUrl: entitlementId ? joinOrigin(canonicalOrigin, `/replay/${encodeURIComponent(entitlementId)}`) : null
  };
}
