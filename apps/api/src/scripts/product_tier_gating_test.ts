import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");

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
    email: `tier+${Date.now()}@contentbox.local`,
    password: "password123"
  });
  assert.equal(signup.status, 200, `signup failed: ${signup.status}`);
  const token = signup.json?.token as string | undefined;
  assert.ok(token, "signup should return token");

  const identity = await getJson(`${baseUrl}/api/identity`, token);
  assert.equal(identity.status, 200, `identity failed: ${identity.status}`);
  const caps = identity.json?.capabilities || {};
  const productTier = identity.json?.productTier || "basic";
  const namedReady = Boolean(identity.json?.namedReady);

  const created = await postJson(
    `${baseUrl}/content`,
    { title: `[test] tier ${Date.now()}`, type: "song" },
    token
  );
  assert.equal(created.status, 200, `content create failed: ${created.status}`);
  const contentId = created.json?.id as string | undefined;
  assert.ok(contentId, "content create should return id");

  const publishRes = await postJson(`${baseUrl}/api/content/${contentId}/publish`, {}, token);
  if (productTier === "advanced" && !namedReady) {
    assert.equal(publishRes.status, 403, `expected 403 for publish, got ${publishRes.status}`);
    assert.equal(publishRes.json?.code, "advanced_not_active", "publish should be blocked by advanced_not_active");
  } else if (productTier === "basic") {
    assert.notEqual(publishRes.status, 403, "basic should allow publish");
  } else if (caps.publish === false) {
    assert.equal(publishRes.status, 403, `expected 403 for publish, got ${publishRes.status}`);
  } else {
    assert.notEqual(publishRes.status, 403, "publish should not be gated");
  }

  const lockRes = await postJson(`${baseUrl}/content/${contentId}/splits/1/lock`, {}, token);
  if (productTier === "advanced" && !namedReady) {
    assert.equal(lockRes.status, 403, `expected 403 for lock, got ${lockRes.status}`);
    assert.equal(lockRes.json?.code, "advanced_not_active", "lock should be blocked by advanced_not_active");
  } else if (caps.lockSplits === false) {
    assert.equal(lockRes.status, 403, `expected 403 for lock, got ${lockRes.status}`);
  } else {
    assert.notEqual(lockRes.status, 403, "lock should not be gated");
  }

  const inviteRes = await postJson(`${baseUrl}/split-versions/doesnotexist/invite`, {}, token);
  if (productTier === "advanced" && !namedReady) {
    assert.equal(inviteRes.status, 403, `expected 403 for invite, got ${inviteRes.status}`);
    assert.equal(inviteRes.json?.code, "advanced_not_active", "invite should be blocked by advanced_not_active");
  } else if (caps.sendInvite === false) {
    assert.equal(inviteRes.status, 403, `expected 403 for invite, got ${inviteRes.status}`);
  } else {
    assert.notEqual(inviteRes.status, 403, "invite should not be gated");
  }

  const clearanceRes = await postJson(`${baseUrl}/content-links/doesnotexist/request-approval`, {}, token);
  if (productTier === "advanced" && !namedReady) {
    assert.equal(clearanceRes.status, 403, `expected 403 for clearance, got ${clearanceRes.status}`);
    assert.equal(clearanceRes.json?.code, "advanced_not_active", "clearance should be blocked by advanced_not_active");
  } else if (caps.requestClearance === false) {
    assert.equal(clearanceRes.status, 403, `expected 403 for clearance, got ${clearanceRes.status}`);
  } else {
    assert.notEqual(clearanceRes.status, 403, "clearance should not be gated");
  }

  const proofRes = await getJson(`${baseUrl}/api/proofs/content/${contentId}`, token);
  if (productTier === "advanced" && !namedReady) {
    assert.equal(proofRes.status, 403, `expected 403 for proofs, got ${proofRes.status}`);
    assert.equal(proofRes.json?.code, "advanced_not_active", "proofs should be blocked by advanced_not_active");
  } else if (caps.proofBundles === false) {
    assert.equal(proofRes.status, 403, `expected 403 for proofs, got ${proofRes.status}`);
  } else {
    assert.notEqual(proofRes.status, 403, "proofs should not be gated");
  }
}

run()
  .then(() => {
    console.log("product_tier_gating_test OK");
    process.exit(0);
  })
  .catch((err) => {
    console.error("product_tier_gating_test FAILED", err);
    process.exit(1);
  });
