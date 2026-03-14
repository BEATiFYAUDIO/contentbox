import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalBuyerRecoveryUrls } from "./buyerRecoveryUrls.js";

test("buildCanonicalBuyerRecoveryUrls produces canonical buyer surfaces", () => {
  const urls = buildCanonicalBuyerRecoveryUrls({
    canonicalOrigin: "https://provider.example.com/",
    contentId: "c1",
    paymentId: "pi_1",
    receiptToken: "rcpt_1",
    entitlementId: "ent_1"
  });

  assert.equal(urls.canonicalCommerceOrigin, "https://provider.example.com");
  assert.equal(urls.buyUrl, "https://provider.example.com/buy/c1");
  assert.equal(urls.receiptStatusUrl, "https://provider.example.com/buy/receipts/rcpt_1/status");
  assert.equal(urls.receiptUrl, "https://provider.example.com/receipt/pi_1");
  assert.equal(urls.libraryUrl, "https://provider.example.com/library/rcpt_1");
  assert.equal(urls.replayUrl, "https://provider.example.com/replay/ent_1");
});

test("buildCanonicalBuyerRecoveryUrls falls back safely when partial data missing", () => {
  const urls = buildCanonicalBuyerRecoveryUrls({
    canonicalOrigin: "https://provider.example.com",
    contentId: "c2"
  });

  assert.equal(urls.buyUrl, "https://provider.example.com/buy/c2");
  assert.equal(urls.receiptStatusUrl, null);
  assert.equal(urls.receiptUrl, null);
  assert.equal(urls.libraryUrl, "https://provider.example.com/library");
  assert.equal(urls.replayUrl, null);
});
