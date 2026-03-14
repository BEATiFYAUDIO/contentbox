import test from "node:test";
import assert from "node:assert/strict";
import { buildDeliveryRoutingDescriptor } from "./deliveryRouting.js";

test("delivery routing prefers provider durable edge when available", () => {
  const descriptor = buildDeliveryRoutingDescriptor({
    canonicalCommerceOrigin: "https://provider.example.com",
    canonicalCommerceKind: "provider_hosted",
    canonicalFallbackUrl: "https://provider.example.com/buy/c1",
    creatorOriginKind: "temporary",
    creatorPlaybackUrl: null,
    providerDurablePlaybackAvailable: true
  });

  assert.equal(descriptor.replayMode, "edge_ticket");
  assert.equal(descriptor.selectedOriginType, "provider_durable_edge");
  assert.equal(descriptor.stability, "durable");
  assert.equal(descriptor.selectedUrl, null);
});

test("delivery routing uses stable creator origin direct playback when edge unavailable", () => {
  const descriptor = buildDeliveryRoutingDescriptor({
    canonicalCommerceOrigin: "https://creator.example.com",
    canonicalCommerceKind: "self_hosted_stable",
    canonicalFallbackUrl: "https://creator.example.com/buy/c2",
    creatorOriginKind: "stable",
    creatorPlaybackUrl: "https://creator.example.com/content/mh/primary",
    providerDurablePlaybackAvailable: false
  });

  assert.equal(descriptor.replayMode, "creator_origin");
  assert.equal(descriptor.selectedOriginType, "creator_origin");
  assert.equal(descriptor.selectedUrl, "https://creator.example.com/content/mh/primary");
  assert.equal(descriptor.preferredPlaybackOrigin, "https://creator.example.com");
});

test("delivery routing falls back to canonical buy surface when no durable playback origin exists", () => {
  const descriptor = buildDeliveryRoutingDescriptor({
    canonicalCommerceOrigin: "https://provider.example.com",
    canonicalCommerceKind: "provider_hosted",
    canonicalFallbackUrl: "https://provider.example.com/buy/c3",
    creatorOriginKind: "temporary",
    creatorPlaybackUrl: "https://temp.trycloudflare.com/content/mh/primary",
    providerDurablePlaybackAvailable: false
  });

  assert.equal(descriptor.replayMode, "buy_page");
  assert.equal(descriptor.selectedOriginType, "canonical_fallback");
  assert.equal(descriptor.selectedUrl, "https://provider.example.com/buy/c3");
  assert.equal(descriptor.reason, "creator_origin_unavailable");
});

