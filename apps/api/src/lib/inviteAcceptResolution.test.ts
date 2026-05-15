import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInviteAcceptanceIdentityWrites,
  mapRemoteInviteAcceptErrorCode,
  mapTerminalInviteStatusToCode,
  resolveInviteRecipientMatch
} from "./inviteAcceptResolution.js";

test("mapRemoteInviteAcceptErrorCode keeps explicit code", () => {
  assert.equal(mapRemoteInviteAcceptErrorCode(403, "INVITE_WRONG_RECIPIENT"), "INVITE_WRONG_RECIPIENT");
});

test("mapRemoteInviteAcceptErrorCode maps by status", () => {
  assert.equal(mapRemoteInviteAcceptErrorCode(401), "INVITE_AUTH_REQUIRED");
  assert.equal(mapRemoteInviteAcceptErrorCode(403), "INVITE_REMOTE_ACCEPT_DENIED");
  assert.equal(mapRemoteInviteAcceptErrorCode(404), "INVITE_NOT_FOUND");
  assert.equal(mapRemoteInviteAcceptErrorCode(409), "INVITE_CONFLICT");
});

test("mapTerminalInviteStatusToCode maps known statuses", () => {
  assert.equal(mapTerminalInviteStatusToCode("revoked"), "INVITE_REVOKED");
  assert.equal(mapTerminalInviteStatusToCode("tombstoned"), "INVITE_TOMBSTONED");
  assert.equal(mapTerminalInviteStatusToCode("declined"), "INVITE_DECLINED");
  assert.equal(mapTerminalInviteStatusToCode("expired"), "INVITE_EXPIRED");
});

test("resolveInviteRecipientMatch allows cross-node email identity without local DB id equality", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "remote_signature",
    targetType: "identity_ref",
    targetValue: "cmoremoteauthorityrow000001",
    attemptedUserId: "cmo8n1v6k0006xwyezum2ep23",
    effectiveEmail: "darryl@beatifygroup.com",
    participantEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "matched_participant_email");
});

test("resolveInviteRecipientMatch keeps direct local user id match working", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "local_auth",
    targetType: "local_user",
    targetValue: "user-a",
    attemptedUserId: "user-a"
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "matched_local_user");
});

test("resolveInviteRecipientMatch keeps local_user strict for remote signed acceptance", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "remote_signature",
    targetType: "local_user",
    targetValue: "user-a",
    attemptedUserId: "user-b",
    effectiveEmail: "darryl@beatifygroup.com",
    participantEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "target_mismatch");
});

test("resolveInviteRecipientMatch recovers stranded remote local_user target by signed email", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "remote_signature",
    targetType: "local_user",
    targetValue: "cmo8nmh7m0006uvyoxrcvj6ox",
    attemptedUserId: "cmo8n1v6k0006xwyezum2ep23",
    effectiveEmail: "darryl@beatifygroup.com",
    contentOwnerEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "matched_legacy_local_user_email_recovery");
});

test("resolveInviteRecipientMatch blocks stranded remote local_user target with wrong email", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "remote_signature",
    targetType: "local_user",
    targetValue: "cmo8nmh7m0006uvyoxrcvj6ox",
    attemptedUserId: "cmo8n1v6k0006xwyezum2ep23",
    effectiveEmail: "attacker@example.com",
    contentOwnerEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "target_mismatch");
});

test("resolveInviteRecipientMatch blocks mismatched remote recipient email", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "remote_signature",
    targetType: "identity_ref",
    targetValue: "cmoremoteauthorityrow000001",
    attemptedUserId: "cmo8n1v6k0006xwyezum2ep23",
    effectiveEmail: "attacker@example.com",
    participantEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "identity_ref_mismatch");
});

test("resolveInviteRecipientMatch supports legacy owner-email recovery for stranded internal identity_ref", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "remote_signature",
    targetType: "identity_ref",
    targetValue: "cmo8nmh7m0006uvyoxrcvj6ox",
    attemptedUserId: "cmo8n1v6k0006xwyezum2ep23",
    effectiveEmail: "darryl@beatifygroup.com",
    contentOwnerEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "matched_legacy_owner_email_recovery");
});

test("resolveInviteRecipientMatch accepts email invite case-insensitively", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "remote_signature",
    targetType: "email",
    targetValue: "Darryl@BeatifyGroup.com",
    attemptedUserId: "remote-user",
    effectiveEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, true);
  assert.equal(result.reason, "matched_email");
});

test("resolveInviteRecipientMatch rejects token-only identity_ref attempts", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "none",
    targetType: "identity_ref",
    targetValue: "cmo8nmh7m0006uvyoxrcvj6ox",
    attemptedUserId: "",
    effectiveEmail: "",
    participantEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "identity_ref_mismatch");
});

test("resolveInviteRecipientMatch keeps local auth strict for local user ids", () => {
  const result = resolveInviteRecipientMatch({
    authMode: "local_auth",
    targetType: "local_user",
    targetValue: "user-a",
    attemptedUserId: "user-b",
    effectiveEmail: "darryl@beatifygroup.com",
    participantEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "target_mismatch");
});

test("buildInviteAcceptanceIdentityWrites keeps remote user id out of local FK fields", () => {
  const result = buildInviteAcceptanceIdentityWrites({
    authMode: "remote_signature",
    userId: "remote-machine-user-id",
    remoteNodeUrl: "https://certifyd.beatifygroup.com",
    effectiveEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.acceptedByUserId, null);
  assert.equal(result.acceptedIdentityRef, "remote:https://certifyd.beatifygroup.com#user:remote-machine-user-id");
  assert.equal(result.splitParticipantUpdate.participantUserId, undefined);
  assert.equal(result.splitParticipantUpdate.participantEmail, undefined);
});

test("buildInviteAcceptanceIdentityWrites keeps local accept FK behavior", () => {
  const result = buildInviteAcceptanceIdentityWrites({
    authMode: "local_auth",
    userId: "local-authority-user-id",
    effectiveEmail: "darryl@beatifygroup.com"
  });
  assert.equal(result.acceptedByUserId, "local-authority-user-id");
  assert.equal(result.acceptedIdentityRef, "user:local-authority-user-id");
  assert.equal(result.splitParticipantUpdate.participantUserId, "local-authority-user-id");
});
