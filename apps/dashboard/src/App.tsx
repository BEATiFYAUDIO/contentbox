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
import FinancePage, { type FinanceTab } from "./pages/FinancePage";
import ProfilePage from "./pages/ProfilePage";
import { api } from "./lib/api";
import { clearToken, getToken } from "./lib/auth";
import { fetchIdentityDetail, type IdentityDetail } from "./lib/identity";
import { modeLabel } from "./lib/nodeMode";
import { PAYOUT_DESTINATIONS_LABEL } from "./lib/terminology";
import logo from "./assets/InShot_20260201_011901479.png";
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
  | "finance"
  | "receipt"
  | "invite"
  | "profile"
  | "royalties-terms";

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

/* =======================
   App Component
======================= */

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState<string | null>(() => {
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

  const forceLogin = (message: string) => {
    try {
      window.localStorage.setItem("contentbox.authNotice", message);
    } catch {}
    setAuthNotice(message);
    clearToken();
    setMe(null);
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIdentityDetail(null);
      setPublicStatus(null);
      return;
    }
    let alive = true;
    const refresh = () => {
      refreshIdentityDetail();
      api("/api/diagnostics/status", "GET")
        .then((d: any) => {
          if (!alive) return;
          setDiagnosticsStatus(d || null);
          setPublicStatus(d?.publicStatus || null);
        })
        .catch(() => {
          if (!alive) return;
          setDiagnosticsStatus(null);
          setPublicStatus(null);
        });
    };
    refresh();
    const t = window.setInterval(refresh, 30000);
    return () => {
      alive = false;
      window.clearInterval(t);
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
    if (tokenFromUrl) {
      setInviteToken(tokenFromUrl);  // Set token when found
      setPage("invite");  // Show InvitePage directly
    }
    const receiptFromUrl = getReceiptTokenFromLocation();
    if (!tokenFromUrl && receiptFromUrl) {
      setReceiptToken(receiptFromUrl);
      setPage("receipt");
    }
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (!tokenFromUrl && !receiptFromUrl) {
      if (parts[0] === "config") setPage("config");
      else if (parts[0] === "diagnostics") setPage("diagnostics");
      else if (parts[0] === "finance" || parts[0] === "revenue") setPage("finance");
      else {
        // Always land on Content after refresh (ignore prior path)
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

  // Show loading state or Auth page if not logged in
  if (loading) {
    return <div className="min-h-screen bg-neutral-950 text-neutral-200 p-6">Loading…</div>;
  }

  if (!me && inviteToken === null) {
    return <AuthPage onAuthed={loadMe} notice={authNotice} />;
  }

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
  const capabilityReasons = identityDetail?.capabilityReasons || {};
  const namedReady = diagnosticsStatus?.namedReady ?? identityDetail?.namedReady;
  const advancedInactive = productTier === "advanced" && !namedReady;

  // Navigation options for the sidebar
  const accessNav = [
    { key: "store" as const, label: "Store (Link)", hint: "Buy from a link" },
    { key: "library" as const, label: "Library", hint: "What I own" },
    { key: "downloads" as const, label: "Downloads", hint: "Get your files" },
    { key: "purchases" as const, label: "Purchase history", hint: "Receipts + status" }
  ];

  const contentNav = [
    { key: "content" as const, label: "Content", hint: "Your catalog" }
  ];

  const royaltiesNav = [
    { key: "participations" as const, label: "My Royalties", hint: "Royalties I'm in", requiresSplits: false },
    { key: "splits" as const, label: "Manage Splits", hint: "Draft, lock, history", requiresSplits: true },
    { key: "invite" as const, label: "Split Invites", hint: "Split requests", requiresSplits: true }
  ].filter((item) => {
    if (!item.requiresSplits) return true;
    if (advancedInactive) return false;
    return true;
  });

  const identityNav = [
    { key: "profile" as const, label: "Profile", hint: "Identity" }
  ];

  const advancedNav = [
    { key: "finance" as const, label: "Revenue", hint: "Sales, royalties, payouts" },
    { key: "config" as const, label: "Config", hint: "Networking + system" },
    { key: "diagnostics" as const, label: "Diagnostics", hint: "Connectivity tests" }
  ];

  const pageTitle =
    page === "config" ? "Config" :
    page === "diagnostics" ? "Diagnostics" :
    page === "library" ? "Library" :
    page === "store" ? "Store (Direct link)" :
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
    page === "content" ? "Content library" :
    page === "receipt" ? "Receipt" :
    page === "invite" ? "Invite" : "Dashboard";

  const showAdvancedLocked =
    advancedInactive && (page === "splits" || page === "invite" || page === "split-editor");
  const advancedCtaLabel =
    publicStatus?.mode === "named" && publicStatus?.status !== "online"
      ? "Bring named link online"
      : "Configure named link";

  const hideSidebar = Boolean(inviteToken && !me);

  return (
    <div className="h-screen overflow-hidden bg-neutral-950 text-neutral-100 flex">
      {/* Sidebar */}
      {!hideSidebar && (
        <aside className="w-64 border-r border-neutral-900 bg-neutral-950/60 p-4 h-screen shrink-0 flex flex-col">
          <div className="flex items-center justify-center pt-2 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="Contentbox" className="w-full max-w-[180px] h-auto" />
          </div>
          <div className="text-xs text-neutral-400 mt-1 text-center">Local-first publishing</div>

          <div className="mt-6 flex-1 overflow-y-auto hide-scrollbar pr-1">
            <div>
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
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Access</div>
              <div className="space-y-1">
              {accessNav.map((item) => {
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
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Royalties</div>
              <div className="space-y-1">
              {royaltiesNav.map((item: any) => {
                const active = item.key === page;
                const locked = item.requiresSplits && !capabilities.useSplits;
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
                      {locked ? (capabilityReasons.splits || lockReasons.advanced_splits) : item.hint}
                    </div>
                  </button>
                );
              })}
              {productTier === "basic" ? (
                <div className="text-[11px] text-neutral-500 px-3 py-1">
                  Advanced features are locked in Basic mode.
                </div>
              ) : null}
              </div>
            </div>

            <div className="mt-4 border-t border-neutral-900 pt-4">
              <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Identity</div>
              <div className="space-y-1">
              {identityNav.map((item) => {
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
            {showAdvancedNav && (
              <div className="mt-4 border-t border-neutral-900 pt-4">
                <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-neutral-500">Advanced</div>
                <div className="space-y-1">
                {advancedNav.map((item) => {
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
                {me.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.avatarUrl} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
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
      <div className="flex-1 min-w-0 overflow-y-auto">
        <header className="px-6 py-4 border-b border-neutral-900 space-y-2">
          <div className="text-sm text-neutral-400">Dashboard</div>
          <div className="text-xl font-semibold">{pageTitle}</div>
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
                    <span className="text-amber-300">Advanced requires a permanent named link to activate sovereign features</span>
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
              {publicStatus?.url ? (
                <>
                  <button
                    onClick={() => window.open(String(publicStatus.url), "_blank", "noopener,noreferrer")}
                    className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                  >
                    Open public link
                  </button>
                  <button
                    onClick={() => {
                      if (publicStatus?.url) {
                        navigator.clipboard.writeText(String(publicStatus.url)).catch(() => {});
                      }
                    }}
                    className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                  >
                    Copy public link
                  </button>
                </>
              ) : null}
              {productTier === "advanced" && publicStatus?.mode !== "named" ? (
                <button
                  onClick={() => setPage("config")}
                  className="text-xs rounded-full border border-neutral-800 px-3 py-1 hover:bg-neutral-900/30"
                >
                  Set up named link
                </button>
              ) : null}
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
                <span>Logged in as: {me?.email || "unknown"}</span>
              </div>
            </div>
          ) : null}
        </header>

        {advancedInactive ? (
            <div className="mx-6 mt-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                Advanced requires a permanent named link to activate sovereign features.
              </div>
              <button
                onClick={() => setPage("config")}
                className="text-xs rounded-lg border border-amber-800 px-2 py-1 hover:bg-amber-900/30"
              >
                {advancedCtaLabel}
              </button>
            </div>
          ) : null}

        <main className="p-6 max-w-5xl">
          {showAdvancedLocked ? (
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-6 text-sm text-amber-200">
              <div className="text-lg font-semibold mb-2">Advanced not active</div>
              <div className="mb-3">
                Advanced requires a permanent named link to activate sovereign features.
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

              {page === "participations" && (
                <SplitParticipationsPage
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                />
              )}

              {page === "royalties-terms" && <RoyaltiesTermsPage contentId={selectedContentId} />}

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
                  onOpenPayments={() => {
                    window.location.hash = "#payments";
                    setPage("profile");
                  }}
                />
              )}
              {page === "diagnostics" && <DiagnosticsPage />}

              {page === "finance" && (
                <ErrorBoundary>
                  <FinancePage initialTab={financeTab} />
                </ErrorBoundary>
              )}

              {page === "sales" && <SalesPage />}

              {page === "receipt" && receiptToken && <ReceiptPage token={receiptToken} />}

              {/* Render InvitePage if the page is 'invite' */}
              {page === "invite" && (
                <InvitePage
                  token={inviteToken ?? undefined}
                  onAccepted={onAccepted}
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  capabilityReasons={capabilityReasons}
                />
              )}

              {page === "payouts" && <PayoutRailsPage />}

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
                    window.history.pushState({}, "", `/splits/${contentId}`);
                    setSelectedContentId(contentId);
                    setPage("split-editor");
                  }}
                />
              )}

              {page === "splits" && (
                <SplitsPage
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  capabilityReasons={capabilityReasons}
                  onEditContent={(id) => {
                    window.history.pushState({}, "", `/splits/${id}`);
                    setSelectedContentId(id);
                    setPage("split-editor");
                  }}
                />
              )}

              {page === "split-editor" && (
                <SplitEditorPage
                  identityLevel={identityLevel}
                  features={features}
                  lockReasons={lockReasons}
                  capabilities={capabilities}
                  capabilityReasons={capabilityReasons}
                  contentId={selectedContentId}
                  onGoToPayouts={() => setPage("payouts")}
                  onNotFound={() => {
                    window.history.pushState({}, "", "/content");
                    setSelectedContentId(null);
                    setPage("content");
                  }}
                />
              )}

              {page === "profile" && (
                <ProfilePage
                  me={me}
                  setMe={setMe}
                  identityDetail={identityDetail}
                  onOpenParticipations={() => {
                    window.history.pushState({}, "", "/participations");
                    setPage("participations");
                  }}
                  onIdentityRefresh={refreshIdentityDetail}
                  onForceLogin={forceLogin}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
