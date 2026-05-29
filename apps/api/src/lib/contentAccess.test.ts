import test from "node:test";
import assert from "node:assert/strict";
import { hasFullAccess, isFreeContent, shouldShowPreview } from "./contentAccess.js";

test("free video/audio/file content resolves to full access (price = 0)", () => {
  const freeByPrice = isFreeContent({ priceSats: 0 });
  assert.equal(freeByPrice, true);
  assert.equal(
    hasFullAccess({
      isFree: freeByPrice,
      hasUnlock: false
    }),
    true
  );
});

test("free content does not require receipt token semantics (no paid unlock requirement)", () => {
  const freeByMissingPrice = isFreeContent({ priceSats: null, unlockRequired: false });
  assert.equal(freeByMissingPrice, true);
  assert.equal(
    hasFullAccess({
      isFree: freeByMissingPrice,
      hasUnlock: false
    }),
    true
  );
});

test("paid locked content still returns preview behavior", () => {
  const isFree = isFreeContent({ priceSats: 1000 });
  assert.equal(isFree, false);
  const fullAccess = hasFullAccess({ isFree, hasUnlock: false });
  assert.equal(fullAccess, false);
  assert.equal(
    shouldShowPreview({
      isFree,
      priceSats: 1000,
      hasFullAccess: fullAccess,
      hasPreviewAsset: true
    }),
    true
  );
});

test("paid unlocked content still returns full access behavior", () => {
  const isFree = isFreeContent({ priceSats: 1000 });
  const fullAccess = hasFullAccess({ isFree, hasUnlock: true });
  assert.equal(fullAccess, true);
  assert.equal(
    shouldShowPreview({
      isFree,
      priceSats: 1000,
      hasFullAccess: fullAccess,
      hasPreviewAsset: true
    }),
    false
  );
});

test("missing price with explicit free flag resolves to full access", () => {
  const isFree = isFreeContent({ isFree: true, priceSats: undefined });
  assert.equal(isFree, true);
  assert.equal(
    hasFullAccess({
      isFree,
      hasUnlock: false
    }),
    true
  );
});

test("missing price without explicit free marker does not grant full access", () => {
  const isFree = isFreeContent({ priceSats: undefined });
  assert.equal(isFree, false);
  assert.equal(
    hasFullAccess({
      isFree,
      hasUnlock: false
    }),
    false
  );
});
