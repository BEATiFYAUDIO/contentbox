import assert from "node:assert/strict";
import { sumBps } from "../lib/settlement.js";

const upstream = [{ bps: 3000 }, { bps: 7000 }];
assert.equal(sumBps(upstream), 10000);
assert.ok(sumBps(upstream) <= 10000);

const tooHigh = [{ bps: 9000 }, { bps: 2000 }];
assert.ok(sumBps(tooHigh) > 10000);

const split = [{ bps: 5000 }, { bps: 5000 }];
assert.equal(sumBps(split), 10000);

console.log("validation_test OK");
