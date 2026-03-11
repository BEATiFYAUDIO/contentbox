import os from "node:os";
import path from "node:path";

function resolveDefaultRootByPlatform(): string {
  if (process.platform === "win32") {
    const base =
      String(process.env.LOCALAPPDATA || "").trim() ||
      String(process.env.APPDATA || "").trim() ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "ContentBox");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "ContentBox");
  }

  const xdgDataHome = String(process.env.XDG_DATA_HOME || "").trim();
  if (xdgDataHome) return path.join(xdgDataHome, "contentbox");
  return path.join(os.homedir(), ".local", "share", "contentbox");
}

export function resolveContentboxRoot(): string {
  const envRoot = String(process.env.CONTENTBOX_ROOT || "").trim();
  const root = envRoot || resolveDefaultRootByPlatform();
  return path.resolve(root);
}

