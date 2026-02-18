import React from "react";
import { api } from "../lib/api";
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

function extractInviteToken(raw: string): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  const m1 = v.match(/\btoken=([^\s]+)/i);
  if (m1 && m1[1]) return m1[1];
  const m2 = v.match(/\/invite\/([^?#\s]+)/i);
  if (m2 && m2[1]) return m2[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(v)) return v;
  return null;
}

async function fetchRemoteJsonFromOrigin(
  origin: string,
  path: string,
  opts?: { method?: string; body?: any }
) {
  const encoded = encodeURIComponent(origin);
  const url = `/api/remote${path}?origin=${encoded}`;
  return api<any>(url, opts?.method || "GET", opts?.body || undefined);
}

function formatDateLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function SplitsPage(props: { onEditContent?: (id: string) => void; identityLevel?: string | null }) {
  const { onEditContent, identityLevel } = props;
  const isBasicIdentity = String(identityLevel || "").toUpperCase() === "BASIC";

  const [contentList, setContentList] = React.useState<ContentItem[]>([]);
  const [splitSummaryByContent, setSplitSummaryByContent] = React.useState<Record<string, SplitVersion | null>>({});
  const [showTombstones, setShowTombstones] = React.useState(false);
  const [receivedInvites, setReceivedInvites] = React.useState<any[]>([]);
  const [remoteInvites, setRemoteInvites] = React.useState<any[]>([]);
  const [remoteAcceptBusy, setRemoteAcceptBusy] = React.useState<Record<string, boolean>>({});
  const [remoteSyncBusy, setRemoteSyncBusy] = React.useState<Record<string, boolean>>({});
  const [msg, setMsg] = React.useState<string | null>(null);

  async function loadContentList() {
    const list = await api<ContentItem[]>("/content?scope=mine", "GET");
    setContentList(list);
  }

  async function loadRemoteInvites() {
    try {
      const list = await api<any[]>(`/my/invitations/remote`, "GET");
      setRemoteInvites(Array.isArray(list) ? list : []);
    } catch {
      setRemoteInvites([]);
    }
  }

  async function acceptRemoteInvite(inv: any) {
    const inviteUrl = String(inv?.inviteUrl || "").trim();
    const token = extractInviteToken(inviteUrl || inv?.token || "");
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
      await loadRemoteInvites();
    } catch (e: any) {
      setMsg(e?.message || "Remote accept failed");
    } finally {
      setRemoteAcceptBusy((m) => ({ ...m, [inv.id]: false }));
    }
  }

  async function syncRemoteInvite(inv: any) {
    const inviteUrl = String(inv?.inviteUrl || "").trim();
    const token = extractInviteToken(inviteUrl || inv?.token || "");
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
        contentDeletedAt: res?.content?.deletedAt || null,
        remoteNodeUrl: origin
      });
      await loadRemoteInvites();
    } catch (e: any) {
      setMsg(e?.message || "Remote sync failed");
    } finally {
      setRemoteSyncBusy((m) => ({ ...m, [inv.id]: false }));
    }
  }

  async function loadReceivedInvites() {
    try {
      const list = await api<any[]>(`/my/invitations/received`, "GET");
      setReceivedInvites(Array.isArray(list) ? list : []);
    } catch {
      setReceivedInvites([]);
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
    if (isBasicIdentity) {
      setContentList([]);
      setSplitSummaryByContent({});
      setRemoteInvites([]);
      setReceivedInvites([]);
      return;
    }
    loadContentList().catch(() => {});
    loadRemoteInvites().catch(() => {});
    loadReceivedInvites().catch(() => {});
  }, [isBasicIdentity]);

  React.useEffect(() => {
    if (isBasicIdentity) return;
    if (!contentList.length) return;
    for (const c of contentList) {
      if (splitSummaryByContent[c.id] === undefined) {
        loadSplitSummary(c.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentList, isBasicIdentity]);

  return (
    <div className="space-y-4">
      {isBasicIdentity ? (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/40 p-4 text-xs text-amber-200">
          Splits require a persistent identity (named tunnel).
        </div>
      ) : null}
      {!isBasicIdentity ? (
      <>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Splits</div>
            <div className="text-sm text-neutral-400 mt-1">Pick a content item to edit its split versions.</div>
          </div>
          <button
            onClick={() => setShowTombstones((s) => !s)}
            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
          >
            {showTombstones ? "Hide tombstones" : "Show tombstones"}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {contentList
            .filter((c) => (showTombstones ? true : !c.deletedAt))
            .map((c) => {
            const summary = splitSummaryByContent[c.id];
            const updatedAt = summary?.lockedAt || summary?.createdAt || c.createdAt;
            return (
              <div key={c.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.title}</div>
                    <div className="text-xs text-neutral-400">
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

          {contentList.length === 0 && (
            <div className="text-sm text-neutral-400">No content yet. Create a song/book/video first.</div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Received invites</div>
            <div className="text-sm text-neutral-400 mt-1">Invites addressed to your account, including remote nodes.</div>
          </div>
          <button
            onClick={() => setShowTombstones((s) => !s)}
            className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
          >
            {showTombstones ? "Hide tombstones" : "Show tombstones"}
          </button>
        </div>
        {msg ? <div className="mt-2 text-xs text-amber-300">{msg}</div> : null}
        <div className="mt-4 space-y-2">
          {[...receivedInvites, ...remoteInvites]
            .filter((inv) => (showTombstones ? true : !inv.contentDeletedAt))
            .map((inv) => {
              const isRemote = Boolean(inv.remoteOrigin);
              const accepted = Boolean(inv.acceptedAt);
              return (
                <div key={inv.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{inv.contentTitle || inv.contentId || "Remote content"}</div>
                      <div className="text-xs text-neutral-400">
                        {titleCase(inv.contentType)} • {inv.role ? `${inv.role}` : "role —"} • {inv.percent != null ? `${inv.percent}%` : "percent —"}
                        {inv.contentDeletedAt ? " • tombstoned" : ""}
                      </div>
                      {isRemote ? <div className="text-[11px] text-neutral-500 break-all">Remote: {inv.remoteOrigin}</div> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {isRemote ? (
                        <button
                          onClick={() => syncRemoteInvite(inv)}
                          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                          disabled={remoteSyncBusy[inv.id]}
                        >
                          {remoteSyncBusy[inv.id] ? "Syncing…" : "Sync"}
                        </button>
                      ) : null}
                      {isRemote && !accepted ? (
                        <button
                          onClick={() => acceptRemoteInvite(inv)}
                          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                          disabled={remoteAcceptBusy[inv.id]}
                        >
                          {remoteAcceptBusy[inv.id] ? "Accepting…" : "Accept"}
                        </button>
                      ) : null}
                      <div className="text-xs uppercase tracking-wide text-neutral-400">{accepted ? "accepted" : "pending"}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          {[...receivedInvites, ...remoteInvites].length === 0 ? (
            <div className="text-sm text-neutral-400">No received invites yet.</div>
          ) : null}
        </div>
      </div>

      {remoteInvites.length > 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">Remote splits (read-only)</div>
              <div className="text-sm text-neutral-400 mt-1">Accepted invites from other nodes.</div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {remoteInvites
              .filter((inv) => (showTombstones ? true : !inv.contentDeletedAt))
              .filter((inv) => inv.acceptedAt)
              .map((inv) => (
                <div key={inv.id} className="rounded-lg border border-neutral-800 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{inv.contentTitle || inv.contentId || "Remote content"}</div>
                      <div className="text-xs text-neutral-400">
                        {titleCase(inv.contentType)} • {inv.role ? `${inv.role}` : "role —"} • {inv.percent != null ? `${inv.percent}%` : "percent —"}
                        {inv.contentDeletedAt ? " • tombstoned" : ""}
                      </div>
                      {inv.remoteOrigin ? (
                        <div className="text-[11px] text-neutral-500 break-all">Remote: {inv.remoteOrigin}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {inv.inviteUrl ? (
                        <button
                          onClick={() => window.open(inv.inviteUrl, "_blank", "noopener,noreferrer")}
                          className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        >
                          View invite
                        </button>
                      ) : null}
                      <div className="text-[11px] text-neutral-500 uppercase tracking-wide">read-only</div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      <AuditPanel scopeType="split" title="Audit" exportName="split-audit.json" />
      </>
      ) : null}
    </div>
  );
}
