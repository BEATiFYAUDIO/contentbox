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

type SocialProvider = "github" | "x" | "youtube" | "instagram" | "tiktok" | "rumble" | "reddit" | "substack";

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

function normalizeSocialProvider(input: string): SocialProvider | "" {
  const src = String(input || "").trim().toLowerCase();
  if (src === "github") return "github";
  if (src === "x" || src === "twitter") return "x";
  if (src === "youtube" || src === "yt") return "youtube";
  if (src === "instagram" || src === "ig") return "instagram";
  if (src === "tiktok" || src === "tt") return "tiktok";
  if (src === "rumble") return "rumble";
  if (src === "reddit") return "reddit";
  if (src === "substack") return "substack";
  return "";
}

function normalizeSocialUsername(input: string): string {
  return String(input || "").trim().replace(/^@+/, "").toLowerCase();
}

function normalizeSocialAccount(provider: SocialProvider, input: string): string {
  const src = String(input || "").trim();
  if (!src) return "";

  if (provider === "github") {
    const fromUrl = normalizeGithubAccountFromUrl(src);
    if (fromUrl) return fromUrl;
    return normalizeSocialUsername(src);
  }

  if (provider === "x") {
    const fromUrl = normalizeXAccountFromUrl(src);
    if (fromUrl) return fromUrl;
    return normalizeSocialUsername(src);
  }

  if (provider === "youtube") {
    const normalized = normalizeYouTubeChannelUrl(src);
    if (normalized) return normalized.account;
    if (/^UC[a-zA-Z0-9_-]{10,}$/.test(src)) return src;
    return normalizeSocialUsername(src);
  }

  if (provider === "instagram") {
    const normalized = normalizeInstagramProfileUrl(src);
    if (normalized) return normalized.account;
    return normalizeSocialUsername(src);
  }

  if (provider === "rumble") {
    const normalized = normalizeRumbleProfileUrl(src);
    if (normalized) return normalized.account;
    return normalizeSocialUsername(src);
  }

  if (provider === "reddit") {
    const normalized = normalizeRedditProfileUrl(src);
    if (normalized) return normalized.account;
    const fromSlash = src.match(/^u\/([a-z0-9_-]{3,20})$/i);
    if (fromSlash?.[1]) return normalizeSocialUsername(fromSlash[1]);
    return normalizeSocialUsername(src);
  }

  if (provider === "substack") {
    const normalized = normalizeSubstackProfileUrl(src);
    if (normalized) return normalized.account;
    return normalizeSocialUsername(src);
  }

  const normalized = normalizeTiktokProfileUrl(src);
  if (normalized) return normalized.account;
  return normalizeSocialUsername(src);
}

function normalizeStoredSocialAccount(provider: SocialProvider, account: string): string {
  if (provider === "youtube" && /^UC[a-zA-Z0-9_-]{10,}$/.test(account)) return account;
  return normalizeSocialUsername(account);
}

function socialSubjectCandidates(provider: SocialProvider, account: string): string[] {
  const normalized = normalizeStoredSocialAccount(provider, account);
  if (!normalized) return [];
  const base = socialSubject(provider, normalized);

  // Backward-compatible legacy variants for older stored subjects.
  if (provider === "youtube" || provider === "tiktok") {
    if (normalized.startsWith("@") || /^UC[a-zA-Z0-9_-]{10,}$/.test(normalized)) {
      return [base];
    }
    return [base, socialSubject(provider, `@${normalized}`)];
  }
  return [base];
}

function socialDebugEnabled(): boolean {
  return String(process.env.WITNESS_SOCIAL_VERIFY_DEBUG || "").trim() === "1";
}

