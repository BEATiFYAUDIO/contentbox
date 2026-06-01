import test from "node:test";
import assert from "node:assert/strict";

import { deriveContributorProfilePath } from "./publicAttribution.js";

test("contributor profile path uses explicit profilePath when valid", () => {
  const out = deriveContributorProfilePath({
    profilePath: "/u/darrylhillock",
    displayName: "darrylhillock"
  });
  assert.equal(out, "/u/darrylhillock");
});

test("contributor profile path falls back to clean displayName handle", () => {
  const out = deriveContributorProfilePath({
    profilePath: null,
    displayName: "darrylhillock"
  });
  assert.equal(out, "/u/darrylhillock");
});

test("contributor profile path does not generate link for placeholder label", () => {
  const out = deriveContributorProfilePath({
    profilePath: null,
    displayName: "Contributor"
  });
  assert.equal(out, "");
});

