import assert from "node:assert/strict";
import { stableStringify } from "../lib/proof.js";

const receiptA = {
  receiptVersion: 1,
  receiptId: "r1",
  proofHash: "ph",
  manifestHash: "mh",
  contentId: "c1",
  splitVersion: "v1",
  amountSats: 1000,
  unitsPurchased: 10,
  rateSatsPerUnit: 100,
  paymentProvider: "lnd",
  paymentHash: "hh",
  invoiceId: "ii",
  issuedAt: "2026-02-01T00:00:00.000Z",
  creatorId: "u1",
  creatorSig: null
};

const receiptB = {
  creatorSig: null,
  creatorId: "u1",
  issuedAt: "2026-02-01T00:00:00.000Z",
  invoiceId: "ii",
  paymentHash: "hh",
  paymentProvider: "lnd",
  rateSatsPerUnit: 100,
  unitsPurchased: 10,
  amountSats: 1000,
  splitVersion: "v1",
  contentId: "c1",
  manifestHash: "mh",
  proofHash: "ph",
  receiptId: "r1",
  receiptVersion: 1
};

const a = stableStringify(receiptA);
const b = stableStringify(receiptB);
assert.equal(a, b, "canonical receipt JSON should be stable across key order");

console.log("receipt_canonical_test OK");
