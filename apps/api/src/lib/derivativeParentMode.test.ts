import test from "node:test";
import assert from "node:assert/strict";
import { resolveDerivativeParentMode } from "./derivativeParentMode.js";

test("requires local locked split for local parent", () => {
  const mode = resolveDerivativeParentMode({
    parent: {
      description: null,
      repoPath: "/tmp/repo",
      deletedReason: null
    }
  });
  assert.equal(mode.remoteOrigin, null);
  assert.equal(mode.requiresLocalLockedSplit, true);
});

test("treats shadow remote parent as remote authority", () => {
  const mode = resolveDerivativeParentMode({
    parent: {
      description: "Remote origin: https://certifydlink.darrylhillock.com",
      repoPath: null,
      deletedReason: "hard"
    }
  });
  assert.equal(mode.remoteOrigin, "https://certifydlink.darrylhillock.com");
  assert.equal(mode.requiresLocalLockedSplit, false);
});

test("uses explicit parent origin when creating a new remote shadow parent", () => {
  const mode = resolveDerivativeParentMode({
    parent: null,
    parentOrigin: "https://certifydlink.darrylhillock.com/"
  });
  assert.equal(mode.remoteOrigin, "https://certifydlink.darrylhillock.com");
  assert.equal(mode.requiresLocalLockedSplit, false);
});
