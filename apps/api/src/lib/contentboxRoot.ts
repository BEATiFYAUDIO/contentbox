import os from "node:os";
import path from "node:path";

const APP_DIR_NAME = "contentbox";
const APP_DIR_NAME_MAC = "ContentBox";

export type ContentboxRootResolution = {
  root: string;
  source: "env" | "fallback";
};

function assertCrossOsRootLooksSafe(explicit: string) {
  if (process.platform === "win32" && /^(\/home\/|\/users\/|\/var\/)/i.test(explicit)) {
    throw new Error(
      `Invalid CONTENTBOX_ROOT for Windows: "${explicit}". Unset CONTENTBOX_ROOT to use Windows defaults, or set a Windows path (for example C:\\contentbox-data).`
    );
  }
  if (process.platform !== "win32" && /^[a-zA-Z]:/.test(explicit)) {
    throw new Error(
      `Invalid CONTENTBOX_ROOT for ${process.platform}: "${explicit}". Unset CONTENTBOX_ROOT to use platform defaults, or set a POSIX path (for example /home/<user>/contentbox-data).`
    );
  }
}

export function resolveContentboxRootInfo(): ContentboxRootResolution {
  const explicit = String(process.env.CONTENTBOX_ROOT || "").trim();
  if (explicit) {
    assertCrossOsRootLooksSafe(explicit);
    return { root: path.resolve(explicit), source: "env" };
  }

  const home = os.homedir();
  if (process.platform === "win32") {
    const localAppData = String(process.env.LOCALAPPDATA || "").trim();
    if (localAppData) return { root: path.join(localAppData, APP_DIR_NAME_MAC), source: "fallback" };
    const appData = String(process.env.APPDATA || "").trim();
    if (appData) return { root: path.join(appData, APP_DIR_NAME_MAC), source: "fallback" };
    return { root: path.join(home, "AppData", "Local", APP_DIR_NAME_MAC), source: "fallback" };
  }

  if (process.platform === "darwin") {
    return { root: path.join(home, "Library", "Application Support", APP_DIR_NAME_MAC), source: "fallback" };
  }

  const xdgDataHome = String(process.env.XDG_DATA_HOME || "").trim();
  if (xdgDataHome) return { root: path.join(xdgDataHome, APP_DIR_NAME), source: "fallback" };
  return { root: path.join(home, ".local", "share", APP_DIR_NAME), source: "fallback" };
}

export function resolveContentboxRoot(): string {
  return resolveContentboxRootInfo().root;
}
