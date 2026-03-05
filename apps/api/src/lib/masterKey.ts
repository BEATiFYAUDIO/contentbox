import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const KEY_DIR = path.join(os.homedir(), ".config", "contentbox", "keys");
const KEY_PATH = path.join(KEY_DIR, "master.key");

function parseEnvKey(raw: string): Buffer {
  const v = String(raw || "").trim();
  if (!v) throw new Error("CONFIG_ENCRYPTION_KEY is empty");
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  const b = Buffer.from(v, "base64");
  if (b.length !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must decode to 32 bytes");
  return b;
}

function ensureDirSecure(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
}

function writeFileAtomicSecure(filePath: string, data: Buffer) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
}

export function getOrCreateMasterKey(): Buffer {
  const envKey = String(process.env.CONFIG_ENCRYPTION_KEY || "").trim();
  if (envKey) return parseEnvKey(envKey);

  ensureDirSecure(KEY_DIR);

  if (fs.existsSync(KEY_PATH)) {
    const b = fs.readFileSync(KEY_PATH);
    if (b.length !== 32) throw new Error("Invalid master key length");
    try {
      fs.chmodSync(KEY_PATH, 0o600);
    } catch {}
    return b;
  }

  const key = crypto.randomBytes(32);
  writeFileAtomicSecure(KEY_PATH, key);
  return key;
}

