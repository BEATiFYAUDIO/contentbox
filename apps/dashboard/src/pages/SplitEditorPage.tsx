import React from "react";
import { api } from "../lib/api";
import HistoryFeed, { type HistoryEvent } from "../components/HistoryFeed";
import AuditPanel from "../components/AuditPanel";

type ContentItem = {
  id: string;
  title: string;
  type: "song" | "book" | "video" | "file" | "remix" | "mashup" | "derivative";
  status: "draft" | "published";
  createdAt: string;
  priceSats?: string | null;
  canEdit?: boolean;
};

type SplitParticipant = {
  id: string;
  participantEmail: string;
  role: string;
  percent: any; // Decimal may serialize as string
  createdAt: string;
  payoutIdentityId?: string | null;
  acceptedAt?: string | null;
};

type SplitVersion = {
  id: string;
  contentId: string;
  versionNumber: number;
  status: "draft" | "locked";
  lockedAt?: string | null;
  createdAt: string;
  participants: SplitParticipant[];

  // proof fields (present on model; may be null until locked)
  lockedFileObjectKey?: string | null;
  lockedFileSha256?: string | null;

  // optional if you enrich server response
  lockedFileOriginalName?: string | null;
};

type Row = { id?: string | null; participantEmail: string; role: string; percent: string };

