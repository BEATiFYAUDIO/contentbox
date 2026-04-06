import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type EntitlementRow = {
  id: string;
  contentId: string;
  grantedAt: string;
  unlockedAt?: string | null;
  receiptToken?: string | null;
  accessMode?: "stream_only" | "download_only" | "stream_and_download";
  canDownload?: boolean;
  content?: {
    id: string;
    title: string;
    type: string;
    owner?: { displayName?: string | null; email?: string | null } | null;
  } | null;
};

export default function DownloadsPage() {
  const [items, setItems] = React.useState<EntitlementRow[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<EntitlementRow[]>("/me/entitlements", "GET")
      .then((rows) => {
        const downloadable = (rows || []).filter((r) => Boolean(r.canDownload));
        setItems(downloadable);
      })
      .catch((e: any) => setMsg(e?.message || "Failed to load downloads."));
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Downloads</div>
        <div className="text-sm text-neutral-400 mt-1">
          Unlocked items available for download.
        </div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="py-2 px-3">Content</th>
              <th className="py-2 px-3">Creator</th>
              <th className="py-2 px-3">Unlocked</th>
              <th className="py-2 px-3">Access</th>
              <th className="py-2 px-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="py-2 px-3">
                  <div>{r.content?.title || "Content"}</div>
                  <div className="text-xs text-neutral-500">{String(r.content?.type || "file").toUpperCase()}</div>
                </td>
                <td className="py-2 px-3 text-xs text-neutral-300">
                  {r.content?.owner?.displayName || r.content?.owner?.email || "—"}
                </td>
                <td className="py-2 px-3 text-xs text-neutral-400">
                  {new Date(r.unlockedAt || r.grantedAt).toLocaleString()}
                </td>
                <td className="py-2 px-3 text-xs">
                  {r.accessMode === "stream_and_download" ? "Stream + download" : "Download only"}
                </td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap gap-2">
                    <a
                      href="/library"
                      className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                    >
                      Open in Library
                    </a>
                    {r.content?.id ? (
                      <a
                        href={`/p/${encodeURIComponent(r.content.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Open content
                      </a>
                    ) : null}
                    {r.receiptToken ? (
                      <a
                        href={`/receipt/${encodeURIComponent(r.receiptToken)}`}
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Download via receipt
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-500">No receipt token</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 px-3 text-sm text-neutral-400">
                  No downloadable unlocked items yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <AuditPanel scopeType="library" title="Audit" exportName="library-audit.json" />
    </div>
  );
}
