import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import type { PrismaClient } from "@prisma/client";
import { nip19, verifyEvent } from "nostr-tools";
import {
  PROOF_METHOD_DNS_TXT,
  PROOF_METHOD_NOSTR_SIGNATURE,
  PROOF_METHOD_URL_TEXT,
  PROOF_STATUS_FAILED,
  PROOF_STATUS_PENDING,
  PROOF_STATUS_REVOKED,
  PROOF_STATUS_VERIFIED,
  PROOF_TYPE_DOMAIN,
  PROOF_TYPE_NOSTR,
  PROOF_TYPE_SOCIAL,
  type ProofRecordDto
} from "./proof.types.js";

function proofModel(prisma: PrismaClient): any {
  const model = (prisma as any).proofRecord;
  if (!model) {
    throw new Error("PROOF_MODEL_MISSING");
  }
  return model;
}

function normalizeDomain(input: string): string {
  let src = String(input || "").trim().toLowerCase();
  if (!src) return "";
  src = src.replace(/^https?:\/\//, "").split("/")[0] || "";
  src = src.replace(/\.$/, "");
  return src;
}

function isValidDomain(domain: string): boolean {
  if (!domain) return false;
  if (domain.length > 253) return false;
  // Basic host validation, including subdomains.
  return /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(domain);
}

function normalizeSocialProvider(input: string): "github" | "x" | "youtube" | "instagram" | "tiktok" | "" {
  const src = String(input || "").trim().toLowerCase();
  if (src === "github") return "github";
  if (src === "x" || src === "twitter") return "x";
  if (src === "youtube" || src === "yt") return "youtube";
  if (src === "instagram" || src === "ig") return "instagram";
  if (src === "tiktok" || src === "tt") return "tiktok";
  return "";
}

function normalizeSocialUsername(input: string): string {
  return String(input || "").trim().replace(/^@+/, "").toLowerCase();
}

function normalizeNostrPubkey(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(lower)) return lower;
  if (lower.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(lower);
      if (decoded.type !== "npub") return "";
      const data = String(decoded.data || "").toLowerCase();
      if (/^[0-9a-f]{64}$/.test(data)) return data;
      return "";
    } catch {
      return "";
    }
  }
  return "";
}

function nostrSubject(pubkeyHex: string): string {
  return `nostr:${pubkeyHex}`;
}

function buildNostrChallengeText(witnessFingerprint: string, nonce: string): string {
  return [
    "ContentBox Nostr Verification",
    "",
    `Witness Fingerprint: ${witnessFingerprint}`,
    `Challenge: ${nonce}`,
    "",
    "Sign this message to verify ownership."
  ].join("\n");
}

function isValidSocialUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/i.test(username);
}

function socialSubject(provider: string, account: string): string {
  return `${provider}:${account}`;
}

function buildSocialChallengeMessage(provider: "github" | "x" | "youtube" | "instagram" | "tiktok", account: string, nonce: string): string {
  return `contentbox-social-verify provider=${provider} account=${account} nonce=${nonce}`;
}

function parseSocialClaim(claim: unknown): {
  provider: "github" | "x" | "youtube" | "instagram" | "tiktok";
  account: string;
  channelUrl: string | null;
  profileUrl: string | null;
  challengeText: string;
} | null {
  if (!claim || typeof claim !== "object") return null;
  const c = claim as Record<string, unknown>;
  const provider = normalizeSocialProvider(String(c.provider || ""));
  const account = String(c.account || c.username || c.channelIdentifier || "").trim();
  const channelUrl = String(c.channelUrl || "").trim() || null;
  const profileUrl = String(c.profileUrl || "").trim() || null;
  const challengeText = String(c.challengeText || "").trim();
  if (!provider || !account || !challengeText) return null;
  return { provider, account, channelUrl, profileUrl, challengeText };
}

function normalizeYouTubeChannelUrl(input: string): { canonicalUrl: string; identifier: string } | null {
  const url = normalizeHttpsUrl(input);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "www.youtube.com" && host !== "youtube.com") return null;
  const pathname = String(url.pathname || "").replace(/\/+$/, "");
  if (!pathname || pathname === "/") return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 1) return null;
  if (parts[0]?.startsWith("@")) {
    const handle = parts[0].slice(1).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/i.test(handle)) return null;
    return { canonicalUrl: `https://www.youtube.com/@${handle}`, identifier: `@${handle}` };
  }
  if (parts[0] === "channel" && parts[1]) {
    const channelId = parts[1].trim();
    if (!/^UC[a-zA-Z0-9_-]{10,}$/.test(channelId)) return null;
    return { canonicalUrl: `https://www.youtube.com/channel/${channelId}`, identifier: channelId };
  }
  return null;
}

