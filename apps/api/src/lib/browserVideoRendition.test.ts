import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { browserVideoObjectKey, createBrowserVideoRendition, isBrowserVideoObjectKey, needsBrowserVideoRendition } from "./browserVideoRendition.js";
import { mediaToolPath } from "./mediaTools.js";

const run = promisify(execFile);

test("browser rendition preserves the original and makes HEVC playable as H.264/AAC", async (t) => {
  try {
    await run(mediaToolPath("ffmpeg"), ["-version"]);
    await run(mediaToolPath("ffprobe"), ["-version"]);
  } catch {
    t.skip("FFmpeg and ffprobe are required for media integration testing");
    return;
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "certifyd-browser-video-"));
  try {
    const original = path.join(root, "original.mp4");
    const rendition = path.join(root, "previews", "browser.mp4");
    await fs.copyFile(fileURLToPath(new URL("../../../../scripts/fixtures/hevc-aac-1s.mp4", import.meta.url)), original);
    const originalBytes = await fs.readFile(original);
    assert.equal(await needsBrowserVideoRendition(original), true);
    await createBrowserVideoRendition({ sourcePath: original, outputPath: rendition });
    const { stdout } = await run(mediaToolPath("ffprobe"), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", rendition]);
    const streams = JSON.parse(stdout).streams;
    assert.equal(streams.find((stream: any) => stream.codec_type === "video")?.codec_name, "h264");
    assert.equal(streams.find((stream: any) => stream.codec_type === "video")?.pix_fmt, "yuv420p");
    assert.equal(streams.find((stream: any) => stream.codec_type === "audio")?.codec_name, "aac");
    const durationProbe = await run(mediaToolPath("ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", rendition]);
    assert.ok(Number(durationProbe.stdout.trim()) > 0.9, "the browser rendition must contain the full work");
    assert.equal(await needsBrowserVideoRendition(rendition), false);
    assert.deepEqual(await fs.readFile(original), originalBytes);
    const key = browserVideoObjectKey("work-1", "files/original.mp4");
    assert.equal(isBrowserVideoObjectKey("work-1", key), true);
    assert.equal(isBrowserVideoObjectKey("work-2", key), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
