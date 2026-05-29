export type FreeContentInput = {
  priceSats?: bigint | number | string | null | undefined;
  priceCents?: bigint | number | string | null | undefined;
  price?: bigint | number | string | null | undefined;
  offerPrice?: bigint | number | string | null | undefined;
  amount?: bigint | number | string | null | undefined;
  isFree?: boolean | null | undefined;
  free?: boolean | null | undefined;
  access?: string | null | undefined;
  unlockRequired?: boolean | null | undefined;
  requiresUnlock?: boolean | null | undefined;
};

function toBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^-?\d+$/.test(trimmed)) return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

export function isFreeContent(content: FreeContentInput | null | undefined): boolean {
  if (!content) return false;

  const access = String(content.access || "").trim().toLowerCase();
  if (content.isFree === true || content.free === true || access === "free") return true;
  if (content.unlockRequired === false || content.requiresUnlock === false) return true;

  const priceSignals = [
    toBigIntOrNull(content.priceSats),
    toBigIntOrNull(content.priceCents),
    toBigIntOrNull(content.price),
    toBigIntOrNull(content.offerPrice),
    toBigIntOrNull(content.amount)
  ].filter((v): v is bigint => v !== null);

  if (priceSignals.some((v) => v > 0n)) return false;
  if (priceSignals.some((v) => v <= 0n)) return true;

  // Missing price is NOT implicitly free without an explicit free marker.
  return false;
}

export function hasFullAccess(input: {
  isFree: boolean;
  hasUnlock: boolean;
  hasCreatorPermission?: boolean;
  hasAdminPermission?: boolean;
}): boolean {
  return Boolean(input.isFree || input.hasUnlock || input.hasCreatorPermission || input.hasAdminPermission);
}

export function shouldShowPreview(input: {
  isFree: boolean;
  priceSats?: bigint | number | string | null | undefined;
  hasFullAccess: boolean;
  hasPreviewAsset: boolean;
}): boolean {
  const price = toBigIntOrNull(input.priceSats) ?? 0n;
  return Boolean(!input.isFree && price > 0n && !input.hasFullAccess && input.hasPreviewAsset);
}
