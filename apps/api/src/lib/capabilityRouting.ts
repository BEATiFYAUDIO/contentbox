export type SelectedParticipationMode =
  | "basic_creator"
  | "sovereign_creator"
  | "sovereign_node_operator";

export type EffectiveParticipationMode =
  | "basic_creator"
  | "sovereign_creator_with_provider"
  | "sovereign_node_operator"
  | "sovereign_creator_unready";

export type ResolvedCapabilityName =
  | "preview"
  | "publish"
  | "commerce_host"
  | "buyer_recovery"
  | "replay_delivery"
  | "invoice_minting"
  | "settlement"
  | "payout";

export type ResolvedCapabilities = Record<ResolvedCapabilityName, boolean>;

export type CapabilityRoutingInput = {
  selectedParticipationMode: SelectedParticipationMode;
  stablePublicHostConfigured: boolean;
  temporaryEndpointActive: boolean;
  canonicalCommerceConfigured: boolean;
  lndReady: boolean;
  chainReady: boolean;
  replayReady: boolean;
  providerCapable: boolean;
  localPublishReady?: boolean;
  localCommerceHost: string | null;
  localSettlementHost: string | null;
  providerHost: string | null;
};

export type CapabilityRoutingResolution = {
  selectedParticipationMode: SelectedParticipationMode;
  effectiveParticipationMode: EffectiveParticipationMode;
  localCapabilities: ResolvedCapabilities;
  delegatedCapabilities: ResolvedCapabilityName[];
  readinessBlockers: string[];
  stablePublicHostConfigured: boolean;
  temporaryEndpointActive: boolean;
  canonicalCommerceConfigured: boolean;
  lndReady: boolean;
  chainReady: boolean;
  replayReady: boolean;
  effectiveCommerceHost: string | null;
  effectiveSettlementHost: string | null;
  effectiveBuyerRecoveryHost: string | null;
};

const SOVEREIGN_HOST_CAPABILITIES: ResolvedCapabilityName[] = [
  "commerce_host",
  "buyer_recovery",
  "replay_delivery"
];

const SOVEREIGN_PAYMENT_CAPABILITIES: ResolvedCapabilityName[] = [
  "invoice_minting",
  "settlement",
  "payout"
];

function addBlocker(blockers: string[], value: string) {
  if (!blockers.includes(value)) blockers.push(value);
}

export function resolveCapabilityRouting(input: CapabilityRoutingInput): CapabilityRoutingResolution {
  const basicSelected = input.selectedParticipationMode === "basic_creator";
  const localCapabilities: ResolvedCapabilities = {
    preview: true,
    publish: input.localPublishReady !== false,
    commerce_host: !basicSelected && input.stablePublicHostConfigured && input.canonicalCommerceConfigured,
    buyer_recovery: !basicSelected && input.stablePublicHostConfigured && input.canonicalCommerceConfigured,
    replay_delivery: !basicSelected && input.replayReady,
    invoice_minting: !basicSelected && input.lndReady,
    settlement: !basicSelected && input.lndReady && input.chainReady,
    payout: !basicSelected && input.lndReady && input.chainReady
  };

  const delegatedCapabilities: ResolvedCapabilityName[] = [];
  const readinessBlockers: string[] = [];
  const missingSovereignNodeCapabilities = [...SOVEREIGN_HOST_CAPABILITIES, ...SOVEREIGN_PAYMENT_CAPABILITIES]
    .filter((name) => !localCapabilities[name]);

  if (!input.stablePublicHostConfigured) {
    addBlocker(readinessBlockers, "Stable public host not configured.");
  }
  if (input.temporaryEndpointActive) {
    addBlocker(
      readinessBlockers,
      "Temporary endpoint active. Preview/testing only; durable commerce requires a stable public host."
    );
  }
  if (!input.canonicalCommerceConfigured) {
    addBlocker(readinessBlockers, "Canonical commerce host is not configured.");
  }
  if (!input.lndReady) {
    addBlocker(readinessBlockers, "LND is not ready.");
  }
  if (!input.chainReady) {
    addBlocker(readinessBlockers, "Chain/backend is not ready.");
  }
  if (!input.replayReady) {
    addBlocker(readinessBlockers, "Replay delivery path is not ready.");
  }

  let effectiveParticipationMode: EffectiveParticipationMode = "basic_creator";

  if (input.selectedParticipationMode === "basic_creator") {
    effectiveParticipationMode = "basic_creator";
  } else if (input.selectedParticipationMode === "sovereign_node_operator") {
    if (missingSovereignNodeCapabilities.length === 0) {
      effectiveParticipationMode = "sovereign_node_operator";
    } else if (input.providerCapable) {
      delegatedCapabilities.push(...missingSovereignNodeCapabilities);
      effectiveParticipationMode = "sovereign_creator_with_provider";
    } else {
      effectiveParticipationMode = "sovereign_creator_unready";
      addBlocker(
        readinessBlockers,
        "No capable delegated node is configured for missing sovereign infrastructure."
      );
    }
  } else {
    const providerBackedCapabilities = [...SOVEREIGN_HOST_CAPABILITIES, ...SOVEREIGN_PAYMENT_CAPABILITIES];
    if (input.providerCapable) {
      delegatedCapabilities.push(...providerBackedCapabilities);
      effectiveParticipationMode = "sovereign_creator_with_provider";
    } else {
      effectiveParticipationMode = "sovereign_creator_unready";
      addBlocker(
        readinessBlockers,
        "Provider-backed infrastructure is required for Sovereign Creator mode."
      );
    }
  }

  const effectiveCommerceHost = localCapabilities.commerce_host
    ? input.localCommerceHost
    : delegatedCapabilities.includes("commerce_host")
      ? input.providerHost
      : null;
  const effectiveBuyerRecoveryHost = localCapabilities.buyer_recovery
    ? input.localCommerceHost
    : delegatedCapabilities.includes("buyer_recovery")
      ? input.providerHost
      : null;
  const effectiveSettlementHost = localCapabilities.settlement
    ? input.localSettlementHost || input.localCommerceHost
    : delegatedCapabilities.some((name) =>
        name === "invoice_minting" || name === "settlement" || name === "payout")
      ? input.providerHost
      : null;

  return {
    selectedParticipationMode: input.selectedParticipationMode,
    effectiveParticipationMode,
    localCapabilities,
    delegatedCapabilities,
    readinessBlockers,
    stablePublicHostConfigured: input.stablePublicHostConfigured,
    temporaryEndpointActive: input.temporaryEndpointActive,
    canonicalCommerceConfigured: input.canonicalCommerceConfigured,
    lndReady: input.lndReady,
    chainReady: input.chainReady,
    replayReady: input.replayReady,
    effectiveCommerceHost,
    effectiveSettlementHost,
    effectiveBuyerRecoveryHost
  };
}
