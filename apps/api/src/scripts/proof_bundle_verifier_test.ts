import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { verifyBundle } from "./verify_proof_bundle.js";
import {
  buildBundle,
  computeSplitsHash,
  type ProofBundleV1,
  type SplitParticipantRef
} from "../lib/proofs/proofBundle.js";

const fixturePath = path.resolve("src/scripts/fixtures/proof_bundle.v1.json");
const fixtureRaw = fs.readFileSync(fixturePath, "utf8");
const fixture = JSON.parse(fixtureRaw) as ProofBundleV1;

const fixtureResult = verifyBundle(fixture);
assert.equal(fixtureResult.ok, true, `fixture should verify: ${fixtureResult.errors.join(", ")}`);

const participants: SplitParticipantRef[] = [
  { recipientRef: "email:alice@example.com", bps: 7000 },
  { recipientRef: "email:bob@example.com", bps: 3000 }
];
const splitsHash = computeSplitsHash({
  splitVersionId: "split_rounding",
  contentId: "content_rounding",
  lockedManifestSha256: "manifest_rounding",
  participants
});

const bundle = buildBundle({
  version: "v1",
  generatedAt: "2026-02-10T00:00:00.000Z",
  publish: {
    contentId: "content_rounding",
    manifestSha256: "manifest_rounding",
    splitVersionId: "split_rounding",
    splitsHash,
    publishedAt: "2026-02-10T00:00:00.000Z"
  },
  split: {
    contentId: "content_rounding",
    splitVersionId: "split_rounding",
    lockedManifestSha256: "manifest_rounding",
    lockedFileSha256: null,
    splitsHash,
    lockedAt: "2026-02-10T00:00:00.000Z",
    participants
  },
  settlement: {
    settlementId: "settle_rounding",
    paymentRef: "pay_rounding",
    amountSats: 101,
    paidAt: "2026-02-10T00:00:00.000Z",
    contentId: "content_rounding",
    manifestSha256: "manifest_rounding",
    splitVersionId: "split_rounding",
    splitsHash
  },
  lines: [
    { recipientRef: "email:alice@example.com", bps: 7000, amountSats: 71 },
    { recipientRef: "email:bob@example.com", bps: 3000, amountSats: 30 }
  ]
});

const roundingResult = verifyBundle(bundle);
assert.equal(roundingResult.ok, true, `rounding bundle should verify: ${roundingResult.errors.join(", ")}`);

console.log("proof_bundle_verifier_test OK");
