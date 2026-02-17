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
import { api } from "./lib/api";
import { clearToken, getToken } from "./lib/auth";
import { fetchIdentityDetail, type IdentityDetail } from "./lib/identity";
import logo from "./assets/InShot_20260201_011901479.png";
import { PAYOUT_DESTINATIONS_LABEL } from "./lib/terminology";
import AuditPanel from "./components/AuditPanel";
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

/* =======================
   App Component
======================= */

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [importUrl, setImportUrl] = useState<string>("");
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importLoading, setImportLoading] = useState<boolean>(false);
  const [beatifyHandle, setBeatifyHandle] = useState<string>("");

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
  const [payoutSettings, setPayoutSettings] = useState<{ lightningAddress: string; lnurl: string; btcAddress: string } | null>(null);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);

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
        .then((d) => alive && setIdentityDetail(d))
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

  useEffect(() => {
    if (page !== "profile") return;
    if (!me) return;
    (async () => {
      try {
        const res = await api<{ lightningAddress: string; lnurl: string; btcAddress: string }>(`/api/me/payout`, "GET");
        setPayoutSettings(res || { lightningAddress: "", lnurl: "", btcAddress: "" });
      } catch {
        setPayoutSettings({ lightningAddress: "", lnurl: "", btcAddress: "" });
      }
    })();
  }, [page, me]);

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

  useEffect(() => {
    setBeatifyHandle(extractBeatifyHandle(me?.bio));
  }, [me?.bio]);

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
  const isBasicIdentity = identityLevel === "BASIC";

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
              {royaltiesNav.filter((item: any) => !isBasicIdentity || !item.advanced).map((item: any) => {
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
          {publicStatus ? (
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-xs text-neutral-300">
              <span>
                Public Identity:{" "}
                {publicStatus?.mode === "named"
                  ? `Permanent (${publicStatus?.tunnelName || "Named"})`
                  : publicStatus?.mode === "quick"
                    ? "Temporary (Quick)"
                    : "Local"}
              </span>
              <span className="text-neutral-500">•</span>
              <span>
                {!publicStatus?.lastCheckedAt
                  ? "SEARCHING"
                  : publicStatus?.status === "online"
                  ? "ONLINE"
                  : publicStatus?.status === "starting"
                    ? "STARTING"
                    : publicStatus?.status === "error"
                      ? "ERROR"
                      : "OFFLINE"}
              </span>
              <span className="text-neutral-500">•</span>
              <span className="truncate max-w-[380px]">{publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</span>
            </div>
          ) : null}
        </header>

        {isBasicIdentity ? (
          <div className="mx-6 mt-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            Basic identity mode. Advanced features (splits, derivatives, embeds, discovery) require a persistent identity (named tunnel).
          </div>
        ) : null}

        <main className="p-6 max-w-5xl">
          {page === "library" && <LibraryPage />}

          {page === "store" && <StorePage onOpenReceipt={(t) => { setReceiptToken(t); setPage("receipt"); }} />}

          {page === "participations" && <SplitParticipationsPage identityLevel={identityLevel} />}

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
            <InvitePage token={inviteToken ?? undefined} onAccepted={onAccepted} identityLevel={identityLevel} />
          )}

          {page === "payouts" && <PayoutRailsPage />}

          {page === "content" && (
            <ContentLibraryPage
              identityLevel={identityLevel}
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
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
              <div className="text-lg font-semibold">Profile</div>
              <div className="text-sm text-neutral-400 mt-1">Identity, profile, and optional external handle.</div>

              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="text-xs text-neutral-400">User ID</div>
                  <div className="text-sm text-neutral-100 break-all">{me?.id}</div>
                  <div className="mt-2 text-xs text-neutral-400">Email</div>
                  <div className="text-sm text-neutral-100 break-all">{me?.email}</div>
                  <div className="mt-2 text-xs text-neutral-400">
                    <button
                      onClick={() => {
                        window.history.pushState({}, "", "/participations");
                        setPage("participations");
                      }}
                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    >
                      Splits I’m in
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-sm">Beatify handle (optional)</div>
                  <div className="flex gap-2 items-center mt-1">
                    <input
                      value={beatifyHandle}
                      onChange={(e) => setBeatifyHandle(e.target.value)}
                      placeholder="yourhandle"
                      className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                    />
                    {beatifyHandle ? (
                      <a
                        href={`https://www.beatify.me/${encodeURIComponent(beatifyHandle)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Open
                      </a>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">Stored locally. No verification.</div>
                </div>

                <div className="text-sm">Display name</div>
                <div className="flex gap-2">
                  <input
                    value={me?.displayName || ""}
                    onChange={(e) => setMe((m) => (m ? { ...m, displayName: e.target.value } : m))}
                    className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const nextBio = applyBeatifyHandleToBio(me?.bio, beatifyHandle);
                        await api(`/me`, "PATCH", { displayName: me?.displayName, bio: nextBio, avatarUrl: me?.avatarUrl ?? null });
                        // reload me
                        const m = await api<any>(`/me`, "GET");
                        setMe(m);
                      } catch (e: any) {
                        // ignore for now
                      }
                    }}
                    className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                  >
                    Save
                  </button>
                </div>
                <div>
                  <div className="text-sm">Bio</div>
                  <textarea
                    value={me?.bio || ""}
                    onChange={(e) => setMe((m) => (m ? { ...m, bio: e.target.value } : m))}
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 mt-1"
                    rows={3}
                  />
                </div>

                <div>
                  <div className="text-sm">Avatar URL</div>
                  <div className="flex gap-2 items-center mt-1">
                    <input
                      value={me?.avatarUrl || ""}
                      onChange={(e) => setMe((m) => (m ? { ...m, avatarUrl: e.target.value } : m))}
                      className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                    />
                    {me?.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={me.avatarUrl} alt="avatar" className="w-12 h-12 rounded-full object-cover" />
                    ) : null}
                  </div>
                </div>

                <hr className="border-neutral-800" />

                <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                  <div className="text-sm font-medium">Payout settings</div>
                  <div className="text-xs text-neutral-400 mt-1">Where should earnings be sent?</div>
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
                  </div>
                </div>

                <hr className="border-neutral-800" />

                <div>
                  <div className="text-sm">Import a public profile URL (e.g. https://www.beatify.me/blessedrthe)</div>
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

                  {/* Preview area (simple) */}
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
                                  // Apply name, bio (description), and avatarUrl (image) when available
                                  await api(`/me`, "PATCH", { displayName: p.name || null, bio: p.description || null, avatarUrl: p.image || null });
                                  // If a lightning payout was discovered, create an identity for it
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
                                  // reload me
                                  const mm = await api<any>(`/me`, "GET");
                                  setMe(mm);
                                  setImportPreview(null);
                                  setImportUrl("");
                                } catch (e) {
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

                <hr className="border-neutral-800" />
                <AuditPanel scopeType="identity" title="Audit" exportName="identity-audit.json" />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
