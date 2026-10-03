import assert from "node:assert/strict";
import test from "node:test";
import { verifySocialProof } from "./proof.service.js";

const createdAt = new Date("2026-04-21T00:00:00.000Z");
const account = "certifydofficial";
const nonce = "1e8c60105d37be6de8ead458602bd4b6";
const fullTikTokMarker = `certifyd-proof provider=tiktok account=${account} nonce=${nonce}`;
const shortTikTokMarker = `certifyd-proof account=${account} nonce=${nonce}`;
const location = `https://www.tiktok.com/@${account}`;

type FetchFixture = {
  body: string;
  status?: number;
  finalUrl?: string;
  contentType?: string;
  redirected?: boolean;
};

function html(body: string): string {
  return `<!doctype html><html><head><title>TikTok</title></head><body>${body}</body></html>`;
}

function makeFetch({ body, status = 200, finalUrl = location, contentType = "text/html; charset=utf-8", redirected = false }: FetchFixture) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    redirected,
    url: finalUrl,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? contentType : null },
    text: async () => body
  }) as any;
}

function proofRow(provider: string, proofAccount: string, challengeText: string) {
  return {
    id: "proof-1",
    userId: "user-1",
    proofType: "social",
    subject: `${provider}:${proofAccount}`,
    claimJson: { provider, account: proofAccount, profileUrl: provider === "tiktok" ? `https://www.tiktok.com/@${proofAccount}` : `https://github.com/${proofAccount}`, challengeText },
    signature: null,
    status: "pending",
    verificationMethod: "url_text",
    location: null,
    createdAt,
    updatedAt: createdAt,
    verifiedAt: null,
    revokedAt: null,
    failureReason: null
  };
}

class ProofPrismaStub {
  row: any;
  constructor(row: any) { this.row = row; }
  proofRecord = {
    findUnique: async ({ where }: any) => {
      const key = where?.userId_proofType_subject;
      if (!key || key.userId !== this.row.userId || key.proofType !== this.row.proofType || key.subject !== this.row.subject) return null;
      return { id: this.row.id, claimJson: this.row.claimJson };
    },
    update: async ({ where, data }: any) => {
      assert.equal(where.id, this.row.id);
      Object.assign(this.row, data, { updatedAt: new Date("2026-04-21T00:01:00.000Z") });
      return this.row;
    }
  };
}

async function withFetch<T>(fixture: FetchFixture, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as any).fetch = makeFetch(fixture);
  try { return await fn(); }
  finally { (globalThis as any).fetch = original; }
}

async function verifyTikTok(challengeText: string, body: string, fixture: Partial<FetchFixture> = {}) {
  const prisma = new ProofPrismaStub(proofRow("tiktok", account, challengeText));
  const proof = await withFetch({ body, ...fixture }, () => verifySocialProof(prisma as any, "user-1", "tiktok", account, location));
  return { proof, row: prisma.row };
}

test("TikTok full marker verifies", async () => {
  const { proof } = await verifyTikTok(fullTikTokMarker, html(fullTikTokMarker));
  assert.equal(proof.status, "verified");
  assert.equal(proof.failureReason, null);
});

test("TikTok short marker verifies against existing full stored challenge", async () => {
  const { proof } = await verifyTikTok(fullTikTokMarker, html(shortTikTokMarker));
  assert.equal(proof.status, "verified");
});

test("TikTok short marker verifies against new short stored challenge", async () => {
  const { proof } = await verifyTikTok(shortTikTokMarker, html(shortTikTokMarker));
  assert.equal(proof.status, "verified");
});

test("short marker is not accepted for non-TikTok providers", async () => {
  const githubAccount = "beatifyaudio";
  const githubFull = `certifyd-proof provider=github account=${githubAccount} nonce=${nonce}`;
  const githubShort = `certifyd-proof account=${githubAccount} nonce=${nonce}`;
  const prisma = new ProofPrismaStub(proofRow("github", githubAccount, githubFull));
  const proof = await withFetch({ body: html(githubShort), finalUrl: `https://github.com/${githubAccount}` }, () =>
    verifySocialProof(prisma as any, "user-1", "github", githubAccount, `https://github.com/${githubAccount}`)
  );
  assert.equal(proof.status, "pending");
  assert.notEqual(proof.failureReason, null);
});

test("TikTok exact account and nonce are required", async () => {
  assert.equal((await verifyTikTok(fullTikTokMarker, html(`certifyd-proof account=other nonce=${nonce}`))).proof.status, "pending");
  assert.equal((await verifyTikTok(fullTikTokMarker, html(`certifyd-proof account=${account} nonce=0000${nonce.slice(4)}`))).proof.status, "pending");
  assert.equal((await verifyTikTok(fullTikTokMarker, html(`certifyd-proof account=${account} nonce=stale${nonce}`))).proof.status, "pending");
});

