import test from "node:test";
import assert from "node:assert/strict";
import {
  computeReceiptAccessPresentation,
  resolveReceiptContext,
  type ResolvedReceiptIntent
} from "./receiptResolver.js";

function mkIntent(overrides: Partial<ResolvedReceiptIntent> = {}): ResolvedReceiptIntent {
  return {
    id: "pi_1",
    contentId: "content_1",
    manifestSha256: "abc",
    status: "paid",
    receiptToken: "token_1",
    receiptTokenExpiresAt: new Date(Date.now() + 60_000),
    receiptId: "rcpt_1",
    ...overrides
  };
}

test("receipt resolves after token expiry and remains purchased", async () => {
  const intent = mkIntent({ receiptTokenExpiresAt: new Date(Date.now() - 1000) });
  const out = await resolveReceiptContext({
    receiptToken: "token_1",
    findByReceiptToken: async () => intent,
    findByReceiptId: async () => null,
    findByPaymentIntentId: async () => null,
    getAuthenticityContext: async () => ({
      paymentIntentId: intent.id,
      receiptId: intent.receiptId || null,
      contentId: intent.contentId,
      manifestSha256: intent.manifestSha256 || null,
      creator: { userId: "u1", displayName: "Creator", handle: "creator" }
    }),
    getAvailability: async () => "available"
  });

  assert.ok(out);
  assert.equal(out?.entitlement.purchased, true);
  assert.equal(out?.token.expired, true);
  assert.equal(out?.matchedBy, "receiptToken");
});

test("legacy token route can resolve by paymentIntent id fallback", async () => {
  const intent = mkIntent({ id: "pi_lookup", receiptToken: null });
  const out = await resolveReceiptContext({
    receiptToken: "pi_lookup",
    findByReceiptToken: async () => null,
    findByReceiptId: async () => null,
    findByPaymentIntentId: async (id) => (id === "pi_lookup" ? intent : null),
    getAuthenticityContext: async () => ({
      paymentIntentId: intent.id,
      receiptId: intent.receiptId || null,
      contentId: intent.contentId,
      manifestSha256: intent.manifestSha256 || null,
      creator: { userId: "u1", displayName: "Creator", handle: "creator" }
    }),
    getAvailability: async () => "available"
  });

  assert.ok(out);
  assert.equal(out?.matchedBy, "paymentIntentId");
});

test("resolver can use refresh callback for pending intents", async () => {
  const pending = mkIntent({ status: "pending" });
  const paid = mkIntent({ status: "paid" });
  const out = await resolveReceiptContext({
    receiptToken: "token_1",
    findByReceiptToken: async () => pending,
    findByReceiptId: async () => null,
    findByPaymentIntentId: async () => null,
    refreshIntentIfPending: async () => paid,
    getAuthenticityContext: async (resolved) => ({
      paymentIntentId: resolved.id,
      receiptId: resolved.receiptId || null,
      contentId: resolved.contentId,
      manifestSha256: resolved.manifestSha256 || null,
      creator: { userId: "u1", displayName: "Creator", handle: "creator" }
    }),
    getAvailability: async () => "available"
  });

  assert.ok(out);
  assert.equal(out?.intent.status, "paid");
  assert.equal(out?.entitlement.purchased, true);
});

test("resolver can surface creator_offline availability while purchase remains valid", async () => {
  const intent = mkIntent();
  const out = await resolveReceiptContext({
    receiptToken: "token_1",
    findByReceiptToken: async () => intent,
    findByReceiptId: async () => null,
    findByPaymentIntentId: async () => null,
    getAuthenticityContext: async () => ({
      paymentIntentId: intent.id,
      receiptId: intent.receiptId || null,
      contentId: intent.contentId,
      manifestSha256: intent.manifestSha256 || null,
      creator: { userId: "u1", displayName: "Creator", handle: "creator" }
    }),
    getAvailability: async () => "creator_offline"
  });

  assert.ok(out);
  assert.equal(out?.entitlement.purchased, true);
  assert.equal(out?.availability, "creator_offline");
});

test("access presentation keeps paid receipt pending without buyer session", () => {
  const out = computeReceiptAccessPresentation({
    purchased: true,
    entitled: false,
    availability: "available",
    buyerId: null,
    warning: null
  });

  assert.deepEqual(out, {
    canFulfill: false,
    access: "pending",
    entitled: false
  });
});

test("access presentation keeps paid receipt pending on buyer mismatch warning", () => {
  const out = computeReceiptAccessPresentation({
    purchased: true,
    entitled: true,
    availability: "available",
    buyerId: "buyer_1",
    warning: "BUYER_SESSION_MISMATCH_USING_INTENT_BUYER"
  });

  assert.deepEqual(out, {
    canFulfill: false,
    access: "pending",
    entitled: true
  });
});

test("access presentation marks creator offline purchase as unavailable while preserving purchase truth", () => {
  const out = computeReceiptAccessPresentation({
    purchased: true,
    entitled: false,
    availability: "creator_offline",
    buyerId: null,
    warning: null
  });

  assert.deepEqual(out, {
    canFulfill: false,
    access: "unavailable",
    entitled: false
  });
});

test("access presentation unlocks only when purchased, entitled, available, and buyer-bound", () => {
  const out = computeReceiptAccessPresentation({
    purchased: true,
    entitled: true,
    availability: "available",
    buyerId: "buyer_1",
    warning: null
  });

  assert.deepEqual(out, {
    canFulfill: true,
    access: "unlocked",
    entitled: true
  });
});
