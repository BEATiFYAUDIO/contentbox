import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const token = process.env.AUTH_TOKEN || "";

if (!token) {
  throw new Error("AUTH_TOKEN is required to run finance_routes_test");
}

async function getJson(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
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
  const overview = await getJson("/finance/overview");
  assert.equal(overview.status, 200, `overview status ${overview.status}`);
  assert.ok(overview.json?.totals, "overview.totals missing");

  const royalties = await getJson("/finance/royalties");
  assert.equal(royalties.status, 200, `royalties status ${royalties.status}`);
  assert.ok(Array.isArray(royalties.json?.items), "royalties.items missing");

  const payouts = await getJson("/finance/payouts");
  assert.equal(payouts.status, 200, `payouts status ${payouts.status}`);
  assert.ok(Array.isArray(payouts.json?.items), "payouts.items missing");

  const transactions = await getJson("/finance/transactions");
  assert.equal(transactions.status, 200, `transactions status ${transactions.status}`);
  assert.ok(Array.isArray(transactions.json?.items), "transactions.items missing");

  const rails = await getJson("/finance/payment-rails");
  assert.equal(rails.status, 200, `payment-rails status ${rails.status}`);

  console.log("finance_routes_test ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