test("TikTok short marker split across lines verifies", async () => {
  const splitMarker = `certifyd-proof account=${account}\nnonce=${nonce}`;
  const { proof } = await verifyTikTok(fullTikTokMarker, html(splitMarker));
  assert.equal(proof.status, "verified");
});

test("TikTok marker in meta description can verify", async () => {
  const body = `<!doctype html><html><head><meta name="description" content="${shortTikTokMarker}"></head><body></body></html>`;
  const { proof } = await verifyTikTok(fullTikTokMarker, body);
  assert.equal(proof.status, "verified");
});

test("TikTok marker in embedded JSON can verify", async () => {
  const body = html(`<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ user: { signature: shortTikTokMarker } })}</script>`);
  const { proof } = await verifyTikTok(fullTikTokMarker, body);
  assert.equal(proof.status, "verified");
});

test("TikTok hydration shell without proof stays pending", async () => {
  const { proof } = await verifyTikTok(fullTikTokMarker, html(`<script id="__NEXT_DATA__">{}</script>`));
  assert.equal(proof.status, "pending");
  assert.equal(proof.failureReason, "tiktok-dynamic-shell-or-gated");
});

test("TikTok login or gated response stays pending", async () => {
  const { proof } = await verifyTikTok(fullTikTokMarker, html("Log in to continue. Verify you are human captcha."));
  assert.equal(proof.status, "pending");
  assert.equal(proof.failureReason, "tiktok-dynamic-shell-or-gated");
});

test("TikTok redirect to unrelated account/domain fails closed", async () => {
  const { proof } = await verifyTikTok(fullTikTokMarker, html(shortTikTokMarker), {
    finalUrl: "https://example.com/not-tiktok",
    redirected: true
  });
  assert.equal(proof.status, "pending");
  assert.equal(proof.failureReason, "social-location-redirect-mismatch");
});
import { createSocialChallenge } from "./proof.service.js";

class ChallengePrismaStub {
  rows: any[] = [];
  witness = {
    id: "witness-1",
    userId: "user-1",
    algorithm: "ed25519",
    publicKey: Buffer.alloc(32, 7).toString("base64"),
    fingerprint: "fingerprint-1",
    createdAt,
    revokedAt: null
  };
  witnessIdentity = {
    findUnique: async ({ where }: any) => where.userId === "user-1" ? this.witness : null
  };
  witnessIdentityKey = {
    findFirst: async () => ({
      id: "key-1",
      witnessIdentityId: "witness-1",
      userId: "user-1",
      algorithm: "ed25519",
      publicKey: this.witness.publicKey,
      fingerprint: this.witness.fingerprint,
      status: "active",
      createdAt,
      activatedAt: createdAt,
      revokedAt: null
    }),
    create: async () => ({ id: "key-1" })
  };
  witnessIdentityEvent = { create: async () => ({ id: "event-1" }) };
  proofRecord = {
    findUnique: async () => null,
    upsert: async ({ create, update }: any) => {
      const row = {
        id: `proof-${this.rows.length + 1}`,
        signature: null,
        createdAt,
        updatedAt: createdAt,
        verifiedAt: null,
        revokedAt: null,
        failureReason: null,
        ...(create || update)
      };
      this.rows.push(row);
      return row;
    }
  };
}

test("Core generates canonical social proof markers by provider", async () => {
  const cases = [
    ["spotify", "https://open.spotify.com/artist/1pKR6nU0QhMlbouug8OPtD", /^Certifyd proof: [0-9a-f]{32}$/],
    ["youtube", "https://www.youtube.com/@BeatifyGroup", /^certifyd-proof provider=youtube account=beatifygroup nonce=[0-9a-f]{32}$/],
    ["github", "BEATiFYAUDIO", /^certifyd-proof provider=github account=beatifyaudio nonce=[0-9a-f]{32}$/],
    ["tiktok", "https://www.tiktok.com/@certifydofficial", /^certifyd-proof account=certifydofficial nonce=[0-9a-f]{32}$/]
  ] as const;

  for (const [provider, input, pattern] of cases) {
    const prisma = new ChallengePrismaStub();
    const proof = await createSocialChallenge(prisma as any, "user-1", provider, input);
    const challengeText = String((proof.claimJson as any).challengeText || "");
    assert.match(challengeText, pattern, provider);
    if (provider === "tiktok") assert.equal(challengeText.length <= 80, true);
  }
});
