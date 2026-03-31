import type { NodeMode } from "./nodeMode.js";
import type { PaymentsMode, ProductTier } from "./productTier.js";

export type CapabilityContext = {
  productTier: ProductTier;
  namedReady: boolean;
  paymentsMode: PaymentsMode;
  nodeMode?: NodeMode;
  providerConfigured?: boolean;
  providerTrusted?: boolean;
};

export type CapabilitySet = {
  useSplits: boolean;
  useDerivatives: boolean;
  sendInvite: boolean;
  lockSplits: boolean;
  publish: boolean;
  publishToNetwork: boolean;
  publishToDiscovery: boolean;
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
  | "publish_network"
  | "publish_discovery"
  | "clearance"
  | "public_share"
  | "proofs";

export type CapabilityReasonContext = {
  namedMode?: string | null;
  namedStatus?: string | null;
};

const BASIC_REASON = "This feature is not available in the Basic edition.";
const PAYMENTS_REASON = "Local node payments must be configured to use this feature.";
const ADVANCED_INACTIVE_REASON =
  "Sovereign creator mode requires either a trusted provider connection or a canonical public origin.";
const ADVANCED_PROVIDER_PENDING_REASON =
  "Provider is configured but not trusted/reachable yet. Verify provider or bring your canonical public origin online.";
const SPLITS_REASON = "Splits and royalties require Advanced or LAN mode.";
const DERIVATIVES_REASON = "Derivatives require Advanced or LAN mode.";
const INVITE_REASON = "Split invites require Advanced or LAN mode.";
const LOCK_REASON = "Locking split proofs requires Advanced or LAN mode.";
const CLEARANCE_REASON = "Clearance requests require Advanced or LAN mode.";
const PUBLIC_SHARE_REASON = "Provider-node public sharing requires a canonical public origin and local node payments.";
const PROOFS_REASON = "Proof bundles require Advanced or LAN mode.";

function isAdvancedTier(ctx: CapabilityContext) {
  return ctx.productTier === "advanced";
}

function isLanTier(ctx: CapabilityContext) {
  return ctx.productTier === "lan";
}

export function isAdvancedActive(ctx: CapabilityContext) {
  if (ctx.productTier !== "advanced") return true;
  return Boolean(ctx.namedReady || ctx.providerTrusted);
}

export function canActAsSovereignCreator(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  return isAdvancedActive(ctx);
}

export function canPublishViaProvider(ctx: CapabilityContext): boolean {
  return ctx.productTier === "advanced" && Boolean(ctx.providerTrusted);
}

export function canUseProviderBackedCommerce(ctx: CapabilityContext): boolean {
  return Boolean(ctx.providerTrusted);
}

export function canActAsProviderNode(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  return Boolean(ctx.namedReady && hasNodePayments(ctx));
}

function hasNodePayments(ctx: CapabilityContext) {
  if (ctx.productTier === "basic") return true;
  return ctx.paymentsMode === "node";
}

export function canUseSplits(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!canActAsSovereignCreator(ctx)) return false;
  return hasNodePayments(ctx);
}

export function canUseDerivatives(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!canActAsSovereignCreator(ctx)) return false;
  return hasNodePayments(ctx);
}

export function canSendInvite(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!canActAsSovereignCreator(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canLock(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!canActAsSovereignCreator(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canPublish(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return true;
  if (isLanTier(ctx)) return true;
  if (!canActAsSovereignCreator(ctx)) return false;
  if (hasNodePayments(ctx)) return true;
  if (!canPublishViaProvider(ctx)) return false;
  return true;
}

export function canPublishToNetwork(ctx: CapabilityContext): boolean {
  return canPublish(ctx);
}

export function canPublishToDiscovery(ctx: CapabilityContext): boolean {
  return canPublicShare(ctx);
}

export function canRequestClearance(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!canActAsSovereignCreator(ctx)) return false;
  if (!hasNodePayments(ctx)) return false;
  return true;
}

export function canPublicShare(ctx: CapabilityContext): boolean {
  return canActAsProviderNode(ctx);
}

export function canUseProofBundles(ctx: CapabilityContext): boolean {
  if (ctx.productTier === "basic") return false;
  if (isLanTier(ctx)) return true;
  if (!canActAsSovereignCreator(ctx)) return false;
  return hasNodePayments(ctx);
}

function sovereignCreatorReason(ctx: CapabilityContext): string {
  if (ctx.productTier !== "advanced") return ADVANCED_INACTIVE_REASON;
  if (ctx.providerConfigured && !ctx.providerTrusted) return ADVANCED_PROVIDER_PENDING_REASON;
  return ADVANCED_INACTIVE_REASON;
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
      case "publish_network":
      default:
        return BASIC_REASON;
      case "publish_discovery":
        return PUBLIC_SHARE_REASON;
    }
  }
  const requiresLocalNodePayments =
    key === "splits" ||
    key === "derivatives" ||
    key === "invite" ||
    key === "lock" ||
    key === "clearance" ||
    key === "proofs";
  if (isAdvancedTier(ctx) && ctx.paymentsMode !== "node" && requiresLocalNodePayments) return PAYMENTS_REASON;

  if (isAdvancedTier(ctx) && !canActAsSovereignCreator(ctx)) return sovereignCreatorReason(ctx);
  if ((key === "public_share" || key === "publish_discovery") && !canActAsProviderNode(ctx)) return PUBLIC_SHARE_REASON;
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
    case "publish_discovery":
      return PUBLIC_SHARE_REASON;
    case "publish_network":
      return sovereignCreatorReason(ctx);
    case "proofs":
      return PROOFS_REASON;
    case "publish":
    default:
      return "Feature unavailable in this mode.";
  }
}

export function buildCapabilitySet(ctx: CapabilityContext): CapabilitySet {
  const publishToNetwork = canPublishToNetwork(ctx);
  const publishToDiscovery = canPublishToDiscovery(ctx);
  return {
    useSplits: canUseSplits(ctx),
    useDerivatives: canUseDerivatives(ctx),
    sendInvite: canSendInvite(ctx),
    lockSplits: canLock(ctx),
    publish: publishToNetwork,
    publishToNetwork,
    publishToDiscovery,
    requestClearance: canRequestClearance(ctx),
    publicShare: publishToDiscovery,
    proofBundles: canUseProofBundles(ctx)
  };
}

export type SovereignCapabilityMatrix = {
  canActAsSovereignCreator: boolean;
  canPublishViaProvider: boolean;
  canUseProviderBackedCommerce: boolean;
  canActAsProviderNode: boolean;
};

export function buildSovereignCapabilityMatrix(ctx: CapabilityContext): SovereignCapabilityMatrix {
  return {
    canActAsSovereignCreator: canActAsSovereignCreator(ctx),
    canPublishViaProvider: canPublishViaProvider(ctx),
    canUseProviderBackedCommerce: canUseProviderBackedCommerce(ctx),
    canActAsProviderNode: canActAsProviderNode(ctx)
  };
}
