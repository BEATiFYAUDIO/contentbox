import assert from "node:assert/strict";
import { computeProofHash, computeSplitsHash, normalizeSplitsForProof } from "../lib/proof.js";

const payloadA = {
  proofVersion: 1,
  contentId: "content_1",
  splitVersion: "v1",
  lockedAt: "2026-02-01T00:00:00.000Z",
  manifestHash: "abc123",
  primaryFileSha256: "deadbeef",
  primaryFileObjectKey: "files/master.wav",
  splits: normalizeSplitsForProof([
    { participantId: "p2", participantEmail: "b@example.com", role: "writer", percent: "50" },
    { participantId: "p1", participantEmail: "a@example.com", role: "producer", percent: "50.000" }
  ]),
  creatorId: "user_1"
};

const payloadB = {
  creatorId: "user_1",
  splits: payloadA.splits,
  primaryFileObjectKey: "files/master.wav",
  primaryFileSha256: "deadbeef",
  manifestHash: "abc123",
  lockedAt: "2026-02-01T00:00:00.000Z",
  splitVersion: "v1",
  contentId: "content_1",
  proofVersion: 1
};

const h1 = computeProofHash(payloadA);
const h2 = computeProofHash(payloadB as any);
assert.equal(h1, h2, "proofHash should be stable across key ordering");

const splitsHash1 = computeSplitsHash(payloadA.splits);
const splitsHash2 = computeSplitsHash([
  { participantId: "p1", participantEmail: "a@example.com", role: "producer", percent: "50.000" },
  { participantId: "p2", participantEmail: "b@example.com", role: "writer", percent: "50" }
]);
assert.equal(splitsHash1, splitsHash2, "splitsHash should be stable across ordering");

const proofHashSame = computeProofHash(payloadA);
assert.equal(h1, proofHashSame, "proofHash should be stable across repeated runs");

console.log("proof_test OK", { proofHash: h1, splitsHash: splitsHash1 });
