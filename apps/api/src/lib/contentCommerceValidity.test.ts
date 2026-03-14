import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContentCommerceValidity } from "./contentCommerceValidity.js";

test("free content remains valid without durable host checks", () => {
  const result = resolveContentCommerceValidity({
    title: "Track 1",
    status: "published",
    filesCount: 1,
    manifestHash: "abc123",
    publishedAt: new Date().toISOString(),
    saleMode: "free",
    paidCommerceAllowed: false,
    paidCommerceReason: "temporary endpoint"
  });
  assert.equal(result.contentValid, true);
  assert.equal(result.commerceValid, true);
  assert.equal(result.routingTarget, "none");
});

test("paid provider-backed content is valid even without local infra", () => {
  const result = resolveContentCommerceValidity({
    title: "Paid Track",
    status: "published",
    filesCount: 1,
    manifestHash: "hash",
    hasPublishRecord: true,
    saleMode: "paid",
    paidCommerceAllowed: true,
    paidRoutingTarget: "provider"
  });
  assert.equal(result.contentValid, true);
  assert.equal(result.commerceValid, true);
  assert.equal(result.routingTarget, "provider");
});

test("paid content without durable routing is blocked but content remains valid", () => {
  const result = resolveContentCommerceValidity({
    title: "Paid Track",
    status: "published",
    filesCount: 1,
    manifestHash: "hash",
    hasPublishRecord: true,
    saleMode: "paid",
    paidCommerceAllowed: false,
    paidCommerceReason: "Paid commerce requires durable host"
  });
  assert.equal(result.contentValid, true);
  assert.equal(result.commerceValid, false);
  assert.equal(result.blockingReason, "Paid commerce requires durable host");
});

test("invalid content fails before commerce checks", () => {
  const result = resolveContentCommerceValidity({
    title: "Broken",
    status: "published",
    filesCount: 0,
    manifestHash: "hash",
    hasPublishRecord: true,
    saleMode: "paid",
    paidCommerceAllowed: true,
    paidRoutingTarget: "provider"
  });
  assert.equal(result.contentValid, false);
  assert.equal(result.commerceValid, false);
  assert.match(result.blockingReason || "", /primary file/i);
});
