import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

type Overview = {
  totals: {
    salesSats: string;
    salesSatsLast30d: string;
    invoicesTotal: number;
    invoicesPaid: number;
    invoicesPending: number;
    invoicesFailed: number;
    invoicesExpired: number;
    paymentsReceivedSats: string;
    paymentsPendingSats: string;
    paymentsReceivedCount: number;
    paymentsPendingCount: number;
    paymentsLast30d: number;
  };
  revenueSeries: Array<{ date: string; amountSats: string }>;
  lastUpdatedAt: string;
  health: {
    lightning?: { status: string; message?: string; endpoint?: string | null; hint?: string | null };
    onchain?: { status: string; message?: string; endpoint?: string | null; hint?: string | null };
  };
};

type FinanceOverviewPageProps = {
  refreshSignal?: number;
};

type LightningAdminConfig = {
  configured: boolean;
  restUrl: string | null;
  network: string | null;
  lastTestedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
};

type LightningTestResult =
  | { ok: true; info: { alias: string; version: string; identityPubkey: string } }
  | { ok: false; error: string };

type LightningDiscoverResult =
  | { ok: true; candidates: Array<{ restUrl: string; requiresTlsCertHint?: boolean; notes?: string }> }
  | { ok: false; error: string };
type LightningReadiness = {
  ok: true;
  configured: boolean;
  nodeReachable: boolean;
  wallet: { syncedToChain: boolean; syncedToGraph: boolean; blockHeight?: number };
  channels: { count: number };
  receiveReady: boolean;
  hints: string[];
};
type LightningGuidanceResult = { ok: true; steps: string[] } | { ok: false; error: string };
type ChannelOpenResponse =
  | { status: "success"; channelId: string; transactionFee: number; estimatedConfirmations: number; message: string }
  | { status: "error"; error: string };
type ChannelStatusResponse =
  | {
      status: "open" | "pending" | "not_found";
      inboundLiquidity: number;
      outboundLiquidity: number;
      peer: string;
      confirmationStatus: "confirmed" | "awaiting_confirmation" | "unknown";
      receiveReady: boolean;
    }
  | { status: "error"; error: string };
type StarterPeer = { label: string; pubkey: string; host: string; blurb: string; minFundingSats: number };

const STARTER_PEERS: StarterPeer[] = [
  {
    label: "LNBIG (starter)",
    pubkey: "03d0674b16c5b333c65fbc0146d6f0b58a5b0f3f31b17f4f0de5f2f1f4f7d8b9aa",
    host: "lnbig.com:9735",
    blurb: "Larger routing node (200k minimum).",
    minFundingSats: 200_000
  },
  {
    label: "LightningPool (starter)",
    pubkey: "02aa0d36e56f9c2f4f2b1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcd12",
    host: "pool.lightning.engineering:9735",
    blurb: "Liquidity marketplace node (200k minimum).",
    minFundingSats: 200_000
  },
  {
    label: "ACINQ (starter)",
    pubkey: "03864ef025fde8fb587d989186ce6a4a186895ee44a926bfc370e2c366597a3f8f",
    host: "node.acinq.co:9735",
    blurb: "Well-known routing node (400k minimum).",
    minFundingSats: 400_000
  }
];

