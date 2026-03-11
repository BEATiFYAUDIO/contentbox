import os from "node:os";
import path from "node:path";

const APP_DIR_NAME = "contentbox";
const APP_DIR_NAME_MAC = "ContentBox";

export function resolveContentboxRoot(): string {
  const explicit = String(process.env.CONTENTBOX_ROOT || "").trim();
  if (explicit) return path.resolve(explicit);

  const home = os.homedir();
  if (process.platform === "win32") {
    const localAppData = String(process.env.LOCALAPPDATA || "").trim();
    if (localAppData) return path.join(localAppData, APP_DIR_NAME_MAC);
    const appData = String(process.env.APPDATA || "").trim();
    if (appData) return path.join(appData, APP_DIR_NAME_MAC);
    return path.join(home, "AppData", "Local", APP_DIR_NAME_MAC);
  }

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_DIR_NAME_MAC);
  }

  const xdgDataHome = String(process.env.XDG_DATA_HOME || "").trim();
  if (xdgDataHome) return path.join(xdgDataHome, APP_DIR_NAME);
  return path.join(home, ".local", "share", APP_DIR_NAME);
}
