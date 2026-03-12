import React from "react";
import { api, getApiBase } from "../lib/api";
import { fetchIdentityDetail } from "../lib/identity";

type NetworkSummary = {
  nodeMode: "basic" | "advanced" | "lan";
  serviceRoles: {
    creator: boolean;
    invoiceProvider: boolean;
    hybrid: boolean;
  };
  paymentCapability: {
    localInvoiceMinting: boolean;
    delegatedInvoiceSupport: boolean;
    tipsOnly: boolean;
  };
  providerBinding: {
    configured: boolean;
    providerNodeId: string | null;
  };
  visibility: "DISABLED" | "UNLISTED" | "LISTED";
  reachability: {
    publicUrl: string | null;
    tunnel: boolean;
    ipfs: boolean;
  };
};

type NetworkProviderConfig = {
  providerNodeId: string | null;
  providerProfileId: string | null;
  providerUrl: string | null;
  providerPubKey: string | null;
  enabled: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  configured?: boolean;
};

function guessApiBase() {
  return getApiBase();
}

function isLikelyUrl(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

function extractReceiptToken(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (v.length >= 16 && !v.includes("/") && !v.includes(" ")) return v;
  const m = v.match(/\/public\/receipts\/([^/?#]+)/i);
  if (m) return m[1];
  return null;
}

function extractBuyUrl(input: string): string | null {
  const v = input.trim();
  if (!isLikelyUrl(v)) return null;
  if (v.includes("/buy/")) return v;
  return null;
}

export default function StorePage(props: { onOpenReceipt: (token: string) => void }) {
  const [input, setInput] = React.useState("");
  const [nodeHost, setNodeHost] = React.useState(() => guessApiBase());
  const [msg, setMsg] = React.useState<string | null>(null);
  const [diagnostics, setDiagnostics] = React.useState<any | null>(null);
  const [identity, setIdentity] = React.useState<{ nodeMode?: string | null } | null>(null);
  const [networkSummary, setNetworkSummary] = React.useState<NetworkSummary | null>(null);
  const [providerConfig, setProviderConfig] = React.useState<NetworkProviderConfig | null>(null);
  const [providerLoading, setProviderLoading] = React.useState(false);
  const [providerSaving, setProviderSaving] = React.useState(false);
  const [providerMsg, setProviderMsg] = React.useState<string | null>(null);
  const [providerErr, setProviderErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    api("/api/diagnostics/status", "GET")
      .then((d) => {
        if (!active) return;
        setDiagnostics(d || null);
      })
      .catch(() => {
        if (!active) return;
        setDiagnostics(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    fetchIdentityDetail()
      .then((d) => {
        if (!active) return;
        setIdentity(d || null);
      })
      .catch(() => {
        if (!active) return;
        setIdentity(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    api<NetworkSummary>("/api/network/summary", "GET")
      .then((d) => {
        if (!active) return;
        setNetworkSummary(d || null);
      })
      .catch(() => {
        if (!active) return;
        setNetworkSummary(null);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    setProviderLoading(true);
    api<NetworkProviderConfig>("/api/network/provider", "GET")
      .then((d) => {
        if (!active) return;
        setProviderConfig({
          providerNodeId: d?.providerNodeId || "",
          providerProfileId: d?.providerProfileId || "",
          providerUrl: d?.providerUrl || "",
          providerPubKey: d?.providerPubKey || "",
          enabled: Boolean(d?.enabled),
          createdAt: d?.createdAt || null,
          updatedAt: d?.updatedAt || null,
          configured: Boolean(d?.configured)
        });
      })
      .catch(() => {
        if (!active) return;
        setProviderConfig({
          providerNodeId: "",
          providerProfileId: "",
          providerUrl: "",
          providerPubKey: "",
          enabled: false
        });
      })
      .finally(() => {
        if (!active) return;
        setProviderLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateProviderField<K extends keyof NetworkProviderConfig>(key: K, value: NetworkProviderConfig[K]) {
    setProviderConfig((prev) => {
      const base: NetworkProviderConfig = prev || {
        providerNodeId: "",
        providerProfileId: "",
        providerUrl: "",
        providerPubKey: "",
        enabled: false
      };
      return { ...base, [key]: value };
    });
  }

  async function saveProviderConfig() {
    if (!providerConfig) return;
    setProviderMsg(null);
    setProviderErr(null);
    setProviderSaving(true);
    try {
      const saved = await api<NetworkProviderConfig>("/api/network/provider", "PUT", {
        providerNodeId: providerConfig.providerNodeId || "",
        providerProfileId: providerConfig.providerProfileId || null,
        providerUrl: providerConfig.providerUrl || "",
        providerPubKey: providerConfig.providerPubKey || null,
        enabled: Boolean(providerConfig.enabled)
      });
      setProviderConfig({
        providerNodeId: saved?.providerNodeId || "",
        providerProfileId: saved?.providerProfileId || "",
        providerUrl: saved?.providerUrl || "",
        providerPubKey: saved?.providerPubKey || "",
        enabled: Boolean(saved?.enabled),
        createdAt: saved?.createdAt || null,
        updatedAt: saved?.updatedAt || null,
        configured: Boolean(saved?.configured)
      });
      setProviderMsg("Provider configuration saved.");
      const refreshed = await api<NetworkSummary>("/api/network/summary", "GET");
      setNetworkSummary(refreshed || null);
    } catch (e: any) {
      setProviderErr(e?.message || "Failed to save provider configuration.");
    } finally {
      setProviderSaving(false);
    }
  }

  function onOpen() {
    setMsg(null);
    const buyUrl = extractBuyUrl(input);
    if (buyUrl) {
      window.location.assign(buyUrl);
      return;
    }

    const token = extractReceiptToken(input);
    if (token) {
      props.onOpenReceipt(token);
      return;
    }

    const contentId = input.trim();
    if (!contentId) {
      setMsg("Paste a link, receipt token, or content ID.");
      return;
    }
    if (!nodeHost) {
      setMsg("Enter a node endpoint to open this content.");
      return;
    }
    const host = nodeHost.replace(/\/$/, "");
    window.location.assign(`${host}/buy/${contentId}`);
  }

  const profileType = diagnostics?.productTier === "advanced" ? "Advanced" : "Basic";
  const productTier = String(diagnostics?.productTier || "basic").toLowerCase();
  const paymentMode = String(diagnostics?.paymentsMode || "wallet").toLowerCase();
  const reachabilityMode =
    diagnostics?.publicStatus?.mode === "named"
      ? "Direct persistent endpoint"
      : diagnostics?.publicStatus?.mode === "quick"
        ? "Fallback-backed temporary endpoint"
        : "Not configured";
  const publicEndpoint = diagnostics?.publicStatus?.url ? String(diagnostics.publicStatus.url) : "Unavailable";
  const discoverability =
    diagnostics?.publicStatus?.status === "online"
      ? "Visible by link"
      : "Offline / not currently reachable";
  const networkService =
    paymentMode === "node"
      ? "This node can provide BOLT11 invoice generation."
      : "This profile can consume network payment services via wallet/fallback mode.";
  const runtimeNodeMode = String(identity?.nodeMode || "").toLowerCase();
  const resolvedNodeMode =
    runtimeNodeMode === "advanced" || runtimeNodeMode === "lan" || runtimeNodeMode === "basic"
      ? runtimeNodeMode
      : productTier === "advanced"
        ? "advanced"
        : productTier === "lan"
          ? "lan"
          : "basic";
  const nodeModeLabel =
    resolvedNodeMode === "advanced"
      ? "Advanced"
      : resolvedNodeMode === "lan"
        ? "LAN"
        : "Basic (tunnel-backed)";
  const fallbackServiceRoleLabel =
    paymentMode === "node" && resolvedNodeMode === "advanced"
      ? "Providing invoice infrastructure"
      : "Creator";
  const fallbackVisibilitySummary =
    diagnostics?.publicStatus?.status === "online"
      ? "Direct Link"
      : "Hidden";
  const fallbackPaymentCapabilityLabel =
    paymentMode === "node" ? "Local Lightning invoice minting enabled" : "Tips only";
  const fallbackTunnel = diagnostics?.publicStatus?.mode === "named" || diagnostics?.publicStatus?.mode === "quick";

  const summaryNodeModeLabel =
    networkSummary?.nodeMode === "advanced"
      ? "Advanced"
      : networkSummary?.nodeMode === "lan"
        ? "LAN"
        : networkSummary?.nodeMode === "basic"
          ? "Basic (tunnel-backed)"
          : nodeModeLabel;
  const summaryVisibility =
    networkSummary?.visibility === "LISTED"
      ? "Discoverable"
      : networkSummary?.visibility === "UNLISTED"
        ? "Direct Link"
        : networkSummary?.visibility === "DISABLED"
          ? "Hidden"
          : fallbackVisibilitySummary;
  const summaryServiceRole = networkSummary
    ? networkSummary.serviceRoles.hybrid
      ? "Creator + invoice provider"
      : networkSummary.serviceRoles.invoiceProvider
        ? "Providing invoice infrastructure"
        : "Creator"
    : fallbackServiceRoleLabel;
  const summaryPaymentCapability = networkSummary
    ? networkSummary.paymentCapability.localInvoiceMinting
      ? "Local Lightning invoice minting enabled"
      : networkSummary.paymentCapability.delegatedInvoiceSupport
        ? "Delegated invoice infrastructure enabled"
        : networkSummary.paymentCapability.tipsOnly
          ? "Tips only"
          : "Unavailable"
    : fallbackPaymentCapabilityLabel;
  const summaryPublicEndpoint = networkSummary?.reachability?.publicUrl || publicEndpoint;
  const summaryTunnel = networkSummary ? networkSummary.reachability.tunnel : fallbackTunnel;
  const summaryIpfsEnabled = networkSummary ? networkSummary.reachability.ipfs : false;
  const summaryReachabilityMode = networkSummary
    ? networkSummary.reachability.publicUrl
      ? "Public route available"
      : "No active public route"
    : reachabilityMode;
  const summaryNetworkService = networkSummary
    ? networkSummary.serviceRoles.hybrid || networkSummary.serviceRoles.invoiceProvider
      ? "This node can serve invoice-generation infrastructure."
      : "This profile participates as a creator network identity."
    : networkService;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Network</div>
        <div className="text-sm text-neutral-400 mt-1">
          Your Certifyd Creator Profile is your network identity. Endpoint URLs may change, identity does not.
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Network Summary</div>
          <div className="mt-2 grid gap-2 text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Identity</span>
              <span className="text-neutral-200 text-right">Certifyd Creator Profile active</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Reachability</span>
              <span className="text-neutral-200 text-right">{summaryReachabilityMode}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Payment</span>
              <span className="text-neutral-200 text-right">{summaryPaymentCapability}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Node Mode</span>
              <span className="text-neutral-200 text-right">{summaryNodeModeLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-3 border-b border-neutral-900 pb-2">
              <span className="text-neutral-500">Service Role</span>
              <span className="text-neutral-200 text-right">{summaryServiceRole}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-neutral-500">Visibility</span>
              <span className="text-neutral-200 text-right">
                {summaryVisibility} <span className="text-neutral-500">(per-content states: Hidden / Direct Link / Discoverable)</span>
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Identity</div>
            <div className="mt-1 text-sm text-neutral-200">Certifyd Creator Profile</div>
            <div className="text-xs text-neutral-400 mt-1">Profile type: {profileType}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Payment Capability</div>
            <div className="mt-1 text-sm text-neutral-200">{summaryPaymentCapability}</div>
            <div className="text-xs text-neutral-400 mt-1">{summaryNetworkService}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Reachability</div>
            <div className="mt-1 text-sm text-neutral-200">{summaryReachabilityMode}</div>
            <div className="text-xs text-neutral-400 mt-1 break-all">{summaryPublicEndpoint}</div>
            <div className="text-xs text-neutral-500 mt-1">Tunnel: {summaryTunnel ? "yes" : "no"}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Discoverability</div>
            <div className="mt-1 text-sm text-neutral-200">{discoverability}</div>
            <div className="text-xs text-neutral-400 mt-1">
              Network discovery is link-first in v1. Explorer/search surfaces come later.
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Network Services</div>
          <div className="mt-1 text-sm text-neutral-200">{summaryNetworkService}</div>
          <div className="text-xs text-neutral-400 mt-1">
            Service roles can evolve without changing the creator identity root.
          </div>
          <div className="mt-3 rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Content Distribution</div>
            <div className="mt-1 text-xs text-neutral-300">Primary route: {summaryTunnel ? "Tunnel endpoint" : "Direct endpoint"}</div>
            <div className="text-xs text-neutral-500">Fallback route: IPFS ({summaryIpfsEnabled ? "enabled" : "planned"})</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-500">Provider Configuration</div>
          <div className="mt-1 text-xs text-neutral-400">
            Configure a trusted network provider for future delegated invoice infrastructure. Saving a provider here does not enable delegated purchases by itself.
          </div>
          <div className="mt-2 text-xs">
            {networkSummary?.providerBinding?.configured
              ? "Provider configured, but delegated invoice support is not active yet."
              : "No provider configured."}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-node-id">Provider Node ID</label>
              <input
                id="provider-node-id"
                name="providerNodeId"
                value={providerConfig?.providerNodeId || ""}
                onChange={(e) => updateProviderField("providerNodeId", e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="off"
                disabled={providerLoading || providerSaving}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-profile-id">Provider Profile ID (optional)</label>
              <input
                id="provider-profile-id"
                name="providerProfileId"
                value={providerConfig?.providerProfileId || ""}
                onChange={(e) => updateProviderField("providerProfileId", e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="off"
                disabled={providerLoading || providerSaving}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-url">Provider URL</label>
              <input
                id="provider-url"
                name="providerUrl"
                value={providerConfig?.providerUrl || ""}
                onChange={(e) => updateProviderField("providerUrl", e.target.value)}
                placeholder="https://provider.example.com"
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="url"
                disabled={providerLoading || providerSaving}
              />
            </div>
            <div>
              <label className="text-xs text-neutral-500" htmlFor="provider-pubkey">Provider Public Key (optional)</label>
              <input
                id="provider-pubkey"
                name="providerPubKey"
                value={providerConfig?.providerPubKey || ""}
                onChange={(e) => updateProviderField("providerPubKey", e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="off"
                disabled={providerLoading || providerSaving}
              />
            </div>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-neutral-300" htmlFor="provider-enabled">
            <input
              id="provider-enabled"
              name="providerEnabled"
              type="checkbox"
              checked={Boolean(providerConfig?.enabled)}
              onChange={(e) => updateProviderField("enabled", e.target.checked)}
              disabled={providerLoading || providerSaving}
            />
            Enabled
          </label>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveProviderConfig}
              disabled={providerLoading || providerSaving || !providerConfig}
              className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 disabled:opacity-50"
            >
              {providerSaving ? "Saving..." : "Save provider"}
            </button>
            {providerMsg ? <div className="text-xs text-emerald-300">{providerMsg}</div> : null}
            {providerErr ? <div className="text-xs text-rose-300">{providerErr}</div> : null}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-sm" htmlFor="store-buy-link">
            Open by link / receipt / content ID
          </label>
          <input
            id="store-buy-link"
            name="storeBuyLink"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a Certifyd Creator link, receipt link/token, or content ID"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
            autoComplete="off"
          />
          <div className="text-xs text-neutral-500">
            Examples: https://node.site/buy/CONTENT_ID · https://node.site/public/receipts/TOKEN · TOKEN
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-neutral-500" htmlFor="store-seller-host">
                Node endpoint (if you pasted only a content ID)
              </label>
              <input
                id="store-seller-host"
                name="storeSellerHost"
                value={nodeHost}
                onChange={(e) => setNodeHost(e.target.value)}
                placeholder="https://node.site"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                autoComplete="url"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={onOpen}
                className="w-full text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
              >
                Open route
              </button>
            </div>
          </div>
          {msg ? <div className="text-xs text-amber-300">{msg}</div> : null}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6 opacity-80">
        <div className="text-lg font-semibold">Network discovery (Coming soon)</div>
        <div className="text-sm text-neutral-400 mt-1">
          Discovery layers will build on verified identity, reachability, and capability signals. Direct links work today.
        </div>
        <div className="mt-4 grid gap-3">
          <label className="sr-only" htmlFor="store-search">
            Search
          </label>
          <input
            id="store-search"
            name="storeSearch"
            disabled
            placeholder="Search"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 opacity-50"
            autoComplete="off"
          />
          <div className="grid grid-cols-2 gap-2">
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Music
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Video
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Books
            </button>
            <button disabled className="rounded-lg border border-neutral-800 px-3 py-2 text-xs opacity-50">
              Files
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