function logSocialVerificationDebug(event: string, data: Record<string, unknown>) {
  if (!socialDebugEnabled()) return;
  try {
    console.info(`[social-verify] ${event}`, data);
  } catch {}
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

function isValidXUsername(username: string): boolean {
  return /^[a-z0-9_]{1,15}$/i.test(username);
}

function socialSubject(provider: string, account: string): string {
  return `${provider}:${account}`;
}

const SOCIAL_PROOF_PREFIX_CERTIFYD = "certifyd-proof";
const SOCIAL_PROOF_PREFIX_LEGACY = "contentbox-social-verify";
const SOCIAL_PROOF_PATTERN = /^(certifyd-proof|contentbox-social-verify)\s+provider=([^\s]+)\s+account=([^\s]+)\s+nonce=([^\s]+)$/i;

function buildSocialChallengeMessage(provider: SocialProvider, account: string, nonce: string): string {
  return `${SOCIAL_PROOF_PREFIX_CERTIFYD} provider=${provider} account=${account} nonce=${nonce}`;
}

function socialChallengeCandidates(challengeText: string): string[] {
  const normalized = String(challengeText || "").trim();
  if (!normalized) return [];

  const match = normalized.match(SOCIAL_PROOF_PATTERN);
  if (!match) return [normalized];

  const provider = String(match[2] || "").trim();
  const account = String(match[3] || "").trim();
  const nonce = String(match[4] || "").trim();
  if (!provider || !account || !nonce) return [normalized];

  return [
    `${SOCIAL_PROOF_PREFIX_CERTIFYD} provider=${provider} account=${account} nonce=${nonce}`,
    `${SOCIAL_PROOF_PREFIX_LEGACY} provider=${provider} account=${account} nonce=${nonce}`
  ];
}

function parseSocialClaim(claim: unknown): {
  provider: SocialProvider;
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

function normalizeGithubAccountFromUrl(input: string): string | null {
  const url = normalizeHttpsUrl(input);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "github.com" && host !== "www.github.com" && host !== "gist.github.com") return null;
  const pathname = String(url.pathname || "").replace(/\/+$/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const account = normalizeSocialUsername(parts[0]);
  if (!account || !isValidSocialUsername(account)) return null;
  return account;
}

function normalizeXAccountFromUrl(input: string): string | null {
  const url = normalizeHttpsUrl(input);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "x.com" && host !== "www.x.com" && host !== "twitter.com" && host !== "www.twitter.com") return null;
  const pathname = String(url.pathname || "").replace(/\/+$/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const account = normalizeSocialUsername(parts[0]);
  if (!account || !isValidSocialUsername(account)) return null;
  return account;
}

function normalizeYouTubeChannelUrl(input: string): { canonicalUrl: string; account: string } | null {
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
    return { canonicalUrl: `https://www.youtube.com/@${handle}`, account: handle };
  }
  if (parts[0] === "channel" && parts[1]) {
    const channelId = parts[1].trim();
    if (!/^UC[a-zA-Z0-9_-]{10,}$/.test(channelId)) return null;
    return { canonicalUrl: `https://www.youtube.com/channel/${channelId}`, account: channelId };
  }
  return null;
}

function normalizeInstagramProfileUrl(input: string): { canonicalUrl: string; account: string } | null {
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
  return { canonicalUrl: `https://www.instagram.com/${handle}/`, account: handle };
}

function normalizeTiktokProfileUrl(input: string): { canonicalUrl: string; account: string } | null {
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
  return { canonicalUrl: `https://www.tiktok.com/@${handle}`, account: handle };
}

function normalizeRumbleProfileUrl(input: string): { canonicalUrl: string; account: string } | null {
  const url = normalizeHttpsUrl(input);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "www.rumble.com" && host !== "rumble.com") return null;
  const pathname = String(url.pathname || "").replace(/\/+$/, "");
  if (!pathname || pathname === "/") return null;
  const parts = pathname.split("/").filter(Boolean);
  let handle = "";
  let canonicalPath = "";
  if (parts.length === 1) {
    handle = String(parts[0] || "").trim().toLowerCase();
    canonicalPath = `/${handle}`;
  } else if (parts[0]?.toLowerCase() === "user" && (parts.length === 2 || (parts.length === 3 && parts[2]?.toLowerCase() === "about"))) {
    handle = String(parts[1] || "").trim().toLowerCase();
    canonicalPath = `/user/${handle}`;
  } else if (parts[0]?.toLowerCase() === "c" && parts.length === 2) {
    handle = String(parts[1] || "").trim().toLowerCase();
    canonicalPath = `/c/${handle}`;
  } else {
    return null;
  }
  handle = handle.replace(/^@+/, "");
  if (!/^[a-z0-9._-]{2,64}$/i.test(handle)) return null;
  return { canonicalUrl: `https://rumble.com${canonicalPath}`, account: handle };
}

function normalizeRedditProfileUrl(input: string): { canonicalUrl: string; account: string } | null {
  const trimmed = String(input || "").trim();
  const bare = trimmed.match(/^u\/([a-z0-9_-]{3,20})$/i);
  if (bare?.[1]) {
    const account = normalizeSocialUsername(bare[1]);
    return { canonicalUrl: `https://www.reddit.com/user/${account}`, account };
  }
  const url = normalizeHttpsUrl(trimmed);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  if (host !== "www.reddit.com" && host !== "reddit.com") return null;
  const pathname = String(url.pathname || "").replace(/\/+$/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0]?.toLowerCase() !== "user") return null;
  const account = normalizeSocialUsername(parts[1] || "");
  if (!/^[a-z0-9_-]{3,20}$/i.test(account)) return null;
  return { canonicalUrl: `https://www.reddit.com/user/${account}`, account };
}

