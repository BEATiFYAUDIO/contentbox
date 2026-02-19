import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function getJson(url: string) {
  const res = await fetch(url, { method: "GET" });
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
  const identity = await getJson(`${baseUrl}/api/identity`);
  if (identity.status !== 200 || identity.json?.nodeMode !== "advanced") {
    console.log("single_identity_guard_test SKIP (nodeMode not advanced)");
    return;
  }

  const email1 = `single-guard-${Date.now()}@contentbox.local`;
  const email2 = `single-guard-${Date.now()}-b@contentbox.local`;

  const first = await postJson(`${baseUrl}/auth/signup`, {
    email: email1,
    password: "password123"
  });

  if (first.status === 403 && first.json?.error === "SINGLE_IDENTITY_NODE") {
    console.log("single_identity_guard_test OK (node already locked)");
    return;
  }

  if (first.status === 409) {
    // email already exists; proceed to second signup check
  } else {
    assert.equal(first.status, 200, `expected signup to succeed or be blocked, got ${first.status}`);
  }

  const second = await postJson(`${baseUrl}/auth/signup`, {
    email: email2,
    password: "password123"
  });
  assert.equal(second.status, 403, `expected SINGLE_IDENTITY_NODE, got ${second.status}`);
  assert.equal(second.json?.error, "SINGLE_IDENTITY_NODE", "expected SINGLE_IDENTITY_NODE error code");

  console.log("single_identity_guard_test OK");
}

run().catch((err) => {
  console.error("single_identity_guard_test FAILED", err);
  process.exit(1);
});
