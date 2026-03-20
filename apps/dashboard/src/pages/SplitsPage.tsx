import React from "react";
import { api } from "../lib/api";
import LockedFeaturePanel from "../components/LockedFeaturePanel";
import type { FeatureMatrix, CapabilitySet, NodeMode } from "../lib/identity";
import AuditPanel from "../components/AuditPanel";

type ContentItem = {
  id: string;
  title: string;
  type: "song" | "book" | "video" | "file";
  status: "draft" | "published";
  createdAt: string;
  deletedAt?: string | null;
};

type SplitVersion = {
  id: string;
  contentId: string;
  versionNumber: number;
  status: "draft" | "locked";
  lockedAt?: string | null;
  createdAt: string;

  lockedFileObjectKey?: string | null;
  lockedFileSha256?: string | null;
};

function titleCase(s?: string | null) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDateLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function SplitsPage(props: {
  onEditContent?: (id: string) => void;
  identityLevel?: string | null;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
  capabilities?: CapabilitySet;
  capabilityReasons?: Record<string, string>;
  nodeMode?: NodeMode | null;
}) {
  const { onEditContent, features, lockReasons, capabilities, capabilityReasons } = props;
  const canAdvancedSplits = features?.advancedSplits ?? false;
  const splitsAllowed = capabilities?.useSplits ?? canAdvancedSplits;
  const splitsReason =
    capabilityReasons?.splits || lockReasons?.advanced_splits || "Splits require Advanced or LAN mode.";
  const isBasic = props.nodeMode === "basic";

  const [contentList, setContentList] = React.useState<ContentItem[]>([]);
  const [splitSummaryByContent, setSplitSummaryByContent] = React.useState<Record<string, SplitVersion | null>>({});
  const [showTombstones, setShowTombstones] = React.useState(false);
  const [remoteParticipations, setRemoteParticipations] = React.useState<any[]>([]);

  async function loadContentList(includeTombstones: boolean) {
    if (!splitsAllowed) {
      setContentList([]);
      return;
    }
    if (!includeTombstones) {
      const list = await api<ContentItem[]>("/content?scope=mine", "GET");
      setContentList(list);
      return;
    }
    const [active, trashed] = await Promise.all([
      api<ContentItem[]>("/content?scope=mine", "GET"),
      api<ContentItem[]>("/content?trash=1&tombstones=1&scope=mine", "GET")
    ]);
    const seen = new Set<string>();
    const merged: ContentItem[] = [];
    for (const it of active || []) {
      if (!seen.has(it.id)) {
        merged.push(it);
        seen.add(it.id);
      }
    }
    for (const it of trashed || []) {
      if (!seen.has(it.id)) {
        merged.push(it);
        seen.add(it.id);
      }
    }
    setContentList(merged);
  }

  async function loadRemoteParticipations() {
    if (!splitsAllowed) {
      setRemoteParticipations([]);
      return;
    }
    try {
      const list = await api<any[]>(`/my/royalties/remote`, "GET");
      const rows = Array.isArray(list) ? list : [];
      const acceptedRows = rows.filter((row) => {
        const status = String(row?.status || "").trim().toLowerCase();
        return status === "accepted" || Boolean(row?.acceptedAt);
      });
      setRemoteParticipations(acceptedRows);
    } catch {
      setRemoteParticipations([]);
    }
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
    if (isBasic) return;
    if (!splitsAllowed) {
      setContentList([]);
      setSplitSummaryByContent({});
      setRemoteParticipations([]);
      return;
    }
    loadContentList(showTombstones).catch(() => {});
    loadRemoteParticipations().catch(() => {});
  }, [splitsAllowed, isBasic]);

  React.useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed) return;
    loadContentList(showTombstones).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTombstones, splitsAllowed, isBasic]);

  React.useEffect(() => {
    if (isBasic) return;
    if (!splitsAllowed) return;
    if (!contentList.length) return;
    for (const c of contentList) {
      if (splitSummaryByContent[c.id] === undefined) {
        loadSplitSummary(c.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentList, splitsAllowed, isBasic]);

  if (isBasic) {
    return <LockedFeaturePanel title="Manage Splits" />;
  }

  function shouldShowContent(c: ContentItem) {
    const summary = splitSummaryByContent[c.id];
    if (showTombstones) {
      if (!c.deletedAt) return true;
      return c.status === "published" || summary?.status === "locked";
    }
    return c.status === "published" && !c.deletedAt;
  }

  const visibleContent = contentList.filter(shouldShowContent);

  return (
    <div className="space-y-4">
      {!splitsAllowed ? (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/40 p-4 text-xs text-amber-200">
          {splitsReason}
        </div>
      ) : null}
      {splitsAllowed ? (
      <>
      <div className="flex justify-end">
        <button
          onClick={() => setShowTombstones((s) => !s)}
          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
        >
          {showTombstones ? "Hide tombstones" : "Show tombstones"}
        </button>
      </div>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Splits</div>
            <div className="text-sm text-neutral-400 mt-1">Pick a content item to edit its split versions.</div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {visibleContent.map((c) => {
            const summary = splitSummaryByContent[c.id];
            const updatedAt = summary?.lockedAt || summary?.createdAt || c.createdAt;
            return (
              <div key={c.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.title}</div>
                    <div className={`text-xs ${c.deletedAt ? "text-amber-300" : "text-neutral-400"}`}>
                      {titleCase(c.type)} • {titleCase(c.status)} • {summary ? `v${summary.versionNumber}` : "v—"} • {summary?.status || "—"} • {formatDateLabel(updatedAt)}
                      {c.deletedAt ? " • tombstoned" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEditContent?.(c.id)}
                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {visibleContent.length === 0 && (
            <div className="text-sm text-neutral-400">No published content yet.</div>
          )}
        </div>
      </div>

      {remoteParticipations.length > 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Remote splits</div>
              <div className="text-sm text-neutral-400 mt-1">Accepted split participations from other nodes (read-only).</div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {remoteParticipations
              .filter((inv) => (showTombstones ? true : !inv.contentDeletedAt))
              .map((inv) => {
                const status = String(inv?.status || "pending").trim().toLowerCase();
                const participationStatusLabel = status === "accepted" || inv?.acceptedAt ? "Accepted" : titleCase(status || "pending");
                return (
                <div key={inv.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{inv.contentTitle || inv.contentId || "Remote content"}</div>
                      <div className={`text-xs ${inv.contentDeletedAt ? "text-amber-300" : "text-neutral-400"}`}>
                        {titleCase(inv.contentType)} • {inv.role ? `${inv.role}` : "role —"} • {inv.percent != null ? `${inv.percent}%` : "percent —"}
                        {inv.contentDeletedAt ? " • tombstoned" : ""}
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        Split: v{inv.splitVersionNum ?? "—"} • {titleCase(String(inv.splitStatus || "—"))}
                      </div>
                      <div className="text-[11px] text-neutral-500">Participation: {participationStatusLabel}</div>
                      {inv.remoteOrigin ? (
                        <div className="text-[11px] text-neutral-500 break-all">Remote: {inv.remoteOrigin}</div>
                      ) : null}
                      {inv.acceptedAt ? (
                        <div className="text-[11px] text-emerald-300">Accepted: {formatDateLabel(inv.acceptedAt)}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[11px] text-neutral-500 uppercase tracking-wide">read-only</div>
                    </div>
                  </div>
                </div>
                );
              })}
          </div>
        </div>
      ) : null}

      <AuditPanel scopeType="split" title="Audit" exportName="split-audit.json" showTombstoneToggle={false} />
      </>
      ) : null}
    </div>
  );
}
