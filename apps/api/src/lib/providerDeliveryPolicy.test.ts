import test from "node:test";
import assert from "node:assert/strict";
import { validateProviderBackedDeliveryPolicy } from "./providerDeliveryPolicy.js";

test("free content remains unrestricted", () => {
  const out = validateProviderBackedDeliveryPolicy({
    participationMode: "sovereign_creator_with_provider",
    priceSats: 0n,
    deliveryMode: "stream_only"
  });
  assert.equal(out.allowed, true);
  assert.equal(out.blockedReasonCode, null);
});

test("provider-backed paid stream-only is blocked below fee floor", () => {
  const out = validateProviderBackedDeliveryPolicy({
    participationMode: "sovereign_creator_with_provider",
    priceSats: 50n,
    deliveryMode: "stream_only",
    providerFeeFloorSats: 100,
    streamOnlyRiskCapSats: 1000
  });
  assert.equal(out.allowed, false);
  assert.equal(out.blockedReasonCode, "provider_stream_price_below_fee_floor");
});

test("provider-backed paid stream-only is allowed with warning inside band", () => {
  const out = validateProviderBackedDeliveryPolicy({
    participationMode: "sovereign_creator_with_provider",
    priceSats: 250n,
    deliveryMode: "stream_only",
    providerFeeFloorSats: 100,
    streamOnlyRiskCapSats: 1000
  });
  assert.equal(out.allowed, true);
  assert.equal(typeof out.warning, "string");
});

test("provider-backed paid stream-only is blocked above risk cap", () => {
  const out = validateProviderBackedDeliveryPolicy({
    participationMode: "sovereign_creator_with_provider",
    priceSats: 5000n,
    deliveryMode: "stream_only",
    providerFeeFloorSats: 100,
    streamOnlyRiskCapSats: 1000
  });
  assert.equal(out.allowed, false);
  assert.equal(out.blockedReasonCode, "provider_stream_price_above_risk_cap");
});

test("non-stream delivery modes remain allowed in provider-backed mode", () => {
  const downloadOnly = validateProviderBackedDeliveryPolicy({
    participationMode: "sovereign_creator_with_provider",
    priceSats: 5000n,
    deliveryMode: "download_only"
  });
  const both = validateProviderBackedDeliveryPolicy({
    participationMode: "sovereign_creator_with_provider",
    priceSats: 5000n,
    deliveryMode: "stream_and_download"
  });
  assert.equal(downloadOnly.allowed, true);
  assert.equal(both.allowed, true);
});
