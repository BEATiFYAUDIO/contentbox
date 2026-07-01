import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const serverPath = path.resolve(process.cwd(), "src/server.ts");
const serverSource = fs.readFileSync(serverPath, "utf8");

function extractFunction(name: string): string {
  const start = serverSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  let brace = serverSource.indexOf("{", start);
  assert.notEqual(brace, -1, `missing ${name} body`);
  let depth = 0;
  for (let i = brace; i < serverSource.length; i++) {
    const ch = serverSource[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return serverSource.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const browserSource = `
const apiBase = "https://creator.example";
const contentId = "content123";
const shareToken = "";
function qs(value){ return encodeURIComponent(value); }
${extractFunction("streamUrl")}
${extractFunction("previewFallbackUrl")}
${extractFunction("basicPrimaryUrl")}
${extractFunction("offerCoverUrl")}
${extractFunction("resolveBasicDeliveryMode")}
${extractFunction("inferPreviewKind")}
${extractFunction("resolveRenderablePreview")}
${extractFunction("resolveAuthorizedPlayback")}
`;

const context = vm.createContext({});
vm.runInContext(browserSource, context);
const resolveAuthorizedPlayback = vm.runInContext("resolveAuthorizedPlayback", context) as (offer: any, opts: any) => any;

function baseOffer(overrides: Record<string, unknown> = {}) {
  return {
    contentId: "content123",
    manifestSha256: "manifest123",
    primaryFileId: "files/master.mp3",
    primaryFileMime: "audio/mpeg",
    previewObjectKey: "previews/content123-preview.mp3",
    type: "song",
    fullMediaUrl: "https://creator.example/public/content/content123/preview-file?objectKey=files%2Fmaster.mp3",
    fullContentUrl: "https://creator.example/public/content/content123/preview-file?objectKey=files%2Fmaster.mp3",
    previewUrl: "https://creator.example/public/content/content123/preview-file?objectKey=previews%2Fcontent123-preview.mp3",
    ...overrides
  };
}

function assertPlayback(label: string, offer: any, opts: any, expected: { mode: string; srcIncludes?: string; empty?: boolean }) {
  const playback = resolveAuthorizedPlayback(offer, opts);
  assert.equal(playback.mode, expected.mode, `${label}: mode`);
  if (expected.empty) {
    assert.equal(playback.src, "", `${label}: empty src`);
  } else if (expected.srcIncludes) {
    assert.match(playback.src, new RegExp(expected.srcIncludes), `${label}: src`);
  }
  return playback;
}

assertPlayback(
  "free content plays full",
  baseOffer({
    isFree: true,
    hasFullAccess: true,
    playback: {
      mode: "full",
      streamUrl: "https://creator.example/public/content/content123/preview-file?objectKey=files%2Fmaster.mp3",
      previewLimitSeconds: null,
      canPlayFull: true
    }
  }),
  { entitlement: null, owned: false, token: null },
  { mode: "full", srcIncludes: "files%2Fmaster" }
);

assertPlayback(
  "paid locked content plays preview only",
  baseOffer({
    priceSats: "1000",
    hasFullAccess: false,
    isFree: false,
    playback: {
      mode: "preview",
      streamUrl: "https://creator.example/public/content/content123/preview-file?objectKey=previews%2Fcontent123-preview.mp3",
      previewLimitSeconds: 25,
      canPlayFull: false,
      reason: "full_access_required"
    }
  }),
  { entitlement: { status: "preview" }, owned: false, token: null },
  { mode: "preview", srcIncludes: "previews%2Fcontent123-preview" }
);

assertPlayback(
  "paid owned content plays full",
  baseOffer({
    priceSats: "1000",
    hasFullAccess: true,
    owned: true,
    playback: {
      mode: "full",
      streamUrl: "https://creator.example/public/content/content123/preview-file?objectKey=files%2Fmaster.mp3",
      previewLimitSeconds: null,
      canPlayFull: true
    }
  }),
  { entitlement: { status: "paid" }, owned: true, token: null },
  { mode: "full", srcIncludes: "files%2Fmaster" }
);

assertPlayback(
  "paid no-preview content does not attempt playback",
  baseOffer({
    priceSats: "1000",
    hasFullAccess: false,
    previewObjectKey: null,
    playback: {
      mode: "none",
      streamUrl: null,
      previewLimitSeconds: null,
      canPlayFull: false,
      reason: "preview_unavailable"
    }
  }),
  { entitlement: null, owned: false, token: null },
  { mode: "none", empty: true }
);

assertPlayback(
  "legacy fallback fields still work if playback is absent",
  baseOffer({
    playback: undefined,
    hasFullAccess: true,
    isFree: true
  }),
  { entitlement: null, owned: false, token: null },
  { mode: "full", srcIncludes: "files%2Fmaster" }
);

assertPlayback(
  "locked legacy fallback does not use fullMediaUrl",
  baseOffer({
    playback: undefined,
    hasFullAccess: false,
    isFree: false,
    priceSats: "1000"
  }),
  { entitlement: null, owned: false, token: null },
  { mode: "preview", srcIncludes: "previews%2Fcontent123-preview" }
);

assertPlayback(
  "playback preview prevents fullMediaUrl fallback",
  baseOffer({
    hasFullAccess: false,
    isFree: false,
    priceSats: "1000",
    playback: {
      mode: "preview",
      streamUrl: "https://creator.example/public/content/content123/preview-file?objectKey=previews%2Fcontent123-preview.mp3",
      previewLimitSeconds: 25,
      canPlayFull: false
    }
  }),
  { entitlement: null, owned: false, token: null },
  { mode: "preview", srcIncludes: "previews%2Fcontent123-preview" }
);

const guarded = assertPlayback(
  "playback full without canPlayFull cannot use fullMediaUrl",
  baseOffer({
    hasFullAccess: false,
    isFree: false,
    priceSats: "1000",
    playback: {
      mode: "full",
      streamUrl: "https://creator.example/public/content/content123/preview-file?objectKey=files%2Fmaster.mp3",
      previewLimitSeconds: null,
      canPlayFull: false
    }
  }),
  { entitlement: null, owned: false, token: null },
  { mode: "preview", srcIncludes: "previews%2Fcontent123-preview" }
);
assert.doesNotMatch(guarded.src, /files%2Fmaster/, "guarded full URL must not be used");

console.log("canonical_playback_browser_smoke OK");
