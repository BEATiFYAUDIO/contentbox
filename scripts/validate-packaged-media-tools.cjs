#!/usr/bin/env node
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const apiDir = path.resolve(process.argv[2] || "");
const fixture = path.resolve(process.argv[3] || "");
assert.ok(fs.existsSync(path.join(apiDir, "package.json")), "Packaged API is missing");
assert.ok(fs.existsSync(fixture), "HEVC test fixture is missing");
const packagedRequire = createRequire(path.join(apiDir, "package.json"));
const ffmpeg = packagedRequire("ffmpeg-static");
const ffprobe = packagedRequire("@derhuerst/ffprobe-static");
for (const [name, binary, license] of [
  ["ffmpeg", ffmpeg, "ffmpeg.LICENSE"],
  ["ffprobe", ffprobe, "ffprobe.LICENSE"]
]) {
  assert.equal(typeof binary, "string", `${name} path is invalid`);
  assert.ok(path.resolve(binary).startsWith(path.join(apiDir, "node_modules") + path.sep), `${name} is not bundled`);
  assert.ok(fs.statSync(binary).size > 0, `${name} binary is empty`);
  assert.ok(fs.existsSync(path.join(path.dirname(binary), license)), `${name} license is missing`);
  execFileSync(binary, ["-version"], { stdio: "ignore", timeout: 10000 });
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-package-media-"));
try {
  const output = path.join(scratch, "browser.mp4");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-nostats", "-y", "-threads", "2",
    "-i", fixture, "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
    "-c:v", "libx264", "-profile:v", "main", "-level:v", "3.1", "-pix_fmt", "yuv420p",
    "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output
  ], { stdio: "pipe", timeout: 60000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(execFileSync(ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", output
  ], { encoding: "utf8", timeout: 10000 }));
  const video = result.streams.find((stream) => stream.codec_type === "video");
  const audio = result.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(video?.codec_name, "h264");
  assert.equal(video?.pix_fmt, "yuv420p");
  assert.equal(audio?.codec_name, "aac");
  console.log(`Packaged HEVC -> H.264/AAC conversion passed (${process.platform}/${process.arch})`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
