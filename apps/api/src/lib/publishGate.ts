import type { CapabilityContext } from "./capabilities.js";

export type PublishKind = "share_link" | "public_buy_link";

export type PublishIntent = {
  publishKind: PublishKind;
  forSale: boolean;
};

export type PublishState = {
  isDerivative: boolean;
  clearanceCleared: boolean;
  splitLocked: boolean;
  targetLocked: boolean;
  paymentsReady: boolean;
};

export type PublishGateResult = {
  publishKind: PublishKind;
};

export type PublishGateError = {
  code: string;
  reason: string;
};

const ADVANCED_INACTIVE_REASON = "Advanced requires a permanent named link to activate sovereign features.";
const BASIC_SHARE_ONLY_REASON = "Basic can only create share links. Public publishing requires Advanced.";
const DERIVATIVE_ADVANCED_REASON = "Derivatives require Advanced mode and clearance before publishing.";
const PAYMENTS_REASON = "Local node payments must be configured to use this feature.";
const WALLET_REASON = "A wallet receive endpoint is required to publish for sale.";
const SPLIT_LOCK_REASON = "Split must be locked before publishing.";
const TARGET_LOCK_REASON = "Target must be locked before publishing.";

function isAdvancedActive(ctx: CapabilityContext): boolean {
  if (ctx.productTier !== "advanced") return true;
  return ctx.namedReady;
}

function isLan(ctx: CapabilityContext): boolean {
  return ctx.productTier === "lan";
}

export function assertCanPublish(ctx: CapabilityContext, intent: PublishIntent, state: PublishState): PublishGateResult {
  if (ctx.productTier === "advanced" && !isAdvancedActive(ctx)) {
    throw { code: "advanced_not_active", reason: ADVANCED_INACTIVE_REASON } satisfies PublishGateError;
  }

  if (state.isDerivative) {
    if (ctx.productTier !== "advanced" && !isLan(ctx)) {
      throw { code: "derivative_requires_advanced_clearance", reason: DERIVATIVE_ADVANCED_REASON } satisfies PublishGateError;
    }
    if (!state.clearanceCleared) {
      throw { code: "derivative_requires_advanced_clearance", reason: DERIVATIVE_ADVANCED_REASON } satisfies PublishGateError;
    }
  }

  if (ctx.productTier === "basic") {
    if (intent.publishKind !== "share_link") {
      throw { code: "basic_share_link_only", reason: BASIC_SHARE_ONLY_REASON } satisfies PublishGateError;
    }
    if (intent.forSale && !state.paymentsReady) {
      throw { code: "wallet_not_configured", reason: WALLET_REASON } satisfies PublishGateError;
    }
    return { publishKind: intent.publishKind };
  }

  if (ctx.productTier === "advanced") {
    if (intent.publishKind !== "public_buy_link") {
      throw { code: "advanced_public_only", reason: BASIC_SHARE_ONLY_REASON } satisfies PublishGateError;
    }
    if (!state.targetLocked) {
      throw { code: "target_not_locked", reason: TARGET_LOCK_REASON } satisfies PublishGateError;
    }
    if (!state.splitLocked) {
      throw { code: "split_not_locked", reason: SPLIT_LOCK_REASON } satisfies PublishGateError;
    }
    if (ctx.paymentsMode !== "node" || (intent.forSale && !state.paymentsReady)) {
      throw { code: "payments_not_configured", reason: PAYMENTS_REASON } satisfies PublishGateError;
    }
    return { publishKind: intent.publishKind };
  }

  // LAN: allow all actions regardless of namedReady
  if (intent.forSale && ctx.paymentsMode !== "node" && !state.paymentsReady) {
    throw { code: "payments_not_configured", reason: PAYMENTS_REASON } satisfies PublishGateError;
  }
  return { publishKind: intent.publishKind };
}

export const publishGateReasons = {
  ADVANCED_INACTIVE_REASON,
  BASIC_SHARE_ONLY_REASON,
  DERIVATIVE_ADVANCED_REASON
};

export type PublishGateInput = {
  productTier?: ProductTier;
  namedReady?: boolean;
  paymentsMode?: PaymentsMode;
  publishKind?: PublishKind;
  isDerivative?: boolean;
  clearanceCleared?: boolean;
  forSale?: boolean;
  paymentsReady?: boolean;
  splitLocked?: boolean;
  targetLocked?: boolean;
};

export function evaluatePublishGate(input: PublishGateInput) {
  const productTier = (input.productTier || "basic") as ProductTier;
  const namedReady = Boolean(input.namedReady);
  const paymentsMode = (input.paymentsMode || "wallet") as PaymentsMode;
  const publishKind = (input.publishKind || "share_link") as PublishKind;
  const isDerivative = Boolean(input.isDerivative);
  const clearanceCleared = Boolean(input.clearanceCleared);
  const forSale = Boolean(input.forSale);
  const paymentsReady = Boolean(input.paymentsReady);
  const splitLocked = Boolean(input.splitLocked);
  const targetLocked = Boolean(input.targetLocked);

  const ctx: CapabilityContext = { productTier, namedReady, paymentsMode };
  const state: PublishState = {
    isDerivative,
    clearanceCleared,
    splitLocked,
    targetLocked,
    paymentsReady
  };

  return assertCanPublish(ctx, { publishKind, forSale }, state);
}
