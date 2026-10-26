import assert from "node:assert/strict";
import test from "node:test";
import { availablePreviewKey } from "./derivedPreview.js";
test("legacy paid media uses a generated clip without rewriting its published manifest", () => {
  const manifest = { primaryFile: "files/master.mp3", preview: null };
  const result = availablePreviewKey({contentId:"song",primaryKey:manifest.primaryFile,manifestPreview:manifest.preview,exists:key=>key==="previews/song-preview.mp3"});
  assert.equal(result,"previews/song-preview.mp3");
  assert.equal(manifest.preview,null);
});
test("preview selection never exposes a master, unrelated file, or nonexistent clip", () => {
  assert.equal(availablePreviewKey({contentId:"song",primaryKey:"files/master.mp3",manifestPreview:"files/master.mp3",exists:key=>key==="files/master.mp3"}),null);
  assert.equal(availablePreviewKey({contentId:"song",primaryKey:"previews/song-preview.mp3",exists:()=>true}),"previews/song-preview.mp4");
  assert.equal(availablePreviewKey({contentId:"song",primaryKey:"files/master.mp3",exists:()=>false}),null);
});
