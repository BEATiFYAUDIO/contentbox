import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { signWithLocalWitnessKey, type WitnessIdentityHookResult } from "./useWitnessIdentity";

type Connection = { id: string; publicKey: string; connectedAt: string };
type Challenge = { challengeId: string; authorizationText: string; expiresAt: string };

export default function ConnectedAppsCard({ witness }: { witness: WitnessIdentityHookResult }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const result = await api<{ connections: Connection[] }>("/api/profile/connected-apps/certifyd-ar");
    setConnections(result.connections || []);
  }, []);

  useEffect(() => {
    if (witness.state === "ready" || witness.state === "registeredMissingLocalKey") {
      refresh().catch(() => setError("Could not load connected apps."));
    }
  }, [refresh, witness.state]);

  const startConnect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<Challenge>("/api/profile/connected-apps/certifyd-ar/challenge", "POST", { publicKey: code.trim() });
      setChallenge(result);
    } catch {
      setError("That connection code could not be used. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!challenge) return;
    setBusy(true);
    setError("");
    try {
      const signed = await signWithLocalWitnessKey(challenge.authorizationText);
      if (signed.publicKey !== witness.identity?.publicKey) throw new Error("LOCAL_KEY_MISMATCH");
      await api("/api/profile/connected-apps/certifyd-ar/connect", "POST", {
        challengeId: challenge.challengeId, signature: signed.signature
      });
      setChallenge(null);
      setCode("");
      await refresh();
    } catch {
      setError("Connection failed. Start again or check that this browser has your creator identity.");
      setChallenge(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove Certifyd AR access for this device?")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/profile/connected-apps/certifyd-ar/${encodeURIComponent(id)}`, "DELETE");
      await refresh();
    } catch {
      setError("Could not remove access. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
      <h3 className="text-sm font-medium">Connected apps</h3>
      <div className="mt-3 text-sm font-medium">Certifyd AR</div>
      {connections.length === 0 ? <p className="mt-1 text-xs text-neutral-400">Not connected</p> : null}
      {connections.map((connection) => (
        <div key={connection.id} className="mt-3 rounded-lg border border-neutral-800 p-3">
          <div className="text-sm text-emerald-300">Connected</div>
          <div className="mt-1 text-xs text-neutral-300">This device · {new Date(connection.connectedAt).toLocaleDateString()}</div>
          <div className="mt-1 text-xs text-neutral-400">Can publish your Certifyd AR experiences</div>
          <button type="button" disabled={busy} onClick={() => remove(connection.id)} className="mt-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900 disabled:opacity-60">Remove access</button>
        </div>
      ))}
      {witness.state === "ready" ? (
        <div className="mt-4 space-y-2">
          <label htmlFor="certifyd-ar-code" className="block text-xs text-neutral-400">Connection code from Certifyd AR</label>
          <input id="certifyd-ar-code" value={code} onChange={(event) => { setCode(event.target.value); setChallenge(null); }} autoComplete="off" spellCheck={false} className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm" />
          {!challenge ? (
            <button type="button" disabled={busy || !code.trim()} onClick={startConnect} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60">Connect Certifyd AR</button>
          ) : (
            <div className="rounded-lg border border-neutral-700 p-3">
              <div className="text-sm font-medium">Connect Certifyd AR?</div>
              <p className="mt-1 text-xs text-neutral-400">This device will be able to publish your Certifyd AR experiences. You can remove access here later.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={approve} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60">Approve connection</button>
                <button type="button" disabled={busy} onClick={() => setChallenge(null)} className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-neutral-900">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : witness.state === "registeredMissingLocalKey" ? (
        <p className="mt-3 text-xs text-neutral-400">Open this profile on the device that holds your creator identity to connect Certifyd AR.</p>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
    </section>
  );
}
