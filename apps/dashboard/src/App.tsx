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

function getSplitContentIdFromLocation(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "splits" && typeof parts[1] === "string") {
    return parts[1];
  }
  try {
    const h = window.location.hash || "";
    if (h.startsWith("#")) {
      const hash = h.slice(1);
      const hp = hash.split("/").filter(Boolean);
      if (hp[0] === "splits" && typeof hp[1] === "string") return decodeURIComponent(hp[1]);
    }
  } catch {
    // ignore
  }
  return null;
}

function getRoyaltiesContentIdFromLocation(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "royalties" && typeof parts[1] === "string") {
    return parts[1];
  }
  try {
    const h = window.location.hash || "";
    if (h.startsWith("#")) {
      const hash = h.slice(1);
      const hp = hash.split("/").filter(Boolean);
      if (hp[0] === "royalties" && typeof hp[1] === "string") return decodeURIComponent(hp[1]);
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

  // Define 'page' and 'setPage' for routing
  const [page, setPage] = useState<PageKey>("content");
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [receiptToken, setReceiptToken] = useState<string | null>(null);
  const [financeTab, setFinanceTab] = useState<FinanceTab>("overview");
  const [identityDetail, setIdentityDetail] = useState<IdentityDetail | null>(null);
  const [publicStatus, setPublicStatus] = useState<any | null>(null);
  const [showAdvancedNav, setShowAdvancedNav] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("contentbox.showAdvancedNav") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("contentbox.showAdvancedNav", showAdvancedNav ? "1" : "0");
    } catch {}
  }, [showAdvancedNav]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setIdentityDetail(null);
      setPublicStatus(null);
      return;
    }
    let alive = true;
    const refresh = () => {
      fetchIdentityDetail()
        .then((d) => {
          if (!alive) return;
          setIdentityDetail(d);
          try {
            window.localStorage.setItem("contentbox.identityDetail", JSON.stringify(d));
          } catch {}
        })
        .catch(() => alive && setIdentityDetail(null));
      api("/api/public/status", "GET")
        .then((d: any) => alive && setPublicStatus(d))
        .catch(() => alive && setPublicStatus(null));
    };
    refresh();
    const t = window.setInterval(refresh, 30000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [me?.id]);

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
    const splitFromUrl = getSplitContentIdFromLocation();
    const royaltiesFromUrl = getRoyaltiesContentIdFromLocation();
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
    return <AuthPage onAuthed={loadMe} />;
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
  const isBasicMode = nodeMode === "basic";

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
    { key: "participations" as const, label: "My Royalties", hint: "Royalties I'm in", advanced: true },
    { key: "splits" as const, label: "Manage Splits", hint: "Draft, lock, history", advanced: true },
    { key: "invite" as const, label: "Split Invites", hint: "Split requests", advanced: true }
  ];

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
                const locked = !features.advancedSplits && item.advanced;
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
                      {locked ? lockReasons.advanced_splits : item.hint}
                    </div>
                  </button>
                );
              })}
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
                Public Identity:{" "}
                {publicStatus?.mode === "named"
                  ? `Permanent (${publicStatus?.tunnelName || "Named"})`
                  : publicStatus?.mode === "quick"
                    ? "Temporary (Quick)"
                    : identityDetail?.level === "PERSISTENT"
                      ? "Permanent (Named)"
                      : "Temporary (Quick)"}
              </span>
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
              <span className="truncate max-w-[380px]">{publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</span>
            </div>
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
              <span>Mode: {modeLabel(nodeMode)}</span>
              <span className="text-neutral-500">•</span>
              <span>Storage: {identityDetail?.storage || "unknown"}</span>
              <span className="text-neutral-500">•</span>
              <span>Logged in as: {me?.email || "unknown"}</span>
            </div>
            </div>
          ) : null}
        </header>

        {isBasicMode ? (
          <div className="mx-6 mt-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            {lockReasons.advanced_splits} {lockReasons.derivatives} {lockReasons.public_share}
          </div>
        ) : null}

        <main className="p-6 max-w-5xl">
          {page === "library" && <LibraryPage />}

          {page === "store" && <StorePage onOpenReceipt={(t) => { setReceiptToken(t); setPage("receipt"); }} />}

          {page === "participations" && (
            <SplitParticipationsPage identityLevel={identityLevel} features={features} lockReasons={lockReasons} />
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

          {page === "config" && <ConfigPage showAdvanced={showAdvancedNav} />}
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
            />
          )}

          {page === "payouts" && <PayoutRailsPage />}

          {page === "content" && (
            <ContentLibraryPage
              identityLevel={identityLevel}
              features={features}
              lockReasons={lockReasons}
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
            />
          )}
        </main>
      </div>
    </div>
  );
}
