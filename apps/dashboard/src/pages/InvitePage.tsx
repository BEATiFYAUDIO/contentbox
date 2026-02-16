import { useEffect, useState } from "react";
import { api, getApiBase } from "../lib/api";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";
import { getToken } from "../lib/auth";

function getNodePublicOrigin(): string {
  const v = String((import.meta as any).env?.VITE_NODE_PUBLIC_ORIGIN || "").trim();
  return v ? v.replace(/\/+$/, "") : window.location.origin;
}

type InvitePageProps = {
  token?: string;
  onAccepted: (contentId?: string | null) => void;
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

export default function InvitePage({ token, onAccepted }: InvitePageProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<InviteGetResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; email?: string | null } | null>(null);
  const [inviteAuditEventsList, setInviteAuditEventsList] = useState<any[]>([]);
  const [showInviteAuditEvents, setShowInviteAuditEvents] = useState(false);
  const [myInvites, setMyInvites] = useState<any[] | null>(null);
  const [receivedInvites, setReceivedInvites] = useState<any[] | null>(null);
  const [sentOpen, setSentOpen] = useState<Record<string, boolean>>({});
  const [receivedOpen, setReceivedOpen] = useState<Record<string, boolean>>({});
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

  function openPastedInvite() {
    setPasteMsg(null);
    const raw = String(pasteRaw || "").trim();
    if (!raw) {
      setPasteMsg("Paste a token or an /invite/<token> link.");
      return;
    }
    if (/^https?:\/\//i.test(raw)) {
      window.location.href = raw;
      return;
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
    window.location.href = `${base.replace(/\/$/, "")}/invite/${encodeURIComponent(t)}`;
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

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      if (!tokenToUse) {
        setData(null);
        return;
      }
      const res = await api<InviteGetResponse>(`/invites/${encodeURIComponent(tokenToUse)}`, "GET");
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
      if (tokenToUse) setMsg(e?.message || "Failed to load invite");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
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
  }, [token]);

  // Load outgoing invites for the signed-in owner (no token values are returned)
  useEffect(() => {
    if (!me) {
      setMyInvites(null);
      setReceivedInvites(null);
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
  }, [me]);

  useEffect(() => {
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
  }, [me]);

  useEffect(() => {
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
  }, [selectedContentId]);

  // manual token loader removed — invite tab (owner view) now shows only invites lists; use direct invite URL for detail view.

  async function acceptInvite() {
    setBusy(true);
    setMsg(null);
    try {
      if (!tokenToUse) throw new Error("Invite token missing");
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

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Invite</div>
        {tokenToUse ? (
          <div className="text-sm text-neutral-400 mt-1 break-all">token: {tokenToUse}</div>
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
        {me && (myInvites || receivedInvites) && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/10 p-3 space-y-4">
            <div>
              <div className="text-sm font-medium">Sent invites</div>
              <div className="text-xs text-neutral-400">Tokens are only shown at creation; this list shows sent invites with status.</div>
              {myInvites && myInvites.length === 0 && <div className="mt-2 text-xs text-neutral-500">No sent invites yet.</div>}
              {myInvites && myInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(myInvites).map((group) => {
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
                                    <div className="text-xs text-neutral-400">Created: {new Date(inv.createdAt).toLocaleString()}</div>
                                    <div className="text-xs text-neutral-400">Expires: {new Date(inv.expiresAt).toLocaleString()}</div>
                                    {inv.acceptedAt ? <div className="text-xs text-emerald-300">Redeemed: {new Date(inv.acceptedAt).toLocaleString()}</div> : null}
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
              <div className="text-xs text-neutral-400">Invites addressed to your email or account on this node.</div>
              {receivedInvites && receivedInvites.length === 0 && <div className="mt-2 text-xs text-neutral-500">No received invites yet.</div>}
              {receivedInvites && receivedInvites.length > 0 && (
                <div className="mt-2 space-y-2 text-sm text-neutral-200">
                  {groupByContent(receivedInvites).map((group) => {
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
                                      From: {inv.ownerDisplayName || inv.ownerEmail || inv.ownerUserId || "(unknown)"}
                                    </div>
                                    {inv.role ? <div className="text-xs text-neutral-400">Role: {inv.role}</div> : null}
                                    {inv.percent !== null && inv.percent !== undefined ? (
                                      <div className="text-xs text-neutral-400">Percent: {num(inv.percent)}%</div>
                                    ) : null}
                                    <div className="text-xs text-neutral-400">Created: {new Date(inv.createdAt).toLocaleString()}</div>
                                    <div className="text-xs text-neutral-400">Expires: {new Date(inv.expiresAt).toLocaleString()}</div>
                                    {inv.acceptedAt ? <div className="text-xs text-emerald-300">Redeemed: {new Date(inv.acceptedAt).toLocaleString()}</div> : null}
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
            </div>
          </div>
        )}

        {me ? (
          <div className="mt-4">
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
    </div>
  );
}
