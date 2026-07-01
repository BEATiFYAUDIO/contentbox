import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalPlayback } from "./publicPlayback.js";

test("free content with full access returns full playback", () => {
  const playback = buildCanonicalPlayback({
    hasFullAccess: true,
    fullStreamUrl: "https://creator.example/public/content/free/preview-file?objectKey=master.mp3",
    previewStreamUrl: "https://creator.example/public/content/free/preview-file?objectKey=preview.mp3",
    previewLimitSeconds: 25
  });

  assert.deepEqual(playback, {
    mode: "full",
    streamUrl: "https://creator.example/public/content/free/preview-file?objectKey=master.mp3",
    previewLimitSeconds: null,
    canPlayFull: true
  });
});

test("paid locked content returns preview playback when preview exists", () => {
  const playback = buildCanonicalPlayback({
    hasFullAccess: false,
    fullStreamUrl: "https://creator.example/public/content/paid/preview-file?objectKey=master.mp3",
    previewStreamUrl: "https://creator.example/public/content/paid/preview-file?objectKey=preview.mp3",
    previewLimitSeconds: 25
  });

  assert.deepEqual(playback, {
    mode: "preview",
    streamUrl: "https://creator.example/public/content/paid/preview-file?objectKey=preview.mp3",
    previewLimitSeconds: 25,
    canPlayFull: false,
    reason: "full_access_required"
  });
});

test("owned paid content returns full playback", () => {
  const playback = buildCanonicalPlayback({
    hasFullAccess: true,
    fullStreamUrl: "https://creator.example/public/content/owned/preview-file?objectKey=master.mp3",
    previewStreamUrl: "https://creator.example/public/content/owned/preview-file?objectKey=preview.mp3",
    previewLimitSeconds: 25
  });

  assert.equal(playback.mode, "full");
  assert.equal(playback.streamUrl, "https://creator.example/public/content/owned/preview-file?objectKey=master.mp3");
  assert.equal(playback.previewLimitSeconds, null);
  assert.equal(playback.canPlayFull, true);
});

test("locked content without preview returns no playback", () => {
  const playback = buildCanonicalPlayback({
    hasFullAccess: false,
    fullStreamUrl: null,
    previewStreamUrl: null,
    previewLimitSeconds: 25
  });

  assert.deepEqual(playback, {
    mode: "none",
    streamUrl: null,
    previewLimitSeconds: null,
    canPlayFull: false,
    reason: "preview_unavailable"
  });
});
