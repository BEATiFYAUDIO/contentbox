import type { NodeMode } from "./nodeMode.js";
import type { PaymentsMode, ProductTier } from "./productTier.js";

export type CapabilityContext = {
  productTier: ProductTier;
  namedReady: boolean;
  paymentsMode: PaymentsMode;
  nodeMode?: NodeMode;
};

export type CapabilitySet = {
  useSplits: boolean;
  useDerivatives: boolean;
  sendInvite: boolean;
  lockSplits: boolean;
  publish: boolean;
  requestClearance: boolean;
  publicShare: boolean;
  proofBundles: boolean;
};

export type CapabilityReasonKey =
  | "splits"
  | "derivatives"
  | "invite"
  | "lock"
  | "publish"
  | "clearance"
  | "public_share"
  | "proofs";

export type CapabilityReasonContext = {
  namedMode?: string | null;
  namedStatus?: string | null;
};

const BASIC_REASON = "This feature is not available in the Basic edition.";
const PAYMENTS_REASON = "Local node payments must be configured to use this feature.";
const ADVANCED_INACTIVE_REASON = "Advanced requires a permanent named link to activate sovereign features.";
const SPLITS_REASON = "Splits and royalties require Advanced or LAN mode.";
const DERIVATIVES_REASON = "Derivatives require Advanced or LAN mode.";
const INVITE_REASON = "Split invites require Advanced or LAN mode.";
const LOCK_REASON = "Locking split proofs requires Advanced or LAN mode.";
const CLEARANCE_REASON = "Clearance requests require Advanced or LAN mode.";
const PUBLIC_SHARE_REASON = "Public sharing requires Advanced mode with node payments.";
const PROOFS_REASON = "Proof bundles require Advanced or LAN mode.";

function isAdvancedTier(ctx: CapabilityContext) {
  return ctx.productTier === "advanced";
}

function isLanTier(ctx: CapabilityContext) {
  return ctx.productTier === "lan";
}

export function isAdvancedActive(ctx: CapabilityContext) {
  if (ctx.productTier !== "advanced") return true;
  return ctx.namedReady;
}

function hasNodePayments(ctx: CapabilityContext) {
  if (ctx.productTier === "basic") return true;
  return ctx.paymentsMode === "node";
}

export function canUseSplits(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  return hasNodePayments(ctx);
}

export function canUseDerivatives(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  return hasNodePayments(ctx);
}

export function canSendInvite(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canLock(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canPublish(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return true;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canRequestClearance(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canPublicShare(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canUseProofBundles(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!isAdvancedActive(ctx)) return false;
  return hasNodePayments(ctx);
}

export function capabilityReason(
  ctx: CapabilityContext,
  key: CapabilityReasonKey,
  extra?: CapabilityReasonContext
): string {
  if (ctx.productTier === "basic") {
    switch (key) {
      case "splits":
        return SPLITS_REASON;
      case "derivatives":
        return DERIVATIVES_REASON;
      case "invite":
        return INVITE_REASON;
      case "lock":
        return LOCK_REASON;
      case "clearance":
        return CLEARANCE_REASON;
      case "public_share":
        return PUBLIC_SHARE_REASON;
      case "proofs":
        return PROOFS_REASON;
      case "publish":
      default:
        return BASIC_REASON;
    }
  }
  if (isAdvancedTier(ctx) && ctx.paymentsMode !== "node") return PAYMENTS_REASON;

  if (isAdvancedTier(ctx) && !ctx.namedReady) return ADVANCED_INACTIVE_REASON;
  if (extra?.namedMode === "named" && extra?.namedStatus !== "online") return ADVANCED_INACTIVE_REASON;

  switch (key) {
    case "splits":
      return SPLITS_REASON;
    case "derivatives":
      return DERIVATIVES_REASON;
    case "invite":
      return INVITE_REASON;
    case "lock":
      return LOCK_REASON;
    case "clearance":
      return CLEARANCE_REASON;
    case "public_share":
      return PUBLIC_SHARE_REASON;
    case "proofs":
      return PROOFS_REASON;
    case "publish":
    default:
      return "Feature unavailable in this mode.";
  }
}

export function buildCapabilitySet(ctx: CapabilityContext): CapabilitySet {
  return {
    useSplits: canUseSplits(ctx),
    useDerivatives: canUseDerivatives(ctx),
    sendInvite: canSendInvite(ctx),
    lockSplits: canLock(ctx),
    publish: canPublish(ctx),
    requestClearance: canRequestClearance(ctx),
    publicShare: canPublicShare(ctx),
    proofBundles: canUseProofBundles(ctx)
  };
}
