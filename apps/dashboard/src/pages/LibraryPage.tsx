import React from "react";
import { api, getApiBase } from "../lib/api";
import AuditPanel from "../components/AuditPanel";

type LibraryItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  storefrontStatus?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  ownerUserId?: string | null;
  owner?: { displayName?: string | null; email?: string | null } | null;
  libraryAccess?: "owned" | "purchased" | "preview" | "local";
  coverUrl?: string | null;
  manifest?: { sha256?: string | null } | null;
  _count?: { files: number };
};

type LibraryTypeFilter = "all" | "songs" | "videos" | "books" | "files";
const LIBRARY_TYPE_FILTERS: LibraryTypeFilter[] = ["all", "songs", "videos", "books", "files"];
const LIBRARY_TYPE_LABEL: Record<LibraryTypeFilter, string> = {
  all: "All",
  songs: "Songs",
  videos: "Videos",
  books: "Books",
  files: "Files"
};

function normalizeLibraryTypeFilter(raw: string | null | undefined): LibraryTypeFilter {
  const v = String(raw || "").toLowerCase();
  return (LIBRARY_TYPE_FILTERS as string[]).includes(v) ? (v as LibraryTypeFilter) : "all";
}

function readLibraryTypeFromUrl(): LibraryTypeFilter {
  if (typeof window === "undefined") return "all";
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeLibraryTypeFilter(params.get("type"));
  } catch {
    return "all";
  }
}

