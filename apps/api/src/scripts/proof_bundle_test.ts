import assert from "node:assert/strict";
import {
  buildBundle,
  computeBundleHash,
  computeSplitsHash,
  type ProofBundleV1,
  type SplitParticipantRef
} from "../lib/proofs/proofBundle.js";

const participants: SplitParticipantRef[] = [
  { recipientRef: "email:b@example.com", bps: 4000 },
  { recipientRef: "email:a@example.com", bps: 6000 }
];

const splitsHashA = computeSplitsHash({
  splitVersionId: "split_1",
  contentId: "content_1",
  lockedManifestSha256: "manifest_abc",
  participants
});

const splitsHashB = computeSplitsHash({
  splitVersionId: "split_1",
  contentId: "content_1",
  lockedManifestSha256: "manifest_abc",
  participants: [...participants].reverse()
});

assert.equal(splitsHashA, splitsHashB, "splitsHash should be stable across participant order");

const baseParams: Omit<ProofBundleV1, "bundleHash"> = {
  version: "v1",
  generatedAt: "2026-02-01T00:00:00.000Z",
  publish: {
    contentId: "content_1",
    manifestSha256: "manifest_abc",
    splitVersionId: "split_1",
    splitsHash: splitsHashA,
    publishedAt: "2026-02-01T00:00:00.000Z"
  },
  split: {
    contentId: "content_1",
    splitVersionId: "split_1",
    lockedManifestSha256: "manifest_abc",
    lockedFileSha256: null,
    splitsHash: splitsHashA,
    lockedAt: "2026-02-01T00:00:00.000Z",
    participants
  },
  canonicalOrigin: "https://contentbox.example.com"
};

const bundleA = buildBundle(baseParams);
const bundleB = buildBundle({
  split: baseParams.split,
  publish: baseParams.publish,
  generatedAt: baseParams.generatedAt,
  version: "v1",
  canonicalOrigin: baseParams.canonicalOrigin
});

assert.equal(bundleA.bundleHash, bundleB.bundleHash, "bundleHash should be stable across key ordering");

const withSignature: ProofBundleV1 = {
  ...bundleA,
  signatures: [
    {
      scheme: "pgp",
      signerRef: "did:example:alice",
      signature: "sig",
      signedAt: "2026-02-01T00:00:00.000Z"
    }
  ]
};

const recomputed = computeBundleHash(withSignature);
assert.equal(recomputed, bundleA.bundleHash, "bundleHash should ignore signatures");

console.log("proof_bundle_test OK", { splitsHash: splitsHashA, bundleHash: bundleA.bundleHash });
