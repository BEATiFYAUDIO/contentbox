import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import { allocateByBps } from "../lib/settlement.js";
import { isTopologyNeutralLockedSnapshotEligible, resolveLockedSnapshotAccountingState } from "../lib/lockedParticipantSnapshot.js";
import { trackSettledPurchase, recoverPurchaseFulfillment } from "./purchaseFulfillment.js";

// Exercise the actual server function bodies without importing server.ts, which
// starts listeners/background workers. Only fixture storage, identity readiness,
// and the external execution boundary are injected. No wallet/network is loaded.
const serverPath = fileURLToPath(new URL("../server.ts", import.meta.url));
const source = fs.readFileSync(process.env.PAYOUT_STATUS_TEST_SOURCE || serverPath, "utf8");
const ast = ts.createSourceFile(serverPath, source, ts.ScriptTarget.Latest, true);
const names = [
  "bridgeDirectSaleToParticipantPayouts", "ensureProviderPaymentSettlement",
  "ensureParticipantPayoutRowsForProviderIntent", "computeContentParticipantAllocations",
  "deriveIntentPayoutSummaryStatus", "syncProviderIntentPayoutTruthFromParticipantRows",
  "markProviderParticipantPayoutFailed", "resolveExecutionParticipantRef", "buildParticipantPayoutKey",
  "payoutParticipantRefForAllocation", "isEmailDerivedParticipantRef", "parseParticipantPayoutStatus",
  "parseProviderRemitMode", "parsePayoutDestinationType", "isMissingParticipantPayoutTableError",
  "allocateParticipantGrossFeeNetByBps", "allocateFeeByGrossEntitlement", "resolvePayoutExecutionRuntime"
];
const functions = names.map(name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Missing production function ${name}`);
  return node.getText(ast);
}).join("\n");
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

test("payout status: isolated SQLite accounting and production bridge lifecycle", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-payout-status-test-"));
  const api = fileURLToPath(new URL("../..", import.meta.url));
  const url = `file:${path.join(dir, "fixture.db")}`;
  fs.writeFileSync(path.join(dir, "fixture.db"), "");
  execFileSync(process.execPath, [path.join(api, "node_modules/prisma/build/index.js"), "db", "push", "--schema", path.join(api, "prisma/schema.prisma"), "--skip-generate"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  let db = new PrismaClient({ datasources: { db: { url } } });
  const priorTier = process.env.PRODUCT_TIER;
  process.env.PRODUCT_TIER = "advanced";
  let sequence = 0;
  async function fixture(shares = [10000]) {
    const seller = await db.user.create({ data: { email: `seller-${++sequence}@fixture.invalid` } });
    const buyer = await db.buyer.create({ data: { email: `buyer-${sequence}@fixture.invalid` } });
    const content = await db.contentItem.create({ data: { ownerUserId: seller.id, title: "payout status fixture", type: "song", status: "published", priceSats: 100n } });
    await db.splitVersion.create({ data: { contentId: content.id, createdByUserId: seller.id, versionNumber: 1, status: "locked", participants: { create: shares.map((bps, i) => ({ participantUserId: seller.id, participantEmail: `participant-${i}@fixture.invalid`, role: i ? "producer" : "writer", percent: String(bps / 100), bps, acceptedAt: new Date(), verifiedAt: new Date() })) } } });
    const intent = await db.paymentIntent.create({ data: { contentId: content.id, purpose: "CONTENT_PURCHASE", subjectType: "CONTENT", subjectId: content.id, amountSats: 100n, status: "paid", paidVia: "lightning", paidAt: new Date(), manifestSha256: `fixture-${sequence}`, receiptToken: crypto.randomBytes(24).toString("hex"), receiptTokenExpiresAt: new Date(Date.now() + 60000) } });
    await db.$transaction(tx => trackSettledPurchase(tx, { intentId: intent.id, buyerId: buyer.id, rail: "fixture_only" }));
    assert.equal((await recoverPurchaseFulfillment(db, intent.id)).status, "complete");
    return { intent, content, buyer };
  }
  function harness(intentId: string, enabled: boolean, execution = false) {
    const file = path.join(dir, `${intentId}.json`);
    const read = (): any => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const write = (value: any) => { fs.writeFileSync(file, JSON.stringify(value)); return value; };
    const logs: Array<{ message: string; data: any }> = [];
    const state = { enabled, execution, executions: 0, preparationError: false };
    const log = (data: any, message: string) => logs.push({ data, message });
    const ctx: any = {
      Date, Map, Set, BigInt, crypto, prisma: db, allocateByBps,
      isTopologyNeutralLockedSnapshotEligible, resolveLockedSnapshotAccountingState,
      app: { log: { info: log, warn: log, error: log } },
      asString: (v: unknown) => String(v ?? ""),
      resolveParticipantPayoutRuntimeConfig: async () => ({ participantPayoutsEnabled: state.enabled, participantPayoutExecutionEnabled: state.execution, participantPayoutSummaryEnabled: true }),
      findProviderPaymentIntentByPaymentIntentId: read,
      updateProviderPaymentIntent: (_id: string, patch: any) => write({ ...read(), ...patch }),
      upsertProviderPaymentIntentByPaymentIntentId: (_id: string, row: any) => write({ id: `ppi-${intentId}`, ...row }),
      resolveNodeIdForRuntimeStatus: () => "fixture-node",
      resolveNewIntentPayoutPolicy: () => ({ payoutPolicy: "strict", allowProviderFallback: false }),
      resolveEffectivePayoutDestination: async () => null,
      createProviderPaymentReceipt: (row: any) => fs.writeFileSync(file + ".receipt", JSON.stringify(row)),
      appendLifecycleReceiptSafe: () => {},
      getLockedSplitForContent: async (contentId: string) => {
        if (state.preparationError) throw new Error("FIXTURE_ALLOCATION_PREPARATION_FAILED");
        return db.splitVersion.findFirst({ where: { contentId, status: "locked" } });
      },
      listLockedParticipantSnapshotRows: () => [],
      getLockedParticipantSnapshotsForSplitVersion: async (splitVersionId: string) => (await db.splitParticipant.findMany({ where: { splitVersionId } })).map(row => ({ ...row, splitParticipantId: row.id })),
      getProviderDelegatedAllocationBlueprintByPaymentIntentId: () => null,
      resolveParticipantIdentityGate: async () => ({ active: true }),
      resolveParticipantPayoutReadinessForAllocation: async () => ({ status: "ready", destinationType: "lightning_address", destinationSummary: "fixture@invalid.test", destinationResolvedAt: null }),
      isProviderIntentRemittanceSettled: () => false,
      // A mocked external execution failure only. No rail module or credential
      // exists in this VM, so even an erroneous call cannot reach a real wallet.
      executeParticipantPayoutRowsForIntent: async (intent: any) => {
        assert.ok(state.enabled && state.execution);
        state.executions++;
        await db.participantPayout.updateMany({ where: { providerPaymentIntentId: intent.id }, data: { status: "failed", lastError: "MOCK_RAIL_FAILURE", attemptCount: { increment: 1 } } });
      },
      executeCreatorRemittance: () => { throw new Error("UNEXPECTED_CREATOR_EXECUTION"); }
    };
    vm.createContext(ctx); vm.runInContext(compiled, ctx);
    return { ctx, state, read, write, logs, bridge: () => ctx.bridgeDirectSaleToParticipantPayouts(intentId, "finalize_sale_upsert") };
  }
  async function commerce(intentId: string) {
    return {
      sale: await db.sale.findMany({ where: { intentId } }),
      settlement: await db.settlement.findMany({ where: { paymentIntentId: intentId }, include: { lines: true } }),
      entitlement: await db.entitlement.findMany({ where: { paymentIntentId: intentId } })
    };
  }
  try {
    await t.test("disabled subsystem leaves a new paid creator purchase pending, never paid or failed", async () => {
      const { intent } = await fixture(); const h = harness(intent.id, false);
      const before = await commerce(intent.id); await h.bridge();
      assert.equal(h.read().payoutStatus, "pending"); assert.equal(h.read().payoutLastError, null);
      assert.equal(await db.providerPaymentParticipantAllocation.count({ where: { paymentIntentId: intent.id } }), 0);
      assert.equal(await db.participantPayout.count({ where: { paymentIntentId: intent.id } }), 0);
      const runtime = await h.ctx.resolvePayoutExecutionRuntime(null);
      assert.equal(runtime.executionState, "not_applicable"); assert.equal(runtime.blockReason, "PARTICIPANT_PAYOUTS_DISABLED");
      assert.equal(h.state.executions, 0); assert.deepEqual(await commerce(intent.id), before);
    });
    for (const shares of [[10000], [6000, 4000]]) await t.test(`execution disabled still prepares ${shares.length} valid allocation(s)`, async () => {
      const { intent } = await fixture(shares); const h = harness(intent.id, true);
      await h.bridge(); assert.equal(h.read().payoutStatus, "pending");
      const allocations = await db.providerPaymentParticipantAllocation.findMany({ where: { paymentIntentId: intent.id } });
      assert.deepEqual(allocations.map(a => Number(a.amountSats)).sort((a,b) => b-a), shares.map(bps => bps / 100));
      assert.equal(await db.participantPayout.count({ where: { paymentIntentId: intent.id } }), shares.length);
      const runtime = await h.ctx.resolvePayoutExecutionRuntime(null);
      assert.equal(runtime.executionState, "provider_pending"); assert.equal(runtime.blockReason, "PARTICIPANT_PAYOUT_EXECUTION_DISABLED");
      assert.equal(h.state.executions, 0);
    });
    await t.test("missing required allocations fail even with execution disabled", async () => {
      const { intent } = await fixture(); const h = harness(intent.id, true);
      h.ctx.ensureParticipantPayoutRowsForProviderIntent = async () => {}; // Fault injection: preparation silently did nothing.
      await h.bridge(); assert.equal(h.read().payoutStatus, "failed");
      assert.equal(h.read().payoutLastError, "NO_PARTICIPANT_ALLOCATIONS_FOR_PAID_INTENT"); assert.equal(h.state.executions, 0);
    });
    await t.test("allocation preparation exceptions remain visible", async () => {
      const { intent } = await fixture(); const h = harness(intent.id, true); h.state.preparationError = true;
      await h.bridge(); assert.equal(h.read().payoutStatus, "failed");
      assert.ok(h.logs.some(row => row.data.error === "FIXTURE_ALLOCATION_PREPARATION_FAILED")); assert.equal(h.state.executions, 0);
    });
    await t.test("mocked execution failure propagates to provider status and survives disabling", async () => {
      const { intent } = await fixture(); const h = harness(intent.id, true, true);
      await h.bridge(); assert.equal(h.state.executions, 1); assert.equal(h.read().payoutStatus, "failed");
      assert.equal(h.read().payoutLastError, "MOCK_RAIL_FAILURE");
      h.state.enabled = false; const before = h.read();
      await h.ctx.ensureProviderPaymentSettlement(h.read()); assert.deepEqual(h.read(), before); assert.equal(h.state.executions, 1);
    });
    await t.test("disabled reconciliation preserves existing paid, failed and pending provider records exactly", async () => {
      for (const status of ["paid", "failed", "pending"]) {
        const { intent } = await fixture(); const h = harness(intent.id, false); await h.bridge();
        h.write({ ...h.read(), payoutStatus: status, payoutSummaryStatus: status, payoutLastError: status === "failed" ? "HISTORICAL_FAILURE" : null, payoutReference: status === "paid" ? "historical-reference" : null });
        const before = h.read(); await h.ctx.ensureProviderPaymentSettlement(h.read()); assert.deepEqual(h.read(), before);
      }
    });
    await t.test("participant flag does not change the separate legacy creator-remittance path", async () => {
      const { intent } = await fixture(); const h = harness(intent.id, false); await h.bridge();
      h.write({ ...h.read(), payoutExecutionMode: "creator" });
      let calls = 0;
      h.ctx.executeCreatorRemittance = async (row: any) => { calls++; return row; };
      await h.ctx.ensureProviderPaymentSettlement(h.read());
      assert.equal(calls, 1); // Mock only; no external remittance module exists.
    });
    await t.test("repeat and restart preserve commerce, frozen allocation amounts and zero attempts", async () => {
      for (const enabled of [false, true]) {
        const { intent } = await fixture([6000,4000]); let h = harness(intent.id, enabled); await h.bridge();
        const before = await commerce(intent.id);
        const allocations = await db.providerPaymentParticipantAllocation.findMany({ where: { paymentIntentId: intent.id } });
        await db.$disconnect(); db = new PrismaClient({ datasources: { db: { url } } }); h = harness(intent.id, enabled);
        for (let i=0;i<3;i++) { await h.bridge(); assert.equal((await recoverPurchaseFulfillment(db,intent.id)).status,"complete"); }
        assert.equal(h.read().payoutStatus,"pending"); assert.deepEqual(await commerce(intent.id),before);
        assert.deepEqual(await db.providerPaymentParticipantAllocation.findMany({ where: { paymentIntentId: intent.id } }),allocations);
        const payouts=await db.participantPayout.findMany({where:{paymentIntentId:intent.id}});
        assert.equal(payouts.length,enabled?2:0); assert.ok(payouts.every(p=>p.attemptCount===0)); assert.equal(h.state.executions,0);
      }
    });
    await t.test("existing executed participant rows remain paid without another attempt", async () => {
      const {intent}=await fixture(); const h=harness(intent.id,true); await h.bridge();
      await db.participantPayout.updateMany({where:{paymentIntentId:intent.id},data:{status:"paid",payoutReference:"fixture-paid",remittedAt:new Date(),attemptCount:1}});
      await h.bridge(); assert.equal(h.read().payoutStatus,"paid"); assert.equal(h.state.executions,0);
      assert.equal((await db.participantPayout.findFirstOrThrow({where:{paymentIntentId:intent.id}})).attemptCount,1);
    });
    await t.test("Basic keeps its existing no-Sale/no-Settlement accounting", async()=>{
      process.env.PRODUCT_TIER="basic";const {intent}=await fixture();const h=harness(intent.id,false);await h.bridge();
      assert.equal(h.read().payoutStatus,"pending");const c=await commerce(intent.id);assert.equal(c.sale.length,0);assert.equal(c.settlement.length,0);assert.equal(c.entitlement.length,1);
    });
  } finally {
    if(priorTier===undefined)delete process.env.PRODUCT_TIER;else process.env.PRODUCT_TIER=priorTier;
    await db.$disconnect();fs.rmSync(dir,{recursive:true,force:true});
  }
});
