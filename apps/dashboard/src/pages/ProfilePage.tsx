import { useEffect, useState } from "react";
import { api, getApiBase } from "../lib/api";
import type { IdentityDetail } from "../lib/identity";
import { modeLabel } from "../lib/nodeMode";
import { PAYOUT_DESTINATIONS_LABEL } from "../lib/terminology";
import AuditPanel from "../components/AuditPanel";

type Me = {
  id: string;
  email: string;
  displayName: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
};

type ProfilePageProps = {
  me: Me | null;
  setMe: (next: Me | null) => void;
  identityDetail: IdentityDetail | null;
  onOpenParticipations: () => void;
  onIdentityRefresh: () => void;
  onForceLogin: (message: string) => void;
};

function extractBeatifyHandle(bio: string | null | undefined): string {
  if (!bio) return "";
  const m = bio.match(/(?:^|\n)\s*beatify\s*:\s*([a-z0-9._-]+)/i);
  return m ? m[1] : "";
}

function applyBeatifyHandleToBio(bio: string | null | undefined, handle: string): string | null {
  const base = (bio || "").replace(/\s*beatify\s*:\s*[a-z0-9._-]+\s*/gi, "").trim();
  const cleanHandle = (handle || "").trim();
  if (!cleanHandle) return base || null;
  const line = `beatify:${cleanHandle}`;
  return base ? `${base}\n${line}` : line;
}

