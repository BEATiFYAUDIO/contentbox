import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { mediaToolPath } from "./mediaTools.js";

const run = promisify(execFile);

export function browserVideoObjectKey(contentId: string, sourceObjectKey: string): string {
  const sourceId = crypto.createHash("sha256").update(sourceObjectKey).digest("hex").slice(0, 12);
  return `previews/${contentId}-browser-${sourceId}.mp4`;
}

export function isBrowserVideoObjectKey(contentId: string, objectKey: string): boolean {
  return new RegExp(`^previews/${contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-browser-[a-f0-9]{12}\\.mp4$`).test(objectKey);
}

type ProbeStream = { codec_name?: string; pix_fmt?: string };

export async function needsBrowserVideoRendition(sourcePath: string): Promise<boolean> {
  const { stdout } = await run(mediaToolPath("ffprobe"), [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", sourcePath
  ], { maxBuffer: 1024 * 1024 });
  const streams = (JSON.parse(stdout).streams || []) as Array<ProbeStream & { codec_type?: string }>;
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("Video source has no video stream");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  return video.codec_name !== "h264" || video.pix_fmt !== "yuv420p" || Boolean(audio && audio.codec_name !== "aac");
}

export async function createBrowserVideoRendition(input: {
  sourcePath: string;
  outputPath: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporaryPath = `${input.outputPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp.mp4`;
  try {
    await run(mediaToolPath("ffmpeg"), [
      "-hide_banner", "-loglevel", "error", "-nostats", "-y", "-threads", "2",
      "-i", input.sourcePath, "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
      "-c:v", "libx264", "-profile:v", "main", "-level:v", "3.1", "-pix_fmt", "yuv420p",
      "-preset", "veryfast", "-crf", "24", "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart", temporaryPath
    ], { maxBuffer: 1024 * 1024 });
    const stat = await fs.stat(temporaryPath);
    if (stat.size === 0) throw new Error("Browser video rendition is empty");
    await fs.rename(temporaryPath, input.outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}
