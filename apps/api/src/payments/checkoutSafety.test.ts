import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as safety from "./checkoutSafety.js";
import { participantPayoutPreflightError } from "./payoutPreflight.js";
import { mapPublicPaymentsIntentError } from "../lib/publicPaymentsIntentErrors.js";

// Production function bodies with mocked network/storage boundaries. No app,
// credentials, wallet, live database, invoice or payment is opened by this suite.
const rail = fs.readFileSync(new URL("./lightning.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
function context(source: string, names: string[], bindings: any = {}) {
  const ast = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  const code = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text || ""))
    .map(n => n.getText(ast).replace(/^export /, "")).join("\n");
  const ctx: any = vm.createContext({ ...safety, Buffer, URL, Date, BigInt, process: { env: {} },
    console: { info() {}, warn() {} }, setTimeout, clearTimeout, AbortController, ...bindings });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  return ctx;
}
function handlers(method: string, path: string) {
  const ast = ts.createSourceFile("server.ts", server, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === method &&
      ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === path) out.push(n.arguments[n.arguments.length - 1].getText(ast));
    ts.forEachChild(n, visit);
  }
  visit(ast); return out;
}
function handlerContext(handler: string, bindings: any) {
  const ctx = context("", [], bindings);
  vm.runInContext(ts.transpileModule(`var handler = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  return ctx;
}
function replyFixture() {
  const result: any = { status: 200 };
  const reply: any = { code(value: number) { result.status = value; return reply; }, send(value: any) { result.body = value; return value; } };
  return { reply, result };
}
const synced = { synced_to_chain: true, synced_to_graph: true };
const channel = (remote = "1000", active = true) => ({ active, remote_balance: remote, remote_chan_reserve_sat: "354" });
const hash = "ab".repeat(32);
const invoice = (state = "SETTLED") => ({ state, r_hash: Buffer.from(hash, "hex").toString("base64"), value: "200", amt_paid_sat: "200", settle_date: "1794284113" });

for (const [name, gi, channels, expected] of [
  ["offline channels with funds", synced, [channel("7079", false)], "LIGHTNING_NO_ACTIVE_CHANNEL"],
  ["outbound-only active channel plus funded offline channel", synced, [channel("0"), channel("7079", false)], "LIGHTNING_INBOUND_CAPACITY_REQUIRED"],
  ["remote reserve is not spendable", synced, [channel("500")], "LIGHTNING_INBOUND_CAPACITY_REQUIRED"],
  ["unsynced chain", { ...synced, synced_to_chain: false }, [channel()], "LIGHTNING_NODE_NOT_SYNCED"],
  ["unsynced graph", { ...synced, synced_to_graph: false }, [channel()], "LIGHTNING_NODE_NOT_SYNCED"],
  ["unknown balances", synced, [{ active: true }], "LIGHTNING_RECEIVE_UNAVAILABLE"]
] as const) test(`new invoice blocked: ${name}`, async () => {
  let posts = 0;
  const ctx = context(rail, ["createLightningInvoice", "assertLightningReceiveCapacity"], {
    getLndConfig: async (_db: any, role: string) => ({ restUrl: "https://fixture.invalid", network: "mainnet", credentialRole: role }),
    lndFetchJson: async (_cfg: any, path: string, options: any) => {
      if (options.method === "POST") { posts++; return { payment_request: "fixture", r_hash: "fixture" }; }
      return path === "/v1/getinfo" ? gi : { channels };
    }
  });
  await assert.rejects(ctx.createLightningInvoice({}, 200n, "fixture"), (e: any) => e.code === expected);
  assert.equal(posts, 0);
});

test("healthy receiving capacity issues exactly one invoice using separate read/invoice credentials", async () => {
  const calls: string[] = [];
  const ctx = context(rail, ["createLightningInvoice", "assertLightningReceiveCapacity"], {
    getLndConfig: async (_db: any, role: string) => ({ restUrl: "https://fixture.invalid", network: "mainnet", credentialRole: role }),
    lndFetchJson: async (cfg: any, path: string, options: any) => {
      calls.push(`${cfg.credentialRole}:${options.method}:${path}`);
      if (path === "/v1/getinfo") return synced;
      if (path === "/v1/channels") return { channels: [channel()] };
      return { payment_request: "fixture", r_hash: "fixture" };
    }
  });
  assert.equal((await ctx.createLightningInvoice({}, 200n, "fixture")).bolt11, "fixture");
  assert.deepEqual(calls.sort(), ["invoice:POST:/v1/invoices", "read:GET:/v1/channels", "read:GET:/v1/getinfo"].sort());
});

test("readiness failures issue nothing, are sanitized and are not immediately retried", async () => {
  let posts = 0, attempts = 0;
  const ctx = context(rail, ["createLightningInvoice", "assertLightningReceiveCapacity"], {
    getLndConfig: async () => ({ restUrl: "https://fixture.invalid", network: "mainnet" }),
    lndFetchJson: async (_cfg: any, _path: string, options: any) => { if (options.method === "POST") posts++; throw Error("secret fixture credentials"); }
  });
  await assert.rejects(ctx.createLightningInvoice({}, 200n, "fixture"), (e: any) => e.code === "LIGHTNING_RECEIVE_UNAVAILABLE" && !e.message.includes("secret"));
  assert.equal(posts, 0);
  const s = context(server, ["createLightningInvoiceWithRetry"], { prisma: {}, app: { log: { warn() {} } },
    createLightningInvoice: async () => { attempts++; throw new safety.CheckoutSafetyError("LIGHTNING_INBOUND_CAPACITY_REQUIRED"); } });
  await assert.rejects(s.createLightningInvoiceWithRetry(200n, "fixture", { route: "fixture" }), /receiving node lacks capacity/);
  assert.equal(attempts, 1);
});

test("readiness never advertises an inactive or outbound-only channel as receive-ready", () => {
  const ctx = context(rail, ["mapLightningReadinessFromLnd"]);
  for (const channels of [[channel("7079", false)], [channel("0"), channel("7079", false)]]) {
    assert.equal(ctx.mapLightningReadinessFromLnd({ getinfo: synced, channels: { channels } }).receiveReady, false);
  }
  assert.equal(ctx.mapLightningReadinessFromLnd({ getinfo: synced, channels: { channels: [channel()] } }).receiveReady, true);
});

test("lost AddInvoice response does not trigger another invoice POST", async () => {
  let posts = 0;
  const ctx = context(rail, ["createLightningInvoice", "assertLightningReceiveCapacity"], {
    getLndConfig: async () => ({ restUrl: "https://fixture.invalid", network: "mainnet" }),
    lndFetchJson: async (_cfg: any, path: string, options: any) => {
      if (options.method === "POST") { posts++; throw Error("socket timeout"); }
      return path === "/v1/getinfo" ? synced : { channels: [channel()] };
    }
  });
  const wrapper = context(server, ["createLightningInvoiceWithRetry"], { prisma: {}, app: { log: { warn() {} } }, createLightningInvoice: ctx.createLightningInvoice });
  await assert.rejects(wrapper.createLightningInvoiceWithRetry(200n, "fixture", { route: "fixture" }), (e: any) => e.code === "LIGHTNING_INVOICE_UNAVAILABLE");
  assert.equal(posts, 1);
});

for (const state of ["OPEN", "ACCEPTED", "CANCELED"]) test(`${state} is unpaid even with a contradictory legacy settled flag`, async () => {
  const ctx = context(rail, ["checkLightningInvoice"], { derivePaymentHashHexFromProvider: () => hash,
    getInvoiceByPaymentHashHex: async () => ({ ...invoice(state), settled: true, settle_date: "0" }) });
  const out = await ctx.checkLightningInvoice({}, "lnd:fixture", 200n);
  assert.equal(out.paid, false); assert.equal(out.paidAt, null);
});

for (const [name, value] of [
  ["underpaid", { ...invoice(), amt_paid_sat: "199" }],
  ["wrong invoice amount", { ...invoice(), value: "100" }],
  ["different hash", { ...invoice(), r_hash: Buffer.alloc(32).toString("base64") }],
  ["unknown state", { ...invoice("UNKNOWN"), settled: true }],
  ["missing settlement timestamp", { ...invoice(), settle_date: "0" }]
] as const) test(`${name} cannot confirm purchase`, async () => {
  const ctx = context(rail, ["checkLightningInvoice"], { derivePaymentHashHexFromProvider: () => hash, getInvoiceByPaymentHashHex: async () => value });
  await assert.rejects(ctx.checkLightningInvoice({}, "lnd:fixture", 200n), (e: any) => e.code === "PAYMENT_VERIFICATION_UNAVAILABLE");
});
test("exact hash, full amount and SETTLED confirm payment", () => {
  const out = safety.verifiedLndInvoice(invoice(), hash, 200n);
  assert.equal(out.paid, true); assert.equal(out.state, "SETTLED");
});

test("all payable shares must be ready and cover the whole split", () => {
  const ready = { bps: 5000, destinationVerified: true, destinationType: "lightning_address", destinationValue: "fixture@wallet.test" };
  assert.equal(participantPayoutPreflightError([ready, ready]), null);
  assert.equal(participantPayoutPreflightError([ready, { ...ready, destinationVerified: false }]), "PARTICIPANT_PAYOUT_DESTINATION_REQUIRED");
  for (const rows of [[ready], [ready, { ...ready, bps: -1 }], [{ ...ready, bps: 10001 }], [{ ...ready, bps: 9999.9 }]]) {
    assert.equal(participantPayoutPreflightError(rows), "PARTICIPANT_ALLOCATIONS_INVALID");
  }
});

for (const postHandler of handlers("post", "/public/provider/payment-intents")) {
  test("provider listener refuses an unavailable invoice before saving an intent or blueprint", async () => {
    let writes = 0;
    const ctx = handlerContext(postHandler, {
      resolveProviderExecutionAuthorityOnCurrentNode: async () => ({ ok: true }),
      getProviderCreatorLink: () => ({ trustStatus: "verified", executionAllowed: true }),
      listProviderDelegatedPublishes: () => [{ contentId: "content", creatorNodeId: "creator" }],
      findProviderPaymentIntentByPaymentIntentId: () => null,
      resolveNewIntentPayoutExecutionMode: () => "participant", parseProviderRemitMode: () => "auto_forward", participantPayoutPreflightError,
      buildLocalNodeIdentityDoc: async () => ({ nodeId: "provider" }), buildRemittanceMemo: async () => "fixture",
      createLightningInvoiceWithRetry: async () => { throw new safety.CheckoutSafetyError("LIGHTNING_INBOUND_CAPACITY_REQUIRED"); },
      createProviderPaymentIntent: () => { writes++; }, upsertProviderDelegatedAllocationBlueprintByPaymentIntentId: () => { writes++; }
    });
    const { reply, result } = replyFixture();
    await ctx.handler({ body: { creatorNodeId: "creator", contentId: "content", paymentIntentId: "pi", amountSats: "200",
      participantAllocations: [{ bps: 10000, destinationVerified: true, destinationType: "lightning_address", destinationValue: "fixture@wallet.test" }] } }, reply);
    assert.equal(result.status, 503); assert.equal(result.body.error, "LIGHTNING_INBOUND_CAPACITY_REQUIRED"); assert.equal(writes, 0);
  });
}

test("checkout presents specific readiness failures without leaking upstream details", () => {
  const mapped = mapPublicPaymentsIntentError({ code: "LIGHTNING_INBOUND_CAPACITY_REQUIRED", message: "secret fixture" });
  assert.equal(mapped.statusCode, 503); assert.equal(mapped.body.code, "LIGHTNING_INBOUND_CAPACITY_REQUIRED");
  assert.doesNotMatch(mapped.body.message, /secret/);
});

test("provider confirmation belongs to this purchase and tolerates pending downstream payout", () => {
  const settled = { paymentIntentId: "pi", status: "paid", paid: true, paidAt: "2026-11-10T04:15:13.000Z", payoutStatus: "pending" };
  assert.equal(safety.verifiedProviderStatus(settled, "pi").paid, true);
  for (const invalid of [{ ...settled, paymentIntentId: "other" }, { ...settled, paid: "true" }, { ...settled, status: "issued" }, { ...settled, paidAt: null }]) {
    assert.throws(() => safety.verifiedProviderStatus(invalid, "pi"), safety.CheckoutSafetyError);
  }
});

for (const statusHandler of handlers("get", "/public/provider/payment-intents/:paymentIntentId/status")) {
  test("provider listener reports lookup failure without changing payment or executing payouts", async () => {
    let writes = 0;
    const ctx = handlerContext(statusHandler, {
      prisma: {}, resolveProviderExecutionAuthorityOnCurrentNode: async () => ({ ok: true }),
      findProviderPaymentIntentByPaymentIntentId: () => ({ id: "fixture", paymentIntentId: "pi", status: "issued", providerInvoiceRef: "lnd:fixture", amountSats: "200" }),
      checkLightningInvoice: async () => { throw Error("secret fixture credentials"); },
      updateProviderPaymentIntent: () => { writes++; }, ensureProviderPaymentSettlement: () => { writes++; }, executeParticipantPayoutRowsForIntent: () => { writes++; }
    });
    const { reply, result } = replyFixture();
    await ctx.handler({ params: { paymentIntentId: "pi" } }, reply);
    assert.equal(result.status, 503); assert.equal(result.body.error, "PAYMENT_VERIFICATION_UNAVAILABLE");
    assert.equal(result.body.paid, null); assert.equal(writes, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /secret/);
  });
}

for (const extra of [{ payoutReference: hash }, { payoutStatus: "paid" }, { payoutSummaryStatus: "paid" }, { remittedAt: new Date().toISOString() }]) {
  test("outgoing payout evidence cannot unlock an unpaid delegated purchase", async () => {
    const ctx = context(server, ["fetchDelegatedProviderPaymentIntentStatus"], {
      getNetworkProviderConfig: () => ({ providerUrl: "https://fixture.invalid" }), evaluateProviderExecutionTrustReadiness: () => ({ allowed: true }),
      hasProviderPaymentTarget: () => true,
      fetch: async () => ({ ok: true, json: async () => ({ paymentIntentId: "pi", status: "issued", paid: false, ...extra }) })
    });
    assert.equal((await ctx.fetchDelegatedProviderPaymentIntentStatus("pi")).paid, false);
  });
}

for (const state of ["OPEN", "ACCEPTED", "lookup_error"]) test(`expired invoice ${state} never silently rotates to a new invoice`, async () => {
  const intent = { id: "pi", status: "pending", bolt11: "fixture", providerId: "lnd:fixture", amountSats: 200n, subjectId: "content", lightningExpiresAt: new Date(1), createdAt: new Date(1) };
  let furtherReads = 0, created = 0;
  const ctx = context(server, ["ensureOrRotateLightningInvoiceForIntent"], {
    invoiceIntentSingleFlight: { do: (_key: string, fn: any) => fn() },
    prisma: { paymentIntent: { findUnique: async () => intent }, contentItem: { findUnique: async () => { furtherReads++; throw Error("Must not reach rotation"); } } },
    normalizeRemoteInvoiceState: (v: any) => v,
    checkLightningInvoice: async () => { if (state === "lookup_error") throw Error("unreachable"); return { state, paid: false }; },
    createLightningInvoiceWithRetry: () => { created++; }
  });
  if (state === "lookup_error") await assert.rejects(ctx.ensureOrRotateLightningInvoiceForIntent("pi"));
  else assert.equal(await ctx.ensureOrRotateLightningInvoiceForIntent("pi"), intent);
  assert.equal(furtherReads, 0); assert.equal(created, 0);
});
