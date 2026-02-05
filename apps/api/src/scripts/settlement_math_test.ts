import assert from "node:assert/strict";
import { allocateByBps } from "../lib/settlement.js";

const pool = 101n;
const items = [
  { id: "a", bps: 5000 },
  { id: "b", bps: 3000 },
  { id: "c", bps: 2000 }
];

const alloc = allocateByBps(pool, items);
const total = alloc.reduce((s, i) => s + i.amountSats, 0n);
assert.equal(total, pool, "allocations must sum to pool");

const max = alloc.find((i) => i.id === "a")!;
assert.ok(max.amountSats >= alloc.find((i) => i.id === "b")!.amountSats);

const alloc2 = allocateByBps(pool, items);
assert.deepEqual(alloc, alloc2, "allocation should be deterministic");

console.log("settlement_math_test OK", alloc);
