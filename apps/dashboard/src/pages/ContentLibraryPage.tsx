import React from "react";
import api, { getApiBase } from "../lib/api";
import { getToken } from "../lib/auth";
import TestPurchaseModal from "../components/TestPurchaseModal";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";
import { canArchive, canPublish, canRestore, canTrash, canUpload, computeContentUiState } from "../lib/contentState";
import { type IdentityLevel, type FeatureMatrix, type CapabilitySet } from "../lib/identity";
import {
  classifyLibraryEligibility,
  isActiveLibraryVisible,
  logVisibilityDecision,
  logLibraryEligibilityDecision,
  type LibraryRelation,
  type LibrarySection
} from "../lib/libraryEligibility";

type ContentType = "song" | "book" | "video" | "file" | "remix" | "mashup" | "derivative";
type LibraryTypeFilter = "all" | "songs" | "videos" | "books" | "files";
const LIBRARY_TYPE_FILTERS: LibraryTypeFilter[] = ["all", "songs", "videos", "books", "files"];
const LIBRARY_TYPE_LABEL: Record<LibraryTypeFilter, string> = {
  all: "All",
  songs: "Songs",
  videos: "Videos",
  books: "Books",
  files: "Files"
};
const COVER_UPLOAD_TYPES = new Set<ContentType>(["song", "video", "book", "file", "remix", "mashup", "derivative"]);

function normalizeLibraryTypeFilter(raw: string | null | undefined): LibraryTypeFilter {
  const v = String(raw || "").toLowerCase();
  return (LIBRARY_TYPE_FILTERS as string[]).includes(v) ? (v as LibraryTypeFilter) : "all";
}

function readLibraryTypeFromUrl(): LibraryTypeFilter {
  if (typeof window === "undefined") return "all";
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeLibraryTypeFilter(params.get("catalogType"));
  } catch {
    return "all";
  }
}

function writeLibraryTypeToUrl(next: LibraryTypeFilter) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("type");
  if (next === "all") url.searchParams.delete("catalogType");
  else url.searchParams.set("catalogType", next);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

