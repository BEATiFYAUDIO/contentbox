import { api, getApiBase } from "../../lib/api";

export type WitnessIdentity = {
  id: string;
  algorithm: "ed25519";
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  revokedAt: string | null;
};

export type ProofRecord = {
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

export type SocialProvider = "github" | "x" | "youtube" | "tiktok" | "rumble" | "reddit" | "substack";

function witnessDebug(event: string, payload?: Record<string, unknown>): void {
  try {
    console.debug("[witness]", event, payload || {});
  } catch {
    // ignore debug failures
  }
}

function parseStatusFromApiError(err: unknown): number | null {
  const msg = String((err as any)?.message || "");
  const m = msg.match(/\]\s+(\d{3})\s+/);
  return m ? Number(m[1]) : null;
}

function parseUrlFromApiError(err: unknown): string | null {
  const msg = String((err as any)?.message || "");
  const m = msg.match(/^\[[A-Z]+\s+([^\]]+)\]/);
  return m?.[1] || null;
}

export async function fetchWitnessIdentity(): Promise<WitnessIdentity | null> {
  const currentBase = getApiBase();
  witnessDebug("fetch.start", {
    pageOrigin: typeof window !== "undefined" ? window.location.origin : null,
    pageHostname: typeof window !== "undefined" ? window.location.hostname : null,
    apiBase: currentBase,
    requestPath: "/api/profile/verification/key"
  });

  try {
    const res = await api<{ identity: WitnessIdentity | null }>("/api/profile/verification/key", "GET");
    witnessDebug("fetch.success", {
      apiBase: currentBase,
      requestPath: "/api/profile/verification/key",
      result: res?.identity ? "identity" : "no_identity"
    });
    return res?.identity || null;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    const url = parseUrlFromApiError(e);
    witnessDebug("fetch.error", {
      apiBase: currentBase,
      requestPath: "/api/profile/verification/key",
      requestUrl: url,
      status,
      error: String(e?.message || e)
    });

    // Explicitly treat GET 404 as no identity (friendly empty state).
    if (status === 404) return null;

    throw new Error(status ? `Failed to load creator identity (HTTP ${status}).` : "Failed to load creator identity.");
  }
}

export async function registerWitnessPublicKey(payload: {
  publicKey: string;
  algorithm: "ed25519";
}): Promise<WitnessIdentity> {
  const currentBase = getApiBase();
  witnessDebug("register.start", {
    pageOrigin: typeof window !== "undefined" ? window.location.origin : null,
    pageHostname: typeof window !== "undefined" ? window.location.hostname : null,
    apiBase: currentBase,
    requestPath: "/api/profile/verification/key/register"
  });

  try {
    const res = await api<{ identity: WitnessIdentity }>("/api/profile/verification/key/register", "POST", payload);
    witnessDebug("register.success", {
      apiBase: currentBase,
      requestPath: "/api/profile/verification/key/register"
    });
    return res.identity;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    const url = parseUrlFromApiError(e);
    witnessDebug("register.error", {
      apiBase: currentBase,
      requestPath: "/api/profile/verification/key/register",
      requestUrl: url,
      status,
      error: String(e?.message || e)
    });

    if (status === 404) {
      throw new Error("Creator identity endpoint is unavailable on the current API origin.");
    }
    if (status === 409) {
      throw new Error("A creator identity is already registered for this account.");
    }
    throw new Error(status ? `Failed to register creator identity (HTTP ${status}).` : "Failed to register creator identity.");
  }
}

export async function fetchProofRecords(): Promise<ProofRecord[]> {
  try {
    const res = await api<{ proofs: ProofRecord[] }>("/api/profile/verification/proofs", "GET");
    return Array.isArray(res?.proofs) ? res.proofs : [];
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 404) return [];
    throw new Error(status ? `Failed to load proofs (HTTP ${status}).` : "Failed to load proofs.");
  }
}

export async function createDomainChallenge(domain: string): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>("/api/profile/verification/domain/challenge", "POST", { domain });
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 400) throw new Error("Enter a valid domain (example.com).");
    if (status === 409) throw new Error("Create your creator identity key before requesting domain verification.");
    throw new Error(status ? `Failed to create challenge (HTTP ${status}).` : "Failed to create challenge.");
  }
}

