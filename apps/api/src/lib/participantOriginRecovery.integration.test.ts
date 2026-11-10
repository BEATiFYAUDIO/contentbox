import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import Fastify from "fastify";
import crypto from "node:crypto";
import { mapParticipantCheckoutError, mapPublicPaymentsIntentError } from "./publicPaymentsIntentErrors.js";
import { recoverAcceptedRemoteIdentity } from "./participantOriginRecovery.js";
import { isCommerceEligibleLockedParticipant } from "./splitAuthority.js";

// Execute the production resolver functions in isolation: importing server.ts
// would start the API, background jobs and live DB. All I/O here is injected.
const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const names = ["parseRemoteIdentityRef", "parseUserIdFromParticipantRef", "inferLockedParticipantIdentityRef",
  "resolveAcceptedParticipantRoutingRef", "resolveParticipantDestinationHandshake",
  "parseParticipantDestinationType", "normalizeParticipantDestinationForPayout",
  "buildDelegatedAllocationBlueprint", "requestDelegatedProviderPaymentIntent", "handlePublicPaymentsIntents"];
const extracted = names.map(name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Production function missing: ${name}`);
  return node.getText(ast);
}).join("\n");
const js = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture(options: { evidence?: boolean; local?: boolean; ambiguous?: boolean; snapshotRef?: string } = {}) {
  const participant: any = { id: "recreated-row", splitVersionId: "split-1", participantUserId: "remote-user",
    acceptedAt: new Date(), verifiedAt: new Date(), bps: 5000, percent: 50, role: "writer", targetType: "local_user", targetValue: "remote-user",
    invitation: { status: "accepted", acceptedIdentityRef: "user:remote-user" } };
  const original = JSON.stringify(participant);
  const origin = "https://collaborator.example.test";
  const makeEvent = (host: string) => ({ id: `audit-${host}`, action: "invite.accept", entityType: "SplitVersion", entityId: "split-1",
    payloadJson: { participantUserId: "remote-user", remoteUserId: "remote-user", remoteNodeUrl: host,
      acceptanceAuthMode: "remote_signature", remoteVerified: true, signature: "fixture-signature",
      acceptedIdentityRef: `remote:${host}#user:remote-user`, splitParticipantId: "deleted-original-row",
      signedPayload: { remoteUserId: "remote-user", nodeUrl: host, token: "fixture", nonce: "fixture", ts: "2026-05-31", aud: "https://author.example.test" } } });
  const events = options.evidence === false ? [] : [makeEvent(origin), ...(options.ambiguous ? [makeEvent("https://other.example.test")] : [])];
  const calls: string[] = [];
  let wallet = "first@walletofsatoshi.com";
  const context = {
    asString: (value: unknown) => String(value ?? ""), normalizeOrigin: (value: string) => value,
    normalizeInviteTargetType: (value: string) => value, isActiveLedgerParticipant: isCommerceEligibleLockedParticipant,
    recoverAcceptedRemoteIdentity,
    app: { log: { info() {}, warn() {} } },
    prisma: {
      user: { async findUnique() { return options.local ? { id: "remote-user" } : null; } },
      splitParticipant: { async findUnique() { return participant; } },
      auditEvent: { async findMany(query: any) { assert.equal(query.where.entityId, "split-1"); return events; } }
    },
    getLockedSnapshotBySplitParticipantId: () => ({ identityRef: options.snapshotRef || "user:remote-user", participantOrigin: null }),
    resolveParticipantDestinationLocal: async () => options.local ? { destinationValue: "local@wallet.test", isVerified: true } : null,
    fetchRemoteParticipantPayoutDestination: async (host: string, user: string) => {
      calls.push(`${host}#${user}`); return { destinationType: "lightning_address", destinationValue: wallet, isVerified: true };
    }
  };
  const api = runInNewContext(js + "\n({resolveAcceptedParticipantRoutingRef,resolveParticipantDestinationHandshake})", context);
  const resolve = () => api.resolveParticipantDestinationHandshake({ participantUserId: "remote-user", splitParticipantId: "recreated-row" });
  return { api, context, participant, original, resolve, calls, changeWallet: () => { wallet = "updated@walletofsatoshi.com"; } };
}

test("checkout recovers recreated collaborator row and fetches the current wallet on every request", async () => {
  const f = fixture();
  assert.equal((await f.resolve()).destinationValue, "first@walletofsatoshi.com");
  f.changeWallet();
  assert.equal((await f.resolve()).destinationValue, "updated@walletofsatoshi.com");
  assert.deepEqual(f.calls, ["https://collaborator.example.test#remote-user", "https://collaborator.example.test#remote-user"]);
  assert.equal(JSON.stringify(f.participant), f.original, "Resolver must not rewrite split/invitation terms");
});