export default function ProfilePage({ me, setMe, identityDetail, onOpenParticipations, onIdentityRefresh, onForceLogin }: ProfilePageProps) {
  const [importUrl, setImportUrl] = useState<string>("");
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [beatifyHandle, setBeatifyHandle] = useState<string>("");
  const [payoutSettings, setPayoutSettings] = useState<{ lightningAddress: string; lnurl: string; btcAddress: string } | null>(null);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
  const [modeInfo, setModeInfo] = useState<{ nodeMode: "basic" | "advanced" | "lan"; source: string; restartRequired: boolean } | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeMsg, setModeMsg] = useState<string | null>(null);
  const [showRestart, setShowRestart] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [pendingMode, setPendingMode] = useState<"basic" | "advanced" | "lan" | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectMsg, setReconnectMsg] = useState<string | null>(null);

  useEffect(() => {
    setBeatifyHandle(extractBeatifyHandle(me?.bio));
  }, [me?.bio]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api<{ nodeMode: "basic" | "advanced" | "lan"; source: string; restartRequired: boolean }>(`/api/node/mode`, "GET");
        if (!alive) return;
        setModeInfo(res);
      } catch {
        if (!alive) return;
        setModeInfo(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const nodeMode = identityDetail?.nodeMode || "basic";
  const ownerEmail = identityDetail?.ownerEmail || null;
  const nodeBadge = nodeMode === "advanced" ? "Owner account" : nodeMode === "lan" ? "Shared node account" : "Trial account";
  const beatifyStatus = beatifyHandle ? "UNVERIFIED" : "UNLINKED";

  const modeLocked = modeInfo?.source === "env";
  const restartCommand = "npm run dev";
  const apiBase = getApiBase();

  const handleRestartNow = async () => {
    setReconnectMsg(null);
    setReconnecting(true);
    try {
      await api(`/api/node/restart`, "POST");
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("RESTART_NOT_SUPERVISED") || msg.includes("409")) {
        setReconnectMsg("Auto-restart is not available. Please restart manually.");
      } else {
        setReconnectMsg("Couldn't request restart. Please restart manually.");
      }
      setReconnecting(false);
      return;
    }
    const deadline = Date.now() + 30000;
    let ok = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${apiBase}/health`, { method: "GET" });
        if (res.ok) {
          ok = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ok) {
      setReconnectMsg("Couldn't reconnect automatically. Please restart the app manually.");
      setReconnecting(false);
      return;
    }
    try {
      await api(`/api/identity`, "GET");
      onIdentityRefresh();
      setReconnecting(false);
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.includes("SINGLE_IDENTITY_NODE") || msg.includes("401")) {
        onForceLogin("Restarted in Advanced mode. Sign in as owner.");
        return;
      }
      setReconnectMsg("Restarted, but couldn't verify session. Please sign in again.");
      onForceLogin("Restarted. Please sign in again.");
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
      <div className="text-lg font-semibold">Profile</div>
      <div className="text-sm text-neutral-400 mt-1">Node account, public profile, and optional external claims.</div>

      <div className="mt-5 space-y-4">
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Node Mode</div>
              <div className="text-xs text-neutral-500">Choose how this node behaves. Storage stays the same.</div>
            </div>
            <div className="text-xs rounded-full border border-neutral-800 px-2 py-1 text-neutral-300">
              {modeInfo?.nodeMode ? modeLabel(modeInfo.nodeMode) : "Unknown"}
            </div>
          </div>

          {modeLocked ? (
            <div className="mt-2 text-xs text-amber-300">Mode is locked by server environment settings.</div>
          ) : null}

          <div className="mt-3 grid gap-2 text-sm">
            {(["basic", "advanced", "lan"] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="node-mode"
                  value={opt}
                  disabled={modeLocked || modeBusy}
                  checked={modeInfo?.nodeMode === opt}
                  onChange={async () => {
                    if (!modeInfo) return;
                    if (opt === modeInfo.nodeMode) return;
                    if (opt === "advanced") {
                      const ok = window.confirm(
                        "Advanced is single identity. If another local account exists, only the owner can log in."
                      );
                      if (!ok) return;
                    }
                    setModeBusy(true);
                    setModeMsg(null);
                    try {
                      const res = await api<{ nodeMode: "basic" | "advanced" | "lan"; source: string; restartRequired: boolean }>(
                        `/api/node/mode`,
                        "POST",
                        { nodeMode: opt }
                      );
                      setModeInfo(res);
                      setShowRestart(Boolean(res?.restartRequired));
                      setModeMsg("Saved. Restart required.");
                      setPendingMode(opt);
                      setShowRestartConfirm(true);
                      onIdentityRefresh();
                    } catch (e: any) {
                      setModeMsg(e?.message || "Failed to update node mode.");
                    } finally {
                      setModeBusy(false);
                    }
                  }}
                />
                <span>
                  {opt === "basic"
                    ? "Basic (Trial)"
                    : opt === "advanced"
                      ? "Advanced (Sovereign Node — single identity)"
                      : "LAN (Studio Node — multi-user)"}
                </span>
              </label>
            ))}
          </div>

          {modeInfo?.source ? (
            <div className="mt-2 text-xs text-neutral-500">Source: {modeInfo.source}</div>
          ) : null}

          {modeMsg ? <div className="mt-2 text-xs text-amber-300">{modeMsg}</div> : null}

          {showRestart ? (
            <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[160px]">Restart required to apply mode change.</div>
              <button
                type="button"
                onClick={handleRestartNow}
                className="text-xs rounded-lg border border-amber-800 px-2 py-1 hover:bg-amber-900/30 font-medium"
              >
                Restart now
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(restartCommand);
                    setModeMsg("Restart command copied.");
                  } catch {
                    setModeMsg("Copy failed. Use: npm run dev");
                  }
                }}
                className="text-xs rounded-lg border border-amber-800 px-2 py-1 hover:bg-amber-900/30"
              >
                Copy restart command
              </button>
              <button
                type="button"
                onClick={() => setShowRestart(false)}
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                I’ll restart later
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Node Account (Local)</div>
              <div className="text-xs text-neutral-500">This is who controls this node.</div>
            </div>
            <div className="text-xs rounded-full border border-neutral-800 px-2 py-1 text-neutral-300">
              {nodeBadge}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div>
              <div className="text-xs text-neutral-400">User ID</div>
              <div className="text-sm text-neutral-100 break-all">{me?.id || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-400">Email</div>
              <div className="text-sm text-neutral-100 break-all">{me?.email || "—"}</div>
            </div>
            {ownerEmail ? (
              <div>
                <div className="text-xs text-neutral-400">Owner email</div>
                <div className="text-sm text-neutral-100 break-all">{ownerEmail}</div>
              </div>
            ) : null}
            <div>
              <button
                onClick={onOpenParticipations}
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Splits I’m in
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-sm font-medium">Public Profile (Presentation)</div>
          <div className="text-xs text-neutral-500">Shown on share pages and proof bundles (does not change ownership).</div>

          <div className="mt-3 space-y-3">
            <div>
              <div className="text-sm">Display name</div>
              <div className="flex gap-2">
                <input
                  value={me?.displayName || ""}
                  onChange={(e) => setMe(me ? { ...me, displayName: e.target.value } : me)}
                  className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                />
                <button
                  onClick={async () => {
                    try {
                      const nextBio = applyBeatifyHandleToBio(me?.bio, beatifyHandle);
                      await api(`/me`, "PATCH", { displayName: me?.displayName, bio: nextBio, avatarUrl: me?.avatarUrl ?? null });
                      const m = await api<any>(`/me`, "GET");
                      setMe(m);
                    } catch {
                      // ignore for now
                    }
                  }}
                  className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                >
                  Save
                </button>
              </div>
            </div>

            <div>
              <div className="text-sm">Bio</div>
              <textarea
                value={me?.bio || ""}
                onChange={(e) => setMe(me ? { ...me, bio: e.target.value } : me)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 mt-1"
                rows={3}
              />
            </div>

            <div>
              <div className="text-sm">Avatar URL</div>
              <div className="flex gap-2 items-center mt-1">
                <input
                  value={me?.avatarUrl || ""}
                  onChange={(e) => setMe(me ? { ...me, avatarUrl: e.target.value } : me)}
                  className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                />
                {me?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.avatarUrl} alt="avatar" className="w-12 h-12 rounded-full object-cover" />
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">External Claims (Optional)</div>
              <div className="text-xs text-neutral-500">Optional: linking Beatify can add verification to proof bundles and improve trust.</div>
            </div>
            <div className="text-xs rounded-full border border-neutral-800 px-2 py-1 text-neutral-300">{beatifyStatus}</div>
          </div>

          <div className="mt-3">
            <div className="text-sm">Beatify handle (optional)</div>
            <div className="flex gap-2 items-center mt-1">
              <input
                value={beatifyHandle}
                onChange={(e) => setBeatifyHandle(e.target.value)}
                placeholder="yourhandle"
                className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
              />
              {beatifyHandle ? (
                <button
                  type="button"
                  onClick={() => window.open(`https://www.beatify.me/${encodeURIComponent(beatifyHandle)}`, "_blank", "noopener,noreferrer")}
                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  Open Beatify profile
                </button>
              ) : null}
              <button
                type="button"
                disabled
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 text-neutral-500 cursor-not-allowed"
              >
                Verify with Beatify (optional)
              </button>
            </div>
            <div className="text-xs text-neutral-500 mt-1">Beatify is optional and not required for Advanced mode.</div>
          </div>

          <div className="mt-4">
            <div className="text-sm">Import a public profile URL (optional)</div>
            <div className="text-xs text-neutral-500">Use a Beatify or other public profile to prefill display name, bio, and avatar.</div>
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <input
                placeholder="https://... or handle.eth"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
              />
              <button
                onClick={async () => {
                  const url = importUrl?.trim();
                  if (!url) return;
                  setImportLoading(true);
                  setImportPreview(null);
                  try {
                    const preview = await api<any>(`/external/profile/import`, "POST", { url });
                    setImportPreview(preview || null);
                  } catch (e: any) {
                    setImportPreview({ error: e?.message || String(e) });
                  } finally {
                    setImportLoading(false);
                  }
                }}
                className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 whitespace-nowrap"
              >
                {importLoading ? "Importing…" : "Import"}
              </button>
            </div>

            {importPreview ? (
              <div className="mt-3 rounded-md border border-neutral-800 p-3 bg-neutral-900/10">
                {importPreview.error ? (
                  <div className="text-sm text-red-400">Error: {importPreview.error}</div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Preview</div>
                    <div className="text-sm">Name: {importPreview.name || "(none)"}</div>
                    <div className="text-sm">Description: {importPreview.description || "(none)"}</div>
                    {importPreview.image ? (
                      <img src={importPreview.image} alt="preview" className="w-32 h-32 object-cover rounded mt-1" />
                    ) : null}
                    <div className="text-sm">Payouts: {JSON.stringify(importPreview.payouts || {})}</div>

                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={async () => {
                          const p = importPreview;
                          if (!p) return;
                          try {
                            await api(`/me`, "PATCH", { displayName: p.name || null, bio: p.description || null, avatarUrl: p.image || null });
                            if (p.payouts && p.payouts.lightning) {
                              try {
                                const methods = await api<any[]>(`/payout-methods`, "GET");
                                const m = methods.find((x) => x.code === "lightning_address");
                                if (m) {
                                  await api(`/identities`, "POST", { payoutMethodId: m.id, value: p.payouts.lightning, label: `Imported from profile` });
                                }
                              } catch {
                                // ignore
                              }
                            }
                            const mm = await api<any>(`/me`, "GET");
                            setMe(mm);
                            setImportPreview(null);
                            setImportUrl("");
                          } catch {
                            // ignore
                          }
                        }}
                        className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                      >
                        Apply to my profile
                      </button>

                      <button
                        onClick={() => {
                          setImportPreview(null);
                        }}
                        className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-sm font-medium">Payments</div>
          <div className="text-xs text-neutral-500">Where should earnings be sent?</div>
          <div className="mt-3 space-y-2">
            <input
              placeholder="Lightning Address (name@domain.com)"
              value={payoutSettings?.lightningAddress || ""}
              onChange={(e) => setPayoutSettings((s) => ({ lightningAddress: e.target.value, lnurl: s?.lnurl || "", btcAddress: s?.btcAddress || "" }))}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
            />
            <input
              placeholder="LNURL (optional)"
              value={payoutSettings?.lnurl || ""}
              onChange={(e) => setPayoutSettings((s) => ({ lightningAddress: s?.lightningAddress || "", lnurl: e.target.value, btcAddress: s?.btcAddress || "" }))}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
            />
            <input
              placeholder="BTC Address (optional)"
              value={payoutSettings?.btcAddress || ""}
              onChange={(e) => setPayoutSettings((s) => ({ lightningAddress: s?.lightningAddress || "", lnurl: s?.lnurl || "", btcAddress: e.target.value }))}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
            />
            <button
              onClick={async () => {
                try {
                  setPayoutMsg(null);
                  await api(`/api/me/payout`, "POST", {
                    lightningAddress: payoutSettings?.lightningAddress || "",
                    lnurl: payoutSettings?.lnurl || "",
                    btcAddress: payoutSettings?.btcAddress || ""
                  });
                  setPayoutMsg("Saved.");
                } catch (e: any) {
                  setPayoutMsg(e?.message || "Failed to save payout settings.");
                }
              }}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
            >
              Save payout settings
            </button>
            {payoutMsg ? <div className="text-xs text-amber-300">{payoutMsg}</div> : null}
            <div className="text-xs text-neutral-500">Mode: {modeLabel(nodeMode)} • {PAYOUT_DESTINATIONS_LABEL}</div>
          </div>
        </div>

        <AuditPanel scopeType="identity" title="Audit" exportName="identity-audit.json" />
      </div>

      {showRestartConfirm && pendingMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-sm font-medium">Switching node mode requires restart.</div>
            <div className="text-xs text-neutral-400 mt-1">Restart now?</div>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowRestartConfirm(false);
                  setPendingMode(null);
                }}
                className="text-xs rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowRestartConfirm(false);
                  await handleRestartNow();
                  setPendingMode(null);
                }}
                className="text-xs rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-1 hover:bg-amber-900/30"
              >
                Restart now
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reconnecting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-sm font-medium">Reconnecting…</div>
            <div className="text-xs text-neutral-400 mt-1">Waiting for the node to restart.</div>
            {reconnectMsg ? (
              <div className="mt-3 text-xs text-amber-300">{reconnectMsg}</div>
            ) : null}
            {reconnectMsg ? (
              <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                Manual restart:\n                <div className="mt-2 text-[11px] text-neutral-200">API: Ctrl+C then {restartCommand}</div>
                <div className="mt-1 text-[11px] text-neutral-200">Dashboard: npm run dev</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
