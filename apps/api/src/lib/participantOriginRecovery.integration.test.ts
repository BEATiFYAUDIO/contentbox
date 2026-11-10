import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { recoverAcceptedRemoteIdentity } from "./participantOriginRecovery.js";
import { isCommerceEligibleLockedParticipant } from "./splitAuthority.js";

// Execute the production resolver functions in isolation: importing server.ts
// would start the API, background jobs and live DB. All I/O here is injected.
const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const names = ["parseRemoteIdentityRef", "parseUserIdFromParticipantRef", "inferLockedParticipantIdentityRef",
  "resolveAcceptedParticipantRoutingRef", "resolveParticipantDestinationHandshake"];
const extracted = names.map(name => {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Production function missing: ${name}`);
  return node.getText(ast);
}).join("\n");
const js = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture(options: { evidence?: boolean; local?: boolean; ambiguous?: boolean } = {}) {
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
    getLockedSnapshotBySplitParticipantId: () => ({ identityRef: "user:remote-user", participantOrigin: null }),
    resolveParticipantDestinationLocal: async () => options.local ? { destinationValue: "local@wallet.test", isVerified: true } : null,
    fetchRemoteParticipantPayoutDestination: async (host: string, user: string) => {
      calls.push(`${host}#${user}`); return { destinationValue: wallet, isVerified: true };
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
