import type { NodeMode } from "./identity";

export type NetworkUserType = "basic_creator" | "sovereign_creator" | "provider_node";

export function resolveNetworkUserType(input: {
  nodeMode: NodeMode | null | undefined;
  providesInvoiceInfrastructure?: boolean;
}): NetworkUserType {
  if (input.providesInvoiceInfrastructure) return "provider_node";
  if (input.nodeMode === "advanced" || input.nodeMode === "lan") return "sovereign_creator";
  return "basic_creator";
}

export function networkUserTypeLabel(userType: NetworkUserType): string {
  if (userType === "provider_node") return "Provider Node";
  if (userType === "sovereign_creator") return "Sovereign Creator";
  return "Basic Creator";
}

export function nodeModeRoleLabel(mode: NodeMode | null | undefined): string {
  if (mode === "advanced") return "Sovereign Creator Node";
  if (mode === "lan") return "Sovereign Creator Node (LAN Studio)";
  return "Basic Creator Node";
}

export type ParticipationMode = "basic_creator" | "sovereign_with_provider" | "sovereign_node";

export function resolveParticipationMode(input: {
  nodeMode: NodeMode | null | undefined;
  providerConfigured?: boolean;
  providerInfrastructureCapability?: boolean;
  localSovereignReady?: boolean;
}): ParticipationMode {
  if (input.nodeMode === "basic") return "basic_creator";
  if (input.localSovereignReady) return "sovereign_node";
  if (input.providerConfigured || input.providerInfrastructureCapability) return "sovereign_with_provider";
  return "sovereign_with_provider";
}

export function participationModeMeta(mode: ParticipationMode): { label: string; description: string } {
  if (mode === "basic_creator") {
    return {
      label: "Basic Creator",
      description: "Creator identity with provider-backed infrastructure."
    };
  }
  if (mode === "sovereign_with_provider") {
    return {
      label: "Sovereign Creator",
      description: "Creator-hosted storefront with optional provider-backed commerce services."
    };
  }
  return {
    label: "Sovereign Node",
    description: "Creator-hosted storefront with verified local BTC/LND/invoice commerce stack."
  };
}