// Real Fastify request/response serialization and production checkout, allocation,
// routing and provider-client functions. Database, creator endpoint and provider
// are fixtures: no live data, external requests or spendable invoices are used.
for (const evidence of [true, false]) {
  test(`public checkout ${evidence ? "sends recovered 50/50 destinations to provider" : "preserves provider payout rejection and removes failed intent"}`, async (t) => {
    const f = fixture({ evidence });
    const api = Fastify(); const provider = Fastify();
    t.after(async () => { await api.close(); await provider.close(); });
    const db: any = f.context.prisma;
    let intent: any; let providerBody: any; let deleted = false; let providerCalls = 0;
    const errors: unknown[] = [];
    db.contentItem = { findUnique: async () => ({ id: "work", ownerUserId: "author", priceSats: 200n }) };
    db.manifest = { findUnique: async () => ({ sha256: "fixture-manifest" }) };
    db.payoutMethod = { findUnique: async () => null };
    db.paymentIntent = {
      create: async ({ data }: any) => (intent = { ...data, id: "fixture-intent", receiptId: "fixture-receipt" }),
      update: async ({ data }: any) => Object.assign(intent, data),
      delete: async () => { deleted = true; }
    };
    provider.post("/public/provider/payment-intents", async (req, reply) => {
      providerCalls++; providerBody = req.body as any;
      const rows = providerBody.participantAllocations;
      if (rows.length !== 2 || rows.some((p: any) => !p.destinationVerified || !p.destinationValue)) {
        return reply.code(409).send({ error: "PARTICIPANT_PAYOUT_DESTINATION_REQUIRED" });
      }
      return { paymentIntentId: "fixture-provider-intent", bolt11: "nonpayable-test-invoice" };
    });
    const fee = { grossAmountSats: "200", creatorNetSats: "200", providerFeeSats: "0", providerInvoicingFeeSats: "0", providerDurableHostingFeeSats: "0" };
    const context = {
      ...f.context, crypto, AbortController, setTimeout, clearTimeout,
      app: { log: { info() {}, warn() {}, error(value: unknown) { errors.push(value); } } },
      mapParticipantCheckoutError, mapPublicPaymentsIntentError,
      parseSats: (x: unknown) => BigInt(String(x || 0)), rateLimit: () => true,
      isSaleable: () => true, resolveBuyerSession: async () => null,
      getRequestIp: () => null, hashIp: () => null,
      resolveCommerceAuthorityForUser: async () => ({ authority: true }),
      resolveProductTier: () => ({ productTier: "basic" }),
      getCapabilityContext: () => ({ paymentsMode: "provider", nodeMode: "basic" }),
      getPaymentsReadiness: async () => ({}),
      resolveProviderServiceProfile: () => ({ needsProviderInvoicing: true, needsDurablePublicHosting: false }),
      resolveEffectivePayoutDestination: async () => ({ valid: true, effectiveDestinationType: "lightning_address" }),
      getNetworkProviderConfig: () => ({ providerUrl: "https://provider.example.test" }),
      evaluateProviderExecutionTrustReadiness: () => ({ allowed: true }), hasProviderPaymentTarget: () => true,
      RECEIPT_TOKEN_TTL_SECONDS: 60, ONCHAIN_MIN_CONFS: 1,
      ensureStableReceiptIdForIntent: async (x: unknown) => x,
      listProviderDelegatedPublishes: () => [{ contentId: "work" }],
      buildLocalNodeIdentityDoc: async () => ({ nodeId: "creator-node" }),
      computeProviderFeeBreakdown: () => fee,
      computeContentParticipantAllocations: async () => ({ splitVersionId: "split-1", allocations: [
        { participantRef: "user:author", participantUserId: "author", splitParticipantId: "author-row", roleKey: "writer", bps: 5000 },
        { participantRef: "user:remote-user", participantUserId: "remote-user", splitParticipantId: "recreated-row", roleKey: "writer", bps: 5000 }
      ] }),
      resolveParticipantDestinationLocal: async (user: string) => user === "author"
        ? { destinationType: "lightning_address", destinationValue: "author@wallet.test", isVerified: true } : null,
      canonicalizeLightningAddress: (x: string) => x.toLowerCase(),
      parsePayoutDestinationType: (x: unknown) => x, parseProviderRemitMode: (x: unknown) => x,
      fetch: async (url: string, options: any) => {
        assert.equal(url, "https://provider.example.test/public/provider/payment-intents");
        assert.equal(options.method, "POST");
        const response = await provider.inject({ method: "POST", url: "/public/provider/payment-intents", headers: options.headers, payload: options.body });
        return { ok: response.statusCode === 200, status: response.statusCode, text: async () => response.body };
      },
      findProviderPaymentIntentByPaymentIntentId: () => null,
      normalizeProviderFallbackPolicy: () => ({ payoutPolicy: "strict", allowProviderFallback: false }),
      resolveNodeIdForRuntimeStatus: () => "fixture-node", upsertProviderPaymentIntentByPaymentIntentId() {},
      resolveNewIntentPayoutExecutionMode: () => "fixture",
      resolveDurableReceiptOriginForSeller: async () => null, deriveProviderFeeReasonLabel: () => "fixture"
    };
    const handler = runInNewContext(js + "\nhandlePublicPaymentsIntents", context);
    api.post("/buy/payments/intents", handler);
    const response = await api.inject({ method: "POST", url: "/buy/payments/intents", payload: { contentId: "work", amountSats: "200" } });
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(providerCalls, 1);
    assert.equal(response.statusCode, evidence ? 200 : 409, response.body);
    assert.equal(deleted, !evidence);
    assert.deepEqual(providerBody.participantAllocations.map((p: any) => p.bps), [5000, 5000]);
    if (evidence) {
      assert.equal(providerBody.participantAllocations[1].destinationValue, "first@walletofsatoshi.com");
      assert.equal(response.json().paymentOptions.lightning.available, true);
      assert.equal(intent.bolt11, "nonpayable-test-invoice");
    } else {
      assert.equal(response.json().code, "PARTICIPANT_PAYOUT_DESTINATION_REQUIRED");
      assert.equal(f.calls.length, 0);
    }
    assert.equal(JSON.stringify(f.participant), f.original);
  });
}
test("the same verified remote ref is available to save/version-copy operations", async () => {
  const f = fixture();
  assert.equal(await f.api.resolveAcceptedParticipantRoutingRef(f.participant, "split-1"), "remote:https://collaborator.example.test#user:remote-user");
  assert.equal(f.participant.bps, 5000);
});
test("no remote lookup occurs without evidence or with conflicting origins", async () => {
  for (const options of [{ evidence: false }, { ambiguous: true }]) {
    const f = fixture(options);
    assert.equal(await f.resolve(), null);
    assert.equal(f.calls.length, 0);
  }
});
test("local payout resolution is preserved", async () => {
  const f = fixture({ local: true });
  assert.equal((await f.resolve()).destinationValue, "local@wallet.test");
  assert.equal(f.calls.length, 0);
});

