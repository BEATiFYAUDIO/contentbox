import assert from "node:assert/strict";
import test from "node:test";
import { createPublicServer } from "../publicServer.js";
import { getPublicRoutePolicy, isPublicRouteAllowed, PUBLIC_ROUTE_ALLOWLIST } from "./publicRoutePolicy.js";

test("public route allowlist includes representative public buyer and discovery routes", () => {
  const publicRoutes = [
    ["GET", "/"],
    ["GET", "/u/beatify-group"],
    ["GET", "/.well-known/certifyd-node"],
    ["GET", "/.well-known/contentbox"],
    ["GET", "/api/network/nodes"],
    ["GET", "/public/content/c_123"],
    ["GET", "/public/content/c_123/preview-file"],
    ["POST", "/buy/payments/intents"],
    ["GET", "/buy/receipts/r/receipt_123/status"],
    ["POST", "/api/buyer/bootstrap"],
    ["GET", "/api/buyer/entitlements?contentId=c_123"],
    ["POST", "/api/derivatives/remote-request"]
  ];

  for (const [method, path] of publicRoutes) {
    assert.equal(isPublicRouteAllowed(method, path), true, `${method} ${path}`);
  }
});

test("public route allowlist denies creator-private and operator-admin routes", () => {
  const sensitiveRoutes = [
    ["GET", "/me"],
    ["GET", "/content"],
    ["POST", "/content"],
    ["POST", "/api/content/c_123/publish"],
    ["GET", "/api/provider/payment-intents"],
    ["GET", "/api/network/provider/diagnostics"],
    ["GET", "/api/public/config"],
    ["POST", "/api/public/named-token"],
    ["POST", "/api/public/go"],
    ["GET", "/api/lightning/node/status"],
    ["POST", "/api/lightning/node/config"],
    ["POST", "/api/lightning/channels/open"],
    ["POST", "/api/lightning/peers/connect"],
    ["GET", "/api/diagnostics/status"],
    ["GET", "/api/receipts"]
  ];

  for (const [method, path] of sensitiveRoutes) {
    assert.equal(isPublicRouteAllowed(method, path), false, `${method} ${path}`);
  }
});

test("public listener fails closed even if a sensitive route is registered accidentally", async () => {
  const app = createPublicServer((publicApp: any) => {
    publicApp.get("/health", async () => ({ ok: true }));
    publicApp.get("/api/network/nodes", async () => ({ ok: true, nodes: [] }));
    publicApp.get("/api/provider/payment-intents", async () => ({ leaked: true }));
  });
  await app.ready();

  const allowed = await app.inject({ method: "GET", url: "/api/network/nodes" });
  assert.equal(allowed.statusCode, 200);

  const denied = await app.inject({
    method: "GET",
    url: "/api/provider/payment-intents",
    headers: { authorization: "Bearer valid-looking-token" }
  });
  assert.equal(denied.statusCode, 404);
  assert.match(denied.payload, /Not Found/);

  await app.close();
});

test("every declared public route has a classification and matchable policy", () => {
  assert.ok(PUBLIC_ROUTE_ALLOWLIST.length > 20);
  for (const entry of PUBLIC_ROUTE_ALLOWLIST) {
    assert.ok(entry.classification, entry.pattern);
    assert.ok(entry.note, entry.pattern);
    if (entry.pattern.includes(":")) continue;
    assert.deepEqual(getPublicRoutePolicy(entry.method, entry.pattern)?.classification, entry.classification, entry.pattern);
  }
});

test("public HEAD uses GET permissions without exposing private or POST-only routes", async () => {
  const routes = [
    "/buy/c_123",
    "/buy/content/c_123/offer",
    "/public/content/c_123/cover",
    "/public/content/c_123/preview-file",
    "/public/discoverable-content?limit=24"
  ];
  const app = createPublicServer((publicApp: any) => {
    for (const route of routes) {
      publicApp.get(route.split("?")[0], async (req: any, reply: any) => {
        assert.equal(req.headers.authorization, undefined);
        return reply.header("accept-ranges", "bytes").type("text/plain").send("public body");
      });
    }
    // Even accidentally registered GET handlers must not expose these routes.
    publicApp.get("/api/provider/payment-intents", async () => "private");
    publicApp.get("/buy/payments/intents", async () => "POST-only policy");
  });
  try {
    for (const url of routes) {
      const get = await app.inject({ method: "GET", url });
      const head = await app.inject({ method: "HEAD", url, headers: { authorization: "Bearer test" } });
      assert.equal(get.statusCode, 200, url);
      assert.equal(head.statusCode, 200, url);
      assert.equal(head.payload, "", url);
      for (const header of ["content-type", "content-length", "accept-ranges"]) {
        assert.equal(head.headers[header], get.headers[header], `${url}: ${header}`);
      }
      assert.match(String(head.headers["access-control-allow-methods"]), /\bHEAD\b/);
    }
    for (const url of ["/api/provider/payment-intents", "/buy/payments/intents", "/unknown"]) {
      assert.equal((await app.inject({ method: "HEAD", url })).statusCode, 404, url);
    }
  } finally {
    await app.close();
  }
});
