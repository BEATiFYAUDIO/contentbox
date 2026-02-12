import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type ContentItem = {
  id: string;
  title: string;
  type: "song" | "book" | "video" | "file";
  status: "draft" | "published";
  createdAt: string;
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

export default function SplitsPage(props: { onEditContent?: (id: string) => void }) {
  const { onEditContent } = props;

  const [contentList, setContentList] = React.useState<ContentItem[]>([]);
  const [splitSummaryByContent, setSplitSummaryByContent] = React.useState<Record<string, SplitVersion | null>>({});

  async function loadContentList() {
    const list = await api<ContentItem[]>("/content?scope=mine", "GET");
    setContentList(list);
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
    if (!contentList.length) return;
    for (const c of contentList) {
      if (splitSummaryByContent[c.id] === undefined) {
        loadSplitSummary(c.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentList]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Splits</div>
            <div className="text-sm text-neutral-400 mt-1">Pick a content item to edit its split versions.</div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {contentList.map((c) => {
            const summary = splitSummaryByContent[c.id];
            const updatedAt = summary?.lockedAt || summary?.createdAt || c.createdAt;
            return (
              <div key={c.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.title}</div>
                    <div className="text-xs text-neutral-400">
                      {titleCase(c.type)} • {titleCase(c.status)} • {summary ? `v${summary.versionNumber}` : "v—"} • {summary?.status || "—"} • {formatDateLabel(updatedAt)}
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

          {contentList.length === 0 && (
            <div className="text-sm text-neutral-400">No content yet. Create a song/book/video first.</div>
          )}
        </div>
      </div>

      <AuditPanel scopeType="split" title="Audit" exportName="split-audit.json" />
    </div>
  );
}