test("existing locked remote identity remains usable without historical audit recovery", async () => {
  const f = fixture({ evidence: false, snapshotRef: "remote:https://saved.example.test#user:signed-remote-user" });
  assert.equal((await f.resolve()).destinationValue, "first@walletofsatoshi.com");
  assert.deepEqual(f.calls, ["https://saved.example.test#signed-remote-user"]);
});

test("production version-copy route retains recovered origin and avoids a remote-user local FK", async () => {
  const f = fixture();
  const route = ast.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression)
    && ts.isStringLiteral(n.expression.arguments[0]) && n.expression.arguments[0].text === "/content/:id/split-versions"
    && n.expression.expression.getText(ast) === "app.post");
  assert.ok(route);
  let handler: any; let invitation: any; let copied: any;
  const db: any = f.context.prisma;
  db.contentItem = { async findUnique() { return { id: "work", ownerUserId: "author" }; } };
  db.splitVersion = {
    async findFirst() { return { id: "split-1", versionNumber: 1, participants: [f.participant] }; },
    async create({ data }: any) { return { id: "split-2", ...data }; }
  };
  db.splitParticipant.create = async ({ data }: any) => { copied = data; return { id: "copied-row", ...data }; };
  db.splitParticipant.update = async () => ({});
  db.invitation = { async create({ data }: any) { invitation = data; return { id: "new-invite" }; } };
  db.auditEvent.create = async () => ({});
  db.$transaction = async (fn: any) => fn(db);
  const routeJs = ts.transpileModule(route.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const context: any = { ...f.context, requireAuth() {}, requireFeature() {},
    normalizeEmail: (x: unknown) => String(x || "").toLowerCase(), num: Number,
    makeInviteToken: () => "new-fixture-invite", hashInviteToken: () => "fixture-hash",
    app: { log: f.context.app.log, post(_path: string, _options: any, callback: any) { handler = callback; } }
  };
  runInNewContext(js + "\n" + routeJs, context);
  await handler({ user: { sub: "author" }, params: { id: "work" } }, { send: (value: unknown) => value });
  assert.equal(invitation.acceptedIdentityRef, "remote:https://collaborator.example.test#user:remote-user");
  assert.equal(invitation.acceptedByUserId, null);
  assert.equal(copied.bps, 5000);
  assert.equal(copied.percent, 50);
  assert.equal(copied.role, "writer");
  assert.equal(JSON.stringify(f.participant), f.original);
});
