import test from "node:test";
import assert from "node:assert/strict";
import { authorizeIntentByReceiptToken } from "./receiptTokenAuth.js";

const TOKEN = "a".repeat(48);

test("unauth token auth fails without token", () => {
  const ok = authorizeIntentByReceiptToken({ headers: {}, query: {} }, { receiptToken: TOKEN, receiptTokenExpiresAt: null }, Date.now());
  assert.equal(ok, false);
});

test("unauth token auth passes with correct token and fails with wrong token", () => {
  const now = Date.now();
  const intent = { receiptToken: TOKEN, receiptTokenExpiresAt: new Date(now + 60_000) };
  assert.equal(authorizeIntentByReceiptToken({ headers: { "x-receipt-token": TOKEN } }, intent, now), true);
  assert.equal(authorizeIntentByReceiptToken({ headers: { "x-receipt-token": "b".repeat(48) } }, intent, now), false);
});

test("unauth token auth supports query fallback", () => {
  const now = Date.now();
  const intent = { receiptToken: TOKEN, receiptTokenExpiresAt: new Date(now + 60_000) };
  assert.equal(authorizeIntentByReceiptToken({ query: { receiptToken: TOKEN } }, intent, now), true);
});

test("expired token is rejected even when token matches", () => {
  const now = Date.now();
  const intent = { receiptToken: TOKEN, receiptTokenExpiresAt: new Date(now - 1000) };
  assert.equal(authorizeIntentByReceiptToken({ headers: { "x-receipt-token": TOKEN } }, intent, now), false);
});

