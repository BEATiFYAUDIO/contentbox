import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type ContentItem = {
  id: string;
  title: string;
  type: "song" | "book" | "video" | "file";
  status: "draft" | "published";
  createdAt: string;
  libraryAccess?: "owned" | "participant" | "purchased" | "preview" | "local";
};

type SplitVersion = {
  id: string;
  contentId: string;
  versionNumber: number;
  status: "draft" | "pending_acceptance" | "ready" | "locked";
  lockedAt?: string | null;
  createdAt: string;

  lockedFileObjectKey?: string | null;
  lockedFileSha256?: string | null;
};

function titleCase(s?: string | null) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type RailHealth = {
  id: string;
  type: string;
  label: string;
  status: string;
  hint?: string | null;
};

export default function SplitsPage(props: { onEditContent?: (id: string) => void; onOpenPaymentRails?: () => void }) {
  const { onEditContent, onOpenPaymentRails } = props;

  const [contentList, setContentList] = React.useState<ContentItem[]>([]);
  const [splitSummaryByContent, setSplitSummaryByContent] = React.useState<Record<string, SplitVersion | null>>({});
  const [rails, setRails] = React.useState<RailHealth[]>([]);
  const [railsError, setRailsError] = React.useState<string | null>(null);
  const [railsLoading, setRailsLoading] = React.useState(true);

  async function loadContentList() {
    const owned = await api<ContentItem[]>("/content?scope=mine", "GET");
    setContentList(owned);
  }

  async function loadSplitSummary(contentId: string) {
    try {
      const split = await api<SplitVersion | null>(`/content/${contentId}/splits`, "GET");
      setSplitSummaryByContent((m) => ({ ...m, [contentId]: split }));
    } catch {
      setSplitSummaryByContent((m) => ({ ...m, [contentId]: null }));
    }
  }

  React.useEffect(() => {
    loadContentList().catch(() => {});
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      setRailsLoading(true);
      setRailsError(null);
      try {
        const res = await api<RailHealth[]>("/finance/payment-rails", "GET");
        if (!active) return;
        setRails(res || []);
      } catch (e: any) {
        if (!active) return;
        setRailsError(e?.message || "Failed to load rails.");
      } finally {
        if (active) setRailsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!contentList.length) return;
    for (const c of contentList) {
      if (splitSummaryByContent[c.id] === undefined) {
        loadSplitSummary(c.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentList]);

  const railStatus = (() => {
    if (railsLoading) return { label: "Checking", tone: "border-neutral-700 text-neutral-300" };
    if (railsError) return { label: "Unknown", tone: "border-neutral-700 text-neutral-300" };
    if (!rails.length) return { label: "Not configured", tone: "border-amber-600/40 text-amber-300" };
    const statuses = rails.map((r) => r.status);
    if (statuses.some((s) => s === "disconnected")) {
      return { label: "Disconnected", tone: "border-red-500/40 text-red-300" };
    }
    if (statuses.some((s) => s === "locked" || s === "degraded" || s === "tlsError")) {
      return { label: "Degraded", tone: "border-amber-500/40 text-amber-300" };
    }
    return { label: "Healthy", tone: "border-emerald-500/40 text-emerald-300" };
  })();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">My Splits</div>
            <div className="text-sm text-neutral-400 mt-1">Define how revenue is allocated for each content item.</div>
            <div className="mt-3 flex items-center gap-2">
              <span className={["text-xs rounded-full border px-2 py-1 bg-neutral-900/40", railStatus.tone].join(" ")}>
                Buyer Intake Rails: {railStatus.label}
              </span>
              <button
                onClick={() => onOpenPaymentRails?.()}
                className="text-xs rounded-full border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Open Payment Rails
              </button>
              {railsError ? <span className="text-xs text-neutral-500">{railsError}</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {contentList.map((c) => {
            const summary = splitSummaryByContent[c.id];
            const updatedAt = summary?.lockedAt || summary?.createdAt || c.createdAt;
            const hasSplit = Boolean(summary);
            return (
              <div key={c.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.title}</div>
                    <div className="text-xs text-neutral-400">
                      {titleCase(c.type)} • {titleCase(c.status)} • {summary ? `v${summary.versionNumber}` : "v—"} • {summary?.status || "No split defined"} • {new Date(updatedAt).toLocaleString()}
                    </div>
                    {!hasSplit ? (
                      <div className="text-xs text-amber-300 mt-1">No split defined — define split terms.</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEditContent?.(c.id)}
                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    >
                      {hasSplit ? "Open" : "Define split terms"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {contentList.length === 0 && (
            <div className="text-sm text-neutral-400">No content yet. Create a song/book/video first.</div>
          )}
        </div>
      </div>

      <AuditPanel scopeType="split" title="Audit" exportName="split-audit.json" />
    </div>
  );
}
