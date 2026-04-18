export type PublicOriginExposureInput = {
  canonicalBuyerOrigin?: string | null;
  canonicalCommerceOrigin?: string | null;
  durableBuyerReady: boolean;
  durableBuyerReasons?: string[] | null;
  ownershipConflictPersistent: boolean;
};

export type PublicOriginExposure = {
  canonicalBuyerOrigin: string | null;
  canonicalCommerceOrigin: string | null;
  blocked: boolean;
  blockedReason: string | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

export function computePublicOriginExposure(input: PublicOriginExposureInput): PublicOriginExposure {
  const canonicalBuyerOrigin = asString(input.canonicalBuyerOrigin || "") || null;
  const canonicalCommerceOrigin = asString(input.canonicalCommerceOrigin || "") || null;
  const reasons = Array.isArray(input.durableBuyerReasons) ? input.durableBuyerReasons : [];

  if (input.ownershipConflictPersistent) {
    return {
      canonicalBuyerOrigin: null,
      canonicalCommerceOrigin: null,
      blocked: true,
      blockedReason: "PERSISTENT_TUNNEL_OWNERSHIP_CONFLICT"
    };
  }

  if (!input.durableBuyerReady && reasons.includes("TUNNEL_OWNERSHIP_CONFLICT_PERSISTENT")) {
    return {
      canonicalBuyerOrigin: null,
      canonicalCommerceOrigin: null,
      blocked: true,
      blockedReason: "PERSISTENT_TUNNEL_OWNERSHIP_CONFLICT"
    };
  }

  return {
    canonicalBuyerOrigin,
    canonicalCommerceOrigin,
    blocked: false,
    blockedReason: null
  };
}
