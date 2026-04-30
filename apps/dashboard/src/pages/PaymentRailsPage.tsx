import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type Rail = {
  id: string;
  type: string;
  label: string;
  status: string;
  endpoint: string | null;
  details: string | null;
  hint?: string | null;
  lastCheckedAt: string;
};

type PaymentRailsPageProps = {
  refreshSignal?: number;
  onOpenLightningConfig?: () => void;
};

type NodeModeSnapshot = {
  commerceAuthorityAvailable?: boolean;
};

type LightningAdminConfig = {
  configured: boolean;
  restUrl: string | null;
  network: string | null;
  lastTestedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  runtime?: {
    connected?: boolean;
    canReceive?: boolean;
    canSend?: boolean;
  };
};

type LightningReadiness = {
  ok: true;
  configured: boolean;
  nodeReachable: boolean;
  wallet: { syncedToChain: boolean; syncedToGraph: boolean; blockHeight?: number };
  channels: { count: number };
  receiveReady: boolean;
  hints: string[];
};

type LightningBalances = {
  wallet: {
    confirmedSats: number;
    unconfirmedSats: number;
    totalSats: number;
  };
  channels: {
    openCount: number;
    pendingOpenCount: number;
    pendingCloseCount: number;
  };
  liquidity: {
    outboundSats: number;
    inboundSats: number;
  };
};

type LightningChannelRow = {
  chanId?: string | null;
  remotePubkey?: string | null;
  alias?: string | null;
  active?: boolean;
  localBalanceSats?: number;
  remoteBalanceSats?: number;
  capacitySats?: number;
};

type LightningChannelsResponse = {
  channels?: LightningChannelRow[];
};

type PeerSuggestion = {
  pubkey: string;
  alias?: string;
  hostPort: string;
  score: number;
  reachableNow: boolean;
};

type PeerSuggestionsResponse =
  | { status: "ok"; peers: PeerSuggestion[]; meta?: { cachedGraph?: boolean; probed?: number } }
  | { status: "error"; error?: string; reason?: string };

type ChannelOpenResponse =
  | { status: "success"; channelId: string; transactionFee: number; estimatedConfirmations: number; message: string }
  | { status: "error"; error: string; reason?: string };

const SHOW_LNURL = (import.meta as any).env?.VITE_SHOW_LNURL_RAILS === "1";

function parseApiErrorPayload(err: unknown): { error?: string; reason?: string } | null {
  const msg = String((err as any)?.message || "");
  const marker = "::";
  const idx = msg.lastIndexOf(marker);
  if (idx < 0) return null;
  const tail = msg.slice(idx + marker.length).trim();
  if (!tail.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(tail);
    if (!parsed || typeof parsed !== "object") return null;
    return { error: (parsed as any).error, reason: (parsed as any).reason };
  } catch {
    return null;
  }
}

function peerSuggestionNotice(error?: string, reason?: string) {
  if (error === "NOT_READY" && reason === "GRAPH_FETCH_TIMEOUT") return "Graph fetch timed out. Try Refresh, or use manual peer.";
  if (error === "NOT_READY") return "Peer graph temporarily unavailable. Use manual peer.";
  if (error === "NOT_CONFIGURED") return "Configure Lightning first.";
  return "Peer suggestions unavailable right now.";
}

