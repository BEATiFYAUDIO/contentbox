import React from "react";
import { api, getApiBase } from "../lib/api";
import AuditPanel from "../components/AuditPanel";
import {
  classifyLibraryEligibility,
  isEligibleSplitParticipation,
  logLibraryEligibilityDecision,
  type LibrarySection
} from "../lib/libraryEligibility";

type LibraryItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  archivedAt?: string | null;
  trashedAt?: string | null;
  deletedAt?: string | null;
  tombstonedAt?: string | null;
  storefrontStatus?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  ownerUserId?: string | null;
  owner?: { displayName?: string | null; email?: string | null } | null;
  libraryAccess?: "owned" | "purchased" | "preview" | "local" | "participant";
  coverUrl?: string | null;
  manifest?: { sha256?: string | null } | null;
  _count?: { files: number };
};
type LibraryParticipation = {
  kind: "local" | "remote";
  contentId: string;
  contentTitle: string | null;
  contentType: string | null;
  contentStatus: string | null;
  contentDeletedAt: string | null;
  splitParticipantId: string | null;
  remoteInviteId: string | null;
  remoteOrigin: string | null;
  status: string | null;
  acceptedAt?: string | null;
  verifiedAt?: string | null;
  revokedAt?: string | null;
  tombstonedAt?: string | null;
  highlightedOnProfile: boolean;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
  creatorEmail: string | null;
};

