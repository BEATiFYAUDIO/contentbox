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

function providerProfileUrl(provider: string, proofAccount: string) {
  if (provider === "tiktok") return `https://www.tiktok.com/@${proofAccount}`;
  if (provider === "spotify") return `https://open.spotify.com/artist/${proofAccount}`;
  if (provider === "youtube") return `https://www.youtube.com/@${proofAccount}`;
  if (provider === "reddit") return `https://www.reddit.com/user/${proofAccount}`;
  return `https://github.com/${proofAccount}`;
}

function proofRow(provider: string, proofAccount: string, challengeText: string) {
  return {
    id: "proof-1",
    userId: "user-1",
    proofType: "social",
    subject: `${provider}:${proofAccount}`,
    claimJson: { provider, account: proofAccount, profileUrl: providerProfileUrl(provider, proofAccount), challengeText },
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
  userResult: any;
  constructor(userResult: any = { displayName: "Beatify Group", email: "beatify@example.com" }) { this.userResult = userResult; }
  user = {
    findUnique: async ({ where }: any) => where.id === "user-1" ? this.userResult : null
  };
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

test("Core generates one canonical social proof envelope for every provider", async () => {
  const previousOrigin = process.env.CONTENTBOX_PUBLIC_ORIGIN;
  process.env.CONTENTBOX_PUBLIC_ORIGIN = "https://certifyd.beatifygroup.com";
  const cases = [
    ["github", "BEATiFYAUDIO", "beatifyaudio"],
    ["youtube", "https://www.youtube.com/@BeatifyGroup", "beatifygroup"],
    ["spotify", "https://open.spotify.com/artist/1pKR6nU0QhMlbouug8OPtD", "1pKR6nU0QhMlbouug8OPtD"],
    ["tiktok", "https://www.tiktok.com/@certifydofficial", "certifydofficial"],
    ["instagram", "https://www.instagram.com/beatifygroup/", "beatifygroup"],
    ["x", "https://x.com/beatifygroup", "beatifygroup"],
    ["rumble", "https://rumble.com/c/beatifygroup", "beatifygroup"],
    ["reddit", "https://www.reddit.com/user/Lopsided_Horror_9957/", "lopsided_horror_9957"],
    ["substack", "https://beatifygroup.substack.com", "beatifygroup"]
  ] as const;

  try {
    for (const [provider, input, normalizedAccount] of cases) {
      const prisma = new ChallengePrismaStub();
      const proof = await createSocialChallenge(prisma as any, "user-1", provider, input);
      const claim = proof.claimJson as any;
      const challengeText = String(claim.challengeText || "");
      assert.equal(claim.certifydProfileUrl, "https://certifyd.beatifygroup.com/u/beatify-group", provider);
      assert.match(
        challengeText,
        new RegExp(`^certifyd-proof provider=${provider} account=${normalizedAccount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} nonce=[0-9a-f]{32} profile=https://certifyd\.beatifygroup\.com/u/beatify-group$`),
        provider
      );
      assert.equal(challengeText.includes("Certifyd proof:"), false, provider);
      assert.equal(challengeText.includes("Certifyd profile:"), false, provider);
      assert.equal(Boolean(claim.providerProfileUrl?.includes("certifyd.beatifygroup.com")), false, provider);
    }
  } finally {
    if (previousOrigin === undefined) delete process.env.CONTENTBOX_PUBLIC_ORIGIN;
    else process.env.CONTENTBOX_PUBLIC_ORIGIN = previousOrigin;
  }
});

test("canonical social proof envelope tolerates wrapped whitespace and preserves exact checks", async () => {
  const githubAccount = "beatifyaudio";
  const canonical = `certifyd-proof provider=github account=${githubAccount} nonce=${nonce} profile=https://certifyd.beatifygroup.com/u/beatify-group`;
  const wrapped = `certifyd-proof\nprovider=github\naccount=${githubAccount}\nnonce=${nonce}\nprofile=https://certifyd.beatifygroup.com/u/beatify-group`;
  const prisma = new ProofPrismaStub(proofRow("github", githubAccount, canonical));
  const proof = await withFetch({ body: html(wrapped), finalUrl: `https://github.com/${githubAccount}` }, () =>
    verifySocialProof(prisma as any, "user-1", "github", githubAccount, `https://github.com/${githubAccount}`)
  );
  assert.equal(proof.status, "verified");

  for (const bad of [
    `certifyd-proof provider=youtube account=${githubAccount} nonce=${nonce} profile=https://certifyd.beatifygroup.com/u/beatify-group`,
    `certifyd-proof provider=github account=other nonce=${nonce} profile=https://certifyd.beatifygroup.com/u/beatify-group`,
    `certifyd-proof provider=github account=${githubAccount} nonce=0000${nonce.slice(4)} profile=https://certifyd.beatifygroup.com/u/beatify-group`,
    `certifyd-proof provider=github account=${githubAccount} nonce=${nonce} profile=https://github.com/${githubAccount}`
  ]) {
    const row = new ProofPrismaStub(proofRow("github", githubAccount, canonical));
    const failed = await withFetch({ body: html(bad), finalUrl: `https://github.com/${githubAccount}` }, () =>
      verifySocialProof(row as any, "user-1", "github", githubAccount, `https://github.com/${githubAccount}`)
    );
    assert.equal(failed.status, "pending", bad);
  }
});

test("social challenge creation fails safely without public profile handle", async () => {
  const previousOrigin = process.env.CONTENTBOX_PUBLIC_ORIGIN;
  process.env.CONTENTBOX_PUBLIC_ORIGIN = "https://certifyd.beatifygroup.com";
  try {
    await assert.rejects(
      () => createSocialChallenge(new ChallengePrismaStub({ displayName: "", email: "" }) as any, "user-1", "github", "BEATiFYAUDIO"),
      /PUBLIC_PROFILE_HANDLE_REQUIRED/
    );
  } finally {
    if (previousOrigin === undefined) delete process.env.CONTENTBOX_PUBLIC_ORIGIN;
    else process.env.CONTENTBOX_PUBLIC_ORIGIN = previousOrigin;
  }
});

const redditAccount = "lopsided_horror_9957";
const redditMarker = `certifyd-proof provider=reddit account=${redditAccount} nonce=${nonce}`;
const redditMarkerSplit = `certifyd-proof provider=reddit\naccount=${redditAccount}\nnonce=${nonce}`;
const redditCanonicalLocation = "https://www.reddit.com/user/Lopsided_Horror_9957/";
const redditLegacyLocation = "https://old.reddit.com/user/lopsided_horror_9957/";

async function verifyReddit(inputLocation: string, body: string, fixture: Partial<FetchFixture> = {}, inputAccount = redditAccount) {
  const prisma = new ProofPrismaStub({
    ...proofRow("reddit", redditAccount, redditMarker),
    claimJson: { provider: "reddit", account: redditAccount, profileUrl: redditCanonicalLocation, challengeText: redditMarker }
  });
  const proof = await withFetch({ body, finalUrl: inputLocation, ...fixture }, () => verifySocialProof(prisma as any, "user-1", "reddit", inputAccount, inputLocation));
  return { proof, row: prisma.row };
}

test("Reddit canonical www user proof verifies", async () => {
  const { proof } = await verifyReddit(redditCanonicalLocation, html(redditMarkerSplit), { finalUrl: redditCanonicalLocation });
  assert.equal(proof.status, "verified");
  assert.equal(proof.failureReason, null);
});

test("Reddit legacy old.reddit.com user proof verifies", async () => {
  const { proof } = await verifyReddit(redditLegacyLocation, html(redditMarkerSplit), { finalUrl: redditLegacyLocation });
  assert.equal(proof.status, "verified");
  assert.equal(proof.failureReason, null);
});

test("Reddit username case differences normalize correctly", async () => {
  const { proof } = await verifyReddit(redditCanonicalLocation, html(redditMarkerSplit), { finalUrl: redditCanonicalLocation }, "Lopsided_Horror_9957");
  assert.equal(proof.status, "verified");
});

test("Reddit wrong username location fails", async () => {
  await assert.rejects(
    () => verifyReddit("https://www.reddit.com/user/other_user/", html(redditMarker), { finalUrl: "https://www.reddit.com/user/other_user/" }),
    /SOCIAL_LOCATION_MISMATCH/
  );
});

test("Reddit wrong or stale nonce fails", async () => {
  const wrong = await verifyReddit(redditCanonicalLocation, html(`certifyd-proof provider=reddit account=${redditAccount} nonce=0000${nonce.slice(4)}`), { finalUrl: redditCanonicalLocation });
  assert.equal(wrong.proof.status, "pending");
  const stale = await verifyReddit(redditCanonicalLocation, html(`certifyd-proof provider=reddit account=${redditAccount} nonce=stale${nonce}`), { finalUrl: redditCanonicalLocation });
  assert.equal(stale.proof.status, "pending");
});

test("Reddit redirect to different user fails", async () => {
  const { proof } = await verifyReddit(redditLegacyLocation, html(redditMarker), {
    finalUrl: "https://www.reddit.com/user/other_user/",
    redirected: true
  });
  assert.equal(proof.status, "pending");
  assert.equal(proof.failureReason, "social-location-redirect-mismatch");
});

test("Reddit redirect off Reddit fails", async () => {
  const { proof } = await verifyReddit(redditLegacyLocation, html(redditMarker), {
    finalUrl: "https://example.com/user/lopsided_horror_9957/",
    redirected: true
  });
  assert.equal(proof.status, "pending");
  assert.equal(proof.failureReason, "social-location-redirect-mismatch");
});

test("malformed old.reddit.com URL fails", async () => {
  await assert.rejects(
    () => verifyReddit("https://old.reddit.com/r/lopsided_horror_9957/", html(redditMarker), { finalUrl: "https://old.reddit.com/r/lopsided_horror_9957/" }),
    /INVALID_SOCIAL_LOCATION/
  );
});

test("Reddit profile content with marker can verify despite Reddit about 404", async () => {
  const { proof } = await verifyReddit(redditLegacyLocation, html(redditMarkerSplit), {
    status: 404,
    finalUrl: "https://www.reddit.com/user/lopsided_horror_9957/about/",
    redirected: true
  });
  assert.equal(proof.status, "verified");
});

test("legacy GitHub full and contentbox markers still verify", async () => {
  const githubAccount = "beatifyaudio";
  for (const marker of [
    `certifyd-proof provider=github account=${githubAccount} nonce=${nonce}`,
    `contentbox-social-verify provider=github account=${githubAccount} nonce=${nonce}`
  ]) {
    const prisma = new ProofPrismaStub(proofRow("github", githubAccount, marker));
    const proof = await withFetch({ body: html(marker), finalUrl: `https://github.com/${githubAccount}` }, () =>
      verifySocialProof(prisma as any, "user-1", "github", githubAccount, `https://github.com/${githubAccount}`)
    );
    assert.equal(proof.status, "verified", marker);
  }
});

test("legacy Spotify marker still verifies", async () => {
  const spotifyAccount = "1pKR6nU0QhMlbouug8OPtD";
  const marker = `Certifyd proof: ${nonce}`;
  const spotifyHtml = html(`{"biography":{"text":"${marker}"}}`);
  const prisma = new ProofPrismaStub(proofRow("spotify", spotifyAccount, marker));
  const proof = await withFetch({ body: spotifyHtml, finalUrl: `https://open.spotify.com/artist/${spotifyAccount}` }, () =>
    verifySocialProof(prisma as any, "user-1", "spotify", spotifyAccount, `https://open.spotify.com/artist/${spotifyAccount}`)
  );
  assert.equal(proof.status, "verified");
});
