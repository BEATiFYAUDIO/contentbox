import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type NodeMode = "basic" | "advanced" | "lan";

export type NodeConfig = {
  nodeMode: NodeMode;
  updatedAt: string;
};

const CONTENTBOX_ROOT = String(process.env.CONTENTBOX_ROOT || "").trim();
const CONFIG_DIR = CONTENTBOX_ROOT ? path.join(CONTENTBOX_ROOT, "state") : "";
const CONFIG_PATH = CONFIG_DIR ? path.join(CONFIG_DIR, "node_config.json") : "";

function isValidNodeMode(value: unknown): value is NodeMode {
  return value === "basic" || value === "advanced" || value === "lan";
}

export async function readNodeConfig(): Promise<NodeConfig | null> {
  if (!CONFIG_PATH) return null;
  try {
    const raw = await fsp.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!isValidNodeMode(parsed?.nodeMode)) return null;
    const updatedAt = typeof parsed?.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString();
    return { nodeMode: parsed.nodeMode, updatedAt };
  } catch {
    return null;
  }
}

export function readNodeConfigSync(): NodeConfig | null {
  if (!CONFIG_PATH) return null;
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!isValidNodeMode(parsed?.nodeMode)) return null;
    const updatedAt = typeof parsed?.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString();
    return { nodeMode: parsed.nodeMode, updatedAt };
  } catch {
    return null;
  }
}

export async function writeNodeConfig(nodeMode: NodeMode): Promise<NodeConfig> {
  if (!CONFIG_PATH) throw new Error("CONTENTBOX_ROOT not set; cannot persist node mode.");
  const cfg: NodeConfig = { nodeMode, updatedAt: new Date().toISOString() };
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2), "utf8");
  await fsp.rename(tmp, CONFIG_PATH);
  return cfg;
}

export function validateNodeMode(value: unknown): NodeMode | null {
  if (isValidNodeMode(value)) return value;
  return null;
}
