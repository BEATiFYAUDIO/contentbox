import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { jsonSafe } from "./jsonSafe.js";

test("Cloudflare timestamps survive the API's JSON serialization hook", async () => {
  const app = Fastify();
  app.addHook("preSerialization", async (_request, _reply, payload) => jsonSafe(payload));
  app.get("/cloudflare", async () => ({
    fetchedAt: new Date("2026-10-19T09:00:00Z"),
    lastSyncAt: new Date("2026-10-19T10:00:00Z"),
    lastCheckedAt: new Date("2026-10-19T11:00:00Z"),
    connection: { lastSyncAt: null, lastCheckedAt: undefined },
    snapshots: [{ fetchedAt: new Date("2026-10-18T09:00:00Z") }]
  }));
  try {
    const response = await app.inject("/cloudflare");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      fetchedAt: "2026-10-19T09:00:00.000Z",
      lastSyncAt: "2026-10-19T10:00:00.000Z",
      lastCheckedAt: "2026-10-19T11:00:00.000Z",
      connection: { lastSyncAt: null },
      snapshots: [{ fetchedAt: "2026-10-18T09:00:00.000Z" }]
    });
  } finally {
    await app.close();
  }
});

test("existing BigInt, array, null, and ordinary object serialization remain intact", () => {
  assert.deepEqual(jsonSafe({ amount: 123n, paidAt: new Date("2026-10-19T12:00:00Z"), values: [null, 2n], absent: undefined }), {
    amount: "123", paidAt: "2026-10-19T12:00:00.000Z", values: [null, "2"], absent: undefined
  });
  assert.equal(jsonSafe(new Date(Number.NaN)), null);
});
