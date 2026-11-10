import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { participantPayoutPreflightError } from "./payoutPreflight.js";

// Execute production functions without loading the app, credentials or a wallet.
const railSource = fs.readFileSync(process.env.PAYOUT_RAIL_TEST_SOURCE || new URL("./lightning.ts", import.meta.url), "utf8");
const serverSource = fs.readFileSync(process.env.PAYOUT_SERVER_TEST_SOURCE || new URL("../server.ts", import.meta.url), "utf8");
function functions(source: string, names: string[], bindings: any = {}) {
  const ast = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  const selected = names.map(name => {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert.ok(node, `Missing production function ${name}`);
    return node.getText(ast).replace(/^export /, "");
  }).join("\n");
  const context: any = vm.createContext({ Buffer, URL, Date, console: { info() {}, error() {} }, setTimeout: (cb: any) => cb(), ...bindings });
  vm.runInContext(ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return context;
}
const hash = "a".repeat(64);
function rail(options: { status?: string; sendError?: Error; lookupError?: boolean; decodedHash?: string | null } = {}) {
  const calls: string[] = [];
  const ctx = functions(railSource, ["sendBolt11Payment", "normalizeOutgoingPaymentStatus"], {
    getLndConfig: async () => ({}),
    decodeBolt11PaymentRequest: async () => ({ paymentHash: options.decodedHash === undefined ? hash : options.decodedHash, valueSats: 99 }),
    derivePaymentHashFromBolt11: async () => null,
    classifyLndTransportError: () => "request_timeout",
    lndFetchJson: async () => { calls.push("send"); if (options.sendError) throw options.sendError; return { status: "IN_FLIGHT", payment_hash: hash }; },
    lookupOutgoingPaymentStatusByHash: async () => { calls.push("lookup"); if (options.lookupError) throw new Error("offline"); return options.status || "SUCCEEDED"; }
  });
  return { calls, send: (extra = {}) => ctx.sendBolt11Payment({}, { paymentRequest: "fixture-invoice", expectedAmountSats: 99, ...extra }) };
}

test("transport timeout reconciles the original payment, never a second send", async () => {
  const h = rail({ sendError: new Error("timeout") });
  assert.equal((await h.send()).status, "paid");
  assert.equal(h.calls.filter(c => c === "send").length, 1);
  assert.ok(h.calls.includes("lookup"));
});
for (const status of ["IN_FLIGHT", "UNKNOWN"]) test(`timeout with ${status} preserves hash for automatic verification`, async () => {
  const h = rail({ status, sendError: new Error("timeout") });
  await assert.rejects(h.send(), new RegExp(`^Error: LND_SEND_RESULT_UNKNOWN:[^:]+:${hash}$`));
  assert.equal(h.calls.filter(c => c === "send").length, 1);
});
test("failed status lookup after sending cannot turn an uncertain payment into a retry", async () => {
  const h = rail({ lookupError: true });
  await assert.rejects(h.send(), new RegExp(`LND_SEND_RESULT_UNKNOWN:[^:]+:${hash}$`));
});
test("only a confirmed LND failure is retryable", async () => {
  const h = rail({ status: "FAILED", sendError: new Error("timeout") });
  await assert.rejects(h.send(), /LND_SEND_NOT_PAID:FAILED/);
});
test("invoice hash is required before a payment can leave", async () => {
  const h = rail({ decodedHash: null });
  await assert.rejects(h.send(), /LND_SEND_INVOICE_UNVERIFIED/);
  assert.equal(h.calls.length, 0);
});
test("persist the payment hash before sending; persistence failure sends nothing", async () => {
  const h = rail();
  await h.send({ beforeSend: async (value: string) => { assert.equal(value, hash); h.calls.push("persist"); } });
  assert.equal(h.calls[0], "persist"); assert.equal(h.calls[1], "send");
  const failed = rail();
  await assert.rejects(failed.send({ beforeSend: async () => { throw new Error("storage unavailable"); } }), /storage unavailable/);
  assert.equal(failed.calls.length, 0);
});
test("REST handles LND's streamed result envelopes and gives routing its timeout budget", async () => {
  let timeout = 0;
  const ctx = functions(railSource, ["lndRestJson"], {
    normalizeMacaroonHex: () => "00",
    https: { request: (_options: any, callback: any) => {
      const req: any = new EventEmitter();
      req.setTimeout = (ms: number) => { timeout = ms; };
      req.write = () => {};
      req.end = () => {
        const resp: any = new EventEmitter(); resp.statusCode = 200; resp.headers = {};
        callback(resp);
        resp.emit("data", JSON.stringify({ result: { status: "IN_FLIGHT", payment_hash: hash } }) + "\n");
        resp.emit("data", JSON.stringify({ result: { status: "SUCCEEDED", payment_hash: hash } }) + "\n");
        resp.emit("end");
      };
      return req;
    } }
  });
  const result = await ctx.lndRestJson({ restUrl: "https://fixture.invalid", tlsCert: Buffer.from("fixture"), macaroonHex: "00" }, "POST", "/v2/router/send", { timeout_seconds: 60 });
  assert.equal(result.status, "SUCCEEDED"); assert.equal(result.payment_hash, hash);
  assert.ok(timeout >= 75000);
});
test("a payment hash alone is not proof of payment", async () => {
  const writes: any[] = [];
  const ctx = functions(serverSource, ["forceReconcileSuccessfulParticipantPayoutRows"], {
    prisma: { participantPayout: { updateMany: async (args: any) => { writes.push(args); return { count: 0 }; } } }
  });
  await ctx.forceReconcileSuccessfulParticipantPayoutRows("fixture-intent");
  assert.ok(writes.length > 0);
  assert.ok(writes.every(w => w.where.remittedAt?.not === null), "Only previously confirmed remittances may be promoted without consulting LND");
});
test("a verified failure releases its payment reference so the scheduled retry can proceed", async () => {
  let written: any;
  const ctx = functions(serverSource, ["markParticipantPayoutFailedAfterVerification"], {
    nextParticipantRetryAt: () => new Date(Date.now() + 60000),
    prisma: { participantPayout: { updateMany: async (args: any) => { written = args; return { count: 1 }; } } }
  });
  await ctx.markParticipantPayoutFailedAfterVerification("fixture", "LND_SEND_NOT_PAID:FAILED_VERIFIED", hash);
  assert.equal(written.data.status, "failed"); assert.equal(written.data.payoutReference, null);
  assert.equal(written.where.payoutReference, hash);
  assert.ok(written.data.nextRetryAt instanceof Date);
});

for (const status of ["IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"]) test(`restart recovery checks persisted ${status} attempt without another invoice`, async () => {
  let paid = 0, failed = 0;
  const row = { id: "fixture", status: "forwarding", payoutReference: hash, remittedAt: null, readinessReason: "LND_RESULT_UNKNOWN_VERIFY_REQUIRED", amountSats: 99n };
  const noop = () => {};
  const ctx = functions(serverSource, ["executeParticipantPayoutRowsForIntent"], {
    resolveProviderExecutionAuthorityOnCurrentNode: async () => ({ localNodeId: "fixture-node" }),
    resolvePayoutExecutionRuntime: async () => ({ executionState: "ready" }),
    prisma: { participantPayout: { findMany: async () => [row] } },
    PARTICIPANT_REMITTANCE_FLIGHTS: new Set(),
    app: { log: { info: noop, warn: noop, error: noop } },
    participantExecutionRef: () => "fixture", logParticipantPayoutAttempt: noop,
    lookupOutgoingPaymentStatusByHash: async () => status,
    forceMarkParticipantPayoutPaidAfterExternalSuccess: async () => { paid++; },
    markParticipantPayoutFailedAfterVerification: async () => { failed++; },
    forceReconcileSuccessfulParticipantPayoutRows: async () => 0,
    requestLightningAddressInvoice: () => { throw new Error("Duplicate invoice request"); },
    acquireParticipantPayoutLock: () => { throw new Error("Unexpected new payment attempt"); }
  });
  await ctx.executeParticipantPayoutRowsForIntent({ id: "fixture-intent", providerNodeId: "fixture-node" }, "background");
  assert.equal(paid, status === "SUCCEEDED" ? 1 : 0);
  assert.equal(failed, status === "FAILED" ? 1 : 0);
});

test("legacy creator remittance reconciles a successful saved attempt without resending", async () => {
  let intent: any = { id: "fixture", payoutStatus: "pending", payoutReference: hash, creatorNetSats: "99" };
  const ctx = functions(serverSource, ["executeCreatorRemittance"], {
    REMITTANCE_FLIGHTS: new Set(), prisma: {},
    listProviderPaymentIntents: () => [intent],
    lookupOutgoingPaymentByHash: async () => ({ status: "SUCCEEDED", valueSats: 99 }),
    updateProviderPaymentIntent: (_id: string, patch: any) => (intent = { ...intent, ...patch }),
    acquirePersistentRemittanceLock: () => { throw new Error("Unexpected resend"); }
  });
  assert.equal((await ctx.executeCreatorRemittance(intent, "background")).payoutStatus, "paid");
});

test("both public provider invoice handlers reject an unpayable split before issuing an invoice", async () => {
  const ast = ts.createSourceFile("server.ts", serverSource, ts.ScriptTarget.Latest, true);
  const handlers: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "post" && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "/public/provider/payment-intents") {
      handlers.push(node.arguments[node.arguments.length - 1].getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(handlers.length, 2);
  for (const handler of handlers) {
    let response: any, status: number;
    const ctx: any = vm.createContext({
      resolveProviderExecutionAuthorityOnCurrentNode: async () => ({ ok: true }),
      getProviderCreatorLink: () => ({ trustStatus: "verified", executionAllowed: true }),
      listProviderDelegatedPublishes: () => [{ contentId: "fixture-content", creatorNodeId: "fixture-creator" }],
      findProviderPaymentIntentByPaymentIntentId: () => null,
      resolveNewIntentPayoutExecutionMode: () => "participant",
      parseProviderRemitMode: () => "auto_forward", participantPayoutPreflightError,
      createLightningInvoiceWithRetry: () => { throw new Error("Invoice must not be issued"); }
    });
    vm.runInContext(ts.transpileModule(`var handler = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
    const reply: any = { code: (value: number) => { status = value; return reply; }, send: (value: any) => { response = value; } };
    await ctx.handler({ body: { creatorNodeId: "fixture-creator", contentId: "fixture-content", paymentIntentId: "fixture-payment", amountSats: "200", participantAllocations: [{ bps: 5000, destinationVerified: false }] } }, reply);
    assert.equal(status!, 409); assert.equal(response.error, "PARTICIPANT_PAYOUT_DESTINATION_REQUIRED");
  }
  assert.equal(participantPayoutPreflightError([{ bps: 10000, destinationVerified: true, destinationType: "lightning_address", destinationValue: "fixture@example.com" }]), null);
  assert.equal(participantPayoutPreflightError([]), "PARTICIPANT_ALLOCATIONS_REQUIRED");
});