function normalizeInstagramProfileUrl(input: string): { canonicalUrl: string; identifier: string } | null {
  const url = normalizeHttpsUrl(input);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "www.instagram.com" && host !== "instagram.com") return null;
  const pathname = String(url.pathname || "").replace(/\/+$/, "");
  if (!pathname || pathname === "/") return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  const handle = parts[0].trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return null;
  return { canonicalUrl: `https://www.instagram.com/${handle}/`, identifier: handle };
}

function normalizeTiktokProfileUrl(input: string): { canonicalUrl: string; identifier: string } | null {
  const url = normalizeHttpsUrl(input);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "www.tiktok.com" && host !== "tiktok.com") return null;
  const pathname = String(url.pathname || "").replace(/\/+$/, "");
  if (!pathname || pathname === "/") return null;
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  if (!parts[0].startsWith("@")) return null;
  const handle = parts[0].slice(1).trim().toLowerCase();
  if (!/^[a-z0-9._]{2,24}$/i.test(handle)) return null;
  return { canonicalUrl: `https://www.tiktok.com/@${handle}`, identifier: `@${handle}` };
}

function parseNostrClaim(claim: unknown): { pubkey: string; challenge: string; challengeText: string } | null {
  if (!claim || typeof claim !== "object") return null;
  const c = claim as Record<string, unknown>;
  const pubkey = normalizeNostrPubkey(String(c.pubkey || ""));
  const challenge = String(c.challenge || "").trim();
  const challengeText = String(c.challengeText || "").trim();
  if (!pubkey || !challenge || !challengeText) return null;
  return { pubkey, challenge, challengeText };
}

