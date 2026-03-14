type CanonicalCommerceKind =
  | "provider_hosted"
  | "self_hosted_stable"
  | "temporary_endpoint"
  | "unavailable";

type CreatorOriginKind = "stable" | "temporary" | "unavailable";

type ReplayMode = "edge_ticket" | "creator_origin" | "buy_page";

type DeliveryStability = "durable" | "temporary" | "unavailable";

export type DeliveryRoutingDescriptor = {
  canonicalCommerceOrigin: string | null;
  canonicalCommerceKind: CanonicalCommerceKind;
  deliveryMode: string | null;
  preferredPlaybackOrigin: string | null;
  fallbackPlaybackOrigin: string;
  stability: DeliveryStability;
  replayMode: ReplayMode;
  creatorOriginKind: CreatorOriginKind;
  selectedOriginType: "provider_durable_edge" | "creator_origin" | "canonical_fallback";
  providerDurablePlaybackAvailable: boolean;
  creatorPlaybackAvailable: boolean;
  selectedUrl: string | null;
  reason:
    | "provider_durable_edge_available"
    | "creator_origin_stable"
    | "provider_edge_unavailable"
    | "creator_origin_unavailable";
};

export type DeliveryRoutingInput = {
  canonicalCommerceOrigin: string | null;
  canonicalCommerceKind: CanonicalCommerceKind;
  canonicalFallbackUrl: string;
  deliveryMode?: string | null;
  creatorOriginKind: CreatorOriginKind;
  creatorPlaybackUrl?: string | null;
  providerDurablePlaybackAvailable: boolean;
};

function normalizeOrigin(origin: string | null | undefined): string | null {
  const value = String(origin || "").trim().replace(/\/+$/, "");
  return value || null;
}

function originFromUrl(url: string | null | undefined): string | null {
  const value = String(url || "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function stabilityFromKind(kind: CanonicalCommerceKind): DeliveryStability {
  if (kind === "provider_hosted" || kind === "self_hosted_stable") return "durable";
  if (kind === "temporary_endpoint") return "temporary";
  return "unavailable";
}

export function buildDeliveryRoutingDescriptor(input: DeliveryRoutingInput): DeliveryRoutingDescriptor {
  const canonicalCommerceOrigin = normalizeOrigin(input.canonicalCommerceOrigin);
  const fallbackPlaybackOrigin =
    normalizeOrigin(originFromUrl(input.canonicalFallbackUrl)) || normalizeOrigin(input.canonicalFallbackUrl) || "";
  const creatorPlaybackUrl = String(input.creatorPlaybackUrl || "").trim() || null;
  const creatorPlaybackAvailable = Boolean(
    creatorPlaybackUrl && input.creatorOriginKind === "stable"
  );

  if (input.providerDurablePlaybackAvailable) {
    return {
      canonicalCommerceOrigin,
      canonicalCommerceKind: input.canonicalCommerceKind,
      deliveryMode: input.deliveryMode || null,
      preferredPlaybackOrigin: null,
      fallbackPlaybackOrigin,
      stability: stabilityFromKind(input.canonicalCommerceKind),
      replayMode: "edge_ticket",
      creatorOriginKind: input.creatorOriginKind,
      selectedOriginType: "provider_durable_edge",
      providerDurablePlaybackAvailable: true,
      creatorPlaybackAvailable,
      selectedUrl: null,
      reason: "provider_durable_edge_available"
    };
  }

  if (creatorPlaybackAvailable) {
    return {
      canonicalCommerceOrigin,
      canonicalCommerceKind: input.canonicalCommerceKind,
      deliveryMode: input.deliveryMode || null,
      preferredPlaybackOrigin: originFromUrl(creatorPlaybackUrl),
      fallbackPlaybackOrigin,
      stability: "durable",
      replayMode: "creator_origin",
      creatorOriginKind: input.creatorOriginKind,
      selectedOriginType: "creator_origin",
      providerDurablePlaybackAvailable: false,
      creatorPlaybackAvailable: true,
      selectedUrl: creatorPlaybackUrl,
      reason: "creator_origin_stable"
    };
  }

  return {
    canonicalCommerceOrigin,
    canonicalCommerceKind: input.canonicalCommerceKind,
    deliveryMode: input.deliveryMode || null,
    preferredPlaybackOrigin: fallbackPlaybackOrigin,
    fallbackPlaybackOrigin,
    stability: stabilityFromKind(input.canonicalCommerceKind),
    replayMode: "buy_page",
    creatorOriginKind: input.creatorOriginKind,
    selectedOriginType: "canonical_fallback",
    providerDurablePlaybackAvailable: false,
    creatorPlaybackAvailable: false,
    selectedUrl: input.canonicalFallbackUrl,
    reason:
      input.creatorOriginKind === "stable"
        ? "provider_edge_unavailable"
        : "creator_origin_unavailable"
  };
}

