import { useEffect, useState } from "react";
import { api, getApiBase } from "../lib/api";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";
import { getToken } from "../lib/auth";
import type { FeatureMatrix } from "../lib/identity";

function getNodePublicOrigin(): string {
  const v = String((import.meta as any).env?.VITE_NODE_PUBLIC_ORIGIN || "").trim();
  return v ? v.replace(/\/+$/, "") : window.location.origin;
}

type InvitePageProps = {
  token?: string;
  onAccepted: (contentId?: string | null) => void;
  identityLevel?: string | null;
  features?: FeatureMatrix;
  lockReasons?: Record<string, string>;
};

type InviteGetResponse = {
  ok: true;
  invitation: {
    id: string;
    expiresAt: string;
    acceptedAt: string | null;
  };
  splitParticipant: {
    id: string;
    participantEmail: string;
    role: string;
    percent: any; // Decimal may serialize as string
    payoutIdentityId: string | null;
    acceptedAt: string | null;
  };
  splitVersion: {
    id: string;
    contentId: string;
    versionNumber: number;
    status: "draft" | "locked";
    lockedAt: string | null;
    lockedFileObjectKey: string | null;
    lockedFileSha256: string | null;
    createdAt: string;
    participants: any[];
  };
  content: {
    id: string;
    title: string;
    type: "song" | "book" | "video" | "file";
    status: "draft" | "published";
    createdAt: string;
  };
};

type AcceptResponse =
  | { ok: true; acceptedAt: string | null; alreadyAccepted?: boolean }
  | { ok: boolean; [k: string]: any };

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function titleCase(s?: string | null) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function statusLabel(value?: string | null) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "—";
}

