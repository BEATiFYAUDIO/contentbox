import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function mediaToolPath(tool: "ffmpeg" | "ffprobe"): string {
  try {
    const packageName = tool === "ffmpeg" ? "ffmpeg-static" : "@derhuerst/ffprobe-static";
    const bundled = require(packageName) as unknown;
    if (typeof bundled === "string" && fs.existsSync(bundled)) return bundled;
  } catch {
    // Development checkouts may use a system installation.
  }
  return tool;
}