function normalizeHttpsUrl(input: string): URL | null {
  try {
    const u = new URL(String(input || "").trim());
    if (u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

type FetchUrlResult = {
  ok: boolean;
  status: number;
  text: string;
  redirected: boolean;
  finalUrl: string;
  contentType: string;
};

const SOCIAL_VERIFY_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

async function fetchUrlText(url: string): Promise<FetchUrlResult> {
  const timeoutMs = 5000;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctl.signal,
      headers: {
        "user-agent": SOCIAL_VERIFY_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache"
      }
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
      redirected: Boolean(res.redirected),
      finalUrl: String(res.url || url),
      contentType: String(res.headers.get("content-type") || "").toLowerCase()
    };
  } finally {
    clearTimeout(t);
  }
}

function classifySocialFetchIssue(
  provider: "github" | "youtube" | "instagram" | "tiktok",
  fetched: FetchUrlResult
): string | null {
  const finalUrl = String(fetched.finalUrl || "").toLowerCase();
  const text = String(fetched.text || "").toLowerCase();
  const looksHtml = fetched.contentType.includes("text/html") || fetched.contentType.includes("application/xhtml+xml") || !fetched.contentType;
  const likelyLoginPath =
    finalUrl.includes("/login") ||
    finalUrl.includes("/accounts/login") ||
    finalUrl.includes("/signup") ||
    finalUrl.includes("accounts.google.com") ||
    finalUrl.includes("consent.youtube.com");

  const loginWallMarkers = [
    "log in",
    "sign up",
    "create account",
    "continue with google",
    "continue with facebook",
    "use the app",
    "verify you are human",
    "captcha"
  ];
  const hasLoginWallMarker = loginWallMarkers.some((m) => text.includes(m));

  if (fetched.redirected && likelyLoginPath) {
    return `Redirected to login/signup wall (${fetched.finalUrl}). This provider may require an unauthenticated public page view.`;
  }
  if (looksHtml && likelyLoginPath) {
    return `Fetched a login/signup page instead of the public profile (${fetched.finalUrl}).`;
  }

  if (provider === "instagram" || provider === "tiktok" || provider === "youtube") {
    if (looksHtml && hasLoginWallMarker) {
      return `Fetched gated/interstitial HTML (${fetched.finalUrl}) instead of a fully public profile page.`;
    }
  }

  if (!looksHtml) {
    return `Fetched non-HTML response (${fetched.contentType || "unknown content type"}) from ${fetched.finalUrl}.`;
  }
  return null;
}

function toDto(row: {
  id: string;
  proofType: string;
  subject: string;
  claimJson: unknown;
  signature: string | null;
  status: string;
  verificationMethod: string;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
  verifiedAt: Date | null;
  revokedAt: Date | null;
  failureReason: string | null;
}): ProofRecordDto {
  return {
    id: row.id,
    proofType: row.proofType,
    subject: row.subject,
    claimJson: (row.claimJson as Record<string, unknown>) || {},
    signature: row.signature,
    status: row.status,
    verificationMethod: row.verificationMethod,
    location: row.location,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    failureReason: row.failureReason
  };
}

async function readActiveWitnessIdentity(prisma: PrismaClient, userId: string) {
  return prisma.witnessIdentity.findUnique({
    where: { userId },
    select: { id: true, revokedAt: true, fingerprint: true }
  });
}

function parseClaimDnsTxt(claim: unknown): { txtName: string; txtValue: string } | null {
  if (!claim || typeof claim !== "object") return null;
  const c = claim as Record<string, unknown>;
  const txtName = String(c.txtName || "").trim();
  const txtValue = String(c.txtValue || "").trim();
  if (!txtName || !txtValue) return null;
  return { txtName, txtValue };
}

async function resolveTxtValues(name: string): Promise<string[]> {
  const timeoutMs = 3000;
  const timeoutPromise = new Promise<string[]>((_, reject) => {
    const t = setTimeout(() => {
      clearTimeout(t);
      reject(new Error("DNS_TIMEOUT"));
    }, timeoutMs);
  });
  const lookupPromise = resolveTxt(name).then((records) =>
    records
      .map((chunks) => chunks.join("").trim())
      .filter((v) => v.length > 0)
  );
  return Promise.race([lookupPromise, timeoutPromise]);
}

export async function listProofRecords(prisma: PrismaClient, userId: string): Promise<ProofRecordDto[]> {
  const rows = await proofModel(prisma).findMany({
    where: { userId, revokedAt: null },
    orderBy: [{ verifiedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });
  return rows.map(toDto);
}

export async function createDomainChallenge(prisma: PrismaClient, userId: string, inputDomain: string): Promise<ProofRecordDto> {
  const domain = normalizeDomain(inputDomain);
  if (!domain || !isValidDomain(domain)) throw new Error("INVALID_DOMAIN");

  const witness = await readActiveWitnessIdentity(prisma, userId);
  if (!witness || witness.revokedAt) throw new Error("WITNESS_IDENTITY_REQUIRED");

  const nonce = randomBytes(16).toString("hex");
  const txtName = `_contentbox-verify.${domain}`;
  const txtValue = `contentbox-domain=${nonce}`;
  const claimJson = {
    domain,
    txtName,
    txtValue,
    witnessFingerprint: witness.fingerprint
  };

  const row = await proofModel(prisma).upsert({
    where: {
      userId_proofType_subject: {
        userId,
        proofType: PROOF_TYPE_DOMAIN,
        subject: domain
      }
    },
    create: {
      userId,
      witnessIdentityId: witness.id,
      proofType: PROOF_TYPE_DOMAIN,
      subject: domain,
      claimJson,
      status: PROOF_STATUS_PENDING,
      verificationMethod: PROOF_METHOD_DNS_TXT,
      location: txtName,
      failureReason: null,
      verifiedAt: null,
      revokedAt: null
    },
    update: {
      witnessIdentityId: witness.id,
      claimJson,
      status: PROOF_STATUS_PENDING,
      verificationMethod: PROOF_METHOD_DNS_TXT,
      location: txtName,
      failureReason: null,
      verifiedAt: null,
      revokedAt: null
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });

  return toDto(row);
}

export async function verifyDomainProof(prisma: PrismaClient, userId: string, inputDomain: string): Promise<ProofRecordDto> {
  const domain = normalizeDomain(inputDomain);
  if (!domain || !isValidDomain(domain)) throw new Error("INVALID_DOMAIN");

  const existing = await proofModel(prisma).findUnique({
    where: {
      userId_proofType_subject: {
        userId,
        proofType: PROOF_TYPE_DOMAIN,
        subject: domain
      }
    },
    select: {
      id: true,
      claimJson: true
    }
  });
  if (!existing) throw new Error("PROOF_CHALLENGE_NOT_FOUND");

  const claim = parseClaimDnsTxt(existing.claimJson);
  if (!claim) throw new Error("PROOF_CHALLENGE_INVALID");

  let verified = false;
  let failureReason: string | null = null;
  try {
    const values = await resolveTxtValues(claim.txtName);
    verified = values.some((v) => v === claim.txtValue);
    if (!verified) {
      failureReason = `TXT record missing expected value at ${claim.txtName}`;
    }
  } catch (e: any) {
    failureReason = `DNS lookup failed: ${String(e?.message || e)}`;
  }

  const row = await proofModel(prisma).update({
    where: { id: existing.id },
    data: {
      status: verified ? PROOF_STATUS_VERIFIED : PROOF_STATUS_FAILED,
      verifiedAt: verified ? new Date() : null,
      failureReason: verified ? null : failureReason,
      revokedAt: null
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });
  return toDto(row);
}

export async function createSocialChallenge(
  prisma: PrismaClient,
  userId: string,
  inputProvider: string,
  inputUsername: string
): Promise<ProofRecordDto> {
  const provider = normalizeSocialProvider(inputProvider);
  if (!provider) throw new Error("INVALID_SOCIAL_PROVIDER");
  if (provider !== "github" && provider !== "youtube" && provider !== "instagram" && provider !== "tiktok") throw new Error("SOCIAL_PROVIDER_NOT_SUPPORTED");

  const witness = await readActiveWitnessIdentity(prisma, userId);
  if (!witness || witness.revokedAt) throw new Error("WITNESS_IDENTITY_REQUIRED");

  let account = "";
  let postingHint = "";
  let channelUrl: string | null = null;
  let profileUrl: string | null = null;
  if (provider === "github") {
    const username = normalizeSocialUsername(inputUsername);
    if (!username || !isValidSocialUsername(username)) throw new Error("INVALID_SOCIAL_USERNAME");
    account = username;
    postingHint = "Publish this exact text in a public GitHub Gist, then paste the Gist URL below.";
  } else if (provider === "youtube") {
    const normalized = normalizeYouTubeChannelUrl(inputUsername);
    if (!normalized) throw new Error("INVALID_YOUTUBE_CHANNEL_URL");
    account = normalized.identifier;
    channelUrl = normalized.canonicalUrl;
    postingHint = "Add this exact text to your public YouTube channel description (About), then verify using your public channel URL.";
  } else {
    if (provider === "instagram") {
      const normalized = normalizeInstagramProfileUrl(inputUsername);
      if (!normalized) throw new Error("INVALID_INSTAGRAM_PROFILE_URL");
      account = normalized.identifier;
      profileUrl = normalized.canonicalUrl;
      postingHint = "Add this exact text to your public Instagram bio, then verify using your public profile URL.";
    } else {
      const normalized = normalizeTiktokProfileUrl(inputUsername);
      if (!normalized) throw new Error("INVALID_TIKTOK_PROFILE_URL");
      account = normalized.identifier;
      profileUrl = normalized.canonicalUrl;
      postingHint = "Add this exact text to your public TikTok bio, then verify using your public profile URL.";
    }
  }

  const nonce = randomBytes(16).toString("hex");
  const challengeText = buildSocialChallengeMessage(provider, account, nonce);
  const claimJson = {
    provider,
    account,
    username: provider === "github" ? account : undefined,
    channelIdentifier: provider === "youtube" ? account : undefined,
    channelUrl,
    profileUrl,
    challengeText,
    postingHint,
    witnessFingerprint: witness.fingerprint
  };
  const subject = socialSubject(provider, account);

  const row = await proofModel(prisma).upsert({
    where: {
      userId_proofType_subject: {
        userId,
        proofType: PROOF_TYPE_SOCIAL,
        subject
      }
    },
    create: {
      userId,
      witnessIdentityId: witness.id,
      proofType: PROOF_TYPE_SOCIAL,
      subject,
      claimJson,
      status: PROOF_STATUS_PENDING,
      verificationMethod: PROOF_METHOD_URL_TEXT,
      location: null,
      failureReason: null,
      verifiedAt: null,
      revokedAt: null
    },
    update: {
      witnessIdentityId: witness.id,
      claimJson,
      status: PROOF_STATUS_PENDING,
      verificationMethod: PROOF_METHOD_URL_TEXT,
      location: null,
      failureReason: null,
      verifiedAt: null,
      revokedAt: null
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });

  return toDto(row);
}

export async function verifySocialProof(
  prisma: PrismaClient,
  userId: string,
  inputProvider: string,
  inputUsername: string,
  inputLocation: string
): Promise<ProofRecordDto> {
  const provider = normalizeSocialProvider(inputProvider);
  if (!provider) throw new Error("INVALID_SOCIAL_PROVIDER");
  if (provider !== "github" && provider !== "youtube" && provider !== "instagram" && provider !== "tiktok") throw new Error("SOCIAL_PROVIDER_NOT_SUPPORTED");

  let account = "";
  let locationUrl: URL | null = null;
  if (provider === "github") {
    const username = normalizeSocialUsername(inputUsername);
    if (!username || !isValidSocialUsername(username)) throw new Error("INVALID_SOCIAL_USERNAME");
    account = username;
    locationUrl = normalizeHttpsUrl(inputLocation);
    if (!locationUrl) throw new Error("INVALID_SOCIAL_LOCATION");
    const host = String(locationUrl.hostname || "").toLowerCase();
    if (host !== "gist.github.com" && host !== "github.com") {
      throw new Error("INVALID_SOCIAL_LOCATION");
    }
    const pathLower = String(locationUrl.pathname || "").toLowerCase();
    const pathPrefix = `/${username.toLowerCase()}`;
    if (!(pathLower === pathPrefix || pathLower.startsWith(`${pathPrefix}/`))) {
      throw new Error("SOCIAL_LOCATION_MISMATCH");
    }
  } else {
    if (provider === "youtube") {
      const normalized = normalizeYouTubeChannelUrl(inputUsername);
      if (!normalized) throw new Error("INVALID_YOUTUBE_CHANNEL_URL");
      account = normalized.identifier;
      locationUrl = normalizeHttpsUrl(inputLocation) || normalizeHttpsUrl(normalized.canonicalUrl);
      if (!locationUrl) throw new Error("INVALID_SOCIAL_LOCATION");
      const verifyTarget = normalizeYouTubeChannelUrl(locationUrl.toString());
      if (!verifyTarget) throw new Error("INVALID_YOUTUBE_CHANNEL_URL");
      if (verifyTarget.identifier.toLowerCase() !== account.toLowerCase()) {
        throw new Error("SOCIAL_LOCATION_MISMATCH");
      }
      locationUrl = new URL(verifyTarget.canonicalUrl);
    } else {
      if (provider === "instagram") {
        const normalized = normalizeInstagramProfileUrl(inputUsername);
        if (!normalized) throw new Error("INVALID_INSTAGRAM_PROFILE_URL");
        account = normalized.identifier;
        locationUrl = normalizeHttpsUrl(inputLocation) || normalizeHttpsUrl(normalized.canonicalUrl);
        if (!locationUrl) throw new Error("INVALID_SOCIAL_LOCATION");
        const verifyTarget = normalizeInstagramProfileUrl(locationUrl.toString());
        if (!verifyTarget) throw new Error("INVALID_INSTAGRAM_PROFILE_URL");
        if (verifyTarget.identifier.toLowerCase() !== account.toLowerCase()) {
          throw new Error("SOCIAL_LOCATION_MISMATCH");
        }
        locationUrl = new URL(verifyTarget.canonicalUrl);
      } else {
        const normalized = normalizeTiktokProfileUrl(inputUsername);
        if (!normalized) throw new Error("INVALID_TIKTOK_PROFILE_URL");
        account = normalized.identifier;
        locationUrl = normalizeHttpsUrl(inputLocation) || normalizeHttpsUrl(normalized.canonicalUrl);
        if (!locationUrl) throw new Error("INVALID_SOCIAL_LOCATION");
        const verifyTarget = normalizeTiktokProfileUrl(locationUrl.toString());
        if (!verifyTarget) throw new Error("INVALID_TIKTOK_PROFILE_URL");
        if (verifyTarget.identifier.toLowerCase() !== account.toLowerCase()) {
          throw new Error("SOCIAL_LOCATION_MISMATCH");
        }
        locationUrl = new URL(verifyTarget.canonicalUrl);
      }
    }
  }

  const subject = socialSubject(provider, account);
  const existing = await proofModel(prisma).findUnique({
    where: {
      userId_proofType_subject: {
        userId,
        proofType: PROOF_TYPE_SOCIAL,
        subject
      }
    },
    select: {
      id: true,
      claimJson: true
    }
  });
  if (!existing) throw new Error("PROOF_CHALLENGE_NOT_FOUND");

  const claim = parseSocialClaim(existing.claimJson);
  if (!claim) throw new Error("PROOF_CHALLENGE_INVALID");
  if (claim.provider !== provider) throw new Error("PROOF_CHALLENGE_INVALID");
  if (String(claim.account || "").trim().toLowerCase() !== account.toLowerCase()) throw new Error("PROOF_CHALLENGE_INVALID");

  let verified = false;
  let failureReason: string | null = null;
  try {
    const fetched = await fetchUrlText(locationUrl.toString());
    if (!fetched.ok) {
      failureReason = `URL fetch failed with HTTP ${fetched.status} (final URL: ${fetched.finalUrl})`;
    } else {
      const fetchIssue = classifySocialFetchIssue(provider, fetched);
      if (fetchIssue) {
        failureReason = fetchIssue;
      } else if (!fetched.text.includes(claim.challengeText)) {
        const redirectHint = fetched.redirected ? ` Final URL: ${fetched.finalUrl}.` : "";
        failureReason =
          provider === "youtube"
            ? `Challenge text was not found on the channel page. Ensure it is visible in your public channel description/about.${redirectHint}`
            : provider === "instagram"
              ? `Challenge text was not found on the profile page. Ensure it is visible in your public Instagram bio.${redirectHint}`
              : provider === "tiktok"
                ? `Challenge text was not found on the profile page. Ensure it is visible in your public TikTok bio.${redirectHint}`
                : `Challenge text was not found at the provided URL.${redirectHint}`;
      } else {
        verified = true;
      }
    }
  } catch (e: any) {
    const raw = String(e?.message || e);
    if (raw.toUpperCase().includes("ABORT")) {
      failureReason = "URL fetch timed out before the provider returned a public page.";
    } else {
      failureReason = `URL fetch failed: ${raw}`;
    }
  }

  const row = await proofModel(prisma).update({
    where: { id: existing.id },
    data: {
      status: verified ? PROOF_STATUS_VERIFIED : PROOF_STATUS_FAILED,
      verifiedAt: verified ? new Date() : null,
      failureReason: verified ? null : failureReason,
      location: locationUrl.toString(),
      revokedAt: null
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });
  return toDto(row);
}

export async function createNostrChallenge(
  prisma: PrismaClient,
  userId: string,
  inputPubkey: string
): Promise<ProofRecordDto> {
  const pubkeyHex = normalizeNostrPubkey(inputPubkey);
  if (!pubkeyHex) throw new Error("INVALID_NOSTR_PUBKEY");

  const witness = await readActiveWitnessIdentity(prisma, userId);
  if (!witness || witness.revokedAt) throw new Error("WITNESS_IDENTITY_REQUIRED");

  const nonce = randomBytes(16).toString("hex");
  const challengeText = buildNostrChallengeText(witness.fingerprint, nonce);
  const claimJson = {
    pubkey: pubkeyHex,
    challenge: nonce,
    challengeText,
    witnessFingerprint: witness.fingerprint
  };
  const subject = nostrSubject(pubkeyHex);

  const row = await proofModel(prisma).upsert({
    where: {
      userId_proofType_subject: {
        userId,
        proofType: PROOF_TYPE_NOSTR,
        subject
      }
    },
    create: {
      userId,
      witnessIdentityId: witness.id,
      proofType: PROOF_TYPE_NOSTR,
      subject,
      claimJson,
      status: PROOF_STATUS_PENDING,
      verificationMethod: PROOF_METHOD_NOSTR_SIGNATURE,
      location: null,
      failureReason: null,
      verifiedAt: null,
      revokedAt: null
    },
    update: {
      witnessIdentityId: witness.id,
      claimJson,
      status: PROOF_STATUS_PENDING,
      verificationMethod: PROOF_METHOD_NOSTR_SIGNATURE,
      location: null,
      failureReason: null,
      verifiedAt: null,
      revokedAt: null
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });

  return toDto(row);
}

export async function verifyNostrProof(
  prisma: PrismaClient,
  userId: string,
  inputPubkey: string,
  signedEventInput: unknown
): Promise<ProofRecordDto> {
  const pubkeyHex = normalizeNostrPubkey(inputPubkey);
  if (!pubkeyHex) throw new Error("INVALID_NOSTR_PUBKEY");
  if (!signedEventInput || typeof signedEventInput !== "object") throw new Error("INVALID_NOSTR_EVENT");

  const subject = nostrSubject(pubkeyHex);
  const existing = await proofModel(prisma).findUnique({
    where: {
      userId_proofType_subject: {
        userId,
        proofType: PROOF_TYPE_NOSTR,
        subject
      }
    },
    select: {
      id: true,
      claimJson: true
    }
  });
  if (!existing) throw new Error("PROOF_CHALLENGE_NOT_FOUND");

  const claim = parseNostrClaim(existing.claimJson);
  if (!claim) throw new Error("PROOF_CHALLENGE_INVALID");

  const event = signedEventInput as Record<string, unknown>;
  const eventPubkey = normalizeNostrPubkey(String(event.pubkey || ""));
  const eventContent = String(event.content || "");
  const eventSig = String(event.sig || "");
  const eventId = String(event.id || "");

  let verified = false;
  let failureReason: string | null = null;
  try {
    if (eventPubkey !== pubkeyHex) {
      failureReason = "Signed event pubkey does not match provided Nostr pubkey";
    } else if (!eventContent.includes(claim.challengeText) && !eventContent.includes(claim.challenge)) {
      failureReason = "Signed event content does not include the expected challenge";
    } else if (!verifyEvent(event as any)) {
      failureReason = "Nostr event signature verification failed";
    } else {
      verified = true;
    }
  } catch (e: any) {
    failureReason = `Nostr verification failed: ${String(e?.message || e)}`;
  }

  const row = await proofModel(prisma).update({
    where: { id: existing.id },
    data: {
      status: verified ? PROOF_STATUS_VERIFIED : PROOF_STATUS_FAILED,
      verifiedAt: verified ? new Date() : null,
      failureReason: verified ? null : failureReason,
      location: eventId ? `nostr:event:${eventId}` : null,
      signature: eventSig || null,
      claimJson: {
        ...(existing.claimJson as Record<string, unknown>),
        signature: eventSig || null,
        eventId: eventId || null
      },
      revokedAt: null
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });
  return toDto(row);
}

async function getUserProofRecord(prisma: PrismaClient, userId: string, proofId: string) {
  return proofModel(prisma).findFirst({
    where: { id: proofId, userId },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });
}

export async function cancelProofRecord(prisma: PrismaClient, userId: string, proofId: string): Promise<ProofRecordDto> {
  const existing = await getUserProofRecord(prisma, userId, proofId);
  if (!existing) throw new Error("PROOF_NOT_FOUND");
  const status = String(existing.status || "").trim().toLowerCase();
  if (status !== PROOF_STATUS_PENDING) throw new Error("INVALID_TRANSITION");
  const row = await proofModel(prisma).update({
    where: { id: proofId },
    data: {
      status: PROOF_STATUS_REVOKED,
      revokedAt: new Date(),
      failureReason: existing.failureReason || "Cancelled by user"
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });
  return toDto(row);
}

export async function revokeProofRecord(prisma: PrismaClient, userId: string, proofId: string): Promise<ProofRecordDto> {
  const existing = await getUserProofRecord(prisma, userId, proofId);
  if (!existing) throw new Error("PROOF_NOT_FOUND");
  const status = String(existing.status || "").trim().toLowerCase();
  if (status !== PROOF_STATUS_VERIFIED) throw new Error("INVALID_TRANSITION");
  const row = await proofModel(prisma).update({
    where: { id: proofId },
    data: {
      status: PROOF_STATUS_REVOKED,
      revokedAt: new Date()
    },
    select: {
      id: true,
      proofType: true,
      subject: true,
      claimJson: true,
      signature: true,
      status: true,
      verificationMethod: true,
      location: true,
      createdAt: true,
      updatedAt: true,
      verifiedAt: true,
      revokedAt: true,
      failureReason: true
    }
  });
  return toDto(row);
}

export async function deleteProofRecord(prisma: PrismaClient, userId: string, proofId: string): Promise<void> {
  const existing = await getUserProofRecord(prisma, userId, proofId);
  if (!existing) throw new Error("PROOF_NOT_FOUND");
  const status = String(existing.status || "").trim().toLowerCase();
  if (status !== PROOF_STATUS_PENDING && status !== PROOF_STATUS_FAILED) {
    throw new Error("INVALID_TRANSITION");
  }
  await proofModel(prisma).delete({ where: { id: proofId } });
}
