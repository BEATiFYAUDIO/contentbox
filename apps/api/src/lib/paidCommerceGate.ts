export type CreatorCommerceMode = "basic" | "sovereign_provider" | "sovereign_node";
export type EndpointStability = "temporary" | "stable" | "unknown";

export function isTemporaryEndpoint(stability: EndpointStability): boolean {
  return stability !== "stable";
}

export function canEnablePaidCommerce(input: {
  mode: CreatorCommerceMode;
  endpointStability: EndpointStability;
  canonicalCommerceConfigured: boolean;
}): { allowed: boolean; reason: string | null } {
  const { mode, endpointStability, canonicalCommerceConfigured } = input;

  if (mode === "basic") {
    return {
      allowed: false,
      reason: "Basic mode does not provide durable paid commerce."
    };
  }

  if (!canonicalCommerceConfigured) {
    return {
      allowed: false,
      reason: "Paid commerce requires a configured canonical public host."
    };
  }

  if (isTemporaryEndpoint(endpointStability)) {
    return {
      allowed: false,
      reason: "Temporary links are preview-only. Paid commerce requires a stable public host."
    };
  }

  return { allowed: true, reason: null };
}

