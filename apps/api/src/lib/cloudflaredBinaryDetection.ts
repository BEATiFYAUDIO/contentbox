import fs from "node:fs";
import path from "node:path";

export function findCloudflaredBinary(input: {
  configuredPath?: string;
  managedDir: string;
  platform: NodeJS.Platform;
  pathEnv?: string;
}): string | null {
  const name = input.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const systemDirs = input.platform === "win32"
    ? ["C:\\Program Files\\cloudflared", "C:\\Program Files (x86)\\cloudflared"]
    : input.platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
      : ["/usr/local/bin", "/usr/bin", "/bin"];
  const candidates = [
    input.configuredPath,
    path.join(input.managedDir, name),
    ...(input.pathEnv || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name)),
    ...systemDirs.map((dir) => path.join(dir, name))
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, input.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}
