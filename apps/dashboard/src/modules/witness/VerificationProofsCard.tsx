import { useEffect, useState } from "react";
import type { WitnessIdentityHookResult } from "./useWitnessIdentity";
import {
  cancelProof,
  createNostrChallenge,
  createDomainChallenge,
  createSocialChallenge,
  deleteProof,
  fetchProofRecords,
  type ProofRecord,
  type SocialProvider,
  revokeProof,
  verifyNostrProof,
  verifyDomainProof,
  verifySocialProof
} from "./witnessClient";

function formatDomainFailure(reason: string, domain?: string): string {
  const msg = String(reason || "").trim();
  if (!msg) return "";
  if (msg.includes("ENOTFOUND")) {
    const hostMatch = msg.match(/ENOTFOUND\s+([^\s]+)/i);
    const lookedUpHost = hostMatch?.[1] || "";
    const duplicateExample =
      lookedUpHost && domain ? `${lookedUpHost}.${domain}` : lookedUpHost ? `${lookedUpHost}.<your-domain>` : "";
    const duplicateHint = duplicateExample
      ? ` Your DNS provider may have created "${duplicateExample}" instead.`
      : "";
    return `${msg}.${duplicateHint} Edit the Host/Name field to "_contentbox-verify" only (not the full domain).`;
  }
  return msg;
}

function looksLikeYouTubeNonChannelUrl(input: string): boolean {
  const src = String(input || "").toLowerCase();
  return src.includes("/post/") || src.includes("/watch") || src.includes("/shorts");
}

function looksLikeInstagramNonProfileUrl(input: string): boolean {
  const src = String(input || "").toLowerCase();
  return src.includes("/p/") || src.includes("/reel/") || src.includes("/stories/") || src.includes("/tv/");
}

function looksLikeTiktokNonProfileUrl(input: string): boolean {
  const src = String(input || "").toLowerCase();
  return src.includes("/video/") || src.includes("/photo/") || src.includes("/t/");
}

type Props = {
  witness: WitnessIdentityHookResult;
};

