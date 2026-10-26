import assert from "node:assert/strict";
import test from "node:test";
import { probePublicRoute } from "./publicRouteProbe.js";
const origin = "https://creator.example.com";
test("public verification distinguishes DNS failure from a stopped origin", async () => {
  const dns = await probePublicRoute(origin, "local", async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); });
  assert.match(dns.message!, /resolved by DNS/);
  assert.equal(dns.sameInstance, false);
  const gateway = await probePublicRoute(origin, "local", async () => new Response("", { status: 502 }));
  assert.match(gateway.message!, /HTTP 502.*127.0.0.1:4010/);
});
test("only this Core's boot identity verifies the route", async () => {
  for (const bootId of ["local", "other"]) {
    const result = await probePublicRoute(origin, "local", async url => {
      assert.equal(url, `${origin}/public/ping`);
      return Response.json({ bootId });
    });
    assert.equal(result.reachable, true);
    assert.equal(result.sameInstance, bootId === "local");
    assert.equal(result.message === null, bootId === "local");
  }
});
