import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePublicMediaDelivery,
  isPaidFullDeliverySessionAuthorized,
  normalizeDeliveryObjectKey,
  redactSensitiveUrl,
  resolveDeliveryPath,
  validatePublicDeliveryTokenClaims
} from "./deliverySecurity.js";

test("redacts bearer-style delivery tokens from logged URLs", () => {
  assert.equal(
    redactSensitiveUrl("/content/mh/file.mp3?t=secret&receiptToken=receipt&ok=1"),
    "/content/mh/file.mp3?t=%5Bredacted%5D&receiptToken=%5Bredacted%5D&ok=1"
  );
  assert.equal(
    redactSensitiveUrl("https://certifyd.example/content/mh/file.mp3?token=secret#frag"),
    "https://certifyd.example/content/mh/file.mp3?token=%5Bredacted%5D#frag"
  );
});

test("paid full delivery rejects copied URLs without the original buyer session", () => {
  assert.equal(
    isPaidFullDeliverySessionAuthorized({
      paidContent: true,
      access: "full",
      tokenBuyerSessionId: "session_a",
      requestBuyerSessionId: null
    }),
    false
  );
  assert.equal(
    isPaidFullDeliverySessionAuthorized({
      paidContent: true,
      access: "full",
      tokenBuyerSessionId: "session_a",
      requestBuyerSessionId: "session_b"
    }),
    false
  );
});

test("paid full delivery allows only the matching live buyer session", () => {
  assert.equal(
    isPaidFullDeliverySessionAuthorized({
      paidContent: true,
      access: "full",
      tokenBuyerSessionId: "session_a",
      requestBuyerSessionId: "session_a"
    }),
    true
  );
});

test("paid full delivery allows short-lived receipt-proof tokens without a live buyer session", () => {
  assert.equal(
    isPaidFullDeliverySessionAuthorized({
      paidContent: true,
      access: "full",
      tokenReceiptProofAccess: true,
      requestBuyerSessionId: null
    }),
    true
  );
  assert.deepEqual(
    validatePublicDeliveryTokenClaims(
      {
        scope: "public_delivery",
        contentId: "content_1",
        objectKey: "files/song.mp3",
        access: "full",
        receiptProofAccess: true
      },
      {
        contentId: "content_1",
        objectKey: "files/song.mp3",
        paidContent: true,
        requestBuyerSessionId: null
      }
    ),
    { ok: true, access: "full" }
  );
});

test("preview and free full delivery do not require buyer-session binding", () => {
  assert.equal(
    isPaidFullDeliverySessionAuthorized({
      paidContent: true,
      access: "preview"
    }),
    true
  );
  assert.equal(
    isPaidFullDeliverySessionAuthorized({
      paidContent: false,
      access: "full"
    }),
    true
  );
});

test("delivery object keys accept only canonical repo-relative paths", () => {
  assert.deepEqual(normalizeDeliveryObjectKey("files/song.mp3"), { ok: true, objectKey: "files/song.mp3" });
  for (const objectKey of [
    "",
    "/files/song.mp3",
    "files//song.mp3",
    "files/../song.mp3",
    "files/./song.mp3",
    "files\\song.mp3",
    "files%2fsong.mp3",
    "files%5csong.mp3",
    "https://example.com/song.mp3"
  ]) {
    assert.equal(normalizeDeliveryObjectKey(objectKey).ok, false, objectKey);
  }
});

test("delivery path resolution rejects traversal and normalization mismatches", () => {
  const ok = resolveDeliveryPath("/tmp/contentbox/repo", "files/song.mp3");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.absPath, "/tmp/contentbox/repo/files/song.mp3");
  assert.equal(resolveDeliveryPath("/tmp/contentbox/repo", "../secret.mp3").ok, false);
  assert.equal(resolveDeliveryPath("/tmp/contentbox/repo", "files/../../secret.mp3").ok, false);
  assert.equal(resolveDeliveryPath("/tmp/contentbox/repo", "files//song.mp3").ok, false);
});