export default function VerificationProofsCard({ witness }: Props) {
  const { state, loading } = witness;
  const [domain, setDomain] = useState("");
  const [challengeProof, setChallengeProof] = useState<ProofRecord | null>(null);
  const [proofs, setProofs] = useState<ProofRecord[]>([]);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [domainBusy, setDomainBusy] = useState<"challenge" | "verify" | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [socialProvider, setSocialProvider] = useState<SocialProvider>("github");
  const [socialAccountInput, setSocialAccountInput] = useState("");
  const [socialLocation, setSocialLocation] = useState("");
  const [socialChallengeProof, setSocialChallengeProof] = useState<ProofRecord | null>(null);
  const [socialBusy, setSocialBusy] = useState<"challenge" | "verify" | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [nostrPubkey, setNostrPubkey] = useState("");
  const [nostrChallengeProof, setNostrChallengeProof] = useState<ProofRecord | null>(null);
  const [nostrSignedEvent, setNostrSignedEvent] = useState("");
  const [nostrBusy, setNostrBusy] = useState<"challenge" | "verify" | null>(null);
  const [nostrError, setNostrError] = useState<string | null>(null);
  const [proofActionBusyId, setProofActionBusyId] = useState<string | null>(null);
  const [proofActionError, setProofActionError] = useState<string | null>(null);
  const [showDomainBuilder, setShowDomainBuilder] = useState(false);
  const [showSocialBuilder, setShowSocialBuilder] = useState(false);
  const [showNostrBuilder, setShowNostrBuilder] = useState(false);

  const canUseProofs = state === "ready" || state === "registeredMissingLocalKey";
  const socialEnabled = socialProvider === "github" || socialProvider === "youtube" || socialProvider === "instagram" || socialProvider === "tiktok";
  const youtubeBadAccountUrl = socialProvider === "youtube" && looksLikeYouTubeNonChannelUrl(socialAccountInput);
  const youtubeBadLocationUrl = socialProvider === "youtube" && looksLikeYouTubeNonChannelUrl(socialLocation);
  const instagramBadAccountUrl = socialProvider === "instagram" && looksLikeInstagramNonProfileUrl(socialAccountInput);
  const instagramBadLocationUrl = socialProvider === "instagram" && looksLikeInstagramNonProfileUrl(socialLocation);
  const tiktokBadAccountUrl = socialProvider === "tiktok" && looksLikeTiktokNonProfileUrl(socialAccountInput);
  const tiktokBadLocationUrl = socialProvider === "tiktok" && looksLikeTiktokNonProfileUrl(socialLocation);

  const reloadProofs = () =>
    fetchProofRecords()
      .then((rows) => setProofs(rows))
      .catch((e: any) => setDomainError(String(e?.message || "Failed to load proofs.")));

  useEffect(() => {
    if (!canUseProofs || loading) return;
    setProofsLoading(true);
    reloadProofs()
      .finally(() => setProofsLoading(false));
  }, [canUseProofs, loading]);

  const domainProofs = proofs.filter((p) => p.proofType === "domain");
  const socialProofs = proofs.filter((p) => p.proofType === "social");
  const nostrProofs = proofs.filter((p) => p.proofType === "nostr");

  const claim = challengeProof?.claimJson || {};
  const challengeTxtName = String((claim as any)?.txtName || "");
  const challengeTxtValue = String((claim as any)?.txtValue || "");
  const challengeDomain = String((claim as any)?.domain || challengeProof?.subject || "").trim();
  const challengeHostLabel =
    challengeTxtName && challengeDomain && challengeTxtName.endsWith(`.${challengeDomain}`)
      ? challengeTxtName.slice(0, -(`.${challengeDomain}`.length))
      : challengeTxtName;

  const renderCompactStatus = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s === "verified") return <span className="text-emerald-300">verified</span>;
    if (s === "failed") return <span className="text-amber-300">failed</span>;
    if (s === "revoked") return <span className="text-neutral-500">revoked</span>;
    return <span className="text-amber-300">pending</span>;
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="text-sm font-medium">Verification Proofs</div>
      <div className="text-xs text-neutral-500">Proofs linked to your creator identity: what this identity controls.</div>

      {!loading && !canUseProofs ? (
        <div className="mt-3 text-xs text-neutral-500">Create Creator Identity first to enable verification proofs.</div>
      ) : null}

      {!loading && canUseProofs ? (
        <>
          <div className="mt-4 border-t border-neutral-800 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-neutral-300">Domains</div>
              <button
                type="button"
                className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
                onClick={() => setShowDomainBuilder((v) => !v)}
              >
                {showDomainBuilder ? "Hide challenge builder" : "Add / Verify domain"}
              </button>
            </div>
            {showDomainBuilder ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              />
              <button
                type="button"
                disabled={domainBusy !== null}
                onClick={() => {
                  const normalized = domain.trim();
                  if (!normalized) {
                    setDomainError("Enter a domain first.");
                    return;
                  }
                  setDomainBusy("challenge");
                  setDomainError(null);
                  createDomainChallenge(normalized)
                    .then((proof) => {
                      setChallengeProof(proof);
                      setDomain(proof.subject);
                      return reloadProofs();
                    })
                    .catch((e: any) => setDomainError(String(e?.message || "Failed to create challenge.")))
                    .finally(() => setDomainBusy(null));
                }}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {domainBusy === "challenge" ? "Creating…" : "Create Challenge"}
              </button>
              <button
                type="button"
                disabled={domainBusy !== null}
                onClick={() => {
                  const normalized = domain.trim();
                  if (!normalized) {
                    setDomainError("Enter a domain first.");
                    return;
                  }
                  setDomainBusy("verify");
                  setDomainError(null);
                  verifyDomainProof(normalized)
                    .then((proof) => {
                      setChallengeProof(proof);
                      return reloadProofs();
                    })
                    .catch((e: any) => setDomainError(String(e?.message || "Failed to verify domain.")))
                    .finally(() => setDomainBusy(null));
                }}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {domainBusy === "verify" ? "Verifying…" : "Verify Domain"}
              </button>
              </div>
            ) : null}

            {showDomainBuilder && challengeProof && challengeTxtName && challengeTxtValue ? (
              <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-xs text-neutral-400">Add this DNS TXT record:</div>
                <div className="mt-1 text-xs text-neutral-500">Host</div>
                <div className="font-mono text-xs break-all">{challengeHostLabel || challengeTxtName}</div>
                {challengeDomain ? (
                  <>
                    <div className="mt-2 text-xs text-neutral-500">Domain</div>
                    <div className="font-mono text-xs break-all">{challengeDomain}</div>
                  </>
                ) : null}
                <div className="mt-2 text-xs text-neutral-500">Full record</div>
                <div className="font-mono text-xs break-all">{challengeTxtName}</div>
                <div className="mt-2 text-xs text-neutral-500">
                  Many DNS providers append the root domain automatically. In most DNS panels, set Host/Name to only <span className="font-mono">_contentbox-verify</span>.
                </div>
                {challengeTxtName && challengeDomain ? (
                  <div className="mt-1 text-xs text-neutral-500">
                    If you enter the full host, some providers will create <span className="font-mono">{challengeTxtName}.{challengeDomain}</span>, which will fail verification.
                  </div>
                ) : null}
                <div className="mt-2 text-xs text-neutral-500">Value</div>
                <div className="font-mono text-xs break-all">{challengeTxtValue}</div>
              </div>
            ) : null}

            {domainError ? <div className="mt-2 text-xs text-amber-300">{domainError}</div> : null}
            <div className="mt-2">
              <div className="text-xs text-neutral-400">Domain proof status</div>
              {proofsLoading ? <div className="mt-1 text-xs text-neutral-500">Loading proofs…</div> : null}
              {!proofsLoading && domainProofs.length === 0 ? <div className="mt-1 text-xs text-neutral-500">No domain proofs yet.</div> : null}
              {!proofsLoading && domainProofs.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {domainProofs.map((p) => (
                    <div key={p.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{p.subject}</span>
                        {renderCompactStatus(p.status)}
                      </div>
                      {p.failureReason ? <div className="mt-1 text-xs text-amber-300">{formatDomainFailure(p.failureReason, p.subject)}</div> : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.status === "pending" ? (
                          <>
                            <button
                              type="button"
                              disabled={proofActionBusyId === p.id}
                              onClick={() => {
                                setProofActionBusyId(p.id);
                                setProofActionError(null);
                                cancelProof(p.id)
                                  .then(() => reloadProofs())
                                  .catch((e: any) => setProofActionError(String(e?.message || "Failed to cancel proof.")))
                                  .finally(() => setProofActionBusyId(null));
                              }}
                              className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={proofActionBusyId === p.id}
                              onClick={() => {
                                setProofActionBusyId(p.id);
                                setProofActionError(null);
                                deleteProof(p.id)
                                  .then(() => reloadProofs())
                                  .catch((e: any) => setProofActionError(String(e?.message || "Failed to delete proof.")))
                                  .finally(() => setProofActionBusyId(null));
                              }}
                              className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60"
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                        {p.status === "verified" ? (
                          <button
                            type="button"
                            disabled={proofActionBusyId === p.id}
                            onClick={() => {
                              setProofActionBusyId(p.id);
                              setProofActionError(null);
                              revokeProof(p.id)
                                .then(() => reloadProofs())
                                .catch((e: any) => setProofActionError(String(e?.message || "Failed to revoke proof.")))
                                .finally(() => setProofActionBusyId(null));
                            }}
                            className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60"
                          >
                            Revoke
                          </button>
                        ) : null}
                        {p.status === "failed" ? (
                          <button
                            type="button"
                            disabled={proofActionBusyId === p.id}
                            onClick={() => {
                              setProofActionBusyId(p.id);
                              setProofActionError(null);
                              deleteProof(p.id)
                                .then(() => reloadProofs())
                                .catch((e: any) => setProofActionError(String(e?.message || "Failed to delete proof.")))
                                .finally(() => setProofActionBusyId(null));
                            }}
                            className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 border-t border-neutral-800 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-neutral-300">Creator Platforms</div>
              <button
                type="button"
                className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
                onClick={() => setShowSocialBuilder((v) => !v)}
              >
                {showSocialBuilder ? "Hide challenge builder" : "Add / Verify platform"}
              </button>
            </div>
            {showSocialBuilder ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                value={socialProvider}
                onChange={(e) => setSocialProvider(e.target.value as SocialProvider)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              >
                <option value="github">GitHub</option>
                <option value="youtube">YouTube</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="x">X (coming soon)</option>
              </select>
              <input
                type="text"
                value={socialAccountInput}
                onChange={(e) => setSocialAccountInput(e.target.value)}
                placeholder={
                  socialProvider === "github"
                    ? "github username"
                    : socialProvider === "youtube"
                      ? "Paste your YouTube channel URL (example: https://www.youtube.com/@yourhandle)"
                      : socialProvider === "instagram"
                        ? "Paste your Instagram profile URL (example: https://www.instagram.com/yourhandle/)"
                        : socialProvider === "tiktok"
                          ? "Paste your TikTok profile URL (example: https://www.tiktok.com/@yourhandle)"
                      : "x username"
                }
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              />
            </div>
            ) : null}
            {socialProvider === "youtube" && (youtubeBadAccountUrl || youtubeBadLocationUrl) ? (
              <div className="mt-2 text-xs text-amber-300">
                This looks like a post or video URL. Please paste your channel URL instead.
              </div>
            ) : null}
            {socialProvider === "instagram" && (instagramBadAccountUrl || instagramBadLocationUrl) ? (
              <div className="mt-2 text-xs text-amber-300">
                This looks like a post/reel/story URL. Please paste your profile URL instead.
              </div>
            ) : null}
            {socialProvider === "tiktok" && (tiktokBadAccountUrl || tiktokBadLocationUrl) ? (
              <div className="mt-2 text-xs text-amber-300">
                This looks like a video URL. Please paste your TikTok profile URL instead.
              </div>
            ) : null}

            {showSocialBuilder ? (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={socialBusy !== null || !socialEnabled}
                onClick={() => {
                  const account = socialAccountInput.trim();
                  if (!account) {
                    setSocialError(
                      socialProvider === "youtube"
                        ? "Enter a YouTube channel URL first."
                        : socialProvider === "instagram"
                          ? "Enter an Instagram profile URL first."
                          : socialProvider === "tiktok"
                            ? "Enter a TikTok profile URL first."
                          : "Enter a username first."
                    );
                    return;
                  }
                  setSocialBusy("challenge");
                  setSocialError(null);
                  createSocialChallenge(socialProvider, account)
                    .then((proof) => {
                      setSocialChallengeProof(proof);
                      return reloadProofs();
                    })
                    .catch((e: any) => setSocialError(String(e?.message || "Failed to create social challenge.")))
                    .finally(() => setSocialBusy(null));
                }}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {!socialEnabled ? "Provider Not Enabled" : socialBusy === "challenge" ? "Creating…" : "Create Social Challenge"}
              </button>
              </div>
            ) : null}

            {showSocialBuilder && socialChallengeProof ? (
              <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-xs text-neutral-400">Post this exact text publicly:</div>
                <div className="mt-1 font-mono text-xs break-all">{String((socialChallengeProof.claimJson as any)?.challengeText || "")}</div>
                {socialProvider === "github" ? (
                  <div className="mt-2 text-xs text-neutral-500">For GitHub MVP, place this in a public Gist, then paste the Gist URL below.</div>
                ) : socialProvider === "youtube" ? (
                  <>
                    <div className="mt-2 text-xs text-neutral-500">
                      Place this exact text in your YouTube channel About section, then verify with your channel URL.
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Accepted channel URL formats:
                      <div className="font-mono mt-1">https://www.youtube.com/@handle</div>
                      <div className="font-mono">https://www.youtube.com/channel/&lt;id&gt;</div>
                    </div>
                    <div className="mt-1 text-xs text-amber-300">
                      Do NOT paste a YouTube post, video, or shorts link.
                    </div>
                  </>
                ) : socialProvider === "instagram" ? (
                  <div className="mt-2 text-xs text-neutral-500">
                    For Instagram MVP, place this text in your public profile bio, then paste your public profile URL below.
                  </div>
                ) : socialProvider === "tiktok" ? (
                  <div className="mt-2 text-xs text-neutral-500">
                    For TikTok MVP, place this text in your public profile bio, then paste your public profile URL below.
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-neutral-500">X verification is not enabled yet in this build.</div>
                )}
              </div>
            ) : null}

            {showSocialBuilder ? <input
              type="text"
              value={socialLocation}
              onChange={(e) => setSocialLocation(e.target.value)}
              placeholder={
                socialProvider === "github"
                  ? "https://gist.github.com/<user>/<id>"
                  : socialProvider === "youtube"
                    ? "Paste your YouTube channel URL (example: https://www.youtube.com/@yourhandle)"
                    : socialProvider === "instagram"
                      ? "Paste your Instagram profile URL (example: https://www.instagram.com/yourhandle/)"
                      : socialProvider === "tiktok"
                        ? "Paste your TikTok profile URL (example: https://www.tiktok.com/@yourhandle)"
                    : "https://x.com/<user>/status/<id>"
              }
              className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            /> : null}
            {showSocialBuilder ? <button
              type="button"
              disabled={socialBusy !== null || !socialEnabled}
              onClick={() => {
                const account = socialAccountInput.trim();
                const location = socialLocation.trim();
                if (!account || !location) {
                  setSocialError(
                    socialProvider === "youtube"
                      ? "Enter channel URL and public YouTube URL first."
                      : socialProvider === "instagram"
                        ? "Enter profile URL and public Instagram URL first."
                        : socialProvider === "tiktok"
                          ? "Enter profile URL and public TikTok URL first."
                      : "Enter username and public URL first."
                  );
                  return;
                }
                setSocialBusy("verify");
                setSocialError(null);
                verifySocialProof(socialProvider, account, location)
                  .then((proof) => {
                    setSocialChallengeProof(proof);
                    return reloadProofs();
                  })
                  .catch((e: any) => setSocialError(String(e?.message || "Failed to verify social proof.")))
                  .finally(() => setSocialBusy(null));
              }}
              className="mt-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {!socialEnabled ? "Provider Not Enabled" : socialBusy === "verify" ? "Verifying…" : "Verify Social Proof"}
            </button> : null}

            {socialError ? <div className="mt-2 text-xs text-amber-300">{socialError}</div> : null}
            <div className="mt-2">
              <div className="text-xs text-neutral-400">Social proof status</div>
              {proofsLoading ? <div className="mt-1 text-xs text-neutral-500">Loading proofs…</div> : null}
              {!proofsLoading && socialProofs.length === 0 ? <div className="mt-1 text-xs text-neutral-500">No social proofs yet.</div> : null}
              {!proofsLoading && socialProofs.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {socialProofs.map((p) => (
                    <div key={p.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium truncate">
                          {(() => {
                            const claim = (p.claimJson || {}) as any;
                            const subjectRaw = String(p.subject || "");
                            const idx = subjectRaw.indexOf(":");
                            const provider = String(claim?.provider || (idx > 0 ? subjectRaw.slice(0, idx) : "") || "").toLowerCase();
                            const account = String(claim?.account || claim?.username || (idx > 0 ? subjectRaw.slice(idx + 1) : subjectRaw) || "");
                            const providerLabel = provider === "github" ? "GitHub" : provider === "youtube" ? "YouTube" : provider === "instagram" ? "Instagram" : provider === "tiktok" ? "TikTok" : provider === "x" ? "X" : "Social";
                            const displayAccount = (provider === "instagram" || provider === "tiktok") && account && !account.startsWith("@") ? `@${account}` : account;
                            return `${providerLabel}: ${displayAccount}`;
                          })()}
                        </span>
                        {renderCompactStatus(p.status)}
                      </div>
                      {p.location ? <div className="mt-1 text-xs text-neutral-500 break-all">{p.location}</div> : null}
                      {p.failureReason ? <div className="mt-1 text-xs text-amber-300">{p.failureReason}</div> : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.status === "pending" ? (
                          <>
                            <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                              setProofActionBusyId(p.id); setProofActionError(null);
                              cancelProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to cancel proof."))).finally(()=>setProofActionBusyId(null));
                            }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Cancel</button>
                            <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                              setProofActionBusyId(p.id); setProofActionError(null);
                              deleteProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to delete proof."))).finally(()=>setProofActionBusyId(null));
                            }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Delete</button>
                          </>
                        ) : null}
                        {p.status === "verified" ? (
                          <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                            setProofActionBusyId(p.id); setProofActionError(null);
                            revokeProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to revoke proof."))).finally(()=>setProofActionBusyId(null));
                          }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Revoke</button>
                        ) : null}
                        {p.status === "failed" ? (
                          <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                            setProofActionBusyId(p.id); setProofActionError(null);
                            deleteProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to delete proof."))).finally(()=>setProofActionBusyId(null));
                          }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Delete</button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 border-t border-neutral-800 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-neutral-300">Advanced</div>
              <button
                type="button"
                className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
                onClick={() => setShowNostrBuilder((v) => !v)}
              >
                {showNostrBuilder ? "Hide challenge builder" : "Add / Verify Nostr"}
              </button>
            </div>
            {showNostrBuilder ? (
              <div className="mt-2 space-y-2">
              <input
                type="text"
                value={nostrPubkey}
                onChange={(e) => setNostrPubkey(e.target.value)}
                placeholder="npub1... or 64-char hex pubkey"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              />
              <button
                type="button"
                disabled={nostrBusy !== null}
                onClick={() => {
                  const pubkey = nostrPubkey.trim();
                  if (!pubkey) {
                    setNostrError("Enter a Nostr pubkey first.");
                    return;
                  }
                  setNostrBusy("challenge");
                  setNostrError(null);
                  createNostrChallenge(pubkey)
                    .then((proof) => {
                      setNostrChallengeProof(proof);
                      return reloadProofs();
                    })
                    .catch((e: any) => setNostrError(String(e?.message || "Failed to create Nostr challenge.")))
                    .finally(() => setNostrBusy(null));
                }}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {nostrBusy === "challenge" ? "Creating…" : "Create Nostr Challenge"}
              </button>
              </div>
            ) : null}

            {showNostrBuilder && nostrChallengeProof ? (
              <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                <div className="text-xs text-neutral-400">Sign this challenge with your Nostr key (event content):</div>
                <div className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">{String((nostrChallengeProof.claimJson as any)?.challengeText || "")}</div>
                <div className="mt-2 text-xs text-neutral-500">Paste the full signed Nostr event JSON below.</div>
              </div>
            ) : null}

            {showNostrBuilder ? <textarea
              value={nostrSignedEvent}
              onChange={(e) => setNostrSignedEvent(e.target.value)}
              rows={5}
              placeholder='{"kind":1,"content":"...challenge...","pubkey":"...","sig":"...","id":"...","created_at":...,"tags":[]}'
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            /> : null}
            {showNostrBuilder ? <button
              type="button"
              disabled={nostrBusy !== null}
              onClick={() => {
                const pubkey = nostrPubkey.trim();
                if (!pubkey || !nostrSignedEvent.trim()) {
                  setNostrError("Provide pubkey and signed event JSON.");
                  return;
                }
                let parsed: unknown;
                try {
                  parsed = JSON.parse(nostrSignedEvent);
                } catch {
                  setNostrError("Signed event must be valid JSON.");
                  return;
                }
                setNostrBusy("verify");
                setNostrError(null);
                verifyNostrProof(pubkey, parsed)
                  .then((proof) => {
                    setNostrChallengeProof(proof);
                    return reloadProofs();
                  })
                  .catch((e: any) => setNostrError(String(e?.message || "Failed to verify Nostr proof.")))
                  .finally(() => setNostrBusy(null));
              }}
              className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {nostrBusy === "verify" ? "Verifying…" : "Verify Nostr Proof"}
            </button> : null}

            {nostrError ? <div className="mt-2 text-xs text-amber-300">{nostrError}</div> : null}
            <div className="mt-2">
              <div className="text-xs text-neutral-400">Nostr proof status</div>
              {proofsLoading ? <div className="mt-1 text-xs text-neutral-500">Loading proofs…</div> : null}
              {!proofsLoading && nostrProofs.length === 0 ? <div className="mt-1 text-xs text-neutral-500">No Nostr proofs yet.</div> : null}
              {!proofsLoading && nostrProofs.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {nostrProofs.map((p) => (
                    <div key={p.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium truncate">{p.subject}</span>
                        {renderCompactStatus(p.status)}
                      </div>
                      {p.location ? <div className="mt-1 text-xs text-neutral-500 break-all">{p.location}</div> : null}
                      {p.failureReason ? <div className="mt-1 text-xs text-amber-300">{p.failureReason}</div> : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.status === "pending" ? (
                          <>
                            <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                              setProofActionBusyId(p.id); setProofActionError(null);
                              cancelProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to cancel proof."))).finally(()=>setProofActionBusyId(null));
                            }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Cancel</button>
                            <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                              setProofActionBusyId(p.id); setProofActionError(null);
                              deleteProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to delete proof."))).finally(()=>setProofActionBusyId(null));
                            }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Delete</button>
                          </>
                        ) : null}
                        {p.status === "verified" ? (
                          <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                            setProofActionBusyId(p.id); setProofActionError(null);
                            revokeProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to revoke proof."))).finally(()=>setProofActionBusyId(null));
                          }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Revoke</button>
                        ) : null}
                        {p.status === "failed" ? (
                          <button type="button" disabled={proofActionBusyId === p.id} onClick={() => {
                            setProofActionBusyId(p.id); setProofActionError(null);
                            deleteProof(p.id).then(() => reloadProofs()).catch((e:any)=>setProofActionError(String(e?.message||"Failed to delete proof."))).finally(()=>setProofActionBusyId(null));
                          }} className="rounded-lg border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900 disabled:opacity-60">Delete</button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {proofActionError ? <div className="mt-3 text-xs text-amber-300">{proofActionError}</div> : null}
        </>
      ) : null}
    </div>
  );
}