export default function InvitePage({ token, onAccepted, features, lockReasons }: InvitePageProps) {
  const canAdvancedSplits = features?.advancedSplits ?? false;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<InviteGetResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; email?: string | null } | null>(null);
  const [inviteAuditEventsList, setInviteAuditEventsList] = useState<any[]>([]);
  const [showInviteAuditEvents, setShowInviteAuditEvents] = useState(false);
  const [myInvites, setMyInvites] = useState<any[] | null>(null);
  const [receivedInvites, setReceivedInvites] = useState<any[] | null>(null);
  const [remoteReceivedInvites, setRemoteReceivedInvites] = useState<any[] | null>(null);
  const [sentOpen, setSentOpen] = useState<Record<string, boolean>>({});
  const [receivedOpen, setReceivedOpen] = useState<Record<string, boolean>>({});
  const [remoteAcceptBusy, setRemoteAcceptBusy] = useState<Record<string, boolean>>({});
  const [remoteSyncBusy, setRemoteSyncBusy] = useState<Record<string, boolean>>({});
  const [showTombstones, setShowTombstones] = useState(false);
  const [contentList, setContentList] = useState<any[]>([]);
  const [selectedContentId, setSelectedContentId] = useState<string>("");
  const [selectedSplitId, setSelectedSplitId] = useState<string | null>(null);
  const [createdInvites, setCreatedInvites] = useState<any[]>([]);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pasteRaw, setPasteRaw] = useState<string>("");
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);

  function extractInviteTokenFromPaste(raw: string): string | null {
    const v = String(raw || "").trim();
    if (!v) return null;
    const m1 = v.match(/\btoken=([^\s]+)/i);
    if (m1 && m1[1]) return m1[1];
    const m2 = v.match(/\/invite\/([^?#\s]+)/i);
    if (m2 && m2[1]) return m2[1];
    if (/^[A-Za-z0-9_-]{10,}$/.test(v)) return v;
    return null;
  }

  function getRemoteOriginFromLocation(): string | null {
    try {
      const qs = new URLSearchParams(window.location.search);
      const remote = qs.get("remote");
      if (remote) return String(remote).replace(/\/+$/, "");

      const h = window.location.hash || "";
      if (h.startsWith("#")) {
        const hash = h.slice(1);
        const m = hash.match(/remote=([^&]+)/);
        if (m && m[1]) return decodeURIComponent(m[1]).replace(/\/+$/, "");
      }
    } catch {}
    return null;
  }

  const remoteOriginFromLocation = getRemoteOriginFromLocation();

  function openPastedInvite() {
    setPasteMsg(null);
    const raw = String(pasteRaw || "").trim();
    if (!raw) {
      setPasteMsg("Paste a token or an /invite/<token> link.");
      return;
    }
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        const token = extractInviteTokenFromPaste(raw);
        if (!token) {
          setPasteMsg("Paste a valid /invite/<token> link.");
          return;
        }
        window.location.href = `/invite/${encodeURIComponent(token)}?remote=${encodeURIComponent(u.origin)}`;
        return;
      } catch {
        setPasteMsg("Paste a valid invite link.");
        return;
      }
    }
    const t = extractInviteTokenFromPaste(raw);
    if (!t) {
      setPasteMsg("Paste a token or an /invite/<token> link.");
      return;
    }
    const base = getApiBase();
    if (base.includes("127.0.0.1") || base.includes("localhost")) {
      setPasteMsg("For remote invites, paste the full invite link.");
      return;
    }
    window.location.href = `/invite/${encodeURIComponent(t)}?remote=${encodeURIComponent(base)}`;
  }

  // Determine token to use: prop first, then parse from URL path (/invite/:token) or ?token=
  const tokenFromLocation = (() => {
    try {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts[0] === "invite" && typeof parts[1] === "string") return decodeURIComponent(parts[1]);
      const qp = new URLSearchParams(window.location.search).get("token");
      if (qp) return decodeURIComponent(qp);

      // support hash routes: #/invite/<token> or #token=<token>
      const h = window.location.hash || "";
      if (h.startsWith("#")) {
        const hash = h.slice(1);
        const hp = hash.split("/").filter(Boolean);
        if (hp[0] === "invite" && typeof hp[1] === "string") return decodeURIComponent(hp[1]);
        const m = hash.match(/token=([^&]+)/);
        if (m) return decodeURIComponent(m[1]);
      }
    } catch (e) {
      // ignore
    }
    return null;
  })();

  const tokenToUse = token || tokenFromLocation || "";

  const expired = new Date(data?.invitation.expiresAt ?? "").getTime() < Date.now();
  const alreadyAccepted = Boolean(data?.invitation?.acceptedAt || data?.splitParticipant?.acceptedAt);

  async function fetchRemoteJson(path: string, opts?: { method?: string; body?: any; headers?: Record<string, string> }) {
    if (!remoteOriginFromLocation) throw new Error("Remote origin missing");
    const origin = encodeURIComponent(remoteOriginFromLocation);
    const url = `/api/remote${path}?origin=${origin}`;
    const res = await api<any>(url, opts?.method || "GET", opts?.body || undefined);
    return res;
  }

  async function fetchRemoteJsonFromOrigin(
    origin: string,
    path: string,
    opts?: { method?: string; body?: any; headers?: Record<string, string> }
  ) {
    const encoded = encodeURIComponent(origin);
    const url = `/api/remote${path}?origin=${encoded}`;
    const res = await api<any>(url, opts?.method || "GET", opts?.body || undefined);
    return res;
  }

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      if (!tokenToUse) {
        setData(null);
        return;
      }
      const res = remoteOriginFromLocation
        ? await fetchRemoteJson(`/invites/${encodeURIComponent(tokenToUse)}`)
        : await api<InviteGetResponse>(`/invites/${encodeURIComponent(tokenToUse)}`, "GET");
      setData(res);
      // If the server included related invites for this split, show them even
      // when the viewer isn't signed in (so invite pages always show sent invites).
      try {
        if (!me && (res as any)?.invites) {
          setMyInvites((res as any).invites || []);
        }
      } catch {}
      // try to load audit events for this invite (owner view)
      try {
        if (res?.invitation?.id) {
          const ev = await api<any[]>(`/invites/${encodeURIComponent(res.invitation.id)}/audit`, "GET");
          setInviteAuditEventsList(ev || []);
        } else {
          setInviteAuditEventsList([]);
        }
      } catch {
        setInviteAuditEventsList([]);
      }
    } catch (e: any) {
      setData(null);
      if (tokenToUse) {
        const base = remoteOriginFromLocation ? ` (${remoteOriginFromLocation})` : "";
        const raw = e?.message || "Failed to load invite";
        const friendly =
          raw === "Failed to fetch"
            ? `Failed to reach remote invite${base}. Make sure the tunnel is running and updated.`
            : raw;
        setMsg(friendly);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canAdvancedSplits) {
      setLoading(false);
      setData(null);
      setMsg(null);
      return;
    }
    load();
    // attempt to load current user (if signed in on this node)
    (async () => {
      try {
        const m = await api<any>(`/me`, "GET");
        setMe(m || null);
      } catch {
        setMe(null);
      }
    })();
  }, [tokenToUse, remoteOriginFromLocation, canAdvancedSplits]);

  // If this is a remote invite and the user is signed in locally, ingest it so it shows under Received invites.
  useEffect(() => {
    if (!canAdvancedSplits) return;
    if (!me || !remoteOriginFromLocation || !tokenToUse || !data) return;
    (async () => {
      try {
        await api(`/invites/ingest`, "POST", {
          remoteOrigin: remoteOriginFromLocation,
          token: tokenToUse,
          inviteUrl: `${remoteOriginFromLocation.replace(/\/+$/, "")}/invite/${encodeURIComponent(tokenToUse)}`,
          content: data?.content || null,
          splitParticipant: data?.splitParticipant || null,
          splitVersion: data?.splitVersion || null,
          acceptedAt: data?.invitation?.acceptedAt || null,
          contentDeletedAt: (data as any)?.content?.deletedAt || null,
          remoteNodeUrl: remoteOriginFromLocation
        });
        const listRemote = await api<any[]>(`/my/invitations/remote`, "GET");
        setRemoteReceivedInvites(listRemote || []);
      } catch {}
    })();
  }, [me, data, remoteOriginFromLocation, tokenToUse, canAdvancedSplits]);

  // Load outgoing invites for the signed-in owner (no token values are returned)
  useEffect(() => {
    if (!canAdvancedSplits) return;
    if (!me) {
      setMyInvites(null);
      setReceivedInvites(null);
      setRemoteReceivedInvites(null);
      setHistoryItems([]);
      return;
    }

    // helper to load both lists so we can refresh after accept/create
    async function loadLists() {
      try {
        const list = await api<any[]>(`/my/invitations`, "GET");
        setMyInvites(list || []);
      } catch {
        setMyInvites([]);
      }

      try {
        const listR = await api<any[]>(`/my/invitations/received`, "GET");
        setReceivedInvites(listR || []);
      } catch {
        setReceivedInvites([]);
      }

      try {
        const listRemote = await api<any[]>(`/my/invitations/remote`, "GET");
        setRemoteReceivedInvites(listRemote || []);
      } catch {
        setRemoteReceivedInvites([]);
      }
    }

    loadLists();
    (async () => {
      try {
        setHistoryLoading(true);
        const hist = await api<HistoryEvent[]>("/me/invite-history", "GET");
        setHistoryItems(hist || []);
      } catch {
        setHistoryItems([]);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [me, canAdvancedSplits]);

  useEffect(() => {
    if (!canAdvancedSplits) return;
    if (!me) {
      setContentList([]);
      return;
    }
    (async () => {
      try {
        const list = await api<any[]>(`/content`, "GET");
        setContentList(list || []);
      } catch {
        setContentList([]);
      }
    })();
  }, [me, canAdvancedSplits]);

  useEffect(() => {
    if (!canAdvancedSplits) return;
    if (!selectedContentId) {
      setSelectedSplitId(null);
      return;
    }
    (async () => {
      try {
        const latest = await api<any>(`/content/${selectedContentId}/splits`, "GET");
        setSelectedSplitId(latest?.id || null);
      } catch {
        setSelectedSplitId(null);
      }
    })();
  }, [selectedContentId, canAdvancedSplits]);

  // manual token loader removed — invite tab (owner view) now shows only invites lists; use direct invite URL for detail view.

  async function acceptInvite() {
    setBusy(true);
    setMsg(null);
    try {
      if (!tokenToUse) throw new Error("Invite token missing");

      if (remoteOriginFromLocation) {
        let acceptBody: any = {};
        if (me?.id) {
          try {
            const tokenLocal = getToken();
            const resSign = await fetch(`${getNodePublicOrigin()}/local/sign-acceptance`, {
              method: "POST",
              headers: { Authorization: `Bearer ${tokenLocal}`, "Content-Type": "application/json" },
              body: JSON.stringify({ token: tokenToUse })
            });
            if (resSign.ok) {
              const js = await resSign.json();
              acceptBody.payload = js.payload;
              acceptBody.signature = js.signature;
              acceptBody.remoteNodeUrl = js.payload.nodeUrl;
              acceptBody.remoteUserId = js.payload.remoteUserId;
            }
          } catch {
            // ignore signed acceptance
          }
        }

        const res = await fetchRemoteJson(`/invites/${encodeURIComponent(tokenToUse)}/accept`, {
          method: "POST",
          body: acceptBody
        });
        setMsg(res?.alreadyAccepted ? "Already accepted on remote node." : "Accepted on remote node.");
        try {
          await api(`/invites/ingest`, "POST", {
            remoteOrigin: remoteOriginFromLocation,
            token: tokenToUse,
            inviteUrl: `${remoteOriginFromLocation.replace(/\/+$/, "")}/invite/${encodeURIComponent(tokenToUse)}`,
            content: data?.content || null,
            splitParticipant: data?.splitParticipant || null,
            splitVersion: data?.splitVersion || null,
            acceptedAt: res?.acceptedAt || null,
            remoteNodeUrl: remoteOriginFromLocation
          });
        } catch {}
        await load();
        onAccepted(data?.content?.id ?? null);
        return;
      }

      // Attempt to sign locally (strong verification). If that fails, fall back to sending nodeUrl + userId.
      let acceptBody: any = {};
      if (me?.id) {
        try {
          const tokenLocal = getToken();
          const resSign = await fetch(`${getNodePublicOrigin()}/local/sign-acceptance`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenLocal}`, "Content-Type": "application/json" },
            body: JSON.stringify({ token: tokenToUse })
          });
          if (resSign.ok) {
            const js = await resSign.json();
            acceptBody.payload = js.payload;
            acceptBody.signature = js.signature;
            acceptBody.remoteNodeUrl = js.payload.nodeUrl;
            acceptBody.remoteUserId = js.payload.remoteUserId;
          } else {
            // fallback
            acceptBody.remoteNodeUrl = getNodePublicOrigin();
            acceptBody.remoteUserId = me.id;
          }
        } catch {
          acceptBody.remoteNodeUrl = getNodePublicOrigin();
          acceptBody.remoteUserId = me.id;
        }
      }

      const res = await api<AcceptResponse>(`/invites/${encodeURIComponent(tokenToUse)}/accept`, "POST", acceptBody);
      setMsg(res?.alreadyAccepted ? "Already accepted." : "Accepted.");
      await load();
      // refresh lists so owner sees accepted state and newly created invites show up
      try {
        const list = await api<any[]>(`/my/invitations`, "GET");
        setMyInvites(list || []);
      } catch {
        // ignore
      }
      try {
        const listR = await api<any[]>(`/my/invitations/received`, "GET");
        setReceivedInvites(listR || []);
      } catch {
        // ignore
      }
      onAccepted(data?.content?.id ?? null);
    } catch (e: any) {
      setMsg(e?.message || "Accept failed");
    } finally {
      setBusy(false);
    }
  }

  function inviteStatus(inv: any) {
    const exp = new Date(inv?.expiresAt || "").getTime();
    if (inv?.acceptedAt) return "accepted";
    if (Number.isFinite(exp) && exp < Date.now()) return "expired";
    return "pending";
  }

  function groupByContent(list: any[] | null) {
    const out: Record<string, { key: string; title: string; invites: any[] }> = {};
    for (const inv of list || []) {
      const title = inv.contentTitle || inv.contentId || "(unknown)";
      const key = String(inv.contentId || inv.contentTitle || "unknown");
      if (!out[key]) out[key] = { key, title, invites: [] };
      out[key].invites.push(inv);
    }
    return Object.values(out);
  }

  const visibleSentInvites = (myInvites || []).filter((inv) => (showTombstones ? true : !inv.contentDeletedAt));
  const visibleReceivedInvites = (receivedInvites || []).filter((inv) => (showTombstones ? true : !inv.contentDeletedAt));
  const visibleRemoteInvites = (remoteReceivedInvites || []).filter((inv) => (showTombstones ? true : !inv.contentDeletedAt));
  const dedupeKey = (inv: any) => {
    const id = String(inv?.contentId || "").trim();
    if (id) return id;
    return [
      String(inv?.contentTitle || "").trim(),
      String(inv?.role || "").trim(),
      String(inv?.percent ?? "").trim()
    ].join("|");
  };
  const localInviteKeys = new Set(visibleReceivedInvites.map(dedupeKey));
  const dedupedRemoteInvites = visibleRemoteInvites.filter((inv) => !localInviteKeys.has(dedupeKey(inv)));

  async function acceptRemoteInvite(inv: any) {
    const inviteUrl = String(inv?.inviteUrl || "").trim();
    const token = extractInviteTokenFromPaste(inviteUrl || inv?.token || "");
    let origin = String(inv?.remoteOrigin || "").trim();
    if (!origin && inviteUrl) {
      try {
        origin = new URL(inviteUrl).origin;
      } catch {}
    }
    if (!token || !origin) {
      setMsg("Remote invite is missing token or origin.");
      return;
    }
    setRemoteAcceptBusy((m) => ({ ...m, [inv.id]: true }));
    try {
      const res = await fetchRemoteJsonFromOrigin(origin, `/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: {} });
      await api(`/invites/ingest`, "POST", {
        remoteOrigin: origin,
        token,
        inviteUrl,
        content: res?.content || null,
        splitParticipant: res?.splitParticipant || null,
        splitVersion: res?.splitVersion || null,
        acceptedAt: res?.invitation?.acceptedAt || null,
        contentDeletedAt: res?.content?.deletedAt || null,
        remoteNodeUrl: origin
      });
      const listRemote = await api<any[]>(`/my/invitations/remote`, "GET");
      setRemoteReceivedInvites(listRemote || []);
    } catch (e: any) {
      setMsg(e?.message || "Remote accept failed");
    } finally {
      setRemoteAcceptBusy((m) => ({ ...m, [inv.id]: false }));
    }
  }

  async function syncRemoteInvite(inv: any) {
    const inviteUrl = String(inv?.inviteUrl || "").trim();
    const token = extractInviteTokenFromPaste(inviteUrl || inv?.token || "");
    let origin = String(inv?.remoteOrigin || "").trim();
    if (!origin && inviteUrl) {
      try {
        origin = new URL(inviteUrl).origin;
      } catch {}
    }
    if (!token || !origin) {
      setMsg("Remote invite is missing token or origin.");
      return;
    }
    setRemoteSyncBusy((m) => ({ ...m, [inv.id]: true }));
    try {
      const res = await fetchRemoteJsonFromOrigin(origin, `/invites/${encodeURIComponent(token)}`, { method: "GET" });
      await api(`/invites/ingest`, "POST", {
        remoteOrigin: origin,
        token,
        inviteUrl,
        content: res?.content || null,
        splitParticipant: res?.splitParticipant || null,
        splitVersion: res?.splitVersion || null,
        acceptedAt: res?.invitation?.acceptedAt || null,
        remoteNodeUrl: origin,
        contentDeletedAt: res?.content?.deletedAt || null
      });
      const listRemote = await api<any[]>(`/my/invitations/remote`, "GET");
      setRemoteReceivedInvites(listRemote || []);
    } catch (e: any) {
      setMsg(e?.message || "Remote sync failed");
    } finally {
      setRemoteSyncBusy((m) => ({ ...m, [inv.id]: false }));
    }
  }

  return (
    <div className="space-y-4">
      {!canAdvancedSplits ? (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/40 p-4 text-xs text-amber-200">
          {lockReasons?.advanced_splits || "Split invites require Advanced or LAN mode."}
        </div>
      ) : null}
      {canAdvancedSplits ? (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Invite</div>
        {tokenToUse ? (
          <div className="text-sm text-neutral-400 mt-1 break-all">token: {tokenToUse}</div>
        ) : null}
        {remoteOriginFromLocation ? (
          <div className="text-xs text-neutral-400 mt-1">Remote invite: {remoteOriginFromLocation}</div>
        ) : null}
        {remoteOriginFromLocation && tokenToUse ? (
          <div className="mt-2">
            <a
              href={`${remoteOriginFromLocation.replace(/\/+$/, "")}/invite/${encodeURIComponent(tokenToUse)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-400 underline"
            >
              Open remote invite page
            </a>
          </div>
        ) : null}

        {me && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/10 p-3">
            <div className="text-sm font-medium">Create invites</div>
            <div className="text-xs text-neutral-400">Select a content item to generate invite URLs for its latest split.</div>
            <div className="text-[11px] text-neutral-500 mt-1">
              Invite links use a neutral shared host when configured (recommended for scale).
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                value={selectedContentId}
                onChange={(e) => {
                  setSelectedContentId(e.target.value);
                  setCreatedInvites([]);
                  setCreateMsg(null);
                }}
                className="text-sm rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
              >
                <option value="">Select content…</option>
                {contentList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>

              <button
                disabled={!selectedSplitId}
                onClick={async () => {
                  if (!selectedSplitId) return;
                  setCreateMsg(null);
                  try {
                    const res = await api<{ ok: true; created: number; invites: any[] }>(`/split-versions/${selectedSplitId}/invite`, "POST", {});
                    setCreatedInvites(res.invites || []);
                    setCreateMsg(`Created ${res.created} invite(s)`);
                  } catch (e: any) {
                    setCreateMsg(e?.message || "Create invites failed");
                  }
                }}
                className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
              >
                Create invites
              </button>
            </div>

            {createMsg ? <div className="mt-2 text-xs text-neutral-300">{createMsg}</div> : null}

            {createdInvites.length > 0 && (
              <div className="mt-3 space-y-2">
                {createdInvites.map((inv) => (
                  <div key={inv.splitParticipantId} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-neutral-400">
                        {inv.acceptedAt ? "Accepted" : "Pending"}
                      </div>
                      {!inv.acceptedAt ? (
                        <div className="text-xs text-neutral-200 break-all">{inv.inviteUrl}</div>
                      ) : null}
                      <div className="text-[11px] text-neutral-400">
                        To: {inv.participantEmail || "(unknown)"}
                      </div>
                    </div>
                    {!inv.acceptedAt ? (
                      <button
                        onClick={() => navigator.clipboard.writeText(inv.inviteUrl)}
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Copy
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-neutral-800 pt-3">
              <div className="text-xs text-neutral-400">Paste invite link or token</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={pasteRaw}
                  onChange={(e) => setPasteRaw(e.target.value)}
                  placeholder="https://invites.contentbox.link/invite/<token> or token"
                  className="text-sm rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 w-full md:w-[420px]"
                />
                <button
                  onClick={openPastedInvite}
                  className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900"
                >
                  Open
                </button>
              </div>
              {pasteMsg ? <div className="mt-2 text-xs text-amber-300">{pasteMsg}</div> : null}
            </div>
          </div>
        )}

        {/* If signed in, show invite history (tokens are shown only at creation time). */}
        {me && (myInvites || receivedInvites || remoteReceivedInvites) && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/10 p-3 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-neutral-400">Invite lists</div>
              <button
                type="button"
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                onClick={() => setShowTombstones((s) => !s)}
              >
                {showTombstones ? "Hide tombstones" : "Show tombstones"}
              </button>
            </div>
            <div>
              <div className="text-sm font-medium">Sent invites</div>
              <div className="text-xs text-neutral-400">Tokens are only shown at creation; this list shows sent invites with status.</div>
              {visibleSentInvites.length === 0 && <div className="mt-2 text-xs text-neutral-500">No sent invites yet.</div>}
              {visibleSentInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(visibleSentInvites).map((group) => {
                    const open = sentOpen[group.key] ?? true;
                    return (
                      <div key={group.key} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">{group.title}</div>
                          <button
                            onClick={() => setSentOpen((m) => ({ ...m, [group.key]: !open }))}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        </div>
                        {open && (
                          <div className="mt-2 space-y-2">
                            {group.invites.map((inv) => {
                              const status = inviteStatus(inv);
                              const pending = status === "pending";
                              return (
                                <div key={inv.id} className="flex items-center justify-between gap-2">
                                  <div className="break-all">
                                    <div className="text-xs text-neutral-400">To: {inv.participantEmail || "(unknown)"}</div>
                                    <div className="text-xs text-neutral-400">Created: {formatDate(inv.createdAt)}</div>
                                    <div className="text-xs text-neutral-400">Expires: {formatDate(inv.expiresAt)}</div>
                                    {inv.contentDeletedAt ? (
                                      <div className="text-[11px] text-amber-300">Tombstoned</div>
                                    ) : null}
                                    {inv.acceptedAt ? <div className="text-xs text-emerald-300">Redeemed: {formatDate(inv.acceptedAt)}</div> : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs uppercase tracking-wide text-neutral-400">{status}</div>
                                    {pending ? (
                                      <button
                                        onClick={async () => {
                                          try {
                                            await api(`/invites/${encodeURIComponent(inv.id)}`, "DELETE");
                                            setMyInvites((list) => (list || []).filter((x) => x.id !== inv.id));
                                          } catch (e: any) {
                                            setMsg(e?.message || "Delete failed");
                                          }
                                        }}
                                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium">Received invites</div>
              <div className="text-xs text-neutral-400">Invites addressed to your account, including remote nodes.</div>
              {visibleReceivedInvites.length === 0 && visibleRemoteInvites.length === 0 ? (
                <div className="mt-2 text-xs text-neutral-500">No received invites yet.</div>
              ) : null}
              {visibleReceivedInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(visibleReceivedInvites).map((group) => {
                    const open = receivedOpen[group.key] ?? true;
                    return (
                      <div key={group.key} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">{group.title}</div>
                          <button
                            onClick={() => setReceivedOpen((m) => ({ ...m, [group.key]: !open }))}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        </div>
                        {open && (
                          <div className="mt-2 space-y-2">
                            {group.invites.map((inv) => {
                              const status = inviteStatus(inv);
                              return (
                                <div key={inv.id} className="flex items-center justify-between gap-2">
                                  <div className="break-all">
                                    <div className="text-xs text-neutral-400">
                                      {titleCase(inv.contentType)} • {statusLabel(inv.contentStatus)} • v{inv.splitVersionNum ?? "—"} • {statusLabel(inv.splitStatus)}
                                    </div>
                                    {inv.role ? <div className="text-xs text-neutral-400">Role: {inv.role}</div> : null}
                                    {inv.percent !== null && inv.percent !== undefined ? (
                                      <div className="text-xs text-neutral-400">Percent: {num(inv.percent)}%</div>
                                    ) : null}
                                    <div className="text-xs text-neutral-400">Created: {formatDate(inv.createdAt)}</div>
                                    <div className="text-xs text-neutral-400">Expires: {formatDate(inv.expiresAt)}</div>
                                    {inv.contentDeletedAt ? <div className="text-[11px] text-amber-300">Tombstoned</div> : null}
                                    {inv.acceptedAt ? <div className="text-xs text-emerald-300">Redeemed: {formatDate(inv.acceptedAt)}</div> : null}
                                  </div>
                                  <div className="text-xs uppercase tracking-wide text-neutral-400">{status}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {dedupedRemoteInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(dedupedRemoteInvites).map((group) => {
                    const open = receivedOpen[group.key] ?? true;
                    return (
                      <div key={group.key} className="rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">{group.title}</div>
                          <button
                            onClick={() => setReceivedOpen((m) => ({ ...m, [group.key]: !open }))}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                          >
                            {open ? "Hide" : "Show"}
                          </button>
                        </div>
                        {open && (
                          <div className="mt-2 space-y-2">
                            {group.invites.map((inv) => {
                              const accepted = Boolean(inv.acceptedAt);
                              return (
                                <div key={inv.id} className="flex items-center justify-between gap-2">
                                  <div className="break-all">
                                    <div className="text-xs text-neutral-400">
                                      {titleCase(inv.contentType)} • {statusLabel(inv.contentStatus)} • v{inv.splitVersionNum ?? "—"} • {statusLabel(inv.splitStatus)}
                                    </div>
                                    <div className="text-xs text-neutral-400">From: Remote node</div>
                                    {inv.role ? <div className="text-xs text-neutral-400">Role: {inv.role}</div> : null}
                                    {inv.percent !== null && inv.percent !== undefined ? (
                                      <div className="text-xs text-neutral-400">Percent: {num(inv.percent)}%</div>
                                    ) : null}
                                    <div className="text-xs text-neutral-400">Created: {formatDate(inv.createdAt)}</div>
                                    <div className="text-xs text-neutral-400">Expires: {formatDate(inv.expiresAt)}</div>
                                    {inv.contentDeletedAt ? <div className="text-[11px] text-amber-300">Tombstoned</div> : null}
                                    {inv.remoteOrigin ? <div className="text-[10px] text-neutral-500">Remote: {inv.remoteOrigin}</div> : null}
                                    {accepted ? <div className="text-xs text-emerald-300">Redeemed: {formatDate(inv.acceptedAt)}</div> : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => syncRemoteInvite(inv)}
                                      className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                                      disabled={remoteSyncBusy[inv.id]}
                                    >
                                      {remoteSyncBusy[inv.id] ? "Syncing…" : "Sync"}
                                    </button>
                                    {!accepted ? (
                                      <button
                                        onClick={() => acceptRemoteInvite(inv)}
                                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                                        disabled={remoteAcceptBusy[inv.id]}
                                      >
                                        {remoteAcceptBusy[inv.id] ? "Accepting…" : "Accept"}
                                      </button>
                                    ) : null}
                                    <div className="text-xs uppercase tracking-wide text-neutral-400">
                                      {accepted ? "accepted" : "pending"}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {me ? (
          <div className="mt-4">
            {remoteReceivedInvites && remoteReceivedInvites.length > 0 ? (
              <div className="mb-2 text-xs text-neutral-500">
                Remote invites do not include local history or audit events.
              </div>
            ) : null}
            <HistoryFeed
              title="Invites history"
              items={historyItems}
              loading={historyLoading}
              emptyText="No invite history yet."
              exportName="invite-history.json"
              onRefresh={async () => {
                setHistoryLoading(true);
                try {
                  const hist = await api<HistoryEvent[]>("/me/invite-history", "GET");
                  setHistoryItems(hist || []);
                } catch {
                  setHistoryItems([]);
                } finally {
                  setHistoryLoading(false);
                }
              }}
            />
            <div className="mt-2">
              <AuditPanel
                scopeType="invite"
                title="Audit"
                exportName="invite-audit.json"
              />
            </div>
          </div>
        ) : null}

        {loading && <div className="mt-4 text-sm text-neutral-300">Loading invite…</div>}

        {!loading && data && tokenToUse && (
          <>
            {/* Audit events for this invite */}
            <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/10 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Invite audit history</div>
                  <div className="text-xs text-neutral-400">Creation, acceptance, and expiry for this invite</div>
                </div>
                <button
                  onClick={() => setShowInviteAuditEvents((s) => !s)}
                  className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  {showInviteAuditEvents ? "Hide" : "Show"}
                </button>
              </div>

              {showInviteAuditEvents && (
                <div className="mt-3 space-y-3 text-sm text-neutral-200">
                  {inviteAuditEventsList.length === 0 ? (
                    <div className="text-xs text-neutral-500">No audit events yet.</div>
                  ) : (
                    inviteAuditEventsList.map((e) => (
                      <div key={e.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                        <div className="text-xs text-neutral-400">
                          {e.action} • {new Date(e.createdAt).toLocaleString()}
                          {e.user?.email ? ` • ${e.user.email}` : e.userId ? ` • ${e.userId}` : ""}
                        </div>
                        <pre className="mt-2 text-xs text-neutral-300 whitespace-pre-wrap">{JSON.stringify(e.payloadJson || e.payload || {}, null, 2)}</pre>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 space-y-2">
            <div className="text-sm text-neutral-300">
              Content: <span className="text-neutral-100">{data.content.title}</span>
            </div>

            <div className="text-sm text-neutral-400">
              Split version: <span className="text-neutral-200">v{data.splitVersion.versionNumber}</span> • <span className="text-neutral-200">{data.splitVersion.status}</span>
            </div>

            <div className="text-sm text-neutral-400">
              You are invited as: <span className="text-neutral-200">{data.splitParticipant.participantEmail}</span>
            </div>

            <div className="text-sm text-neutral-400">
              Role: <span className="text-neutral-200">{data.splitParticipant.role}</span> • Percent: <span className="text-neutral-200">{num(data.splitParticipant.percent)}%</span>
            </div>

            <div className="text-xs text-neutral-500">
              Expires: {new Date(data.invitation.expiresAt).toLocaleString()}
              {expired ? <span className="ml-2 text-red-300">expired</span> : null}
              {alreadyAccepted ? <span className="ml-2 text-green-300">accepted</span> : null}
            </div>

            <div className="pt-2">
              <button
                disabled={busy || expired || alreadyAccepted}
                onClick={acceptInvite}
                className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
              >
                Accept invite
              </button>
            </div>
          </div>
        </>
        )}

        {msg && <div className="mt-4 text-sm text-neutral-300">{msg}</div>}
      </div>
      ) : null}
    </div>
  );
}
