export const PROVIDER_DELIVERY_FEE_FLOOR_SATS = Number(process.env.PROVIDER_DELIVERY_FEE_FLOOR_SATS || 100);
export const PROVIDER_STREAM_ONLY_RISK_CAP_SATS = Number(process.env.PROVIDER_STREAM_ONLY_RISK_CAP_SATS || 1000);

export type DeliveryMode = "stream_only" | "download_only" | "stream_and_download" | null;

export type ProviderDeliveryPolicyResult = {
  allowed: boolean;
  blockedReasonCode: "provider_stream_price_below_fee_floor" | "provider_stream_price_above_risk_cap" | null;
  message: string | null;
  warning: string | null;
  providerFeeFloorSats: number;
  streamOnlyRiskCapSats: number;
};

export function validateProviderBackedDeliveryPolicy(input: {
  participationMode: "basic_creator" | "sovereign_creator_with_provider" | "sovereign_node";
  priceSats: bigint;
  deliveryMode: DeliveryMode;
  providerFeeFloorSats?: number;
  streamOnlyRiskCapSats?: number;
}): ProviderDeliveryPolicyResult {
  const providerFeeFloorSats = Number.isFinite(Number(input.providerFeeFloorSats))
    ? Math.max(1, Math.floor(Number(input.providerFeeFloorSats)))
    : PROVIDER_DELIVERY_FEE_FLOOR_SATS;
  const streamOnlyRiskCapSats = Number.isFinite(Number(input.streamOnlyRiskCapSats))
    ? Math.max(providerFeeFloorSats, Math.floor(Number(input.streamOnlyRiskCapSats)))
    : Math.max(providerFeeFloorSats, PROVIDER_STREAM_ONLY_RISK_CAP_SATS);

  const priceSats = input.priceSats;
  const mode = input.deliveryMode;

  if (priceSats <= 0n || mode !== "stream_only" || input.participationMode !== "sovereign_creator_with_provider") {
    return {
      allowed: true,
      blockedReasonCode: null,
      message: null,
      warning: null,
      providerFeeFloorSats,
      streamOnlyRiskCapSats
    };
  }

  if (priceSats < BigInt(providerFeeFloorSats)) {
    return {
      allowed: false,
      blockedReasonCode: "provider_stream_price_below_fee_floor",
      message: `Paid stream-only is not allowed below ${providerFeeFloorSats} sats in provider-backed mode.`,
      warning: null,
      providerFeeFloorSats,
      streamOnlyRiskCapSats
    };
  }

  if (priceSats > BigInt(streamOnlyRiskCapSats)) {
    return {
      allowed: false,
      blockedReasonCode: "provider_stream_price_above_risk_cap",
      message: `Paid stream-only is not allowed above ${streamOnlyRiskCapSats} sats in provider-backed mode. Use download_only or stream_and_download.`,
      warning: null,
      providerFeeFloorSats,
      streamOnlyRiskCapSats
    };
  }

  return {
    allowed: true,
    blockedReasonCode: null,
    message: null,
    warning:
      "Stream-only paid content depends on the creator node being online. Buyers keep their receipt through the provider, but playback may be temporarily unavailable if the creator node is offline.",
    providerFeeFloorSats,
    streamOnlyRiskCapSats
  };
}
