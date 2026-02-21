import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {};

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

loadEnv(path.join(root, ".env"));
loadEnv(path.join(root, ".env.local"));

const apiBase = (env.VITE_API_URL || "").trim().replace(/\/+$/, "");
console.log(`VITE_API_URL=${apiBase || "(not set)"}`);

if (!apiBase) {
  process.exit(1);
}

execSync(`curl -sS ${apiBase}/health`, { stdio: "inherit" });
console.log("");
execSync(`curl -sS ${apiBase}/__whoami`, { stdio: "inherit" });
console.log("");