function normalizeSubstackProfileUrl(input: string): { canonicalUrl: string; account: string } | null {
  const url = normalizeHttpsUrl(input);
  if (!url) return null;
  const host = String(url.hostname || "").toLowerCase();
  const path = String(url.pathname || "").replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);

  if (host === "substack.com" || host === "www.substack.com") {
    if (parts.length === 1 && parts[0]?.startsWith("@")) {
      const account = normalizeSocialUsername(parts[0].slice(1));
      if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(account)) return null;
      return { canonicalUrl: `https://substack.com/@${account}`, account };
    }
    return null;
  }

  if (host.endsWith(".substack.com")) {
    const publication = host.slice(0, -".substack.com".length).trim().toLowerCase();
    if (!publication || publication === "www") return null;
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(publication)) return null;
    return { canonicalUrl: `https://${publication}.substack.com`, account: publication };
  }
  return null;
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

type SocialEvidence = {
  searchableText: string;
  bodyText: string;
  bioText: string;
  metaDescription: string | null;
  title: string | null;
  bodyLength: number;
  bioLength: number;
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

function decodeMinimalHtmlEntities(input: string): string {
  return String(input || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractMetaContent(html: string, attrs: Array<[string, string]>): string | null {
  const tagRegex = /<meta\s+[^>]*>/gi;
  const tags = html.match(tagRegex) || [];
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    const matchesAttrs = attrs.every(([k, v]) => {
      const needle = `${k.toLowerCase()}="${v.toLowerCase()}"`;
      const singleNeedle = `${k.toLowerCase()}='${v.toLowerCase()}'`;
      return lower.includes(needle) || lower.includes(singleNeedle);
    });
    if (!matchesAttrs) continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i);
    if (contentMatch?.[1]) return decodeMinimalHtmlEntities(contentMatch[1].trim());
  }
  return null;
}

function parseJsonSafe(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decodeJsonStringLiteral(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
}

function collectBiographyStrings(value: unknown, out: Set<string>, depth = 0) {
  if (depth > 16 || out.size > 64) return;
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) collectBiographyStrings(item, out, depth + 1);
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || "").toLowerCase();
    if (key === "biography" && typeof v === "string") {
      const text = decodeMinimalHtmlEntities(v).replace(/\s+/g, " ").trim();
      if (text) out.add(text);
    }
    if (v && typeof v === "object") {
      collectBiographyStrings(v, out, depth + 1);
    }
  }
}

function extractInstagramBioText(html: string): string {
  const src = String(html || "");
  const bios = new Set<string>();

  // 1) Generic application/json script blobs.
  const appJsonRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of src.matchAll(appJsonRegex)) {
    const raw = String(m[1] || "").trim();
    if (!raw) continue;
    const parsed = parseJsonSafe(raw);
    if (parsed) collectBiographyStrings(parsed, bios);
  }

  // 2) Legacy Instagram globals frequently used in profile pages.
  const sharedDataRegex = /window\._sharedData\s*=\s*({[\s\S]*?})\s*;/gi;
  for (const m of src.matchAll(sharedDataRegex)) {
    const parsed = parseJsonSafe(String(m[1] || ""));
    if (parsed) collectBiographyStrings(parsed, bios);
  }

  const additionalDataRegex = /window\.__additionalDataLoaded\([^,]+,\s*({[\s\S]*?})\s*\);/gi;
  for (const m of src.matchAll(additionalDataRegex)) {
    const parsed = parseJsonSafe(String(m[1] || ""));
    if (parsed) collectBiographyStrings(parsed, bios);
  }

  // 3) Fallback when script payload slicing/parsing fails on nested JSON.
  const biographyRegex = /"biography"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  for (const m of src.matchAll(biographyRegex)) {
    const decoded = decodeMinimalHtmlEntities(decodeJsonStringLiteral(String(m[1] || "")).trim());
    if (decoded) bios.add(decoded);
  }

  const biographyEntitiesRegex = /"biography_with_entities"\s*:\s*\{[\s\S]*?"raw_text"\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  for (const m of src.matchAll(biographyEntitiesRegex)) {
    const decoded = decodeMinimalHtmlEntities(decodeJsonStringLiteral(String(m[1] || "")).trim());
    if (decoded) bios.add(decoded);
  }

  return Array.from(bios).join("\n");
}

