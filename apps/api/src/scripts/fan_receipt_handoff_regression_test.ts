import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, "..", "server.ts");
const source = fs.readFileSync(serverPath, "utf8");

assert.match(
  source,
  /function buildFanAccessUrl\(status\)\{[\s\S]*target\.searchParams\.set\("origin", location\.origin\);[\s\S]*target\.searchParams\.set\("receiptId", receiptId\);[\s\S]*target\.searchParams\.set\("receiptToken", token\);/,
  "buy page must build Fan return URLs with origin, receiptId, and receiptToken"
);

assert.match(
  source,
  /if \(view\.actionKind === "view_library"\) \{[\s\S]*window\.location\.assign\(buildFanAccessUrl\(latestReceiptStatus\) \|\| "\/library"\);/,
  "unlocked View library action must prefer receipt-proven Fan return URL before local /library"
);

console.log("fan_receipt_handoff_regression_test OK");
