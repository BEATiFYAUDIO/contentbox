import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canActAsSovereignCreator } from "./capabilities.js";

const serverSource = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const storeSource = fs.readFileSync(
  new URL("../../../dashboard/src/pages/StorePage.tsx", import.meta.url),
  "utf8"
);
const financeSource = fs.readFileSync(
  new URL("../../../dashboard/src/pages/FinancePage.tsx", import.meta.url),
  "utf8"
);

test("verified named routing makes Basic eligible for upgrade without activating Sovereign Creator capabilities", () => {
  assert.equal(canActAsSovereignCreator({
    productTier: "basic",
    nodeMode: "basic",
    namedReady: true,
    paymentsMode: "wallet"
  }), false);
  assert.equal(canActAsSovereignCreator({
    productTier: "advanced",
    nodeMode: "advanced",
    namedReady: true,
    paymentsMode: "node"
  }), true);
});

test("Sovereign Creator activation remains an explicit persisted posture transition", () => {
  const route = serverSource.slice(
    serverSource.indexOf('app.post("/api/node/mode"'),
    serverSource.indexOf('app.get("/api/runtime/status"')
  );
  assert.match(route, /next === "advanced"/);
  assert.match(route, /!readiness\.namedTunnelDetected/);
  assert.match(route, /await writeNodeConfig\(next\)/);
  assert.match(route, /await writeProductTier\(next\)/);
  assert.match(route, /capabilityContextCache = null/);
  assert.match(route, /publicStatusCache = null/);
  assert.match(route, /profileServiceModeCache = null/);
});

test("Sovereign Node retains its separate local-stack readiness gate", () => {
  const route = serverSource.slice(
    serverSource.indexOf('app.post("/api/node/mode"'),
    serverSource.indexOf('app.get("/api/runtime/status"')
  );
  assert.match(route, /next === "lan" && !readiness\.ready/);
  assert.match(route, /LOCAL_SOVEREIGN_STACK_REQUIRED/);
});

test("network and Store participation use selected posture while readiness remains status", () => {
  const profileResolver = serverSource.slice(
    serverSource.indexOf("function resolveProviderServiceProfile"),
    serverSource.indexOf("function isAdvancedInactive")
  );
  assert.match(profileResolver, /resolveSelectedParticipationMode/);
  assert.doesNotMatch(profileResolver, /const participationMode[^;]*!hasStablePublicRoute/s);
  assert.match(storeSource, /summaryCommerceAuthority = participationModeFromSummary === "sovereign_node"/);
  assert.doesNotMatch(storeSource, /summaryCommerceAuthority = networkSummary\?\.modeProfile\?\.localSovereignReady/);
});

test("Finance presentation cannot promote Advanced to Sovereign Node from readiness alone", () => {
  const posture = financeSource.slice(
    financeSource.indexOf("const financePosture"),
    financeSource.indexOf("useEffect", financeSource.indexOf("const financePosture"))
  );
  assert.match(posture, /nodeMode === "lan"/);
  assert.doesNotMatch(posture, /nodeMode === "lan" \|\| postureSnapshot\?\.localSovereignReady/);
});
