import test from "node:test";
import assert from "node:assert/strict";

import { computePublicOriginExposure } from "./publicOriginExposure.js";

test("persistent ownership conflict fails public origin exposure closed", () => {
  const out = computePublicOriginExposure({
    canonicalBuyerOrigin: "https://buyer.example.com",
    canonicalCommerceOrigin: "https://commerce.example.com",
    durableBuyerReady: false,
    durableBuyerReasons: ["TUNNEL_OWNERSHIP_CONFLICT_PERSISTENT"],
    ownershipConflictPersistent: true
  });

  assert.deepEqual(out, {
    canonicalBuyerOrigin: null,
    canonicalCommerceOrigin: null,
    blocked: true,
    blockedReason: "PERSISTENT_TUNNEL_OWNERSHIP_CONFLICT"
  });
});

test("durable not ready without persistent conflict does not remove origin exposure", () => {
  const out = computePublicOriginExposure({
    canonicalBuyerOrigin: "https://buyer.example.com",
    canonicalCommerceOrigin: "https://commerce.example.com",
    durableBuyerReady: false,
    durableBuyerReasons: ["NAMED_TUNNEL_OFFLINE"],
    ownershipConflictPersistent: false
  });

  assert.deepEqual(out, {
    canonicalBuyerOrigin: "https://buyer.example.com",
    canonicalCommerceOrigin: "https://commerce.example.com",
    blocked: false,
    blockedReason: null
  });
});

test("persistent conflict reason in durable host reasons also fails exposure closed", () => {
  const out = computePublicOriginExposure({
    canonicalBuyerOrigin: "https://buyer.example.com",
    canonicalCommerceOrigin: "https://commerce.example.com",
    durableBuyerReady: false,
    durableBuyerReasons: ["NAMED_TUNNEL_OFFLINE", "TUNNEL_OWNERSHIP_CONFLICT_PERSISTENT"],
    ownershipConflictPersistent: false
  });

  assert.deepEqual(out, {
    canonicalBuyerOrigin: null,
    canonicalCommerceOrigin: null,
    blocked: true,
    blockedReason: "PERSISTENT_TUNNEL_OWNERSHIP_CONFLICT"
  });
});
