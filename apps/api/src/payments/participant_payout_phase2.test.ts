import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = String(process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const token = String(process.env.AUTH_TOKEN || "").trim();
const providerIntentId = String(process.env.PROVIDER_PAYMENT_INTENT_ID || "").trim();

if (!token) {
  console.error("AUTH_TOKEN is required");
  process.exit(1);
}
if (!providerIntentId) {
  console.error("PROVIDER_PAYMENT_INTENT_ID is required");
  process.exit(1);
}

async function getJson(url: string, withAuth = true) {
  const res = await fetch(url, {
    headers: withAuth ? { Authorization: `Bearer ${token}` } : undefined
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function postJson(url: string, body: any, withAuth = true) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withAuth ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
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
  const intents = await getJson(`${baseUrl}/api/provider/payment-intents`);
  assert.equal(intents.status, 200, `provider intents fetch failed: ${intents.status}`);
  const target = (Array.isArray(intents.json?.items) ? intents.json.items : []).find((row: any) => row.id === providerIntentId);
  assert.ok(target, `provider payment intent not found: ${providerIntentId}`);
  assert.equal(target.payoutExecutionMode, "participant", "test requires payoutExecutionMode=participant");

  const beforeRows = await getJson(`${baseUrl}/api/provider/payment-intents/${encodeURIComponent(providerIntentId)}/participant-payouts`);
  assert.equal(beforeRows.status, 200, `participant payout fetch failed: ${beforeRows.status}`);
  const beforeCount = Array.isArray(beforeRows.json?.items) ? beforeRows.json.items.length : 0;

  const retry = await postJson(`${baseUrl}/api/provider/payment-intents/${encodeURIComponent(providerIntentId)}/retry-remittance`, {});
  assert.equal(retry.status, 409, `expected authority guard 409, got ${retry.status}`);
  assert.equal(retry.json?.error, "PARTICIPANT_PAYOUT_AUTHORITY", "expected participant authority guard error");

  const paymentIntentId = String(target.paymentIntentId || "").trim();
  assert.ok(paymentIntentId, "provider intent missing paymentIntentId");
  for (let i = 0; i < 3; i += 1) {
    const status = await getJson(`${baseUrl}/public/provider/payment-intents/${encodeURIComponent(paymentIntentId)}/status`, false);
    assert.equal(status.status, 200, `status poll ${i + 1} failed: ${status.status}`);
  }

  const afterRows = await getJson(`${baseUrl}/api/provider/payment-intents/${encodeURIComponent(providerIntentId)}/participant-payouts`);
  assert.equal(afterRows.status, 200, `participant payout post-check failed: ${afterRows.status}`);
  const afterCount = Array.isArray(afterRows.json?.items) ? afterRows.json.items.length : 0;
  assert.equal(afterCount, beforeCount, "participant payout row count changed under repeated settlement polling");
}

run()
  .then(() => {
    console.log("participant_payout_phase2_test OK");
    process.exit(0);
  })
  .catch((err) => {
    console.error("participant_payout_phase2_test FAILED", err);
    process.exit(1);
  });
