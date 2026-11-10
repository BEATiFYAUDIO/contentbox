import assert from "node:assert/strict";
import test from "node:test";
import { recoverAcceptedRemoteIdentity, type AcceptanceAudit } from "./participantOriginRecovery.js";

const userId = "collaborator_user";
const origin = "https://collaborator.example.test";
const ref = `remote:${origin}#user:${userId}`;
const event = (changes: Record<string, unknown> = {}): AcceptanceAudit => ({
  id: "acceptance_1", action: "invite.accept", entityType: "SplitVersion", entityId: "split_1",
  payloadJson: { acceptanceAuthMode: "remote_signature", remoteVerified: true, signature: "historically-verified-signature",
    participantUserId: userId, remoteUserId: userId, remoteNodeUrl: origin, acceptedIdentityRef: ref,
    splitParticipantId: "old_deleted_row", signedPayload: { remoteUserId: userId, nodeUrl: origin, token: "fixture", nonce: "fixture", aud: "https://author.example.test", ts: "2026-05-31T00:00:00Z" }, ...changes }
});
const recover = (events: AcceptanceAudit[], overrides = {}) => recoverAcceptedRemoteIdentity({
  splitVersionId: "split_1", participantUserId: userId, accepted: true, acceptedIdentityRef: `user:${userId}`, events, ...overrides
});

test("recovers origin after draft-save recreated the participant row in the same split", () => {
  const result = recover([event()]);
  assert.equal(result.identityRef, ref);
  assert.equal(result.source, "verified_acceptance_audit");
  assert.deepEqual(result.evidenceIds, ["acceptance_1"]);
});
test("never changes existing signed remote binding, including a remapped legacy user ID", () => {
  assert.equal(recover([], { acceptedIdentityRef: ref, participantUserId: "legacy_local_id" }).identityRef, ref);
});
test("duplicate verified acceptances at one origin are unambiguous", () => {
  assert.equal(recover([event(), { ...event(), id: "acceptance_2" }]).origin, origin);
});
test("refuses conflicting verified origins for the same collaborator", () => {
  const other = "https://other.example.test";
  const p: any = event().payloadJson;
  const alternative = event({ remoteNodeUrl: other, acceptedIdentityRef: `remote:${other}#user:${userId}`, signedPayload: { ...p.signedPayload, nodeUrl: other } });
  assert.equal(recover([event(), alternative]).source, "ambiguous");
  assert.equal(recover([event(), alternative]).identityRef, null);
});
test("does not use another split version, another user, unsigned, or unverified evidence", () => {
  for (const candidate of [
    { ...event(), entityId: "other_split" }, { ...event(), entityType: "Invitation" },
    event({ remoteVerified: false }), event({ signature: "" }), event({ acceptanceAuthMode: "local_auth" }),
    event({ participantUserId: "other_user" }), event({ remoteUserId: "other_user" }),
    event({ signedPayload: null }), event({ remoteNodeUrl: "https://wrong.example.test" })
  ]) assert.equal(recover([candidate]).identityRef, null);
});
test("does not guess for pending/revoked participants or a conflicting current identity", () => {
  assert.equal(recover([event()], { accepted: false }).identityRef, null);
  assert.equal(recover([event()], { acceptedIdentityRef: "user:someone_else" }).identityRef, null);
  assert.equal(recover([]).identityRef, null);
});
test("rejects local, credential-bearing and non-origin URLs in recovery evidence", () => {
  const p: any = event().payloadJson;
  for (const unsafe of ["http://collaborator.example.test", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://host.local", "https://user:pass@example.test", "https://example.test/path", "https://example.test?query=1"]) {
    assert.equal(recover([event({ remoteNodeUrl: unsafe, acceptedIdentityRef: `remote:${unsafe}#user:${userId}`, signedPayload: { ...p.signedPayload, nodeUrl: unsafe } })]).identityRef, null);
  }
});
test("does not mutate original acceptance evidence or store a wallet address", () => {
  const e = event(); const before = JSON.stringify(e);
  const result = recover([e]);
  assert.equal(JSON.stringify(e), before);
  assert.equal(Object.hasOwn(result, "destinationValue"), false);
});
