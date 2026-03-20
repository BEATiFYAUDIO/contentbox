import assert from "node:assert/strict";
import test from "node:test";
import { mapRemoteInviteAcceptErrorCode, mapTerminalInviteStatusToCode } from "./inviteAcceptResolution.js";

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
