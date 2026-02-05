import React from "react";
import { api } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type LibraryItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  storefrontStatus?: string | null;
  createdAt: string;
  ownerUserId?: string | null;
  owner?: { displayName?: string | null; email?: string | null } | null;
  libraryAccess?: "owned" | "purchased" | "preview" | "local";
  _count?: { files: number };
};

export default function LibraryPage() {
  const [items, setItems] = React.useState<LibraryItem[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [previewById, setPreviewById] = React.useState<Record<string, any | null>>({});
  const [previewLoading, setPreviewLoading] = React.useState<Record<string, boolean>>({});
  const [previewError, setPreviewError] = React.useState<Record<string, string>>({});
  const [previewOpenById, setPreviewOpenById] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    (async () => {
      try {
        const normalize = (list: LibraryItem[]) =>
          (list || []).map((i) => ({
            ...i,
            libraryAccess: i.libraryAccess || (i.ownerUserId ? "owned" : "preview")
          }));

        const lib = await api<LibraryItem[]>("/content?scope=library", "GET");
        if (Array.isArray(lib) && lib.length > 0) {
          setItems(normalize(lib));
          return;
        }
        const mine = await api<LibraryItem[]>("/content?scope=mine", "GET");
        setItems(normalize(mine || []));
      } catch (e: any) {
        setMsg(e?.message || "Failed to load library");
      }
    })();
  }, []);

  const groups = {
    owned: items.filter((i) => i.libraryAccess === "owned"),
    purchased: items.filter((i) => i.libraryAccess === "purchased"),
    preview: items.filter((i) => i.libraryAccess === "preview")
  };

  async function loadPreview(contentId: string) {
    setPreviewLoading((m) => ({ ...m, [contentId]: true }));
    setPreviewError((m) => ({ ...m, [contentId]: "" }));
    try {
      const res = await api<any>(`/content/${contentId}/preview`, "GET");
      setPreviewById((m) => ({ ...m, [contentId]: res || null }));
    } catch (e: any) {
      setPreviewById((m) => ({ ...m, [contentId]: null }));
      setPreviewError((m) => ({ ...m, [contentId]: e?.message || "Preview failed" }));
    } finally {
      setPreviewLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  function previewFileFor(previewUrl: string | null | undefined, files: any[] | null | undefined) {
    if (!previewUrl || !Array.isArray(files) || files.length === 0) return null;
    try {
      const u = new URL(previewUrl, window.location.origin);
      const objectKey = u.searchParams.get("objectKey");
      if (!objectKey) return null;
      return files.find((f: any) => f?.objectKey === objectKey) || null;
    } catch {
      return null;
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Library</div>
        <div className="text-sm text-neutral-400 mt-1">Private, content-rich library (owned + purchased + preview).</div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      {items.length === 0 ? (
        <div className="text-sm text-neutral-400">No items yet.</div>
      ) : (
        <div className="space-y-6">
          {(["owned", "purchased", "preview"] as const).map((key) => {
            const list = groups[key];
            if (!list.length) return null;
            const label = key === "owned" ? "Owned" : key === "purchased" ? "Purchased" : "Preview";
            return (
              <div key={key} className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
                {list.map((it) => {
                  const preview = previewById[it.id];
                  const previewUrl = preview?.previewUrl || null;
                  const pf = previewFileFor(previewUrl, preview?.files || []);
                  const mime = String(pf?.mime || "").toLowerCase();
                  const type = String(it.type || "").toLowerCase();
                  const isVideo = mime.startsWith("video/") || type === "video";
                  const isAudio = mime.startsWith("audio/") || type === "song";
                  const isOpen = previewOpenById[it.id] ?? true;
                  return (
                    <div key={it.id} className="rounded-lg border border-neutral-800 bg-neutral-900/10 px-4 py-3">
                      <div className="text-sm font-medium">{it.title || "Content"}</div>
                      <div className="text-xs text-neutral-500">
                        {String(it.type || "").toUpperCase()} · {it.status?.toUpperCase?.() || "STATUS"} ·{" "}
                        {new Date(it.createdAt).toLocaleString()} · Storefront: {it.storefrontStatus || "DISABLED"}
                      </div>
                      <div className="mt-1 text-[11px] text-neutral-500 capitalize">
                        Access: {it.libraryAccess || "preview"}
                      </div>
                      {it.owner?.displayName || it.owner?.email ? (
                        <div className="text-[11px] text-neutral-500 mt-1">
                          Owner: {it.owner?.displayName || it.owner?.email}
                        </div>
                      ) : null}

                      <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-neutral-100">Preview</div>
                          <button
                            type="button"
                            className="text-[11px] rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            onClick={() => setPreviewOpenById((m) => ({ ...m, [it.id]: !isOpen }))}
                          >
                            {isOpen ? "Hide" : "Show"}
                          </button>
                        </div>
                        <div className="text-xs text-neutral-400">Click to load a read-only preview.</div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            className="text-xs rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            onClick={() => loadPreview(it.id)}
                          >
                            {previewLoading[it.id] ? "Loading…" : "Load preview"}
                          </button>
                        </div>
                        {previewError[it.id] ? (
                          <div className="mt-2 text-xs text-amber-300">{previewError[it.id]}</div>
                        ) : null}
                        {preview && isOpen ? (
                          <div className="mt-2">
                            {previewUrl && isVideo ? (
                              <video className="w-full rounded-md" controls src={previewUrl} />
                            ) : previewUrl && isAudio ? (
                              <audio className="w-full" controls src={previewUrl} />
                            ) : previewUrl ? (
                              <a className="text-xs text-emerald-300 underline" href={previewUrl} target="_blank" rel="noreferrer">
                                Open preview
                              </a>
                            ) : (
                              <div className="text-xs text-neutral-500">No preview available.</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <AuditPanel scopeType="library" title="Audit" exportName="library-audit.json" />
    </div>
  );
}
