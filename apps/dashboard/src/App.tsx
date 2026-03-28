import { useEffect, useState } from "react";
import AuthPage from "./pages/AuthPage";
import PayoutRailsPage from "./pages/PayoutRailsPage";
import ContentLibraryPage from "./pages/ContentLibraryPage";
import SplitsPage from "./pages/SplitsPage";
import SplitEditorPage from "./pages/SplitEditorPage";
import InvitePage from "./pages/InvitePage"; // Ensure this is imported
import StorePage from "./pages/StorePage";
import LibraryPage from "./pages/LibraryPage";
import SplitParticipationsPage from "./pages/SplitParticipationsPage";
import RoyaltiesTermsPage from "./pages/RoyaltiesTermsPage";
import DownloadsPage from "./pages/DownloadsPage";
import PurchasesPage from "./pages/PurchasesPage";
import CreatorToolsPage from "./pages/CreatorToolsPage";
import ReceiptPage from "./pages/ReceiptPage";
import SalesPage from "./pages/SalesPage";
import ConfigPage from "./pages/ConfigPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import ProviderConsolePage from "./pages/ProviderConsolePage";
import FinancePage, { type FinanceTab } from "./pages/FinancePage";
import ProfilePage from "./pages/ProfilePage";
import NodeLightningPage from "./pages/NodeLightningPage";
import { api, getApiBase } from "./lib/api";
import { clearToken, getToken } from "./lib/auth";
import { fetchIdentityDetail, type IdentityDetail } from "./lib/identity";
import { modeLabel } from "./lib/nodeMode";
import { PAYOUT_DESTINATIONS_LABEL } from "./lib/terminology";
import logo from "./assets/certifyd-creator-logo.png";
import ErrorBoundary from "./components/ErrorBoundary";

/* =======================
   Types
======================= */

type Me = {
  id: string;
  email: string;
  displayName: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
  useNodeRails?: boolean | null;
};

type WhoamiInfo = {
  nodeId?: string | null;
  startedAt?: string | null;
  db?: {
    name?: string | null;
    addr?: string | null;
    port?: number | null;
  } | null;
};

type NodeModeSnapshot = {
  commerceAuthorityAvailable?: boolean;
  providerCommerceConnected?: boolean;
  localSovereignReady?: boolean;
  modeReadiness?: {
    localLndReady?: boolean;
  };
};

type LightningAdminSnapshot = {
  configured: boolean;
  runtime?: {
    connected?: boolean;
    canReceive?: boolean;
    canSend?: boolean;
    capabilityState?: string;
    sendFailureReason?: string | null;
    source?: string;
  };
};

type FinancePostureSnapshot = {
  providerCommerceConnected?: boolean;
  localSovereignReady?: boolean;
};

type PageKey =
  | "library"
  | "store"
  | "downloads"
  | "participations"
  | "purchases"
  | "creator"
  | "content"
  | "splits"
  | "split-editor"
  | "payouts"
  | "sales"
  | "config"
  | "diagnostics"
  | "provider-console"
  | "finance"
  | "receipt"
  | "invite"
  | "profile"
  | "royalties-terms"
  | "node-lightning"
  | "revenue-lightning";

/* =======================
   Helpers
======================= */

// Function to extract invite token from URL
function getInviteTokenFromLocation(): string | null {
  // path: /invite/<token>
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "invite" && typeof parts[1] === "string") {
    return parts[1];
  }

  // hash: #/invite/<token> or #invite=<token>
  try {
    const h = window.location.hash || "";
    if (h.startsWith("#")) {
      const hash = h.slice(1);
      const hp = hash.split("/").filter(Boolean);
      if (hp[0] === "invite" && typeof hp[1] === "string") return decodeURIComponent(hp[1]);
      const m = hash.match(/token=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
  } catch {
    // ignore
  }

  return null;
}

function normalizeAvatarUrl(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const apiBase = getApiBase().replace(/\/+$/, "");
  if (value.startsWith("/public/avatars/")) {
    return `${apiBase}${value}`;
  }
  try {
    const u = new URL(value);
    if (u.pathname.startsWith("/public/avatars/")) {
      return `${apiBase}${u.pathname}${u.search || ""}`;
    }
  } catch {}
  return value;
}

function getReceiptTokenFromLocation(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "receipt" && typeof parts[1] === "string") {
    return parts[1];
  }
  try {
    const h = window.location.hash || "";
    if (h.startsWith("#")) {
      const hash = h.slice(1);
      const hp = hash.split("/").filter(Boolean);
      if (hp[0] === "receipt" && typeof hp[1] === "string") return decodeURIComponent(hp[1]);
    }
  } catch {
    // ignore
  }
  return null;
}

