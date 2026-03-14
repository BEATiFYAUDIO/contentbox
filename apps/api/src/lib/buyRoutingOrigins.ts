export type BuyRoutingParticipationMode =
  | "basic_creator"
  | "sovereign_creator_with_provider"
  | "sovereign_node";

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

export function resolveBuyRoutingOrigins(input: {
  participationMode: BuyRoutingParticipationMode;
  fallbackOrigin: string;
  providerOrigin?: string | null;
  stableLocalOrigin?: string | null;
  localEndpointOrigin?: string | null;
  temporaryPreviewOrigin?: string | null;
}): BuyRoutingOrigins {
  const fallbackOrigin = pick(input.fallbackOrigin) || "http://127.0.0.1:4000";
  const providerOrigin = pick(input.providerOrigin);
  const stableLocalOrigin = pick(input.stableLocalOrigin);
  const localEndpointOrigin = pick(input.localEndpointOrigin);
  const temporaryPreviewOrigin = pick(input.temporaryPreviewOrigin);

  if (input.participationMode === "basic_creator") {
    const previewOrigin = pick(temporaryPreviewOrigin, localEndpointOrigin, fallbackOrigin);
    return {
      commerceOrigin: previewOrigin || fallbackOrigin,
      previewOrigin: previewOrigin || fallbackOrigin,
      temporaryPreviewOrigin,
      tempTunnelIgnoredForCommerce: false
    };
  }

  if (input.participationMode === "sovereign_creator_with_provider") {
    const commerceOrigin = pick(providerOrigin, stableLocalOrigin, fallbackOrigin) || fallbackOrigin;
    const previewOrigin = pick(localEndpointOrigin, temporaryPreviewOrigin, commerceOrigin);
    return {
      commerceOrigin,
      previewOrigin,
      temporaryPreviewOrigin,
      tempTunnelIgnoredForCommerce: Boolean(temporaryPreviewOrigin && commerceOrigin !== temporaryPreviewOrigin)
    };
  }

  const commerceOrigin = pick(stableLocalOrigin, fallbackOrigin) || fallbackOrigin;
  const previewOrigin = pick(stableLocalOrigin, localEndpointOrigin, commerceOrigin);
  return {
    commerceOrigin,
    previewOrigin,
    temporaryPreviewOrigin,
    tempTunnelIgnoredForCommerce: Boolean(temporaryPreviewOrigin && commerceOrigin !== temporaryPreviewOrigin)
  };
}