type ContentItem = {
  // Contract note: content cards rely on these stable fields from /content:
  // id, type, title, status, deletedAt, coverUrl(optional), manifest.sha256(optional).
  id: string;
  title: string;
  type: ContentType;
  status: "draft" | "published";
  archivedAt?: string | null;
  trashedAt?: string | null;
  previousVersionContentId?: string | null;
  previousVersion?: { id: string; title: string; status: string } | null;
  featureOnProfile?: boolean;
  storefrontStatus?: "DISABLED" | "UNLISTED" | "LISTED";
  deliveryMode?: "stream_only" | "download_only" | "stream_and_download" | null;
  priceSats?: string | number | null;
  createdAt: string;
  publishedAt?: string | null;
  repoPath?: string | null;
  deletedAt?: string | null;
  deletedReason?: string | null;
  tombstonedAt?: string | null;
  manifest?: { sha256: string };
  ownerUserId?: string | null;
  owner?: { displayName?: string | null; email?: string | null } | null;
  libraryAccess?: "owned" | "purchased" | "preview" | "local" | "participant";
  childOrigin?: string | null;
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

function isLoopbackUrl(u?: string | null): boolean {
  if (!u) return false;
  try {
    const url = new URL(u);
    const h = url.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1";
  } catch {
    return false;
  }
}

function extractInviteTokenFromUrl(url: string | null | undefined): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const m = parsed.pathname.match(/\/invite\/([^/?#]+)/i);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    const m = raw.match(/\/invite\/([^/?#]+)/i);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
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

type LibraryParticipation = {
  kind: "local" | "remote";
  contentId: string;
  contentTitle: string | null;
  contentType: string | null;
  contentStatus: string | null;
  contentDeletedAt: string | null;
  contentDeletedReason?: string | null;
  splitParticipantId: string | null;
  remoteInviteId: string | null;
  remoteOrigin: string | null;
  status: string | null;
  highlightedOnProfile: boolean;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
  creatorEmail: string | null;
};

type ContentLibraryPageProps = {
  identityLevel?: IdentityLevel;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
  capabilities?: CapabilitySet;
  capabilityReasons?: Record<string, string>;
  productTier?: "basic" | "advanced" | "lan";
  currentUserEmail?: string | null;
  onOpenSplits?: (contentId: string) => void;
};

type NodeModeSnapshot = {
  nodeMode?: "basic" | "advanced" | "lan";
  selectedMode?: "basic" | "advanced" | "lan";
  effectiveMode?: "basic" | "advanced" | "lan";
  commerceAuthorityAvailable?: boolean;
  providerCommerceConnected?: boolean;
  localSovereignReady?: boolean;
  modeReadiness?: {
    namedTunnelDetected?: boolean;
    blockers?: string[];
  };
};

type LifecycleReceiptType =
  | "provider_acknowledgment"
  | "operation_permit"
  | "profile_activation"
  | "profile_publish"
  | "content_publish";

type LifecycleReceipt = {
  id: string;
  type: LifecycleReceiptType;
  version: number;
  createdAt: string;
  subjectNodeId: string;
  providerNodeId: string | null;
  objectId: string | null;
  payloadHash: string;
  prevReceiptId: string | null;
  payload: unknown;
  signatures: Array<{ alg: string; keyId?: string | null; value: string }>;
};

type ContentPublishReceiptPayload = {
  contentId?: string;
  manifestHash?: string | null;
  title?: string | null;
  type?: string | null;
  primaryFile?: string | null;
  publishedAt?: string | null;
  creatorNodeId?: string | null;
  providerNodeId?: string | null;
};

type NetworkPublishState = {
  hasReceipt: boolean;
  publishedAt: string | null;
  manifestHash: string | null;
  receiptId: string | null;
  providerNodeId: string | null;
};

type ParentLinkInfo = {
  linkId: string;
  relation: string;
  upstreamBps: number;
  requiresApproval: boolean;
  approvedAt?: string | null;
  clearance?: any;
  clearanceRequest?: any;
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
  | { status: "preparing"; kind: "content" | "cover"; contentId: string; filename: string }
  | { status: "uploading"; kind: "content" | "cover"; contentId: string; filename: string }
  | { status: "done"; kind: "content" | "cover"; contentId: string; filename: string }
  | { status: "error"; kind: "content" | "cover"; contentId: string; message: string };

function visibilityLabel(status: "DISABLED" | "UNLISTED" | "LISTED"): string {
  if (status === "LISTED") return "Discoverable";
  if (status === "UNLISTED") return "Direct Link";
  return "Hidden";
}

function uploadIdempotencyKey(contentId: string, file: File) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `upl-${contentId.slice(0, 8)}-${file.size}-${suffix}`;
}

async function uploadToRepo(contentId: string, file: File, idempotencyKey: string) {
  const token = getToken();
  if (!token) throw new Error("Not signed in");

  const base = getApiBase();

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${base}/content/${contentId}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-idempotency-key": idempotencyKey },
    body: form
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    const code = json?.code ? ` (${json.code})` : "";
    const msg = `${json?.error || json?.message || text || `Upload failed (${res.status})`}${code}`;
    throw new Error(msg);
  }
  return json;
}

async function uploadSongCover(contentId: string, file: File) {
  const token = getToken();
  if (!token) throw new Error("Not signed in");
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type)) {
    throw new Error("Cover must be a jpg, png, or webp image");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Cover image exceeds 5MB limit");
  }

  const base = getApiBase();
  const idempotencyKey = uploadIdempotencyKey(contentId, file);
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${base}/content/${contentId}/cover`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "x-idempotency-key": idempotencyKey },
    body: form
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    const code = json?.code ? ` (${json.code})` : "";
    const msg = `${json?.error || json?.message || text || `Cover upload failed (${res.status})`}${code}`;
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

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
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

function looksLikeImagePreviewUrl(rawUrl?: string | null): boolean {
  const value = String(rawUrl || "").trim();
  if (!value) return false;
  const extRe = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|webp)(?:[?#]|$)/i;
  if (extRe.test(value)) return true;
  try {
    const parsed = new URL(value, window.location.origin);
    const objectKey = decodeURIComponent(parsed.searchParams.get("objectKey") || "");
    const key = decodeURIComponent(parsed.searchParams.get("key") || "");
    const path = decodeURIComponent(parsed.pathname || "");
    return [objectKey, key, path].some((candidate) => extRe.test(candidate));
  } catch {
    return false;
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
  onOpenSplits,
  features,
  lockReasons,
  capabilities,
  capabilityReasons,
  currentUserEmail,
  productTier
}: ContentLibraryPageProps) {
  const resolvedProductTier = productTier || "basic";
  const isBasicTier = resolvedProductTier === "basic";
  const canAdvancedSplits = features?.advancedSplits ?? false;
  const canDerivatives = features?.derivatives ?? false;
  const canPublicShare = features?.publicShare ?? false;
  const networkPublishReason =
    capabilityReasons?.publish_network ||
    capabilityReasons?.publish ||
    "Network publish requires a trusted provider connection or sovereign local payment rails.";
  const discoveryPublishReason =
    capabilityReasons?.publish_discovery ||
    capabilityReasons?.public_share ||
    "Public discovery requires provider-node capability with a permanent named public link.";
  const clearanceReason =
    capabilityReasons?.clearance ||
    "You can prepare this action, but a permanent named link must be online to perform it.";
  const networkPublishAllowed = capabilities?.publishToNetwork ?? capabilities?.publish ?? true;
  const crossNodeAllowed = capabilities?.requestClearance ?? true;
  const splitsAllowed = capabilities?.useSplits ?? canAdvancedSplits;
  const derivativesAllowed = capabilities?.useDerivatives ?? canDerivatives;
  const discoveryPublishAllowed = capabilities?.publishToDiscovery ?? capabilities?.publicShare ?? canPublicShare;
  const apiBase = getApiBase();
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
  const [coverLoadErrorByContent, setCoverLoadErrorByContent] = React.useState<Record<string, boolean>>({});

  // NEW: latest split (so we can show lock notarization when locked)
  const [splitByContent, setSplitByContent] = React.useState<Record<string, SplitVersion | null>>({});
  const [splitLoading, setSplitLoading] = React.useState<Record<string, boolean>>({});
  const [previewByContent, setPreviewByContent] = React.useState<Record<string, any | null>>({});
  const [previewLoadingByContent, setPreviewLoadingByContent] = React.useState<Record<string, boolean>>({});
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
  const [rejectReasonByApproval, setRejectReasonByApproval] = React.useState<Record<string, string>>({});
  const [actionMsgByApproval, setActionMsgByApproval] = React.useState<Record<string, string | null>>({});
  const [clearanceLoadError, setClearanceLoadError] = React.useState<string | null>(null);
  const [manifestPreviewByContent, setManifestPreviewByContent] = React.useState<
    Record<string, { open: boolean; loading: boolean; data?: any; error?: string | null }>
  >({});
  const [clearanceRequestMsgByContent, setClearanceRequestMsgByContent] = React.useState<Record<string, string | null>>({});

  const [showTrash, setShowTrash] = React.useState(false);
  const [showTombstones, setShowTombstones] = React.useState(false);
  const [showClearance, setShowClearance] = React.useState(false);
  const [clearanceScope, setClearanceScope] = React.useState<"pending" | "voted" | "cleared">("pending");
  const [pendingClearanceCount, setPendingClearanceCount] = React.useState(0);

  React.useEffect(() => {
    if (!derivativesAllowed && showClearance) {
      setShowClearance(false);
    }
  }, [derivativesAllowed, showClearance]);
  const [busyAction, setBusyAction] = React.useState<Record<string, boolean>>({});
  const [buyLinksTabByContent, setBuyLinksTabByContent] = React.useState<Record<string, "public" | "config">>({});
  const [requestParentId, setRequestParentId] = React.useState("");
  const [requestTitle, setRequestTitle] = React.useState("");
  const [requestType, setRequestType] = React.useState<ContentType>("remix");
  const [requestUpstreamRatePct, setRequestUpstreamRatePct] = React.useState("10");
  const [requestZeroUpstreamConfirmed, setRequestZeroUpstreamConfirmed] = React.useState(false);
  const [requestMsg, setRequestMsg] = React.useState<string | null>(null);
  const [requestLinks, setRequestLinks] = React.useState<Array<{ email: string; url: string }> | null>(null);
  const [meId, setMeId] = React.useState<string>("");
  React.useEffect(() => {
    const v = Number(String(requestUpstreamRatePct || "").trim());
    if (Number.isFinite(v) && v > 0 && requestZeroUpstreamConfirmed) {
      setRequestZeroUpstreamConfirmed(false);
    }
  }, [requestUpstreamRatePct, requestZeroUpstreamConfirmed]);

  function setManifestPreview(contentId: string, patch: Partial<{ open: boolean; loading: boolean; data?: any; error?: string | null }>) {
    setManifestPreviewByContent((m) => ({
      ...m,
      [contentId]: {
        open: m[contentId]?.open ?? false,
        loading: m[contentId]?.loading ?? false,
        data: m[contentId]?.data,
        error: m[contentId]?.error ?? null,
        ...patch
      }
    }));
  }

  async function loadManifestPreview(contentId: string) {
    setManifestPreview(contentId, { loading: true, error: null });
    try {
      const res = await api<{ ok: boolean; sha256: string; manifest: any }>(`/content/${contentId}/manifest`, "GET");
      setManifestPreview(contentId, { loading: false, data: res?.manifest || null, open: true });
      return res?.manifest || null;
    } catch (e: any) {
      setManifestPreview(contentId, { loading: false, error: e?.message || "Manifest not found" });
      return null;
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function readContentPublishPayload(payload: unknown): ContentPublishReceiptPayload | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as ContentPublishReceiptPayload;
}

  const openManifestEntry = Object.entries(manifestPreviewByContent).find(([, v]) => v?.open);
  const openManifestId = openManifestEntry?.[0] || null;
  const openManifest = openManifestEntry?.[1] || null;
  const [contentScope, setContentScope] = React.useState<"library" | "mine" | "local">("mine");
  const [libraryTypeFilter, setLibraryTypeFilter] = React.useState<LibraryTypeFilter>(() => readLibraryTypeFromUrl());
  const [storefrontPreview, setStorefrontPreview] = React.useState<Record<string, any | null>>({});
  const [storefrontPreviewLoading, setStorefrontPreviewLoading] = React.useState<Record<string, boolean>>({});
  const [priceDraft, setPriceDraft] = React.useState<Record<string, string>>({});
  const [priceMsg, setPriceMsg] = React.useState<Record<string, string>>({});
  const [deliveryDraft, setDeliveryDraft] = React.useState<Record<string, string>>({});
  const [deliveryMsg, setDeliveryMsg] = React.useState<Record<string, string>>({});
  const [shareMsg, setShareMsg] = React.useState<Record<string, string>>({});
  const [shareBusy, setShareBusy] = React.useState<Record<string, boolean>>({});
  const [shareP2PLink, setShareP2PLink] = React.useState<Record<string, string>>({});
  const [shareLinkByContent, setShareLinkByContent] = React.useState<Record<string, any | null>>({});
  const [publicStatus, setPublicStatus] = React.useState<any | null>(null);
  const [publicBusy, setPublicBusy] = React.useState(false);
  const [publicMsg, setPublicMsg] = React.useState<string | null>(null);
  const [publicAdvancedOpen, setPublicAdvancedOpen] = React.useState(false);
  const [publicConsentOpen, setPublicConsentOpen] = React.useState(false);
  const [publicConsentDontAskAgain, setPublicConsentDontAskAgain] = React.useState(false);
  const [publicConsentBusy, setPublicConsentBusy] = React.useState(false);
  const [, setPublicOrigin] = React.useState<string>(() => envPublicOrigin || readStoredValue(STORAGE_PUBLIC_ORIGIN));
  const [publicBuyOrigin, setPublicBuyOrigin] = React.useState<string>(() => envPublicBuyOrigin || readStoredValue(STORAGE_PUBLIC_BUY_ORIGIN));
  const [, setPublicStudioOrigin] = React.useState<string>(() => envPublicStudioOrigin || readStoredValue(STORAGE_PUBLIC_STUDIO_ORIGIN));
  const [publicOriginFromApi, setPublicOriginFromApi] = React.useState<string>("");
  const [salesByContent, setSalesByContent] = React.useState<Record<string, { totalSats: string; recent: any[] } | null>>({});
  const [derivativesByContent, setDerivativesByContent] = React.useState<Record<string, any[] | null>>({});
  const [derivativesLoading, setDerivativesLoading] = React.useState<Record<string, boolean>>({});
  const [derivativeGroupOpen, setDerivativeGroupOpen] = React.useState<Record<string, boolean>>({});
  const [derivativeShowTombstones, setDerivativeShowTombstones] = React.useState<Record<string, boolean>>({});
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
  const [networkPublishByContent, setNetworkPublishByContent] = React.useState<Record<string, NetworkPublishState | null>>({});
  const [pendingOpenContentId, setPendingOpenContentId] = React.useState<string | null>(null);
  const [clearanceByLink, setClearanceByLink] = React.useState<Record<string, any | null>>({});
  const [clearanceLoadingByLink, setClearanceLoadingByLink] = React.useState<Record<string, boolean>>({});
  const [nodeModeSnapshot, setNodeModeSnapshot] = React.useState<NodeModeSnapshot | null>(null);
  const [participationByContentId, setParticipationByContentId] = React.useState<Record<string, LibraryParticipation>>({});
  const loadRequestRef = React.useRef(0);

  const [testPurchaseFor, setTestPurchaseFor] = React.useState<{
    contentId: string;
    manifestSha256: string;
    storefrontStatus?: string | null;
    contentStatus?: string | null;
  } | null>(null);

  async function load(trashMode: boolean = showTrash, tombstoneMode: boolean = showTombstones) {
    const requestId = ++loadRequestRef.current;
    const isCurrent = () => requestId === loadRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const typeQuery = libraryTypeFilter === "all" ? "" : `&type=${encodeURIComponent(libraryTypeFilter)}`;
      const effectiveScope: "library" | "mine" | "local" =
        contentScope === "library" || contentScope === "local" ? contentScope : "mine";
      const url = tombstoneMode
        ? `/content?tombstones=1&scope=${effectiveScope}${typeQuery}`
        : trashMode
          ? `/content?trash=1&scope=${effectiveScope}${typeQuery}`
          : `/content?scope=${effectiveScope}${typeQuery}`;
      const data = await api<ContentItem[] | any>(url);
      const baseList = Array.isArray(data) ? data : [];
      const nextParticipationByContentId: Record<string, LibraryParticipation> = {};
      const scopedList =
        effectiveScope === "mine"
          ? baseList.filter((it) => {
              const access = String((it as any)?.libraryAccess || "").trim().toLowerCase();
              if (!access) return true;
              return access === "owned";
            })
          : baseList;
      const list = scopedList.filter((it: any) => {
        const deleted = Boolean(it?.deletedAt);
        const hardDeleted = String(it?.deletedReason || "").trim().toLowerCase() === "hard";
        const status = String(it?.status || "").toLowerCase();
        const tombstoned = Boolean(it?.tombstoned) || ((deleted || hardDeleted) && status === "published");
        if (tombstoneMode) return tombstoned;
        if (trashMode) return deleted && status !== "published";
        return !deleted && !tombstoned;
      });
      if (!Array.isArray(data)) {
        if (!isCurrent()) return;
        setError("Failed to load content (unexpected response)");
      }
      let mergedList: ContentItem[] = list;

      // Library scope should always include accepted split/shared participations
      // even when they are not returned by /content for this node yet.
      if (effectiveScope === "library" && !trashMode && !tombstoneMode) {
        const [localParticipationsRes, remoteParticipationsRes] = await Promise.all([
          api<{ items: any[] }>("/my/participations", "GET").catch(() => ({ items: [] })),
          api<any[]>("/my/royalties/remote", "GET").catch(() => [])
        ]);

        const localParticipations = Array.isArray(localParticipationsRes?.items) ? localParticipationsRes.items : [];
        const remoteParticipations = (Array.isArray(remoteParticipationsRes) ? remoteParticipationsRes : [])
          .filter((row) => String(row?.status || "").trim().toLowerCase() === "accepted")
          .filter((row) => Boolean(String(row?.contentId || "").trim()));

        const participationRows: LibraryParticipation[] = [
          ...localParticipations.map((row: any) => ({
            kind: "local" as const,
            contentId: String(row?.contentId || "").trim(),
            contentTitle: row?.contentTitle || null,
            contentType: row?.contentType || null,
            contentStatus: row?.contentStatus || null,
            contentDeletedAt: row?.contentDeletedAt || null,
            contentDeletedReason: row?.contentDeletedReason || null,
            splitParticipantId: String(row?.splitParticipantId || "").trim() || null,
            remoteInviteId: null,
            remoteOrigin: null,
            status: null,
            highlightedOnProfile: Boolean(row?.highlightedOnProfile),
            creatorUserId: row?.creatorUserId || null,
            creatorDisplayName: row?.creatorDisplayName || null,
            creatorEmail: row?.creatorEmail || null
          })),
          ...remoteParticipations.map((row: any) => ({
            kind: "remote" as const,
            contentId: String(row?.contentId || "").trim(),
            contentTitle: row?.contentTitle || null,
            contentType: row?.contentType || null,
            contentStatus: row?.contentStatus || null,
            contentDeletedAt: row?.contentDeletedAt || null,
            contentDeletedReason: row?.contentDeletedReason || null,
            splitParticipantId: null,
            remoteInviteId: String(row?.id || "").trim() || null,
            remoteOrigin: String(row?.remoteOrigin || "").replace(/\/+$/, "") || null,
            status: row?.status || null,
            highlightedOnProfile: Boolean(row?.highlightedOnProfile),
            creatorUserId: null,
            creatorDisplayName: null,
            creatorEmail: null
          }))
        ]
          .filter((p) => p.contentId)
          .filter((p) => {
            const active = isActiveLibraryVisible(
              {
                id: p.contentId,
                status: p.contentStatus || null,
                deletedAt: p.contentDeletedAt || null,
                deletedReason: p.contentDeletedReason || null
              },
              "participant",
              p
            );
            logVisibilityDecision({
              surface: "content_library.participation_only",
              sourceModelQuery: p.kind === "remote" ? "GET /my/royalties/remote" : "GET /my/participations",
              relation: "participant",
              content: {
                id: p.contentId,
                status: p.contentStatus || null,
                deletedAt: p.contentDeletedAt || null,
                deletedReason: p.contentDeletedReason || null
              },
              included: active.visible,
              reason: active.visible ? "active_library_visible" : active.reason || "excluded"
            });
            return active.visible;
          });

        for (const p of participationRows) {
          const contentId = String(p.contentId || "").trim();
          if (!contentId) continue;
          const prev = nextParticipationByContentId[contentId];
          if (!prev || p.kind === "local") nextParticipationByContentId[contentId] = p;
        }

        const byId = new Map<string, ContentItem>();
        for (const item of mergedList) byId.set(item.id, item);
        for (const p of participationRows) {
          const contentId = String(p.contentId || "").trim();
          if (!contentId) continue;
          const existing = byId.get(contentId);
          if (existing) {
            byId.set(contentId, {
              ...existing,
              libraryAccess: "participant",
              ownerUserId: existing.ownerUserId || p.creatorUserId || null,
              owner:
                existing.owner ||
                (p.creatorDisplayName || p.creatorEmail
                  ? { displayName: p.creatorDisplayName || null, email: p.creatorEmail || null }
                  : null)
            });
            continue;
          }
          byId.set(contentId, {
            id: contentId,
            title: p.contentTitle || "Untitled",
            type: ((p.contentType || "file") as ContentType),
            status: (String(p.contentStatus || "").trim().toLowerCase() === "published" ? "published" : "draft"),
            createdAt: "",
            deletedReason: p.contentDeletedReason || null,
            ownerUserId: p.creatorUserId || null,
            owner:
              p.creatorDisplayName || p.creatorEmail
                ? { displayName: p.creatorDisplayName || null, email: p.creatorEmail || null }
                : null,
            libraryAccess: "participant"
          });
        }
        mergedList = Array.from(byId.values());
      }

      if (effectiveScope === "library" && !trashMode && !tombstoneMode) {
        const eligible: ContentItem[] = [];
        for (const item of mergedList) {
          const contentId = String(item.id || "").trim();
          const participation = nextParticipationByContentId[contentId] || null;
          const relation: LibraryRelation =
            item.libraryAccess === "owned"
              ? "owner"
              : item.libraryAccess === "purchased"
                ? "buyer"
                : item.libraryAccess === "participant"
                  ? "participant"
                  : item.libraryAccess === "preview"
                    ? "preview"
                    : "unknown";
          const decision = classifyLibraryEligibility({
            item,
            meUserId: meId || null,
            participation
          });
          logLibraryEligibilityDecision({
            scope: "content_library_page",
            contentId,
            decision,
            extra: {
              contentScope: effectiveScope,
              access: item.libraryAccess || null
            }
          });
          logVisibilityDecision({
            surface: "content_library.active",
            sourceModelQuery: `GET /content?scope=${effectiveScope}`,
            relation,
            content: item,
            included: decision.included,
            reason: decision.included ? "classify_included" : decision.reason || "excluded",
            extra: {
              contentScope: effectiveScope,
              access: item.libraryAccess || null
            }
          });
          if (!decision.included) continue;
          eligible.push({
            ...item,
            libraryAccess: decision.section as Exclude<LibrarySection, "excluded">
          });
        }
        mergedList = eligible;
      }

      if (!isCurrent()) return;
      setParticipationByContentId(nextParticipationByContentId);
      setItems(mergedList);
      const next: Record<string, string> = {};
      const nextDelivery: Record<string, string> = {};
      for (const it of list) {
        if (it.priceSats !== undefined && it.priceSats !== null) next[it.id] = String(it.priceSats);
        if (it.deliveryMode) nextDelivery[it.id] = String(it.deliveryMode);
      }
      setPriceDraft(next);
      setDeliveryDraft(nextDelivery);
      if (pendingOpenContentId && list.find((d) => d.id === pendingOpenContentId)) {
        setExpanded((m) => ({ ...m, [pendingOpenContentId]: true }));
        setPendingOpenContentId(null);
      }
    } catch (e: any) {
      if (!isCurrent()) return;
      const msg = String(e?.message || "Failed to load content");
      setError(msg.includes("INVALID_TYPE") ? "Invalid library type filter." : msg);
    } finally {
      if (!isCurrent()) return;
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentScope, libraryTypeFilter]);

  const refreshCurrentView = React.useCallback(() => load(showTrash, showTombstones), [showTrash, showTombstones]);

  React.useEffect(() => {
    const onPopState = () => setLibraryTypeFilter(readLibraryTypeFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await api<NodeModeSnapshot>("/api/node/mode", "GET");
        if (!cancelled) setNodeModeSnapshot(snapshot || null);
      } catch {
        if (!cancelled) setNodeModeSnapshot(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const targets = items.filter((it) => expanded[it.id] && it.status === "published" && !networkPublishByContent[it.id]);
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const it of targets) {
        const next = await resolveNetworkPublishState(it.id, {
          publishedAt: asNonEmptyString(it.publishedAt),
          manifestSha256: asNonEmptyString(it.manifest?.sha256)
        });
        if (cancelled) return;
        setNetworkPublishByContent((m) => ({ ...m, [it.id]: next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items, expanded, networkPublishByContent]);

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

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/public/origin`, { method: "GET" });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.publicOrigin) {
          setPublicOriginFromApi(String(data.publicOrigin).replace(/\/$/, ""));
        }
      } catch {
        // ignore
      }
    })();
  }, [apiBase]);

  async function refreshPublicStatus() {
    try {
      const res = await api<any>("/api/public/status", "GET");
      setPublicStatus(res || null);
      if (res?.state === "ACTIVE" && res?.publicOrigin) {
        setPublicOrigin(res.publicOrigin);
      }
    } catch {
      // ignore
    }
  }

  function formatPublicError(code?: string | null) {
    if (!code) return "We couldn’t start sharing from this device.";
    if (code === "consent_required") return "Please approve the download to enable public link.";
    if (code === "cloudflared_download_failed") return "Unable to download helper tool. Check your connection and try again.";
    if (code === "cloudflared_unavailable") return "Helper tool unavailable. Try again.";
    return "We couldn’t start sharing from this device.";
  }

  async function postPublicGo(consent?: boolean, dontAskAgain?: boolean) {
    const token = getToken();
    const body = consent ? { consent: true, dontAskAgain: Boolean(dontAskAgain) } : {};
    const res = await fetch(`${apiBase}/api/public/go`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text ? { error: text } : null;
    }
    return { ok: res.ok, data };
  }

  async function startPublicLink() {
    try {
      setPublicBusy(true);
      setPublicMsg(null);
      const status = await api<any>("/api/public/status", "GET");
      setPublicStatus(status || null);
      if (status?.consentRequired) {
        setPublicConsentOpen(true);
        setPublicBusy(false);
        return;
      }
      setPublicStatus({ state: "STARTING" });
      const res = await postPublicGo();
      setPublicStatus(res.data || null);
      if (!res.ok) {
        setPublicMsg(formatPublicError(res.data?.lastError));
      }
      if (res.data?.state === "ACTIVE" && res.data?.publicOrigin) {
        setPublicOrigin(res.data.publicOrigin);
      }
    } catch (e: any) {
      setPublicStatus({ state: "ERROR" });
      setPublicMsg(formatPublicError(null));
    } finally {
      setPublicBusy(false);
    }
  }

  async function stopPublicLink() {
    try {
      setPublicBusy(true);
      setPublicMsg(null);
      await api("/api/public/stop", "POST");
      setPublicStatus({ state: "STOPPED" });
      setPublicOrigin("");
      setPublicBuyOrigin("");
      setPublicStudioOrigin("");
    } catch (e: any) {
      setPublicMsg(e?.message || "Failed to stop public link.");
    } finally {
      setPublicBusy(false);
    }
  }

  React.useEffect(() => {
    refreshPublicStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshPublicStatus();
    }, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmPublicConsent() {
    try {
      setPublicConsentBusy(true);
      setPublicMsg(null);
      setPublicStatus({ state: "STARTING" });
      const res = await postPublicGo(true, publicConsentDontAskAgain);
      setPublicStatus(res.data || null);
      if (!res.ok) {
        setPublicMsg(formatPublicError(res.data?.lastError));
      }
      if (res.data?.state === "ACTIVE" && res.data?.publicOrigin) {
        setPublicOrigin(res.data.publicOrigin);
      }
    } catch {
      setPublicStatus({ state: "ERROR" });
      setPublicMsg(formatPublicError(null));
    } finally {
      setPublicConsentBusy(false);
      setPublicConsentOpen(false);
      setPublicBusy(false);
    }
  }

  React.useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await api<any>("/api/public/config", "GET");
        if (cancelled || !cfg) return;
        setPublicOrigin((prev) => String(cfg?.publicOrigin || "").trim() || prev);
        setPublicBuyOrigin((prev) => String(cfg?.publicBuyOrigin || "").trim() || prev);
        setPublicStudioOrigin((prev) => String(cfg?.publicStudioOrigin || "").trim() || prev);
      } catch {
        // keep existing fallbacks
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const expandedIds = Object.keys(expanded).filter((id) => expanded[id]);
    if (expandedIds.length === 0) return;

    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      expandedIds.forEach((id) => {
        const link = parentLinkByContent[id];
        if (link?.requiresApproval && !link?.approvedAt) {
          loadParentLink(id);
        }
      });
    }, 45000);

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
    if (!derivativesAllowed || items.length === 0) return;
    for (const item of items) {
      if (item.ownerUserId !== meId) continue;
      const derivativeType = ["derivative", "remix", "mashup"].includes(String(item.type || ""));
      if (!derivativeType) continue;
      if (parentLinkByContent[item.id] !== undefined) continue;
      void loadParentLink(item.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, derivativesAllowed, meId, parentLinkByContent]);

  React.useEffect(() => {
    if (!showClearance || approvals.length === 0) return;
    approvals.forEach((a) => {
      const linkId = String(a?.linkId || "");
      if (!linkId) return;
      if (!clearanceLoadingByLink[linkId]) loadClearanceSummary(linkId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClearance, approvals]);

  async function loadFiles(contentId: string) {
    setFilesLoading((m) => ({ ...m, [contentId]: true }));
    try {
      const files = await api<ContentFile[]>(`/content/${contentId}/files`);
      setFilesByContent((m) => ({ ...m, [contentId]: files }));
    } catch (e: any) {
      const msg = String(e?.message || "");
      setFilesByContent((m) => ({ ...m, [contentId]: [] }));
      setError((prev) => prev || (msg ? `File list refresh failed: ${msg}` : "File list refresh failed."));
    } finally {
      setFilesLoading((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadPreview(contentId: string) {
    setPreviewLoadingByContent((m) => ({ ...m, [contentId]: true }));
    try {
      const preview = await api<any>(`/content/${contentId}/preview`, "GET");
      setPreviewByContent((m) => ({ ...m, [contentId]: preview || null }));
    } catch (e: any) {
      setPreviewByContent((m) => ({ ...m, [contentId]: { error: e?.message || "Preview unavailable" } }));
    } finally {
      setPreviewLoadingByContent((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function loadShareLink(contentId: string) {
    if (isBasicTier) return;
    try {
      const data = await api<any>(`/api/content/${contentId}/share-link`, "GET");
      setShareLinkByContent((m) => ({ ...m, [contentId]: data?.shareLink || null }));
    } catch {
      setShareLinkByContent((m) => ({ ...m, [contentId]: null }));
    }
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
    let manifestHash = manifestSha256 || "";
    if (!manifestHash) {
      try {
        const res = await api<{ ok: boolean; sha256: string; manifest: any }>(`/content/${contentId}/manifest`, "GET");
        manifestHash = res?.sha256 || "";
      } catch (e: any) {
        setShareMsg((m) => ({ ...m, [contentId]: e?.message || "Manifest unavailable." }));
        return;
      }
      if (!manifestHash) {
        setShareMsg((m) => ({ ...m, [contentId]: "Manifest unavailable." }));
        return;
      }
      setShareMsg((m) => ({ ...m, [contentId]: "Manifest generated. Building P2P link…" }));
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
        manifestHash: manifestHash,
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
    if (!splitsAllowed) {
      setSplitByContent((m) => ({ ...m, [contentId]: null }));
      return;
    }
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
    try {
      const data = await api<{ totalSats: string; recent: any[] }>(`/content/${contentId}/sales`, "GET");
      setSalesByContent((m) => ({ ...m, [contentId]: data }));
    } catch {
      setSalesByContent((m) => ({ ...m, [contentId]: null }));
    }
  }

  async function findLatestContentPublishReceipt(contentId: string): Promise<LifecycleReceipt | null> {
    const list = await api<LifecycleReceipt[]>(`/api/receipts?limit=100`, "GET");
    if (!Array.isArray(list)) return null;
    for (const receipt of list) {
      if (!receipt || receipt.type !== "content_publish") continue;
      if (receipt.objectId === contentId) return receipt;
      const payload = readContentPublishPayload(receipt.payload);
      if (payload?.contentId === contentId) return receipt;
    }
    return null;
  }

  async function resolveNetworkPublishState(
    contentId: string,
    fallback: { publishedAt?: string | null; manifestSha256?: string | null }
  ): Promise<NetworkPublishState> {
    let receipt: LifecycleReceipt | null = null;
    try {
      receipt = await findLatestContentPublishReceipt(contentId);
    } catch {
      receipt = null;
    }
    const payload = readContentPublishPayload(receipt?.payload);
    return {
      hasReceipt: Boolean(receipt?.id),
      publishedAt:
        asNonEmptyString(payload?.publishedAt) ||
        asNonEmptyString(receipt?.createdAt) ||
        asNonEmptyString(fallback.publishedAt) ||
        null,
      manifestHash:
        asNonEmptyString(payload?.manifestHash) ||
        asNonEmptyString(fallback.manifestSha256) ||
        null,
      receiptId: asNonEmptyString(receipt?.id) || null,
      providerNodeId:
        asNonEmptyString(payload?.providerNodeId) ||
        asNonEmptyString(receipt?.providerNodeId) ||
        null
    };
  }

  async function captureNetworkPublishState(
    contentId: string,
    fallback: { publishedAt?: string | null; manifestSha256?: string | null }
  ) {
    const state = await resolveNetworkPublishState(contentId, fallback);
    setNetworkPublishByContent((m) => ({ ...m, [contentId]: state }));
  }

  async function applyPublishSuccess(contentId: string, res: any) {
    setItems((prev) =>
      prev.map((it) =>
        it.id === contentId
          ? {
              ...it,
              status: "published",
              publishedAt: res?.publishedAt || it.publishedAt || new Date().toISOString(),
              manifest: res?.manifestSha256 ? { sha256: res.manifestSha256 } : it.manifest
            }
          : it
      )
    );
    await load(false);
    setPublishMsg((m) => ({ ...m, [contentId]: "Published." }));
    void captureNetworkPublishState(contentId, {
      publishedAt: asNonEmptyString(res?.publishedAt),
      manifestSha256: asNonEmptyString(res?.manifestSha256)
    });
  }

  async function publishContent(contentId: string) {
    if (publishBusy[contentId]) return;
    const currentItem = items.find((it) => it.id === contentId);
    const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(currentItem?.type || ""));
    const parentLink = parentLinkByContent[contentId];
    if (isDerivativeType) {
      if (parentLink === undefined) {
        void loadParentLink(contentId);
        setPublishMsg((m) => ({ ...m, [contentId]: "Checking clearance status..." }));
        return;
      }
      if (parentLink?.requiresApproval && !parentLink?.approvedAt) {
        setPublishMsg((m) => ({ ...m, [contentId]: "Clearance is pending. Publish unlocks after rights-holder approval." }));
        return;
      }
    }
    if (!networkPublishAllowed) {
      setPublishMsg((m) => ({ ...m, [contentId]: networkPublishReason }));
      return;
    }
    setPublishBusy((m) => ({ ...m, [contentId]: true }));
    setPublishMsg((m) => ({ ...m, [contentId]: "" }));
    try {
      if (isBasicTier) {
        if (isDerivativeType) {
          setPublishMsg((m) => ({ ...m, [contentId]: "Derivatives require Advanced mode and clearance before publishing." }));
          return;
        }
        await api(`/api/content/${contentId}/manifest`, "POST", {});
        const res = await api<any>(`/api/content/${contentId}/publish`, "POST", {});
        await applyPublishSuccess(contentId, res);
        return;
      }
      if (!splitsAllowed) {
        await api(`/api/content/${contentId}/manifest`, "POST", {});
        const res = await api<any>(`/api/content/${contentId}/publish`, "POST", {});
        await applyPublishSuccess(contentId, res);
        return;
      }
      const versions = await api<any[]>(`/content/${contentId}/split-versions`, "GET");
      const latest = versions?.[0] || null;
      if (!latest) {
        setPublishMsg((m) => ({ ...m, [contentId]: "No split found. Open splits and save your 100% split." }));
        return;
      }
      if (latest.status !== "locked") {
        setPublishMsg((m) => ({ ...m, [contentId]: "Lock your split before publishing." }));
        return;
      }
      const participants = Array.isArray(latest.participants) ? latest.participants : [];
      const total = Math.round(participants.reduce((s: number, p: any) => s + num(p.percent), 0) * 1000) / 1000;
      if (total !== 100) {
        setPublishMsg((m) => ({ ...m, [contentId]: `Split must total 100%. Current total=${total}.` }));
        return;
      }
      await api(`/api/content/${contentId}/manifest`, "POST", {});
      const res = await api<any>(`/api/content/${contentId}/publish`, "POST", {});
      await applyPublishSuccess(contentId, res);
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
                  approverCount: Array.isArray(cs.approvers) ? cs.approvers.length : 0,
                  approvers: Array.isArray(cs.approvers) ? cs.approvers : [],
                  votes: Array.isArray(cs.votes) ? cs.votes : []
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
    if (!derivativesAllowed) return;
    try {
      const res = await api<{ status: string }>(`/api/content/${contentId}/derivative-authorization`, "GET");
      setDerivativeAuthByContent((m) => ({ ...m, [contentId]: res?.status || "NONE" }));
    } catch {
      setDerivativeAuthByContent((m) => ({ ...m, [contentId]: "NONE" }));
    }
  }

  async function loadDerivativesForParent(contentId: string) {
    if (!derivativesAllowed) return;
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
                    reviewGrantedAt: cs.reviewGrantedAt || null,
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

  async function loadDerivativePreview(childContentId: string, childOrigin?: string | null) {
    if (!derivativesAllowed) return;
    setDerivativePreviewLoading((m) => ({ ...m, [childContentId]: true }));
    setDerivativePreviewError((m) => ({ ...m, [childContentId]: "" }));
    try {
      if (childOrigin) {
        const base = String(childOrigin || "").replace(/\/+$/, "");
        if (!base) {
          setDerivativePreviewError((m) => ({ ...m, [childContentId]: "Remote origin not set." }));
          return;
        }
        const offer = await fetch(`${base}/public/content/${childContentId}/offer`).then((r) => r.json());
        const objectKey = offer?.previewObjectKey || offer?.primaryFileId || null;
        if (!objectKey) {
          setDerivativePreviewError((m) => ({ ...m, [childContentId]: "No preview available yet." }));
          return;
        }
        const previewUrl = `${base}/public/content/${childContentId}/preview-file?objectKey=${encodeURIComponent(objectKey)}`;
        setDerivativePreviewByChild((m) => ({
          ...m,
          [childContentId]: {
            content: { id: childContentId, title: offer?.title || null, type: offer?.type || null, status: "published" },
            previewUrl,
            files: [
              {
                id: objectKey,
                objectKey,
                originalName: offer?.primaryFileId || objectKey,
                sizeBytes: offer?.sizeBytes || 0,
                mime: offer?.primaryFileMime || ""
              }
            ]
          }
        }));
        return;
      }
      const res = await api<any>(`/content/${childContentId}/preview`, "GET");
      setDerivativePreviewByChild((m) => ({ ...m, [childContentId]: res || null }));
    } catch (e: any) {
      setDerivativePreviewByChild((m) => ({ ...m, [childContentId]: null }));
      setDerivativePreviewError((m) => ({ ...m, [childContentId]: e?.message || "Preview failed" }));
    } finally {
      setDerivativePreviewLoading((m) => ({ ...m, [childContentId]: false }));
    }
  }

  async function openRemoteDerivativePreview(origin: string, childContentId: string) {
    const base = String(origin || "").replace(/\/+$/, "");
    if (!base) {
      setDerivativePreviewError((m) => ({ ...m, [childContentId]: "Remote origin not set." }));
      return;
    }
    setDerivativePreviewLoading((m) => ({ ...m, [childContentId]: true }));
    setDerivativePreviewError((m) => ({ ...m, [childContentId]: "" }));
    try {
      const offer = await fetch(`${base}/public/content/${childContentId}/offer`).then((r) => r.json());
      const objectKey = offer?.previewObjectKey || offer?.primaryFileId || null;
      if (!objectKey) {
        setDerivativePreviewError((m) => ({ ...m, [childContentId]: "No preview available yet." }));
        return;
      }
      const url = `${base}/public/content/${childContentId}/preview-file?objectKey=${encodeURIComponent(objectKey)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setDerivativePreviewError((m) => ({ ...m, [childContentId]: e?.message || "Remote preview failed" }));
    } finally {
      setDerivativePreviewLoading((m) => ({ ...m, [childContentId]: false }));
    }
  }

  async function openRemoteInviteClearancePreview(
    origin: string,
    inviteToken: string,
    remoteAuthorizationId: string,
    childContentId: string
  ) {
    const base = String(origin || "").replace(/\/+$/, "");
    const token = String(inviteToken || "").trim();
    const authorizationId = String(remoteAuthorizationId || "").trim();
    if (!base || !token || !authorizationId) {
      setDerivativePreviewError((m) => ({ ...m, [childContentId]: "Missing preview routing context." }));
      return;
    }
    setDerivativePreviewLoading((m) => ({ ...m, [childContentId]: true }));
    setDerivativePreviewError((m) => ({ ...m, [childContentId]: "" }));
    try {
      const url = `${base}/invites/${encodeURIComponent(token)}/clearance/${encodeURIComponent(
        authorizationId
      )}/preview`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setDerivativePreviewError((m) => ({ ...m, [childContentId]: e?.message || "Remote preview failed" }));
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
    if (!derivativesAllowed) return;
    setApprovalsLoading(true);
    setClearanceLoadError(null);
    try {
      const [localData, remoteRows] = await Promise.all([
        api<any[]>(`/api/derivatives/approvals?scope=${encodeURIComponent(scope)}`, "GET"),
        api<any[]>("/my/royalties/remote", "GET")
      ]);
      const isApprovalCleared = (entry: any) => {
        const status = String(entry?.status || "").trim().toUpperCase();
        const target = Number(entry?.approvalBpsTarget || 6667);
        const approve = Number(entry?.approveWeightBps || 0);
        return status === "APPROVED" || (target > 0 && approve >= target);
      };
      const hasViewerVoted = (entry: any) => Boolean(String(entry?.viewerVote || "").trim());
      const matchesScope = (entry: any, selectedScope: "pending" | "voted" | "cleared") => {
        const cleared = isApprovalCleared(entry);
        const voted = hasViewerVoted(entry);
        if (selectedScope === "pending") return !cleared && !voted;
        if (selectedScope === "voted") return !cleared && voted;
        return cleared;
      };

      const remoteApprovals = (Array.isArray(remoteRows) ? remoteRows : [])
        .flatMap((row) => {
          const remoteOrigin = String(row?.remoteOrigin || "").replace(/\/+$/, "");
          const inviteId = String(row?.id || "").trim();
          const inbox = Array.isArray(row?.clearanceInbox) ? row.clearanceInbox : [];
          return inbox.map((entry: any) => ({
            authorizationId: `remote:${remoteOrigin}:${String(entry?.authorizationId || "")}`,
            remoteAuthorizationId: String(entry?.authorizationId || ""),
            linkId: "",
            parentContentId: String(entry?.parentContentId || ""),
            parentTitle: entry?.parentTitle || null,
            childContentId: String(entry?.childContentId || ""),
            childTitle: entry?.childTitle || null,
            relation: entry?.relation || "derivative",
            status: String(entry?.status || "PENDING"),
            viewerVote: entry?.viewerVote || null,
            remoteOrigin,
            remoteChildOrigin: String(entry?.childOrigin || "").trim() || null,
            remoteInviteId: inviteId,
            remoteInviteToken: extractInviteTokenFromUrl(String(row?.inviteUrl || "")),
            remoteClearanceUrl: entry?.clearanceUrl || null,
            approveWeightBps: Number(entry?.approveWeightBps || 0),
            approvalBpsTarget: Number(entry?.approvalBpsTarget || 6667),
            approvedApprovers: Number(entry?.approvedApprovers || 0),
            approverCount: Number(entry?.approverCount || 0),
            upstreamRatePercent:
              Number.isFinite(Number(entry?.upstreamRatePercent))
                ? Number(entry.upstreamRatePercent)
                : null
          }));
        })
        .filter((entry) => matchesScope(entry, scope));

      const merged = [...(Array.isArray(localData) ? localData : []), ...remoteApprovals].filter((entry) =>
        matchesScope(entry, scope)
      );
      if (import.meta.env.DEV) {
        console.debug("clearance.loadApprovals.remote_merge", {
          scope,
          localCount: Array.isArray(localData) ? localData.length : 0,
          remoteRowsCount: Array.isArray(remoteRows) ? remoteRows.length : 0,
          remoteApprovalsCount: remoteApprovals.length,
          mergedCount: merged.length,
          firstRemoteApproval: remoteApprovals[0]
            ? {
                authorizationId: remoteApprovals[0].authorizationId,
                parentContentId: remoteApprovals[0].parentContentId,
                childContentId: remoteApprovals[0].childContentId,
                status: remoteApprovals[0].status,
                viewerVote: remoteApprovals[0].viewerVote,
                remoteOrigin: remoteApprovals[0].remoteOrigin,
                hasClearanceUrl: Boolean(remoteApprovals[0].remoteClearanceUrl)
              }
            : null
        });
      }
      setApprovals(merged);
      if (scope === "pending") setPendingClearanceCount(merged.length);
    } catch (e: any) {
      const raw = String(e?.message || "Failed to load clearance approvals.");
      const isAuth = raw.includes(" 401 ") || raw.toLowerCase().includes("unauthorized");
      const hint = isAuth
        ? "Clearance data could not load (401). Sign in again on this dashboard instance."
        : "Clearance data could not load. Check API base/runtime binding and retry.";
      setClearanceLoadError(`${hint} ${raw}`);
      setApprovals([]);
      if (scope === "pending") setPendingClearanceCount(0);
    } finally {
      setApprovalsLoading(false);
    }
  }

  async function loadPendingClearanceCount() {
    if (!derivativesAllowed) return;
    try {
      const [localData, remoteRows] = await Promise.all([
        api<any[]>(`/api/derivatives/approvals?scope=pending`, "GET").catch(() => []),
        api<any[]>("/my/royalties/remote", "GET").catch(() => [])
      ]);
      const localPending = (Array.isArray(localData) ? localData : []).filter((entry: any) => {
        const cleared = isApprovalClearedByThreshold(
          entry?.status,
          entry?.approveWeightBps ?? entry?.progressBps,
          entry?.approvalBpsTarget ?? entry?.thresholdBps
        );
        const voted = Boolean(String(entry?.viewerVote || "").trim());
        return !cleared && !voted;
      }).length;
      const remotePending = (Array.isArray(remoteRows) ? remoteRows : []).reduce((sum, row) => {
        const inbox = Array.isArray(row?.clearanceInbox) ? row.clearanceInbox : [];
        const mine = inbox.filter((entry: any) => {
          const cleared = isApprovalClearedByThreshold(entry?.status, entry?.approveWeightBps, entry?.approvalBpsTarget);
          const voted = Boolean(String(entry?.viewerVote || "").trim());
          return !cleared && !voted;
        }).length;
        return sum + mine;
      }, 0);
      setPendingClearanceCount(localPending + remotePending);
    } catch {
      setPendingClearanceCount(0);
    }
  }

  function isApprovalClearedByThreshold(statusRaw: unknown, approveRaw: unknown, targetRaw: unknown): boolean {
    const status = String(statusRaw || "").trim().toUpperCase();
    const approve = Number(approveRaw || 0);
    const target = Number(targetRaw || 6667);
    return status === "APPROVED" || (target > 0 && approve >= target);
  }

  async function clearedAfterActionError(entry: any, linkId: string): Promise<boolean> {
    if (String(entry?.remoteOrigin || "").trim()) {
      const remoteRows = await api<any[]>("/my/royalties/remote", "GET").catch(() => []);
      const targetAuthId = String(entry?.remoteAuthorizationId || entry?.authorizationId || "").trim();
      for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
        const inbox = Array.isArray(row?.clearanceInbox) ? row.clearanceInbox : [];
        const matched = inbox.find((item: any) => String(item?.authorizationId || "").trim() === targetAuthId);
        if (!matched) continue;
        return isApprovalClearedByThreshold(matched?.status, matched?.approveWeightBps, matched?.approvalBpsTarget);
      }
      return false;
    }
    if (!linkId) return false;
    const summary = await api<any>(`/content-links/${linkId}/clearance`, "GET").catch(() => null);
    return isApprovalClearedByThreshold(summary?.status, summary?.progressBps, summary?.thresholdBps);
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
    if (storefrontStatus !== "DISABLED" && !discoveryPublishAllowed) {
      setError(discoveryPublishReason);
      return;
    }
    setBusyAction((m) => ({ ...m, [contentId]: true }));
    try {
      const res = await api<{ storefrontStatus: string }>(`/api/content/${contentId}/storefront`, "PATCH", {
        storefrontStatus
      });
      setItems((prev) =>
        prev.map((it) => (it.id === contentId ? { ...it, storefrontStatus: res.storefrontStatus as any } : it))
      );
    } catch (e: any) {
      if (e?.message && String(e.message).includes("public_discovery_not_allowed")) {
        setError(discoveryPublishReason);
      } else {
        setError(e?.message || "Failed to update network visibility");
      }
    } finally {
      setBusyAction((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function requestClearanceForContent(contentId: string, linkId: string) {
    setClearanceRequestMsgByContent((m) => ({ ...m, [contentId]: null }));
    try {
      await api(`/content-links/${linkId}/request-approval`, "POST");
      setClearanceRequestMsgByContent((m) => ({ ...m, [contentId]: "Clearance requested." }));
      await loadParentLink(contentId);
    } catch (e: any) {
      setClearanceRequestMsgByContent((m) => ({ ...m, [contentId]: e?.message || "Clearance request failed." }));
    }
  }

  async function createContent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("Title is required.");
      return;
    }

    setCreating(true);
    if (import.meta.env.DEV) {
      console.debug("createContent:start", { title: nextTitle, type });
    }
    try {
      const created = await api<ContentItem>("/content", "POST", {
        title: nextTitle,
        type
      });
      if (import.meta.env.DEV) {
        console.debug("createContent:response", { createdId: created?.id, status: created?.status, type: created?.type });
      }

      setTitle("");
      setType("song");

      // Ensure we land back in the active authored/content view after creating
      setShowClearance(false);
      setShowTrash(false);
      setShowTombstones(false);
      setContentScope("mine");

      // Deterministic immediate refresh for the authored active view.
      const refreshed = await api<ContentItem[]>("/content?scope=mine");
      const strictOwned = Array.isArray(refreshed)
        ? refreshed.filter((it: any) => String(it?.libraryAccess || "owned").toLowerCase() === "owned")
        : [];
      setItems(strictOwned.filter((it: any) => !it?.deletedAt));

      setPendingOpenContentId(created.id);
    } catch (e: any) {
      if (import.meta.env.DEV) {
        console.debug("createContent:error", e);
      }
      setError(e?.message || "Failed to create content");
    } finally {
      setCreating(false);
    }
  }

  async function softDelete(contentId: string) {
    const item = items.find((row) => row.id === contentId);
    const state = computeContentUiState(item || {});
    const prompt = state === "published"
      ? "Archive this published item? New buyers won’t be able to purchase. Existing buyers keep access."
      : "Move this item to Trash?";
    if (!window.confirm(prompt)) return;

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

      await refreshCurrentView();
    } catch (e: any) {
      setError(e?.message || "Failed to move item to trash");
    } finally {
      setBusyAction((m) => ({ ...m, [contentId]: false }));
    }
  }

  async function requestDerivativeFromId() {
    if (!derivativesAllowed) {
      setRequestMsg(lockReasons?.derivatives || "Derivatives require Advanced or LAN mode.");
      return;
    }
    const rawParent = requestParentId.trim();
    let parentOrigin: string | null = null;
    let parentId = rawParent;
    if (/^https?:\/\//i.test(rawParent)) {
      try {
        const u = new URL(rawParent);
        parentOrigin = u.origin;
        const path = u.pathname || "";
        parentId =
          (path.match(/\/p\/([^/]+)/i)?.[1] ||
            path.match(/\/content\/([^/]+)/i)?.[1] ||
            path.match(/\/buy\/([^/]+)/i)?.[1] ||
            path.split("/").filter(Boolean).slice(-1)[0] ||
            parentId) as string;
      } catch {}
    }
    const title = requestTitle.trim();
    const type = (requestType || "remix").trim();
    const upstreamRatePercent = Number(String(requestUpstreamRatePct || "").trim());
    if (!parentId || !title) {
      setRequestMsg("Original content ID and title are required.");
      return;
    }
    if (!Number.isFinite(upstreamRatePercent) || upstreamRatePercent < 0 || upstreamRatePercent > 100) {
      setRequestMsg("Upstream royalty % must be a number between 0 and 100.");
      return;
    }
    if (upstreamRatePercent === 0 && !requestZeroUpstreamConfirmed) {
      setRequestMsg("Confirm 0% upstream before creating this derivative.");
      return;
    }
    try {
      setRequestMsg(null);
      setRequestLinks(null);
      const res = await api<{ ok: true; childContentId: string }>(`/api/content/${parentId}/derivative`, "POST", {
        type,
        title,
        parentOrigin,
        upstreamRatePercent
      });
      if (res?.childContentId) {
        setPendingOpenContentId(res.childContentId);
      }
      setRequestMsg(`Derivative created (${upstreamRatePercent}% upstream). Request clearance from the derivative page.`);
      setRequestParentId("");
      setRequestTitle("");
      setRequestUpstreamRatePct("10");
      setRequestZeroUpstreamConfirmed(false);
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

      await refreshCurrentView();
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

      await refreshCurrentView();
    } catch (e: any) {
      setError(e?.message || "Failed to delete forever");
    } finally {
      setBusyAction((m) => ({ ...m, [contentId]: false }));
    }
  }

  function UploadButton({
    contentId,
    disabled,
    label = "Upload"
  }: {
    contentId: string;
    disabled?: boolean;
    label?: string;
  }) {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const busy =
      (upload.status === "preparing" || upload.status === "uploading") &&
      upload.kind === "content" &&
      upload.contentId === contentId;
    const err = upload.status === "error" && upload.kind === "content" && upload.contentId === contentId;
    const authReady = Boolean(getToken());
    const triggerDisabled = Boolean(disabled || busy || !authReady);

    const onFileSelected = React.useCallback(
      async (file?: File) => {
        if (!file) return;

        setError(null);
        setUpload({ status: "preparing", kind: "content", contentId, filename: file.name });
        const idempotencyKey = uploadIdempotencyKey(contentId, file);
        if (import.meta.env.DEV) {
          console.log("[upload] click", {
            hasFile: true,
            fileName: file.name,
            size: file.size,
            isUploading: busy,
            authReady,
            idempotencyKey
          });
        }

        try {
          setUpload({ status: "uploading", kind: "content", contentId, filename: file.name });
          await uploadToRepo(contentId, file, idempotencyKey);
          setUpload({ status: "done", kind: "content", contentId, filename: file.name });

          await load();

          // Auto-open the card and refresh files/split so the file ID shows immediately.
          setExpanded((m) => ({ ...m, [contentId]: true }));
          await Promise.allSettled([loadFiles(contentId), loadLatestSplit(contentId)]);
        } catch (err: any) {
          const raw = String(err?.message || "Upload failed");
          const message = raw.includes("PUBLISHED_IMMUTABLE")
            ? "This published release is immutable. Create a new version to upload updated media."
            : raw;
          setUpload({ status: "error", kind: "content", contentId, message });
        }
      },
      [authReady, busy, contentId]
    );

    return (
      <div className="inline-flex items-center gap-2">
        <input
          name={`uploadFile-${contentId}`}
          ref={inputRef}
          type="file"
          className="sr-only"
          disabled={triggerDisabled}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            await onFileSelected(file);
          }}
        />
        <button
          type="button"
          aria-label="Upload file"
          disabled={triggerDisabled}
          onClick={async () => {
            if (triggerDisabled) return;
            if (inputRef.current) inputRef.current.value = "";
            try {
              const picker = (window as any).showOpenFilePicker;
              if (typeof picker === "function") {
                const handles = await picker({
                  multiple: false
                });
                const file = handles?.[0] ? await handles[0].getFile() : null;
                if (file) {
                  await onFileSelected(file);
                  return;
                }
              }
            } catch (err: any) {
              const name = String(err?.name || "");
              if (name === "AbortError") return;
            }
            inputRef.current?.click();
          }}
          className={`text-sm rounded-lg border border-neutral-800 px-3 py-1 whitespace-nowrap ${
            triggerDisabled ? "opacity-60 cursor-not-allowed" : "hover:bg-neutral-900 cursor-pointer"
          }`}
          style={{ cursor: triggerDisabled ? "not-allowed" : "pointer" }}
          title={triggerDisabled ? "Upload unavailable" : "Upload into this content repo and commit"}
        >
          {upload.status === "preparing" && upload.kind === "content" && upload.contentId === contentId
            ? "Preparing upload…"
            : busy
              ? "Uploading…"
              : label}
        </button>
        {!authReady ? <span className="text-xs text-amber-300 ml-2">Sign in to upload</span> : null}
        {err ? <span className="text-xs text-red-300 ml-2">Upload failed</span> : null}
      </div>
    );
  }

  function CoverUploadButton({
    contentId,
    disabled,
    label = "Upload cover"
  }: {
    contentId: string;
    disabled?: boolean;
    label?: string;
  }) {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const busy =
      (upload.status === "preparing" || upload.status === "uploading") &&
      upload.kind === "cover" &&
      upload.contentId === contentId;
    const authReady = Boolean(getToken());
    const triggerDisabled = Boolean(disabled || busy || !authReady);

    const onCoverSelected = React.useCallback(
      async (file?: File) => {
        if (!file) return;

        setError(null);
        setUpload({ status: "preparing", kind: "cover", contentId, filename: file.name });
        try {
          setUpload({ status: "uploading", kind: "cover", contentId, filename: file.name });
          await uploadSongCover(contentId, file);
          setUpload({ status: "done", kind: "cover", contentId, filename: file.name });
          await load();
        } catch (err: any) {
          setUpload({ status: "error", kind: "cover", contentId, message: err?.message || "Cover upload failed" });
        }
      },
      [contentId]
    );

    return (
      <div className="inline-flex items-center gap-2">
        <input
          name={`uploadCover-${contentId}`}
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={triggerDisabled}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            await onCoverSelected(file);
          }}
        />
        <button
          type="button"
          aria-label="Upload content cover"
          disabled={triggerDisabled}
          onClick={async () => {
            if (triggerDisabled) return;
            if (inputRef.current) inputRef.current.value = "";
            try {
              const picker = (window as any).showOpenFilePicker;
              if (typeof picker === "function") {
                const handles = await picker({
                  multiple: false,
                  types: [
                    {
                      description: "Image files",
                      accept: {
                        "image/jpeg": [".jpg", ".jpeg"],
                        "image/png": [".png"],
                        "image/webp": [".webp"]
                      }
                    }
                  ]
                });
                const file = handles?.[0] ? await handles[0].getFile() : null;
                if (file) {
                  await onCoverSelected(file);
                  return;
                }
              }
            } catch (err: any) {
              const name = String(err?.name || "");
              if (name === "AbortError") return;
            }
            inputRef.current?.click();
          }}
          className={`text-sm rounded-lg border border-neutral-800 px-3 py-1 whitespace-nowrap ${
            triggerDisabled ? "opacity-60 cursor-not-allowed" : "hover:bg-neutral-900 cursor-pointer"
          }`}
          style={{ cursor: triggerDisabled ? "not-allowed" : "pointer" }}
          title={triggerDisabled ? "Cover upload unavailable" : "Upload album cover (jpg, png, webp)"}
        >
          {busy ? "Uploading…" : label}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {publicConsentOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-medium">Enable Public Link</div>
            <div className="mt-2 text-xs text-neutral-400 space-y-2">
              <div>To create a public link, Certifyd Creator needs to download a small helper tool to this device.</div>
              <div>It will be stored inside your Certifyd Creator data folder and can be removed anytime.</div>
              <div>This link works while Certifyd Creator is running and may change after restart.</div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-neutral-400" htmlFor="public-consent-dont-ask">
              <input
                id="public-consent-dont-ask"
                name="publicConsentDontAskAgain"
                type="checkbox"
                className="h-3 w-3"
                checked={publicConsentDontAskAgain}
                onChange={(e) => setPublicConsentDontAskAgain(e.target.checked)}
              />
              Don’t ask again on this device
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                onClick={() => setPublicConsentOpen(false)}
                disabled={publicConsentBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="text-xs rounded-lg border border-emerald-900 bg-emerald-950/30 px-2 py-1 text-emerald-200"
                onClick={confirmPublicConsent}
                disabled={publicConsentBusy}
              >
                {publicConsentBusy ? "Starting…" : "Download & Enable"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div>
        <div className="text-lg font-semibold">Content catalog</div>
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
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-500">Type:</span>
          {LIBRARY_TYPE_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={libraryTypeFilter === value}
              className={`rounded-full border px-2 py-1 ${
                libraryTypeFilter === value
                  ? "border-emerald-900 text-emerald-200 bg-emerald-950/30"
                  : "border-neutral-700 text-neutral-400 bg-neutral-950/60"
              }`}
              onClick={() => {
                setLibraryTypeFilter(value);
                writeLibraryTypeToUrl(value);
              }}
            >
              {LIBRARY_TYPE_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="text-xs text-neutral-500 mt-2">Showing: {LIBRARY_TYPE_LABEL[libraryTypeFilter]}</div>
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

      {(upload.status === "preparing" || upload.status === "uploading") && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 text-neutral-200 px-3 py-2 text-sm">
          {upload.status === "preparing"
            ? `Preparing upload… ${upload.filename}`
            : `Uploading… ${upload.filename}`}
        </div>
      )}

      {upload.status === "error" && (
        <div className="rounded-lg border border-red-900 bg-red-950/50 text-red-200 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>Upload failed: {upload.message}</span>
            <button
              type="button"
              onClick={() => setUpload({ status: "idle" })}
              className="text-xs rounded-md border border-red-900/60 px-2 py-1 hover:bg-red-950/60"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {upload.status === "done" && (
        <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 text-emerald-200 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>Uploaded + committed: {upload.filename}</span>
            <button
              type="button"
              onClick={() => setUpload({ status: "idle" })}
              className="text-xs rounded-md border border-emerald-900/60 px-2 py-1 hover:bg-emerald-950/60"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={createContent} className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium">New content item</div>
            {currentUserEmail ? (
              <div className="text-[11px] text-neutral-500">Creating as: <span className="text-neutral-300">{currentUserEmail}</span></div>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="block text-sm mb-1 text-neutral-300" htmlFor="content-title">
                Title
              </label>
              <input
                id="content-title"
                name="title"
                className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Highway 11 Nights (Master)"
                autoComplete="off"
              />
            </div>

            <div>
              <label className="block text-sm mb-1 text-neutral-300" htmlFor="content-type">
                Type
              </label>
              <select
                id="content-type"
                name="contentType"
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

          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-lg bg-white text-black font-medium px-4 py-2 disabled:opacity-60" disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </button>
            <div className="text-xs text-neutral-500">Upload sets the master file and updates manifest.json.primaryFile automatically.</div>
          </div>
        </form>

        {derivativesAllowed ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 space-y-3">
            <div className="font-medium">Create derivative (from OG content ID)</div>
            <div className="text-xs text-neutral-500">
              Use this if the original isn’t publicly visible. You’ll create a private derivative, then request clearance from its page.
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="block text-sm mb-1 text-neutral-300" htmlFor="derivative-parent-id">
                  Original content ID
                </label>
                <input
                  id="derivative-parent-id"
                  name="originalContentId"
                  className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
                  value={requestParentId}
                  onChange={(e) => setRequestParentId(e.target.value)}
                  placeholder="e.g. cml7... or https://host/p/..."
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-neutral-300" htmlFor="derivative-type">
                  Type
                </label>
                <select
                  id="derivative-type"
                  name="derivativeType"
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
              <label className="block text-sm mb-1 text-neutral-300" htmlFor="derivative-title">
                Derivative title
              </label>
              <input
                id="derivative-title"
                name="derivativeTitle"
                className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
                value={requestTitle}
                onChange={(e) => setRequestTitle(e.target.value)}
                placeholder="e.g. OG Track (DJ Remix)"
                autoComplete="off"
              />
            </div>

            <div className="max-w-[220px]">
              <label className="block text-sm mb-1 text-neutral-300" htmlFor="derivative-upstream-rate">
                Upstream royalty %
              </label>
              <input
                id="derivative-upstream-rate"
                name="upstreamRatePercent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
                value={requestUpstreamRatePct}
                onChange={(e) => setRequestUpstreamRatePct(e.target.value)}
                autoComplete="off"
              />
              <div className="mt-1 text-[11px] text-neutral-500">Fixed at derivative creation time and used for all clearance votes.</div>
            </div>

            {Number(String(requestUpstreamRatePct || "").trim()) === 0 ? (
              <label className="flex items-start gap-2 text-xs text-amber-200">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={requestZeroUpstreamConfirmed}
                  onChange={(e) => setRequestZeroUpstreamConfirmed(e.target.checked)}
                />
                <span>I understand 0% means no upstream payout to original parent stakeholders.</span>
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-neutral-800 px-4 py-2 hover:bg-neutral-900"
                onClick={requestDerivativeFromId}
                disabled={Number(String(requestUpstreamRatePct || "").trim()) === 0 && !requestZeroUpstreamConfirmed}
              >
                Create derivative
              </button>
              {requestMsg ? <div className="text-xs text-neutral-400">{requestMsg}</div> : null}
            </div>

            {requestLinks?.length ? (
              <div className="mt-1 space-y-1 text-[11px] text-neutral-400">
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
        ) : (
          <div className="rounded-xl border border-amber-900/60 bg-amber-950/40 p-4 text-xs text-amber-200">
            {lockReasons?.derivatives || "Derivatives require Advanced or LAN mode."}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="flex flex-wrap items-center justify-between mb-3 gap-3">
          <div className="flex items-center gap-2">
            <div className="font-medium">Your content</div>

            <div className="ml-2 inline-flex rounded-lg border border-neutral-800 overflow-hidden">
              <button
                type="button"
                className={`text-sm px-3 py-1 whitespace-nowrap ${
                  !showTrash && !showTombstones && !showClearance
                    ? "bg-emerald-950/40 text-emerald-200 border-r border-emerald-800/60 font-medium"
                    : "text-neutral-300 hover:bg-neutral-900"
                }`}
                onClick={async () => {
                  setContentScope("mine");
                  setShowClearance(false);
                  setShowTrash(false);
                  setShowTombstones(false);
                  await load(false, false);
                }}
              >
                Content
              </button>
              <button
                type="button"
                className={`text-sm px-3 py-1 whitespace-nowrap ${
                  showTrash
                    ? "bg-emerald-950/40 text-emerald-200 border-r border-emerald-800/60 font-medium"
                    : "text-neutral-300 hover:bg-neutral-900"
                }`}
                onClick={async () => {
                  setContentScope("mine");
                  setShowClearance(false);
                  setShowTrash(true);
                  setShowTombstones(false);
                  await load(true, false);
                }}
              >
                Trash
              </button>
              <button
                type="button"
                className={`text-sm px-3 py-1 whitespace-nowrap ${
                  showTombstones
                    ? "bg-emerald-950/40 text-emerald-200 border-r border-emerald-800/60 font-medium"
                    : "text-neutral-300 hover:bg-neutral-900"
                }`}
                onClick={async () => {
                  setContentScope("mine");
                  setShowClearance(false);
                  setShowTrash(false);
                  setShowTombstones(true);
                  await load(false, true);
                }}
              >
                Archived
              </button>
              {derivativesAllowed ? (
                <button
                  type="button"
                  className={`text-sm px-3 py-1 whitespace-nowrap ${
                    showClearance
                      ? "bg-emerald-950/40 text-emerald-200 font-medium"
                      : "text-neutral-300 hover:bg-neutral-900"
                  }`}
                  onClick={async () => {
                    setShowTrash(false);
                    setShowTombstones(false);
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
              ) : null}
            </div>
          </div>

          <button
            className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 whitespace-nowrap"
            onClick={() => {
              if (showClearance) {
                loadApprovals(clearanceScope);
                loadPendingClearanceCount();
              } else {
                refreshCurrentView();
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
          ) : clearanceLoadError ? (
            <div className="text-sm text-amber-300">
              {clearanceLoadError}
            </div>
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
                const isRemoteApproval = Boolean(String(a?.remoteOrigin || "").trim());
                const approvalKey = isRemoteApproval
                  ? `remote:${String(a?.remoteAuthorizationId || a?.authorizationId || "")}`
                  : `local:${linkId || String(a?.authorizationId || "")}`;
                const clearance = linkId ? clearanceByLink[linkId] : null;
                const progressBps = isRemoteApproval ? Number(a?.approveWeightBps || 0) : (clearance?.progressBps || 0);
                const thresholdBps = isRemoteApproval ? Number(a?.approvalBpsTarget || 6667) : (clearance?.thresholdBps || 6667);
                const approvedApprovers = Array.isArray(clearance?.votes)
                  ? clearance.votes.filter((v: any) => {
                      if (String(v.decision).toLowerCase() !== "approve") return false;
                      const approvedRatePercent = clearance?.upstreamBps ? clearance.upstreamBps / 100 : null;
                      if (approvedRatePercent === null || v.upstreamRatePercent === null || v.upstreamRatePercent === undefined) {
                        return true;
                      }
                      return Number(v.upstreamRatePercent) === Number(approvedRatePercent);
                    }).length
                  : Number(a?.approvedApprovers || 0);
                const approverCount = Array.isArray(clearance?.approvers) ? clearance.approvers.length : Number(a?.approverCount || 0);
                const pct = thresholdBps > 0 ? Math.min(100, Math.round((progressBps / thresholdBps) * 100)) : 0;
                const relation = titleCase(a?.relation || "Derivative");
                const parentTitle = a?.parentTitle || a?.parentContentId || "Original work";
                const childTitle = a?.childTitle || a?.childContentId || "Derivative";
                const isLoading = linkId ? clearanceLoadingByLink[linkId] : false;
                const status = String(a?.status || "").trim().toUpperCase();
                const isCleared = status === "APPROVED" || (thresholdBps > 0 && progressBps >= thresholdBps);
                const viewerVote = String(a?.viewerVote || "").toLowerCase();
                const canVote = isRemoteApproval ? Boolean(a?.remoteClearanceUrl) : Boolean(clearance?.viewer?.canVote);
                const previewGrantedAt = String(a?.clearanceRequest?.reviewGrantedAt || "").trim();
                const requestStatus = String(a?.clearanceRequest?.status || "").trim();
                const requestedAt = String(a?.clearanceRequest?.requestedAt || "").trim();
                const previewChildId = String(a?.childContentId || "").trim();
                const previewOrigin = String(a?.remoteChildOrigin || a?.childOrigin || a?.remoteOrigin || "").trim();
                const remoteParentHref =
                  isRemoteApproval && String(a?.remoteOrigin || "").trim() && String(a?.parentContentId || "").trim()
                    ? `${String(a.remoteOrigin).replace(/\/+$/, "")}/content/${encodeURIComponent(String(a.parentContentId))}/splits`
                    : "";

                return (
                  <div key={a.authorizationId} className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{childTitle}</div>
                        <div className="text-xs text-neutral-400">
                          {relation} of{" "}
                          <a
                            className="underline text-neutral-200"
                            href={remoteParentHref || `/content/${a.parentContentId}/splits`}
                            target={remoteParentHref ? "_blank" : undefined}
                            rel={remoteParentHref ? "noreferrer noopener" : undefined}
                            onClick={(event) => {
                              if (remoteParentHref) return;
                              event.preventDefault();
                              if (!a.parentContentId) return;
                              window.history.pushState({}, "", `/content/${encodeURIComponent(String(a.parentContentId))}/splits`);
                              window.dispatchEvent(new PopStateEvent("popstate"));
                            }}
                          >
                            {parentTitle}
                          </a>
                          {isRemoteApproval ? <span className="text-neutral-500"> • Remote node</span> : null}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-1">
                          Clearance: {isCleared ? "Cleared" : "Pending"} • Rights holders approved: {approvedApprovers} of{" "}
                          {approverCount || "?"}
                          {viewerVote ? ` • You ${viewerVote}` : ""}
                        </div>
                        {Array.isArray(clearance?.approvers) && clearance.approvers.length > 0 ? (
                          <div className="text-[11px] text-neutral-400 mt-1">
                            Shareholders:{" "}
                            <span className="text-neutral-200">
                              {clearance.approvers
                                .map((p: any) => p.displayName || p.participantEmail || p.participantUserId || "Unknown")
                                .join(", ")}
                            </span>
                          </div>
                        ) : null}
                        {!isRemoteApproval && requestStatus ? (
                          <div className="text-[11px] text-neutral-400 mt-1">
                            Request: {titleCase(requestStatus.toLowerCase())}
                            {requestedAt ? ` • ${new Date(requestedAt).toLocaleString()}` : ""}
                          </div>
                        ) : !isRemoteApproval ? (
                          <div className="text-[11px] text-neutral-500 mt-1">Request: not found</div>
                        ) : null}
                        {!isRemoteApproval && previewGrantedAt ? (
                          <div className="text-[11px] text-sky-300 mt-1">
                            Preview access: granted • {new Date(previewGrantedAt).toLocaleString()}
                          </div>
                        ) : !isRemoteApproval ? (
                          <div className="text-[11px] text-neutral-500 mt-1">Preview access: not granted</div>
                        ) : null}
                        {linkId ? (
                          <div className="text-[10px] text-neutral-600 mt-1">
                            Link ID: {linkId}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        {isRemoteApproval ? (
                          <button
                            type="button"
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            onClick={() => loadApprovals(clearanceScope)}
                          >
                            Refresh
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            onClick={() => (linkId ? loadClearanceSummary(linkId) : null)}
                            disabled={!linkId}
                          >
                            {isLoading ? "Loading…" : "Refresh"}
                          </button>
                        )}
                        {previewChildId ? (
                          <button
                            type="button"
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            onClick={() => {
                              if (!previewChildId) return;
                              if (isRemoteApproval) {
                                const inviteToken = String(a?.remoteInviteToken || "").trim();
                                const remoteAuthorizationId = String(a?.remoteAuthorizationId || "").trim();
                                if (inviteToken && remoteAuthorizationId && previewOrigin) {
                                  openRemoteInviteClearancePreview(previewOrigin, inviteToken, remoteAuthorizationId, previewChildId);
                                  return;
                                }
                                if (previewOrigin) {
                                  openRemoteDerivativePreview(previewOrigin, previewChildId);
                                  return;
                                }
                              }
                              loadDerivativePreview(previewChildId, previewOrigin || undefined);
                            }}
                            disabled={isRemoteApproval && !crossNodeAllowed}
                            title={isRemoteApproval && !crossNodeAllowed ? clearanceReason : "Preview submission"}
                          >
                            {derivativePreviewLoading[previewChildId] ? "Loading…" : "Preview submission"}
                          </button>
                        ) : null}
                        {!isCleared && isRemoteApproval && canVote && !viewerVote ? (
                          <>
                            <input
                              type="text"
                              className="w-40 text-xs rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1"
                              placeholder="Reject reason (optional)"
                              value={rejectReasonByApproval[approvalKey] || ""}
                              onChange={(e) =>
                                setRejectReasonByApproval((m) => ({ ...m, [approvalKey]: e.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="text-xs rounded-md border border-emerald-900 bg-emerald-950/30 px-2 py-1 text-emerald-200"
                              onClick={async () => {
                                const inviteToken = String(a?.remoteInviteToken || "").trim();
                                const remoteOrigin = String(a?.remoteOrigin || "").trim();
                                const remoteAuthorizationId = String(a?.remoteAuthorizationId || "").trim();
                                if (!inviteToken || !remoteOrigin || !remoteAuthorizationId) {
                                  setError("Missing remote vote routing context.");
                                  return;
                                }
                                setActionMsgByApproval((m) => ({ ...m, [approvalKey]: null }));
                                try {
                                  await api(
                                    `/api/remote/invites/${encodeURIComponent(inviteToken)}/clearance/${encodeURIComponent(
                                      remoteAuthorizationId
                                    )}/vote?origin=${encodeURIComponent(remoteOrigin)}`,
                                    "POST",
                                    {
                                      decision: "approve",
                                      upstreamRatePercent:
                                        Number.isFinite(Number(a?.upstreamRatePercent)) && Number(a?.upstreamRatePercent) >= 0
                                          ? Number(a.upstreamRatePercent)
                                          : 0
                                    }
                                  );
                                } catch (e) {
                                  const reconciled = await clearedAfterActionError(a, linkId);
                                  if (!reconciled) throw e;
                                  setActionMsgByApproval((m) => ({ ...m, [approvalKey]: "Permission recorded. Item is now cleared." }));
                                }
                                await loadApprovals(clearanceScope);
                                await loadPendingClearanceCount();
                              }}
                            >
                              Grant permission
                            </button>
                            <button
                              type="button"
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={async () => {
                                const inviteToken = String(a?.remoteInviteToken || "").trim();
                                const remoteOrigin = String(a?.remoteOrigin || "").trim();
                                const remoteAuthorizationId = String(a?.remoteAuthorizationId || "").trim();
                                if (!inviteToken || !remoteOrigin || !remoteAuthorizationId) {
                                  setError("Missing remote vote routing context.");
                                  return;
                                }
                                setActionMsgByApproval((m) => ({ ...m, [approvalKey]: null }));
                                try {
                                  await api(
                                    `/api/remote/invites/${encodeURIComponent(inviteToken)}/clearance/${encodeURIComponent(
                                      remoteAuthorizationId
                                    )}/vote?origin=${encodeURIComponent(remoteOrigin)}`,
                                    "POST",
                                    { decision: "reject", reason: (rejectReasonByApproval[approvalKey] || "").trim() || undefined }
                                  );
                                } catch (e) {
                                  const reconciled = await clearedAfterActionError(a, linkId);
                                  if (!reconciled) throw e;
                                  setActionMsgByApproval((m) => ({ ...m, [approvalKey]: "Action recorded. Clearance state updated." }));
                                }
                                setRejectReasonByApproval((m) => ({ ...m, [approvalKey]: "" }));
                                await loadApprovals(clearanceScope);
                                await loadPendingClearanceCount();
                              }}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                        {!isCleared && canVote && !isRemoteApproval && !viewerVote ? (
                          <>
                            <input
                              type="text"
                              className="w-40 text-xs rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1"
                              placeholder="Reject reason (optional)"
                              value={rejectReasonByApproval[approvalKey] || ""}
                              onChange={(e) =>
                                setRejectReasonByApproval((m) => ({ ...m, [approvalKey]: e.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className="text-xs rounded-md border border-emerald-900 bg-emerald-950/30 px-2 py-1 text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
                              onClick={async () => {
                                if (!linkId) return;
                                const pct = Number.isFinite(Number(a?.upstreamRatePercent))
                                  ? Number(a.upstreamRatePercent)
                                  : Number.isFinite(Number(clearance?.upstreamBps))
                                  ? Number(clearance.upstreamBps) / 100
                                  : 0;
                                setActionMsgByApproval((m) => ({ ...m, [approvalKey]: null }));
                                try {
                                  await api(`/content-links/${linkId}/vote`, "POST", {
                                    decision: "approve",
                                    upstreamRatePercent: pct
                                  });
                                } catch (e) {
                                  const reconciled = await clearedAfterActionError(a, linkId);
                                  if (!reconciled) throw e;
                                  setActionMsgByApproval((m) => ({ ...m, [approvalKey]: "Permission recorded. Item is now cleared." }));
                                }
                                await loadApprovals(clearanceScope);
                                await loadPendingClearanceCount();
                                await loadClearanceSummary(linkId);
                              }}
                              disabled={!linkId || !crossNodeAllowed || isRemoteApproval}
                              title={!crossNodeAllowed ? clearanceReason : "Grant permission"}
                            >
                              Grant permission
                            </button>
                            <button
                              type="button"
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
                              onClick={async () => {
                                if (!linkId) return;
                                setActionMsgByApproval((m) => ({ ...m, [approvalKey]: null }));
                                try {
                                  await api(`/content-links/${linkId}/vote`, "POST", {
                                    decision: "reject",
                                    reason: (rejectReasonByApproval[approvalKey] || "").trim() || undefined
                                  });
                                } catch (e) {
                                  const reconciled = await clearedAfterActionError(a, linkId);
                                  if (!reconciled) throw e;
                                  setActionMsgByApproval((m) => ({ ...m, [approvalKey]: "Action recorded. Clearance state updated." }));
                                }
                                setRejectReasonByApproval((m) => ({ ...m, [approvalKey]: "" }));
                                await loadApprovals(clearanceScope);
                                await loadPendingClearanceCount();
                                await loadClearanceSummary(linkId);
                              }}
                              disabled={!linkId || !crossNodeAllowed || isRemoteApproval}
                              title={!crossNodeAllowed ? clearanceReason : "Reject"}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {!isRemoteApproval && !crossNodeAllowed ? (
                      <div className="mt-2 text-[11px] text-amber-300">
                        {clearanceReason}{" "}
                        <button
                          type="button"
                          onClick={() => {
                            window.history.pushState({}, "", "/config");
                            window.location.reload();
                          }}
                          className="underline text-amber-200 hover:text-amber-100"
                        >
                          Set up named link
                        </button>
                      </div>
                    ) : null}
                    {isRemoteApproval && !canVote ? (
                      <div className="mt-2 text-[11px] text-amber-300">
                        Vote link not issued yet. Click Refresh to sync latest clearance routing.
                      </div>
                    ) : null}
                    {actionMsgByApproval[approvalKey] ? (
                      <div className="mt-2 text-[11px] text-emerald-300">
                        {actionMsgByApproval[approvalKey]}
                      </div>
                    ) : null}
                    {previewChildId && derivativePreviewError[previewChildId] ? (
                      <div className="mt-2 text-[11px] text-amber-300">
                        {derivativePreviewError[previewChildId]}
                      </div>
                    ) : null}

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
          <div className="text-sm text-neutral-400">
            {showTrash ? "Trash is empty." : showTombstones ? "No archived items." : "No content yet."}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((it) => {
              const isOwner = Boolean(it.ownerUserId && it.ownerUserId === meId);
              const canInspect = isOwner || it.libraryAccess === "participant";
              const ownerLabel = it.owner?.displayName || it.owner?.email || it.ownerUserId || "Unknown";
              const isOpen = !!expanded[it.id];
              const filesCount = it._count?.files ?? 0;
              const isFilesLoading = !!filesLoading[it.id];
              const files = filesByContent[it.id] || [];
              const busy = !!busyAction[it.id];
              const accessTag = it.libraryAccess || (it.ownerUserId === meId ? "owned" : "preview");
              const participationInfo = participationByContentId[it.id];
              const participationFeatured = Boolean(participationInfo?.highlightedOnProfile);
              const isDerivativeType = ["derivative", "remix", "mashup"].includes(String(it.type || ""));

              const split = splitByContent[it.id] ?? null;
              const isSplitLoading = !!splitLoading[it.id];
              const uiState = computeContentUiState(it);
              const allowPublish = canPublish(uiState);
              const allowTrash = canTrash(uiState);
              const allowArchive = canArchive(uiState);
              const allowRestore = canRestore(uiState);
              const allowUpload = canUpload(uiState);
              const allowCoverUpload = uiState === "draft" || uiState === "published";
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
              const currentPriceSats = Number(it.priceSats ?? 0);
              const commerceAuthorityAvailable = Boolean(nodeModeSnapshot?.commerceAuthorityAvailable);
              const pricedButCommerceBlocked = Number.isFinite(currentPriceSats) && currentPriceSats > 0 && !commerceAuthorityAvailable;
              const paidUnlockEnabled =
                Number.isFinite(currentPriceSats) &&
                currentPriceSats > 0 &&
                commerceAuthorityAvailable;
              const creatorSales = salesByContent[it.id] || null;
              const recentSales = Array.isArray(creatorSales?.recent) ? creatorSales.recent : [];
              const lastSale = recentSales[0] || null;
              const monetizationAccessLabel = paidUnlockEnabled
                ? "Paid unlock enabled"
                : pricedButCommerceBlocked
                  ? "Suggested tip set (paid unlock requires commerce authority)"
                : lightningAvailable
                  ? "Free access with tips enabled"
                  : "Free access";
              const parentLink = parentLinkByContent[it.id] || null;
              const derivativeClearanceUnknown = isDerivativeType && parentLinkByContent[it.id] === undefined;
              const derivativeClearancePending =
                isDerivativeType && Boolean(parentLink?.requiresApproval && !parentLink?.approvedAt);
              const derivativePublishBlocked = derivativeClearanceUnknown || derivativeClearancePending;
              const publishTitle = isBasicTier && isDerivativeType
                ? "Derivatives require Advanced mode and clearance before publishing."
                : derivativeClearancePending
                  ? "Clearance is pending. Publish unlocks after rights-holder approval."
                  : derivativeClearanceUnknown
                    ? "Checking clearance status..."
                    : !allowPublish
                      ? "Already published"
                      : !networkPublishAllowed
                        ? networkPublishReason
                        : "Publish this content";

              return (
                <div key={it.id} className="rounded-lg border border-neutral-800 bg-neutral-950/40">
                  <div className="flex flex-wrap items-center justify-between gap-4 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{it.title}</div>
                      <div className="text-xs text-neutral-400">
                        {it.type.toUpperCase()} • {it.status.toUpperCase()} • {formatDateLabel(it.createdAt)} • {filesCount} file
                        {filesCount === 1 ? "" : "s"}
                        {(showTrash || showTombstones) && it.deletedAt ? ` • Deleted ${formatDateLabel(it.deletedAt)}` : ""}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-1 capitalize">Access: {accessTag}</div>
                      {it.previousVersionContentId ? (
                        <div className="text-[11px] text-sky-300/90 mt-1">
                          Version draft from:{" "}
                          <span className="text-sky-200">
                            {it.previousVersion?.title || shortSha(it.previousVersionContentId, 10)}
                          </span>
                          {it.previousVersion?.status ? (
                            <span className="text-neutral-500"> ({String(it.previousVersion.status).toLowerCase()})</span>
                          ) : null}
                        </div>
                      ) : null}
                      {uiState === "archived" ? (
                        <div className="mt-1 inline-flex rounded-full border border-amber-800 bg-amber-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                          Archived
                        </div>
                      ) : null}
                      {uiState === "trash" ? (
                        <div className="mt-1 inline-flex rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-300">
                          In Trash
                        </div>
                      ) : null}
                      {Boolean(it.featureOnProfile) && uiState === "published" ? (
                        <div className="mt-1 inline-flex rounded-full border border-sky-900 bg-sky-950/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-200">
                          Featured on profile
                        </div>
                      ) : null}
                      {!Boolean(it.featureOnProfile) && participationFeatured && uiState === "published" ? (
                        <div className="mt-1 inline-flex rounded-full border border-sky-900 bg-sky-950/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-200">
                          Featured participation
                        </div>
                      ) : null}
                      {uiState === "published" && networkPublishByContent[it.id]?.hasReceipt ? (
                        <div className="mt-1 inline-flex rounded-full border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-200">
                          Network Published
                        </div>
                      ) : null}
                      {!isOwner ? (
                        <div className="text-xs text-amber-300 mt-1">Read-only • Owner: {ownerLabel}</div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!showTrash && !showTombstones ? (
                        <>
                          {canInspect ? (
                            <>
                              <button
                                type="button"
                                className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 whitespace-nowrap"
                                onClick={async () => {
                                  if (!isOwner && participationInfo?.kind === "remote") {
                                    const origin = String(participationInfo.remoteOrigin || "").replace(/\/+$/, "");
                                    if (origin) {
                                      const target = `${origin}/buy/${encodeURIComponent(it.id)}`;
                                      window.open(target, "_blank", "noopener,noreferrer");
                                      return;
                                    }
                                  }
                                  const next = !isOpen;
                                  setExpanded((m) => ({ ...m, [it.id]: next }));
                                  if (next) {
                                    try {
                                      if (isOwner) {
                                        await Promise.all([
                                          filesByContent[it.id] ? Promise.resolve() : loadFiles(it.id),
                                          splitByContent[it.id] !== undefined ? Promise.resolve() : loadLatestSplit(it.id),
                                          derivativeAuthByContent[it.id] !== undefined ? Promise.resolve() : loadDerivativeAuth(it.id),
                                          approvals.length ? Promise.resolve() : loadApprovals(),
                                          salesByContent[it.id] !== undefined ? Promise.resolve() : loadSales(it.id),
                                          parentLinkByContent[it.id] !== undefined ? Promise.resolve() : loadParentLink(it.id),
                                          derivativesByContent[it.id] !== undefined ? Promise.resolve() : loadDerivativesForParent(it.id),
                                          creditsByContent[it.id] !== undefined ? Promise.resolve() : loadCredits(it.id),
                                          auditByContent[it.id] !== undefined ? Promise.resolve() : loadAudit(it.id),
                                          shareLinkByContent[it.id] !== undefined ? Promise.resolve() : loadShareLink(it.id),
                                          previewByContent[it.id] !== undefined ? Promise.resolve() : loadPreview(it.id)
                                        ]);
                                      } else {
                                        await Promise.all([
                                          derivativesByContent[it.id] !== undefined ? Promise.resolve() : loadDerivativesForParent(it.id)
                                        ]);
                                      }
                                    } catch (e: any) {
                                      setError(e?.message || "Failed to load content details.");
                                    }
                                  }
                                }}
                              >
                                {isOpen
                                  ? "Hide details"
                                  : !isOwner && participationInfo?.kind === "remote"
                                    ? "Open release"
                                    : isOwner
                                      ? "Show files"
                                      : "Details"}
                              </button>

                              {isOwner && allowUpload ? (
                                <UploadButton contentId={it.id} disabled={busy} label="Upload" />
                              ) : null}
                              {isOwner && allowCoverUpload && COVER_UPLOAD_TYPES.has(String(it.type || "").toLowerCase() as ContentType) ? (
                                <CoverUploadButton
                                  contentId={it.id}
                                  disabled={busy}
                                  label={uiState === "published" ? "Update cover" : "Upload cover"}
                                />
                              ) : null}
                              {splitsAllowed && isOwner ? (
                                <button
                                  type="button"
                                  className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60 whitespace-nowrap"
                                  onClick={() => onOpenSplits?.(it.id)}
                                  disabled={busy}
                                >
                                  Edit splits
                                </button>
                              ) : null}

                              <button
                                type="button"
                                className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60 whitespace-nowrap"
                                onClick={() => publishContent(it.id)}
                                disabled={
                                  publishBusy[it.id] ||
                                  !networkPublishAllowed ||
                                  !allowPublish ||
                                  derivativePublishBlocked ||
                                  (isBasicTier && isDerivativeType)
                                }
                                title={publishTitle}
                              >
                                {!allowPublish
                                  ? "Published"
                                  : publishBusy[it.id]
                                    ? "Publishing…"
                                    : "Publish"}
                              </button>

                              {allowTrash || allowArchive ? (
                                <button
                                  type="button"
                                  className={`text-sm rounded-lg px-3 py-1 disabled:opacity-60 whitespace-nowrap ${
                                    allowArchive
                                      ? "border border-amber-900 text-amber-200 hover:bg-amber-950/30"
                                      : "border border-neutral-800 hover:bg-neutral-900"
                                  }`}
                                  onClick={() => softDelete(it.id)}
                                  disabled={busy}
                                  title={allowArchive ? "Archive this published item" : "Move this draft to Trash"}
                                >
                                  {busy ? "…" : allowArchive ? "Archive" : "Trash"}
                                </button>
                              ) : null}
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
                      ) : showTrash ? (
                        <>
                          {allowRestore ? (
                            <button
                              type="button"
                              className="text-sm rounded-lg border border-neutral-800 px-3 py-1 hover:bg-neutral-900 disabled:opacity-60 whitespace-nowrap"
                              onClick={() => restore(it.id)}
                              disabled={busy}
                            >
                              Restore
                            </button>
                          ) : null}

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
                      ) : (
                        <div className="text-xs text-amber-300">Archived</div>
                      )}
                    </div>
                    {!networkPublishAllowed ? (
                      <div className="w-full text-[11px] text-amber-300">
                        {networkPublishReason}{" "}
                        <button
                          type="button"
                          onClick={() => {
                            window.history.pushState({}, "", "/config");
                            window.location.reload();
                          }}
                          className="underline text-amber-200 hover:text-amber-100"
                        >
                          Configure provider or named link
                        </button>
                      </div>
                    ) : null}
                    <div className="w-full text-[11px] text-neutral-400 space-y-0.5">
                      <div>
                        Network publish:{" "}
                        <span className={networkPublishAllowed ? "text-emerald-300" : "text-amber-300"}>
                          {networkPublishAllowed ? "Ready" : "Not ready"}
                        </span>
                      </div>
                      {!networkPublishAllowed ? (
                        <div className="text-amber-300">{networkPublishReason}</div>
                      ) : null}
                      <div>
                        Public discovery:{" "}
                        <span className={discoveryPublishAllowed ? "text-emerald-300" : "text-amber-300"}>
                          {discoveryPublishAllowed ? "Ready" : "Not ready"}
                        </span>
                      </div>
                      {!discoveryPublishAllowed ? (
                        <div className="text-amber-300">{discoveryPublishReason}</div>
                      ) : null}
                    </div>
                  </div>

                  {!showTrash && !showTombstones && isOpen && (
                    <div className="border-t border-neutral-800 px-3 py-3 space-y-3">
                      {(() => {
                        const preview = previewByContent[it.id] || null;
                        const previewUrl = preview?.previewUrl || null;
                        const previewFile = previewFileFor(previewUrl, preview?.files || files);
                        const previewMime = String(previewFile?.mime || "");
                        const isVideo = String(it.type || "").toLowerCase() === "video" || previewMime.startsWith("video/");
                        const isAudio = String(it.type || "").toLowerCase() === "song" || previewMime.startsWith("audio/");
                        const isImage = previewMime.startsWith("image/");
                        const isImageLikePreview = Boolean(
                          previewUrl && (isImage || looksLikeImagePreviewUrl(previewUrl))
                        );
                        const coverUrl = `${apiBase}/public/content/${encodeURIComponent(it.id)}/cover${
                          it.manifest?.sha256 ? `?v=${encodeURIComponent(it.manifest.sha256)}` : ""
                        }`;
                        return (
                          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-neutral-300 font-medium">Preview</div>
                              <button
                                type="button"
                                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                onClick={() => loadPreview(it.id)}
                              >
                                {previewLoadingByContent[it.id] ? "Loading…" : "Refresh preview"}
                              </button>
                            </div>
                            <div className="mt-2 space-y-2">
                              {isAudio ? (
                                <div>
                                  <div className="w-32 h-32 rounded-md border border-neutral-800 overflow-hidden bg-neutral-900">
                                    <img
                                      src={coverUrl}
                                      alt={`${it.title || "Song"} cover`}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      onError={(e) => {
                                        setCoverLoadErrorByContent((m) => ({ ...m, [it.id]: true }));
                                        const el = e.currentTarget;
                                        const parent = el.parentElement;
                                        if (!parent) return;
                                        parent.innerHTML =
                                          '<div class="w-full h-full flex items-center justify-center text-[10px] text-neutral-500">No cover</div>';
                                      }}
                                      onLoad={() => setCoverLoadErrorByContent((m) => ({ ...m, [it.id]: false }))}
                                    />
                                  </div>
                                  {coverLoadErrorByContent[it.id] ? (
                                    <div className="mt-1 text-[10px] text-amber-300">Cover missing on disk or not set in manifest.</div>
                                  ) : null}
                                </div>
                              ) : null}
                              {previewUrl && isVideo ? <video className="w-full rounded-md" controls src={previewUrl} /> : null}
                              {previewUrl && isAudio ? <audio className="w-full" controls src={previewUrl} /> : null}
                              {previewUrl && isImageLikePreview ? (
                                <img
                                  className="block w-full h-72 rounded-md object-contain bg-neutral-950/60"
                                  src={previewUrl}
                                  alt={it.title || "Preview"}
                                  loading="lazy"
                                />
                              ) : null}
                              {previewUrl && !isAudio && !isVideo && !isImageLikePreview ? (
                                <div className="text-xs text-neutral-500">Inline preview unavailable for this file type.</div>
                              ) : null}
                              {previewUrl ? (
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex text-xs text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                                >
                                  Open preview
                                </a>
                              ) : null}
                              {!previewLoadingByContent[it.id] && !previewUrl && !preview?.error ? (
                                <div className="text-xs text-neutral-500">No preview available yet.</div>
                              ) : null}
                              {preview?.error ? <div className="text-xs text-amber-300">{String(preview.error)}</div> : null}
                            </div>
                          </div>
                        );
                      })()}

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
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-neutral-300 font-medium">File identity</div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="text-[11px] rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={() => {
                                const entry = manifestPreviewByContent[it.id];
                                if (entry?.open) {
                                  setManifestPreview(it.id, { open: false });
                                  return;
                                }
                                loadManifestPreview(it.id);
                              }}
                            >
                              View JSON
                            </button>
                            <button
                              type="button"
                              className="text-[11px] rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={async () => {
                                const entry = manifestPreviewByContent[it.id];
                                const data = entry?.data ?? (await loadManifestPreview(it.id));
                                if (data) {
                                  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                                }
                              }}
                            >
                              Copy JSON
                            </button>
                          </div>
                        </div>
                        {isFilesLoading ? (
                          <div className="mt-2 text-sm text-neutral-400">Loading files…</div>
                        ) : files.length === 0 ? (
                          <div className="mt-2 text-sm text-neutral-400">No files yet. Click Upload.</div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            <div className="text-[11px] text-neutral-400 flex items-center gap-2">
                              <span>Content ID: <span className="text-neutral-300">{it.id}</span></span>
                              <button
                                type="button"
                                className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                onClick={() => navigator.clipboard.writeText(it.id)}
                              >
                                Copy
                              </button>
                            </div>
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
                          const approvalTargetBps = Number(parentLink.clearance?.approvalBpsTarget || 6667);
                          const approvalWeightBps = Number(parentLink.clearance?.approveWeightBps || 0);
                          const clearanceStatus = String(parentLink.clearance?.status || "").trim().toUpperCase();
                          const clearedEffective =
                            Boolean(parentLink.approvedAt) ||
                            clearanceStatus === "APPROVED" ||
                            (approvalTargetBps > 0 && approvalWeightBps >= approvalTargetBps);
                          const requestStatusRaw = String(parentLink.clearanceRequest?.status || "").trim().toUpperCase();
                          const requestStatusEffective =
                            requestStatusRaw === "CLEARED" || clearedEffective
                              ? "CLEARED"
                              : requestStatusRaw || "PENDING";
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
                              <div className="mt-1 text-[11px] text-neutral-500">
                                Parent content:{" "}
                                <span className="font-mono text-neutral-300">
                                  {parentLink.parent?.id || "—"}
                                </span>
                                {" "}• Parent split snapshot:{" "}
                                <span className="font-mono text-neutral-300">
                                  {parentLink.parentSplit?.splitVersionId || "—"}
                                </span>
                              </div>
                              {Array.isArray(parentLink.clearance?.approvers) && parentLink.clearance.approvers.length > 0 ? (
                                <div className="mt-1 text-[11px] text-neutral-400">
                                  Parent shareholders:{" "}
                                  <span className="text-neutral-200">
                                    {parentLink.clearance.approvers
                                      .map((a: any) => a.displayName || a.participantEmail || a.participantUserId || "Unknown")
                                      .join(", ")}
                                  </span>
                                </div>
                              ) : null}
                              <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/60 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] font-medium text-neutral-200">Clearance / License for release</div>
                                  <span
                                    className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                      clearedEffective
                                        ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                                        : "border-amber-900 bg-amber-950/30 text-amber-200"
                                    }`}
                                  >
                                    {clearedEffective ? "Cleared" : "Pending clearance"}
                                  </span>
                                </div>
                                <div className="mt-1 text-[11px] text-neutral-400">
                                  Upstream:{" "}
                                  <span className="text-neutral-200">
                                    {typeof parentLink.upstreamBps === "number"
                                      ? `${upstreamRatePct}%${parentLink.upstreamBps === 0 ? " (no upstream payout)" : ""}`
                                      : "Fixed at derivative creation"}
                                  </span>
                                  {" "}•{" "}
                                  {splitsAllowed ? (
                                    <a
                                      href={`/content/${it.id}/splits`}
                                      className="text-neutral-200 underline"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        window.history.pushState({}, "", `/content/${encodeURIComponent(it.id)}/splits`);
                                        window.dispatchEvent(new PopStateEvent("popstate"));
                                      }}
                                    >
                                      View routing
                                    </a>
                                  ) : (
                                    <span className="text-neutral-500">{lockReasons?.advanced_splits || "Routing requires Advanced or LAN mode."}</span>
                                  )}
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
                                    { label: "Cleared", done: Boolean(clearedEffective) },
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
                              {!clearedEffective ? (
                                <div className="mt-1 text-[11px] text-neutral-500">
                                  You can share/sell privately now. To release publicly, request clearance from original rights holders.
                                </div>
                              ) : null}
                              {parentLink.clearanceRequest ? (
                                <div className="mt-1 text-[11px] text-neutral-400">
                                  Clearance requested: {titleCase(requestStatusEffective.toLowerCase())}
                                  {" "}•{" "}
                                  {formatDateLabel(parentLink.clearanceRequest.requestedAt)}
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
                                {parentLink.requiresApproval &&
                                !clearedEffective &&
                                isOwner ? (
                                  <button
                                    type="button"
                                    className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={() => requestClearanceForContent(it.id, parentLink.linkId)}
                                    disabled={!crossNodeAllowed}
                                    title={!crossNodeAllowed ? clearanceReason : "Request clearance"}
                                  >
                                    {parentLink.clearanceRequest ? "Resend clearance request" : "Request clearance"}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                  onClick={() => loadDerivativePreview(it.id, it.childOrigin)}
                                >
                                  {derivativePreviewLoading[it.id] ? "Loading…" : "Load preview"}
                                </button>
                                <button
                                  type="button"
                                  className="text-[11px] rounded border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                  disabled={!crossNodeAllowed}
                                  title={!crossNodeAllowed ? clearanceReason : "Grant preview access"}
                                >
                                  Grant preview access
                                </button>
                                <button
                                  type="button"
                                  className="text-[11px] rounded border border-red-900 bg-red-950/30 px-2 py-0.5 text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                  disabled={!crossNodeAllowed}
                                  title={!crossNodeAllowed ? clearanceReason : "Revoke preview access"}
                                >
                                  Revoke preview access
                                </button>
                              </div>
                              {!crossNodeAllowed ? (
                                <div className="mt-1 text-[11px] text-amber-300">
                                  {clearanceReason}{" "}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      window.history.pushState({}, "", "/config");
                                      window.location.reload();
                                    }}
                                    className="underline text-amber-200 hover:text-amber-100"
                                  >
                                    Set up named link
                                  </button>
                                </div>
                              ) : null}
                              {reviewGrantMsgByContent[it.id] ? (
                                <div className="mt-2 text-[11px] text-neutral-300">{reviewGrantMsgByContent[it.id]}</div>
                              ) : null}
                              {clearanceRequestMsgByContent[it.id] ? (
                                <div className="mt-2 text-[11px] text-amber-300">{clearanceRequestMsgByContent[it.id]}</div>
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
                                    const isImage = mime.startsWith("image/");
                                    const isImageLikePreview = Boolean(
                                      previewUrl && (isImage || looksLikeImagePreviewUrl(previewUrl))
                                    );
                                    if (previewUrl && isVideo) {
                                      return (
                                        <div className="mt-2">
                                          <video className="w-full rounded-md" controls src={previewUrl} />
                                          <a
                                            href={previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-2 inline-flex text-xs text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                                          >
                                            Open preview
                                          </a>
                                        </div>
                                      );
                                    }
                                    if (previewUrl && isAudio) {
                                      return (
                                        <div className="mt-2">
                                          <audio className="w-full" controls src={previewUrl} />
                                          <a
                                            href={previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-2 inline-flex text-xs text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                                          >
                                            Open preview
                                          </a>
                                        </div>
                                      );
                                    }
                                    if (previewUrl && isImageLikePreview) {
                                      return (
                                        <div className="mt-2">
                                          <img
                                            className="block w-full h-72 rounded-md object-contain bg-neutral-950/60"
                                            src={previewUrl}
                                            alt={it.title || "Preview"}
                                            loading="lazy"
                                          />
                                          <a
                                            href={previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-2 inline-flex text-xs text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                                          >
                                            Open preview
                                          </a>
                                        </div>
                                      );
                                    }
                                    if (previewUrl) {
                                      return (
                                        <div className="mt-2">
                                          <div className="text-xs text-neutral-500">Inline preview unavailable for this file type.</div>
                                          <a
                                            href={previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="mt-2 inline-flex text-xs text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                                          >
                                            Open preview
                                          </a>
                                        </div>
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
                                {splitsAllowed ? (
                                  <a
                                    href={`/content/${parentLink.parent?.id}/splits`}
                                    className="text-neutral-200 underline"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      if (!parentLink.parent?.id) return;
                                      window.history.pushState({}, "", `/content/${encodeURIComponent(parentLink.parent.id)}/splits`);
                                      window.dispatchEvent(new PopStateEvent("popstate"));
                                    }}
                                  >
                                    {parentLink.parent?.title || "Original work"}
                                  </a>
                                ) : (
                                  <span className="text-neutral-200">{parentLink.parent?.title || "Original work"}</span>
                                )}
                                {" "}• Upstream: {typeof parentLink.upstreamBps === "number"
                                  ? `${upstreamRatePct}%${parentLink.upstreamBps === 0 ? " (no upstream payout)" : ""}`
                                  : "Fixed at derivative creation"} • Clearance:{" "}
                                {parentLink.requiresApproval ? (parentLink.approvedAt ? "Cleared" : "Pending clearance") : "Not required"}
                                {" "}•{" "}
                                {splitsAllowed ? (
                                  <a
                                    href={`/content/${it.id}/splits`}
                                    className="text-neutral-200 underline"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      window.history.pushState({}, "", `/content/${encodeURIComponent(it.id)}/splits`);
                                      window.dispatchEvent(new PopStateEvent("popstate"));
                                    }}
                                  >
                                    View routing
                                  </a>
                                ) : (
                                  <span className="text-neutral-500">{lockReasons?.advanced_splits || "Routing requires Advanced or LAN mode."}</span>
                                )}
                              </div>
                            ) : (
                              <div className="mt-2 text-xs text-amber-300">
                                No original linked.
                                {splitsAllowed ? (
                                  <>
                                    {" "}
                                    <a
                                      href={`/content/${it.id}/splits`}
                                      className="underline"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        window.history.pushState({}, "", `/content/${encodeURIComponent(it.id)}/splits`);
                                        window.dispatchEvent(new PopStateEvent("popstate"));
                                      }}
                                    >
                                      Link original in Splits
                                    </a>.
                                  </>
                                ) : null}
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
                        <div className="mt-2 flex items-center justify-between">
                          <div className="text-[11px] text-neutral-500">Manage clearance requests and previews.</div>
                          {(() => {
                            const all = derivativesByContent[it.id] || [];
                            const tombCount = all.filter((d: any) => d.childDeletedAt).length;
                            return (
                          <button
                            type="button"
                            className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                            onClick={() =>
                              setDerivativeShowTombstones((m) => ({ ...m, [it.id]: !m[it.id] }))
                            }
                            disabled={tombCount === 0}
                          >
                            {derivativeShowTombstones[it.id] ? "Hide tombstones" : `Show tombstones (${tombCount})`}
                          </button>
                            );
                          })()}
                        </div>
                        <div className="mt-2 space-y-2">
                          {(() => {
                            const all = derivativesByContent[it.id] || [];
                            const showTomb = Boolean(derivativeShowTombstones[it.id]);
                            const visibleAll = showTomb ? all : all.filter((d) => !d.childDeletedAt);
                            const active = visibleAll.filter((d) => !d.childDeletedAt);
                            const tombs = all.filter((d) => d.childDeletedAt);
                            const groups = [
                              { key: "action", label: "Action needed", items: active.filter((d) => !d.approvedAt) },
                              { key: "cleared", label: "Cleared", items: active.filter((d) => d.approvedAt) },
                              { key: "tomb", label: "Tombstoned", items: showTomb ? tombs : [] }
                            ];

                            const renderItem = (d: any) => (
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
                                    {d.clearance?.reviewGrantedAt ? (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-900 bg-sky-950/30 text-sky-200">
                                        Preview granted
                                      </span>
                                    ) : null}
                                    <span className="text-[11px]">
                                      Upstream {(d.upstreamBps || 0) / 100}%
                                    </span>
                                  </div>
                                  {!d.childDeletedAt ? (
                                    <>
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
                                            className="text-[11px] rounded border border-emerald-900 bg-emerald-950/30 px-2 py-0.5 text-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                            onClick={async () => {
                                              const pct = Number.isFinite(Number(d?.upstreamBps))
                                                ? Number(d.upstreamBps) / 100
                                                : 0;
                                              await api(`/content-links/${d.linkId}/vote`, "POST", {
                                                decision: "approve",
                                                upstreamRatePercent: pct
                                              });
                                              await loadDerivativesForParent(it.id);
                                            }}
                                            disabled={!crossNodeAllowed}
                                            title={!crossNodeAllowed ? clearanceReason : "Grant permission"}
                                          >
                                            Grant permission
                                          </button>
                                        );
                                      })()}
                                    </>
                                  ) : null}
                                </div>
                                </div>
                                {!crossNodeAllowed && !d.childDeletedAt ? (
                                  <div className="mt-2 text-[11px] text-amber-300">
                                    {clearanceReason}{" "}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        window.history.pushState({}, "", "/config");
                                        window.location.reload();
                                      }}
                                      className="underline text-amber-200 hover:text-amber-100"
                                    >
                                      Set up named link
                                    </button>
                                  </div>
                                ) : null}
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
                            );

                            if (visibleAll.length === 0) {
                              return <div className="text-neutral-500">No linked derivatives.</div>;
                            }

                            return (
                              <div className="space-y-3">
                                {groups
                                  .filter((g) => g.items.length > 0)
                                  .map((g) => {
                                    const key = `${it.id}:${g.key}`;
                                    const isOpen = !!derivativeGroupOpen[key];
                                    const visible = isOpen ? g.items : g.items.slice(0, 3);
                                    return (
                                      <div key={g.key} className="space-y-2">
                                        <div className="flex items-center justify-between">
                                          <div className="text-[11px] uppercase tracking-wide text-neutral-400">
                                            {g.label} • {g.items.length}
                                          </div>
                                          {g.items.length > 3 ? (
                                            <button
                                              type="button"
                                              className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                              onClick={() =>
                                                setDerivativeGroupOpen((m) => ({ ...m, [key]: !isOpen }))
                                              }
                                            >
                                              {isOpen ? "Show less" : "Show all"}
                                            </button>
                                          ) : null}
                                        </div>
                                        {visible.map(renderItem)}
                                        {!isOpen && g.items.length > visible.length ? (
                                          <div className="text-[11px] text-neutral-500">
                                            Showing {visible.length} of {g.items.length}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      ) : null}

                      {/* Network visibility panel */}
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="text-xs text-neutral-300 font-medium">Monetization</div>
                        <div className="mt-2 rounded-md border border-sky-900/40 bg-sky-950/20 p-3">
                          <div className="text-xs font-medium text-sky-200">Payment / Access Proof</div>
                          <div className="mt-2 grid gap-1 text-xs text-neutral-300">
                            <div>
                              Access model: <span className="text-neutral-100">{monetizationAccessLabel}</span>
                            </div>
                            <div>
                              Payment state:{" "}
                              <span className="text-neutral-100">
                                {paidUnlockEnabled ? "Payment required before unlock" : "No payment required"}
                              </span>
                            </div>
                            {!commerceAuthorityAvailable ? (
                              <div className="text-amber-300">
                                Paid unlocks require connected provider commerce services or verified local Sovereign Node readiness.
                              </div>
                            ) : null}
                            <div>
                              Recent purchases recorded: <span className="text-neutral-100">{recentSales.length}</span>
                            </div>
                            <div>
                              Last payment receipt ID:{" "}
                              <span className="text-neutral-100 break-all">{lastSale?.id || "—"}</span>
                            </div>
                            <div>
                              Last payment method: <span className="text-neutral-100">{lastSale?.paidVia || "—"}</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-3 md:grid-cols-3">
                          <div className="md:col-span-1">
                            <label className="block text-xs text-neutral-400 mb-1" htmlFor={`priceSats-${it.id}`}>
                              Price (sats)
                            </label>
                            <input
                              id={`priceSats-${it.id}`}
                              name={`priceSats-${it.id}`}
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs outline-none focus:border-neutral-600"
                              value={priceDraft[it.id] ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, "");
                                setPriceDraft((m) => ({ ...m, [it.id]: v }));
                              }}
                              placeholder="1000"
                              inputMode="numeric"
                              autoComplete="off"
                            />
                          </div>
                          <div className="md:col-span-2 text-xs text-neutral-400 space-y-1">
                            <div>
                              {lightningAvailable && onchainAvailable
                                ? "Fans can pay with Lightning or Bitcoin."
                                : lightningAvailable
                                  ? "Fans can pay with Lightning."
                                  : onchainAvailable
                                    ? "Fans can pay with Bitcoin."
                                    : "Add a payout destination to enable tips."}
                            </div>
                            <button
                              type="button"
                              className="mt-2 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              onClick={async () => {
                                const raw = (priceDraft[it.id] || "").trim();
                                const sats = Number(raw);
                                if (!Number.isFinite(sats) || sats < 0) {
                                  setPriceMsg((m) => ({ ...m, [it.id]: "Price must be 0 or more." }));
                                  return;
                                }
                                try {
                                  setBusyAction((m) => ({ ...m, [it.id]: true }));
                                  setPriceMsg((m) => ({ ...m, [it.id]: "" }));
                                  await api(`/content/${it.id}/price`, "PATCH", { priceSats: raw });
                                  await refreshCurrentView();
                                  setPriceMsg((m) => ({
                                    ...m,
                                    [it.id]:
                                      !commerceAuthorityAvailable && sats > 0
                                        ? "Saved as suggested tip. Paid unlock activates when commerce authority is available."
                                        : "Saved."
                                  }));
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
                        <div className="text-xs text-neutral-300 font-medium">Delivery</div>
                        <div className="mt-2 grid gap-3 md:grid-cols-3">
                          <div className="md:col-span-1">
                            <label className="block text-xs text-neutral-400 mb-1" htmlFor={`deliveryMode-${it.id}`}>
                              Denotation
                            </label>
                            <select
                              id={`deliveryMode-${it.id}`}
                              name={`deliveryMode-${it.id}`}
                              className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs outline-none focus:border-neutral-600"
                              value={deliveryDraft[it.id] ?? ""}
                              onChange={(e) =>
                                setDeliveryDraft((m) => ({
                                  ...m,
                                  [it.id]: e.target.value
                                }))
                              }
                            >
                              <option value="">Auto (default)</option>
                              <option value="stream_only">Streaming only</option>
                              <option value="download_only">Download only</option>
                              <option value="stream_and_download">Stream + download</option>
                            </select>
                          </div>
                          <div className="md:col-span-2 text-xs text-neutral-400 space-y-1">
                            <div>Controls how Basic buyers access the content.</div>
                            <button
                              type="button"
                              className="mt-2 text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                              disabled={!!busyAction[it.id]}
                              onClick={async () => {
                                const raw = (deliveryDraft[it.id] || "").trim();
                                try {
                                  setBusyAction((m) => ({ ...m, [it.id]: true }));
                                  setDeliveryMsg((m) => ({ ...m, [it.id]: "" }));
                                  await api(`/content/${it.id}/delivery-mode`, "PATCH", { deliveryMode: raw || null });
                                  await refreshCurrentView();
                                  setDeliveryMsg((m) => ({ ...m, [it.id]: "Saved." }));
                                } catch (e: any) {
                                  setDeliveryMsg((m) => ({ ...m, [it.id]: e?.message || "Failed to save delivery mode." }));
                                } finally {
                                  setBusyAction((m) => ({ ...m, [it.id]: false }));
                                }
                              }}
                            >
                              Save delivery
                            </button>
                            {deliveryMsg[it.id] ? <div className="text-xs text-amber-300">{deliveryMsg[it.id]}</div> : null}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-neutral-300 font-medium">Share</div>
                        </div>
                        <div className="mt-2 text-xs text-neutral-400 space-y-2">
                          {(() => {
                            const status = String(publicStatus?.status || "offline");
                            const isStarting = status === "starting";
                            const isOn = status === "online";
                            const isError = status === "error";
                            const isOffline = status === "offline";
                            const originBase = isOn ? String(publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "") : "";
                            const publicUrl = originBase ? `${originBase.replace(/\/$/, "")}/p/${it.id}` : "";
                            return (
                              <div className="rounded-md border border-neutral-800 bg-neutral-900/30 p-3 space-y-2">
                                <div className="flex items-center gap-2 text-xs text-neutral-300 font-medium">
                                  <span>Public Link</span>
                                  <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-400">
                                    {publicStatus?.mode === "named"
                                      ? `Permanent (${publicStatus?.tunnelName || "Named"})`
                                      : publicStatus?.mode === "quick"
                                        ? "Temporary (Quick)"
                                        : "Local"}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                  <span
                                    className={`rounded-full border px-2 py-0.5 ${
                                      isOn
                                        ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
                                        : isStarting
                                          ? "border-amber-900 bg-amber-950/30 text-amber-200"
                                          : isError
                                            ? "border-red-900 bg-red-950/30 text-red-200"
                                            : "border-neutral-800 bg-neutral-950 text-neutral-400"
                                    }`}
                                  >
                                    {status === "online"
                                      ? "ONLINE"
                                      : status === "starting"
                                        ? "STARTING"
                                        : status === "error"
                                          ? "ERROR"
                                          : "OFFLINE"}
                                  </span>
                                  <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-500">
                                    DDNS disabled
                                  </span>
                                </div>

                                {isOffline ? (
                                  <>
                                    <div className="text-xs text-neutral-400">
                                      {publicStatus?.mode === "named"
                                        ? "Permanent identity link (stable hostname)."
                                        : "Temporary link (changes on restart)."}
                                    </div>
                                    {publicStatus?.message ? (
                                      <div className="text-xs text-neutral-500">{publicStatus.message}</div>
                                    ) : null}
                                    {it.status !== "published" ? (
                                      <div className="text-xs text-neutral-500">Publish to generate a public buy link.</div>
                                    ) : null}
                                    {publicStatus?.mode === "quick" ? (
                                      <div className="text-xs text-neutral-500">Link may change if you restart your computer.</div>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                      onClick={startPublicLink}
                                      disabled={publicBusy || isStarting || isOn}
                                    >
                                      Enable Public Link
                                    </button>
                                  </>
                                ) : null}

                                {isStarting ? (
                                  <>
                                    <div className="flex items-center gap-2 text-xs text-neutral-300">
                                      <span className="inline-block h-3 w-3 rounded-full border border-neutral-500 border-t-transparent animate-spin" />
                                      Starting public link…
                                    </div>
                                    <div className="text-xs text-neutral-400">Keep Certifyd Creator open.</div>
                                  </>
                                ) : null}

                                {isOn ? (
                                  <>
                                    <label className="text-xs text-neutral-400" htmlFor={`public-link-${it.id}`}>
                                      Public link
                                    </label>
                                    {it.status === "published" ? (
                                      <div className="flex items-center gap-2">
                                        <input
                                          id={`public-link-${it.id}`}
                                          name={`publicLink-${it.id}`}
                                          readOnly
                                          className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-xs text-neutral-200"
                                          value={publicUrl || "—"}
                                          autoComplete="off"
                                        />
                                        <button
                                          type="button"
                                          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                                          onClick={() => publicUrl && window.open(publicUrl, "_blank", "noopener,noreferrer")}
                                          disabled={!publicUrl}
                                        >
                                          Open
                                        </button>
                                        <button
                                          type="button"
                                          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                                          onClick={() => publicUrl && copyText(publicUrl)}
                                          disabled={!publicUrl}
                                        >
                                          Copy link
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="text-xs text-neutral-500">Publish this item to share it publicly.</div>
                                    )}
                                    <div className="text-xs text-neutral-400">
                                      {publicStatus?.mode === "named"
                                        ? "Identity link stays the same even when offline."
                                        : "This link works while Certifyd Creator is running on this device."}
                                    </div>
                                    {publicStatus?.mode === "quick" ? (
                                      <div className="text-xs text-neutral-500">Link may change if you restart your computer.</div>
                                    ) : (
                                      <div className="text-xs text-neutral-500">If offline, recipients may see a connection error.</div>
                                    )}
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                        onClick={stopPublicLink}
                                        disabled={publicBusy}
                                      >
                                        Stop sharing
                                      </button>
                                    </div>
                                  </>
                                ) : null}

                                {isError ? (
                                  <>
                                    <div className="text-xs text-neutral-300 font-medium">Public link unavailable</div>
                                    <div className="text-xs text-neutral-400">
                                      {publicMsg || publicStatus?.message || "We couldn’t start sharing from this device."}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                        onClick={startPublicLink}
                                        disabled={publicBusy || isStarting || isOn}
                                      >
                                        Try again
                                      </button>
                                      <button
                                        type="button"
                                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                        onClick={() => setPublicAdvancedOpen((v) => !v)}
                                      >
                                        View details
                                      </button>
                                    </div>
                                  </>
                                ) : null}

                                <div>
                                  <button
                                    type="button"
                                    className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                    onClick={() => setPublicAdvancedOpen((v) => !v)}
                                  >
                                    {publicAdvancedOpen ? "Hide details" : "Advanced"}
                                  </button>
                                </div>

                                {publicAdvancedOpen ? (
                                  <div className="text-[11px] text-neutral-500 space-y-1">
                                    <div>Status: <span className="text-neutral-300">{status}</span></div>
                                    <div>
                                      Last check:{" "}
                                      <span className="text-neutral-300">
                                        {publicStatus?.lastCheckedAt ? new Date(publicStatus.lastCheckedAt).toLocaleString() : "—"}
                                      </span>
                                    </div>
                                    <div>Public origin: <span className="text-neutral-300 break-all">{publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "—"}</span></div>
                                    <div>Last error: <span className="text-neutral-300 break-all">{publicStatus?.lastError || publicMsg || "—"}</span></div>
                                    <div>Consent required: <span className="text-neutral-300">{publicStatus?.consentRequired ? "yes" : "no"}</span></div>
                                    <div>cloudflared available: <span className="text-neutral-300">{publicStatus?.cloudflared?.available ? "yes" : "no"}</span></div>
                                    <div>cloudflared path: <span className="text-neutral-300 break-all">{publicStatus?.cloudflared?.managedPath || "—"}</span></div>
                                    <div>cloudflared version: <span className="text-neutral-300 break-all">{publicStatus?.cloudflared?.version || "—"}</span></div>
                                    <label className="flex items-center gap-2" htmlFor={`public-autostart-${it.id}`}>
                                      <input
                                        id={`public-autostart-${it.id}`}
                                        name={`publicAutostart-${it.id}`}
                                        type="checkbox"
                                        className="h-3 w-3"
                                        checked={Boolean(publicStatus?.autoStartEnabled)}
                                        onChange={async (e) => {
                                          try {
                                            await api("/api/public/autostart", "POST", { enabled: e.target.checked });
                                            await refreshPublicStatus();
                                          } catch {
                                            setPublicMsg("Failed to update auto-start setting.");
                                          }
                                        }}
                                      />
                                      Auto-start Public Link on launch
                                    </label>
                                    <button
                                      type="button"
                                      className="text-[11px] rounded border border-neutral-800 px-2 py-0.5 hover:bg-neutral-900"
                                      onClick={async () => {
                                        try {
                                          await api("/api/public/consent/reset", "POST");
                                          await refreshPublicStatus();
                                        } catch {
                                          setPublicMsg("Failed to reset consent.");
                                        }
                                      }}
                                    >
                                      Reset Public Link consent
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()}

                          {(() => {
                            const activeOrigin = publicStatus?.status === "online" ? String(publicStatus?.canonicalOrigin || publicStatus?.publicOrigin || "") : "";
                            const effectivePublicOrigin = (activeOrigin || publicOriginFromApi || "").trim();
                            const effectiveBuyOrigin = (activeOrigin || publicOriginFromApi || publicBuyOrigin || "").trim();
                            const buyBase = (effectiveBuyOrigin || effectivePublicOrigin || "").replace(/\/$/, "");
                            const buyLink = buyBase ? `${buyBase}/buy/${it.id}` : "";
                            const embedBase = effectivePublicOrigin.replace(/\/$/, "");
                            const canEmbed = Boolean(discoveryPublishAllowed && publicStatus?.isCanonical && embedBase);
                            const embedScript = canEmbed ? `${embedBase}/embed.js` : "";
                            const embedTag = canEmbed
                              ? `<script async src="${embedScript}"></script>\n<div data-contentbox-buy="${it.id}"></div>`
                              : "";
                            const embedIframe = canEmbed
                              ? `<iframe src="${buyLink}" style="width:100%;max-width:900px;height:720px;border:1px solid #222;border-radius:16px;"></iframe>`
                              : "";
                            const loopbackBase = "http://127.0.0.1:4000";
                            const loopbackLink = `${loopbackBase}/buy/${it.id}`;
                            const isBuyLoopback = isLoopbackUrl(buyLink);
                            const hasPublicBuy = Boolean(buyBase) && !isBuyLoopback;
                            const isLocalOnly = !hasPublicBuy;
                            let lanBase = "";
                            try {
                              const u = new URL(apiBase);
                              if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
                                lanBase = u.origin.replace(/\/$/, "");
                              }
                            } catch {}
                            const lanLink = lanBase ? `${lanBase}/buy/${it.id}` : "";
                            return (
                              <>
                                {isBasicTier ? null : (
                                  <>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-[11px] text-neutral-500">Buy links</div>
                                      <div className="flex items-center gap-2">
                                        {(["public", "config"] as const).map((tab) => {
                                          const active = (buyLinksTabByContent[it.id] || "public") === tab;
                                          return (
                                            <button
                                              key={tab}
                                              type="button"
                                              className={`text-[11px] rounded border px-2 py-0.5 ${
                                                active
                                                  ? "border-neutral-700 bg-neutral-900 text-neutral-200"
                                                  : "border-neutral-800 text-neutral-500 hover:bg-neutral-900"
                                              }`}
                                              onClick={() =>
                                                setBuyLinksTabByContent((m) => ({
                                                  ...m,
                                                  [it.id]: tab
                                                }))
                                              }
                                            >
                                              {tab === "public" ? "Hide" : "Show"}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    {(buyLinksTabByContent[it.id] || "public") === "public" ? (
                                      <>
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            {hasPublicBuy ? (
                                              <>
                                                Public buy link: <span className="text-neutral-300 break-all">{buyLink}</span>
                                              </>
                                            ) : (
                                              <span className="text-neutral-500">
                                                Public buy link not available. Set up public links in Config.
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2 shrink-0">
                                            <button
                                              type="button"
                                              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                                              onClick={() => {
                                                if (hasPublicBuy) window.open(buyLink, "_blank", "noopener,noreferrer");
                                              }}
                                              disabled={!hasPublicBuy}
                                            >
                                              Open
                                            </button>
                                            <button
                                              type="button"
                                              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-60"
                                              onClick={() => copyText(buyLink)}
                                              disabled={!hasPublicBuy}
                                            >
                                              Copy link
                                            </button>
                                          </div>
                                        </div>

                                        {shareMsg[it.id] ? <div className="text-xs text-amber-300">{shareMsg[it.id]}</div> : null}
                                      </>
                                    ) : (
                                      <>
                                        {lanBase ? (
                                          <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                              LAN buy link:{" "}
                                              <span className="text-neutral-300 break-all">{lanLink}</span>
                                              <span className="text-neutral-500"> (same Wi‑Fi)</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                              <button
                                                type="button"
                                                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                                onClick={() => window.open(lanLink, "_blank", "noopener,noreferrer")}
                                              >
                                                Open
                                              </button>
                                              <button
                                                type="button"
                                                className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                                onClick={() => copyText(lanLink)}
                                              >
                                                Copy link
                                              </button>
                                            </div>
                                          </div>
                                        ) : null}

                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            Local loopback:{" "}
                                            <span className="text-neutral-300 break-all">{loopbackLink}</span>
                                            {isLocalOnly ? <span className="text-neutral-500"> (local only)</span> : null}
                                          </div>
                                          <div className="flex items-center gap-2 shrink-0">
                                            <button
                                              type="button"
                                              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                              onClick={() => window.open(loopbackLink, "_blank", "noopener,noreferrer")}
                                            >
                                              Open
                                            </button>
                                            <button
                                              type="button"
                                              className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                              onClick={() => copyText(loopbackLink)}
                                            >
                                              Copy link
                                            </button>
                                          </div>
                                        </div>

                                        {shareMsg[it.id] ? <div className="text-xs text-amber-300">{shareMsg[it.id]}</div> : null}

                                        <div className="text-[11px] text-neutral-500">Embed</div>
                                        {canEmbed ? (
                                          <>
                                            <div className="flex items-center justify-between gap-3">
                                              <div className="min-w-0">
                                                Script embed: <span className="text-neutral-300 break-all">{embedScript}</span>
                                              </div>
                                              <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                  type="button"
                                                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                                  onClick={() => copyText(embedTag)}
                                                >
                                                  Copy snippet
                                                </button>
                                              </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                              <div className="min-w-0">
                                                iFrame embed: <span className="text-neutral-300 break-all">{buyLink}</span>
                                              </div>
                                              <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                  type="button"
                                                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                                  onClick={() => copyText(embedIframe)}
                                                >
                                                  Copy iframe
                                                </button>
                                              </div>
                                            </div>
                                          </>
                                        ) : (
                                          <div className="text-xs text-neutral-500">
                                            {lockReasons?.public_share || "Embeds require Advanced mode with public sharing."}
                                          </div>
                                        )}

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

                                        {shareP2PLink[it.id] ? (
                                          <div className="flex items-start justify-between gap-2 text-xs text-neutral-500">
                                            <div className="min-w-0 break-all">
                                              Last P2P link: <span className="text-neutral-300">{shareP2PLink[it.id]}</span>
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
                                            P2P links require a manifest. We will generate it when you copy a link.
                                          </div>
                                        ) : null}
                                      </>
                                    )}
                                  </>
                                )}
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
                        {it.status === "published" && networkPublishByContent[it.id]?.hasReceipt ? (
                          <div className="mt-3 rounded-md border border-emerald-900/50 bg-emerald-950/20 p-3">
                            <div className="text-xs font-medium text-emerald-200">Published to Certifyd Network</div>
                            <div className="mt-2 grid gap-1 text-xs text-neutral-300">
                              <div>
                                Status: <span className="text-emerald-200">Published</span>
                              </div>
                              <div>
                                Published at:{" "}
                                <span className="text-neutral-200">
                                  {formatDateLabel(networkPublishByContent[it.id]?.publishedAt || it.publishedAt)}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span>
                                  Manifest hash:{" "}
                                  <span className="text-neutral-200 break-all">
                                    {networkPublishByContent[it.id]?.manifestHash || it.manifest?.sha256 || "—"}
                                  </span>
                                </span>
                                {(networkPublishByContent[it.id]?.manifestHash || it.manifest?.sha256) ? (
                                  <button
                                    type="button"
                                    className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-900"
                                    onClick={() => copyText(networkPublishByContent[it.id]?.manifestHash || it.manifest?.sha256 || "")}
                                  >
                                    Copy
                                  </button>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span>
                                  Publish receipt ID:{" "}
                                  <span className="text-neutral-200 break-all">{networkPublishByContent[it.id]?.receiptId || "—"}</span>
                                </span>
                                {networkPublishByContent[it.id]?.receiptId ? (
                                  <button
                                    type="button"
                                    className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-900"
                                    onClick={() => copyText(networkPublishByContent[it.id]?.receiptId || "")}
                                  >
                                    Copy
                                  </button>
                                ) : null}
                              </div>
                              <div>
                                Provider node ID:{" "}
                                <span className="text-neutral-200 break-all">
                                  {networkPublishByContent[it.id]?.providerNodeId || "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          <label className="sr-only" htmlFor={`credit-name-${it.id}`}>
                            Credit name
                          </label>
                          <input
                            id={`credit-name-${it.id}`}
                            name={`creditName-${it.id}`}
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
                            placeholder="Name"
                            value={creditNameDraft[it.id] || ""}
                            onChange={(e) => setCreditNameDraft((m) => ({ ...m, [it.id]: e.target.value }))}
                            autoComplete="name"
                          />
                          <label className="sr-only" htmlFor={`credit-role-${it.id}`}>
                            Credit role
                          </label>
                          <input
                            id={`credit-role-${it.id}`}
                            name={`creditRole-${it.id}`}
                            className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm"
                            placeholder="Role (Writer, Producer, Mix, Mastering, etc.)"
                            value={creditRoleDraft[it.id] || ""}
                            onChange={(e) => setCreditRoleDraft((m) => ({ ...m, [it.id]: e.target.value }))}
                            autoComplete="off"
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

                      {/* Network visibility panel */}
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-neutral-300 font-medium">Network Visibility</div>
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
                              {visibilityLabel(storefrontStatus)}
                            </span>
                          </div>
                        </div>

                        {parentLinkByContent[it.id] && parentLinkByContent[it.id]?.requiresApproval ? (
                          <div className="mt-2 text-xs text-neutral-400">
                            Clearance for public release:{" "}
                            <span className="text-neutral-200">
                              {(() => {
                                const pl = parentLinkByContent[it.id]!;
                                const target = Number(pl.clearance?.approvalBpsTarget || 6667);
                                const approve = Number(pl.clearance?.approveWeightBps || 0);
                                const status = String(pl.clearance?.status || "").trim().toUpperCase();
                                const isCleared = Boolean(pl.approvedAt) || status === "APPROVED" || (target > 0 && approve >= target);
                                return isCleared ? "Cleared" : "Pending clearance";
                              })()}
                            </span>
                          </div>
                        ) : null}
                        {parentLinkByContent[it.id]?.requiresApproval &&
                        (() => {
                          const pl = parentLinkByContent[it.id]!;
                          const target = Number(pl.clearance?.approvalBpsTarget || 6667);
                          const approve = Number(pl.clearance?.approveWeightBps || 0);
                          const status = String(pl.clearance?.status || "").trim().toUpperCase();
                          return !(Boolean(pl.approvedAt) || status === "APPROVED" || (target > 0 && approve >= target));
                        })() ? (
                          <div className="mt-1 text-xs text-amber-300">
                            Public network release is locked until clearance. Private direct-link access still works.
                          </div>
                        ) : null}
                        <div className="mt-2 grid gap-3 md:grid-cols-3">
                          <div className="md:col-span-1">
                            <label className="block text-xs text-neutral-400 mb-1" htmlFor={`storefront-status-${it.id}`}>
                              Visibility
                            </label>
                            <select
                              id={`storefront-status-${it.id}`}
                              name={`storefrontStatus-${it.id}`}
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
                              <option value="DISABLED">Hidden</option>
                              <option value="UNLISTED">Direct Link</option>
                              <option value="LISTED">Discoverable</option>
                            </select>
                          </div>

                          <div className="md:col-span-2 text-xs text-neutral-400 space-y-1">
                            <div>Hidden: not reachable from public network routes.</div>
                            <div>Direct Link: reachable by direct link (not discoverable).</div>
                            <div>Discoverable: reachable and available for discovery surfaces.</div>
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
                          <div className="font-medium text-neutral-300 mb-1">Payment capability</div>
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
                            <div className="font-medium text-neutral-300">Network Visibility Payload</div>
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
                              {storefrontPreviewLoading[it.id] ? "Loading…" : "Preview network payload"}
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
                              ? "Enable network visibility (Direct Link or Discoverable) to test public purchase flow."
                              : it.status !== "published"
                                ? "Publish content to generate a manifest before purchase."
                                : !manifestSha256
                                  ? "Manifest missing."
                                  : "Ready to validate the public purchase flow."}
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
                            Test public purchase flow
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
                        eventFilter="content"
                      />

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openManifestId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">manifest.json</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                  onClick={async () => {
                    if (openManifest?.data) {
                      await navigator.clipboard.writeText(JSON.stringify(openManifest.data, null, 2));
                    }
                  }}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                  onClick={() => setManifestPreview(openManifestId, { open: false })}
                >
                  Close
                </button>
              </div>
            </div>
            {openManifest?.loading ? (
              <div className="mt-3 text-xs text-neutral-400">Loading manifest…</div>
            ) : openManifest?.error ? (
              <div className="mt-3 text-xs text-red-300">{openManifest.error}</div>
            ) : (
              <pre className="mt-3 max-h-[70vh] overflow-auto text-xs text-neutral-200 bg-neutral-900/30 rounded-lg p-3">
                {JSON.stringify(openManifest?.data ?? {}, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ) : null}

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
