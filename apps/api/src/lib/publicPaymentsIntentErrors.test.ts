import test from "node:test";
import assert from "node:assert/strict";
import { mapPublicPaymentsIntentError } from "./publicPaymentsIntentErrors.js";

test("maps prisma duplicate to pending purchase conflict", () => {
  const mapped = mapPublicPaymentsIntentError({ code: "P2002", message: "Unique constraint failed" });
  assert.equal(mapped.statusCode, 409);
  assert.equal(mapped.body.code, "PENDING_PURCHASE_EXISTS");
});

test("maps prisma table/column missing to payments not ready", () => {
  const mapped = mapPublicPaymentsIntentError({ code: "P2021", message: "table missing" });
  assert.equal(mapped.statusCode, 503);
  assert.equal(mapped.body.code, "PAYMENTS_NOT_READY");
});

test("maps node not configured to 502", () => {
  const mapped = mapPublicPaymentsIntentError(new Error("NODE_NOT_CONFIGURED"));
  assert.equal(mapped.statusCode, 502);
  assert.equal(mapped.body.code, "LIGHTNING_NOT_CONFIGURED");
});

test("maps connectivity failures to lightning unavailable", () => {
  const mapped = mapPublicPaymentsIntentError(new Error("connect ECONNREFUSED 127.0.0.1:8080"));
  assert.equal(mapped.statusCode, 502);
  assert.equal(mapped.body.code, "LIGHTNING_UNAVAILABLE");
});
