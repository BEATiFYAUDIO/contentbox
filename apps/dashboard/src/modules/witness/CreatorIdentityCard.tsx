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
  const { state, identity, loading, creating, error, createIdentity } = witness;

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
      <div className="text-sm font-medium">Creator Identity</div>
      <div className="text-xs text-neutral-500">This keypair is the root signer for creator proofs on this device.</div>

      <div className="mt-3">
        {loading ? <div className="text-xs text-neutral-400">Loading creator identity…</div> : null}

        {!loading && state === "noIdentity" ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                createIdentity().catch(() => {});
              }}
              disabled={creating}
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
              disabled={creating}
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