export default function PaymentRailsPage({ refreshSignal, onOpenLightningConfig }: PaymentRailsPageProps) {
  const [rails, setRails] = useState<Rail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightningAllowed, setLightningAllowed] = useState(false);
  const [lightningAdmin, setLightningAdmin] = useState<LightningAdminConfig | null>(null);
  const [lightningReadiness, setLightningReadiness] = useState<LightningReadiness | null>(null);
  const [lightningBalances, setLightningBalances] = useState<LightningBalances | null>(null);
  const [lightningChannels, setLightningChannels] = useState<LightningChannelRow[]>([]);
  const [peerSuggestions, setPeerSuggestions] = useState<PeerSuggestion[]>([]);
  const [peerSuggestionsBusy, setPeerSuggestionsBusy] = useState(false);
  const [peerSuggestionsNoticeText, setPeerSuggestionsNoticeText] = useState<string | null>(null);
  const [peerSuggestionsUpdatedAt, setPeerSuggestionsUpdatedAt] = useState<string | null>(null);
  const [peerRefreshElapsedMs, setPeerRefreshElapsedMs] = useState(0);
  const [peerRefreshResultText, setPeerRefreshResultText] = useState<string | null>(null);
  const [peerRefreshResultTone, setPeerRefreshResultTone] = useState<"neutral" | "ok" | "warn">("neutral");
  const [selectedPeerId, setSelectedPeerId] = useState<string>("0");
  const [customPeerPubKey, setCustomPeerPubKey] = useState("");
  const [customPeerHost, setCustomPeerHost] = useState("");
  const [channelPreset, setChannelPreset] = useState<"100k" | "250k" | "500k" | "custom">("250k");
  const [channelCustomSats, setChannelCustomSats] = useState("100000");
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelResult, setChannelResult] = useState<string | null>(null);
  const [showAllPeers, setShowAllPeers] = useState(false);
  const [lightningError, setLightningError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const peerRefreshRequestRef = useRef(0);
  const peerRefreshStartedAtRef = useRef<number | null>(null);

  const channelCapacitySats = (() => {
    if (channelPreset === "100k") return 100_000;
    if (channelPreset === "250k") return 250_000;
    if (channelPreset === "500k") return 500_000;
    const n = Math.floor(Number(channelCustomSats || 0));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  })();

  const selectedPeer =
    Number.isInteger(Number(selectedPeerId)) && Number(selectedPeerId) >= 0
      ? peerSuggestions[Number(selectedPeerId)] || null
      : null;
  const usingCustomPeer = selectedPeerId === "custom";

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [res, modeSnapshot] = await Promise.all([
          api<Rail[]>("/finance/payment-rails"),
          api<NodeModeSnapshot>("/api/node/mode", "GET").catch(() => ({} as NodeModeSnapshot))
        ]);
        if (!active) return;
        setRails(res);
        const allowed = Boolean(modeSnapshot?.commerceAuthorityAvailable);
        setLightningAllowed(allowed);
        if (allowed) {
          const [adminRes, readinessRes, balancesRes] = await Promise.allSettled([
            api<LightningAdminConfig>("/api/admin/lightning", "GET"),
            api<LightningReadiness>("/api/admin/lightning/readiness", "GET"),
            api<LightningBalances>("/api/admin/lightning/balances", "GET")
          ]);
          if (!active) return;
          setLightningAdmin(adminRes.status === "fulfilled" ? adminRes.value || null : null);
          setLightningReadiness(readinessRes.status === "fulfilled" ? readinessRes.value || null : null);
          setLightningBalances(balancesRes.status === "fulfilled" ? balancesRes.value || null : null);
          setLightningError(
            adminRes.status === "rejected" && readinessRes.status === "rejected" && balancesRes.status === "rejected"
              ? "Lightning runtime unavailable."
              : null
          );
          const [channelsRes, peersRes] = await Promise.allSettled([
            api<LightningChannelsResponse>("/api/admin/lightning/channels", "GET"),
            api<PeerSuggestionsResponse>("/api/admin/lightning/peers/suggestions?limit=20", "GET")
          ]);
          if (!active) return;
          setLightningChannels(
            channelsRes.status === "fulfilled" && Array.isArray(channelsRes.value?.channels)
              ? channelsRes.value.channels
              : []
          );
          if (peersRes.status === "fulfilled" && peersRes.value?.status === "ok" && Array.isArray(peersRes.value.peers)) {
            setPeerSuggestions(peersRes.value.peers);
            setPeerSuggestionsNoticeText(null);
            setPeerSuggestionsUpdatedAt(new Date().toLocaleTimeString());
          } else if (peersRes.status === "fulfilled") {
            setPeerSuggestions([]);
            const errRes = peersRes.value as Extract<PeerSuggestionsResponse, { status: "error" }>;
            setPeerSuggestionsNoticeText(peerSuggestionNotice(errRes?.error, errRes?.reason));
          } else {
            const payload = parseApiErrorPayload(peersRes.reason);
            setPeerSuggestions([]);
            setPeerSuggestionsNoticeText(peerSuggestionNotice(payload?.error, payload?.reason));
          }
        } else {
          setLightningAdmin(null);
          setLightningReadiness(null);
          setLightningBalances(null);
          setLightningChannels([]);
          setPeerSuggestions([]);
          setPeerSuggestionsNoticeText(null);
          setLightningError(null);
        }
      } catch (e: any) {
        if (!active) return;
        setError(e.message || "Failed to load payment rails.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal, retryTick]);

  const visibleRails = rails.filter((r) => (r.type === "lnurl" ? SHOW_LNURL : true));
  const formatSats = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString()} sats`;
  const configured = Boolean(lightningAdmin?.configured || lightningReadiness?.configured || lightningReadiness?.nodeReachable);
  const reachable = Boolean(lightningReadiness?.nodeReachable || lightningAdmin?.runtime?.connected);
  const receiveReady = Boolean(lightningReadiness?.receiveReady);

  useEffect(() => {
    if (!peerSuggestionsBusy || !peerRefreshStartedAtRef.current) return;
    const id = window.setInterval(() => {
      const startedAt = peerRefreshStartedAtRef.current;
      if (!startedAt) return;
      setPeerRefreshElapsedMs(Date.now() - startedAt);
    }, 250);
    return () => window.clearInterval(id);
  }, [peerSuggestionsBusy]);

  async function loadPeerSuggestions() {
    if (peerSuggestionsBusy) return;
    const requestId = peerRefreshRequestRef.current + 1;
    peerRefreshRequestRef.current = requestId;
    const startedAt = Date.now();
    peerRefreshStartedAtRef.current = startedAt;
    setPeerRefreshElapsedMs(0);
    setPeerSuggestionsBusy(true);
    setPeerSuggestionsNoticeText("Refreshing peer graph...");
    setPeerRefreshResultText(null);
    setPeerRefreshResultTone("neutral");
    try {
      const res = await api<PeerSuggestionsResponse>("/api/admin/lightning/peers/suggestions?limit=20&probeTop=12&graphTimeoutMs=45000&forceRefresh=1", "GET");
      if (requestId !== peerRefreshRequestRef.current) return;
      const elapsedMs = Date.now() - startedAt;
      setPeerRefreshElapsedMs(elapsedMs);
      if (res.status !== "ok") {
        setPeerSuggestions([]);
        setPeerSuggestionsNoticeText(peerSuggestionNotice(res.error, res.reason));
        setPeerRefreshResultText(`Refresh failed in ${(elapsedMs / 1000).toFixed(1)}s.`);
        setPeerRefreshResultTone("warn");
        return;
      }
      setPeerSuggestions(Array.isArray(res.peers) ? res.peers : []);
      setPeerSuggestionsNoticeText(null);
      setPeerSuggestionsUpdatedAt(new Date().toLocaleTimeString());
      const peerCount = Array.isArray(res.peers) ? res.peers.length : 0;
      const probed = typeof res.meta?.probed === "number" ? ` · probed ${res.meta?.probed}` : "";
      const cacheInfo = res.meta?.cachedGraph ? " · cached graph" : "";
      setPeerRefreshResultText(`Loaded ${peerCount} peers in ${(elapsedMs / 1000).toFixed(1)}s${probed}${cacheInfo}.`);
      setPeerRefreshResultTone("ok");
    } catch (e: any) {
      if (requestId !== peerRefreshRequestRef.current) return;
      const elapsedMs = Date.now() - startedAt;
      setPeerRefreshElapsedMs(elapsedMs);
      const payload = parseApiErrorPayload(e);
      setPeerSuggestions([]);
      setPeerSuggestionsNoticeText(peerSuggestionNotice(payload?.error, payload?.reason));
      setPeerRefreshResultText(`Refresh failed in ${(elapsedMs / 1000).toFixed(1)}s.`);
      setPeerRefreshResultTone("warn");
    } finally {
      if (requestId === peerRefreshRequestRef.current) {
        setPeerSuggestionsBusy(false);
        peerRefreshStartedAtRef.current = null;
      }
    }
  }

  async function refreshLightningRuntime() {
    setRetryTick((t) => t + 1);
  }

  async function onOpenChannel(peerOverride?: PeerSuggestion) {
    setChannelError(null);
    setChannelResult(null);
    const peer = peerOverride || selectedPeer;
    const peerPubKey = usingCustomPeer ? customPeerPubKey.trim() : (peer?.pubkey || "");
    const peerHost = usingCustomPeer ? customPeerHost.trim() : (peer?.hostPort || "");
    if (!peerPubKey) return setChannelError("Select a peer or enter pubkey.");
    if (!peerHost) return setChannelError("Peer host:port is required.");
    if (!channelCapacitySats || channelCapacitySats < 20000) return setChannelError("Use at least 20,000 sats.");
    setChannelBusy(true);
    try {
      const res = await api<ChannelOpenResponse>("/api/admin/lightning/open-channel", "POST", {
        peerPubKey,
        peerHost,
        capacitySats: channelCapacitySats
      });
      if (res.status !== "success") {
        setChannelError(res.error || "Failed to open channel.");
        return;
      }
      setChannelResult(`Opened channel ${res.channelId}`);
      await refreshLightningRuntime();
    } catch (e: any) {
      setChannelError(e?.message || "Failed to open channel.");
    } finally {
      setChannelBusy(false);
    }
  }

  useEffect(() => {
    if (peerSuggestions.length === 0) {
      if (selectedPeerId !== "custom") setSelectedPeerId("custom");
      return;
    }
    const i = Number(selectedPeerId);
    if (!Number.isInteger(i) || i < 0 || i >= peerSuggestions.length) setSelectedPeerId("0");
  }, [peerSuggestions, selectedPeerId]);

  function statusTone(status: string) {
    if (status === "healthy") return "border-emerald-500/40 text-emerald-300";
    if (status === "locked") return "border-amber-500/40 text-amber-300";
    if (status === "degraded") return "border-amber-500/40 text-amber-300";
    return "border-red-500/40 text-red-300";
  }

  if (loading) return <div className="text-sm text-neutral-400">Loading node intake…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load node intake status. {error}</span>
        <button
          onClick={() => setRetryTick((t) => t + 1)}
          className="rounded-lg border border-amber-700 px-2 py-1 text-xs hover:bg-amber-900/30"
        >
          Retry
        </button>
      </div>
    );
  }

  const visiblePeerRows = showAllPeers ? peerSuggestions : peerSuggestions.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-cyan-900/40 bg-gradient-to-br from-cyan-950/30 via-neutral-950/50 to-neutral-950/70 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Lightning & Rails</div>
            <div className="text-sm text-neutral-300 mt-1 max-w-2xl">
              Node infrastructure operations surface for Lightning runtime and payment rails.
            </div>
          </div>
          {onOpenLightningConfig ? (
            <button
              type="button"
              onClick={() => onOpenLightningConfig()}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-100 hover:bg-neutral-900/60"
            >
              Configure Lightning
            </button>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={["inline-flex items-center rounded-full border px-2 py-0.5", configured ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300" : "border-neutral-700 bg-neutral-900/60 text-neutral-300"].join(" ")}>
            Configured: {configured ? "yes" : "no"}
          </span>
          <span className={["inline-flex items-center rounded-full border px-2 py-0.5", reachable ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300" : "border-amber-800/70 bg-amber-900/20 text-amber-300"].join(" ")}>
            Reachable: {reachable ? "yes" : "no"}
          </span>
          <span className={["inline-flex items-center rounded-full border px-2 py-0.5", receiveReady ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300" : "border-amber-800/70 bg-amber-900/20 text-amber-300"].join(" ")}>
            Receive-ready: {receiveReady ? "yes" : "no"}
          </span>
        </div>
        <div className="text-xs text-neutral-500 mt-3">
          Revenue/accounting metrics are intentionally excluded from this tab.
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-5">
        <div className="text-base font-semibold">Lightning Node Runtime</div>
        {!lightningAllowed ? (
          <div className="mt-2 text-sm text-neutral-500">Lightning runtime controls are available in sovereign node posture.</div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">configured</div>
                <div className="text-lg font-semibold text-neutral-100">{lightningAdmin?.configured ? "yes" : "no"}</div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">node reachable</div>
                <div className="text-lg font-semibold text-neutral-100">{lightningReadiness?.nodeReachable ? "yes" : "no"}</div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">receive ready</div>
                <div className="text-lg font-semibold text-neutral-100">{lightningReadiness?.receiveReady ? "yes" : "no"}</div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">network</div>
                <div className="text-lg font-semibold text-neutral-100">{lightningAdmin?.network || "—"}</div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">wallet total</div>
                <div className="text-lg font-semibold text-neutral-100">{formatSats(lightningBalances?.wallet?.totalSats)}</div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">open channels</div>
                <div className="text-lg font-semibold text-neutral-100">{Number(lightningBalances?.channels?.openCount || 0).toLocaleString()}</div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">outbound liquidity</div>
                <div className="text-lg font-semibold text-neutral-100">{formatSats(lightningBalances?.liquidity?.outboundSats)}</div>
              </div>
              <div className="rounded border border-neutral-800 bg-neutral-950/40 px-3 py-3">
                <div className="text-xs uppercase tracking-wide text-neutral-500">inbound liquidity</div>
                <div className="text-lg font-semibold text-neutral-100">{formatSats(lightningBalances?.liquidity?.inboundSats)}</div>
              </div>
            </div>
            {lightningAdmin?.restUrl ? (
              <div className="mt-2 text-xs text-neutral-500">REST endpoint: {lightningAdmin.restUrl}</div>
            ) : null}
            {lightningAdmin?.lastError ? (
              <div className="mt-2 text-xs text-amber-300">Last error: {lightningAdmin.lastError}</div>
            ) : null}
            {lightningError ? <div className="mt-2 text-xs text-amber-300">{lightningError}</div> : null}
          </>
        )}
      </div>

      {lightningAllowed ? (
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-5 xl:col-span-2">
            <div className="text-sm font-semibold">Open Channels</div>
            {lightningChannels.length === 0 ? (
              <div className="mt-2 text-xs text-neutral-500">No channel rows available.</div>
            ) : (
              <div className="mt-3 space-y-3">
                {lightningChannels.slice(0, 8).map((ch, idx) => (
                  <div key={`${ch.chanId || "chan"}-${idx}`} className="rounded border border-neutral-800 bg-neutral-900/40 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-neutral-100 font-medium truncate">{ch.alias || ch.remotePubkey || "Peer"}</div>
                      <span className={["rounded-full border px-2 py-0.5", ch.active ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300" : "border-neutral-700 bg-neutral-900/60 text-neutral-300"].join(" ")}>
                        {ch.active ? "active" : "inactive"}
                      </span>
                    </div>
                    {ch.remotePubkey ? <div className="mt-1 text-xs font-mono text-neutral-500 truncate">{ch.remotePubkey}</div> : null}
                    <div className="mt-2 text-xs text-neutral-400">
                      Capacity: {formatSats(ch.capacitySats)} · Local: {formatSats(ch.localBalanceSats)} · Remote: {formatSats(ch.remoteBalanceSats)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-5 xl:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold">Peer Suggestions</div>
              <div className="flex items-center gap-2">
                {peerSuggestionsUpdatedAt ? (
                  <span className="text-[11px] text-neutral-500">Updated {peerSuggestionsUpdatedAt}</span>
                ) : null}
                <button
                  onClick={() => void loadPeerSuggestions()}
                  disabled={peerSuggestionsBusy || channelBusy}
                  className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
                >
                  {peerSuggestionsBusy ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            {peerSuggestionsBusy ? (
              <div className="mt-2 text-xs text-cyan-300">Refreshing peer graph… {(peerRefreshElapsedMs / 1000).toFixed(1)}s</div>
            ) : null}
            {peerRefreshResultText ? (
              <div
                className={[
                  "mt-2 text-xs",
                  peerRefreshResultTone === "ok"
                    ? "text-emerald-300"
                    : peerRefreshResultTone === "warn"
                      ? "text-amber-300"
                      : "text-neutral-400"
                ].join(" ")}
              >
                {peerRefreshResultText}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { id: "100k" as const, label: "100k" },
                { id: "250k" as const, label: "250k" },
                { id: "500k" as const, label: "500k" },
                { id: "custom" as const, label: "custom" }
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setChannelPreset(opt.id)}
                  className={[
                    "rounded border px-2 py-1 text-[11px]",
                    channelPreset === opt.id ? "border-cyan-700 bg-cyan-900/20 text-cyan-200" : "border-neutral-700 text-neutral-300 hover:bg-neutral-900"
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
              {channelPreset === "custom" ? (
                <input
                  value={channelCustomSats}
                  onChange={(e) => setChannelCustomSats(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="100000"
                  className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100"
                />
              ) : null}
            </div>
            {peerSuggestionsNoticeText ? (
              <div className="mt-2 rounded border border-amber-800/60 bg-amber-950/20 p-2 text-xs text-amber-200">{peerSuggestionsNoticeText}</div>
            ) : null}
            {peerSuggestions.length === 0 ? (
              <div className="mt-3 text-sm text-neutral-500">No peer suggestions available right now.</div>
            ) : (
              <div className="mt-3 space-y-2 max-h-[520px] overflow-auto pr-1">
                {visiblePeerRows.map((peer, idx) => (
                  <div key={peer.pubkey} className="rounded border border-neutral-800 bg-neutral-900/40 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-neutral-200">
                        <input type="radio" checked={selectedPeerId === String(idx)} onChange={() => setSelectedPeerId(String(idx))} />
                        <span className="font-medium">{peer.alias || peer.pubkey.slice(0, 16)}</span>
                      </label>
                      <span className={["rounded-full border px-2 py-0.5", peer.reachableNow ? "border-emerald-800/70 bg-emerald-900/20 text-emerald-300" : "border-amber-800/70 bg-amber-900/20 text-amber-300"].join(" ")}>
                        {peer.reachableNow ? "reachable" : "unreachable"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-mono text-neutral-500 break-all">{peer.pubkey}</div>
                    <div className="mt-1 text-xs text-neutral-500 break-all">{peer.hostPort}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedPeerId(String(idx));
                          void onOpenChannel(peer);
                        }}
                        disabled={channelBusy}
                        className="rounded border border-emerald-700 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-900/20 disabled:opacity-50"
                      >
                        Open Channel
                      </button>
                    </div>
                  </div>
                ))}
                {peerSuggestions.length > 8 ? (
                  <button
                    onClick={() => setShowAllPeers((v) => !v)}
                    className="w-full rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900"
                  >
                    {showAllPeers ? "Show fewer peers" : `Show all peers (${peerSuggestions.length})`}
                  </button>
                ) : null}
              </div>
            )}
            <div className="mt-3 rounded border border-neutral-800 bg-neutral-900/40 p-2 text-xs">
              <label className="flex items-center gap-2 text-neutral-200">
                <input type="radio" checked={selectedPeerId === "custom"} onChange={() => setSelectedPeerId("custom")} />
                <span>Manual peer</span>
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  value={customPeerPubKey}
                  onChange={(e) => setCustomPeerPubKey(e.target.value)}
                  placeholder="Peer pubkey"
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                />
                <input
                  value={customPeerHost}
                  onChange={(e) => setCustomPeerHost(e.target.value)}
                  placeholder="host:port"
                  className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
                />
              </div>
              <div className="mt-2">
                <button
                  onClick={() => void onOpenChannel()}
                  disabled={channelBusy}
                  className="rounded border border-cyan-700 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-900/20 disabled:opacity-50"
                >
                  {channelBusy ? "Opening..." : `Open Selected (${formatSats(channelCapacitySats)})`}
                </button>
              </div>
              {channelError ? <div className="mt-2 text-xs text-amber-300">{channelError}</div> : null}
              {channelResult ? <div className="mt-2 text-xs text-emerald-300">{channelResult}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="text-xs uppercase tracking-wide text-neutral-500 px-1">Rail Health</div>
      <div className="grid gap-4 md:grid-cols-2">
        {visibleRails.map((r) => (
          <div key={r.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{r.label}</div>
              <span
                className={["text-xs px-2 py-1 rounded-full border", statusTone(r.status)].join(" ")}
              >
                {r.status}
              </span>
            </div>
            <div className="mt-2 text-xs text-neutral-400">Endpoint</div>
            <div className="text-sm text-neutral-200 break-all">{r.endpoint || "Not configured"}</div>
            <div className="mt-2 text-xs text-neutral-400">Health</div>
            <div className="text-sm text-neutral-300">{r.details || "—"}</div>
            {r.hint ? <div className="mt-2 text-xs text-neutral-500">Hint: {r.hint}</div> : null}
            <div className="mt-2 text-xs text-neutral-500">Last checked: {new Date(r.lastCheckedAt).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer select-none">More node methods</summary>
        <div className="mt-2">Stripe/PayPal/LNURL-Pay are hidden behind feature flags. Enable when needed.</div>
      </details>
    </div>
  );
}
