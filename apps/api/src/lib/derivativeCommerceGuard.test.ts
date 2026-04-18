import test from "node:test";
import assert from "node:assert/strict";

import {
  isUnsupportedMultiParentDerivativeCommerce,
  MULTI_PARENT_DERIVATIVE_COMMERCE_BLOCK
} from "./derivativeCommerceGuard.js";

test("blocks paid multi-parent derivative commerce", () => {
  assert.equal(
    isUnsupportedMultiParentDerivativeCommerce({
      parentCount: 2,
      priceSats: 1000n
    }),
    true
  );
});

test("does not block single-parent paid derivative commerce", () => {
  assert.equal(
    isUnsupportedMultiParentDerivativeCommerce({
      parentCount: 1,
      priceSats: 1000n
    }),
    false
  );
});

test("does not block free multi-parent derivative content", () => {
  assert.equal(
    isUnsupportedMultiParentDerivativeCommerce({
      parentCount: 3,
      priceSats: 0n
    }),
    false
  );
});

test("exports the explicit beta commerce block code", () => {
  assert.deepEqual(MULTI_PARENT_DERIVATIVE_COMMERCE_BLOCK, {
    code: "MULTIPLE_PARENTS_NOT_SUPPORTED",
    message: "This derivative has multiple parent works and cannot be sold in beta yet."
  });
});
