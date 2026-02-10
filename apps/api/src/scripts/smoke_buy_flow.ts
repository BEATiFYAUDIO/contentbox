import { execFile } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Json = Record<string, any>;

function maskToken(value: string | null | undefined) {
  if (!value) return "none";
  return `${value.slice(0, 6)}…`;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ status: number; json?: Json; text?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal } as any);
    const text = await res.text();
    if (!text) return { status: res.status };
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status, text };
    }
  } finally {
    clearTimeout(timer);
  }
}

function getEnvOrArg(name: string) {
  const env = process.env[name];
  if (env) return env;
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return "";
  return arg.split("=").slice(1).join("=");
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

async function main() {
  const { sourceFor } = loadEnvWithPriority();
  const apiBase = getEnvOrArg("API_BASE") || "http://127.0.0.1:4000";
  const contentId = getEnvOrArg("CONTENT_ID");
  const amountOverride = getEnvOrArg("AMOUNT_SATS");
  const manifestOverride = getEnvOrArg("MANIFEST_SHA256");
  const autoPay = String(getEnvOrArg("AUTO_PAY") || "").toLowerCase() === "true";
  const authToken = getEnvOrArg("AUTH_TOKEN");
  const headers = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
  };

  if (!contentId) {
    console.error("Missing CONTENT_ID. Example: CONTENT_ID=<id> npm run smoke:buy");
    console.error("CONTENT_ID source:", sourceFor("CONTENT_ID"));
    process.exit(2);
  }

  let amountSats = amountOverride ? Number(amountOverride) : 0;
  let manifestSha256 = manifestOverride || "";

  if (!amountSats || !manifestSha256) {
    const offerRes = await fetchJson(`${apiBase}/p2p/content/${encodeURIComponent(contentId)}/offer`);
    if (offerRes.status !== 200 || !offerRes.json) {
      console.error("Offer lookup failed. Provide AMOUNT_SATS and MANIFEST_SHA256 explicitly.");
      process.exit(2);
    }
    if (!amountSats) amountSats = Number(offerRes.json?.priceSats || 0);
    if (!manifestSha256) manifestSha256 = String(offerRes.json?.manifestSha256 || "");
  }

  if (!amountSats || !manifestSha256) {
    console.error("Missing amountSats or manifestSha256. Check offer endpoint or pass overrides.");
    process.exit(2);
  }

  const intentPayload = {
    purpose: "CONTENT_PURCHASE",
    subjectType: "CONTENT",
    subjectId: contentId,
    manifestSha256,
    amountSats: String(amountSats)
  };

  const intentRes = await fetchJson(`${apiBase}/api/payments/intents`, {
    method: "POST",
    headers,
    body: JSON.stringify(intentPayload)
  });
  if (intentRes.status !== 200 || !intentRes.json) {
    console.error("Create intent failed:", {
      status: intentRes.status,
      response: intentRes.json || intentRes.text || null,
      bodyKeys: Object.keys(intentPayload),
      authAttached: Boolean(authToken)
    });
    if (intentRes.status === 404 || intentRes.status === 403) {
      console.error(
        "Hint: content must be published and storefront enabled for public purchase. " +
          "If testing as owner, set AUTH_TOKEN to bypass public gating."
      );
      if (intentRes.status === 403) {
        console.error("Forbidden reason:", intentRes.json?.reason || "unknown");
      }
    }
    process.exit(1);
  }
  const intentId = intentRes.json.intentId as string;
  const bolt11 = intentRes.json?.lightning?.bolt11 as string | undefined;
  const providerId = intentRes.json?.providerId || intentRes.json?.providerIdHex;

  console.log("intent OK:", { intentId, bolt11Length: bolt11 ? String(bolt11.length) : "none", providerId: providerId ? String(providerId).slice(0, 8) + "…" : "none" });

  if (autoPay) {
    if (!bolt11) {
      console.error("AUTO_PAY requested but no lightning invoice returned.");
      process.exit(2);
    }
    try {
      await execFileAsync("lncli", ["payinvoice", "--force", bolt11], { timeout: 120000 });
      console.log("lncli payinvoice: OK");
    } catch (e: any) {
      console.error("lncli payinvoice failed or not available.");
      process.exit(2);
    }
  } else {
    console.log("Payment required. Pay the invoice and then re-run with AUTO_PAY=true or call refresh.");
  }

  const start = Date.now();
  let receiptToken: string | null = null;
  let lastStatus = "pending";
  while (Date.now() - start < 60000) {
    const refreshRes = await fetchJson(
      `${apiBase}/api/payments/intents/${encodeURIComponent(intentId)}/refresh`,
      { method: "POST", headers, body: "{}" },
      8000
    );
    if (refreshRes.status !== 200 || !refreshRes.json) {
      console.error("Refresh failed:", refreshRes.json || refreshRes.text || refreshRes.status);
      process.exit(1);
    }
    lastStatus = String(refreshRes.json?.status || refreshRes.json?.intent?.status || "pending");
    receiptToken = refreshRes.json?.receiptToken || refreshRes.json?.intent?.receiptToken || null;
    if (receiptToken) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!receiptToken) {
    console.error("No receipt token minted yet. Status:", lastStatus);
    process.exit(1);
  }

  console.log("receipt OK:", { receiptToken: maskToken(receiptToken) });

  const fulfillRes = await fetchJson(`${apiBase}/public/receipts/${encodeURIComponent(receiptToken)}/fulfill`, { headers });
  if (fulfillRes.status !== 200 || !fulfillRes.json) {
    console.error("Fulfill failed:", fulfillRes.json || fulfillRes.text || fulfillRes.status);
    process.exit(1);
  }
  const objectKey = fulfillRes.json?.objectKey || fulfillRes.json?.file?.objectKey || null;
  if (!objectKey) {
    console.error("Fulfill missing objectKey.");
    process.exit(1);
  }

  const headRes = await fetch(
    `${apiBase}/public/receipts/${encodeURIComponent(receiptToken)}/file?objectKey=${encodeURIComponent(objectKey)}`,
    { method: "HEAD", headers }
  );
  if (headRes.status < 200 || headRes.status >= 300) {
    console.error("Stream HEAD failed:", headRes.status);
    process.exit(1);
  }

  console.log("stream OK:", { status: headRes.status });
  console.log("smoke_buy_flow OK");
}

main().catch((err) => {
  console.error("smoke_buy_flow FAILED:", String(err?.message || err));
  process.exit(1);
});