type ProofData = {
  proofHash: string;
  manifestHash: string;
  splitsHash: string;
  payload: any;
  signatures?: any[];
};

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function percentToString(v: any): string {
  if (v === null || v === undefined) return "0";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  try {
    if (typeof v?.toString === "function") {
      const s = v.toString();
      if (s && s !== "[object Object]") return s;
    }
    if (typeof v?.toNumber === "function") {
      const n = v.toNumber();
      if (Number.isFinite(n)) return String(n);
    }
    if (typeof v?.value === "string" || typeof v?.value === "number") {
      return String(v.value);
    }
  } catch {}
  return String(v);
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function normEmail(s: string) {
  return (s || "").trim().toLowerCase();
}

function shortHash(h?: string | null) {
  const s = (h || "").trim();
  if (!s) return "";
  if (s.length <= 18) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function titleCase(s?: string | null) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}


async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function downloadJson(filename: string, data: any) {
  try {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

export default function SplitEditorPage(props: { contentId: string | null; onGoToPayouts?: () => void }) {
  const { contentId, onGoToPayouts } = props;

  const [content, setContent] = React.useState<ContentItem | null>(null);
  const [versions, setVersions] = React.useState<SplitVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = React.useState<string | null>(null);
  const [upstreamInfo, setUpstreamInfo] = React.useState<{
    linkId: string;
    relation: string;
    upstreamBps: number;
    requiresApproval: boolean;
    approvedAt?: string | null;
    parent: { id: string; title: string } | null;
    canRequestApproval?: boolean;
    canVote?: boolean;
  } | null>(null);
  const [upstreamError, setUpstreamError] = React.useState<string | null>(null);
  const [upstreamMultiParent, setUpstreamMultiParent] = 
React.useState(false);

  const [auditEventsList, setAuditEventsList] = React.useState<any[]>([]);
  const [showAuditEvents, setShowAuditEvents] = React.useState(false);
  void auditEventsList;
  void showAuditEvents;
  void setShowAuditEvents;
    const [showLinkModal, setShowLinkModal] = React.useState(false);
  const [linkParentId, setLinkParentId] = React.useState("");
  const [linkRelation, setLinkRelation] = React.useState("derivative");
  const [linkSaving, setLinkSaving] = React.useState(false);
  const [linkCandidates, setLinkCandidates] = React.useState<Array<{ id: string; title: string }>>([]);
  const [upstreamVotePct, setUpstreamVotePct] = React.useState("10");

  const selectedVersion = React.useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );

  const latest = versions[0] || null;
  const latestIsEditable = latest?.status === "draft";

  const [rows, setRows] = React.useState<Row[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [auditByParticipant, setAuditByParticipant] = React.useState<Record<string, { remoteVerified: boolean; remoteNodeUrl?: string | null; remoteUserId?: string | null }>>({});
  const [historyItems, setHistoryItems] = React.useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [proofByVersionId, setProofByVersionId] = React.useState<Record<string, ProofData | null>>({});
  const [proofLoadingId, setProofLoadingId] = React.useState<string | null>(null);
  const [proofView, setProofView] = React.useState<ProofData | null>(null);
  const [proofError, setProofError] = React.useState<string | null>(null);
  const [payUnits, setPayUnits] = React.useState("2");
  const [purchase, setPurchase] = React.useState<{ id: string; bolt11: string; status: "unpaid" | "paid" | "expired"; receiptId?: string | null } | null>(null);
  const [payMsg, setPayMsg] = React.useState<string | null>(null);
  const [paymentsReadiness, setPaymentsReadiness] = React.useState<{ lightning: { ready: boolean; reason?: string | null } } | null>(null);

  const total = round3(rows.reduce((s, r) => s + num(r.percent), 0));
  const totalOk = total === 100;
  const readinessLoaded = paymentsReadiness !== null;
  const lightningReady = paymentsReadiness?.lightning?.ready ?? true;
  const lightningReason = paymentsReadiness?.lightning?.reason ?? "UNKNOWN";
  const lightningBlocked = readinessLoaded && !lightningReady;

  async function loadAll(id: string) {
    setMsg(null);

    const [c, v] = await Promise.all([
      api<ContentItem>(`/content/${id}`, "GET"),
      api<SplitVersion[]>(`/content/${id}/split-versions`, "GET")
    ]);

    setContent(c);
    setVersions(v);

    const pick = v[0]?.id || null;
    setSelectedVersionId(pick);

    const base = v[0] || null;
    const participants = base?.participants || [];

    setRows(
      participants.length
        ? participants.map((p) => ({
            id: p.id,
            participantEmail: p.participantEmail,
            role: p.role,
            percent: percentToString(p.percent)
          }))
        : [{ participantEmail: "", role: "writer", percent: "100" }]
    );

    try {
      const latestId = v[0]?.id;
      if (latestId) {
        const events = await api<any>(`/split-versions/${latestId}/audit`, "GET");
        setAuditEventsList(events || []);
        const map: Record<string, any> = {};
        for (const ev of events || []) {
          if (ev.action === "invite.accept" && ev.payload && ev.payload.splitParticipantId) {
            map[ev.payload.splitParticipantId] = {
              remoteVerified: Boolean(ev.payload.remoteVerified),
              remoteNodeUrl: ev.payload.remoteNodeUrl || null,
              remoteUserId: ev.payload.remoteUserId || null
            };
          }
        }
        setAuditByParticipant(map);
      }
    } catch {
      setAuditByParticipant({});
    }

    try {
      setHistoryLoading(true);
      const hist = await api<HistoryEvent[]>(`/content/${id}/split-history`, "GET");
      setHistoryItems(hist || []);
    } catch {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  React.useEffect(() => {
    api<{ lightning: { ready: boolean; reason?: string | null } }>("/api/payments/readiness", "GET")
      .then((r) => setPaymentsReadiness(r))
      .catch(() => setPaymentsReadiness(null));
  }, []);

  React.useEffect(() => {
    if (!contentId) {
      setContent(null);
      setVersions([]);
      setSelectedVersionId(null);
      setRows([]);
      setProofByVersionId({});
      setPurchase(null);
      setPayMsg(null);
      setUpstreamInfo(null);
      return;
    }

    loadAll(contentId).catch((e: any) => setMsg(e?.message || "Failed to load splits"));
    api(`/content/${contentId}/parent-link`, "GET")
      .then((r: any) => {
        if (r?.parentLink === null) {
          setUpstreamInfo(null);
          setUpstreamError(null);
          setUpstreamMultiParent(false);
          return;
        }
        setUpstreamInfo(r);
        setUpstreamError(null);
        setUpstreamMultiParent(false);
      })
      .catch((e: any) => {
        // Fallback to minimal parentLink from /content/:id if available
        const fallback = (content as any)?.parentLink || null;
        if (fallback) {
          setUpstreamInfo({
            linkId: fallback.linkId,
            relation: fallback.relation,
            upstreamBps: fallback.upstreamBps,
            requiresApproval: fallback.requiresApproval,
            approvedAt: fallback.approvedAt,
            parent: fallback.parentContentId ? { id: fallback.parentContentId, title: "Original work" } : null
          } as any);
          setUpstreamError("Lineage details limited (clearance info unavailable).");
          setUpstreamMultiParent(false);
          return;
        }
        setUpstreamInfo(null);
        setUpstreamError(e?.message || "Failed to load parent link.");
        setUpstreamMultiParent(Boolean(e?.message && /multiple parent/i.test(e.message)));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  React.useEffect(() => {
    if (!contentId || !selectedVersion) return;
    if (selectedVersion.status !== "locked") return;
    if (Object.prototype.hasOwnProperty.call(proofByVersionId, selectedVersion.id)) return;

    (async () => {
      setProofError(null);
      setProofLoadingId(selectedVersion.id);
      try {
        const proof = await api<ProofData>(`/content/${contentId}/splits/v${selectedVersion.versionNumber}/proof`, "GET");
        setProofByVersionId((m) => ({ ...m, [selectedVersion.id]: proof }));
      } catch (e: any) {
        setProofError(e?.message || "Failed to load proof");
        setProofByVersionId((m) => ({ ...m, [selectedVersion.id]: null }));
      } finally {
        setProofLoadingId((id) => (id === selectedVersion.id ? null : id));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, selectedVersionId]);

  React.useEffect(() => {
    if (!purchase || purchase.status !== "unpaid") return;
    if (!contentId || !selectedVersion) return;

    const id = purchase.id;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await api<{ status: "unpaid" | "paid" | "expired"; paidAt?: string | null }>(`/v1/payments/status/${id}`, "GET");
        if (cancelled) return;
        if (res.status === "paid") {
          setPurchase((p) => (p && p.id === id ? { ...p, status: "paid" } : p));
          try {
            const receiptRes = await api<{ receiptId: string }>(`/v1/payments/receipt/${id}`, "GET");
            if (!cancelled) setPurchase((p) => (p && p.id === id ? { ...p, receiptId: receiptRes.receiptId } : p));
          } catch {}
          clearInterval(interval);
        } else if (res.status === "expired") {
          setPurchase((p) => (p && p.id === id ? { ...p, status: "expired" } : p));
          clearInterval(interval);
        }
      } catch (e: any) {
        if (!cancelled) setPayMsg(e?.message || "Payment status failed");
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [purchase?.id, purchase?.status, contentId, selectedVersionId]);

  React.useEffect(() => {
    if (!selectedVersion) return;

    const participants = selectedVersion.participants || [];
    setRows(
      participants.length
        ? participants.map((p) => ({
            participantEmail: p.participantEmail,
            role: p.role,
            percent: percentToString(p.percent)
          }))
        : [{ participantEmail: "", role: "writer", percent: "100" }]
    );
    setPurchase(null);
    setPayMsg(null);
  }, [selectedVersionId]);

  async function saveLatest() {
    if (!contentId) return;
    if (!latest || latest.status !== "draft") {
      setMsg("Latest split is locked. Create a new version to edit.");
      return;
    }

    const raw = rows
      .map((r) => ({
        participantEmail: normEmail(r.participantEmail),
        role: (r.role || "").trim(),
        percent: Number(String(r.percent ?? "").trim())
      }))
      .filter((p) => p.participantEmail && p.role);

    if (raw.length === 0) {
      setMsg("Add at least one participant.");
      return;
    }

    const deduped = Array.from(new Map(raw.map((p) => [p.participantEmail, p])).values());

    const t = round3(deduped.reduce((s, p) => s + num(p.percent), 0));
    if (t !== 100) {
      setMsg(`Total must be 100. Current total=${t}`);
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      await api(`/content/${contentId}/splits`, "POST", { participants: deduped });
      await loadAll(contentId);
      setMsg("Saved.");
    } catch (e: any) {
      setMsg(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function lockLatest() {
    if (!contentId) return;
    if (!latest) return;

    setBusy(true);
    setMsg(null);
    try {
      await api(`/content/${contentId}/splits/v${latest.versionNumber}/lock`, "POST");
      await loadAll(contentId);
      setMsg("Locked.");
    } catch (e: any) {
      setMsg(e?.message || "Lock failed");
    } finally {
      setBusy(false);
    }
  }

  async function createNewVersion() {
    if (!contentId) return;

    setBusy(true);
    setMsg(null);
    try {
      await api(`/content/${contentId}/split-versions`, "POST");
      await loadAll(contentId);
      setMsg("New version created.");
    } catch (e: any) {
      setMsg(e?.message || "Create version failed");
    } finally {
      setBusy(false);
    }
  }

  const canEdit = content?.canEdit !== false;
  const viewOnly = !canEdit || !latestIsEditable || (selectedVersionId && selectedVersionId !== latest?.id);

  if (!contentId) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Splits editor</div>
        <div className="text-sm text-neutral-400 mt-1">Select a content item from the Splits list to edit.</div>
      </div>
    );
  }

  const upstreamRatePct =
    upstreamInfo?.upstreamBps !== undefined
      ? (upstreamInfo.upstreamBps / 100).toFixed(
          upstreamInfo.upstreamBps % 100 ? 2 : 0
        )
      : null;
  const upstreamExampleSats =
    upstreamInfo?.upstreamBps !== undefined
      ? Math.floor((10000 * upstreamInfo.upstreamBps) / 10000)
      : null;
  function normalizeParentInput(value: string) {
    const v = (value || "").trim();
    if (!v) return "";
    const match = v.match(/c[a-z0-9]{20,}/i);
    return match ? match[0] : v;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-lg font-semibold">{content?.title || "Splits"}</div>
            <div className="text-sm text-neutral-400 mt-1">
              {titleCase(content?.type)} • {titleCase(content?.status)}
            </div>
            {!canEdit && (
              <div className="mt-2 inline-flex items-center gap-2 text-xs rounded-full border border-emerald-900 bg-emerald-950/30 px-2 py-1 text-emerald-200">
                You’re a participant
                <a href="/participations" className="text-emerald-100 underline">View your splits</a>
              </div>
            )}
            <details className="mt-2">
              <summary className="text-xs text-neutral-400 cursor-pointer select-none">Advanced</summary>
              <div className="mt-2 flex items-center gap-2 text-xs text-neutral-300">
                <span className="text-neutral-400">Content ID</span>
                <span className="font-mono text-neutral-200 break-all">{contentId}</span>
                <button
                  onClick={() => copyToClipboard(contentId)}
                  className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                >
                  Copy
                </button>
              </div>
            </details>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              disabled={busy || viewOnly || !latest || latest.status !== "draft"}
              onClick={saveLatest}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
            >
              Save
            </button>

            <button
              disabled={busy || viewOnly || !latest || latest.status !== "draft"}
              onClick={lockLatest}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
            >
              Lock
            </button>

            <button
              disabled={busy || !latest || latest.status !== "locked"}
              onClick={createNewVersion}
              className="text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50 whitespace-nowrap"
            >
              Create new version
            </button>
          </div>
        </div>

        {(upstreamInfo || ["derivative", "remix", "mashup"].includes(String(content?.type || ""))) && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-sm font-medium">Lineage / Upstream royalties</div>
            {upstreamInfo ? (
              <div className="mt-2 text-xs text-neutral-400 space-y-1">
                <div>
                  Original:{" "}
                  <a href={`/splits/${upstreamInfo.parent?.id}`} className="text-neutral-200 underline">
                    {upstreamInfo.parent?.title || "Original work"}
                  </a>
                </div>
                <div>Relationship: {titleCase(upstreamInfo.relation)}</div>
                <div>
                  Upstream rate:{" "}
                  {upstreamInfo.approvedAt ? `${upstreamRatePct}%` : "Set by original stakeholders during clearance"}
                </div>
                <div>
                  Clearance:{" "}
                  {upstreamInfo.requiresApproval
                    ? upstreamInfo.approvedAt
                      ? "Cleared"
                      : "Pending clearance"
                    : "Not required"}
                </div>
                {typeof upstreamExampleSats === "number" ? (
                  <div className="text-neutral-500">
                    Example: At 10,000 sats sale, {upstreamExampleSats.toLocaleString()} sats goes upstream.
                  </div>
                ) : null}
                {upstreamInfo.requiresApproval && !upstreamInfo.approvedAt ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {upstreamInfo.canRequestApproval ? (
                      <button
                        onClick={async () => {
                          try {
                            await api(`/content-links/${upstreamInfo.linkId}/request-approval`, "POST");
                            const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                            setUpstreamInfo(r?.parentLink === null ? null : r);
                          } catch (e: any) {
                            setUpstreamError(e?.message || "Clearance request failed.");
                          }
                        }}
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                      >
                        Request clearance
                      </button>
                    ) : null}
                    {upstreamInfo.canVote ? (
                      <>
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-neutral-500">Upstream %</label>
                          <input
                            className="w-20 rounded-md bg-neutral-950 border border-neutral-800 px-2 py-1 text-xs"
                            value={upstreamVotePct}
                            onChange={(e) => setUpstreamVotePct(e.target.value.replace(/[^\d.]/g, ""))}
                            inputMode="decimal"
                            placeholder="10"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              const pct = Number(upstreamVotePct || "0");
                              if (!Number.isFinite(pct)) {
                                setUpstreamError("Enter an upstream rate (0–100).");
                                return;
                              }
                              await api(`/content-links/${upstreamInfo.linkId}/vote`, "POST", {
                                decision: "approve",
                                upstreamRatePercent: pct
                              });
                              const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                              setUpstreamInfo(r?.parentLink === null ? null : r);
                            } catch (e: any) {
                              setUpstreamError(e?.message || "Vote failed.");
                            }
                          }}
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        >
                          Grant clearance
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await api(`/content-links/${upstreamInfo.linkId}/vote`, "POST", { decision: "reject" });
                              const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                              setUpstreamInfo(r?.parentLink === null ? null : r);
                            } catch (e: any) {
                              setUpstreamError(e?.message || "Vote failed.");
                            }
                          }}
                        className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-xs text-amber-300">
                No original linked. Link the original work to route upstream royalties.
              </div>
            )}
            {upstreamMultiParent ? (
              <div className="mt-2 text-xs text-amber-300">Multiple parent links detected. Multi-parent routing isn’t supported yet.</div>
            ) : null}
            {upstreamError && !upstreamMultiParent ? <div className="mt-2 text-xs text-amber-300">{upstreamError}</div> : null}
            {!upstreamInfo && ["derivative", "remix", "mashup"].includes(String(content?.type || "")) ? (
              <button
                onClick={async () => {
                  try {
                    const list = await api<Array<{ id: string; title: string }>>("/content", "GET");
                    setLinkCandidates(list.filter((c) => c.id !== contentId));
                  } catch {
                    setLinkCandidates([]);
                  }
                  setLinkParentId("");
                  setLinkRelation("derivative");
                  setShowLinkModal(true);
                }}
                className="mt-2 text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Link original
              </button>
            ) : null}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {versions.map((v) => {
            const active = v.id === selectedVersionId;
            return (
              <button
                key={v.id}
                onClick={() => setSelectedVersionId(v.id)}
                className={[
                  "text-xs rounded-lg border px-3 py-2",
                  active ? "border-white/30 bg-white/5" : "border-neutral-800 hover:bg-neutral-900"
                ].join(" ")}
              >
                v{v.versionNumber} • {v.status}
                {v.lockedAt ? " • locked" : ""}
              </button>
            );
          })}
          {versions.length === 0 && <div className="text-sm text-neutral-400">No split versions found.</div>}
        </div>

        {selectedVersion && (
          <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm">
                <div className="text-neutral-200 font-medium">
                  Version v{selectedVersion.versionNumber} • {selectedVersion.status}
                  {selectedVersion.lockedAt ? (
                    <span className="text-neutral-400 font-normal">
                      {" "}
                      • locked {new Date(selectedVersion.lockedAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>

                {selectedVersion.status === "locked" ? (
                  <div className="mt-2 space-y-1 text-xs text-neutral-400">
                    <div>
                      Locked file:{" "}
                      <span className="text-neutral-200">
                        {selectedVersion.lockedFileOriginalName ||
                          selectedVersion.lockedFileObjectKey ||
                          "(unknown)"}
                      </span>
                      {selectedVersion.lockedFileOriginalName && selectedVersion.lockedFileObjectKey ? (
                        <span className="text-neutral-500"> • {selectedVersion.lockedFileObjectKey}</span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span>SHA-256:</span>
                      <span className="text-neutral-200 break-all">{shortHash(selectedVersion.lockedFileSha256)}</span>
                      {selectedVersion.lockedFileSha256 ? (
                        <button
                          onClick={() => copyToClipboard(selectedVersion.lockedFileSha256!)}
                          className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 shrink-0"
                        >
                          Copy
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-2 border-t border-neutral-800 pt-2">
                      <div className="text-xs text-neutral-500">Proof</div>
                      {proofByVersionId[selectedVersion.id] ? (
                        <div className="mt-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>Proof hash:</span>
                          <span className="text-neutral-200 break-all">
                            {shortHash(proofByVersionId[selectedVersion.id]?.proofHash)}
                          </span>
                          <button
                            onClick={() => copyToClipboard(proofByVersionId[selectedVersion.id]?.proofHash || "")}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 shrink-0"
                          >
                            Copy
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>Manifest hash:</span>
                          <span className="text-neutral-200 break-all">
                            {shortHash(proofByVersionId[selectedVersion.id]?.manifestHash)}
                          </span>
                          <button
                            onClick={() => copyToClipboard(proofByVersionId[selectedVersion.id]?.manifestHash || "")}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 shrink-0"
                          >
                            Copy
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>Splits hash:</span>
                          <span className="text-neutral-200 break-all">
                            {shortHash(proofByVersionId[selectedVersion.id]?.splitsHash)}
                          </span>
                          <button
                            onClick={() => copyToClipboard(proofByVersionId[selectedVersion.id]?.splitsHash || "")}
                            className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 shrink-0"
                          >
                            Copy
                          </button>
                        </div>

                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => setProofView(proofByVersionId[selectedVersion.id] || null)}
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              View proof.json
                            </button>
                            <button
                              onClick={() =>
                                downloadJson(
                                  `proof-${contentId}-v${selectedVersion.versionNumber}.json`,
                                  proofByVersionId[selectedVersion.id]
                                )
                              }
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                            >
                              Export proof.json
                            </button>
                          </div>
                        </div>
                      ) : proofLoadingId === selectedVersion.id ? (
                        <div className="text-xs text-neutral-500">Loading proof…</div>
                      ) : (
                        <div className="text-xs text-neutral-500">
                          Proof not available yet{proofError ? `: ${proofError}` : "."}
                        </div>
                      )}
                    </div>

                    <div className="mt-2 border-t border-neutral-800 pt-2">
                      <div className="text-xs text-neutral-500">Sell playback credits</div>
                      {proofByVersionId[selectedVersion.id] ? (
                        <div className="mt-2 space-y-2">
                          {lightningBlocked && (
                            <div className="rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                              <div className="font-medium">Lightning not configured</div>
                              <div className="text-amber-200/90">
                                Connect a Lightning provider to generate invoices.
                              </div>
                              <div className="mt-2">
                                <button
                                  onClick={() => onGoToPayouts?.()}
                                  className="text-xs rounded-md border border-amber-700/60 px-2 py-1 hover:bg-amber-900/30"
                                >
                                  Configure payments
                                </button>
                              </div>
                              <div className="mt-1 text-[11px] text-amber-200/70">Details: {lightningReason}</div>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <input
                              value={payUnits}
                              onChange={(e) => setPayUnits(e.target.value)}
                              className="w-24 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs"
                              inputMode="numeric"
                              placeholder="units"
                            />
                            <button
                              disabled={lightningBlocked}
                              onClick={async () => {
                                if (lightningBlocked) {
                                  setPayMsg("Lightning is not configured. Configure payments to generate invoices.");
                                  return;
                                }
                                const units = Math.max(1, Math.floor(Number(payUnits || "0")));
                                setPayMsg(null);
                                setPurchase(null);
                                try {
                                  const res = await api<{ purchaseId: string; bolt11: string }>(`/v1/payments/invoice`, "POST", {
                                    proofHash: proofByVersionId[selectedVersion.id]?.proofHash,
                                    units
                                  });
                                  setPurchase({ id: res.purchaseId, bolt11: res.bolt11, status: "unpaid" });
                                } catch (e: any) {
                                  const raw = e?.message || "Invoice failed";
                                  if (/LND_|BTCPAY_|not configured/i.test(raw)) {
                                    setPayMsg("Lightning is not configured. Configure payments to generate invoices.");
                                  } else {
                                    setPayMsg(raw);
                                  }
                                }
                              }}
                              className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                            >
                              Generate invoice
                            </button>
                          </div>

                          {purchase?.bolt11 && (
                            <div className="space-y-1">
                              <div className="text-xs text-neutral-400">BOLT11:</div>
                              <div className="text-xs text-neutral-200 break-all">{purchase.bolt11}</div>
                              <button
                                onClick={() => copyToClipboard(purchase.bolt11)}
                                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                              >
                                Copy invoice
                              </button>
                              <div className="text-xs text-neutral-400">Status: {purchase.status}</div>
                              {purchase.receiptId ? (
                                <div className="text-xs text-emerald-300">Receipt: {purchase.receiptId}</div>
                              ) : null}
                            </div>
                          )}

                          {payMsg ? <div className="text-xs text-red-300">{payMsg}</div> : null}
                        </div>
                      ) : (
                        <div className="text-xs text-neutral-500">Load proof to purchase credits.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-neutral-400">
                    Not locked yet. Locking creates an immutable proof tied to an exact file + hash.
                  </div>
                )}
              </div>

              <div className="text-xs text-neutral-500">{viewOnly ? "Viewing historical version" : "Editing latest draft"}</div>
            </div>
          </div>
        )}

        <div className="mt-4">
          <HistoryFeed
            title="Split history"
            items={historyItems}
            loading={historyLoading}
            emptyText="No split history yet."
            exportName={`split-history-${contentId || "content"}.json`}
            onRefresh={async () => {
              if (!contentId) return;
              setHistoryLoading(true);
              try {
                const hist = await api<HistoryEvent[]>(`/content/${contentId}/split-history`, "GET");
                setHistoryItems(hist || []);
              } catch {
                setHistoryItems([]);
              } finally {
                setHistoryLoading(false);
              }
            }}
          />

          {selectedVersionId ? (
            <div className="mt-2">
              <AuditPanel
                scopeType="split"
                scopeId={selectedVersionId}
                title="Audit"
                exportName={`split-audit-${selectedVersionId}.json`}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-2 pr-2">Email</th>
                <th className="py-2 pr-2">Role</th>
                <th className="py-2 pr-2">Percent</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t border-neutral-800">
                  <td className="py-2 pr-2">
                    <input
                      disabled={viewOnly || busy}
                      value={r.participantEmail}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], participantEmail: e.target.value };
                        setRows(next);
                      }}
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                      placeholder="artist@example.com"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      disabled={viewOnly || busy}
                      value={r.role}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], role: e.target.value };
                        setRows(next);
                      }}
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                      placeholder="writer, producer, publisher"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    {(() => {
                      const displayPercent = percentToString(r.percent);
                      return (
                    <input
                      disabled={viewOnly || busy}
                      value={displayPercent}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], percent: e.target.value };
                        setRows(next);
                      }}
                      className="w-28 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
                      placeholder="50"
                      inputMode="decimal"
                    />
                      );
                    })()}
                  </td>
                  <td className="py-2 pr-2">
                    <button
                      disabled={viewOnly || busy || rows.length <= 1}
                      onClick={() => setRows(rows.filter((_, i) => i !== idx))}
                      className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
                    >
                      Remove
                    </button>
                    {r.id ? (
                      <div className="mt-2 text-xs text-neutral-400">
                        {auditByParticipant[r.id]?.remoteVerified ? (
                          <span className="text-emerald-300">Verified from remote node</span>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!viewOnly && (
            <button
              disabled={busy}
              onClick={() => setRows([...rows, { participantEmail: "", role: "writer", percent: "0" }])}
              className="mt-3 text-sm rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900 disabled:opacity-50"
            >
              Add participant
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="text-sm text-neutral-400">
            Total: <span className={totalOk ? "text-neutral-200" : "text-red-300"}>{total}%</span>
            {viewOnly ? <span className="ml-2">View-only</span> : null}
            {!viewOnly && !totalOk ? <span className="ml-2">Must equal 100</span> : null}
          </div>

          {msg && <div className="text-sm text-neutral-300">{msg}</div>}
        </div>
      </div>

      {proofView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">proof.json</div>
              <button
                onClick={() => setProofView(null)}
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Close
              </button>
            </div>
            <pre className="mt-3 max-h-[70vh] overflow-auto text-xs text-neutral-200 bg-neutral-900/30 rounded-lg p-3">
              {JSON.stringify(proofView, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <div className="text-sm font-medium">Link original</div>
            <div className="mt-3 space-y-3 text-xs text-neutral-400">
              <div>
                <div className="text-neutral-300 mb-1">Original content</div>
                <select
                  className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs"
                  value={linkParentId}
                  onChange={(e) => setLinkParentId(normalizeParentInput(e.target.value))}
                >
                  <option value="">Select from your content…</option>
                  {linkCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <div className="mt-2">
                  <input
                    className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-xs"
                    placeholder="Paste original link or content ID"
                    value={linkParentId}
                    onChange={(e) => setLinkParentId(normalizeParentInput(e.target.value))}
                  />
                </div>
              </div>
              <div>
                <div className="text-neutral-300 mb-1">Relationship</div>
                <div className="flex flex-wrap gap-2">
                  {["derivative", "remix", "mashup"].map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => setLinkRelation(r)}
                      className={[
                        "text-xs rounded-full border px-3 py-1",
                        linkRelation === r ? "border-white/40 bg-white/10 text-neutral-100" : "border-neutral-800 text-neutral-400"
                      ].join(" ")}
                    >
                      {titleCase(r)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] text-neutral-500">
                Public release requires original stakeholder clearance.
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowLinkModal(false)}
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                disabled={linkSaving || !linkParentId}
                onClick={async () => {
                  if (!contentId) return;
                    try {
                      setLinkSaving(true);
                      setUpstreamError(null);
                      setUpstreamMultiParent(false);
                      const parentId = normalizeParentInput(linkParentId);
                      await api(`/content/${contentId}/parent-link`, "POST", {
                        parentContentId: parentId,
                        relation: linkRelation
                      });
                      const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                      setUpstreamInfo(r?.parentLink === null ? null : r);
                      setShowLinkModal(false);
                    } catch (e: any) {
                      const msg = e?.message || "Failed to link original.";
                      setUpstreamError(msg);
                      if (/PARENT_LINK_ALREADY_EXISTS|MULTIPLE_PARENTS_NOT_SUPPORTED/.test(msg)) {
                        try {
                          const r: any = await api(`/content/${contentId}/parent-link`, "GET");
                          setUpstreamInfo(r?.parentLink === null ? null : r);
                          setShowLinkModal(false);
                        } catch (ge: any) {
                          setUpstreamError(ge?.message || msg);
                        }
                      }
                    } finally {
                      setLinkSaving(false);
                    }
                }}
                className="text-xs rounded-md border border-neutral-800 px-2 py-1 hover:bg-neutral-900 disabled:opacity-50"
              >
                Save link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
