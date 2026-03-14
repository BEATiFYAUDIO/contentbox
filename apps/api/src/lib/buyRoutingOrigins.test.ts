import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBuyRoutingOrigins, resolveRoutingAuthority } from "./buyRoutingOrigins.js";

test("basic mode allows temporary preview origin for buy page preview", () => {
  const out = resolveBuyRoutingOrigins({
    participationMode: "basic_creator",
    fallbackOrigin: "http://127.0.0.1:4000",
    localEndpointOrigin: "https://temp.example.trycloudflare.com",
    temporaryPreviewOrigin: "https://temp.example.trycloudflare.com"
  });
  assert.equal(out.commerceOrigin, "https://temp.example.trycloudflare.com");
  assert.equal(out.previewOrigin, "https://temp.example.trycloudflare.com");
  assert.equal(out.tempTunnelIgnoredForCommerce, false);
});

test("provider-backed mode keeps provider as commerce host and ignores temp tunnel", () => {
  const out = resolveBuyRoutingOrigins({
    participationMode: "sovereign_creator_with_provider",
    fallbackOrigin: "http://127.0.0.1:4000",
    providerOrigin: "https://contentbox.provider.com",
    localEndpointOrigin: "https://temp.example.trycloudflare.com",
    temporaryPreviewOrigin: "https://temp.example.trycloudflare.com"
  });
  assert.equal(out.commerceOrigin, "https://contentbox.provider.com");
  assert.equal(out.previewOrigin, "https://temp.example.trycloudflare.com");
  assert.equal(out.tempTunnelIgnoredForCommerce, true);
});

test("routing authority in provider-backed mode never elevates temp tunnel", () => {
  const out = resolveRoutingAuthority({
    participationMode: "sovereign_creator_with_provider",
    fallbackOrigin: "http://127.0.0.1:4000",
    providerOrigin: "https://contentbox.darrylhillock.com",
    temporaryPreviewOrigin: "https://ephemeral.trycloudflare.com",
    localEndpointOrigin: "https://ephemeral.trycloudflare.com",
    creatorHandle: "dhillock"
  });
  assert.equal(out.canonicalCommerceOrigin, "https://contentbox.darrylhillock.com");
  assert.equal(out.creatorPublicBase, "https://contentbox.darrylhillock.com/u/dhillock");
  assert.equal(out.previewEphemeralOrigin, "https://ephemeral.trycloudflare.com");
  assert.equal(out.authoritySource, "provider_durable");
});

test("sovereign node mode prefers stable local host for commerce", () => {
  const out = resolveBuyRoutingOrigins({
    participationMode: "sovereign_node",
    fallbackOrigin: "http://127.0.0.1:4000",
    stableLocalOrigin: "https://node.creator.com",
    localEndpointOrigin: "https://temp.example.trycloudflare.com",
    temporaryPreviewOrigin: "https://temp.example.trycloudflare.com"
  });
  assert.equal(out.commerceOrigin, "https://node.creator.com");
  assert.equal(out.previewOrigin, "https://node.creator.com");
  assert.equal(out.tempTunnelIgnoredForCommerce, true);
});
