import React from "react";
import api from "../lib/api";
import { getToken } from "../lib/auth";
import TestPurchaseModal from "../components/TestPurchaseModal";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";

type ContentType = "song" | "book" | "video" | "file" | "remix" | "mashup" | "derivative";

type ContentItem = {
  id: string;
  title: string;
  type: ContentType;
  status: "draft" | "published";
  storefrontStatus?: "DISABLED" | "UNLISTED" | "LISTED";
  priceSats?: string | number | null;
  createdAt: string;
  repoPath?: string | null;
  deletedAt?: string | null;
  manifest?: { sha256: string };
  ownerUserId?: string | null;
  owner?: { displayName?: string | null; email?: string | null } | null;
  libraryAccess?: "owned" | "purchased" | "preview" | "local" | "participant";
  _count?: { files: number };
};

type ContentFile = {
  id: string;
  originalName: string;
  objectKey: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;

  // Optional extras (only render if server returns them)
  manifestSha256?: string | null;
  sha256MatchesManifest?: boolean | null; // true/false/null
  encAlg?: string | null;
};

type Identity = {
  id: string;
  value: string;
  payoutMethod: {
    id: string;
    code: string;
    displayName: string;
  };
};

const STORAGE_PUBLIC_ORIGIN = "contentbox.publicOrigin";
const STORAGE_PUBLIC_BUY_ORIGIN = "contentbox.publicBuyOrigin";
const STORAGE_PUBLIC_STUDIO_ORIGIN = "contentbox.publicStudioOrigin";

function readStoredValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

type SplitVersion = {
  id: string;
  contentId: string;
  versionNumber: number;
  status: "draft" | "locked";
  lockedAt?: string | null;

  // notarization fields
  lockedFileObjectKey?: string | null;
  lockedFileSha256?: string | null;
};

type ContentCredit = {
  id: string;
  name: string;
  role: string;
  userId?: string | null;
  sortOrder?: number;
  createdAt?: string;
};

type ParentLinkInfo = {
  linkId: string;
  relation: string;
  upstreamBps: number;
  requiresApproval: boolean;
  approvedAt?: string | null;
  parent: {
    id: string;
    title: string;
    type: string;
    status: string;
    storefrontStatus?: string | null;
  } | null;
  parentSplit?: {
    splitVersionId: string;
    status: string;
    lockedAt?: string | null;
  } | null;
  canRequestApproval?: boolean;
  canVote?: boolean;
};

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; contentId: string; filename: string }
  | { status: "done"; contentId: string; filename: string }
  | { status: "error"; contentId: string; message: string };

