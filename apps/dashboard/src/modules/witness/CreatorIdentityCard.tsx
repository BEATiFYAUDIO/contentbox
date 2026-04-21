import { useMemo } from "react";
import type { WitnessIdentityHookResult } from "./useWitnessIdentity";

function shortFingerprint(fp: string): string {
  if (!fp) return "";
  if (fp.length <= 16) return fp;
  return `${fp.slice(0, 8)}...${fp.slice(-8)}`;
}

type Props = {
  witness: WitnessIdentityHookResult;
};

export default function CreatorIdentityCard({ witness }: Props) {
  const { state, identity, loading, creating, recovering, error, createIdentity, recoverIdentity } = witness;
  const isBrowser = typeof window !== "undefined";
  const isLocalDev = isBrowser && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  const is4000Surface = isLocalDev && window.location.port === "4000";
  const keyOpsBlockedOnThisSurface = isLocalDev && window.location.port === "5173";

  const createdText = useMemo(() => {
    if (!identity?.createdAt) return null;
    try {
      return new Date(identity.createdAt).toLocaleString();
    } catch {
      return null;
    }
  }, [identity?.createdAt]);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">Creator Identity</div>
        {!loading && state === "registeredMissingLocalKey" && is4000Surface ? (
          <span className="text-[10px] uppercase tracking-wide rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-300">
            Local key missing
          </span>
        ) : null}
      </div>
      <div className="text-xs text-neutral-500">This keypair is the root signer for creator proofs on this device.</div>
      {keyOpsBlockedOnThisSurface ? (
        <div className="mt-2 text-xs rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-amber-200">
          Key creation/registration is disabled on dev preview (`:5173`). Use the integrated app on `http://localhost:4000/profile`.
        </div>
      ) : null}

      <div className="mt-3">
        {loading ? <div className="text-xs text-neutral-400">Loading creator identity…</div> : null}

        {!loading && state === "noIdentity" ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                createIdentity().catch(() => {});
              }}
              disabled={creating || keyOpsBlockedOnThisSurface}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creating ? "Creating…" : "Create Verification Key"}
            </button>
            <div className="text-xs text-neutral-500">Private key is generated and stored on this device only.</div>
          </div>
        ) : null}

        {!loading && state === "ready" && identity ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-emerald-300">Verification Key Created</div>
            <div className="text-xs text-neutral-400">Public Fingerprint</div>
            <div className="font-mono text-sm text-neutral-100 break-all">{shortFingerprint(identity.fingerprint)}</div>
            <div className="text-xs text-neutral-500">This device can sign creator proofs.</div>
            <div className="text-xs text-neutral-500">Your private key stays on this device.</div>
            {createdText ? <div className="text-xs text-neutral-500">Created: {createdText}</div> : null}
          </div>
        ) : null}

        {!loading && state === "registeredMissingLocalKey" && identity ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-amber-300">Creator Identity Registered</div>
            <div className="text-xs text-neutral-400">Public Fingerprint</div>
            <div className="font-mono text-sm text-neutral-100 break-all">{shortFingerprint(identity.fingerprint)}</div>
            <div className="text-xs text-neutral-500">This account has a registered creator identity.</div>
            <div className="text-xs text-amber-300">This device does not hold the matching signing key.</div>
            <button
              type="button"
              onClick={() => {
                recoverIdentity().catch(() => {});
              }}
              disabled={recovering || keyOpsBlockedOnThisSurface}
              className="text-sm rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200 hover:bg-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {recovering ? "Recovering…" : "Recover Identity On This Device"}
            </button>
            <div className="text-xs text-neutral-500">This rotates your creator key to this device and revokes the previous active key.</div>
          </div>
        ) : null}

        {!loading && state === "localKeyUnregistered" ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-amber-300">Local Key Found (Unregistered)</div>
            <div className="text-xs text-neutral-500">A local signing key exists on this device, but no creator identity is registered on the server.</div>
            <button
              type="button"
              onClick={() => {
                createIdentity().catch(() => {});
              }}
              disabled={creating || keyOpsBlockedOnThisSurface}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creating ? "Registering…" : "Register Local Key"}
            </button>
          </div>
        ) : null}

        {!loading && state === "error" && error ? <div className="mt-2 text-xs text-amber-300">{error}</div> : null}
      </div>
    </div>
  );
}
