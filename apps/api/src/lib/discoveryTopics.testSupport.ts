// Production route handlers with disposable SQLite. Identity, network readiness,
// provider receipt emission and tunnel startup are isolated fixture seams.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { metadataFixture, serverFunctions } from "./primaryFileMetadata.testSupport.js";
import { initContentRepo } from "./repo.js";
import { computeManifestHash } from "./proof.js";
import { sumBps } from "./settlement.js";
import { assertCanPublish } from "./publishGate.js";
import { assertCanPublish as assertLifecycleCanPublish } from "./contentLifecycle.js";
import * as publication from "./contentPublish.js";

export function routeHandler(method: string, route: string) {
  const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (call.expression.getText(ast) !== `app.${method}` || !ts.isStringLiteral(call.arguments[0]) || call.arguments[0].text !== route) continue;
    return call.arguments[call.arguments.length - 1].getText(ast);
  }
  throw Error(`Missing ${method} ${route}`);
}

export async function topicFixture() {
  const f = await metadataFixture();
  f.app.setErrorHandler((error, _req, reply) => reply.code(500).send({ error: String(error) }));
  let cleared = true;
  Object.assign(f.context, {
    CONTENTBOX_ROOT: f.dir, initContentRepo, computeManifestHash, sumBps,
    assertCanPublish, assertLifecycleCanPublish, ...publication,
    getCapabilityContext: () => ({ productTier: "advanced", paymentsMode: "node", namedReady: true }),
    resolveDerivativeInfo: async (_id: string, type: string) => ({ isDerivative: type === "derivative", clearanceCleared: cleared, clearanceId: null }),
    ensureManifestForContent: (content: any) => f.db.manifest.findUniqueOrThrow({ where: { id: content.manifestId } }),
    buildLocalNodeIdentityDoc: async () => ({ nodeId: "fixture-node", nodePubKey: "fixture-public-key" }),
    getPaymentsReadiness: async () => ({ lightning: { ready: true }, onchain: { ready: false } }),
    isNetworkProviderConfigured: () => false,
    resolveRuntimeConfig: () => ({ nodeMode: "advanced" }),
    resolveBuyerFacingOrigin: () => "https://core.fixture.invalid",
    invalidatePublicProfileProjectionCachesForUser: () => ({}),
    triggerPublicStartBestEffort: async () => {}, appendLifecycleReceiptSafe: () => {},
    isAcceptedParticipant: async () => false
  });
  vm.runInContext(ts.transpileModule(serverFunctions(["readManifest", "toBps", "num", "percentToPrimitive"]), {}).outputText, f.context);
  for (const [method, route] of [["post", "/content"], ["patch", "/content/:id/primary-topic"], ["post", "/api/content/:contentId/publish"]]) {
    const handler = vm.runInContext(ts.transpileModule(`(${routeHandler(method, route)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, f.context);
    f.app.route({ method: method.toUpperCase() as "POST" | "PATCH", url: route,
      preHandler: async (req, reply) => { try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: "Unauthorized" }); } }, handler });
  }
  return { ...f, headers: { authorization: `Bearer ${f.app.jwt.sign({ sub: f.owner.id })}` },
    setClearance: (value: boolean) => { cleared = value; } };
}
