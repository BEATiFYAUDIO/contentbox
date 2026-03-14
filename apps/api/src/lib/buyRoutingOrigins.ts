export type BuyRoutingParticipationMode =
  | "basic_creator"
  | "sovereign_creator_with_provider"
  | "sovereign_node";

export type RoutingAuthority = {
  routingMode: "basic_preview" | "provider_backed" | "sovereign_local";
  authoritySource: "preview_ephemeral" | "provider_durable" | "local_durable" | "fallback";
  canonicalCommerceOrigin: string | null;
  creatorPublicBase: string | null;
  creatorIdentityOrigin: string | null;
  previewEphemeralOrigin: string | null;
  stability: "temporary" | "durable" | "unknown";
  providerNodeOrigin: string | null;
  providerCreatorNamespaceReady: boolean;
};

export type BuyRoutingOrigins = {
  commerceOrigin: string;
  previewOrigin: string | null;
  temporaryPreviewOrigin: string | null;
  tempTunnelIgnoredForCommerce: boolean;
};

function pick(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const v = String(value || "").trim();
    if (v) return v;
  }
  return null;
}

function toCreatorPublicBase(canonicalCommerceOrigin: string | null, creatorHandle: string | null): string | null {
  const base = pick(canonicalCommerceOrigin);
  const handle = pick(creatorHandle);
  if (!base || !handle) return null;
  return `${base}/u/${encodeURIComponent(handle)}`;
}

export function resolveRoutingAuthority(input: {
  participationMode: BuyRoutingParticipationMode;
  fallbackOrigin: string;
  providerOrigin?: string | null;
  stableLocalOrigin?: string | null;
  localEndpointOrigin?: string | null;
  temporaryPreviewOrigin?: string | null;
  creatorHandle?: string | null;
}): RoutingAuthority {
  const fallbackOrigin = pick(input.fallbackOrigin) || "http://127.0.0.1:4000";
  const providerOrigin = pick(input.providerOrigin);
  const stableLocalOrigin = pick(input.stableLocalOrigin);
  const localEndpointOrigin = pick(input.localEndpointOrigin);
  const temporaryPreviewOrigin = pick(input.temporaryPreviewOrigin);
  const creatorHandle = pick(input.creatorHandle);

  if (input.participationMode === "basic_creator") {
    const previewOrigin = pick(temporaryPreviewOrigin, localEndpointOrigin, fallbackOrigin);
    return {
      routingMode: "basic_preview",
      authoritySource: previewOrigin === fallbackOrigin ? "fallback" : "preview_ephemeral",
      canonicalCommerceOrigin: null,
      creatorPublicBase: null,
      creatorIdentityOrigin: null,
      previewEphemeralOrigin: previewOrigin,
      stability: previewOrigin ? "temporary" : "unknown",
      providerNodeOrigin: providerOrigin,
      providerCreatorNamespaceReady: false
    };
  }

  if (input.participationMode === "sovereign_creator_with_provider") {
    const canonicalCommerceOrigin = providerOrigin;
    const creatorPublicBase = toCreatorPublicBase(canonicalCommerceOrigin, creatorHandle);
    return {
      routingMode: "provider_backed",
      authoritySource: canonicalCommerceOrigin ? "provider_durable" : "fallback",
      canonicalCommerceOrigin,
      creatorPublicBase,
      creatorIdentityOrigin: creatorPublicBase || canonicalCommerceOrigin,
      previewEphemeralOrigin: pick(temporaryPreviewOrigin, localEndpointOrigin),
      stability: canonicalCommerceOrigin ? "durable" : "unknown",
      providerNodeOrigin: providerOrigin,
      providerCreatorNamespaceReady: Boolean(canonicalCommerceOrigin && creatorPublicBase)
    };
  }

  const canonicalCommerceOrigin = stableLocalOrigin;
  const creatorPublicBase = toCreatorPublicBase(canonicalCommerceOrigin, creatorHandle);
  return {
    routingMode: "sovereign_local",
    authoritySource: canonicalCommerceOrigin ? "local_durable" : "fallback",
    canonicalCommerceOrigin,
    creatorPublicBase,
    creatorIdentityOrigin: creatorPublicBase || canonicalCommerceOrigin,
    previewEphemeralOrigin: pick(temporaryPreviewOrigin, localEndpointOrigin),
    stability: canonicalCommerceOrigin ? "durable" : "unknown",
    providerNodeOrigin: providerOrigin,
    providerCreatorNamespaceReady: false
  };
}

export function resolveBuyRoutingOrigins(input: {
  participationMode: BuyRoutingParticipationMode;
  fallbackOrigin: string;
  providerOrigin?: string | null;
  stableLocalOrigin?: string | null;
  localEndpointOrigin?: string | null;
  temporaryPreviewOrigin?: string | null;
  creatorHandle?: string | null;
}): BuyRoutingOrigins {
  const fallbackOrigin = pick(input.fallbackOrigin) || "http://127.0.0.1:4000";
  const authority = resolveRoutingAuthority(input);
  if (input.participationMode === "basic_creator") {
    const previewOrigin = pick(authority.previewEphemeralOrigin, fallbackOrigin);
    return {
      commerceOrigin: previewOrigin || fallbackOrigin,
      previewOrigin: previewOrigin || fallbackOrigin,
      temporaryPreviewOrigin: authority.previewEphemeralOrigin,
      tempTunnelIgnoredForCommerce: false
    };
  }
  const commerceOrigin = pick(authority.canonicalCommerceOrigin, fallbackOrigin) || fallbackOrigin;
  const previewOrigin =
    input.participationMode === "sovereign_node"
      ? pick(commerceOrigin, authority.previewEphemeralOrigin)
      : pick(authority.previewEphemeralOrigin, commerceOrigin);
  return {
    commerceOrigin,
    previewOrigin,
    temporaryPreviewOrigin: authority.previewEphemeralOrigin,
    tempTunnelIgnoredForCommerce: Boolean(
      authority.previewEphemeralOrigin && commerceOrigin !== authority.previewEphemeralOrigin
    )
  };
}
