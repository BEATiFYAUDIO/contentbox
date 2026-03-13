import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContentPublishReceiptPayload,
  computeCanonicalManifestHash,
  normalizeManifestForPublish
} from "./contentPublish.js";

test("canonical manifest hash is stable with key reordering", () => {
  const a = {
    contentId: "c1",
    title: "No strings",
    files: [{ objectKey: "files/a.mp4", sha256: "x" }],
    status: "published"
  };
  const b = {
    status: "published",
    files: [{ sha256: "x", objectKey: "files/a.mp4" }],
    title: "No strings",
    contentId: "c1"
  };

  const h1 = computeCanonicalManifestHash(a);
  const h2 = computeCanonicalManifestHash(b);
  assert.equal(h1, h2);
});

test("manifest normalization sets schemaVersion and manifestVersion", () => {
  const normalized = normalizeManifestForPublish({ contentId: "c1" });
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.manifestVersion, 1);
  assert.equal(normalized.contentId, "c1");
});

test("canonical manifest hash does not require endpoint URLs", () => {
  const manifest = {
    contentId: "c1",
    title: "Demo",
    files: [{ objectKey: "files/demo.mp4", sha256: "abc" }]
  };
  const hash = computeCanonicalManifestHash(manifest);
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64);
});

test("content publish receipt payload includes contentId and manifestHash bindings", () => {
  const payload = buildContentPublishReceiptPayload({
    contentId: "cmmm4pm4i000wuvfwhoon5oxo",
    manifestHash: "50c69e4956bbc3b396b02f480d0e8cb9f0fff536b974ecc7f5d50b80ce4a6b0f",
    title: "No strings",
    type: "video",
    primaryFile: "files/no-strings.mp4",
    publishedAt: "2026-03-12T00:00:00.000Z",
    creatorNodeId: "node:creator",
    providerNodeId: "node:provider"
  });

  assert.equal(payload.contentId, "cmmm4pm4i000wuvfwhoon5oxo");
  assert.equal(payload.manifestHash, "50c69e4956bbc3b396b02f480d0e8cb9f0fff536b974ecc7f5d50b80ce4a6b0f");
  assert.equal(payload.creatorNodeId, "node:creator");
  assert.equal(payload.providerNodeId, "node:provider");
});
