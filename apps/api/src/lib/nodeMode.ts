export type NodeMode = "basic" | "advanced" | "lan";

export type FeatureName = "public_share" | "derivatives" | "advanced_splits" | "multi_user";

function normalizeDbMode(raw: string | undefined): "basic" | "advanced" {
  const v = String(raw || "basic").trim().toLowerCase();
  return v === "advanced" ? "advanced" : "basic";
}

function envBool(value: string | undefined): boolean {
  const v = String(value || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function getNodeMode(): NodeMode {
  if (envBool(process.env.CONTENTBOX_LAN)) return "lan";
  const dbMode = normalizeDbMode(process.env.DB_MODE);
  return dbMode === "advanced" ? "advanced" : "basic";
}

export function canPublicShare(mode: NodeMode): boolean {
  return mode === "advanced";
}

export function canDerivatives(mode: NodeMode): boolean {
  return mode === "advanced" || mode === "lan";
}

export function canAdvancedSplits(mode: NodeMode): boolean {
  return mode === "advanced" || mode === "lan";
}

export function canMultiUser(mode: NodeMode): boolean {
  return mode === "lan";
}

export function lockReason(feature: FeatureName, mode: NodeMode): string {
  if (feature === "public_share") {
    return mode === "lan"
      ? "Public sharing is disabled in LAN mode."
      : "Public sharing is disabled in Basic (Trial).";
  }
  if (feature === "derivatives") {
    return "Derivatives require Advanced or LAN mode.";
  }
  if (feature === "advanced_splits") {
    return "Splits and royalties require Advanced or LAN mode.";
  }
  if (feature === "multi_user") {
    return mode === "advanced"
      ? "Advanced nodes are single-identity. Use LAN mode for multi-user."
      : "Multi-user requires LAN mode.";
  }
  return "Feature unavailable in this mode.";
}

export function getFeatureMatrix(mode: NodeMode) {
  return {
    publicShare: canPublicShare(mode),
    derivatives: canDerivatives(mode),
    advancedSplits: canAdvancedSplits(mode),
    multiUser: canMultiUser(mode)
  };
}

export function shouldBlockAdditionalUser(
  mode: NodeMode,
  allowMultiUser: boolean,
  hasOtherUsers: boolean
) {
  if (allowMultiUser) return false;
  if (mode === "advanced" && hasOtherUsers) return true;
  return false;
}
