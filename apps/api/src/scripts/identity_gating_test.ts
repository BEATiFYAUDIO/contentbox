import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const expectLevel = String(process.env.EXPECT_IDENTITY_LEVEL || "BASIC").trim().toUpperCase();

async function postJson(url: string, body: any, token?: string | null) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

async function getJson(url: string, token?: string | null) {
  const res = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
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
  const signup = await postJson(`${baseUrl}/auth/signup`, {
    email: `gating+${Date.now()}@contentbox.local`,
    password: "password123"
  });
  assert.equal(signup.status, 200, `signup failed: ${signup.status}`);
  const token = signup.json?.token as string | undefined;
  assert.ok(token, "signup should return token");

  const created = await postJson(
    `${baseUrl}/content`,
    { title: `[test] gating ${Date.now()}`, type: "song" },
    token
  );
  assert.equal(created.status, 200, `content create failed: ${created.status}`);
  const contentId = created.json?.id as string | undefined;
  assert.ok(contentId, "content create should return id");

  const splits = await getJson(`${baseUrl}/content/${contentId}/splits`, token);

  if (expectLevel === "BASIC") {
    assert.equal(splits.status, 403, `expected 403 for gated endpoint in BASIC, got ${splits.status}`);
    assert.equal(splits.json?.error, "FEATURE_LOCKED", "expected FEATURE_LOCKED error code");
  } else if (expectLevel === "PERSISTENT") {
    assert.notEqual(splits.status, 403, "expected gated endpoint to be accessible in PERSISTENT");
  }
}

run()
  .then(() => {
    console.log("identity_gating_test OK");
    process.exit(0);
  })
  .catch((err) => {
    console.error("identity_gating_test FAILED", err);
    process.exit(1);
  });
