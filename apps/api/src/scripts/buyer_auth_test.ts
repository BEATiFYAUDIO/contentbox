import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");

function firstCookie(setCookie: string | null): string | null {
  return String(setCookie || "").split(";")[0] || null;
}

async function requestJson(path: string, init: RequestInit = {}, cookie?: string | null) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(cookie ? { Cookie: cookie } : {})
    }
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, setCookie: res.headers.get("set-cookie") };
}

async function run() {
  const boot = await requestJson("/api/buyer/bootstrap", { method: "POST" });
  assert.equal(boot.status, 200, `/api/buyer/bootstrap failed: ${boot.status} ${boot.text}`);
  assert.ok(boot.json?.buyer?.id, "bootstrap should return buyer.id");

  const cookie = firstCookie(boot.setCookie);
  assert.ok(cookie, "bootstrap should set buyer session cookie");

  const me = await requestJson("/api/buyer/me", { method: "GET" }, cookie);
  assert.equal(me.status, 200, `/api/buyer/me failed: ${me.status} ${me.text}`);
  assert.equal(me.json?.buyer?.id, boot.json.buyer.id, "buyer session should round-trip through cookie");

  const logout = await requestJson("/api/buyer/logout", { method: "POST" }, cookie);
  assert.equal(logout.status, 200, `/api/buyer/logout failed: ${logout.status} ${logout.text}`);

  console.log("buyer_auth_test OK");
}

run().catch((err) => {
  console.error("buyer_auth_test FAILED", err);
  process.exit(1);
});