type RemoteRoyaltyParticipation = {
  id: string;
  remoteOrigin: string | null;
  contentId: string | null;
  contentTitle: string | null;
  contentType: string | null;
  contentStatus: string | null;
  status: string | null;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  tombstonedAt?: string | null;
  highlightedOnProfile?: boolean;
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

const ACCESS_BADGE: Record<NonNullable<LibraryItem["libraryAccess"]>, { label: string; cls: string }> = {
  owned: { label: "Owned", cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300" },
  purchased: { label: "Purchased", cls: "border-sky-600/40 bg-sky-500/10 text-sky-300" },
  preview: { label: "Preview only", cls: "border-amber-600/40 bg-amber-500/10 text-amber-300" },
  local: { label: "Local", cls: "border-neutral-700 bg-neutral-700/20 text-neutral-300" },
  participant: { label: "Shared", cls: "border-fuchsia-600/40 bg-fuchsia-500/10 text-fuchsia-300" }
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
        const [lib, mine, localParticipationsRes, remoteParticipationsRes] = await Promise.all([
          api<LibraryItem[]>(`/content?scope=library${typeQuery}`, "GET").catch(() => []),
          api<LibraryItem[]>(`/content?scope=mine${typeQuery}`, "GET").catch(() => []),
          api<{ items: LibraryParticipation[] }>("/my/participations", "GET").catch(() => ({ items: [] as LibraryParticipation[] })),
          api<RemoteRoyaltyParticipation[]>("/my/royalties/remote", "GET").catch(() => [] as RemoteRoyaltyParticipation[])
        ]);

        const baseListRaw = Array.isArray(lib) && lib.length > 0 ? lib : mine;
        const baseList = normalize(baseListRaw || []);
        const knownContentIds = new Set(baseList.map((it) => String(it.id || "").trim()).filter(Boolean));
        const participationByContentId = new Map<string, LibraryParticipation>();

        const localParticipationsRaw = Array.isArray(localParticipationsRes?.items) ? localParticipationsRes.items : [];
        const localParticipations: LibraryParticipation[] = localParticipationsRaw.map((row: any) => ({
          kind: "local",
          contentId: String(row?.contentId || "").trim(),
          contentTitle: row?.contentTitle || null,
          contentType: row?.contentType || null,
          contentStatus: row?.contentStatus || null,
          contentDeletedAt: row?.contentDeletedAt || null,
          splitParticipantId: String(row?.splitParticipantId || "").trim() || null,
            remoteInviteId: null,
            remoteOrigin: null,
            status: String(row?.status || "").trim() || null,
            acceptedAt: row?.acceptedAt || null,
            verifiedAt: row?.verifiedAt || null,
            revokedAt: row?.revokedAt || null,
            tombstonedAt: row?.tombstonedAt || null,
            highlightedOnProfile: Boolean(row?.highlightedOnProfile),
            creatorUserId: row?.creatorUserId || null,
            creatorDisplayName: row?.creatorDisplayName || null,
          creatorEmail: row?.creatorEmail || null
        }));
        const remoteParticipationsRaw = Array.isArray(remoteParticipationsRes) ? remoteParticipationsRes : [];
        const remoteParticipations: LibraryParticipation[] = remoteParticipationsRaw
          .filter((row) => String(row?.status || "").toLowerCase() === "accepted")
          .filter((row) => Boolean(String(row?.contentId || "").trim()))
          .map((row) => ({
            kind: "remote",
            contentId: String(row.contentId || "").trim(),
            contentTitle: row.contentTitle || null,
            contentType: row.contentType || null,
            contentStatus: row.contentStatus || "published",
            contentDeletedAt: null,
            splitParticipantId: null,
            remoteInviteId: String(row.id || "").trim() || null,
            remoteOrigin: String(row.remoteOrigin || "").replace(/\/+$/, "") || null,
            status: row.status || null,
            acceptedAt: row.acceptedAt || null,
            verifiedAt: null,
            revokedAt: row.revokedAt || null,
            tombstonedAt: row.tombstonedAt || null,
            highlightedOnProfile: Boolean(row.highlightedOnProfile),
            creatorUserId: null,
            creatorDisplayName: null,
            creatorEmail: null
          }));

        for (const p of [...localParticipations, ...remoteParticipations]) {
          const contentId = String(p?.contentId || "").trim();
          if (!contentId) continue;
          const existing = participationByContentId.get(contentId);
          if (!existing || p.kind === "local") participationByContentId.set(contentId, p);
        }

        const participationOnlyItems: LibraryItem[] = [...localParticipations, ...remoteParticipations]
          .filter((p) => p?.contentId && !knownContentIds.has(p.contentId))
          .filter((p) => isEligibleSplitParticipation(p).eligible)
          .map((p) => ({
            id: p.contentId,
            title: p.contentTitle || "Untitled",
            type: p.contentType || "file",
            status: p.contentStatus || "published",
            deletedAt: p.contentDeletedAt || null,
            createdAt: "",
            ownerUserId: p.creatorUserId || null,
            owner: {
              displayName: p.creatorDisplayName || null,
              email: p.creatorEmail || null
            },
            libraryAccess: "participant"
          }));
        const combined = [...baseList, ...participationOnlyItems];
        const eligible: LibraryItem[] = [];
        for (const item of combined) {
          const contentId = String(item.id || "").trim();
          const participation = participationByContentId.get(contentId) || null;
          const decision = classifyLibraryEligibility({
            item,
            participation
          });
          logLibraryEligibilityDecision({
            scope: "library_page",
            contentId,
            decision,
            extra: {
              access: item.libraryAccess || null
            }
          });
          if (!decision.included) continue;
          eligible.push({
            ...item,
            libraryAccess: decision.section as Exclude<LibrarySection, "excluded">
          });
        }
        setItems(eligible);
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
    preview: items.filter((i) => i.libraryAccess === "preview"),
    participant: items.filter((i) => i.libraryAccess === "participant")
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

function normalizeAssetUrl(apiBase: string, raw: string | null | undefined): string | null {
  const source = String(raw || "").trim();
  if (!source) return null;
  try {
    const asUrl = new URL(source, apiBase);
    const pathAndQuery = `${asUrl.pathname}${asUrl.search}`;
    return `${apiBase.replace(/\/$/, "")}${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;
  } catch {
    return `${apiBase.replace(/\/$/, "")}/${source.replace(/^\/+/, "")}`;
  }
}

function songCoverUrl(contentId: string, preview: any, itemCoverUrl?: string | null): string | null {
  const preferred = normalizeAssetUrl(apiBase, String(itemCoverUrl || "").trim());
  if (preferred) return preferred;
  const coverObjectKey = String(preview?.manifest?.cover || "").trim();
  if (!coverObjectKey) return null;
  return `${apiBase.replace(/\/$/, "")}/public/content/${encodeURIComponent(contentId)}/preview-file?objectKey=${encodeURIComponent(coverObjectKey)}`;
}

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 sm:p-5">
        <div className="text-lg font-semibold">Library</div>
        <div className="text-sm text-neutral-400 mt-1">Private creator library: owned, purchased, and preview-access content.</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="text-xs text-neutral-500">Type</div>
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
          <div className="text-xs text-neutral-500 sm:ml-auto">Showing: {LIBRARY_TYPE_LABEL[libraryTypeFilter]}</div>
        </div>
      </div>

      {msg ? <div className="text-sm text-red-300">{msg}</div> : null}

      {items.length === 0 ? (
        <div className="text-sm text-neutral-400">No items yet.</div>
      ) : (
        <div className="space-y-6">
          {(["owned", "purchased", "preview", "participant"] as const).map((key) => {
            const list = groups[key];
            if (!list.length) return null;
            const label =
              key === "owned" ? "Owned" : key === "purchased" ? "Purchased" : key === "preview" ? "Preview" : "Shared splits";
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
                    const rawCoverUrl = isAudio
                      ? songCoverUrl(it.id, preview, it.coverUrl || null)
                      : normalizeAssetUrl(apiBase, it.coverUrl || null);
                    const coverUrl =
                      rawCoverUrl && version
                        ? `${rawCoverUrl}${rawCoverUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`
                        : rawCoverUrl;
                    const isOpen = previewOpenById[it.id] ?? true;
                    const access = ACCESS_BADGE[(it.libraryAccess || "preview") as NonNullable<LibraryItem["libraryAccess"]>] || ACCESS_BADGE.preview;
                    return (
                      <div key={it.id} className="rounded-xl border border-neutral-800 bg-neutral-900/10 p-3 flex flex-col gap-2.5">
                        <div className="w-full aspect-video rounded-md border border-neutral-800 bg-neutral-950/60 overflow-hidden flex items-center justify-center">
                          {coverUrl ? (
                            <img
                              className="w-full h-full object-cover"
                              src={coverUrl}
                              alt={`${it.title || "Content"} cover`}
                              loading="lazy"
                              onError={(e) => {
                                setCoverLoadErrorById((m) => ({ ...m, [it.id]: true }));
                                const el = e.currentTarget;
                                const parent = el.parentElement;
                                if (!parent) return;
                                parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-xs text-neutral-500">No media</div>';
                              }}
                              onLoad={() => setCoverLoadErrorById((m) => ({ ...m, [it.id]: false }))}
                            />
                          ) : preview && isOpen && previewUrl && isImage ? (
                            <img className="w-full h-full object-cover" src={previewUrl} alt={it.title || "Preview"} />
                          ) : (
                            <div className="text-xs text-neutral-500">No media</div>
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium">{it.title || "Content"}</div>
                          <div className="mt-1 text-xs text-neutral-500">
                            {String(it.type || "").toUpperCase()} · {it.status?.toUpperCase?.() || "STATUS"}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${access.cls}`}>
                              {access.label}
                            </span>
                            <span className="text-[11px] text-neutral-500">Created {formatDateLabel(it.createdAt)}</span>
                          </div>
                          {it.owner?.displayName || it.owner?.email ? (
                            <div className="text-[11px] text-neutral-500 mt-1">
                              Owner: {it.owner?.displayName || it.owner?.email}
                            </div>
                          ) : null}
                        </div>

                        {isAudio && coverLoadErrorById[it.id] ? (
                          <div className="text-[11px] text-amber-300">Cover missing on disk or not set in manifest.</div>
                        ) : null}

                        <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-neutral-100">Player</div>
                            <button
                              type="button"
                              className="text-[11px] rounded border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={() => setPreviewOpenById((m) => ({ ...m, [it.id]: !isOpen }))}
                            >
                              {isOpen ? "Hide" : "Show"}
                            </button>
                          </div>
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
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-2 border-t border-neutral-900">
        <AuditPanel scopeType="library" title="Audit & tools" exportName="library-audit.json" />
      </div>
    </div>
  );
}