export async function verifyDomainProof(domain: string): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>("/api/profile/verification/domain/verify", "POST", { domain });
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 404) throw new Error("Create a challenge for this domain first.");
    if (status === 400) throw new Error("Enter a valid domain (example.com).");
    throw new Error(status ? `Failed to verify domain (HTTP ${status}).` : "Failed to verify domain.");
  }
}

export async function createSocialChallenge(provider: SocialProvider, username: string): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>("/api/profile/verification/social/challenge", "POST", { provider, username });
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 400) {
      if (provider === "youtube") throw new Error("Enter a valid YouTube channel URL (/@handle or /channel/<id>).");
      if (provider === "tiktok") throw new Error("Enter a valid TikTok profile URL (https://www.tiktok.com/@handle).");
      if (provider === "rumble") throw new Error("Enter a valid Rumble profile URL (https://rumble.com/c/<handle> or https://rumble.com/user/<handle>).");
      if (provider === "reddit") throw new Error("Enter a valid Reddit profile URL (https://www.reddit.com/user/<username>).");
      if (provider === "substack") throw new Error("Enter a valid Substack profile URL (https://<publication>.substack.com or https://substack.com/@<username>).");
      throw new Error("Invalid provider or username.");
    }
    if (status === 409) throw new Error("Create your creator identity key before social verification.");
    throw new Error(status ? `Failed to create social challenge (HTTP ${status}).` : "Failed to create social challenge.");
  }
}

export async function verifySocialProof(provider: SocialProvider, username: string, location: string): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>("/api/profile/verification/social/verify", "POST", {
      provider,
      username,
      location
    });
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 404) throw new Error("Create a social challenge first.");
    if (status === 400) {
      if (provider === "youtube") throw new Error("Invalid YouTube verification input. Use your public channel URL.");
      if (provider === "tiktok") throw new Error("Invalid TikTok verification input. Use your public profile URL.");
      if (provider === "rumble") throw new Error("Invalid Rumble verification input. Use your public channel URL.");
      if (provider === "reddit") throw new Error("Invalid Reddit verification input. Use your public profile URL.");
      if (provider === "substack") throw new Error("Invalid Substack verification input. Use your public profile/publication URL.");
      throw new Error("Invalid social verification input.");
    }
    throw new Error(status ? `Failed to verify social proof (HTTP ${status}).` : "Failed to verify social proof.");
  }
}

export async function createNostrChallenge(pubkey: string): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>("/api/profile/verification/nostr/challenge", "POST", { pubkey });
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 400) throw new Error("Enter a valid Nostr npub or hex pubkey.");
    if (status === 409) throw new Error("Create your creator identity key before Nostr verification.");
    throw new Error(status ? `Failed to create Nostr challenge (HTTP ${status}).` : "Failed to create Nostr challenge.");
  }
}

export async function verifyNostrProof(pubkey: string, signedEvent: unknown): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>("/api/profile/verification/nostr/verify", "POST", { pubkey, signedEvent });
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 404) throw new Error("Create a Nostr challenge first.");
    if (status === 400) throw new Error("Invalid Nostr proof input.");
    throw new Error(status ? `Failed to verify Nostr proof (HTTP ${status}).` : "Failed to verify Nostr proof.");
  }
}

export async function cancelProof(proofId: string): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>(`/api/profile/verification/proofs/${encodeURIComponent(proofId)}/cancel`, "POST");
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 409) throw new Error("Only pending proofs can be cancelled.");
    throw new Error(status ? `Failed to cancel proof (HTTP ${status}).` : "Failed to cancel proof.");
  }
}

export async function revokeProof(proofId: string): Promise<ProofRecord> {
  try {
    const res = await api<{ proof: ProofRecord }>(`/api/profile/verification/proofs/${encodeURIComponent(proofId)}/revoke`, "POST");
    return res.proof;
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 409) throw new Error("Only verified proofs can be revoked.");
    throw new Error(status ? `Failed to revoke proof (HTTP ${status}).` : "Failed to revoke proof.");
  }
}

export async function deleteProof(proofId: string): Promise<void> {
  try {
    await api<{ ok: true }>(`/api/profile/verification/proofs/${encodeURIComponent(proofId)}`, "DELETE");
  } catch (e: any) {
    const status = parseStatusFromApiError(e);
    if (status === 409) throw new Error("Only pending or failed proofs can be deleted.");
    throw new Error(status ? `Failed to delete proof (HTTP ${status}).` : "Failed to delete proof.");
  }
}