test("public media policy rejects paid full delivery without authorization before range handling", () => {
  const decision = evaluatePublicMediaDelivery({
    paidContent: true,
    freeContent: false,
    deliveryAccess: null,
    isPublicPreviewAsset: false,
    isPublicCoverAsset: false
  });
  assert.deepEqual(decision, { ok: false, status: 402, code: "PAYMENT_REQUIRED" });
});

test("public media policy allows signed preview fallback for paid master assets", () => {
  const decision = evaluatePublicMediaDelivery({
    paidContent: true,
    freeContent: false,
    deliveryAccess: "preview",
    isPublicPreviewAsset: false,
    isPublicCoverAsset: false
  });
  assert.deepEqual(decision, { ok: true, mode: "preview" });
});

test("public media policy allows paid preview only for separately generated preview assets", () => {
  const decision = evaluatePublicMediaDelivery({
    paidContent: true,
    freeContent: false,
    deliveryAccess: null,
    isPublicPreviewAsset: true,
    isPublicCoverAsset: false
  });
  assert.deepEqual(decision, { ok: true, mode: "preview" });
});

test("public media policy serves complete preview assets, so sequential ranges do not expose paid master bytes", () => {
  const firstRange = evaluatePublicMediaDelivery({
    paidContent: true,
    freeContent: false,
    deliveryAccess: null,
    isPublicPreviewAsset: true,
    isPublicCoverAsset: false
  });
  const secondRange = evaluatePublicMediaDelivery({
    paidContent: true,
    freeContent: false,
    deliveryAccess: null,
    isPublicPreviewAsset: true,
    isPublicCoverAsset: false
  });
  assert.deepEqual(firstRange, { ok: true, mode: "preview" });
  assert.deepEqual(secondRange, { ok: true, mode: "preview" });
});

test("public media policy allows successful authorized paid playback and seeking", () => {
  const decision = evaluatePublicMediaDelivery({
    paidContent: true,
    freeContent: false,
    deliveryAccess: "full",
    isPublicPreviewAsset: false,
    isPublicCoverAsset: false
  });
  assert.deepEqual(decision, { ok: true, mode: "full" });
});

test("delivery token claims bind exact content id and object key", () => {
  const claims = {
    scope: "public_delivery",
    contentId: "content_a",
    objectKey: "files/master.mp3",
    access: "full",
    buyerSessionId: "session_a"
  };
  assert.deepEqual(
    validatePublicDeliveryTokenClaims(claims, {
      contentId: "content_a",
      objectKey: "files/master.mp3",
      paidContent: true,
      requestBuyerSessionId: "session_a"
    }),
    { ok: true, access: "full" }
  );
  assert.equal(
    validatePublicDeliveryTokenClaims(claims, {
      contentId: "content_b",
      objectKey: "files/master.mp3",
      paidContent: true,
      requestBuyerSessionId: "session_a"
    }).ok,
    false
  );
  assert.equal(
    validatePublicDeliveryTokenClaims(claims, {
      contentId: "content_a",
      objectKey: "files/other.mp3",
      paidContent: true,
      requestBuyerSessionId: "session_a"
    }).ok,
    false
  );
});

test("delivery token claims reject preview token where full access is required", () => {
  const result = validatePublicDeliveryTokenClaims(
    {
      scope: "public_delivery",
      contentId: "content_a",
      objectKey: "files/preview.mp3",
      access: "preview"
    },
    {
      contentId: "content_a",
      objectKey: "files/preview.mp3",
      paidContent: true,
      requiredAccess: "full"
    }
  );
  assert.deepEqual(result, { ok: false, reason: "access_mismatch" });
});

test("delivery token claims reject copied paid URLs without the bound session", () => {
  const claims = {
    scope: "public_delivery",
    contentId: "content_a",
    objectKey: "files/master.mp3",
    access: "full",
    buyerSessionId: "session_a"
  };
  assert.deepEqual(
    validatePublicDeliveryTokenClaims(claims, {
      contentId: "content_a",
      objectKey: "files/master.mp3",
      paidContent: true,
      requestBuyerSessionId: null
    }),
    { ok: false, reason: "session_mismatch" }
  );
});