function getSplitEditorContentIdFromLocation(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  // canonical route: /content/:contentId/splits
  if (parts[0] === "content" && parts[2] === "splits" && typeof parts[1] === "string") {
    const contentId = decodeURIComponent(parts[1]).trim();
    return contentId || null;
  }
  // legacy compatibility: /splits/:contentId
  if (parts[0] === "splits" && typeof parts[1] === "string") {
    const contentId = decodeURIComponent(parts[1]).trim();
    return contentId || null;
  }
  return null;
}

function getRoyaltiesTermsContentIdFromLocation(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  // route: /royalties/:contentId
  if (parts[0] === "royalties" && typeof parts[1] === "string") {
    const contentId = decodeURIComponent(parts[1]).trim();
    return contentId || null;
  }
  return null;
}

function normalizePublicProfileHandle(value: unknown): string | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const collapsed = raw.replace(/\s+/g, "-");
  const clean = collapsed
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return clean || null;
}

function getFinanceTabFromLocation(): FinanceTab | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "earnings-v2") return "earnings-v2";
  return null;
}

/* =======================
   App Component
======================= */

export default function App() {
  const devApiUrl = getApiBase().replace(/\/$/, "");
  const whoamiProbeEnabled = Boolean((import.meta as any).env?.VITE_ENABLE_WHOAMI);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [authNotice] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem("contentbox.authNotice") || null;
    } catch {
      return null;
    }
  });

  // Define 'page' and 'setPage' for routing
  const [page, setPage] = useState<PageKey>("content");
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [receiptToken, setReceiptToken] = useState<string | null>(null);
  const [financeTab, setFinanceTab] = useState<FinanceTab>("overview");
  const [identityDetail, setIdentityDetail] = useState<IdentityDetail | null>(null);
  const [publicStatus, setPublicStatus] = useState<any | null>(null);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<any | null>(null);
  const [whoamiInfo, setWhoamiInfo] = useState<WhoamiInfo | null>(null);
  const [whoamiStatus, setWhoamiStatus] = useState<"idle" | "disabled" | "ok" | "error">(
    whoamiProbeEnabled ? "idle" : "disabled"
  );
  const [nodeModeSnapshot, setNodeModeSnapshot] = useState<NodeModeSnapshot | null>(null);
  const [lightningAdminSnapshot, setLightningAdminSnapshot] = useState<LightningAdminSnapshot | null>(null);
  const [showAdvancedNav, setShowAdvancedNav] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("contentbox.showAdvancedNav") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const hash = window.location.hash || "";
    if (hash.includes("payments")) {
      setPage("profile");
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !whoamiProbeEnabled) return;
    if (!devApiUrl) {
      setWhoamiStatus("disabled");
      return;
    }
    let cancelled = false;
    fetch(`${devApiUrl}/__whoami`, { method: "GET" })
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setWhoamiStatus("disabled");
          return null;
        }
        if (!res.ok) throw new Error(`whoami ${res.status}`);
        const data = (await res.json()) as WhoamiInfo;
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setWhoamiInfo(data);
          setWhoamiStatus("ok");
        } else {
          setWhoamiStatus("disabled");
        }
      })
      .catch(() => {
        if (!cancelled) setWhoamiStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [devApiUrl, whoamiProbeEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem("contentbox.showAdvancedNav", showAdvancedNav ? "1" : "0");
    } catch {}
  }, [showAdvancedNav]);

  const refreshIdentityDetail = () => {
    fetchIdentityDetail()
      .then((d) => {
        setIdentityDetail(d);
        try {
          window.localStorage.setItem("contentbox.identityDetail", JSON.stringify(d));
        } catch {}
      })
      .catch(() => setIdentityDetail(null));
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIdentityDetail(null);
      setPublicStatus(null);
      setLightningAdminSnapshot(null);
      return;
    }
    let alive = true;
    const refresh = async () => {
      refreshIdentityDetail();
      try {
        const modeSnapshot = await api<NodeModeSnapshot>("/api/node/mode", "GET");
        if (!alive) return;
        setNodeModeSnapshot(modeSnapshot || null);
      } catch {
        if (!alive) return;
        setNodeModeSnapshot(null);
      }
      try {
        const d: any = await api("/api/diagnostics/status", "GET");
        if (!alive) return;
        setDiagnosticsStatus(d || null);
        const diagnosticsPublic = d?.publicStatus || null;
        try {
          const runtimePublic: any = await api("/api/public/status", "GET");
          if (!alive) return;
          setPublicStatus({
            ...diagnosticsPublic,
            ...runtimePublic,
            url: runtimePublic?.canonicalOrigin || runtimePublic?.publicOrigin || diagnosticsPublic?.url || null
          });
        } catch {
          if (!alive) return;
          setPublicStatus(diagnosticsPublic);
        }
      } catch {
        if (!alive) return;
        setDiagnosticsStatus(null);
        setPublicStatus(null);
      }
      try {
        const ln = await api<LightningAdminSnapshot>("/api/admin/lightning", "GET");
        if (!alive) return;
        setLightningAdminSnapshot(ln || null);
      } catch {
        if (!alive) return;
        setLightningAdminSnapshot(null);
      }
    };
    refresh();
    const onFocus = () => {
      refresh();
    };
    window.addEventListener("focus", onFocus);
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refresh();
    }, 30000);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [me?.id]);

  useEffect(() => {
    if (!authNotice) return;
    try {
      window.localStorage.removeItem("contentbox.authNotice");
    } catch {}
  }, [authNotice]);


  // Extract the invite token from the URL when the component mounts
  useEffect(() => {
    const tokenFromUrl = getInviteTokenFromLocation();
    const splitEditorContentId = getSplitEditorContentIdFromLocation();
    const royaltiesTermsContentId = getRoyaltiesTermsContentIdFromLocation();
    const financeTabFromUrl = getFinanceTabFromLocation();
    if (tokenFromUrl) {
      setInviteToken(tokenFromUrl);  // Set token when found
      setPage("invite");  // Show InvitePage directly
    }
    const receiptFromUrl = getReceiptTokenFromLocation();
    if (!tokenFromUrl && receiptFromUrl) {
      setReceiptToken(receiptFromUrl);
      setPage("receipt");
    }
    if (!tokenFromUrl && !receiptFromUrl) {
      if (financeTabFromUrl) {
        setFinanceTab(financeTabFromUrl);
        setPage("finance");
      } else if (splitEditorContentId) {
        setSelectedContentId(splitEditorContentId);
        setPage("split-editor");
      } else if (royaltiesTermsContentId) {
        setSelectedContentId(royaltiesTermsContentId);
        setPage("royalties-terms");
      } else {
        // Canonical refresh route: always land on Content unless this is an
        // explicit deep-link surface (invite/receipt/split editor).
        window.history.replaceState({}, "", "/");
        setPage("content");
      }
    }
    loadMe();  // Load user data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Function to load user data
  async function loadMe() {
    const token = getToken();
    if (!token) {
      setMe(null);
      setLoading(false);
      return;
    }

    try {
      const m = await api<Me>("/me", "GET");
      setMe(m);
    } catch {
      clearToken();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }


  // Callback for when the invite is accepted
  const onAccepted = () => {
    // Reset the invite token and navigate to splits for the content if provided
    setInviteToken(null);
    window.history.pushState({}, "", "/participations");
    setPage("participations");
  };

  const identityLevel = identityDetail?.level || "BASIC";
  const nodeMode = identityDetail?.nodeMode || (identityDetail?.dbMode === "advanced" ? "advanced" : "basic");
  const features = identityDetail?.features || {
    publicShare: false,
    derivatives: false,
    advancedSplits: false,
    multiUser: false
  };
  const lockReasons = identityDetail?.lockReasons || {
    public_share: "Feature locked in this mode.",
    derivatives: "Feature locked in this mode.",
    advanced_splits: "Feature locked in this mode.",
    multi_user: "Feature locked in this mode."
  };
  const productTier =
    diagnosticsStatus?.productTier ||
    identityDetail?.productTier ||
    (nodeMode === "advanced" ? "advanced" : nodeMode === "lan" ? "lan" : "basic");
  const capabilities = identityDetail?.capabilities || {
    useSplits: features.advancedSplits,
    useDerivatives: features.derivatives,
    sendInvite: features.advancedSplits,
    lockSplits: features.advancedSplits,
    publish: true,
    requestClearance: features.derivatives,
    publicShare: features.publicShare,
    proofBundles: features.advancedSplits
  };
  const sovereignCapabilities = identityDetail?.sovereignCapabilities || {
    canActAsSovereignCreator: productTier !== "basic",
    canPublishViaProvider: false,
    canUseProviderBackedCommerce: false,
    canActAsProviderNode: false
  };
  const capabilityReasons = identityDetail?.capabilityReasons || {};
  const advancedInactive = productTier === "advanced" && !sovereignCapabilities.canActAsSovereignCreator;
  const canSeeProviderConsole = Boolean(sovereignCapabilities.canActAsProviderNode && nodeMode === "lan");
  const commerceEnabled = Boolean(nodeModeSnapshot?.commerceAuthorityAvailable);
  const requireLocalLightning = nodeMode === "lan";
  const localLightningDetected = Boolean(
    nodeModeSnapshot?.modeReadiness?.localLndReady ||
      lightningAdminSnapshot?.runtime?.canReceive ||
      lightningAdminSnapshot?.runtime?.canSend ||
      lightningAdminSnapshot?.configured
  );
  const commerceLockedReason = "Connect a commerce provider or run a sovereign node to unlock this.";
  const isCommerceLockedPage =
    !commerceEnabled &&
    (page === "participations" ||
      page === "splits" ||
      page === "split-editor" ||
      page === "invite" ||
      page === "finance" ||
      page === "sales" ||
      page === "payouts" ||
      page === "royalties-terms");

  // Navigation options for the sidebar
  const accountNav = [{ key: "profile" as const, label: "Profile", hint: "Identity" }];

  const contentNav = [
    { key: "content" as const, label: "Catalog", hint: "Your content catalog" },
    { key: "library" as const, label: "Library", hint: "What I own" },
    { key: "downloads" as const, label: "Downloads", hint: "Get your files" }
  ];

  const networkNav = [{ key: "store" as const, label: "Network", hint: "Identity + reachability + links" }];

  const commerceNav = [
    {
      key: "finance" as const,
      label: "Revenue",
      hint: "Sales, royalties, payouts",
      requiresCommerce: true,
      requiresSplits: false,
      requiresAdvanced: true
    },
    {
      key: "participations" as const,
      label: "Royalties",
      hint: "Royalties I'm in",
      requiresCommerce: true,
      requiresSplits: false
    },
    {
      key: "purchases" as const,
      label: "Purchase History",
      hint: "Receipts + status",
      requiresCommerce: false,
      requiresSplits: false
    },
    {
      key: "splits" as const,
      label: "Manage Splits",
      hint: "Draft, lock, history",
      requiresCommerce: true,
      requiresSplits: true
    },
    {
      key: "invite" as const,
      label: "Split Invites",
      hint: "Split requests",
      requiresCommerce: true,
      requiresSplits: true
    }
  ].filter((item) => {
    if (!item.requiresSplits) return true;
    if (advancedInactive) return false;
    return true;
  });

  const advancedNav = [
    { key: "provider-console" as const, label: "Provider Console", hint: "Delegated creators + commerce" },
    { key: "config" as const, label: "Configuration", hint: "Node + tunnel setup" },
    { key: "diagnostics" as const, label: "Diagnostics", hint: "Health + connectivity" }
  ].filter((item) => {
    if (item.key === "provider-console") return canSeeProviderConsole;
    return true;
  });

  const nodeSettingsNav = localLightningDetected
    ? [{ key: "node-lightning" as const, label: "Lightning", hint: "Node payments infrastructure" }]
    : [];

  const pageTitle =
    page === "config" ? "Configuration" :
    page === "diagnostics" ? "Diagnostics" :
    page === "provider-console" ? "Provider Console" :
    page === "node-lightning" ? "Node Settings · Lightning" :
    page === "revenue-lightning" ? "Revenue · Lightning (Legacy Route)" :
    page === "library" ? "Library" :
    page === "store" ? "Network" :
    page === "participations" ? "Royalties" :
    page === "downloads" ? "Downloads" :
    page === "purchases" ? "Purchase history" :
    page === "creator" ? "Creator tools" :
    page === "sales" ? "Sales" :
    page === "finance" ? "Revenue" :
    page === "splits" ? "Splits" :
    page === "split-editor" ? "Splits" :
    page === "profile" ? "Profile" :
    page === "royalties-terms" ? "Split terms" :
    page === "payouts" ? PAYOUT_DESTINATIONS_LABEL :
    page === "content" ? "Content catalog" :
    page === "receipt" ? "Receipt" :
    page === "invite" ? "Invite" : "Dashboard";

  const showAdvancedLocked =
    advancedInactive && (page === "splits" || page === "invite" || page === "split-editor");
  const isOperatorPage = page === "config" || page === "diagnostics" || page === "provider-console";
  const tunnelActive = publicStatus?.status === "online";
  const identityVerified = identityDetail?.level === "PERSISTENT";
  const lightningConfigured =
    (lightningAdminSnapshot?.runtime?.canReceive || lightningAdminSnapshot?.runtime?.canSend || lightningAdminSnapshot?.configured) ?? null;

  function goToNodeLightning() {
    if (!localLightningDetected) {
      setPage("config");
      return;
    }
    window.history.pushState({}, "", "/node/lightning");
    setPage("node-lightning");
  }

  useEffect(() => {
    if (page === "provider-console" && !canSeeProviderConsole) {
      setPage("store");
    }
  }, [page, canSeeProviderConsole]);

  useEffect(() => {
    if (page === "node-lightning" && !localLightningDetected) {
      setPage("config");
    }
  }, [page, localLightningDetected]);

  // Show loading state or Auth page if not logged in
  if (loading) {
    return <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6">Loading…</div>;
  }

  if (!me && inviteToken === null) {
    return <AuthPage onAuthed={loadMe} notice={authNotice} />;
  }
  const advancedCtaLabel =
    publicStatus?.mode === "named" && publicStatus?.status !== "online"
      ? "Bring named link online"
      : "Configure named link";

  const hideSidebar = Boolean(inviteToken && !me);
  const creatorHandle = normalizePublicProfileHandle(me?.displayName || me?.email || "");
  const logoHref = creatorHandle ? `/u/${encodeURIComponent(creatorHandle)}` : "/";
  const creatorProfileHref = creatorHandle ? `/u/${encodeURIComponent(creatorHandle)}` : null;
  const publicStatusOnline = publicStatus?.status === "online";
  const publicCreatorUrl =
    publicStatusOnline && publicStatus?.url
      ? new URL(creatorProfileHref || "/profile", String(publicStatus.url)).toString()
      : null;

  return (
    <div className="h-screen overflow-hidden bg-neutral-950 text-neutral-100 flex">
      {/* Sidebar */}
      {!hideSidebar && (
        <aside className="w-64 border-r border-neutral-900 bg-neutral-950/60 p-4 h-screen shrink-0 flex flex-col">
          <div className="flex items-center justify-center pt-4 pb-3">
            <a href={logoHref} className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div className="w-[214px] h-[140px] overflow-visible flex items-center justify-center">
                <img
                  src={logo}
                  alt="Certifyd Creator"
                  className="w-full h-full object-contain scale-[1.38] origin-center"
                />
              </div>
            </a>
          </div>
          
          <div className="mt-6 flex-1 overflow-y-auto hide-scrollbar pr-1">
            <div>
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Account</div>
              <div className="space-y-1">
              {accountNav.map((item) => {
                const active = item.key === page;
                return (
                  <button
                    key={item.key}
                    onClick={() => setPage(item.key)}
                    className={[
                      "w-full text-left rounded-lg px-3 py-2 transition border",
                      active
                        ? "border-white/30 bg-white/5"
                        : "border-transparent hover:border-neutral-800 hover:bg-neutral-900/30"
                    ].join(" ")}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-neutral-400">{item.hint}</div>
                  </button>
                );
              })}
              </div>
            </div>

            <div className="mt-4 border-t border-neutral-900 pt-4">
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Content</div>
              <div className="space-y-1">
              {contentNav.map((item) => {
                const active = item.key === page;
                return (
                  <button
                    key={item.key}
                    onClick={() => setPage(item.key)}
                    className={[
                      "w-full text-left rounded-lg px-3 py-2 transition border",
                      active
                        ? "border-white/30 bg-white/5"
                        : "border-transparent hover:border-neutral-800 hover:bg-neutral-900/30"
                    ].join(" ")}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-neutral-400">{item.hint}</div>
                  </button>
                );
              })}
              </div>
            </div>

            <div className="mt-4 border-t border-neutral-900 pt-4">
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Network</div>
              <div className="space-y-1">
              {networkNav.map((item) => {
                const active = item.key === page;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setPage(item.key);
                    }}
                    className={[
                      "w-full text-left rounded-lg px-3 py-2 transition border",
                      active
                        ? "border-white/30 bg-white/5"
                        : "border-transparent hover:border-neutral-800 hover:bg-neutral-900/30"
                    ].join(" ")}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-neutral-400">{item.hint}</div>
                  </button>
                );
              })}
              </div>
            </div>

            <div className="mt-4 border-t border-neutral-900 pt-4">
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Commerce</div>
              <div className="space-y-1">
              {commerceNav.map((item: any) => {
                if (item.requiresAdvanced && !showAdvancedNav) return null;
                const active = item.key === page;
                const locked =
                  (item.requiresCommerce && !commerceEnabled) ||
                  (item.requiresSplits && !capabilities.useSplits);
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      if (locked) return;
                      setPage(item.key);
                    }}
                    disabled={locked}
                    className={[
                      "w-full text-left rounded-lg px-3 py-2 transition border",
                      locked
                        ? "border-neutral-900 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                        : active
                          ? "border-white/30 bg-white/5"
                          : "border-transparent hover:border-neutral-800 hover:bg-neutral-900/30"
                    ].join(" ")}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-neutral-400">
                      {locked
                        ? (!commerceEnabled ? commerceLockedReason : (capabilityReasons.splits || lockReasons.advanced_splits))
                        : item.hint}
                    </div>
                  </button>
                );
              })}
              {!commerceEnabled ? (
                <div className="text-[11px] text-neutral-500 px-3 py-1">
                  Commerce features are locked until commerce authority is active.
                </div>
              ) : null}
              </div>
            </div>

            <div className="mt-4 border-t border-neutral-900 pt-4">
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Node</div>
              <div className="space-y-1">
              {nodeSettingsNav.map((item) => {
                const active = item.key === page;
                return (
                  <button
                    key={item.key}
                    onClick={goToNodeLightning}
                    className={[
                      "w-full text-left rounded-lg px-3 py-2 transition border",
                      active
                        ? "border-white/30 bg-white/5"
                        : "border-transparent hover:border-neutral-800 hover:bg-neutral-900/30"
                    ].join(" ")}
                  >
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-neutral-400">{item.hint}</div>
                  </button>
                );
              })}
              </div>
            </div>

            {showAdvancedNav && (
              <div className="mt-4 border-t border-neutral-900 pt-4">
                <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Node (Operator)</div>
                <div className="space-y-1">
                {advancedNav.map((item) => {
                  const active = item.key === page;
                  const locked = false;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        if (locked) return;
                        setPage(item.key);
                      }}
                      disabled={locked}
                      className={[
                        "w-full text-left rounded-lg px-3 py-2 transition border",
                        locked
                          ? "border-neutral-900 bg-neutral-950 text-neutral-600 cursor-not-allowed"
                          : active
                            ? "border-white/30 bg-white/5"
                            : "border-transparent hover:border-neutral-800 hover:bg-neutral-900/30"
                      ].join(" ")}
                    >
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="text-xs text-neutral-400">
                        {locked ? commerceLockedReason : item.hint}
                      </div>
                    </button>
                  );
                })}
                </div>
              </div>
            )}
          </div>

          {me && (
            <div className="pt-4 border-t border-neutral-900">
              <div className="mb-3">
                <button
                  className="w-full text-xs rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                  onClick={() => setShowAdvancedNav((v) => !v)}
                >
                  {showAdvancedNav ? "Hide Advanced" : "Show Advanced"}
                </button>
              </div>
              <div className="text-xs text-neutral-400">Signed in as</div>
              <div className="flex items-center gap-2">
                {normalizeAvatarUrl(me.avatarUrl) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={normalizeAvatarUrl(me.avatarUrl)!} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
                ) : null}
                <div className="text-sm">{me.displayName || me.email}</div>
              </div>

              <button
                className="mt-3 w-full text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                onClick={() => {
                  clearToken();
                  setMe(null);
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </aside>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto overscroll-none">
        <header className="border-b border-neutral-900">
          <div className="mx-auto w-full max-w-screen-2xl px-4 py-4 sm:px-6 space-y-2">
            {import.meta.env.DEV ? (
              <div className="rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                Dashboard Dev Mode. API requests are proxied to the backend. Use the integrated node surface for real network testing.
              </div>
            ) : null}
            <div className="text-sm text-neutral-400">Dashboard</div>
            <div className="text-xl font-semibold">{pageTitle}</div>
            {import.meta.env.DEV ? (
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
                <span>Connected To:</span>
                <span className="font-mono">{devApiUrl || "API base unresolved"}</span>
              </div>
            ) : null}
            {getToken() ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
                  <span>
                    Public:{" "}
                    {(() => {
                      if (productTier === "advanced") {
                        if (publicStatus?.mode === "named") return `Permanent (${publicStatus?.tunnelName || "Named"})`;
                        if (publicStatus?.mode === "quick") return "Temporary (testing only — admin access only)";
                        return "Not configured";
                      }
                      if (publicStatus?.mode === "named") return `Permanent (${publicStatus?.tunnelName || "Named"})`;
                      if (publicStatus?.mode === "quick") return "Temporary (Quick)";
                      return "Not configured";
                    })()}
                  </span>
                  {productTier === "advanced" && publicStatus?.mode !== "named" ? (
                    <>
                      <span className="text-neutral-500">•</span>
                      <span className="text-amber-300">
                        {sovereignCapabilities.canPublishViaProvider
                          ? "Temporary endpoint active. Provider-backed sovereign creator publish is enabled."
                          : "Sovereign creator mode needs a trusted provider or a permanent named link."}
                      </span>
                    </>
                  ) : null}
                  {productTier === "advanced" && !sovereignCapabilities.canActAsProviderNode ? (
                    <>
                      <span className="text-neutral-500">•</span>
                      <span className="text-amber-300">Provider-node infrastructure still requires a permanent named public link.</span>
                    </>
                  ) : null}
                  <span className="text-neutral-500">•</span>
                  <span>
                    {publicStatus?.status === "online"
                      ? "ONLINE"
                      : publicStatus?.status === "starting"
                        ? "STARTING"
                        : publicStatus?.status === "error"
                          ? "ERROR"
                          : publicStatus?.status === "offline"
                            ? "OFFLINE"
                        : "SEARCHING"}
                  </span>
                  <span className="text-neutral-500">•</span>
                  <span className="truncate max-w-[380px]">{publicStatus?.url || publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</span>
                </div>
                {publicStatusOnline && publicStatus?.url ? (
                  <>
                    <button
                      onClick={() =>
                        window.open(
                          publicCreatorUrl || String(publicStatus.url),
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                      className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                    >
                      {publicCreatorUrl ? "Open public profile" : "Open public link"}
                    </button>
                    <button
                      onClick={() => {
                        const copyTarget = publicCreatorUrl || (publicStatus?.url ? String(publicStatus.url) : "");
                        if (copyTarget) {
                          navigator.clipboard.writeText(copyTarget).catch(() => {});
                        }
                      }}
                      className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                    >
                      Copy public link
                    </button>
                  </>
                ) : null}
                {requireLocalLightning ? (
                  <button
                    onClick={goToNodeLightning}
                    className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                  >
                    Configure Lightning
                  </button>
                ) : (
                  <button
                    onClick={() => setPage("store")}
                    className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                  >
                    Provider commerce ready
                  </button>
                )}
                {!publicStatusOnline && publicStatus?.url ? (
                  <div className="text-xs rounded-full border border-amber-900/70 bg-amber-950/30 px-3 py-1 text-amber-200">
                    Public profile link is offline. Bring tunnel online first.
                  </div>
                ) : null}
                {productTier === "advanced" && !sovereignCapabilities.canActAsProviderNode ? (
                  <button
                    onClick={() => setPage("config")}
                    className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                  >
                    Set up named link
                  </button>
                ) : null}
                {isOperatorPage ? (
                  <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
                    <span>
                      Product: {modeLabel(productTier as any)}
                      {advancedInactive ? " (inactive)" : ""}
                    </span>
                    <span className="text-neutral-500">•</span>
                    <span>Payments: {diagnosticsStatus?.paymentsMode || identityDetail?.paymentsMode || (productTier === "advanced" || productTier === "lan" ? "node" : "wallet")}</span>
                    <span className="text-neutral-500">•</span>
                    <span>Storage: {identityDetail?.storage || "unknown"}</span>
                    <span className="text-neutral-500">•</span>
                    <span>Operator: {me?.email || "unknown"}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        {advancedInactive ? (
            <div className="mx-6 mt-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                Sovereign creator mode requires a trusted provider connection or a permanent named link.
              </div>
              <button
                onClick={() => setPage("config")}
                className="text-xs rounded-lg border border-amber-800 px-2 py-1 hover:bg-amber-900/30"
              >
                {advancedCtaLabel}
              </button>
            </div>
          ) : null}

        <main className="mx-auto w-full max-w-screen-2xl p-4 sm:p-6">
          {showAdvancedLocked ? (
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-6 text-sm text-amber-200">
              <div className="text-lg font-semibold mb-2">Advanced not active</div>
              <div className="mb-3">
                Sovereign creator mode requires a trusted provider connection or a permanent named link.
              </div>
              <button
                onClick={() => setPage("config")}
                className="text-xs rounded-lg border border-amber-800 px-3 py-1 hover:bg-amber-900/30"
              >
                Configure named link
              </button>
            </div>
          ) : (
            <>
              {page === "library" && <LibraryPage />}

              {page === "store" && <StorePage onOpenReceipt={(t) => { setReceiptToken(t); setPage("receipt"); }} />}

              {isCommerceLockedPage ? (
                <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-6 text-sm text-amber-200">
                  <div className="text-lg font-semibold mb-2">Commerce features locked</div>
                  <div className="mb-3">{commerceLockedReason}</div>
                  <div className="text-xs text-amber-300/90">
                    Storefront remains active for publishing, preview, and tipping.
                  </div>
                  {requireLocalLightning ? (
                    <button
                      onClick={goToNodeLightning}
                      className="mt-3 text-xs rounded-lg border border-amber-800 px-3 py-1 hover:bg-amber-900/30"
                    >
                      Configure Lightning
                    </button>
                  ) : (
                    <button
                      onClick={() => setPage("store")}
                      className="mt-3 text-xs rounded-lg border border-amber-800 px-3 py-1 hover:bg-amber-900/30"
                    >
                      Open provider commerce status
                    </button>
                  )}
                </div>
              ) : null}

              {page === "participations" && !isCommerceLockedPage && (
                <SplitParticipationsPage
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  nodeMode={nodeMode}
                />
              )}

              {page === "royalties-terms" && !isCommerceLockedPage && <RoyaltiesTermsPage contentId={selectedContentId} />}

              {page === "downloads" && <DownloadsPage />}

              {page === "purchases" && <PurchasesPage onOpenReceipt={(t) => { setReceiptToken(t); setPage("receipt"); }} />}

              {page === "creator" && (
                <CreatorToolsPage
                  onOpenContent={() => setPage("content")}
                  onOpenSplits={() => setPage("splits")}
                  onOpenSales={() => { setFinanceTab("ledger"); setPage("finance"); }}
                  onOpenPayments={() => { setFinanceTab("payouts"); setPage("finance"); }}
                />
              )}

              {page === "config" && (
                <ConfigPage
                  showAdvanced={showAdvancedNav}
                  onIdentityRefresh={refreshIdentityDetail}
                  onOpenPayments={() => {
                    window.location.hash = "#payments";
                    setPage("profile");
                  }}
                />
              )}
              {page === "diagnostics" && <DiagnosticsPage whoamiInfo={whoamiInfo} whoamiStatus={whoamiStatus} />}
              {page === "provider-console" && <ProviderConsolePage onOpenLightningConfig={() => setPage("config")} />}

              {page === "finance" && !isCommerceLockedPage && (
                <ErrorBoundary>
                  <FinancePage
                    initialTab={financeTab}
                    nodeMode={nodeMode}
                    postureSnapshot={
                      nodeModeSnapshot
                        ? ({
                            providerCommerceConnected: nodeModeSnapshot.providerCommerceConnected,
                            localSovereignReady: nodeModeSnapshot.localSovereignReady
                          } satisfies FinancePostureSnapshot)
                        : null
                    }
                  />
                </ErrorBoundary>
              )}

              {page === "node-lightning" && (
                <NodeLightningPage
                  tunnelActive={publicStatus ? tunnelActive : null}
                  identityVerified={identityDetail ? identityVerified : null}
                  lightningConfigured={lightningConfigured}
                  onOpenPrimaryRoute={goToNodeLightning}
                />
              )}

              {page === "revenue-lightning" && (
                <NodeLightningPage
                  legacyRoute
                  tunnelActive={publicStatus ? tunnelActive : null}
                  identityVerified={identityDetail ? identityVerified : null}
                  lightningConfigured={lightningConfigured}
                  onOpenPrimaryRoute={goToNodeLightning}
                />
              )}

              {page === "sales" && !isCommerceLockedPage && <SalesPage productTier={productTier} disabled={!commerceEnabled} />}

              {page === "receipt" && receiptToken && <ReceiptPage token={receiptToken} />}

              {/* Render InvitePage if the page is 'invite' */}
              {page === "invite" && !isCommerceLockedPage && (
                <InvitePage
                  token={inviteToken ?? undefined}
                  onAccepted={onAccepted}
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  capabilityReasons={capabilityReasons}
                  nodeMode={nodeMode}
                />
              )}

              {page === "payouts" && !isCommerceLockedPage && <PayoutRailsPage />}

              {page === "content" && (
                <ContentLibraryPage
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  capabilityReasons={capabilityReasons}
                  productTier={productTier}
                  currentUserEmail={me?.email || null}
                  onOpenSplits={(contentId) => {
                    window.history.pushState({}, "", `/content/${encodeURIComponent(contentId)}/splits`);
                    setSelectedContentId(contentId);
                    setPage("split-editor");
                  }}
                />
              )}

              {page === "splits" && !isCommerceLockedPage && (
                <SplitsPage
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  capabilityReasons={capabilityReasons}
                  nodeMode={nodeMode}
                  onEditContent={(id) => {
                    window.history.pushState({}, "", `/content/${encodeURIComponent(id)}/splits`);
                    setSelectedContentId(id);
                    setPage("split-editor");
                  }}
                />
              )}

              {page === "split-editor" && !isCommerceLockedPage && (
                <SplitEditorPage
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  capabilityReasons={capabilityReasons}
                  contentId={selectedContentId}
                  onGoToPayouts={() => setPage("payouts")}
                />
              )}

              {page === "profile" && (
                <ProfilePage
                  me={me}
                  setMe={setMe}
                  identityDetail={identityDetail}
                  requireLocalLightning={requireLocalLightning}
                  onOpenParticipations={() => {
                    window.history.pushState({}, "", "/participations");
                    setPage("participations");
                  }}
                  onOpenNodeLightning={goToNodeLightning}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
