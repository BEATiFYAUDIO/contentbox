import "dotenv/config";
import assert from "node:assert/strict";

const apiBase = String(process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const contentId = String(process.env.CONTENT_ID || "").trim();
const receiptId = String(process.env.RECEIPT_ID || "").trim();
const requireDurable = String(process.env.REQUIRE_DURABLE || "1").trim() !== "0";

function isDurableOrigin(value: string | null | undefined): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    if (host.endsWith(".trycloudflare.com")) return false;
    return true;
  } catch {
    return false;
  }
}

async function getJson(url: string, method: "GET" | "POST" = "GET") {
  const res = await fetch(url, { method } as any);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function run() {
  const originRes = await getJson(`${apiBase}/api/public/origin`);
  assert.equal(originRes.status, 200, `/api/public/origin failed: ${originRes.text}`);

  const canonicalBuyerOrigin = String(originRes.json?.canonicalBuyerOrigin || "").trim() || null;
  const canonicalCommerceOrigin = String(originRes.json?.canonicalCommerceOrigin || "").trim() || null;
  const selectedOrigin = canonicalBuyerOrigin || canonicalCommerceOrigin;

  if (requireDurable) {
    assert.ok(Boolean(canonicalBuyerOrigin), "canonicalBuyerOrigin missing");
    assert.ok(isDurableOrigin(canonicalBuyerOrigin), `canonicalBuyerOrigin is not durable: ${canonicalBuyerOrigin}`);
    assert.equal(Boolean(originRes.json?.durableBuyerReady), true, `durableBuyerReady=false reasons=${JSON.stringify(originRes.json?.durableBuyerReasons || [])}`);
  }

  if (!selectedOrigin) {
    throw new Error("No canonical origin returned from /api/public/origin");
  }

  if (contentId) {
    const offerRes = await getJson(`${selectedOrigin.replace(/\/+$/, "")}/buy/content/${encodeURIComponent(contentId)}/offer`);
    assert.ok(offerRes.status < 500, `canonical offer route failed (${offerRes.status}): ${offerRes.text}`);
  }

  if (receiptId) {
    const receiptRes = await getJson(`${selectedOrigin.replace(/\/+$/, "")}/buy/receipts/r/${encodeURIComponent(receiptId)}/status`);
    assert.ok(receiptRes.status < 500, `durable receipt status failed (${receiptRes.status}): ${receiptRes.text}`);
  }

  console.log("public_host_smoke OK", {
    apiBase,
    selectedOrigin,
    canonicalBuyerOrigin,
    canonicalCommerceOrigin,
    durableBuyerReady: Boolean(originRes.json?.durableBuyerReady)
  });
}

run().catch((err) => {
  console.error("public_host_smoke FAIL", err?.message || err);
  process.exit(1);
});
