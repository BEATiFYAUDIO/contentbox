import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  normalizePrivateRequestHost,
  parsePrivateAllowedHosts,
  shouldBlockPrivateHostRequest
} from "./privateHostGuard.js";

function buildGuardedApp(env: { allowed?: string; broad?: string } = {}) {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (req: any, reply: any) => {
    const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").trim();
    if (
      host &&
      shouldBlockPrivateHostRequest({
        method: req.method,
        pathOrUrl: req.raw?.url || req.url || "/",
        host,
        privateAllowedHosts: env.allowed || "",
        allowAnyPublicHost: env.broad || ""
      })
    ) {
      return reply.code(404).send({ error: "Not Found" });
    }
  });

  app.get("/assets/app.js", async (_req, reply) => reply.type("application/javascript").send("console.log('ok');"));
  app.get("/me", async () => ({ id: "user_1" }));
  app.get("/buy/:contentId", async (req: any) => ({ contentId: req.params.contentId }));
  return app;
}

test("private host normalization is exact and strips valid ports", () => {
  assert.equal(normalizePrivateRequestHost("LOCALHOST:4000"), "localhost");
  assert.equal(normalizePrivateRequestHost("127.0.0.1:4000"), "127.0.0.1");
  assert.equal(normalizePrivateRequestHost("[::1]:4000"), "::1");
  assert.equal(normalizePrivateRequestHost("::1"), "::1");
  assert.equal(normalizePrivateRequestHost("ContentBox.LOCAL:4000"), "contentbox.local");
  assert.equal(normalizePrivateRequestHost("192.168.178.143.evil.example"), "192.168.178.143.evil.example");
  assert.equal(normalizePrivateRequestHost("192.168.178.143/bad"), null);
  assert.equal(normalizePrivateRequestHost("[::1]bad"), null);
  assert.equal(normalizePrivateRequestHost("contentbox.local:notaport"), null);
});

test("comma-separated private allowed hosts are normalized exactly", () => {
  const allowed = parsePrivateAllowedHosts(" 192.168.178.143, ContentBox.LOCAL:4000, [fd00::1]:4000 ");
  assert.equal(allowed.has("192.168.178.143"), true);
  assert.equal(allowed.has("contentbox.local"), true);
  assert.equal(allowed.has("fd00::1"), true);
  assert.equal(allowed.has("192.168.178.143.evil.example"), false);
});

test("loopback hosts can access private routes by default", async () => {
  const app = buildGuardedApp();
  await app.ready();

  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "localhost:4000" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "127.0.0.1:4000" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "[::1]:4000" } })).statusCode, 200);

  await app.close();
});

test("unallowlisted LAN hosts remain blocked from private routes and dashboard assets", async () => {
  const app = buildGuardedApp();
  await app.ready();

  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "192.168.178.143:4000" } })).statusCode, 404);
  assert.equal(
    (await app.inject({ method: "GET", url: "/assets/app.js", headers: { host: "192.168.178.143:4000" } })).statusCode,
    404
  );

  await app.close();
});

test("allowlisted LAN hosts can load dashboard assets and representative private API routes", async () => {
  const app = buildGuardedApp({ allowed: "192.168.178.143,contentbox.local" });
  await app.ready();

  const asset = await app.inject({ method: "GET", url: "/assets/app.js", headers: { host: "192.168.178.143:4000" } });
  assert.equal(asset.statusCode, 200);
  assert.match(asset.payload, /console\.log/);

  const privateApi = await app.inject({ method: "GET", url: "/me", headers: { host: "contentbox.local:4000" } });
  assert.equal(privateApi.statusCode, 200);

  await app.close();
});

test("private host allowlist does not use suffix, substring, prefix, or wildcard matching", async () => {
  const app = buildGuardedApp({ allowed: "192.168.178.143,*.local,contentbox.local" });
  await app.ready();

  assert.equal(
    (await app.inject({ method: "GET", url: "/me", headers: { host: "192.168.178.143.evil.example:4000" } })).statusCode,
    404
  );
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "badcontentbox.local:4000" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "other.local:4000" } })).statusCode, 404);

  await app.close();
});

test("malformed and arbitrary host values fail closed", async () => {
  const app = buildGuardedApp({ allowed: "192.168.178.143" });
  await app.ready();

  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "evil.example:4000" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "192.168.178.143/bad" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "[::1]bad" } })).statusCode, 404);

  await app.close();
});

test("broad public-host override still allows arbitrary private listener hosts", async () => {
  const app = buildGuardedApp({ broad: "1" });
  await app.ready();

  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { host: "arbitrary.example:4000" } })).statusCode, 200);

  await app.close();
});

test("existing public route behavior remains unchanged for untrusted hosts", async () => {
  const app = buildGuardedApp();
  await app.ready();

  const publicRoute = await app.inject({ method: "GET", url: "/buy/content_123", headers: { host: "arbitrary.example:4000" } });
  assert.equal(publicRoute.statusCode, 200);

  await app.close();
});
