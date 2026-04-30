import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Json = Record<string, any>;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = String(process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/+$/, "");
const AUTH_TOKEN = String(process.env.AUTH_TOKEN || "").trim();
const INTENT_ID = String(process.env.INTENT_ID || "cmoliiuwu0001xwnsn4gu1pxs").trim();
const CONTENT_IDS = [
  "cmokzpi6f005txwzjtto0g4i6", // Suenos Party Invite (derivative recent)
  "cmojpfpq3002rxwph4iai37go", // La Diabless (derivative older)
  "cmo8tusrq0007xwvclbdgwf6c"  // Beatify Logo (non-derivative)
];

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

async function api<T = any>(endpoint: string): Promise<T> {
  if (!AUTH_TOKEN) fail("AUTH_TOKEN is required for live checks");
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`HTTP ${res.status} for ${endpoint}: ${body}`);
  }
  return (await res.json()) as T;
}

function runStaticSourceChecks() {
  const serverPath = path.resolve(__dirname, "..", "server.ts");
  const source = fs.readFileSync(serverPath, "utf8");

  // 1) /my/royalties derivative authority must not fallback to content-level split authority.
  const royaltiesStart = source.indexOf('app.get("/my/royalties"');
  const royaltiesEnd = source.indexOf('app.get("/royalties/:contentId/terms"');
  assert(royaltiesStart >= 0 && royaltiesEnd > royaltiesStart, "Could not locate /my/royalties block");
  const royaltiesBlock = source.slice(royaltiesStart, royaltiesEnd);
  assert(
    royaltiesBlock.includes("getAuthoritativeContentLinkForChild("),
    "/my/royalties must use getAuthoritativeContentLinkForChild"
  );
  assert(
    royaltiesBlock.includes("parentSplitVersionId"),
    "/my/royalties derivative path must reference parentSplitVersionId"
  );
  assert(
    !royaltiesBlock.includes("getLockedSplitForContent(parentContent.id)"),
    "/my/royalties derivative path must not fallback to getLockedSplitForContent(parentContent.id)"
  );

  // 2) Deterministic selector contract.
  const selectorStart = source.indexOf("async function getAuthoritativeContentLinkForChild");
  const selectorEnd = source.indexOf("async function ensureRemoteShadowLockedSplitForParent");
  assert(selectorStart >= 0 && selectorEnd > selectorStart, "Could not locate authoritative ContentLink helper");
  const selectorBlock = source.slice(selectorStart, selectorEnd);
  assert(selectorBlock.includes("parentSplitVersionId"), "Selector must prioritize parentSplitVersionId");
  assert(selectorBlock.includes("approvedAt"), "Selector must include deterministic approvedAt tie-break");
  assert(selectorBlock.includes("localeCompare"), "Selector must include stable id tie-break");
}

function parseBigIntSafe(value: unknown): bigint {
  return BigInt(String(value ?? "0"));
}

async function runLiveChecks() {
  const myRoyalties = await api<{ works: any[] }>("/my/royalties");
  const financeRoyalties = await api<{ items: any[]; totals: any }>("/finance/royalties");
  const audit = await api<Json>(`/api/provider/payment-intents/${encodeURIComponent(INTENT_ID)}/audit`);

  // 3) No row disappearance for target contents across /my/royalties and /finance/royalties.
  for (const contentId of CONTENT_IDS) {
    const inMy = (myRoyalties.works || []).some((row) => String(row?.contentId || "").trim() === contentId);
    assert(inMy, `Missing content ${contentId} from /my/royalties`);
    const inFinance = (financeRoyalties.items || []).some((row) => String(row?.contentId || "").trim() === contentId);
    assert(inFinance, `Missing content ${contentId} from /finance/royalties`);
  }

  // 4) /finance/royalties sourceType row preservation (contentId + sourceType keyed behavior).
  const byContent = new Map<string, Set<string>>();
  for (const row of financeRoyalties.items || []) {
    const contentId = String(row?.contentId || "").trim();
    const sourceType = String(row?.sourceType || "").trim();
    if (!contentId) continue;
    if (!sourceType) fail(`Row missing sourceType for contentId=${contentId}`);
    if (!byContent.has(contentId)) byContent.set(contentId, new Set());
    byContent.get(contentId)!.add(sourceType);
  }
  const suenosSources = byContent.get("cmokzpi6f005txwzjtto0g4i6") || new Set();
  assert(
    suenosSources.has("catalog_earning") && suenosSources.has("derivative_creator_earning"),
    "Suenos Party Invite must expose both catalog_earning and derivative_creator_earning rows"
  );

  // 5) Known intent reconciliation fixture.
  const sums = audit?.sums || {};
  assert(parseBigIntSafe(sums.grossSats) === 200n, "Audit grossSats must be 200");
  assert(parseBigIntSafe(sums.payoutPaidSats) === 200n, "Audit payoutPaidSats must be 200");

  const allocRows = Array.isArray(audit?.allocations) ? audit.allocations : [];
  const allocAmounts = allocRows
    .map((row: any) => ({
      sourceType: String(row?.sourceType || "").trim(),
      amount: parseBigIntSafe(row?.amountSats)
    }))
    .sort((a: any, b: any) => Number(a.amount - b.amount));
  const expected = [
    { sourceType: "upstream_royalty_earning", amount: 10n },
    { sourceType: "upstream_royalty_earning", amount: 10n },
    { sourceType: "derivative_creator_earning", amount: 180n }
  ].sort((a, b) => Number(a.amount - b.amount));
  assert(allocAmounts.length === 3, `Expected 3 allocation rows, got ${allocAmounts.length}`);
  for (let i = 0; i < expected.length; i++) {
    assert(
      allocAmounts[i].sourceType === expected[i].sourceType && allocAmounts[i].amount === expected[i].amount,
      `Allocation mismatch at index ${i}: got ${allocAmounts[i].sourceType}/${allocAmounts[i].amount}, expected ${expected[i].sourceType}/${expected[i].amount}`
    );
  }

  console.log("OK derivative accounting regression checks passed");
}

async function main() {
  runStaticSourceChecks();
  await runLiveChecks();
}

main().catch((err) => {
  console.error("FAIL derivative accounting regression checks:", err?.message || err);
  process.exit(1);
});
