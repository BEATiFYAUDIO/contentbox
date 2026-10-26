import { availablePreviewKey } from "./derivedPreview.js";
// Disposable SQLite + real Fastify handlers. Runtime posture/identity are fixture seams;
// no installed Core, external provider, payment creation, or real buyer session is used.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { PrismaClient } from "@prisma/client";
import * as metadata from "./primaryFileMetadata.js";
import * as lifecycle from "./contentLifecycle.js";
import * as access from "./contentAccess.js";
import * as security from "./deliverySecurity.js";
import { buildCanonicalPlayback } from "./publicPlayback.js";

export const formats = [
  ["pdf", "application/pdf"], ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["odt", "application/vnd.oasis.opendocument.text"], ["rtf", "application/rtf"],
  ["txt", "text/plain"], ["md", "text/markdown"], ["jpg", "image/jpeg"],
  ["png", "image/png"], ["webp", "image/webp"], ["gif", "image/gif"], ["svg", "image/svg+xml"],
  ["epub", "application/epub+zip"], ["csv", "text/csv"], ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"], ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["zip", "application/zip"], ["mp3", "audio/mpeg"], ["mp4", "video/mp4"],
  ["wav", "audio/wav"], ["flac", "audio/flac"], ["ogg", "audio/ogg"], ["webm", "video/webm"]
];
export function serverFunctions(names: string[], source?: string) {
  const text = source ?? fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("server.ts", text, ts.ScriptTarget.Latest, true);
  return names.map(name => {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    if (!node) throw Error(`Missing server function: ${name}`);
    return node.getText(ast);
  }).join("\n");
}