function writeLibraryTypeToUrl(next: LibraryTypeFilter) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (next === "all") url.searchParams.delete("type");
  else url.searchParams.set("type", next);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function LibraryPage() {
  const apiBase = getApiBase();
  const [items, setItems] = React.useState<LibraryItem[]>([]);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [libraryTypeFilter, setLibraryTypeFilter] = React.useState<LibraryTypeFilter>(() => readLibraryTypeFromUrl());
  const [previewById, setPreviewById] = React.useState<Record<string, any | null>>({});
  const [previewLoading, setPreviewLoading] = React.useState<Record<string, boolean>>({});
  const [previewError, setPreviewError] = React.useState<Record<string, string>>({});
  const [previewOpenById, setPreviewOpenById] = React.useState<Record<string, boolean>>({});
  const [coverLoadErrorById, setCoverLoadErrorById] = React.useState<Record<string, boolean>>({});
  const autoLoadedRef = React.useRef(false);

  React.useEffect(() => {
    (async () => {
      try {
        const normalize = (list: LibraryItem[]) =>
          (list || []).map((i) => ({
            ...i,
            libraryAccess: i.libraryAccess || (i.ownerUserId ? "owned" : "preview")
          }));
        const typeQuery = libraryTypeFilter === "all" ? "" : `&type=${encodeURIComponent(libraryTypeFilter)}`;

        const lib = await api<LibraryItem[]>(`/content?scope=library${typeQuery}`, "GET");
        if (Array.isArray(lib) && lib.length > 0) {
          setItems(normalize(lib));
          return;
        }
        const mine = await api<LibraryItem[]>(`/content?scope=mine${typeQuery}`, "GET");
        setItems(normalize(mine || []));
      } catch (e: any) {
        const err = String(e?.message || "Failed to load library");
        setMsg(err.includes("INVALID_TYPE") ? "Invalid type filter." : err);
      }
    })();
  }, [libraryTypeFilter]);

  React.useEffect(() => {
    const onPopState = () => setLibraryTypeFilter(readLibraryTypeFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    if (!items.length || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    const limit = 6;
    const toLoad = items.slice(0, limit);
    toLoad.forEach((it) => {
      if (!previewById[it.id] && !previewLoading[it.id]) {
        loadPreview(it.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

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

  function formatDateLabel(value?: string | null) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  function songCoverUrl(contentId: string, preview: any, itemCoverUrl?: string | null): string | null {
    const normalizeToApiBase = (raw: string): string | null => {
      const source = String(raw || "").trim();
      if (!source) return null;
      try {
        const asUrl = new URL(source, apiBase);
        // Force API origin to avoid localhost/127.0.0.1 drift across UI/API hosts.
        const pathAndQuery = `${asUrl.pathname}${asUrl.search}`;
        return `${apiBase.replace(/\/$/, "")}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
      } catch {
        return `${apiBase.replace(/\/$/, "")}/${source.replace(/^\/+/, "")}`;
      }
    };

    const preferred = normalizeToApiBase(String(itemCoverUrl || "").trim());
    if (preferred) return preferred;
    const coverObjectKey = String(preview?.manifest?.cover || "").trim();
    if (!coverObjectKey) return null;
    return `${apiBase.replace(/\/$/, "")}/public/content/${encodeURIComponent(contentId)}/preview-file?objectKey=${encodeURIComponent(coverObjectKey)}`;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Library</div>
        <div className="text-sm text-neutral-400 mt-1">Private, content-rich library (owned + purchased + preview).</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="text-xs text-neutral-500 mr-1">Type:</div>
          {LIBRARY_TYPE_FILTERS.map((value) => {
            const active = libraryTypeFilter === value;
            return (
              <button
                key={value}
                type="button"
                className={`text-xs rounded-full border px-3 py-1 ${active ? "border-white/30 bg-white/5 text-white" : "border-neutral-800 text-neutral-300 hover:bg-neutral-900"}`}
                onClick={() => {
                  setLibraryTypeFilter(value);
                  writeLibraryTypeToUrl(value);
                }}
              >
                {LIBRARY_TYPE_LABEL[value]}
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-neutral-500">Showing: {LIBRARY_TYPE_LABEL[libraryTypeFilter]}</div>
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
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((it) => {
                    const preview = previewById[it.id];
                    const previewUrl = preview?.previewUrl || null;
                    const pf = previewFileFor(previewUrl, preview?.files || []);
                    const mime = String(pf?.mime || "").toLowerCase();
                    const type = String(it.type || "").toLowerCase();
                    const isVideo = mime.startsWith("video/") || type === "video";
                    const isAudio = mime.startsWith("audio/") || type === "song";
                    const isImage = mime.startsWith("image/");
                    const version =
                      String(it.manifest?.sha256 || "").trim() ||
                      String(preview?.manifest?.sha256 || "").trim() ||
                      String(it.updatedAt || "").trim() ||
                      String(it.createdAt || "").trim();
                    const rawCoverUrl = isAudio ? songCoverUrl(it.id, preview, it.coverUrl || null) : null;
                    const coverUrl =
                      rawCoverUrl && version
                        ? `${rawCoverUrl}${rawCoverUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`
                        : rawCoverUrl;
                    const isOpen = previewOpenById[it.id] ?? true;
                    return (
                      <div key={it.id} className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-4 flex flex-col gap-3">
                        <div>
                          <div className="text-sm font-medium">{it.title || "Content"}</div>
                          <div className="text-xs text-neutral-500">
                          {String(it.type || "").toUpperCase()} · {it.status?.toUpperCase?.() || "STATUS"} ·{" "}
                          {formatDateLabel(it.createdAt)} · Storefront: {it.storefrontStatus || "DISABLED"}
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-500 capitalize">
                            Access: {it.libraryAccess || "preview"}
                          </div>
                          {it.owner?.displayName || it.owner?.email ? (
                            <div className="text-[11px] text-neutral-500 mt-1">
                              Owner: {it.owner?.displayName || it.owner?.email}
                            </div>
                          ) : null}
                        </div>

                        {isAudio ? (
                          coverUrl ? (
                            <div>
                              <div className="w-full max-w-[320px] aspect-square rounded-md overflow-hidden border border-neutral-800 bg-neutral-950">
                                <img
                                  className="w-full h-full object-cover"
                                  src={coverUrl}
                                  alt={`${it.title || "Song"} cover`}
                                  loading="lazy"
                                  onError={(e) => {
                                    setCoverLoadErrorById((m) => ({ ...m, [it.id]: true }));
                                    const el = e.currentTarget;
                                    const parent = el.parentElement;
                                    if (!parent) return;
                                    parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-xs text-neutral-500">No cover</div>';
                                  }}
                                  onLoad={() => setCoverLoadErrorById((m) => ({ ...m, [it.id]: false }))}
                                />
                              </div>
                              {coverLoadErrorById[it.id] ? (
                                <div className="mt-1 text-[11px] text-amber-300">Cover missing on disk or not set in manifest.</div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="w-full max-w-[320px] aspect-square rounded-md border border-neutral-800 bg-neutral-950/60 flex items-center justify-center text-xs text-neutral-500">
                              No cover
                            </div>
                          )
                        ) : null}

                        <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
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
                              ) : previewUrl && isImage ? (
                                <img className="w-full rounded-md" src={previewUrl} alt={it.title || "Preview"} />
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
              </div>
            );
          })}
        </div>
      )}

      <AuditPanel scopeType="library" title="Audit" exportName="library-audit.json" />
    </div>
  );
}
