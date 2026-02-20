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
  if (ctx.productTier === "basic") return BASIC_REASON;
  if (isAdvancedTier(ctx) && ctx.paymentsMode !== "node") return PAYMENTS_REASON;

  if (isAdvancedTier(ctx) && !ctx.namedReady) return ADVANCED_INACTIVE_REASON;

  return extra ? BASIC_REASON : BASIC_REASON;
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
