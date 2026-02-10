import fsSync from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { Agent } from "undici";
import { normalizeProviderIdFromLnd, providerIdToLndBase64 } from "../payments/lndHash.js";

function readMaybeFile(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("BEGIN")) return trimmed;
  if (fsSync.existsSync(trimmed)) {
    try {
      return fsSync.readFileSync(trimmed, "utf8");
    } catch {
      return null;
    }
  }
  return trimmed;
}

function maskLength(value: string) {
  if (!value) return "0";
  return String(value.length);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { dispatcher?: any },
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal } as any);
  } finally {
    clearTimeout(timer);
  }
}

function hasLndEnv() {
  return Boolean(
    String(process.env.LND_REST_URL || "").trim() &&
      String(process.env.LND_MACAROON_HEX || process.env.LND_MACAROON || "").trim()
  );
}

function loadEnvWithPriority() {
  const cwd = process.cwd();
  const envLocal = path.resolve(cwd, ".env.local");
  const envFile = path.resolve(cwd, ".env");
  const parsedLocal = fsSync.existsSync(envLocal) ? dotenv.parse(fsSync.readFileSync(envLocal)) : null;
  const parsedEnv = fsSync.existsSync(envFile) ? dotenv.parse(fsSync.readFileSync(envFile)) : null;

  dotenv.config({ path: envLocal, override: false });
  dotenv.config({ path: envFile, override: false });

  function sourceFor(name: string) {
    if (process.env[name]) return "process.env";
    if (parsedLocal && Object.prototype.hasOwnProperty.call(parsedLocal, name)) return ".env.local";
    if (parsedEnv && Object.prototype.hasOwnProperty.call(parsedEnv, name)) return ".env";
    return "not found";
  }

  return { sourceFor };
}

function printEnvHints() {
  console.error("Hints:");
  console.error("- Check process env (systemd/docker/pm2): printenv | grep LND_");
  console.error("- Check .env.local or .env in apps/api");
  console.error("- If using systemd: sudo systemctl cat <service> | grep LND_");
}

async function main() {
  const { sourceFor } = loadEnvWithPriority();
  const baseUrl = String(process.env.LND_REST_URL || "").replace(/\/$/, "");
  const macVal = process.env.LND_MACAROON_HEX || process.env.LND_MACAROON || "";
  const macaroon = readMaybeFile(macVal);
  const certPem = String(process.env.LND_TLS_CERT_PEM || "").trim();
  const certPath = String(process.env.LND_TLS_CERT_PATH || "").trim();
  const cert = certPem ? readMaybeFile(certPem) : certPath ? readMaybeFile(certPath) : null;
  const dispatcher = cert ? new Agent({ connect: { ca: cert } }) : undefined;

  if (!baseUrl || !macaroon) {
    console.error("Missing LND_REST_URL or LND_MACAROON_HEX/LND_MACAROON.");
    console.error("Env sources:", {
      LND_REST_URL: sourceFor("LND_REST_URL"),
      LND_MACAROON_HEX: sourceFor("LND_MACAROON_HEX"),
      LND_MACAROON: sourceFor("LND_MACAROON")
    });
    printEnvHints();
    process.exit(1);
  }
  if (!certPem && (!certPath || !fsSync.existsSync(certPath))) {
    console.error("Missing TLS cert. Set LND_TLS_CERT_PEM or valid LND_TLS_CERT_PATH.");
    console.error("Env sources:", {
      LND_TLS_CERT_PEM: sourceFor("LND_TLS_CERT_PEM"),
      LND_TLS_CERT_PATH: sourceFor("LND_TLS_CERT_PATH")
    });
    printEnvHints();
    process.exit(1);
  }

  console.log("Env sources:", {
    LND_REST_URL: sourceFor("LND_REST_URL"),
    LND_MACAROON_HEX: sourceFor("LND_MACAROON_HEX"),
    LND_MACAROON: sourceFor("LND_MACAROON"),
    LND_TLS_CERT_PEM: sourceFor("LND_TLS_CERT_PEM"),
    LND_TLS_CERT_PATH: sourceFor("LND_TLS_CERT_PATH")
  });
  console.log("LND REST:", baseUrl);
  console.log("Macaroon length:", maskLength(macaroon));
  console.log("TLS cert:", cert ? "provided" : "not provided");

  const headers = {
    "Grpc-Metadata-Macaroon": macaroon,
    "Content-Type": "application/json"
  };

  // Optional getinfo
  try {
    const res = await fetchWithTimeout(`${baseUrl}/v1/getinfo`, { method: "GET", headers, dispatcher } as any, 8000);
    if (res.ok) {
      const data = await res.json();
      console.log("getinfo OK:", { alias: data?.alias || null, pubkey: data?.identity_pubkey || null, network: data?.chains?.[0]?.network || null });
    } else {
      console.warn("getinfo failed:", await res.text());
    }
  } catch (e: any) {
    console.warn("getinfo error:", String(e?.message || e));
  }

  // Create invoice
  const memo = `ContentBox validation ${new Date().toISOString()}`;
  const invoiceRes = await fetchWithTimeout(
    `${baseUrl}/v1/invoices`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ value: 1, memo, expiry: 300, private: true }),
      dispatcher
    } as any,
    8000
  );
  const invoiceText = await invoiceRes.text();
  if (!invoiceRes.ok) {
    console.error("Invoice create failed:", invoiceText);
    process.exit(2);
  }
  const invoiceData: any = invoiceText ? JSON.parse(invoiceText) : null;
  const bolt11 = invoiceData?.payment_request || "";
  const rHashB64 = invoiceData?.r_hash || "";
  if (!bolt11 || !rHashB64) {
    console.error("Invoice response missing payment_request or r_hash.");
    process.exit(3);
  }

  const providerIdHex = normalizeProviderIdFromLnd(rHashB64);
  const roundTripB64 = providerIdToLndBase64(providerIdHex);

  console.log("invoice OK:", { bolt11Length: maskLength(bolt11), providerIdHex: providerIdHex.slice(0, 8) + "…" });
  console.log("r_hash round-trip:", rHashB64 === roundTripB64 ? "OK" : "MISMATCH");

  // Lookup invoice
  let lookupMethod: "hex" | "base64" = "hex";
  let lookupRes = await fetchWithTimeout(
    `${baseUrl}/v1/invoice/${encodeURIComponent(providerIdHex)}`,
    { method: "GET", headers, dispatcher } as any,
    8000
  );
  let lookupText = await lookupRes.text();
  if (!lookupRes.ok && lookupRes.status === 404) {
    lookupMethod = "base64";
    lookupRes = await fetchWithTimeout(
      `${baseUrl}/v1/invoice/${encodeURIComponent(roundTripB64)}`,
      { method: "GET", headers, dispatcher } as any,
      8000
    );
    lookupText = await lookupRes.text();
  }
  if (!lookupRes.ok) {
    console.error("Lookup failed:", lookupText);
    process.exit(4);
  }
  const lookupData: any = lookupText ? JSON.parse(lookupText) : null;
  const state = String(lookupData?.state || "").toUpperCase();
  const settled = state === "SETTLED" || Boolean(lookupData?.settled);
  console.log("lookup OK:", { method: lookupMethod, state: state || "UNKNOWN", settled });

  console.log("Validation complete.");
}

main().catch((err) => {
  console.error("Validation failed:", String(err?.message || err));
  process.exit(99);
});
