export const PROOF_TYPE_DOMAIN = "domain" as const;
export const PROOF_TYPE_SOCIAL = "social" as const;
export const PROOF_TYPE_NOSTR = "nostr" as const;
export const PROOF_STATUS_PENDING = "pending" as const;
export const PROOF_STATUS_VERIFIED = "verified" as const;
export const PROOF_STATUS_FAILED = "failed" as const;
export const PROOF_STATUS_REVOKED = "revoked" as const;
export const PROOF_METHOD_DNS_TXT = "dns_txt" as const;
export const PROOF_METHOD_URL_TEXT = "url_text_match" as const;
export const PROOF_METHOD_NOSTR_SIGNATURE = "nostr_event_signature" as const;

export type ProofRecordDto = {
  id: string;
  proofType: string;
  subject: string;
  claimJson: Record<string, unknown>;
  signature: string | null;
  status: string;
  verificationMethod: string;
  location: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  revokedAt: string | null;
  failureReason: string | null;
};

export type DomainChallengeBody = {
  domain?: string;
};

export type DomainVerifyBody = {
  domain?: string;
};

export type SocialProvider = "github" | "x" | "youtube" | "instagram" | "tiktok" | "rumble";

export type SocialChallengeBody = {
  provider?: string;
  username?: string;
};

export type SocialVerifyBody = {
  provider?: string;
  username?: string;
  location?: string;
};

export type NostrChallengeBody = {
  pubkey?: string;
};

export type NostrVerifyBody = {
  pubkey?: string;
  signedEvent?: unknown;
};
