import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalBuyerRecoveryUrls } from "./buyerRecoveryUrls.js";

test("buildCanonicalBuyerRecoveryUrls emits creator-scoped paths when creatorId is provided", () => {
  const urls = buildCanonicalBuyerRecoveryUrls({
    canonicalOrigin: "https://commerce.example.com",
    creatorId: "creator_123",
    contentId: "content_abc",
    paymentId: "pay_789",
    receiptToken: "rtok_456",
    entitlementId: "ent_999",
    libraryToken: "lib_111"
  });

  assert.equal(urls.buyUrl, "https://commerce.example.com/c/creator_123/buy/content_abc");
  assert.equal(urls.receiptUrl, "https://commerce.example.com/c/creator_123/receipt/pay_789");
  assert.equal(
    urls.receiptStatusUrl,
    "https://commerce.example.com/c/creator_123/buy/receipts/rtok_456/status"
  );
  assert.equal(urls.libraryUrl, "https://commerce.example.com/c/creator_123/library/lib_111");
  assert.equal(urls.replayUrl, "https://commerce.example.com/c/creator_123/replay/ent_999");
});

test("buildCanonicalBuyerRecoveryUrls preserves legacy paths when creatorId is missing", () => {
  const urls = buildCanonicalBuyerRecoveryUrls({
    canonicalOrigin: "https://commerce.example.com",
    contentId: "content_abc",
    paymentId: "pay_789",
    receiptToken: "rtok_456",
    entitlementId: "ent_999"
  });

  assert.equal(urls.buyUrl, "https://commerce.example.com/buy/content_abc");
  assert.equal(urls.receiptUrl, "https://commerce.example.com/receipt/pay_789");
  assert.equal(urls.receiptStatusUrl, "https://commerce.example.com/buy/receipts/rtok_456/status");
  assert.equal(urls.libraryUrl, "https://commerce.example.com/library/rtok_456");
  assert.equal(urls.replayUrl, "https://commerce.example.com/replay/ent_999");
});