function buildSocialEvidence(provider: SocialProvider, html: string): SocialEvidence {
  const src = String(html || "");
  if (provider !== "instagram") {
    return {
      searchableText: src,
      bodyText: src,
      bioText: "",
      metaDescription: null,
      title: null,
      bodyLength: src.length,
      bioLength: 0
    };
  }

  const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch?.[1] || src;
  const bodyText = decodeMinimalHtmlEntities(bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));

  const metaDescription =
    extractMetaContent(src, [["property", "og:description"]]) ||
    extractMetaContent(src, [["name", "description"]]) ||
    null;
  const titleMatch = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1] ? decodeMinimalHtmlEntities(titleMatch[1].trim()) : null;
  const bioText = extractInstagramBioText(src);

  const searchableText = [bodyText, metaDescription, title, bioText].filter(Boolean).join("\n");
  return {
    searchableText,
    bodyText,
    bioText,
    metaDescription,
    title,
    bodyLength: bodyText.length,
    bioLength: bioText.length
  };
}

function previewText(value: string | null, max = 200): string | null {
  if (!value) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function classifySocialFetchIssue(provider: SocialProvider, fetched: FetchUrlResult): string | null {
  const finalUrl = String(fetched.finalUrl || "").toLowerCase();
  const text = String(fetched.text || "").toLowerCase();
  const looksHtml = fetched.contentType.includes("text/html") || fetched.contentType.includes("application/xhtml+xml") || !fetched.contentType;
  const likelyLoginPath =
    finalUrl.includes("/login") ||
    finalUrl.includes("/accounts/login") ||
    finalUrl.includes("/signup") ||
    finalUrl.includes("accounts.google.com") ||
    finalUrl.includes("consent.youtube.com") ||
    finalUrl.includes("/challenge") ||
    finalUrl.includes("/consent");

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

  if (fetched.redirected && likelyLoginPath) return `${provider}-login-or-interstitial`;
  if (looksHtml && likelyLoginPath) return `${provider}-login-or-interstitial`;

  if (
    (provider === "instagram" ||
      provider === "tiktok" ||
      provider === "youtube" ||
      provider === "x" ||
      provider === "rumble" ||
      provider === "reddit" ||
      provider === "substack") &&
    looksHtml &&
    hasLoginWallMarker
  ) {
    return `${provider}-dynamic-shell-or-gated`;
  }

  if (!looksHtml) {
    return `${provider}-non-html-response`;
  }

  if (provider === "tiktok" || provider === "x") {
    const dynamicShellMarkers = ["__next_data__", "id=\"__next\"", "window.__initial_state__", "application/ld+json"];
    const hasDynamicShell = dynamicShellMarkers.some((m) => text.includes(m));
    if (hasDynamicShell && text.length < 5000) return `${provider}-dynamic-shell-or-gated`;
  }

  return null;
}

function socialChallengeMissReason(provider: SocialProvider): string {
  if (provider === "github") return "github-public-page-fetched-but-challenge-missing";
  if (provider === "instagram") return "instagram-public-html-missing-challenge";
  if (provider === "tiktok") return "tiktok-public-html-missing-challenge";
  if (provider === "youtube") return "youtube-public-page-fetched-but-challenge-missing";
  if (provider === "rumble") return "rumble-public-page-fetched-but-challenge-missing";
  if (provider === "reddit") return "reddit-public-html-missing-challenge";
  if (provider === "substack") return "substack-public-html-missing-challenge";
  return "x-public-page-fetched-but-challenge-missing";
}

function canonicalProfileUrlForProvider(provider: SocialProvider, account: string): string {
  if (provider === "github") return `https://github.com/${account}`;
  if (provider === "instagram") return `https://www.instagram.com/${account}/`;
  if (provider === "tiktok") return `https://www.tiktok.com/@${account}`;
  if (provider === "rumble") return `https://rumble.com/c/${account}`;
  if (provider === "reddit") return `https://www.reddit.com/user/${account}`;
  if (provider === "substack") return `https://${account}.substack.com`;
  if (provider === "x") return `https://x.com/${account}`;
  if (/^UC[a-zA-Z0-9_-]{10,}$/.test(account)) return `https://www.youtube.com/channel/${account}`;
  return `https://www.youtube.com/@${account}`;
}

function providerProfileUrlCandidates(
  provider: SocialProvider,
  account: string,
  inputLocation: string,
  metadata?: { channelUrl?: string | null; profileUrl?: string | null }
): string[] {
  // TODO(next): split provider adapters into dedicated modules once we add manual evidence uploads
  // and signed proof manifests for crawler-hostile platforms.
  const urls: string[] = [];
  const push = (raw: string | null | undefined) => {
    const url = normalizeHttpsUrl(String(raw || ""));
    if (!url) return;
    const s = url.toString();
    if (!urls.includes(s)) urls.push(s);
  };

  push(inputLocation);
  push(metadata?.channelUrl || null);
  push(metadata?.profileUrl || null);

  if (provider === "github") {
    push(`https://github.com/${account}`);
    push(`https://github.com/${account}/`);
    push(`https://gist.github.com/${account}`);
  } else if (provider === "instagram") {
    push(`https://www.instagram.com/${account}/`);
  } else if (provider === "tiktok") {
    push(`https://www.tiktok.com/@${account}/`);
    push(`https://www.tiktok.com/@${account}`);
  } else if (provider === "rumble") {
    push(`https://rumble.com/user/${account}/about`);
    push(`https://rumble.com/user/${account}`);
    push(`https://rumble.com/${account}`);
    push(`https://rumble.com/c/${account}`);
  } else if (provider === "reddit") {
    push(`https://old.reddit.com/user/${account}/`);
    push(`https://old.reddit.com/user/${account}`);
    push(`https://www.reddit.com/user/${account}`);
    push(`https://www.reddit.com/user/${account}/about`);
  } else if (provider === "substack") {
    push(`https://${account}.substack.com/about`);
    push(`https://${account}.substack.com`);
    push(`https://substack.com/@${account}`);
  } else if (provider === "youtube") {
    if (/^UC[a-zA-Z0-9_-]{10,}$/.test(account)) {
      push(`https://www.youtube.com/channel/${account}`);
      push(`https://www.youtube.com/channel/${account}/about`);
    } else {
      push(`https://www.youtube.com/@${account}`);
      push(`https://www.youtube.com/@${account}/about`);
    }
  } else if (provider === "x") {
    push(`https://x.com/${account}`);
    push(`https://twitter.com/${account}`);
  }
  return urls;
}

function accountFromProviderUrl(provider: SocialProvider, input: string): string | null {
  if (!input) return null;
  if (provider === "github") return normalizeGithubAccountFromUrl(input);
  if (provider === "youtube") {
    const parsed = normalizeYouTubeChannelUrl(input);
    return parsed ? parsed.account : null;
  }
  if (provider === "instagram") {
    const parsed = normalizeInstagramProfileUrl(input);
    return parsed ? parsed.account : null;
  }
  if (provider === "tiktok") {
    const parsed = normalizeTiktokProfileUrl(input);
    return parsed ? parsed.account : null;
  }
  if (provider === "rumble") {
    const parsed = normalizeRumbleProfileUrl(input);
    return parsed ? parsed.account : null;
  }
  if (provider === "reddit") {
    const parsed = normalizeRedditProfileUrl(input);
    return parsed ? parsed.account : null;
  }
  if (provider === "substack") {
    const parsed = normalizeSubstackProfileUrl(input);
    return parsed ? parsed.account : null;
  }
  return normalizeXAccountFromUrl(input);
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
  if (
    provider !== "github" &&
    provider !== "youtube" &&
    provider !== "instagram" &&
    provider !== "tiktok" &&
    provider !== "x" &&
    provider !== "rumble" &&
    provider !== "reddit" &&
    provider !== "substack"
  ) {
    throw new Error("SOCIAL_PROVIDER_NOT_SUPPORTED");
  }

  const witness = await readActiveWitnessIdentity(prisma, userId);
  if (!witness || witness.revokedAt) throw new Error("WITNESS_IDENTITY_REQUIRED");

  let account = normalizeSocialAccount(provider, inputUsername);
  if (!account) throw new Error("INVALID_SOCIAL_USERNAME");

  let postingHint = "Publish this exact text in a public location for your account, then verify using a public URL.";
  let channelUrl: string | null = null;
  let profileUrl: string | null = null;

  if (provider === "github") {
    if (!isValidSocialUsername(account)) throw new Error("INVALID_SOCIAL_USERNAME");
    postingHint = "Publish this exact text in a public GitHub Gist, then paste the Gist URL below.";
    profileUrl = canonicalProfileUrlForProvider(provider, account);
  } else if (provider === "youtube") {
    const normalizedFromUrl = normalizeYouTubeChannelUrl(inputUsername);
    if (normalizedFromUrl) {
      account = normalizedFromUrl.account;
      channelUrl = normalizedFromUrl.canonicalUrl;
    } else if (/^UC[a-zA-Z0-9_-]{10,}$/.test(account)) {
      channelUrl = canonicalProfileUrlForProvider(provider, account);
    } else if (isValidSocialUsername(account)) {
      channelUrl = canonicalProfileUrlForProvider(provider, account);
    } else {
      throw new Error("INVALID_YOUTUBE_CHANNEL_URL");
    }
    postingHint = "Add this exact text to your public YouTube channel description (About), then verify using your public channel URL.";
  } else if (provider === "instagram") {
    const normalizedFromUrl = normalizeInstagramProfileUrl(inputUsername);
    if (normalizedFromUrl) account = normalizedFromUrl.account;
    if (!/^[a-z0-9._]{1,30}$/i.test(account)) throw new Error("INVALID_INSTAGRAM_PROFILE_URL");
    profileUrl = canonicalProfileUrlForProvider(provider, account);
    postingHint = "Add this exact text to your public Instagram bio, then verify using your public profile URL.";
  } else if (provider === "tiktok") {
    const normalizedFromUrl = normalizeTiktokProfileUrl(inputUsername);
    if (normalizedFromUrl) account = normalizedFromUrl.account;
    if (!/^[a-z0-9._]{2,24}$/i.test(account)) throw new Error("INVALID_TIKTOK_PROFILE_URL");
    profileUrl = canonicalProfileUrlForProvider(provider, account);
    postingHint = "Add this exact text to your public TikTok bio, then verify using your public profile URL.";
  } else if (provider === "rumble") {
    const normalizedFromUrl = normalizeRumbleProfileUrl(inputUsername);
    if (normalizedFromUrl) account = normalizedFromUrl.account;
    if (!/^[a-z0-9._-]{2,64}$/i.test(account)) throw new Error("INVALID_RUMBLE_PROFILE_URL");
    profileUrl = canonicalProfileUrlForProvider(provider, account);
    postingHint = "Add this exact text to your public Rumble channel description, then verify using your public channel URL.";
  } else if (provider === "reddit") {
    const normalizedFromUrl = normalizeRedditProfileUrl(inputUsername);
    if (normalizedFromUrl) account = normalizedFromUrl.account;
    if (!/^[a-z0-9_-]{3,20}$/i.test(account)) throw new Error("INVALID_SOCIAL_USERNAME");
    profileUrl = canonicalProfileUrlForProvider(provider, account);
    postingHint = "Add this exact text to your public Reddit profile About section, then verify using your profile URL.";
  } else if (provider === "substack") {
    const normalizedFromUrl = normalizeSubstackProfileUrl(inputUsername);
    if (normalizedFromUrl) account = normalizedFromUrl.account;
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(account)) throw new Error("INVALID_SOCIAL_USERNAME");
    profileUrl = canonicalProfileUrlForProvider(provider, account);
    postingHint = "Add this exact text to your public Substack About bio, then verify using your publication URL.";
  } else if (provider === "x") {
    if (!isValidXUsername(account)) throw new Error("INVALID_SOCIAL_USERNAME");
    profileUrl = canonicalProfileUrlForProvider(provider, account);
    postingHint = "Add this exact text to your public X bio, then verify using your public profile URL.";
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
  const subjectCandidates = socialSubjectCandidates(provider, account);
  if (!subjectCandidates.length) throw new Error("INVALID_SOCIAL_USERNAME");
  let subject = subjectCandidates[0];
  for (const candidate of subjectCandidates) {
    const existing = await proofModel(prisma).findUnique({
      where: {
        userId_proofType_subject: {
          userId,
          proofType: PROOF_TYPE_SOCIAL,
          subject: candidate
        }
      },
      select: { id: true, subject: true }
    });
    if (existing?.subject) {
      subject = existing.subject;
      break;
    }
  }

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
  if (
    provider !== "github" &&
    provider !== "youtube" &&
    provider !== "instagram" &&
    provider !== "tiktok" &&
    provider !== "x" &&
    provider !== "rumble" &&
    provider !== "reddit" &&
    provider !== "substack"
  ) {
    throw new Error("SOCIAL_PROVIDER_NOT_SUPPORTED");
  }

  const rawAccount = String(inputUsername || "").trim();
  const account = normalizeSocialAccount(provider, rawAccount);
  if (!account) {
    if (provider === "youtube") throw new Error("INVALID_YOUTUBE_CHANNEL_URL");
    if (provider === "instagram") throw new Error("INVALID_INSTAGRAM_PROFILE_URL");
    if (provider === "tiktok") throw new Error("INVALID_TIKTOK_PROFILE_URL");
    if (provider === "rumble") throw new Error("INVALID_RUMBLE_PROFILE_URL");
    throw new Error("INVALID_SOCIAL_USERNAME");
  }

  const subjectCandidates = socialSubjectCandidates(provider, account);
  let existing: { id: string; claimJson: unknown } | null = null;
  for (const subject of subjectCandidates) {
    existing = await proofModel(prisma).findUnique({
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
    if (existing) break;
  }
  if (!existing) throw new Error("PROOF_CHALLENGE_NOT_FOUND");

  const claim = parseSocialClaim(existing.claimJson);
  if (!claim) throw new Error("PROOF_CHALLENGE_INVALID");
  if (claim.provider !== provider) throw new Error("PROOF_CHALLENGE_INVALID");

  const claimAccount = normalizeStoredSocialAccount(provider, claim.account);
  const requestAccount = normalizeStoredSocialAccount(provider, account);
  if (claimAccount !== requestAccount) throw new Error("PROOF_CHALLENGE_INVALID");

  const rawLocation = String(inputLocation || "").trim();
  if (rawLocation) {
    if (!normalizeHttpsUrl(rawLocation)) throw new Error("INVALID_SOCIAL_LOCATION");
    const locationAccount = accountFromProviderUrl(provider, rawLocation);
    if (!locationAccount) throw new Error("INVALID_SOCIAL_LOCATION");
    if (normalizeStoredSocialAccount(provider, locationAccount) !== requestAccount) {
      throw new Error("SOCIAL_LOCATION_MISMATCH");
    }
  }

  const acceptedChallenges = socialChallengeCandidates(claim.challengeText);
  const candidateUrls = providerProfileUrlCandidates(provider, requestAccount, rawLocation, {
    channelUrl: claim.channelUrl,
    profileUrl: claim.profileUrl
  });
  if (!candidateUrls.length) throw new Error("INVALID_SOCIAL_LOCATION");

  const attemptedUrls: string[] = [];
  let verified = false;
  let failureReason = "no-usable-provider-candidate";
  let lastCandidateReason: string | null = null;
  let matchedUrl: string | null = null;
  let matchedChallengePrefix: string | null = null;

  for (const candidateUrl of candidateUrls) {
    attemptedUrls.push(candidateUrl);
    try {
      const fetched = await fetchUrlText(candidateUrl);
      const evidence = buildSocialEvidence(provider, fetched.text);
      const candidateMatched = acceptedChallenges.find((c) => {
        if (evidence.searchableText.includes(c)) return true;
        // Regression guard: previous behavior matched against raw fetched HTML.
        // Keep strict exact challenge matching while allowing Instagram HTML path.
        if (provider === "instagram" && fetched.text.includes(c)) return true;
        return false;
      });
      if (fetched.ok && candidateMatched) {
        verified = true;
        matchedUrl = fetched.finalUrl || candidateUrl;
        matchedChallengePrefix = candidateMatched.startsWith(SOCIAL_PROOF_PREFIX_CERTIFYD)
          ? SOCIAL_PROOF_PREFIX_CERTIFYD
          : SOCIAL_PROOF_PREFIX_LEGACY;
        break;
      }

      if (!fetched.ok) {
        failureReason = `url-fetch-http-${fetched.status}`;
      } else {
        const issue = classifySocialFetchIssue(provider, fetched);
        if (provider === "instagram" && (evidence.metaDescription || evidence.title)) {
          failureReason = "instagram-public-html-missing-challenge";
        } else {
          failureReason = issue || socialChallengeMissReason(provider);
        }
      }
      lastCandidateReason = failureReason;

      const expectedChallengeText = provider === "instagram" || provider === "rumble" ? String(claim.challengeText || "") : "";
      const nonceMatch = expectedChallengeText.match(/\bnonce=([^\s]+)/);
      const nonceToken = nonceMatch?.[1] || "";
      const providerToken = provider === "instagram" || provider === "rumble" ? `provider=${provider}` : "";
      const accountToken = provider === "instagram" || provider === "rumble" ? `account=${requestAccount}` : "";

      const bodyLower = provider === "instagram" ? evidence.bodyText.toLowerCase() : "";
      const metaLower = provider === "instagram" ? String(evidence.metaDescription || "").toLowerCase() : "";
      const titleLower = provider === "instagram" ? String(evidence.title || "").toLowerCase() : "";
      const rawLower = provider === "instagram" ? String(fetched.text || "").toLowerCase() : "";

      logSocialVerificationDebug("candidate_checked", {
        provider,
        rawAccount,
        normalizedAccount: requestAccount,
        expectedChallengeText: provider === "instagram" || provider === "rumble" ? expectedChallengeText : undefined,
        expectedChallengeTextLength: provider === "instagram" || provider === "rumble" ? expectedChallengeText.length : undefined,
        acceptedChallengeCandidates: provider === "instagram" || provider === "rumble" ? acceptedChallenges : undefined,
        attemptedUrl: candidateUrl,
        finalUrl: fetched.finalUrl,
        redirected: fetched.redirected,
        status: fetched.status,
        contentType: fetched.contentType,
        matchedChallengePrefix: candidateMatched
          ? candidateMatched.startsWith(SOCIAL_PROOF_PREFIX_CERTIFYD)
            ? SOCIAL_PROOF_PREFIX_CERTIFYD
            : SOCIAL_PROOF_PREFIX_LEGACY
          : null,
        failureReason,
        metaDescription: evidence.metaDescription,
        title: evidence.title,
        bodyLength: evidence.bodyLength,
        metaDescriptionLength: evidence.metaDescription ? evidence.metaDescription.length : 0,
        titleLength: evidence.title ? evidence.title.length : 0,
        candidatePresence:
          provider === "instagram"
            ? acceptedChallenges.map((candidate) => ({
                candidate,
                candidateLength: candidate.length,
                inBody: evidence.bodyText.includes(candidate),
                inBio: evidence.bioText.includes(candidate),
                inMetaDescription: String(evidence.metaDescription || "").includes(candidate),
                inTitle: String(evidence.title || "").includes(candidate),
                inRawHtml: fetched.text.includes(candidate)
              }))
            : provider === "rumble"
              ? acceptedChallenges.map((candidate) => ({
                  candidate,
                  candidateLength: candidate.length,
                  inBody: evidence.bodyText.includes(candidate),
                  inRawHtml: fetched.text.includes(candidate)
                }))
            : provider === "reddit" || provider === "substack"
              ? acceptedChallenges.map((candidate) => ({
                  candidate,
                  candidateLength: candidate.length,
                  inBody: evidence.bodyText.includes(candidate),
                  inRawHtml: fetched.text.includes(candidate)
                }))
            : undefined,
        markerSummary:
          provider === "instagram"
            ? {
                hasLoginMarkers:
                  bodyLower.includes("log in") ||
                  bodyLower.includes("login") ||
                  metaLower.includes("log in") ||
                  metaLower.includes("login") ||
                  titleLower.includes("log in") ||
                  titleLower.includes("login"),
                hasSignupMarkers:
                  bodyLower.includes("sign up") ||
                  bodyLower.includes("signup") ||
                  metaLower.includes("sign up") ||
                  metaLower.includes("signup") ||
                  titleLower.includes("sign up") ||
                  titleLower.includes("signup"),
                hasInstagramAppMarkers:
                  rawLower.includes("instagram app") ||
                  rawLower.includes("open app") ||
                  rawLower.includes("get the app") ||
                  rawLower.includes("use the app"),
                hasProfileMarkers:
                  rawLower.includes("followers") ||
                  rawLower.includes("following") ||
                  rawLower.includes("\"profile_page\"") ||
                  rawLower.includes("profile")
              }
            : undefined,
        bioMatchCandidate:
          provider === "instagram"
            ? acceptedChallenges.some((candidate) => evidence.bioText.includes(candidate))
            : undefined,
        tokenPresence:
          provider === "instagram"
            ? {
                nonceToken,
                nonceInBody: nonceToken ? evidence.bodyText.includes(nonceToken) : false,
                nonceInBio: nonceToken ? evidence.bioText.includes(nonceToken) : false,
                nonceInMetaDescription: nonceToken ? String(evidence.metaDescription || "").includes(nonceToken) : false,
                nonceInTitle: nonceToken ? String(evidence.title || "").includes(nonceToken) : false,
                nonceInRawHtml: nonceToken ? fetched.text.includes(nonceToken) : false,
                providerToken,
                providerInRawHtml: providerToken ? fetched.text.includes(providerToken) : false,
                accountToken,
                accountInRawHtml: accountToken ? fetched.text.includes(accountToken) : false,
                accountInBio: accountToken ? evidence.bioText.includes(accountToken) : false
              }
            : undefined,
        bodyPreview: provider === "instagram" ? previewText(evidence.bodyText) : undefined,
        bioPreview: provider === "instagram" ? previewText(evidence.bioText) : undefined,
        bioLength: provider === "instagram" ? evidence.bioLength : undefined,
        metaDescriptionPreview: provider === "instagram" ? previewText(evidence.metaDescription) : undefined,
        titlePreview: provider === "instagram" ? previewText(evidence.title) : undefined
      });
    } catch (e: any) {
      const raw = String(e?.message || e);
      failureReason = raw.toUpperCase().includes("ABORT")
        ? "provider-fetch-timeout"
        : "provider-fetch-network-error";
      lastCandidateReason = failureReason;
      logSocialVerificationDebug("candidate_failed", {
        provider,
        rawAccount,
        normalizedAccount: requestAccount,
        attemptedUrl: candidateUrl,
        error: raw,
        failureReason,
        metaDescription: null,
        title: null,
        bodyLength: 0,
        bioLength: 0,
        bioPreview: null
      });
    }
  }

  logSocialVerificationDebug("verify_complete", {
    provider,
    rawAccount,
    normalizedAccount: requestAccount,
    attemptedUrls,
    matchedChallengePrefix,
    verified,
    failureReason: verified ? null : failureReason,
    lastCandidateReason
  });

  const row = await proofModel(prisma).update({
    where: { id: existing.id },
    data: {
      status: verified ? PROOF_STATUS_VERIFIED : PROOF_STATUS_FAILED,
      verifiedAt: verified ? new Date() : null,
      failureReason: verified ? null : failureReason,
      location: verified ? matchedUrl : candidateUrls[0] || null,
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
