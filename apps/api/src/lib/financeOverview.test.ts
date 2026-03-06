import test from "node:test";
import assert from "node:assert/strict";
import { computeFinanceOverviewFromIntents } from "./financeOverview.js";

test("seller revenue reflects invoice after settlement transition", () => {
  const now = new Date("2026-03-07T00:00:00.000Z");
  const createdAt = new Date("2026-03-06T23:50:00.000Z");
  const paidAt = new Date("2026-03-06T23:55:00.000Z");

  const before = computeFinanceOverviewFromIntents({
    now,
    intents: [
      {
        amountSats: 1000n,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        paidAt: null,
        lightningExpiresAt: new Date("2026-03-07T00:10:00.000Z")
      }
    ]
  });
  assert.equal(before.totals.salesSats, "0");
  assert.equal(before.totals.invoicesPaid, 0);
  assert.equal(before.totals.invoicesPending, 1);

  const after = computeFinanceOverviewFromIntents({
    now,
    intents: [
      {
        amountSats: 1000n,
        status: "paid",
        createdAt,
        updatedAt: paidAt,
        paidAt,
        lightningExpiresAt: new Date("2026-03-07T00:10:00.000Z")
      }
    ]
  });
  assert.equal(after.totals.salesSats, "1000");
  assert.equal(after.totals.invoicesPaid, 1);
  assert.equal(after.totals.invoicesPending, 0);
});