async function uploadToRepo(contentId: string, file: File) {
  const token = getToken();
  if (!token) throw new Error("Not signed in");

  // Prefer IPv4 loopback in dev to avoid localhost->IPv6 issues
  const base =
    (import.meta as any).env?.VITE_API_URL?.toString()?.replace(/\/$/, "") || "http://127.0.0.1:4000";

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${base}/content/${contentId}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

function formatBytes(n: any) {
  let v = 0;
  if (typeof n === "bigint") v = Number(n);
  else if (typeof n === "string") v = Number(n);
  else v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function shortSha(sha?: string | null, take: number = 12) {
  const s = (sha || "").trim();
  if (!s) return "";
  if (s.length <= take) return s;
  return `${s.slice(0, take)}…`;
}

function titleCase(s: string) {
  return String(s || "")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function eqSha(a?: string | null, b?: string | null) {
  const aa = (a || "").trim().toLowerCase();
  const bb = (b || "").trim().toLowerCase();
  if (!aa || !bb) return false;
  return aa === bb;
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

async function copyText(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}

export default function ContentLibraryPage({
  onOpenSplits
}: {
  onOpenSplits?: (contentId: string) => void;
}) {
  const apiBase = ((import.meta as any).env?.VITE_API_URL?.toString()?.replace(/\/$/, "") || "http://127.0.0.1:4000");
  const envPublicOrigin = ((import.meta as any).env?.VITE_PUBLIC_ORIGIN || "").toString().trim();
  const envPublicBuyOrigin = ((import.meta as any).env?.VITE_PUBLIC_BUY_ORIGIN || "").toString().trim();
  const envPublicStudioOrigin = ((import.meta as any).env?.VITE_PUBLIC_STUDIO_ORIGIN || "").toString().trim();

  const [items, setItems] = React.useState<ContentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<ContentType>("song");
  const [creating, setCreating] = React.useState(false);

  const [upload, setUpload] = React.useState<UploadState>({ status: "idle" });

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [filesByContent, setFilesByContent] = React.useState<Record<string, ContentFile[]>>({});
  const [filesLoading, setFilesLoading] = React.useState<Record<string, boolean>>({});

  // NEW: latest split (so we can show lock notarization when locked)
  const [splitByContent, setSplitByContent] = React.useState<Record<string, SplitVersion | null>>({});
  const [splitLoading, setSplitLoading] = React.useState<Record<string, boolean>>({});
  const [auditByContent, setAuditByContent] = React.useState<Record<string, HistoryEvent[]>>({});
  const [auditLoading, setAuditLoading] = React.useState<Record<string, boolean>>({});
  const [clearanceHistoryByLink, setClearanceHistoryByLink] = React.useState<Record<string, HistoryEvent[]>>({});
  const [clearanceHistoryLoading, setClearanceHistoryLoading] = React.useState<Record<string, boolean>>({});
  const [clearanceHistoryOpen, setClearanceHistoryOpen] = React.useState<Record<string, boolean>>({});
  const [identities, setIdentities] = React.useState<Identity[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = React.useState(false);
  const [derivativeAuthByContent, setDerivativeAuthByContent] = React.useState<Record<string, string>>({});
  const [parentLinkByContent, setParentLinkByContent] = React.useState<Record<string, ParentLinkInfo | null>>({});
  const [parentLinkErrorByContent, setParentLinkErrorByContent] = React.useState<Record<string, string>>({});
  const [approvals, setApprovals] = React.useState<any[]>([]);
  const [approvalsLoading, setApprovalsLoading] = React.useState(false);

  const [showTrash, setShowTrash] = React.useState(false);
  const [showClearance, setShowClearance] = React.useState(false);
  const [clearanceScope, setClearanceScope] = React.useState<"pending" | "voted" | "cleared">("pending");
  const [pendingClearanceCount, setPendingClearanceCount] = React.useState(0);
  const [busyAction, setBusyAction] = React.useState<Record<string, boolean>>({});
  const [clearanceLinksByContent, setClearanceLinksByContent] = React.useState<Record<string, Array<{ email: string; url: string }>>>({});
  const [requestParentId, setRequestParentId] = React.useState("");
  const [requestTitle, setRequestTitle] = React.useState("");
  const [requestType, setRequestType] = React.useState<ContentType>("remix");
  const [requestMsg, setRequestMsg] = React.useState<string | null>(null);
  const [requestLinks, setRequestLinks] = React.useState<Array<{ email: string; url: string }> | null>(null);
  const [meId, setMeId] = React.useState<string>("");
  const [contentScope, setContentScope] = React.useState<"library" | "mine" | "local">("library");
  const [storefrontPreview, setStorefrontPreview] = React.useState<Record<string, any | null>>({});
  const [storefrontPreviewLoading, setStorefrontPreviewLoading] = React.useState<Record<string, boolean>>({});
  const [priceDraft, setPriceDraft] = React.useState<Record<string, string>>({});
  const [priceMsg, setPriceMsg] = React.useState<Record<string, string>>({});
  const [shareMsg, setShareMsg] = React.useState<Record<string, string>>({});
  const [shareBusy, setShareBusy] = React.useState<Record<string, boolean>>({});
  const [shareP2PLink, setShareP2PLink] = React.useState<Record<string, string>>({});
  const [publicStatus, setPublicStatus] = React.useState<any | null>(null);
  const [publicBusy, setPublicBusy] = React.useState(false);
  const [publicMsg, setPublicMsg] = React.useState<string | null>(null);
  const [publicOrigin, setPublicOrigin] = React.useState<string>(() => envPublicOrigin || readStoredValue(STORAGE_PUBLIC_ORIGIN));
  const [publicBuyOrigin, setPublicBuyOrigin] = React.useState<string>(() => envPublicBuyOrigin || readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN));
  const [publicStudioOrigin, setPublicStudioOrigin] = React.useState<string>(() => envPublicStudioOrigin || readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN));
  const [salesByContent, setSalesByContent] = React.useState<Record<string, { totalSats: string; recent: any[] } | null>>({});
  const [salesLoading, setSalesLoading] = React.useState<Record<string, boolean>>({});
  const [derivativesByContent, setDerivativesByContent] = React.useState<Record<string, any[] | null>>({});
  const [derivativesLoading, setDerivativesLoading] = React.useState<Record<string, boolean>>({});
  const [derivativePreviewByChild, setDerivativePreviewByChild] = React.useState<Record<string, any | null>>({});
  const [derivativePreviewLoading, setDerivativePreviewLoading] = React.useState<Record<string, boolean>>({});
  const [derivativePreviewError, setDerivativePreviewError] = React.useState<Record<string, string>>({});
  const [reviewGrantMsgByContent, setReviewGrantMsgByContent] = React.useState<Record<string, string>>({});
  const [creditsByContent, setCreditsByContent] = React.useState<Record<string, ContentCredit[] | null>>({});
  const [creditsLoading, setCreditsLoading] = React.useState<Record<string, boolean>>({});
  const [creditNameDraft, setCreditNameDraft] = React.useState<Record<string, string>>({});
  const [creditRoleDraft, setCreditRoleDraft] = React.useState<Record<string, string>>({});
  const [creditMsg, setCreditMsg] = React.useState<Record<string, string>>({});
  const [publishBusy, setPublishBusy] = React.useState<Record<string, boolean>>({});
  const [publishMsg, setPublishMsg] = React.useState<Record<string, string>>({});
  const [pendingOpenContentId, setPendingOpenContentId] = React.useState<string | null>(null);
  const [clearanceByLink, setClearanceByLink] = React.useState<Record<string, any | null>>({});
  const [clearanceLoadingByLink, setClearanceLoadingByLink] = React.useState<Record<string, boolean>>({});

  const [testPurchaseFor, setTestPurchaseFor] = React.useState<{
    contentId: string;
    manifestSha256: string;
    storefrontStatus?: string | null;
    contentStatus?: string | null;
  } | null>(null);

  async function load(trashMode: boolean = showTrash) {
    setLoading(true);
    setError(null);
    try {
      const url = trashMode ? `/content?trash=1&scope=${contentScope}` : `/content?scope=${contentScope}`;
      const data = await api<ContentItem[]>(url);
      setItems(data);
      const next: Record<string, string> = {};
      for (const it of data || []) {
        if (it.priceSats !== undefined && it.priceSats !== null) next[it.id] = String(it.priceSats);
      }
      setPriceDraft(next);
      if (pendingOpenContentId && data.find((d) => d.id === pendingOpenContentId)) {
        setExpanded((m) => ({ ...m, [pendingOpenContentId]: true }));
        setPendingOpenContentId(null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load content");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentScope]);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await api<any>("/api/public/status", "GET");
        setPublicStatus(res || null);
      } catch {
        setPublicStatus(null);
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const me = await api<any>("/me", "GET");
        // email currently unused in this page
        setMeId(String(me?.id || ""));
      } catch {
        setMeId("");
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      setIdentitiesLoading(true);
      try {
        const ids = await api<Identity[]>("/identities", "GET");
        setIdentities(ids || []);
      } catch {
        setIdentities([]);
      } finally {
        setIdentitiesLoading(false);
      }
    })();
  }, []);

  async function refreshPublicStatus() {
    try {
      const res = await api<any>("/api/public/status", "GET");
      if (res?.publicOrigin) setPublicOrigin(res.publicOrigin);
    } catch {
      // ignore
    }
  }

  React.useEffect(() => {
    refreshPublicStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!publicOrigin) return;
    try {
      window.localStorage.setItem(STORAGE_PUBLIC_ORIGIN, publicOrigin);
    } catch {}
  }, [publicOrigin]);

  React.useEffect(() => {
    if (!publicBuyOrigin) return;
    try {
      window.localStorage.setItem(STORAGE_PUBLIC_BUY_ORIGIN, publicBuyOrigin);
    } catch {}
  }, [publicBuyOrigin]);

  React.useEffect(() => {
    if (!publicStudioOrigin) return;
    try {
      window.localStorage.setItem(STORAGE_PUBLIC_STUDIO_ORIGIN, publicStudioOrigin);
    } catch {}
  }, [publicStudioOrigin]);

  React.useEffect(() => {
    const expandedIds = Object.keys(expanded).filter((id) => expanded[id]);
    if (expandedIds.length === 0) return;

    const timer = setInterval(() => {
      expandedIds.forEach((id) => {
        const link = parentLinkByContent[id];
        if (link?.requiresApproval && !link?.approvedAt) {
          loadParentLink(id);
        }
      });
    }, 10000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, parentLinkByContent]);

  React.useEffect(() => {
    if (!showClearance) return;
    loadApprovals(clearanceScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClearance, clearanceScope]);

  React.useEffect(() => {
    loadPendingClearanceCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!showClearance || approvals.length === 0) return;
    approvals.forEach((a) => {
      const linkId = String(a?.linkId || "");
      if (!linkId) return;
      if (clearanceByLink[linkId] === undefined && !clearanceLoadingByLink[linkId]) {
        loadClearanceSummary(linkId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClearance, approvals]);

  async function loadFiles(contentId: string) {
    setFilesLoading((m) => ({ ...m, [contentId]: true }));
    try {
      const files = await api<ContentFile[]>(`/content/${contentId}/files`);
      setFilesByContent((m) => ({ ...m, [contentId]: files }));
    } finally {
      setFilesLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  function baseFromHostPort(host?: string, port?: string): string {
    const cleanHost = (host || "").trim().replace(/^https?:\/\//i, "");
    if (!cleanHost) return "";
    const useHttps = port === "443" || /trycloudflare\.com$/i.test(cleanHost) || /\.ts\.net$/i.test(cleanHost);
    const scheme = useHttps ? "https" : "http";
    const portPart = port ? `:${port}` : "";
    return `${scheme}://${cleanHost}${portPart}`;
  }

  function hostPortFromOrigin(origin: string): { host: string; port: string } {
    if (!origin) return { host: "", port: "" };
    try {
      const url = new URL(origin);
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      return { host: url.hostname, port };
    } catch {
      return { host: origin.replace(/^https?:\/\//i, ""), port: "" };
    }
  }

  async function buildP2PLink(
    contentId: string,
    manifestSha256: string | null,
    opts: { host?: string; port?: string; baseUrl?: string } = {}
  ) {
    if (!manifestSha256) {
      setShareMsg((m) => ({ ...m, [contentId]: "Publish to generate a manifest first." }));
      return;
    }
    try {
      setShareBusy((m) => ({ ...m, [contentId]: true }));
      setShareMsg((m) => ({ ...m, [contentId]: "" }));
      const identity = await api<any>("/p2p/identity", "GET");
      const offer = await api<any>(`/p2p/content/${contentId}/offer`, "GET");
      const sellerPeerId = String(identity?.peerId || "").trim();
      const primaryFileId = String(offer?.primaryFileId || "").trim();
      if (!sellerPeerId || !primaryFileId) {
        setShareMsg((m) => ({ ...m, [contentId]: "Missing seller identity or primary file. Check publish + price." }));
        return;
      }
      const params = new URLSearchParams({
        v: "1",
        manifestHash: manifestSha256,
        primaryFileId,
        sellerPeerId
      });
      if (opts.host) params.set("host", opts.host);
      if (opts.port) params.set("port", opts.port);
      const linkBase = opts.baseUrl ? opts.baseUrl.replace(/\/$/, "") : apiBase;
      const link = `${linkBase}/buy?${params.toString()}`;
      await copyText(link);
      setShareP2PLink((m) => ({ ...m, [contentId]: link }));
      setShareMsg((m) => ({ ...m, [contentId]: "P2P link copied." }));
    } catch (e: any) {
      const msg = e?.message || "Failed to build P2P link.";
      setShareMsg((m) => ({ ...m, [contentId]: msg }));
    } finally {
      setShareBusy((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadLatestSplit(contentId: string) {
    setSplitLoading((m) => ({ ...m, [contentId]: true }));
    try {
      // server returns the latest SplitVersion (with scalar fields included by default)
      const split = await api<any>(`/content/${contentId}/splits`);
      const normalized: SplitVersion | null = split
        ? {
            id: String(split.id),
            contentId: String(split.contentId),
            versionNumber: Number(split.versionNumber),
            status: split.status,
            lockedAt: split.lockedAt ?? null,
            lockedFileObjectKey: split.lockedFileObjectKey ?? null,
            lockedFileSha256: split.lockedFileSha256 ?? null
          }
        : null;

      setSplitByContent((m) => ({ ...m, [contentId]: normalized }));
    } catch {
      // don’t hard-fail the library page if splits endpoint is unavailable
      setSplitByContent((m) => ({ ...m, [contentId]: null }));
    } finally {
      setSplitLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadSales(contentId: string) {
    setSalesLoading((m) => ({ ...m, [contentId]: true }));
    try {
      const data = await api<{ totalSats: string; recent: any[] }>(`/content/${contentId}/sales`, "GET");
      setSalesByContent((m) => ({ ...m, [contentId]: data }));
    } catch {
      setSalesByContent((m) => ({ ...m, [contentId]: null }));
    } finally {
      setSalesLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function publishContent(contentId: string) {
    if (publishBusy[contentId]) return;
    setPublishBusy((m) => ({ ...m, [contentId]: true }));
    setPublishMsg((m) => ({ ...m, [contentId]: "" }));
    try {
      await api(`/api/content/${contentId}/manifest`, "POST");
      await api(`/api/content/${contentId}/publish`, "POST");
      await load(false);
      setPublishMsg((m) => ({ ...m, [contentId]: "Published." }));
    } catch (e: any) {
      const msg = e?.message || "Publish failed.";
      setPublishMsg((m) => ({ ...m, [contentId]: msg }));
    } finally {
      setPublishBusy((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadParentLink(contentId: string) {
    try {
      const data = await api<ParentLinkInfo | { parentLink: null }>(`/content/${contentId}/parent-link`, "GET");
      if ((data as any)?.parentLink === null) {
        setParentLinkByContent((m) => ({ ...m, [contentId]: null }));
        setParentLinkErrorByContent((m) => ({ ...m, [contentId]: "" }));
        return;
      }
      let merged: ParentLinkInfo = data as ParentLinkInfo;
      try {
        if ((data as any)?.linkId) {
          const cs: any = await api(`/content-links/${(data as any).linkId}/clearance`, "GET");
          merged = {
            ...(data as ParentLinkInfo),
            clearance: cs
              ? {
                  approveWeightBps: cs.progressBps || 0,
                  approvalBpsTarget: cs.thresholdBps || 6667,
                  approvedApprovers: Array.isArray(cs.votes)
                    ? cs.votes.filter((v: any) => String(v.decision).toLowerCase() === "approve").length
                    : 0,
                  approverCount: Array.isArray(cs.approvers) ? cs.approvers.length : 0
                }
              : (data as ParentLinkInfo).clearance
          };
        }
      } catch {}
      setParentLinkByContent((m) => ({ ...m, [contentId]: merged }));
      setParentLinkErrorByContent((m) => ({ ...m, [contentId]: "" }));
    } catch (e: any) {
      setParentLinkByContent((m) => ({ ...m, [contentId]: null }));
      setParentLinkErrorByContent((m) => ({ ...m, [contentId]: e?.message || "Failed to load parent link." }));
    }
  }

  async function loadAudit(contentId: string) {
    setAuditLoading((m) => ({ ...m, [contentId]: true }));
    try {
      const events = await api<HistoryEvent[]>(`/content/${contentId}/history`, "GET");
      setAuditByContent((m) => ({ ...m, [contentId]: events || [] }));
    } catch {
      setAuditByContent((m) => ({ ...m, [contentId]: [] }));
    } finally {
      setAuditLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadClearanceHistory(linkId: string) {
    setClearanceHistoryLoading((m) => ({ ...m, [linkId]: true }));
    try {
      const events = await api<HistoryEvent[]>(`/content-links/${linkId}/clearance-history`, "GET");
      setClearanceHistoryByLink((m) => ({ ...m, [linkId]: events || [] }));
    } catch {
      setClearanceHistoryByLink((m) => ({ ...m, [linkId]: [] }));
    } finally {
      setClearanceHistoryLoading((m) => ({ ...m, [linkId]: false }));
    }
  }

  async function loadDerivativeAuth(contentId: string) {
    try {
      const res = await api<{ status: string }>(`/api/content/${contentId}/derivative-authorization`, "GET");
      setDerivativeAuthByContent((m) => ({ ...m, [contentId]: res?.status || "NONE" }));
    } catch {
      setDerivativeAuthByContent((m) => ({ ...m, [contentId]: "NONE" }));
    }
  }

  async function loadDerivativesForParent(contentId: string) {
    setDerivativesLoading((m) => ({ ...m, [contentId]: true }));
    try {
      const res = await api<any[]>(`/api/content/${contentId}/derivatives`, "GET");
      const list = res || [];
      const enriched = await Promise.all(
        list.map(async (d: any) => {
          try {
            const cs: any = await api(`/content-links/${d.linkId}/clearance`, "GET");
            return {
              ...d,
              clearance: cs
                ? {
                    approveWeightBps: cs.progressBps || 0,
                    approvalBpsTarget: cs.thresholdBps || 6667,
                    approvedApprovers: Array.isArray(cs.votes)
                      ? cs.votes.filter((v: any) => {
                          if (String(v.decision).toLowerCase() !== "approve") return false;
                          const approvedRatePercent = cs.upstreamBps ? cs.upstreamBps / 100 : null;
                          if (approvedRatePercent === null || v.upstreamRatePercent === null || v.upstreamRatePercent === undefined) {
                            return true;
                          }
                          return Number(v.upstreamRatePercent) === Number(approvedRatePercent);
                        }).length
                      : 0,
                    approverCount: Array.isArray(cs.approvers) ? cs.approvers.length : 0,
                    viewer: cs.viewer || null
                  }
                : d.clearance
            };
          } catch {
            return d;
          }
        })
      );
      setDerivativesByContent((m) => ({ ...m, [contentId]: enriched }));
    } catch {
      setDerivativesByContent((m) => ({ ...m, [contentId]: [] }));
    } finally {
      setDerivativesLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadDerivativePreview(childContentId: string) {
    setDerivativePreviewLoading((m) => ({ ...m, [childContentId]: true }));
    setDerivativePreviewError((m) => ({ ...m, [childContentId]: "" }));
    try {
      const res = await api<any>(`/content/${childContentId}/preview`, "GET");
      setDerivativePreviewByChild((m) => ({ ...m, [childContentId]: res || null }));
    } catch (e: any) {
      setDerivativePreviewByChild((m) => ({ ...m, [childContentId]: null }));
      setDerivativePreviewError((m) => ({ ...m, [childContentId]: e?.message || "Preview failed" }));
    } finally {
      setDerivativePreviewLoading((m) => ({ ...m, [childContentId]: false }));
    }
  }

  async function loadCredits(contentId: string) {
    setCreditsLoading((m) => ({ ...m, [contentId]: true }));
    try {
      const res = await api<ContentCredit[]>(`/content/${contentId}/credits`, "GET");
      setCreditsByContent((m) => ({ ...m, [contentId]: res || [] }));
    } catch {
      setCreditsByContent((m) => ({ ...m, [contentId]: [] }));
    } finally {
      setCreditsLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadApprovals(scope: "pending" | "voted" | "cleared" = clearanceScope) {
    setApprovalsLoading(true);
    try {
      const data = await api<any[]>(`/api/derivatives/approvals?scope=${encodeURIComponent(scope)}`, "GET");
      setApprovals(data || []);
      if (scope === "pending") setPendingClearanceCount(Array.isArray(data) ? data.length : 0);
    } catch {
      setApprovals([]);
      if (scope === "pending") setPendingClearanceCount(0);
    } finally {
      setApprovalsLoading(false);
    }
  }

  async function loadPendingClearanceCount() {
    try {
      const data = await api<any[]>(`/api/derivatives/approvals?scope=pending`, "GET");
      setPendingClearanceCount(Array.isArray(data) ? data.length : 0);
    } catch {
      setPendingClearanceCount(0);
    }
  }

  async function loadClearanceSummary(linkId: string) {
    setClearanceLoadingByLink((m) => ({ ...m, [linkId]: true }));
    try {
      const res: any = await api(`/content-links/${linkId}/clearance`, "GET");
      setClearanceByLink((m) => ({ ...m, [linkId]: res || null }));
    } catch {
      setClearanceByLink((m) => ({ ...m, [linkId]: null }));
    } finally {
      setClearanceLoadingByLink((m) => ({ ...m, [linkId]: false }));
    }
  }

  async function updateStorefrontStatus(contentId: string, storefrontStatus: "DISABLED" | "UNLISTED" | "LISTED") {
    setBusyAction((m) => ({ ...m, [contentId]: true }));
    try {
      const res = await api<{ storefrontStatus: string }>(`/api/content/${contentId}/storefront`, "PATCH", {
        storefrontStatus
      });
      setItems((prev) =>
        prev.map((it) => (it.id === contentId ? { ...it, storefrontStatus: res.storefrontStatus as any } : it))
      );
    } catch (e: any) {
      setError(e?.message || "Failed to update storefront status");
    } finally {
      setBusyAction((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function createContent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setCreating(true);
    try {
      const created = await api<ContentItem>("/content", "POST", {
        title: title.trim(),
        type
      });

      setTitle("");
      setType("song");

      // Ensure we land back in the active view after creating
      setShowTrash(false);
      await load(false);

      if (onOpenSplits) onOpenSplits(created.id);
    } catch (e: any) {
      setError(e?.message || "Failed to create content");
    } finally {
      setCreating(false);
    }
  }

  async function softDelete(contentId: string) {
    setBusyAction((m) => ({ ...m, [contentId]: true }));
    setError(null);
    try {
      await api(`/content/${contentId}/delete`, "POST");

      // Collapse + clear caches for that item
      setExpanded((m) => ({ ...m, [contentId]: false }));
      setFilesByContent((m) => {
        const next = { ...m };
        delete next[contentId];
        return next;
      });
      setSplitByContent((m) => {
        const next = { ...m };
        delete next[contentId];
        return next;
      });

      await load(false);
    } catch (e: any) {
      setError(e?.message || "Failed to move item to trash");
    } finally {
      setBusyAction((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function requestDerivativeFromId() {
    const parentId = requestParentId.trim();
    const title = requestTitle.trim();
    const type = (requestType || "remix").trim();
    if (!parentId || !title) {
      setRequestMsg("Original content ID and title are required.");
      return;
    }
    try {
      setRequestMsg(null);
      setRequestLinks(null);
      const res = await api<{ ok: true; childContentId: string }>(`/api/content/${parentId}/derivative`, "POST", {
        type,
        title
      });
      if (res?.childContentId) {
        setPendingOpenContentId(res.childContentId);
      }
      setRequestMsg("Derivative created. Request clearance from the derivative page.");
      setRequestParentId("");
      setRequestTitle("");
      await load(false);
    } catch (e: any) {
      setRequestMsg(e?.message || "Request failed.");
    }
  }

  async function restore(contentId: string) {
    setBusyAction((m) => ({ ...m, [contentId]: true }));
    setError(null);
    try {
      await api(`/content/${contentId}/restore`, "POST");

      setExpanded((m) => ({ ...m, [contentId]: false }));
      setFilesByContent((m) => {
        const next = { ...m };
        delete next[contentId];
        return next;
      });
      setSplitByContent((m) => {
        const next = { ...m };
        delete next[contentId];
        return next;
      });

      await load(true);
    } catch (e: any) {
      setError(e?.message || "Failed to restore item");
    } finally {
      setBusyAction((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function deleteForever(contentId: string) {
    const ok = window.confirm("Delete forever? This removes the DB row and repo folder.");
    if (!ok) return;

    setBusyAction((m) => ({ ...m, [contentId]: true }));
    setError(null);
    try {
      await api(`/content/${contentId}`, "DELETE");

      setExpanded((m) => ({ ...m, [contentId]: false }));
      setFilesByContent((m) => {
        const next = { ...m };
        delete next[contentId];
        return next;
      });
      setSplitByContent((m) => {
        const next = { ...m };
        delete next[contentId];
        return next;
      });

      await load(true);
    } catch (e: any) {
      setError(e?.message || "Failed to delete forever");
    } finally {
      setBusyAction((m) => ({ ...m, [contentId]: false }));
    }
  }

  function UploadButton({ contentId, disabled }: { contentId: string; disabled?: boolean }) {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const busy = upload.status === "uploading" && upload.contentId === contentId;

    return (
      <>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;

            setError(null);
            setUpload({ status: "uploading", contentId, filename: file.name });

            try {
              await uploadToRepo(contentId, file);
              setUpload({ status: "done", contentId, filename: file.name });

              await load();

              // If the files panel is open, refresh it too
              if (expanded[contentId]) {
                await Promise.all([loadFiles(contentId), loadLatestSplit(contentId)]);
              }

              window.setTimeout(() => setUpload({ status: "idle" }), 1200);
            } catch (err: any) {
              setUpload({ status: "error", contentId, message: err?.message || "Upload failed" });
            }
          }}
        />

        <button
          type="button"
          disabled={disabled || busy}
          className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60"
          onClick={() => inputRef.current?.click()}
          title="Upload into this content repo and commit"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold">Content library</div>
        <div className="text-sm text-neutral-400">Create an item, upload your master file, and the repo will track every version.</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">View:</span>
          <button
            type="button"
            className={`rounded-full border px-2 py-1 ${
              contentScope === "library"
                ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                : "border-neutral-700 text-neutral-400 bg-neutral-950/60"
            }`}
            onClick={() => setContentScope("library")}
          >
            Access
          </button>
          <button
            type="button"
            className={`rounded-full border px-2 py-1 ${
              contentScope === "local"
                ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                : "border-neutral-700 text-neutral-400 bg-neutral-950/60"
            }`}
            onClick={() => setContentScope("local")}
          >
            Local
          </button>
          <button
            type="button"
            className={`rounded-full border px-2 py-1 ${
              contentScope === "mine"
                ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                : "border-neutral-700 text-neutral-400 bg-neutral-950/60"
            }`}
            onClick={() => setContentScope("mine")}
          >
            Authored
          </button>
        </div>
        <div className="text-xs text-neutral-500 mt-2">
          {contentScope === "library"
            ? "Access: everything you can open (owned, purchased, preview)."
            : contentScope === "local"
              ? "Local: items stored on this node."
              : "Authored: your creator catalog only."}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/50 text-red-200 px-3 py-2 text-sm">{error}</div>
      )}

      {upload.status === "error" && (
        <div className="rounded-lg border border-red-900 bg-red-950/50 text-red-200 px-3 py-2 text-sm">
          Upload failed: {upload.message}
        </div>
      )}

      {upload.status === "done" && (
        <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 text-emerald-200 px-3 py-2 text-sm">
          Uploaded + committed: {upload.filename}
        </div>
      )}

      <form onSubmit={createContent} className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 space-y-3">
        <div className="font-medium">New content item</div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-sm mb-1 text-neutral-300">Title</label>
            <input
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Highway 11 Nights (Master)"
            />
          </div>

          <div>
            <label className="block text-sm mb-1 text-neutral-300">Type</label>
            <select
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
              value={type}
              onChange={(e) => setType(e.target.value as ContentType)}
            >
              <option value="song">Song</option>
              <option value="book">Book</option>
              <option value="video">Video</option>
              <option value="file">File</option>
            </select>
          </div>
        </div>

        <button className="rounded-lg bg-white text-black font-medium px-4 py-2 disabled:opacity-60" disabled={creating}>
          {creating ? "Creating…" : "Create"}
        </button>

        <div className="text-xs text-neutral-500">Upload sets the master file and updates manifest.json.primaryFile automatically.</div>
      </form>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 space-y-3">
        <div className="font-medium">Create derivative (from OG content ID)</div>
        <div className="text-xs text-neutral-500">
          Use this if the original isn’t publicly visible. You’ll create a private derivative, then request clearance from its page.
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-sm mb-1 text-neutral-300">Original content ID</label>
            <input
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
              value={requestParentId}
              onChange={(e) => setRequestParentId(e.target.value)}
              placeholder="e.g. cml7..."
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-neutral-300">Type</label>
            <select
              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as ContentType)}
            >
              <option value="remix">Remix</option>
              <option value="mashup">Mashup</option>
              <option value="derivative">Derivative</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1 text-neutral-300">Derivative title</label>
          <input
            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
            value={requestTitle}
            onChange={(e) => setRequestTitle(e.target.value)}
            placeholder="e.g. OG Track (DJ Remix)"
          />
        </div>

        <button
          type="button"
          className="rounded-lg border border-neutral-800 px-4 py-2 hover:bg-neutral-900"
          onClick={requestDerivativeFromId}
        >
          Create derivative
        </button>

        {requestMsg ? <div className="text-xs text-neutral-400">{requestMsg}</div> : null}
        {requestLinks?.length ? (
          <div className="mt-2 space-y-1 text-[11px] text-neutral-400">
            <div className="text-neutral-500">Clearance links to share:</div>
            {requestLinks.map((l, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="truncate">{l.email}</span>
                <button
                  type="button"
                  className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                  onClick={() => navigator.clipboard.writeText(l.url)}
                >
                  Copy link
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Public sharing</div>
            <div className="text-xs text-neutral-400">Enable a public link for LTE sharing.</div>
          </div>
          <div className="flex items-center gap-2">
            {publicStatus?.publicOrigin ? (
              <button
                type="button"
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                onClick={async () => {
                  try {
                    setPublicBusy(true);
                    await api("/api/public/stop", "POST");
                    setPublicStatus(null);
                    setPublicOrigin("");
                    setPublicBuyOrigin("");
                    setPublicStudioOrigin("");
                  } catch (e: any) {
                    setPublicMsg(e?.message || "Failed to stop public link.");
                  } finally {
                    setPublicBusy(false);
                  }
                }}
                disabled={publicBusy}
              >
                Stop Public Link
              </button>
            ) : (
              <button
                type="button"
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                onClick={async () => {
                  try {
                    setPublicBusy(true);
                    const res = await api<any>("/api/public/go", "POST");
                    setPublicStatus(res || null);
                    if (res?.publicOrigin) setPublicOrigin(res.publicOrigin);
                  } catch (e: any) {
                    setPublicMsg(e?.message || "Public link unavailable.");
                  } finally {
                    setPublicBusy(false);
                  }
                }}
                disabled={publicBusy || publicStatus?.cloudflaredInstalled === false}
              >
                Enable Public Link
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 text-xs text-neutral-400">
          Public link:{" "}
          <span className="text-neutral-200 break-all">
            {publicStatus?.publicOrigin || "—"}
          </span>
          {publicStatus?.publicOrigin ? (
            <button
              type="button"
              className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900 ml-2"
              onClick={() => copyText(publicStatus.publicOrigin)}
            >
              Copy
            </button>
          ) : null}
        </div>
        {publicStatus?.cloudflaredInstalled === false ? (
          <div className="mt-2 text-xs text-amber-300">
            ⚠ cloudflared not installed. Public sharing (LTE) requires Cloudflare Tunnel.
          </div>
        ) : null}
        {publicMsg ? <div className="mt-1 text-xs text-amber-300">{publicMsg}</div> : null}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="flex flex-wrap items-center justify-between mb-3 gap-3">
          <div className="flex items-center gap-2">
            <div className="font-medium">Your content</div>

            <div className="ml-2 inline-flex rounded-lg border border-neutral-800 overflow-hidden">
              <button
                type="button"
                className={`text-sm px-3 py-1 whitespace-nowrap ${!showTrash && !showClearance ? "bg-neutral-950" : "hover:bg-neutral-900"}`}
                onClick={async () => {
                  setShowClearance(false);
                  setShowTrash(false);
                  await load(false);
                }}
              >
                Content
              </button>
              <button
                type="button"
                className={`text-sm px-3 py-1 whitespace-nowrap ${showTrash ? "bg-neutral-950" : "hover:bg-neutral-900"}`}
                onClick={async () => {
                  setShowClearance(false);
                  setShowTrash(true);
                  await load(true);
                }}
              >
                Trash
              </button>
              <button
                type="button"
                className={`text-sm px-3 py-1 whitespace-nowrap ${showClearance ? "bg-neutral-950" : "hover:bg-neutral-900"}`}
                onClick={async () => {
                  setShowTrash(false);
                  setShowClearance(true);
                  await loadApprovals(clearanceScope);
                  await loadPendingClearanceCount();
                }}
              >
                <span className="inline-flex items-center gap-2">
                  Clearance
                  {pendingClearanceCount > 0 ? (
                    <span className="text-[10px] rounded-full border border-amber-900 bg-amber-950/40 px-2 py-0.5 text-amber-200">
                      {pendingClearanceCount}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
          </div>

          <button
            className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 whitespace-nowrap"
            onClick={() => {
              if (showClearance) {
                loadApprovals(clearanceScope);
                loadPendingClearanceCount();
              } else {
                load();
                loadPendingClearanceCount();
              }
            }}
            type="button"
          >
            Refresh
          </button>
        </div>

        {showClearance ? (
          <>
            <div className="text-xs text-neutral-500 mb-2">
              Clearance required before public release. Approve or reject derivative requests here.
            </div>
            <div className="mb-3 flex items-center gap-2">
              {(["pending", "voted", "cleared"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={[
                    "text-[11px] rounded border px-2 py-1",
                    clearanceScope === key
                      ? "border-white/30 bg-white/5"
                      : "border-neutral-800 hover:bg-neutral-900"
                  ].join(" ")}
                  onClick={() => {
                    setClearanceScope(key);
                    loadApprovals(key);
                    loadPendingClearanceCount();
                  }}
                >
                  {key === "pending"
                    ? `Pending${pendingClearanceCount > 0 ? ` (${pendingClearanceCount})` : ""}`
                    : key === "voted"
                    ? "Voted"
                    : "Cleared"}
                </button>
              ))}
            </div>
            {/* debug panel removed */}
          </>
        ) : null}

        {showClearance ? (
          approvalsLoading ? (
            <div className="text-sm text-neutral-400">Loading clearance…</div>
          ) : approvals.length === 0 ? (
            <div className="text-sm text-neutral-400">
              {clearanceScope === "pending"
                ? "No pending clearance requests."
                : clearanceScope === "voted"
                ? "No clearance requests you’ve voted on yet."
                : "No cleared requests yet."}
              <div className="text-[11px] text-neutral-500 mt-1">
                If you don’t see requests, make sure you’ve accepted the split invite for the parent work.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {approvals.map((a) => {
                const linkId = String(a?.linkId || "");
                const clearance = linkId ? clearanceByLink[linkId] : null;
                const progressBps = clearance?.progressBps || 0;
                const thresholdBps = clearance?.thresholdBps || 6667;
                const approvedApprovers = Array.isArray(clearance?.votes)
                  ? clearance.votes.filter((v: any) => {
                      if (String(v.decision).toLowerCase() !== "approve") return false;
                      const approvedRatePercent = clearance?.upstreamBps ? clearance.upstreamBps / 100 : null;
                      if (approvedRatePercent === null || v.upstreamRatePercent === null || v.upstreamRatePercent === undefined) {
                        return true;
                      }
                      return Number(v.upstreamRatePercent) === Number(approvedRatePercent);
                    }).length
                  : 0;
                const approverCount = Array.isArray(clearance?.approvers) ? clearance.approvers.length : 0;
                const pct = thresholdBps > 0 ? Math.min(100, Math.round((progressBps / thresholdBps) * 100)) : 0;
                const relation = titleCase(a?.relation || "Derivative");
                const parentTitle = a?.parentTitle || a?.parentContentId || "Original work";
                const childTitle = a?.childTitle || a?.childContentId || "Derivative";
                const isLoading = linkId ? clearanceLoadingByLink[linkId] : false;
                const isCleared = a?.status === "APPROVED";
                const viewerVote = String(a?.viewerVote || "").toLowerCase();

                return (
                  <div key={a.authorizationId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{childTitle}</div>
                        <div className="text-xs text-neutral-400">
                          {relation} of{" "}
                          <a className="underline text-neutral-200" href={`/splits/${a.parentContentId}`}>
                            {parentTitle}
                          </a>
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-1">
                          Clearance: {isCleared ? "Cleared" : "Pending"} • Rights holders approved: {approvedApprovers} of{" "}
                          {approverCount || "?"}
                          {viewerVote ? ` • You ${viewerVote}` : ""}
                        </div>
                        {linkId ? (
                          <div className="text-[10px] text-neutral-600 mt-1">
                            Link ID: {linkId}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          onClick={() => (linkId ? loadClearanceSummary(linkId) : null)}
                          disabled={!linkId}
                        >
                          {isLoading ? "Loading…" : "Refresh"}
                        </button>
                        {!isCleared ? (
                          <>
                            <button
                              type="button"
                              className="text-xs rounded-md border border-emerald-900 bg-emerald-950/30 px-2 py-1 text-emerald-200"
                              onClick={async () => {
                                if (!linkId) return;
                                const input = window.prompt("Set upstream royalty rate (%) for clearance", "10");
                                const pct = Number((input || "").trim());
                                if (!Number.isFinite(pct)) {
                                  setError("Upstream rate required to grant clearance.");
                                  return;
                                }
                                await api(`/content-links/${linkId}/vote`, "POST", {
                                  decision: "approve",
                                  upstreamRatePercent: pct
                                });
                                await loadApprovals(clearanceScope);
                                await loadPendingClearanceCount();
                                await loadClearanceSummary(linkId);
                              }}
                              disabled={!linkId}
                            >
                              Grant permission
                            </button>
                            <button
                              type="button"
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={async () => {
                                if (!linkId) return;
                                await api(`/content-links/${linkId}/vote`, "POST", { decision: "reject" });
                                await loadApprovals(clearanceScope);
                                await loadPendingClearanceCount();
                                await loadClearanceSummary(linkId);
                              }}
                              disabled={!linkId}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2 h-2 rounded-full bg-neutral-900 border border-neutral-800 overflow-hidden">
                      <div className="h-full bg-emerald-600/40" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-neutral-500">
                      Progress: {progressBps}/{thresholdBps} bps
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : loading ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-neutral-400">{showTrash ? "Trash is empty." : "No content yet."}</div>
        ) : (
          <div className="space-y-2">
            {items.map((it) => {
              const isOwner = !it.ownerUserId || it.ownerUserId === meId;
              const ownerLabel = it.owner?.displayName || it.owner?.email || it.ownerUserId || "Unknown";
              const isOpen = !!expanded[it.id];
              const filesCount = it._count?.files ?? 0;
              const isFilesLoading = !!filesLoading[it.id];
              const files = filesByContent[it.id] || [];
              const busy = !!busyAction[it.id];
              const accessTag = it.libraryAccess || (it.ownerUserId === meId ? "owned" : "preview");
              const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(it.type || ""));

              const split = splitByContent[it.id] ?? null;
              const isSplitLoading = !!splitLoading[it.id];
              const storefrontStatus = (it.storefrontStatus || "DISABLED") as "DISABLED" | "UNLISTED" | "LISTED";
              const manifestSha256 = it.manifest?.sha256 || "";
              const publicMetaUrl = `${apiBase}/public/content/${it.id}`;
              const publicAccessUrl = `${apiBase}/public/content/${it.id}/access?manifestSha256=${encodeURIComponent(
                manifestSha256
              )}&receiptToken=<receiptToken>`;
              const isAuthed = Boolean(getToken());
              const onchainAvailable = identities.some((i) => i.payoutMethod.code === "btc_onchain" && i.value);
              const lightningAvailable = identities.some(
                (i) => (i.payoutMethod.code === "lightning_address" || i.payoutMethod.code === "lnurl") && i.value
              );

              return (
                <div key={it.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{it.title}</div>
                      <div className="text-xs text-neutral-400">
                        {it.type.toUpperCase()} • {it.status.toUpperCase()} • {formatDateLabel(it.createdAt)} • {filesCount} file
                        {filesCount === 1 ? "" : "s"}
                        • Storefront: {(it.storefrontStatus || "DISABLED").toString()}
                        {showTrash && it.deletedAt ? ` • Deleted ${formatDateLabel(it.deletedAt)}` : ""}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1 capitalize">Access: {accessTag}</div>
                      {!isOwner ? (
                        <div className="text-xs text-amber-300 mt-1">Read-only • Owner: {ownerLabel}</div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!showTrash ? (
                        <>
                          {isOwner ? (
                            <>
                              <button
                                type="button"
                                className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 whitespace-nowrap"
                                onClick={async () => {
                                  const next = !isOpen;
                                  setExpanded((m) => ({ ...m, [it.id]: next }));
                                  if (next) {
                                    try {
                                      await Promise.all([
                                        filesByContent[it.id] ? Promise.resolve() : loadFiles(it.id),
                                        splitByContent[it.id] !== undefined ? Promise.resolve() : loadLatestSplit(it.id),
                                        derivativeAuthByContent[it.id] !== undefined ? Promise.resolve() : loadDerivativeAuth(it.id),
                                        approvals.length ? Promise.resolve() : loadApprovals(),
                                        salesByContent[it.id] !== undefined ? Promise.resolve() : loadSales(it.id),
                                        parentLinkByContent[it.id] !== undefined ? Promise.resolve() : loadParentLink(it.id),
                                        derivativesByContent[it.id] !== undefined ? Promise.resolve() : loadDerivativesForParent(it.id),
                                        creditsByContent[it.id] !== undefined ? Promise.resolve() : loadCredits(it.id),
                                        auditByContent[it.id] !== undefined ? Promise.resolve() : loadAudit(it.id)
                                      ]);
                                    } catch (e: any) {
                                      setError(e?.message || "Failed to load content details.");
                                    }
                                  }
                                }}
                              >
                                {isOpen ? "Hide files" : "Show files"}
                              </button>

                              <UploadButton contentId={it.id} disabled={busy} />

                              <button
                                type="button"
                                className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60 whitespace-nowrap"
                                onClick={() => onOpenSplits?.(it.id)}
                                disabled={busy}
                              >
                                Edit splits
                              </button>

                              <button
                                type="button"
                                className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60 whitespace-nowrap"
                                onClick={() => publishContent(it.id)}
                                disabled={publishBusy[it.id] || it.status === "published"}
                                title={it.status === "published" ? "Already published" : "Publish this content"}
                              >
                                {it.status === "published" ? "Published" : publishBusy[it.id] ? "Publishing…" : "Publish"}
                              </button>

                              <button
                                type="button"
                                className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60 whitespace-nowrap"
                                onClick={() => softDelete(it.id)}
                                disabled={busy}
                                title="Move to trash"
                              >
                                {busy ? "…" : "Trash"}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="text-sm rounded-lg border border-neutral-800 px-3 py-1 text-neutral-500 whitespace-nowrap cursor-not-allowed"
                              disabled
                            >
                              Read-only
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60 whitespace-nowrap"
                            onClick={() => restore(it.id)}
                            disabled={busy}
                          >
                            Restore
                          </button>

                          <button
                            type="button"
                            className="text-sm rounded-lg border border-red-900 text-red-200 px-3 py-1 hover:bg-red-950/30 disabled:opacity-60 whitespace-nowrap"
                            onClick={() => deleteForever(it.id)}
                            disabled={busy}
                            title="Permanently delete"
                          >
                            Delete forever
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {!showTrash && isOpen && (
                    <div className="border-t border-neutral-800 px-3 py-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-neutral-400">
                          Repo: <span className="text-neutral-300">{it.repoPath || "not set"}</span>
                        </div>

                        <button
                          type="button"
                          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          onClick={async () => {
                            try {
                              await api(`/content/${it.id}/open-folder`, "POST");
                            } catch (e: any) {
                              setError(e?.message || "Failed to open folder");
                            }
                          }}
                          title="Open in file manager"
                        >
                          Open folder
                        </button>
                      </div>

                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="text-xs text-neutral-300 font-medium">File identity</div>
                        {isFilesLoading ? (
                          <div className="mt-2 text-sm text-neutral-400">Loading files…</div>
                        ) : files.length === 0 ? (
                          <div className="mt-2 text-sm text-neutral-400">No files yet. Click Upload.</div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {files.map((f) => {
                              const hasVerify =
                                typeof f.sha256MatchesManifest === "boolean" ||
                                (typeof f.manifestSha256 === "string" && f.manifestSha256.length > 0);

                              const verified =
                                typeof f.sha256MatchesManifest === "boolean"
                                  ? f.sha256MatchesManifest
                                  : f.manifestSha256
                                    ? eqSha(f.manifestSha256, f.sha256)
                                    : null;

                              // Optional: highlight if this file is the locked split target
                              const isLockedTarget =
                                split?.status === "locked" &&
                                !!split.lockedFileObjectKey &&
                                split.lockedFileObjectKey === f.objectKey;

                              return (
                                <div key={f.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium truncate flex items-center gap-2">
                                        <span className="truncate">{f.originalName}</span>
                                        {isLockedTarget ? (
                                          <span
                                            className="shrink-0 rounded-md border border-amber-900 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-200"
                                            title="This is the exact file the latest locked split was notarized against"
                                          >
                                            Locked target
                                          </span>
                                        ) : null}
                                      </div>

                                      <div className="text-xs text-neutral-400 flex flex-wrap items-center gap-2">
                                        <span>
                                          {formatBytes(f.sizeBytes)} • {formatDateLabel(f.createdAt)} • {f.objectKey}
                                        </span>

                                        <span
                                          className="rounded-md border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-emerald-200"
                                          title="sha256 is a fingerprint of the file bytes (integrity), not encryption"
                                        >
                                          Tracked (sha256)
                                        </span>

                                        {hasVerify && verified !== null && (
                                          <span
                                            className={`rounded-md border px-2 py-0.5 ${
                                              verified
                                                ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                                                : "border-red-900 bg-red-950/30 text-red-200"
                                            }`}
                                            title={verified ? "DB sha256 matches manifest.json" : "Mismatch: DB sha256 != manifest.json"}
                                          >
                                            {verified ? "Verified" : "Mismatch"}
                                          </span>
                                        )}

                                        {f.encAlg && f.encAlg !== "none" && (
                                          <span className="rounded-md border border-sky-900 bg-sky-950/30 px-2 py-0.5 text-sky-200" title={`encAlg=${f.encAlg}`}>
                                            Encrypted
                                          </span>
                                        )}
                                      </div>

                                      <div className="text-[11px] text-neutral-500 mt-1">
                                        sha256: <span className="text-neutral-400">{shortSha(f.sha256, 16)}</span>
                                        {f.manifestSha256 ? (
                                          <>
                                            {" "}
                                            • manifest: <span className="text-neutral-400">{shortSha(f.manifestSha256, 16)}</span>
                                          </>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                        onClick={() => navigator.clipboard.writeText(f.objectKey)}
                                        title="Copy repo path (relative)"
                                      >
                                        Copy path
                                      </button>

                                      <button
                                        type="button"
                                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                        onClick={() => navigator.clipboard.writeText(f.sha256)}
                                        title="Copy sha256 fingerprint"
                                      >
                                        Copy sha
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* NEW: Split lock notarization preview */}
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-neutral-300">
                            {isSplitLoading ? (
                              <span className="text-neutral-400">Loading split status…</span>
                            ) : split ? (
                              <>
                                <span className="font-medium">Split v{split.versionNumber}</span>{" "}
                                <span className="text-neutral-400">• {String(split.status).toUpperCase()}</span>
                                {split.status === "locked" && split.lockedAt ? (
                                  <span className="text-neutral-500"> • Locked {formatDateLabel(split.lockedAt)}</span>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-neutral-400">Split status unavailable</span>
                            )}
                          </div>

                          <button
                            type="button"
                            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            onClick={() => loadLatestSplit(it.id)}
                          >
                            Refresh split
                          </button>
                        </div>

                        {split?.status === "locked" && (split.lockedFileObjectKey || split.lockedFileSha256) ? (
                          <div className="mt-2 text-xs text-neutral-400 space-y-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                Locked file: <span className="text-neutral-300 break-all">{split.lockedFileObjectKey || "—"}</span>
                              </div>
                              {split.lockedFileObjectKey ? (
                                <button
                                  type="button"
                                  className="shrink-0 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                  onClick={() => navigator.clipboard.writeText(split.lockedFileObjectKey!)}
                                >
                                  Copy path
                                </button>
                              ) : null}
                            </div>

                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                Locked sha256: <span className="text-neutral-300">{shortSha(split.lockedFileSha256, 24) || "—"}</span>
                              </div>
                              {split.lockedFileSha256 ? (
                                <button
                                  type="button"
                                  className="shrink-0 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                  onClick={() => navigator.clipboard.writeText(split.lockedFileSha256!)}
                                >
                                  Copy sha
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-neutral-500">
                            When you lock a split, we record the exact file path + sha256 it was locked against.
                          </div>
                        )}
                      </div>

                      {/* Lineage summary */}
                      {(() => {
                        const parentLink = parentLinkByContent[it.id] || null;
                        const isDerivative = isDerivativeType;
                        const upstreamRatePct =
                          parentLink && typeof parentLink.upstreamBps === "number"
                            ? (parentLink.upstreamBps / 100).toFixed(parentLink.upstreamBps % 100 ? 2 : 0)
                            : null;
                        if (parentLink && isDerivative) {
                          return (
                            <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs text-neutral-300 font-medium">
                                  Derivative of {parentLink.parent?.title || "Original work"}
                                </div>
                                <button
                                  type="button"
                                  className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                  onClick={() => loadParentLink(it.id)}
                                >
                                  Refresh
                                </button>
                              </div>
                              <div className="mt-1 text-xs text-neutral-400">
                                Public release is locked until clearance by original rights holders.
                              </div>
                              <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] font-medium text-neutral-200">Clearance / License for release</div>
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                      parentLink.approvedAt
                                        ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                                        : "border-amber-900 bg-amber-950/30 text-amber-200"
                                    }`}
                                  >
                                    {parentLink.approvedAt ? "Cleared" : "Pending clearance"}
                                  </span>
                                </div>
                                <div className="mt-1 text-[11px] text-neutral-400">
                                  Upstream:{" "}
                                  <span className="text-neutral-200">
                                    {parentLink.upstreamBps ? `${upstreamRatePct}%` : "Set at clearance"}
                                  </span>
                                  {" "}•{" "}
                                  <a href={`/splits/${it.id}`} className="text-neutral-200 underline">
                                    View routing
                                  </a>
                                </div>
                                <div className="mt-2 h-2 rounded-full bg-neutral-900 border border-neutral-800 overflow-hidden">
                                  {(() => {
                                    const approve = parentLink.clearance?.approveWeightBps || 0;
                                    const target = parentLink.clearance?.approvalBpsTarget || 6667;
                                    const pct = target > 0 ? Math.min(100, Math.round((approve / target) * 100)) : 0;
                                    return (
                                      <div
                                        className="h-full bg-emerald-600/40"
                                        style={{ width: `${pct}%` }}
                                      />
                                    );
                                  })()}
                                </div>
                                <div className="mt-1 text-[10px] text-neutral-500">
                                  {parentLink.clearance
                                    ? `Approval progress: ${parentLink.clearance.approveWeightBps}/${parentLink.clearance.approvalBpsTarget} bps • Approvers: ${
                                        (parentLink.clearance as any).approverCount ?? parentLink.clearance.approvedApprovers
                                      }`
                                    : "Approval progress: 0/6667 bps"}
                                </div>
                                <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] text-neutral-500">
                                  {[
                                    { label: "Requested", done: true },
                                    { label: "Review", done: true },
                                    { label: "Cleared", done: Boolean(parentLink.approvedAt) },
                                    { label: "Public", done: it.storefrontStatus !== "DISABLED" }
                                  ].map((s) => (
                                    <div key={s.label} className="flex items-center gap-1">
                                      <span
                                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                                          s.done ? "bg-emerald-400" : "bg-neutral-700"
                                        }`}
                                      />
                                      <span className={s.done ? "text-neutral-300" : "text-neutral-500"}>{s.label}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {!parentLink.approvedAt ? (
                                <div className="mt-1 text-[11px] text-neutral-500">
                                  You can share/sell privately now. To release publicly, request clearance from original rights holders.
                                </div>
                              ) : null}
                              {filesCount === 0 ? (
                                <div className="mt-2 text-[11px] text-amber-300 flex items-center gap-2">
                                  <span>No files uploaded yet. Upload your remix to enable preview and clearance.</span>
                                  <UploadButton contentId={it.id} disabled={busy} />
                                </div>
                              ) : null}
                              {parentLink.parentSplit?.status && parentLink.parentSplit.status !== "locked" ? (
                                <div className="mt-1 text-[11px] text-amber-300">
                                  Clearance unlocks only after the original split is locked. Ask OG to lock their split.
                                </div>
                              ) : null}
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                  onClick={() => loadDerivativePreview(it.id)}
                                >
                                  {derivativePreviewLoading[it.id] ? "Loading…" : "Load preview"}
                                </button>
                                <button
                                  type="button"
                                  className="text-[11px] rounded border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-emerald-200"
                                  onClick={async () => {
                                    if (!parentLink?.linkId) {
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: "Missing parent link." }));
                                      return;
                                    }
                                    try {
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: "" }));
                                      await api(`/content-links/${parentLink.linkId}/grant-review`, "POST");
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: "Preview access granted to OG." }));
                                    } catch (e: any) {
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: e?.message || "Grant failed." }));
                                    }
                                  }}
                                >
                                  Grant preview access
                                </button>
                                <button
                                  type="button"
                                  className="text-[11px] rounded border border-red-900 bg-red-950/30 px-2 py-0.5 text-red-200"
                                  onClick={async () => {
                                    if (!parentLink?.linkId) {
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: "Missing parent link." }));
                                      return;
                                    }
                                    try {
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: "" }));
                                      await api(`/content-links/${parentLink.linkId}/revoke-review`, "POST");
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: "Preview access revoked." }));
                                    } catch (e: any) {
                                      setReviewGrantMsgByContent((m) => ({ ...m, [it.id]: e?.message || "Revoke failed." }));
                                    }
                                  }}
                                >
                                  Revoke preview access
                                </button>
                              </div>
                              {reviewGrantMsgByContent[it.id] ? (
                                <div className="mt-2 text-[11px] text-neutral-300">{reviewGrantMsgByContent[it.id]}</div>
                              ) : null}
                              {derivativePreviewError[it.id] ? (
                                <div className="mt-2 text-[11px] text-amber-300">
                                  {derivativePreviewError[it.id]}
                                </div>
                              ) : null}
                              {derivativePreviewByChild[it.id] ? (
                                <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-[11px] text-neutral-300">
                                  <div className="text-sm font-semibold text-neutral-100">Preview</div>
                                  <div className="text-[11px] text-neutral-400 mt-1">Read-only playback of your submission.</div>
                                  {(() => {
                                    const previewUrl = derivativePreviewByChild[it.id]?.previewUrl || null;
                                    const pf = previewFileFor(previewUrl, derivativePreviewByChild[it.id]?.files || []);
                                    const mime = String(pf?.mime || "").toLowerCase();
                                    const type = String(derivativePreviewByChild[it.id]?.content?.type || "").toLowerCase();
                                    const isVideo = mime.startsWith("video/") || type === "video";
                                    const isAudio = mime.startsWith("audio/") || type === "song";
                                    if (previewUrl && isVideo) {
                                      return (
                                        <div className="mt-2">
                                          <video className="w-full rounded-md" controls src={previewUrl} />
                                        </div>
                                      );
                                    }
                                    if (previewUrl && isAudio) {
                                      return (
                                        <div className="mt-2">
                                          <audio className="w-full" controls src={previewUrl} />
                                        </div>
                                      );
                                    }
                                    if (previewUrl) {
                                      return (
                                        <a className="text-emerald-300 underline" href={previewUrl} target="_blank" rel="noreferrer">
                                          Open preview
                                        </a>
                                      );
                                    }
                                    return <div className="text-neutral-400">No preview available.</div>;
                                  })()}
                                  {Array.isArray(derivativePreviewByChild[it.id]?.files) &&
                                  derivativePreviewByChild[it.id].files.length > 0 ? (
                                    <div className="mt-2 space-y-1">
                                      {derivativePreviewByChild[it.id].files.map((f: any) => (
                                        <div key={f.id} className="text-neutral-400">
                                          {f.originalName || f.objectKey} • {formatBytes(f.sizeBytes || 0)}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        }
                        if (!parentLink && !isDerivative) return null;
                        return (
                          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                            <div className="text-xs text-neutral-300 font-medium">Lineage</div>
                            {parentLink ? (
                              <div className="mt-2 text-xs text-neutral-400">
                                Original:{" "}
                                <a href={`/splits/${parentLink.parent?.id}`} className="text-neutral-200 underline">
                                  {parentLink.parent?.title || "Original work"}
                                </a>
                                {" "}• Upstream: {parentLink.approvedAt ? `${upstreamRatePct}%` : "Set at clearance"} • Clearance:{" "}
                                {parentLink.requiresApproval ? (parentLink.approvedAt ? "Cleared" : "Pending clearance") : "Not required"}
                                {" "}•{" "}
                                <a href={`/splits/${it.id}`} className="text-neutral-200 underline">
                                  View routing
                                </a>
                              </div>
                            ) : (
                              <div className="mt-2 text-xs text-amber-300">
                                No original linked. <a href={`/splits/${it.id}`} className="underline">Link original in Splits</a>.
                              </div>
                            )}
                            {parentLinkErrorByContent[it.id] ? (
                              <div className="mt-1 text-xs text-amber-300">{parentLinkErrorByContent[it.id]}</div>
                            ) : null}
                          </div>
                        );
                      })()}

                      {!isDerivativeType ? (
                        <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-neutral-300">Derivatives</div>
                          <button
                            type="button"
                            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            onClick={() => loadDerivativesForParent(it.id)}
                          >
                            {derivativesLoading[it.id] ? "Loading…" : "Refresh"}
                          </button>
                        </div>
                        <div className="mt-2 space-y-2">
                          {(derivativesByContent[it.id] || []).map((d) => (
                            <div key={d.linkId} className="rounded-md border border-neutral-800 bg-neutral-950/50 p-2">
                                <div className="flex items-center justify-between gap-2">
                                <div className="text-neutral-300">
                                  {d.childTitle || d.childContentId}
                                  {d.childDeletedAt ? <span className="ml-2 text-[10px] text-amber-300">(deleted)</span> : null}
                                </div>
                                  <div className="flex items-center gap-2">
                                  <div className="flex items-center gap-2 text-neutral-400">
                                    <span
                                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                        d.approvedAt
                                          ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                                          : "border-amber-900 bg-amber-950/30 text-amber-200"
                                      }`}
                                    >
                                      {d.approvedAt ? "Cleared" : "Pending"}
                                    </span>
                                    <span className="text-[11px]">
                                      Upstream {(d.upstreamBps || 0) / 100}%
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                    onClick={async () => {
                                      const next = !(clearanceHistoryOpen[d.linkId] ?? false);
                                      setClearanceHistoryOpen((m) => ({ ...m, [d.linkId]: next }));
                                      if (next && !clearanceHistoryByLink[d.linkId]) {
                                        await loadClearanceHistory(d.linkId);
                                      }
                                    }}
                                  >
                                    {clearanceHistoryOpen[d.linkId] ? "Hide history" : "History"}
                                  </button>
                                  <button
                                    type="button"
                                    className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                    onClick={() => loadDerivativePreview(d.childContentId)}
                                  >
                                    {derivativePreviewLoading[d.childContentId] ? "Loading…" : "Preview submission"}
                                  </button>
                                  {(() => {
                                    const viewer = d.clearance?.viewer || null;
                                    const hasVoted = Boolean(viewer?.hasVoted);
                                    const decision = String(viewer?.decision || "").toLowerCase();
                                    const canVote = Boolean(viewer?.canVote);
                                    if (d.approvedAt) {
                                      return (
                                        <span className="text-[11px] rounded border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-emerald-200">
                                          Cleared for release ({(d.upstreamBps || 0) / 100}% upstream)
                                        </span>
                                      );
                                    }
                                    if (hasVoted) {
                                      return (
                                        <span className="text-[11px] rounded border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-emerald-200">
                                          {decision === "reject" ? "You rejected" : "You approved"}
                                        </span>
                                      );
                                    }
                                    if (!canVote) return null;
                                    return (
                                      <button
                                        type="button"
                                        className="text-[11px] rounded border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-emerald-200"
                                        onClick={async () => {
                                          const input = window.prompt("Set upstream royalty rate (%) for clearance", "10");
                                          const pct = Number((input || "").trim());
                                          if (!Number.isFinite(pct)) {
                                            setError("Upstream rate required to grant clearance.");
                                            return;
                                          }
                                          await api(`/content-links/${d.linkId}/vote`, "POST", {
                                            decision: "approve",
                                            upstreamRatePercent: pct
                                          });
                                          await loadDerivativesForParent(it.id);
                                        }}
                                      >
                                        Grant permission
                                      </button>
                                    );
                                  })()}
                                </div>
                                </div>
                                <div className="mt-1 text-[11px] text-neutral-500">
                                  {titleCase(d.relation || "Derivative")} of {it.title}
                                </div>
                                <div className="mt-2 h-2 rounded-full bg-neutral-900 border border-neutral-800 overflow-hidden">
                                  {(() => {
                                    const approve = d.clearance?.approveWeightBps || 0;
                                    const target = d.clearance?.approvalBpsTarget || 6667;
                                    const pct = target > 0 ? Math.min(100, Math.round((approve / target) * 100)) : 0;
                                    return (
                                      <div
                                        className="h-full bg-emerald-600/40"
                                        style={{ width: `${pct}%` }}
                                      />
                                    );
                                  })()}
                                </div>
                                {d.clearance ? (
                                  <div className="mt-1 text-[11px] text-neutral-500">
                                    Rights holders approved: {d.clearance.approvedApprovers ?? 0} of{" "}
                                    {(d.clearance as any).approverCount ?? d.clearance.approvedApprovers}
                                    {" "}•{" "}Progress: {d.clearance.approveWeightBps}/{d.clearance.approvalBpsTarget} bps
                                  </div>
                                ) : null}
                                {derivativePreviewError[d.childContentId] ? (
                                  <div className="mt-2 text-[11px] text-amber-300">
                                    {derivativePreviewError[d.childContentId]}
                                  </div>
                                ) : null}
                              {derivativePreviewByChild[d.childContentId] ? (
                                <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/60 p-2 text-[11px] text-neutral-300">
                                  <div className="font-medium text-neutral-200">Preview</div>
                                  {(() => {
                                    const previewUrl = derivativePreviewByChild[d.childContentId]?.previewUrl || null;
                                    const pf = previewFileFor(previewUrl, derivativePreviewByChild[d.childContentId]?.files || []);
                                    const mime = String(pf?.mime || "").toLowerCase();
                                    const type = String(derivativePreviewByChild[d.childContentId]?.content?.type || "").toLowerCase();
                                    const isVideo = mime.startsWith("video/") || type === "video";
                                    const isAudio = mime.startsWith("audio/") || type === "song";
                                    if (previewUrl && isVideo) {
                                      return (
                                        <div className="mt-2">
                                          <video className="w-full rounded-md" controls src={previewUrl} />
                                        </div>
                                      );
                                    }
                                    if (previewUrl && isAudio) {
                                      return (
                                        <div className="mt-2">
                                          <audio className="w-full" controls src={previewUrl} />
                                        </div>
                                      );
                                    }
                                    if (previewUrl) {
                                      return (
                                        <a className="text-emerald-300 underline" href={previewUrl} target="_blank" rel="noreferrer">
                                          Open preview
                                        </a>
                                      );
                                    }
                                    return <div className="text-neutral-400">No preview available.</div>;
                                  })()}
                                  {Array.isArray(derivativePreviewByChild[d.childContentId]?.files) &&
                                  derivativePreviewByChild[d.childContentId].files.length > 0 ? (
                                    <div className="mt-2 space-y-1">
                                      {derivativePreviewByChild[d.childContentId].files.map((f: any) => (
                                        <div key={f.id} className="text-neutral-400">
                                          {f.originalName || f.objectKey} • {formatBytes(f.sizeBytes || 0)}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {clearanceHistoryOpen[d.linkId] ? (
                                <div className="mt-2">
                                  <HistoryFeed
                                    title="Clearance history"
                                    items={clearanceHistoryByLink[d.linkId] || []}
                                    loading={clearanceHistoryLoading[d.linkId]}
                                    emptyText="No clearance history yet."
                                    exportName={`clearance-history-${d.linkId}.json`}
                                    onRefresh={async () => {
                                      await loadClearanceHistory(d.linkId);
                                    }}
                                  />
                                </div>
                              ) : null}
                              <div className="mt-2">
                                <AuditPanel
                                  scopeType="clearance"
                                  scopeId={d.linkId}
                                  title="Audit"
                                  exportName={`clearance-audit-${d.linkId}.json`}
                                />
                              </div>
                            </div>
                          ))}
                          {(derivativesByContent[it.id] || []).length === 0 ? (
                            <div className="text-neutral-500">No linked derivatives.</div>
                          ) : null}
                        </div>
                      </div>
                      ) : null}

                      {/* Storefront panel */}
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="text-xs text-neutral-300 font-medium">Monetization</div>
                        <div className="mt-2 grid gap-3 md:grid-cols-3">
                          <div className="md:col-span-1">
                            <label className="block text-xs text-neutral-400 mb-1">Price (sats)</label>
                            <input
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs outline-none focus:border-neutral-600"
                              value={priceDraft[it.id] ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, "");
                                setPriceDraft((m) => ({ ...m, [it.id]: v }));
                              }}
                              placeholder="1000"
                              inputMode="numeric"
                            />
                          </div>
                          <div className="md:col-span-2 text-xs text-neutral-400 space-y-1">
                            <div>Fans can pay with Lightning or Bitcoin.</div>
                            <button
                              type="button"
                              className="mt-2 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={async () => {
                                const raw = (priceDraft[it.id] || "").trim();
                                const sats = Number(raw);
                                if (!Number.isFinite(sats) || sats < 1) {
                                  setPriceMsg((m) => ({ ...m, [it.id]: "Price must be at least 1 sat." }));
                                  return;
                                }
                                try {
                                  setBusyAction((m) => ({ ...m, [it.id]: true }));
                                  setPriceMsg((m) => ({ ...m, [it.id]: "" }));
                                  await api(`/content/${it.id}/price`, "PATCH", { priceSats: raw });
                                  await load(showTrash);
                                  setPriceMsg((m) => ({ ...m, [it.id]: "Saved." }));
                                } catch (e: any) {
                                  setPriceMsg((m) => ({ ...m, [it.id]: e?.message || "Failed to save price." }));
                                } finally {
                                  setBusyAction((m) => ({ ...m, [it.id]: false }));
                                }
                              }}
                            >
                              Save price
                            </button>
                            {priceMsg[it.id] ? <div className="text-xs text-amber-300">{priceMsg[it.id]}</div> : null}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-neutral-300 font-medium">Share</div>
                        </div>
                        <div className="mt-2 text-xs text-neutral-400 space-y-2">
                          {(() => {
                            const effectivePublicOrigin = (publicOrigin || "").trim();
                            const effectiveBuyOrigin = (publicBuyOrigin || publicOrigin || "").trim();
                            const effectiveStudioOrigin = (publicStudioOrigin || publicOrigin || "").trim();
                            const buyBase = (effectiveBuyOrigin || effectivePublicOrigin || apiBase).replace(/\/$/, "");
                            const buyLink = `${buyBase}/buy/${it.id}`;
                            const isLocalOnly = !effectiveBuyOrigin && !effectivePublicOrigin && apiBase.includes("127.0.0.1");
                            return (
                              <>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    Buy link:{" "}
                                    <span className="text-neutral-300 break-all">
                                      {isLocalOnly ? "Local only (loopback)" : buyLink}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <button
                                      type="button"
                                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                      onClick={() => {
                                        if (!isLocalOnly) window.open(buyLink, "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      Open
                                    </button>
                                    <button
                                      type="button"
                                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                      onClick={() => copyText(buyLink)}
                                    >
                                      Copy link
                                    </button>
                                  </div>
                                </div>

                                {shareMsg[it.id] ? <div className="text-xs text-amber-300">{shareMsg[it.id]}</div> : null}

                                <div className="text-xs text-neutral-500">
                                  Content ID: <span className="text-neutral-300">{it.id}</span>{" "}
                                  <button
                                    type="button"
                                    className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900 ml-2"
                                    onClick={() => copyText(it.id)}
                                  >
                                    Copy
                                  </button>
                                </div>

                                <div className="text-xs text-neutral-500">
                                  Public link: <span className="text-neutral-300">{effectivePublicOrigin || "—"}</span>
                                </div>
                                <div className="text-xs text-neutral-500">
                                  Public status:{" "}
                                  <span className="text-neutral-300">
                                    {effectivePublicOrigin || effectiveBuyOrigin || effectiveStudioOrigin ? "enabled" : "disabled"}
                                  </span>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  {effectivePublicOrigin ? (
                                    <button
                                      type="button"
                                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                      onClick={async () => {
                                        try {
                                          await api("/api/public/stop", "POST");
                                          setPublicOrigin("");
                                          setPublicBuyOrigin("");
                                          setPublicStudioOrigin("");
                                        } catch (e: any) {
                                          setShareMsg((m) => ({ ...m, [it.id]: e?.message || "Failed to disable public access." }));
                                        }
                                      }}
                                    >
                                      Disable public sharing
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                      onClick={async () => {
                                        try {
                                          const res = await api<any>("/api/public/go", "POST");
                                          if (res?.publicOrigin) setPublicOrigin(res.publicOrigin);
                                        } catch (e: any) {
                                          setShareMsg((m) => ({ ...m, [it.id]: e?.message || "Public sharing unavailable." }));
                                        }
                                      }}
                                    >
                                      Enable public sharing
                                    </button>
                                  )}
                                </div>

                                {shareP2PLink[it.id] ? (
                                  <div className="flex items-start justify-between gap-2 text-xs text-neutral-500">
                                    <div className="min-w-0 break-all">
                                      P2P link: <span className="text-neutral-300">{shareP2PLink[it.id]}</span>
                                    </div>
                                    <button
                                      type="button"
                                      className="shrink-0 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                      onClick={() => copyText(shareP2PLink[it.id])}
                                    >
                                      Copy
                                    </button>
                                  </div>
                                ) : null}

                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                  <button
                                    type="button"
                                    className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                                    onClick={() => buildP2PLink(it.id, manifestSha256 || null)}
                                    disabled={!!shareBusy[it.id]}
                                  >
                                    Copy LAN P2P Link
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                                    onClick={() => {
                                      const { host, port } = hostPortFromOrigin(effectiveBuyOrigin);
                                      const baseUrl = effectiveBuyOrigin ? effectiveBuyOrigin : "";
                                      return buildP2PLink(it.id, manifestSha256 || null, { host, port, baseUrl });
                                    }}
                                    disabled={!effectiveBuyOrigin || !!shareBusy[it.id]}
                                  >
                                    Copy Buy P2P Link
                                  </button>
                                </div>

                                {!manifestSha256 ? (
                                  <div className="text-xs text-amber-300">
                                    Publish to generate a manifest before sharing P2P links.
                                  </div>
                                ) : null}
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="text-xs text-neutral-300 font-medium">Credits</div>
                        <div className="mt-2 space-y-2 text-xs text-neutral-400">
                          {creditsLoading[it.id] ? (
                            <div>Loading credits…</div>
                          ) : (creditsByContent[it.id] || []).length === 0 ? (
                            <div className="text-neutral-500">No credits yet.</div>
                          ) : (
                            (creditsByContent[it.id] || []).map((c) => (
                              <div key={c.id} className="flex items-center justify-between gap-3">
                                <div className="text-neutral-200">
                                  {c.name} — {c.role}
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                    onClick={async () => {
                                      const name = window.prompt("Credit name", c.name || "");
                                      if (!name) return;
                                      const role = window.prompt("Role", c.role || "");
                                      if (!role) return;
                                      try {
                                        await api(`/content/${it.id}/credits/${c.id}`, "PATCH", { name, role });
                                        await loadCredits(it.id);
                                      } catch (e: any) {
                                        setCreditMsg((m) => ({ ...m, [it.id]: e?.message || "Failed to update credit." }));
                                      }
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                    onClick={async () => {
                                      if (!window.confirm("Remove this credit?")) return;
                                      try {
                                        await api(`/content/${it.id}/credits/${c.id}`, "DELETE");
                                        await loadCredits(it.id);
                                      } catch (e: any) {
                                        setCreditMsg((m) => ({ ...m, [it.id]: e?.message || "Failed to remove credit." }));
                                      }
                                    }}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        {publishMsg[it.id] ? (
                          <div className="mt-2 text-xs text-neutral-400">{publishMsg[it.id]}</div>
                        ) : null}

                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <input
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
                            placeholder="Name"
                            value={creditNameDraft[it.id] || ""}
                            onChange={(e) => setCreditNameDraft((m) => ({ ...m, [it.id]: e.target.value }))}
                          />
                          <input
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
                            placeholder="Role (Writer, Producer, Mix, Mastering, etc.)"
                            value={creditRoleDraft[it.id] || ""}
                            onChange={(e) => setCreditRoleDraft((m) => ({ ...m, [it.id]: e.target.value }))}
                          />
                        </div>
                        <button
                          type="button"
                          className="mt-2 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          onClick={async () => {
                            const name = (creditNameDraft[it.id] || "").trim();
                            const role = (creditRoleDraft[it.id] || "").trim();
                            if (!name || !role) {
                              setCreditMsg((m) => ({ ...m, [it.id]: "Name and role required." }));
                              return;
                            }
                            try {
                              await api(`/content/${it.id}/credits`, "POST", { name, role });
                              setCreditNameDraft((m) => ({ ...m, [it.id]: "" }));
                              setCreditRoleDraft((m) => ({ ...m, [it.id]: "" }));
                              setCreditMsg((m) => ({ ...m, [it.id]: "Saved." }));
                              await loadCredits(it.id);
                            } catch (e: any) {
                              setCreditMsg((m) => ({ ...m, [it.id]: e?.message || "Failed to add credit." }));
                            }
                          }}
                        >
                          Add credit
                        </button>
                        {creditMsg[it.id] ? <div className="mt-1 text-xs text-amber-300">{creditMsg[it.id]}</div> : null}
                      </div>

                      {/* Storefront panel */}
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-neutral-300 font-medium">Storefront</div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] px-2 py-1 rounded-full border ${
                                storefrontStatus === "LISTED"
                                  ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                                  : storefrontStatus === "UNLISTED"
                                    ? "border-amber-900 text-amber-200 bg-amber-950/30"
                                    : "border-neutral-800 text-neutral-400 bg-neutral-950/60"
                              }`}
                            >
                              {storefrontStatus}
                            </span>
                          </div>
                        </div>

                        {parentLinkByContent[it.id] && parentLinkByContent[it.id]?.requiresApproval ? (
                          <div className="mt-2 text-xs text-neutral-400">
                            Clearance for public release:{" "}
                            <span className="text-neutral-200">
                              {parentLinkByContent[it.id]?.approvedAt ? "Cleared" : "Pending clearance"}
                            </span>
                          </div>
                        ) : null}
                        {parentLinkByContent[it.id]?.requiresApproval && !parentLinkByContent[it.id]?.approvedAt ? (
                          <div className="mt-1 text-xs text-amber-300">
                            Public release is locked until clearance. Private sales via direct link still work.
                          </div>
                        ) : null}
                        {parentLinkByContent[it.id]?.requiresApproval &&
                        !parentLinkByContent[it.id]?.approvedAt &&
                        parentLinkByContent[it.id]?.canRequestApproval ? (
                          <div className="mt-2 text-xs text-neutral-500">
                            Request clearance in Splits → Lineage / Upstream royalties.
                          </div>
                        ) : null}

                        <div className="mt-2 grid gap-3 md:grid-cols-3">
                          <div className="md:col-span-1">
                            <label className="block text-xs text-neutral-400 mb-1">Status</label>
                            <select
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs outline-none focus:border-neutral-600"
                              value={storefrontStatus}
                              onChange={(e) =>
                                updateStorefrontStatus(it.id, e.target.value as "DISABLED" | "UNLISTED" | "LISTED")
                              }
                              disabled={
                                busy ||
                                (parentLinkByContent[it.id]?.requiresApproval && !parentLinkByContent[it.id]?.approvedAt)
                              }
                            >
                              <option value="DISABLED">Disabled</option>
                              <option value="UNLISTED">Unlisted</option>
                              <option value="LISTED">Listed</option>
                            </select>
                          </div>

                          <div className="md:col-span-2 text-xs text-neutral-400 space-y-1">
                            <div>Disabled: not purchasable publicly.</div>
                            <div>Unlisted: purchasable by link (not discoverable).</div>
                            <div>Listed: purchasable and discoverable.</div>
                          </div>
                        </div>

                        <div className="mt-3 space-y-2 text-xs text-neutral-400">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              Public metadata: <span className="text-neutral-300 break-all">{publicMetaUrl}</span>
                            </div>
                            <button
                              type="button"
                              className="shrink-0 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={() => copyText(publicMetaUrl)}
                            >
                              Copy link
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              Public access: <span className="text-neutral-300 break-all">{publicAccessUrl}</span>
                            </div>
                            <button
                              type="button"
                              className="shrink-0 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={() => copyText(publicAccessUrl)}
                            >
                              Copy link
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
                          <div className="font-medium text-neutral-300 mb-1">Checkout rails availability</div>
                          {identitiesLoading ? (
                            <div>Loading payout destinations…</div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <span
                                className={`rounded-full border px-2 py-1 ${
                                  onchainAvailable
                                    ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                                    : "border-neutral-700 text-neutral-400 bg-neutral-950/60"
                                }`}
                              >
                                On-chain: {onchainAvailable ? "Available" : "Not configured"}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-1 ${
                                  lightningAvailable
                                    ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                                    : "border-neutral-700 text-neutral-400 bg-neutral-950/60"
                                }`}
                              >
                                Lightning: {lightningAvailable ? "Available" : "Not configured"}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-neutral-300">Storefront contract</div>
                            <button
                              type="button"
                              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={async () => {
                                setStorefrontPreviewLoading((m) => ({ ...m, [it.id]: true }));
                                try {
                                  const res = await fetch(publicMetaUrl);
                                  const text = await res.text();
                                  let json: any = null;
                                  try {
                                    json = text ? JSON.parse(text) : null;
                                  } catch {
                                    json = { error: text || "Invalid response" };
                                  }
                                  setStorefrontPreview((m) => ({ ...m, [it.id]: json }));
                                } catch (e: any) {
                                  setStorefrontPreview((m) => ({ ...m, [it.id]: { error: e?.message || "Failed to fetch" } }));
                                } finally {
                                  setStorefrontPreviewLoading((m) => ({ ...m, [it.id]: false }));
                                }
                              }}
                            >
                              {storefrontPreviewLoading[it.id] ? "Loading…" : "Preview storefront payload"}
                            </button>
                          </div>
                          {storefrontPreview[it.id] ? (
                            <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-neutral-200">
                              {JSON.stringify(storefrontPreview[it.id], null, 2)}
                            </pre>
                          ) : null}
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="text-xs text-neutral-500">
                            {storefrontStatus === "DISABLED"
                              ? "Enable storefront (Unlisted or Listed) to test public purchase flow."
                              : it.status !== "published"
                                ? "Publish content to generate a manifest before purchase."
                                : !manifestSha256
                                  ? "Manifest missing."
                                  : "Ready for public purchase testing."}
                          </div>
                          <button
                            type="button"
                            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                            onClick={() =>
                              setTestPurchaseFor({
                                contentId: it.id,
                                manifestSha256,
                                storefrontStatus,
                                contentStatus: it.status
                              })
                            }
                            disabled={(!isAuthed && storefrontStatus === "DISABLED") || it.status !== "published" || !manifestSha256}
                          >
                            Test purchase
                          </button>
                        </div>
                      </div>

                      <HistoryFeed
                        title="Content history"
                        items={auditByContent[it.id] || []}
                        loading={auditLoading[it.id]}
                        emptyText="No history yet."
                        exportName={`content-history-${it.id}.json`}
                        onRefresh={async () => {
                          await loadAudit(it.id);
                        }}
                      />

                      <AuditPanel
                        scopeType="content"
                        scopeId={it.id}
                        title="Audit"
                        exportName={`content-audit-${it.id}.json`}
                      />

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TestPurchaseModal
        open={!!testPurchaseFor}
        onClose={() => setTestPurchaseFor(null)}
        contentId={testPurchaseFor?.contentId || ""}
        manifestSha256={testPurchaseFor?.manifestSha256 || ""}
        storefrontStatus={testPurchaseFor?.storefrontStatus || null}
        contentStatus={testPurchaseFor?.contentStatus || null}
      />
    </div>
  );
}