export function serverConstant(name: string, source?: string) {
  const text = source ?? fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("server.ts", text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.filter(ts.isVariableStatement)
    .flatMap(n => [...n.declarationList.declarations]).find(n => n.name.getText(ast) === name);
  if (!declaration?.initializer) throw Error(`Missing server constant: ${name}`);
  return vm.runInNewContext(ts.transpileModule(`(${declaration.initializer.getText(ast)})`, {}).outputText);
}

export async function metadataFixture(source?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certifyd-mime-"));
  const api = fileURLToPath(new URL("../..", import.meta.url));
  const url = `file:${path.join(dir, "fixture.db").replace(/\\/g, "/")}`;
  fs.writeFileSync(path.join(dir, "fixture.db"), "");
  execFileSync(process.execPath, [path.join(api, "node_modules/prisma/build/index.js"), "db", "push", "--schema", path.join(api, "prisma/schema.prisma"), "--skip-generate"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: "event", level: "query" }] });
  const queries: string[] = [];
  db.$on("query", e => queries.push(e.query));
  const owner = await db.user.create({ data: { email: "creator@fixture.invalid", displayName: "fixturecreator" } });
  const buyer = await db.buyer.create({ data: { email: "buyer@fixture.invalid" } });
  const app = Fastify({ logger: false });
  await app.register(jwt, { secret: "isolated-metadata-regression-secret-not-a-live-key" });
  let nodeMode = "advanced";
  let seq = 0;
  const readSession = async (req: any) => req.headers["x-fixture-buyer"] === buyer.id ? { id: "fixture-session", buyer } : null;
  const hasAccess = async (id: string, contentId: string) => Boolean(await db.entitlement.findUnique({ where: { buyerId_contentId: { buyerId: id, contentId } } }));
  const context: any = vm.createContext({
    ...metadata, ...lifecycle, ...access, ...security, buildCanonicalPlayback, availablePreviewKey,
    fsSync: fs, fs: fsp, path, crypto, Buffer, URL, Date, console,
    process: { env: { NODE_ENV: "production" } }, prisma: db, app,
    asString: (v: any) => String(v ?? ""),
    ALLOWED_PRIMARY_TOPICS: serverConstant("ALLOWED_PRIMARY_TOPICS", source),
    PUBLIC_PROFILE_THEME_USER_SELECT: {}, PUBLIC_DELIVERY_TOKEN_TTL_SECONDS: 120, RECEIPT_TOKEN_TTL_SECONDS: 3600,
    STREAM_TOKEN_MODE: "optional", previewTokens: new Map(), isPreviewToken: () => false,
    verifyPermit: () => ({ ok: false }),
    resolveBuyerSession: readSession, resolveBuyerReadSession: readSession, hasAccess,
    reconcileBuyerEntitlementsFromPurchaseHistory: async () => {},
    resolveReceiptContextForRequest: async () => null,
    recordAudienceViewEvent: async () => {}, findLatestContentPublishProofForContent: () => null,
    resolveCommerceAuthorityForUser: async () => ({ authority: true, localAuthority: true }),
    resolveSellerLightningAddress: async () => null, getNetworkProviderConfig: () => ({}), hasProviderPaymentTarget: () => false,
    resolveProductTier: () => ({ productTier: nodeMode }), getNodeModeStatus: () => ({ nodeMode }),
    resolveCanonicalPublicOrigin: (req: any) => `http://${req.headers.host}`,
    getPublicStatusCached: () => ({ status: "online" }), getDiscoveryOriginHealthCached: async () => ({ state: "healthy" }),
    deriveDiscoveryOriginTrust: () => "stable", resolveDiscoveryAppOrigin: () => "https://fan.fixture.invalid",
    buildDiscoveryUrl: ({ contentId }: any) => `https://fan.fixture.invalid/watch/${contentId}`,
    buildPublicUrlFromOrigin: (base: string, suffix: string) => base + suffix,
    resolveCreatorHandleForDiscoverable: () => "fixturecreator", resolveCreatorAvatarUrlForPublicPayload: () => null,
    publicProfileThemeFromUser: () => null, applyFanReadCors: () => {},
    getLockedParticipantSnapshotsForSplitVersion: async () => [], isTopologyNeutralLockedSnapshotEligible: () => true
  });
  const names = ["badRequest", "notFound", "forbidden", "unauthorized", "normalizePrimaryTopic", "resolvePublicAccessMode",
    "decodeDiscoverableCursor", "encodeDiscoverableCursor", "buildPublicRelationshipSummary", "getPublicOfferGate",
    "getCoverAssetFromManifest", "previewExtForMime", "stablePreviewObjectKey", "isStablePreviewObjectKey",
    "isLegacyGeneratedPreviewRecord", "resolvePublishedPreviewObjectKey", "getAvailablePreviewKey",
    "isAudioVideoMime", "isProtectedStreamOnlyMedia", "isEncryptedHlsPlaybackEnabled", "parseRangeHeader",
    "createPublicDeliveryToken", "verifyPublicDeliveryToken", "appendPublicDeliveryToken", "resolvePaymentMethodFromIntent",
    "handlePublicBuyerEntitlements", "handlePublicCoverFile", "handlePublicDiscoverableContent", "handlePublicContent", "handlePublicOffer", "handlePublicContentFile", "handlePublicPreviewFile"];
  vm.runInContext(ts.transpileModule(serverFunctions(names, source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  app.get("/api/buyer/entitlements", context.handlePublicBuyerEntitlements);
  app.get("/public/content/:id/cover", context.handlePublicCoverFile);
  app.get("/public/discoverable-content", context.handlePublicDiscoverableContent);
  app.get("/public/content/:id", context.handlePublicContent);
  app.get("/buy/content/:contentId/offer", context.handlePublicOffer);
  app.get("/content/:manifestHash/:fileId", context.handlePublicContentFile);
  app.get("/public/content/:id/preview-file", context.handlePublicPreviewFile);

  async function seed(ext: string, mime: string, options: { paid?: boolean; type?: string; coverMime?: string; legacyObject?: boolean; historical?: boolean } = {}) {
    const id = `mime_fixture_${++seq}`;
    const repoPath = path.join(dir, id);
    const key = `files/primary.${ext}`, coverKey = "files/cover.jpg", previewKey = `previews/${id}-preview.mp3`;
    const bytes = Buffer.from(`fixture-original-${id}-${ext}`);
    fs.mkdirSync(path.join(repoPath, "files"), { recursive: true }); fs.mkdirSync(path.join(repoPath, "previews"));
    fs.writeFileSync(path.join(repoPath, key), bytes); fs.writeFileSync(path.join(repoPath, coverKey), "fixture-cover"); fs.writeFileSync(path.join(repoPath, previewKey), "fixture-preview");
    const files = [{ objectKey: coverKey, mime: options.coverMime || "image/jpeg" }, { objectKey: previewKey, mime: "audio/mpeg" }, { objectKey: key, mime }];
    const manifest = { primaryFile: options.legacyObject ? { path: key, mime } : key, cover: coverKey, preview: previewKey, files };
    const sha256 = crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    const content = await db.contentItem.create({ data: {
      id, title: `Fixture ${ext}`, type: (options.type || "file") as any, ownerUserId: owner.id,
      status: "published", storefrontStatus: "LISTED", priceSats: options.paid ? 100n : 0n,
      primaryTopic: "news", deliveryMode: "stream_only", repoPath,
      ...(options.historical ? { createdAt: new Date("2023-01-01"), updatedAt: new Date("2023-01-01") } : {}),
      files: { create: files.map(f => ({ ...f, originalName: path.basename(f.objectKey), sizeBytes: BigInt(bytes.length), sha256: "fixture", encDek: "", encAlg: "" })) }
    } });
    const m = await db.manifest.create({ data: { contentId: id, json: manifest, sha256 } });
    await db.contentItem.update({ where: { id }, data: { manifestId: m.id } });
    return { content, id, key, coverKey, previewKey, manifest, sha256, bytes, mime };
  }
  return { app, db, dir, seed, owner, buyer, queries, context,
    setNodeMode: (mode: string) => { nodeMode = mode; },
    async close() { await app.close(); await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}
