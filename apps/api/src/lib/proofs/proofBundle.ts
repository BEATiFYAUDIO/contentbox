import { sha256Hex, stableStringify } from "../proof.js";

export type SignatureBlock = {
  scheme: "pgp" | "keybase" | "nostr" | "other";
  signerRef: string;
  signature: string;
  signedAt: string;
};

export type SplitParticipantRef = {
  recipientRef: string;
  bps: number;
  recipientDisplay?: string;
};

export type SplitAnchor = {
  contentId: string;
  splitVersionId: string;
  lockedManifestSha256?: string | null;
  lockedFileSha256?: string | null;
  splitsHash: string;
  lockedAt?: string | null;
  participants: SplitParticipantRef[];
};

export type PublishAnchor = {
  contentId: string;
  manifestSha256: string;
  splitVersionId: string;
  splitsHash: string;
  publishedAt?: string | null;
};

export type ParentPublishAnchor = {
  parentContentId: string;
  parentManifestSha256: string;
  parentSplitVersionId: string;
  parentSplitsHash: string;
};

export type SettlementReceipt = {
  settlementId: string;
  paymentRef?: string | null;
  amountSats: number;
  paidAt: string;
  contentId: string;
  manifestSha256: string;
  splitVersionId: string;
  splitsHash: string;
};

export type SettlementLine = {
  recipientRef: string;
  bps: number;
  amountSats: number;
  recipientDisplay?: string;
};

export type ProofBundleV1 = {
  version: "v1";
  generatedAt: string;
  publish: PublishAnchor;
  split: SplitAnchor;
  settlement?: SettlementReceipt;
  lines?: SettlementLine[];
  canonicalOrigin?: string | null;
  parentPublishAnchor?: ParentPublishAnchor;
  bundleHash: string;
  signatures?: SignatureBlock[];
};

export const sortParticipants = (list: SplitParticipantRef[]): SplitParticipantRef[] => {
  return [...list].sort((a, b) => {
    const ra = a.recipientRef.toLowerCase();
    const rb = b.recipientRef.toLowerCase();
    if (ra !== rb) return ra.localeCompare(rb);
    if (a.bps !== b.bps) return b.bps - a.bps;
    return 0;
  });
};

export const sortLines = (list: SettlementLine[]): SettlementLine[] => {
  return [...list].sort((a, b) => {
    const ra = a.recipientRef.toLowerCase();
    const rb = b.recipientRef.toLowerCase();
    if (ra !== rb) return ra.localeCompare(rb);
    if (a.bps !== b.bps) return b.bps - a.bps;
    return 0;
  });
};

// Canonical splits hash: stable key order, participants sorted by recipientRef ASC then bps DESC.
export function computeSplitsHash(input: {
  splitVersionId: string;
  contentId: string;
  lockedManifestSha256?: string | null;
  lockedFileSha256?: string | null;
  participants: SplitParticipantRef[];
}): string {
  const participants = sortParticipants(input.participants).map((p) => ({
    recipientRef: p.recipientRef,
    bps: Math.floor(Number(p.bps || 0))
  }));
  const payload = {
    splitVersionId: input.splitVersionId,
    contentId: input.contentId,
    lockedManifestSha256: input.lockedManifestSha256 || input.lockedFileSha256 || "",
    participants
  };
  return sha256Hex(stableStringify(payload));
}

// Bundle hash excludes bundleHash + signatures to keep verification stable across signing schemes.
export function computeBundleHash(bundle: ProofBundleV1): string {
  const sanitized = {
    ...bundle,
    bundleHash: undefined,
    signatures: undefined
  } as any;
  delete sanitized.bundleHash;
  delete sanitized.signatures;
  return sha256Hex(stableStringify(sanitized));
}

export function buildBundle(params: Omit<ProofBundleV1, "bundleHash">): ProofBundleV1 {
  const bundle: ProofBundleV1 = {
    ...params,
    bundleHash: ""
  };
  bundle.bundleHash = computeBundleHash(bundle);
  return bundle;
}
