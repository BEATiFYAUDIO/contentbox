import test from "node:test";
import assert from "node:assert/strict";

import { canIssueEdgeTicketFromReceiptContext } from "./edgeAccess.js";

test("edge ticket requires current token, buyer binding, and entitlement", () => {
  assert.equal(
    canIssueEdgeTicketFromReceiptContext({
      tokenAuthorized: true,
      purchased: true,
      buyerId: "buyer_1",
      warning: null,
      entitled: true
    }),
    true
  );
});

test("edge ticket rejects missing buyer session context", () => {
  assert.equal(
    canIssueEdgeTicketFromReceiptContext({
      tokenAuthorized: true,
      purchased: true,
      buyerId: null,
      warning: null,
      entitled: true
    }),
    false
  );
});

test("edge ticket rejects mismatched access warning", () => {
  assert.equal(
    canIssueEdgeTicketFromReceiptContext({
      tokenAuthorized: true,
      purchased: true,
      buyerId: "buyer_1",
      warning: "BUYER_SESSION_MISMATCH_USING_INTENT_BUYER",
      entitled: true
    }),
    false
  );
});

test("edge ticket rejects expired or invalid token contexts", () => {
  assert.equal(
    canIssueEdgeTicketFromReceiptContext({
      tokenAuthorized: false,
      purchased: true,
      buyerId: "buyer_1",
      warning: null,
      entitled: true
    }),
    false
  );
});