export default function FinanceOverviewPage({ refreshSignal }: FinanceOverviewPageProps) {
  const [data, setData] = useState<Overview | null>(null);
  const [royaltyTotals, setRoyaltyTotals] = useState<{ earnedSats: string; pendingSats: string }>({
    earnedSats: "0",
    pendingSats: "0"
  });
  const [payoutTotals, setPayoutTotals] = useState<{ pendingSats: string; paidSats: string }>({
    pendingSats: "0",
    paidSats: "0"
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auxError, setAuxError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [lightningAdmin, setLightningAdmin] = useState<LightningAdminConfig | null>(null);
  const [lightningAdminError, setLightningAdminError] = useState<string | null>(null);
  const [showLightningModal, setShowLightningModal] = useState(false);
  const [lndRestUrl, setLndRestUrl] = useState("");
  const [lndNetwork, setLndNetwork] = useState<"mainnet" | "testnet" | "regtest">("mainnet");
  const [macaroonFile, setMacaroonFile] = useState<File | null>(null);
  const [macaroonFileName, setMacaroonFileName] = useState<string | null>(null);
  const [tlsCertFile, setTlsCertFile] = useState<File | null>(null);
  const [tlsCertFileName, setTlsCertFileName] = useState<string | null>(null);
  const [wizardBusy, setWizardBusy] = useState<null | "discover" | "test" | "save" | "reset">(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardTest, setWizardTest] = useState<LightningTestResult | null>(null);
  const [wizardDiscoverMessage, setWizardDiscoverMessage] = useState<string | null>(null);
  const [wizardCandidates, setWizardCandidates] = useState<Array<{ restUrl: string; requiresTlsCertHint?: boolean; notes?: string }>>([]);
  const [lightningReadiness, setLightningReadiness] = useState<LightningReadiness | null>(null);
  const [lightningReadinessError, setLightningReadinessError] = useState<string | null>(null);
  const [showChannelGuidance, setShowChannelGuidance] = useState(false);
  const [channelGuidance, setChannelGuidance] = useState<string[]>([]);
  const [channelGuidanceError, setChannelGuidanceError] = useState<string | null>(null);
  const [channelPreset, setChannelPreset] = useState<"100k" | "500k" | "1m" | "custom">("100k");
  const [channelCustomSats, setChannelCustomSats] = useState("100000");
  const [selectedPeerId, setSelectedPeerId] = useState<string>("0");
  const [customPeerPubKey, setCustomPeerPubKey] = useState("");
  const [customPeerHost, setCustomPeerHost] = useState("");
  const [channelOpenBusy, setChannelOpenBusy] = useState(false);
  const [channelOpenError, setChannelOpenError] = useState<string | null>(null);
  const [openedChannel, setOpenedChannel] = useState<ChannelOpenResponse | null>(null);
  const [openedChannelStatus, setOpenedChannelStatus] = useState<ChannelStatusResponse | null>(null);
  const [channelStatusBusy, setChannelStatusBusy] = useState(false);
  const hasLoadedOverviewRef = useRef(false);

  useEffect(() => {
    if (showLightningModal) return;
    let active = true;
    (async () => {
      const isInitialLoad = !hasLoadedOverviewRef.current;
      if (isInitialLoad) {
        setLoading(true);
        setError(null);
      }
      setAuxError(null);
      try {
        const [overviewRes, royaltiesRes, payoutsRes] = await Promise.allSettled([
          api<Overview>("/finance/overview"),
          api<{ totals: { earnedSats: string; pendingSats: string } }>("/finance/royalties"),
          api<{ totals: { pendingSats: string; paidSats: string } }>("/finance/payouts")
        ]);
        if (!active) return;
        if (overviewRes.status === "fulfilled") {
          setData(overviewRes.value);
        } else {
          throw overviewRes.reason;
        }
        if (royaltiesRes.status === "fulfilled") {
          setRoyaltyTotals(royaltiesRes.value?.totals || { earnedSats: "0", pendingSats: "0" });
        } else {
          setRoyaltyTotals({ earnedSats: "0", pendingSats: "0" });
          setAuxError("Royalties summary unavailable.");
        }
        if (payoutsRes.status === "fulfilled") {
          setPayoutTotals(payoutsRes.value?.totals || { pendingSats: "0", paidSats: "0" });
        } else {
          setPayoutTotals({ pendingSats: "0", paidSats: "0" });
          setAuxError((prev) => prev || "Payouts summary unavailable.");
        }
      } catch (e: any) {
        if (!active) return;
        if (isInitialLoad) setError(e.message || "Failed to load finance overview.");
        else setAuxError((prev) => prev || (e?.message || "Auto-refresh failed."));
      } finally {
        if (active) {
          hasLoadedOverviewRef.current = true;
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal, retryTick, showLightningModal]);

  const applyLightningAdmin = (res: LightningAdminConfig | null, opts?: { syncForm?: boolean }) => {
    setLightningAdmin(res);
    setLightningAdminError(null);
    if (opts?.syncForm === false) return;
    if (!res?.configured) return;
    if (res.restUrl) setLndRestUrl(res.restUrl);
    if (res.network === "mainnet" || res.network === "testnet" || res.network === "regtest") {
      setLndNetwork(res.network);
    }
  };

  const loadLightningAdmin = async () => {
    const res = await api<LightningAdminConfig>("/api/admin/lightning", "GET");
    applyLightningAdmin(res || null);
    return res || null;
  };

  useEffect(() => {
    if (showLightningModal) return;
    let active = true;
    (async () => {
      try {
        const res = await api<LightningAdminConfig>("/api/admin/lightning", "GET");
        if (!active) return;
        applyLightningAdmin(res || null, { syncForm: true });
        if (res?.configured) {
          try {
            const readiness = await api<LightningReadiness>("/api/admin/lightning/readiness", "GET");
            if (!active) return;
            setLightningReadiness(readiness || null);
            setLightningReadinessError(null);
          } catch (e: any) {
            if (!active) return;
            setLightningReadinessError(e?.message || "Failed to load Lightning readiness.");
          }
        } else {
          setLightningReadiness(null);
          setLightningReadinessError(null);
        }
      } catch (e: any) {
        if (!active) return;
        setLightningAdminError(e?.message || "Failed to load Lightning config.");
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSignal, retryTick, showLightningModal]);

  const formatSats = (raw: string | null | undefined) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  const series = data?.revenueSeries || [];
  const chart = useMemo(() => {
    if (!series.length) return [] as Array<{ height: number; label: string; amountSats: string }>;
    const max = series.reduce((m, d) => Math.max(m, Number(d.amountSats || 0)), 0);
    return series.map((d) => ({
      height: max > 0 ? Math.round((Number(d.amountSats || 0) / max) * 100) : 0,
      label: d.date.slice(5),
      amountSats: d.amountSats
    }));
  }, [series]);

  const openLightningWizard = () => {
    setWizardError(null);
    setWizardTest(null);
    setWizardDiscoverMessage(null);
    setWizardCandidates([]);
    setShowChannelGuidance(false);
    setChannelGuidanceError(null);
    setChannelOpenError(null);
    setShowLightningModal(true);
  };

  const loadLightningReadiness = async () => {
    try {
      setLightningReadinessError(null);
      const res = await api<LightningReadiness>("/api/admin/lightning/readiness", "GET");
      setLightningReadiness(res || null);
      return res || null;
    } catch (e: any) {
      setLightningReadinessError(e?.message || "Failed to load Lightning readiness.");
      return null;
    }
  };

  const loadChannelGuidance = async () => {
    try {
      setChannelGuidanceError(null);
      const res = await api<LightningGuidanceResult>("/api/admin/lightning/channel-guidance", "GET");
      if (!res.ok) {
        setChannelGuidanceError(res.error || "Failed to load guidance.");
        return;
      }
      setChannelGuidance(res.steps || []);
    } catch (e: any) {
      setChannelGuidanceError(e?.message || "Failed to load guidance.");
    }
  };

  const selectedStarterPeer = selectedPeerId === "custom" ? null : STARTER_PEERS[Number(selectedPeerId)] || STARTER_PEERS[0];
  const channelCapacitySats = (() => {
    if (channelPreset === "100k") return 100_000;
    if (channelPreset === "500k") return 500_000;
    if (channelPreset === "1m") return 1_000_000;
    const n = Math.floor(Number(channelCustomSats || 0));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  })();
  const estimatedFeeSats = Math.max(500, Math.round(channelCapacitySats * 0.002));
  const affordableStarterPeerCount = STARTER_PEERS.filter((p) => channelCapacitySats >= p.minFundingSats).length;

  useEffect(() => {
    if (selectedPeerId === "custom") return;
    const current = STARTER_PEERS[Number(selectedPeerId)];
    if (current && channelCapacitySats >= current.minFundingSats) return;
    const firstAffordableIdx = STARTER_PEERS.findIndex((p) => channelCapacitySats >= p.minFundingSats);
    if (firstAffordableIdx >= 0) setSelectedPeerId(String(firstAffordableIdx));
  }, [channelCapacitySats, selectedPeerId]);

  const refreshOpenedChannelStatus = async (opts?: { silent?: boolean; channelId?: string }) => {
    const channelId = opts?.channelId || (openedChannel && openedChannel.status === "success" ? openedChannel.channelId : "");
    if (!channelId) return;
    if (!opts?.silent) setChannelStatusBusy(true);
    try {
      const peerPubKey = selectedPeerId === "custom" ? customPeerPubKey.trim() : selectedStarterPeer?.pubkey || "";
      const res = await api<ChannelStatusResponse>("/api/admin/lightning/channel-status", "POST", {
        channelId,
        peerPubKey: peerPubKey || undefined
      });
      setOpenedChannelStatus(res);
      await loadLightningReadiness();
    } catch (e: any) {
      setChannelOpenError(e?.message || "Failed to refresh channel status");
    } finally {
      if (!opts?.silent) setChannelStatusBusy(false);
    }
  };

  const onOpenChannel = async () => {
    setChannelOpenError(null);
    setOpenedChannel(null);
    setOpenedChannelStatus(null);
    setShowChannelGuidance(false);
    const peerPubKey = selectedPeerId === "custom" ? customPeerPubKey.trim() : selectedStarterPeer?.pubkey || "";
    const peerHost = selectedPeerId === "custom" ? customPeerHost.trim() : selectedStarterPeer?.host || "";
    if (!peerPubKey) return setChannelOpenError("Select a peer or enter a peer pubkey.");
    if (selectedPeerId === "custom" && !peerHost) return setChannelOpenError("Enter a peer host (host:port).");
    if (!channelCapacitySats || channelCapacitySats < 20000) return setChannelOpenError("Enter at least 20,000 sats.");
    if (selectedStarterPeer && channelCapacitySats < selectedStarterPeer.minFundingSats) {
      return setChannelOpenError(`You need at least ${selectedStarterPeer.minFundingSats.toLocaleString()} sats for ${selectedStarterPeer.label}.`);
    }

    setChannelOpenBusy(true);
    try {
      const res = await api<ChannelOpenResponse>("/api/admin/lightning/open-channel", "POST", {
        peerPubKey,
        peerHost,
        capacitySats: channelCapacitySats
      });
      setOpenedChannel(res);
      if (res.status !== "success") {
        setChannelOpenError(res.error || "Failed to open channel");
        return;
      }
      await refreshOpenedChannelStatus({ silent: true, channelId: res.channelId });
      await loadChannelGuidance();
      setShowChannelGuidance(true);
    } catch (e: any) {
      setChannelOpenError(e?.message || "Failed to open channel");
    } finally {
      setChannelOpenBusy(false);
    }
  };

  const onMacaroonFileChange = async (file: File | null) => {
    setWizardError(null);
    setWizardTest(null);
    setWizardDiscoverMessage(null);
    if (!file) {
      setMacaroonFile(null);
      setMacaroonFileName(null);
      return;
    }
    const name = (file.name || "").toLowerCase();
    if (!(name.endsWith(".macaroon") || file.type === "application/octet-stream" || !file.type)) {
      setWizardError("Macaroon file must use the .macaroon extension.");
      return;
    }
    setMacaroonFile(file);
    setMacaroonFileName(file.name);
  };

  const onTlsCertFileChange = async (file: File | null) => {
    setWizardError(null);
    setWizardTest(null);
    setWizardDiscoverMessage(null);
    if (!file) {
      setTlsCertFile(null);
      setTlsCertFileName(null);
      return;
    }
    const name = (file.name || "").toLowerCase();
    if (!(name.endsWith(".pem") || name.endsWith(".crt") || file.type === "application/x-pem-file" || file.type === "application/pkix-cert" || !file.type)) {
      setWizardError("TLS cert must be a .pem or .crt file.");
      return;
    }
    try {
      const text = await file.text();
      if (!text.includes("BEGIN CERTIFICATE")) {
        setWizardError("TLS cert file must contain a PEM certificate.");
        return;
      }
      setTlsCertFile(file);
      setTlsCertFileName(file.name);
    } catch (e: any) {
      setWizardError(e?.message || "Failed to read TLS cert file");
    }
  };

  const onTestLightning = async () => {
    setWizardError(null);
    setWizardTest(null);
    setWizardDiscoverMessage(null);
    if (!lndRestUrl.trim()) return setWizardError("LND REST URL is required.");
    if (!macaroonFile) return setWizardError("Macaroon file is required.");
    setWizardBusy("test");
    try {
      const form = new FormData();
      form.append("restUrl", lndRestUrl.trim());
      form.append("network", lndNetwork);
      form.append("macaroonFile", macaroonFile, macaroonFile.name || "invoice.macaroon");
      if (tlsCertFile) form.append("tlsCertFile", tlsCertFile, tlsCertFile.name || "tls-cert.pem");
      const res = await api<LightningTestResult>("/api/admin/lightning/test", { method: "POST", body: form });
      setWizardTest(res);
      if (!res.ok) setWizardError(res.error || "Connection test failed");
      await loadLightningReadiness();
    } catch (e: any) {
      setWizardError(e?.message || "Connection test failed");
    } finally {
      setWizardBusy(null);
    }
  };

  const onSaveLightning = async () => {
    setWizardError(null);
    setWizardDiscoverMessage(null);
    if (!lndRestUrl.trim()) return setWizardError("LND REST URL is required.");
    if (!macaroonFile) return setWizardError("Macaroon file is required.");
    setWizardBusy("save");
    try {
      const form = new FormData();
      form.append("restUrl", lndRestUrl.trim());
      form.append("network", lndNetwork);
      form.append("macaroonFile", macaroonFile, macaroonFile.name || "invoice.macaroon");
      if (tlsCertFile) form.append("tlsCertFile", tlsCertFile, tlsCertFile.name || "tls-cert.pem");
      const res = await api<{ ok: boolean; error?: string }>("/api/admin/lightning", { method: "POST", body: form });
      if (!res.ok) {
        setWizardError(res.error || "Failed to save Lightning config");
        return;
      }
      await loadLightningAdmin();
      await loadLightningReadiness();
      setRetryTick((t) => t + 1);
      setShowLightningModal(false);
    } catch (e: any) {
      setWizardError(e?.message || "Failed to save Lightning config");
    } finally {
      setWizardBusy(null);
    }
  };

  const onResetLightning = async () => {
    if (!window.confirm("Reset Lightning config?")) return;
    setWizardError(null);
    setWizardTest(null);
    setWizardDiscoverMessage(null);
    setWizardBusy("reset");
    try {
      await api<{ ok: boolean }>("/api/admin/lightning", "DELETE");
      setMacaroonFile(null);
      setMacaroonFileName(null);
      setTlsCertFile(null);
      setTlsCertFileName(null);
      await loadLightningAdmin();
      setLightningReadiness(null);
      setRetryTick((t) => t + 1);
      setShowLightningModal(false);
    } catch (e: any) {
      setWizardError(e?.message || "Failed to reset Lightning config");
    } finally {
      setWizardBusy(null);
    }
  };

  const onDiscoverLightning = async () => {
    setWizardError(null);
    setWizardTest(null);
    setWizardDiscoverMessage(null);
    setWizardCandidates([]);
    setWizardBusy("discover");
    try {
      const res = await api<LightningDiscoverResult>("/api/admin/lightning/discover", "POST");
      if (!res.ok) {
        setWizardError(res.error || "Could not find a local LND REST endpoint.");
        return;
      }
      const first = (res.candidates || [])[0];
      setWizardCandidates(res.candidates || []);
      if (!first) {
        setWizardError("Could not find a local LND REST endpoint.");
        return;
      }
      setLndRestUrl(first.restUrl);
      setLndNetwork("mainnet");
      setWizardDiscoverMessage(
        first.notes ||
          (first.requiresTlsCertHint
            ? "Found a local LND REST endpoint. Upload your macaroon and TLS cert, then test."
            : "Found a local LND REST endpoint. Upload your macaroon (and TLS cert if needed), then test.")
      );
    } catch (e: any) {
      setWizardError(e?.message || "Could not find a local LND REST endpoint.");
    } finally {
      setWizardBusy(null);
    }
  };

  useEffect(() => {
    if (!showLightningModal) return;
    if (!lightningAdmin?.configured) return;
    loadLightningReadiness().catch(() => {});
  }, [showLightningModal, lightningAdmin?.configured]);

  useEffect(() => {
    if (!showLightningModal) return;
    if (!openedChannel || openedChannel.status !== "success") return;
    const pending = openedChannelStatus && "status" in openedChannelStatus && openedChannelStatus.status === "pending";
    if (!pending) return;
    const timer = window.setInterval(() => {
      refreshOpenedChannelStatus({ silent: true }).catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [showLightningModal, openedChannel, openedChannelStatus]);

  const onchain = data?.health?.onchain;
  const healthTone = (status?: string) => {
    if (status === "healthy") return "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
    if (status === "locked" || status === "degraded" || status === "tlsError") return "border-amber-500/40 text-amber-300 bg-amber-500/10";
    if (status === "missing") return "border-neutral-700 text-neutral-300 bg-neutral-900/50";
    return "border-red-500/40 text-red-300 bg-red-500/10";
  };
  const lightningChipStatus = lightningAdmin?.configured
    ? lightningAdmin.lastStatus === "error"
      ? "error"
      : "connected"
    : "missing";
  const lightningChipTone = healthTone(
    lightningChipStatus === "connected" ? "healthy" : lightningChipStatus === "missing" ? "missing" : "error"
  );
  const receiveChipStatus = !lightningAdmin?.configured
    ? "missing"
    : lightningReadiness?.receiveReady
      ? "ready"
      : lightningReadiness?.configured && lightningReadiness.nodeReachable
        ? "setup"
        : lightningReadiness
          ? "error"
          : "unknown";
  const receiveChipTone =
    receiveChipStatus === "ready"
      ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
      : receiveChipStatus === "setup"
        ? "border-amber-500/40 text-amber-300 bg-amber-500/10"
        : receiveChipStatus === "missing" || receiveChipStatus === "unknown"
          ? "border-neutral-700 text-neutral-300 bg-neutral-900/50"
          : "border-red-500/40 text-red-300 bg-red-500/10";
  const hasRevenue =
    Number(data?.totals?.salesSats || 0) > 0 ||
    Number(data?.totals?.invoicesTotal || 0) > 0 ||
    Number(royaltyTotals.earnedSats || 0) > 0 ||
    Number(payoutTotals.pendingSats || 0) > 0;

  if (loading) return <div className="text-sm text-neutral-400">Loading revenue overview…</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-center justify-between">
        <span>Couldn’t load revenue overview. {error}</span>
        <button
          onClick={() => setRetryTick((t) => t + 1)}
          className="rounded-lg border border-amber-700 px-2 py-1 text-xs hover:bg-amber-900/30"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!hasRevenue ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 text-sm text-neutral-300">
          No revenue yet — sell content to get started.
        </div>
      ) : null}

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-semibold">Revenue Overview</div>
          <div className="flex items-center gap-2 text-xs">
            <span className={["rounded-full border px-2 py-1", lightningChipTone].join(" ")}>
              Lightning: {lightningChipStatus}
            </span>
            <span className={["rounded-full border px-2 py-1", receiveChipTone].join(" ")}>
              Receive: {receiveChipStatus}
            </span>
            <span className={["rounded-full border px-2 py-1", healthTone(onchain?.status)].join(" ")}>
              On-chain: {onchain?.status || "unknown"}
            </span>
            {!lightningAdmin?.configured ? (
              <button
                onClick={openLightningWizard}
                className="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
              >
                Connect Lightning Node
              </button>
            ) : (
              <>
                <button
                  onClick={openLightningWizard}
                  className="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900"
                >
                  Edit Lightning Node
                </button>
                <button
                  onClick={onResetLightning}
                  disabled={wizardBusy === "reset"}
                  className="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                >
                  {wizardBusy === "reset" ? "Resetting…" : "Reset Lightning Config"}
                </button>
              </>
            )}
            <span className="text-neutral-500">
              Last updated: {data?.lastUpdatedAt ? new Date(data.lastUpdatedAt).toLocaleString() : "—"}
            </span>
          </div>
        </div>
        {auxError ? (
          <div className="mt-2 text-xs text-amber-300">{auxError}</div>
        ) : null}
        {lightningAdmin?.configured && lightningAdmin.lastTestedAt ? (
          <div className="mt-1 text-xs text-neutral-500">
            Lightning node last tested: {new Date(lightningAdmin.lastTestedAt).toLocaleString()}
            {lightningAdmin.restUrl ? ` · ${lightningAdmin.restUrl}` : ""}
          </div>
        ) : null}
        {lightningAdmin?.lastStatus === "error" && lightningAdmin.lastError ? (
          <div className="mt-1 text-xs text-amber-300">Lightning error: {lightningAdmin.lastError}</div>
        ) : null}
        {lightningAdminError ? <div className="mt-1 text-xs text-amber-300">{lightningAdminError}</div> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Total sales</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(data?.totals?.salesSats || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">Paid invoices only</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Royalties earned</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(royaltyTotals.earnedSats || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">Your share to date</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Pending payouts</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(payoutTotals.pendingSats || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">Awaiting settlement</div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Last 30 days</div>
          <div className="mt-2 text-2xl font-semibold">{formatSats(data?.totals?.salesSatsLast30d || "0")}</div>
          <div className="mt-1 text-xs text-neutral-500">
            Invoices: {data?.totals?.invoicesTotal ?? 0} · Payments: {data?.totals?.paymentsLast30d ?? 0}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Invoices total</div>
          <div className="mt-2 text-2xl font-semibold">{data?.totals?.invoicesTotal ?? 0}</div>
          <div className="mt-1 text-xs text-neutral-500">Paid: {data?.totals?.invoicesPaid ?? 0}</div>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
        <div className="text-base font-semibold">Revenue over time (last 30 days)</div>
        <div className="mt-3 flex items-end gap-1 h-32">
          {chart.length === 0 ? (
            <div className="text-sm text-neutral-500">No revenue yet.</div>
          ) : (
            chart.map((d, idx) => (
              <div key={`${d.label}-${idx}`} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-sm bg-orange-400/70"
                  style={{ height: `${Math.max(2, d.height)}%` }}
                  title={`${formatSats(d.amountSats)} on ${d.label}`}
                />
                {idx % 5 === 0 ? (
                  <div className="text-[10px] text-neutral-500">{d.label}</div>
                ) : (
                  <div className="text-[10px] text-transparent">.</div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-base font-semibold">Invoice status</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>Paid: <span className="text-neutral-200">{data?.totals?.invoicesPaid ?? 0}</span></div>
            <div>Pending: <span className="text-neutral-200">{data?.totals?.invoicesPending ?? 0}</span></div>
            <div>Failed: <span className="text-neutral-200">{data?.totals?.invoicesFailed ?? 0}</span></div>
            <div>Expired: <span className="text-neutral-200">{data?.totals?.invoicesExpired ?? 0}</span></div>
          </div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
          <div className="text-base font-semibold">Payments received</div>
          <div className="mt-2 text-sm text-neutral-200">
            Received: {formatSats(data?.totals?.paymentsReceivedSats || "0")} ({data?.totals?.paymentsReceivedCount ?? 0})
          </div>
          <div className="text-sm text-neutral-400">
            Pending: {formatSats(data?.totals?.paymentsPendingSats || "0")} ({data?.totals?.paymentsPendingCount ?? 0})
          </div>
        </div>
      </section>

      {/* Manual test checklist:
          1) Open Connect Lightning Node and click "Find my node" -> restUrl auto-fills if local LND is reachable.
          2) Select macaroon (+ optional TLS cert) and verify file labels persist while page auto-refreshes.
          3) Test connection shows alias/version on success; Save flips Lightning status to connected without restart.
      */}
      {showLightningModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-100 overflow-hidden shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-5 py-4 backdrop-blur">
              <div>
                <div className="text-lg font-semibold">Connect Lightning Node</div>
                <div className="mt-1 text-sm text-neutral-400">Configure LND REST access for sovereign mode.</div>
              </div>
              <button
                onClick={() => setShowLightningModal(false)}
                className="rounded-md border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
              >
                Close
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4 max-h-[calc(90vh-132px)]">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={onDiscoverLightning}
                  disabled={wizardBusy !== null}
                  className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                >
                  {wizardBusy === "discover" ? "Detecting…" : "Auto-detect"}
                </button>
                <span className="text-xs text-neutral-500">Try local LND defaults (localhost / 127.0.0.1)</span>
              </div>
              <div className="hidden md:block" />

              {wizardCandidates.length > 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 md:col-span-2">
                  <div className="text-xs font-semibold text-neutral-200">Detected endpoints</div>
                  <div className="mt-2 space-y-2">
                    {wizardCandidates.map((c) => (
                      <div key={c.restUrl} className="rounded border border-neutral-800 p-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <code className="text-neutral-200">{c.restUrl}</code>
                          <button
                            onClick={() => {
                              setLndRestUrl(c.restUrl);
                              setLndNetwork("mainnet");
                              if (c.requiresTlsCertHint) {
                                setWizardDiscoverMessage("Detected a self-signed TLS endpoint. Upload your TLS CA cert before testing.");
                              }
                            }}
                            className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
                          >
                            Use this URL
                          </button>
                        </div>
                        {c.requiresTlsCertHint ? <div className="mt-1 text-amber-300">TLS CA cert upload likely required.</div> : null}
                        {c.notes ? <div className="mt-1 text-neutral-400">{c.notes}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="grid gap-1 text-sm">
                <span className="text-neutral-300">LND REST URL</span>
                <input
                  value={lndRestUrl}
                  onChange={(e) => setLndRestUrl(e.target.value)}
                  placeholder="https://node.example.com:8080"
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-neutral-300">Network</span>
                <select
                  value={lndNetwork}
                  onChange={(e) => setLndNetwork(e.target.value as "mainnet" | "testnet" | "regtest")}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                >
                  <option value="mainnet">mainnet</option>
                  <option value="testnet">testnet</option>
                  <option value="regtest">regtest</option>
                </select>
              </label>

              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-neutral-300">Macaroon file (.macaroon)</span>
                <input
                  type="file"
                  accept=".macaroon,application/octet-stream"
                  onChange={(e) => onMacaroonFileChange(e.target.files?.[0] || null)}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
                />
                <span className="text-xs text-neutral-500">
                  {macaroonFileName ? `Loaded: ${macaroonFileName}` : "No file selected"}
                </span>
                <span className="text-xs text-neutral-500">
                  If you can't see `~/.lnd` in the file picker, press Ctrl+H to show hidden folders.
                </span>
              </label>

              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-neutral-300">TLS CA cert (.pem / .crt) (optional)</span>
                <input
                  type="file"
                  accept=".pem,.crt,application/x-pem-file,application/pkix-cert"
                  onChange={(e) => onTlsCertFileChange(e.target.files?.[0] || null)}
                  className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
                />
                <span className="text-xs text-neutral-500">
                  {tlsCertFileName ? `Loaded: ${tlsCertFileName}` : "No TLS cert selected (public CA is fine)"}
                </span>
              </label>
            </div>

            {wizardTest?.ok ? (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <div className="font-medium text-emerald-300">Connection successful</div>
                <div className="mt-1 text-xs text-neutral-200">
                  Alias: {wizardTest.info.alias || "—"} · Version: {wizardTest.info.version || "—"}
                </div>
                <div className="mt-1 break-all font-mono text-[11px] text-neutral-400">
                  {wizardTest.info.identityPubkey || ""}
                </div>
              </div>
            ) : null}
            {wizardError ? <div className="mt-4 text-sm text-amber-300">{wizardError}</div> : null}
            {wizardDiscoverMessage ? <div className="mt-2 text-sm text-neutral-300">{wizardDiscoverMessage}</div> : null}

            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="text-sm font-semibold text-neutral-200">Receive Readiness</div>
              {lightningReadinessError ? <div className="mt-2 text-sm text-amber-300">{lightningReadinessError}</div> : null}
              {!lightningReadiness && !lightningReadinessError ? (
                <div className="mt-2 text-xs text-neutral-500">Save your node config to check receive readiness.</div>
              ) : null}
              {lightningReadiness ? (
                <div className="mt-2 space-y-2 text-xs">
                  <div>Node reachable: <span className={lightningReadiness.nodeReachable ? "text-emerald-300" : "text-red-300"}>{lightningReadiness.nodeReachable ? "YES" : "NO"}</span></div>
                  <div>Synced: <span className={lightningReadiness.wallet.syncedToChain && lightningReadiness.wallet.syncedToGraph ? "text-emerald-300" : "text-amber-300"}>
                    {lightningReadiness.wallet.syncedToChain && lightningReadiness.wallet.syncedToGraph ? "YES" : "NO"}
                  </span>{typeof lightningReadiness.wallet.blockHeight === "number" ? ` · block ${lightningReadiness.wallet.blockHeight}` : ""}</div>
                  <div>Channels: <span className="text-neutral-200">{lightningReadiness.channels.count}</span></div>
                  <div>Receive ready: <span className={lightningReadiness.receiveReady ? "text-emerald-300" : "text-amber-300"}>
                    {lightningReadiness.receiveReady ? "YES" : "NO"}
                  </span></div>
                  {lightningReadiness.hints.length > 0 ? (
                    <div className="space-y-1">
                      {lightningReadiness.hints.map((h, i) => (
                        <div key={`${h}-${i}`} className="text-neutral-400">• {h}</div>
                      ))}
                    </div>
                  ) : null}
                  {lightningReadiness.channels.count === 0 ? (
                    <div className="pt-1">
                      <button
                        onClick={async () => {
                          const next = !showChannelGuidance;
                          setShowChannelGuidance(next);
                          if (next && channelGuidance.length === 0) await loadChannelGuidance();
                        }}
                        className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
                      >
                        Open your first channel (recommended)
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {lightningReadiness?.configured && (
              <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="text-sm font-semibold text-neutral-200">Channel Setup</div>
                <div className="mt-1 text-xs text-neutral-400">
                  Open a small starter channel so you can begin sending payments. Inbound liquidity may still be needed to receive.
                </div>

                <div className="mt-3">
                  <div className="text-xs text-neutral-300">Channel size</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      { id: "100k", label: "100k sats" },
                      { id: "500k", label: "500k sats" },
                      { id: "1m", label: "1M sats" },
                      { id: "custom", label: "Custom" }
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setChannelPreset(opt.id as any)}
                        className={[
                          "rounded-lg border px-3 py-2 text-xs",
                          channelPreset === opt.id ? "border-white/40 bg-white/10 text-white" : "border-neutral-800 text-neutral-200 hover:bg-neutral-900"
                        ].join(" ")}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {channelPreset === "custom" ? (
                    <input
                      value={channelCustomSats}
                      onChange={(e) => setChannelCustomSats(e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="100000"
                      className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
                    />
                  ) : null}
                </div>

                <div className="mt-3">
                  <div className="text-xs text-neutral-300">Peer selection</div>
                  <div className="mt-3 text-xs text-neutral-500">
                    {affordableStarterPeerCount > 0
                      ? `${affordableStarterPeerCount} starter peer option${affordableStarterPeerCount === 1 ? "" : "s"} fit your current channel size.`
                      : "No starter peers fit this size yet. Try a larger amount, or enter a custom peer that supports smaller channels."}
                  </div>
                  <div className="mt-2 rounded border border-neutral-800 p-2">
                    <div className="text-xs font-semibold text-neutral-200">Starter Peers</div>
                    <div className="mt-2 space-y-2">
                    {STARTER_PEERS.map((p, idx) => (
                      <label
                        key={`${p.pubkey}-${idx}`}
                        className={[
                          "flex items-start gap-2 rounded border p-2 text-xs",
                          channelCapacitySats < p.minFundingSats
                            ? "border-neutral-800 opacity-55"
                            : "border-neutral-800"
                        ].join(" ")}
                      >
                        <input
                          type="radio"
                          checked={selectedPeerId === String(idx)}
                          onChange={() => setSelectedPeerId(String(idx))}
                          className="mt-0.5"
                          disabled={channelCapacitySats < p.minFundingSats}
                        />
                        <div>
                          <div className="text-neutral-200">
                            {p.label}{" "}
                            {channelCapacitySats >= p.minFundingSats ? (
                              <span className="text-emerald-300">(fits your budget)</span>
                            ) : null}
                          </div>
                          <div className="text-neutral-500">{p.blurb}</div>
                          <div className="text-neutral-500">{p.host}</div>
                          <div className="text-neutral-500">Minimum: {p.minFundingSats.toLocaleString()} sats</div>
                          {channelCapacitySats < p.minFundingSats ? (
                            <div className="text-amber-300">Needs {p.minFundingSats.toLocaleString()} sats+</div>
                          ) : null}
                        </div>
                      </label>
                    ))}
                    </div>
                  </div>
                  <div className="mt-2 space-y-2">
                    <label className="flex items-start gap-2 rounded border border-neutral-800 p-2 text-xs">
                      <input
                        type="radio"
                        checked={selectedPeerId === "custom"}
                        onChange={() => setSelectedPeerId("custom")}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-neutral-200">Custom peer</div>
                        <div className="mt-2 grid gap-2">
                          <input
                            value={customPeerPubKey}
                            onChange={(e) => setCustomPeerPubKey(e.target.value.trim())}
                            placeholder="Peer pubkey (66 hex chars)"
                            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs"
                          />
                          <input
                            value={customPeerHost}
                            onChange={(e) => setCustomPeerHost(e.target.value.trim())}
                            placeholder="host:port"
                            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-2 text-xs"
                          />
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="mt-3 rounded border border-neutral-800 p-2 text-xs text-neutral-300">
                  Fee preview: about <span className="text-neutral-100">{estimatedFeeSats.toLocaleString()} sats</span> on-chain
                  <span className="text-neutral-500"> · confirmation target ~3 blocks</span>
                </div>

                {channelOpenError ? <div className="mt-2 text-xs text-amber-300">{channelOpenError}</div> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={onOpenChannel}
                    disabled={channelOpenBusy || wizardBusy !== null}
                    className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
                  >
                    {channelOpenBusy ? "Opening channel…" : "Open Your First Channel"}
                  </button>
                  {openedChannel && openedChannel.status === "success" ? (
                    <button
                      onClick={() => refreshOpenedChannelStatus()}
                      disabled={channelStatusBusy}
                      className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                    >
                      {channelStatusBusy ? "Checking…" : "Re-check Status"}
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {openedChannel && openedChannel.status === "success" ? (
              <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="text-sm font-semibold text-neutral-200">Post-Channel Status</div>
                <div className="mt-1 text-xs text-neutral-400">{openedChannel.message}</div>
                <div className="mt-2 text-xs text-neutral-300">Channel ID: <code>{openedChannel.channelId}</code></div>
                <div className="mt-1 text-xs text-neutral-300">
                  Estimated fee: {openedChannel.transactionFee} BTC · Estimated confirmations: {openedChannel.estimatedConfirmations}
                </div>
                {openedChannelStatus && "status" in openedChannelStatus ? (
                  <div className="mt-3 space-y-1 text-xs">
                    <div>Status: <span className="text-neutral-100">{openedChannelStatus.status}</span> ({openedChannelStatus.confirmationStatus})</div>
                    <div>Outbound Liquidity: <span className="text-neutral-100">{Math.round(openedChannelStatus.outboundLiquidity).toLocaleString()} sats</span></div>
                    <div>Inbound Liquidity: <span className="text-neutral-100">{Math.round(openedChannelStatus.inboundLiquidity).toLocaleString()} sats</span></div>
                    <div>
                      {openedChannelStatus.receiveReady
                        ? "You can receive Lightning payments."
                        : "You can send payments but need inbound liquidity to receive."}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-neutral-500">Channel status will appear after the first check.</div>
                )}
              </div>
            ) : null}

            {showChannelGuidance ? (
              <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="text-sm font-semibold text-neutral-200">Channel Setup Guidance</div>
                {channelGuidanceError ? <div className="mt-2 text-sm text-amber-300">{channelGuidanceError}</div> : null}
                {channelGuidance.length > 0 ? (
                  <div className="mt-2 space-y-1 text-xs text-neutral-300">
                    {channelGuidance.map((s, i) => (
                      <div key={`${s}-${i}`}>• {s}</div>
                    ))}
                  </div>
                ) : !channelGuidanceError ? (
                  <div className="mt-2 text-xs text-neutral-500">Loading guidance…</div>
                ) : null}
              </div>
            ) : null}
            </div>

            <div className="sticky bottom-0 z-10 border-t border-neutral-800 bg-neutral-950/95 px-5 py-4 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  onClick={onTestLightning}
                  disabled={wizardBusy !== null}
                  className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                >
                  {wizardBusy === "test" ? "Testing…" : "Test connection"}
                </button>
                {lightningAdmin?.configured ? (
                  <button
                    onClick={onResetLightning}
                    disabled={wizardBusy !== null}
                    className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                  >
                    {wizardBusy === "reset" ? "Resetting…" : "Reset Lightning Config"}
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLightningModal(false)}
                  disabled={wizardBusy !== null}
                  className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={onSaveLightning}
                  disabled={wizardBusy !== null}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
                >
                  {wizardBusy === "save" ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
