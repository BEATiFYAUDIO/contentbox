import React from "react";
import { api } from "../lib/api";
import { PAYOUT_DESTINATIONS_LABEL, SETTLEMENTS_LABEL, PAYMENTS_EXPLAINER } from "../lib/terminology";
import AuditPanel from "../components/AuditPanel";
import TimeScopeControls from "../components/TimeScopeControls";
import { isWithinPeriod, type TimeBasis, type TimePeriod } from "../lib/timeScope";

type PayoutMethod = {
  id: string;
  code: string;
  displayName: string;
  isEnabled: boolean;
  isVisible: boolean;
  sortOrder: number;
};

type Identity = {
  id: string;
  value: string;
  label: string | null;
  verifiedAt: string | null;
  createdAt: string;
  payoutMethod: PayoutMethod;
};

type PayoutRow = {
  id: string;
  paymentIntentId?: string | null;
  providerPaymentIntentId?: string | null;
  allocationId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  content?: { id: string; title: string; type: string } | null;
  amountSats?: string | number;
  status?: "pending" | "ready" | "forwarding" | "paid" | "failed" | "blocked";
  payoutDestinationSummary?: string | null;
  payoutDestinationType?: string | null;
  payoutReference?: string | null;
  attemptCount?: number;
  lastError?: string | null;
  blockedReason?: string | null;
  remittedAt?: string | null;
};

type FinancePayoutsResponse = {
  items: PayoutRow[];
  totals?: {
    pendingSats?: string;
    paidSats?: string;
    failedSats?: string;
  };
};

type RoyaltiesContextResponse = {
  works?: Array<{
    contentId?: string | null;
    myRole?: "owner" | "participant" | string | null;
    myBps?: number | null;
    myPercent?: number | string | null;
  }>;
};

type RemoteRoyaltyContextRow = {
  contentId?: string | null;
  role?: string | null;
  percent?: number | string | null;
};

function normalizeRoleLabel(raw: string | null | undefined): string {
  const role = String(raw || "").trim().toLowerCase();
  if (!role) return "";
  if (role === "owner") return "Owner";
  if (role === "collaborator" || role === "collab") return "Collaborator";
  if (role === "participant") return "Participant";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function PayoutRailsPage() {
  const [methods, setMethods] = React.useState<PayoutMethod[]>([]);
  const [identities, setIdentities] = React.useState<Identity[]>([]);
  const [selected, setSelected] = React.useState<PayoutMethod | null>(null);
  const [value, setValue] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [btcEnabled, setBtcEnabled] = React.useState(true);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [labelError, setLabelError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [payoutRows, setPayoutRows] = React.useState<PayoutRow[]>([]);
  const [payoutTotals, setPayoutTotals] = React.useState<{ pendingSats: string; paidSats: string; failedSats: string }>({
    pendingSats: "0",
    paidSats: "0",
    failedSats: "0"
  });
  const [expandedPayouts, setExpandedPayouts] = React.useState<Record<string, boolean>>({});
  const [roleByContent, setRoleByContent] = React.useState<Record<string, string>>({});
  const [shareByContent, setShareByContent] = React.useState<Record<string, string>>({});
  const [originByContent, setOriginByContent] = React.useState<Record<string, string>>({});
  const [timeBasis, setTimeBasis] = React.useState<TimeBasis>("paid");
  const [timePeriod, setTimePeriod] = React.useState<TimePeriod>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [m, ids, payoutsRes] = await Promise.all([
        api<PayoutMethod[]>("/payout-methods"),
        api<Identity[]>("/identities"),
        api<FinancePayoutsResponse>("/finance/payouts"),
      ]);
      setMethods(m || []);
      setIdentities(ids || []);
      setPayoutRows(Array.isArray(payoutsRes?.items) ? payoutsRes.items : []);
      setPayoutTotals({
        pendingSats: String(payoutsRes?.totals?.pendingSats || "0"),
        paidSats: String(payoutsRes?.totals?.paidSats || "0"),
        failedSats: String(payoutsRes?.totals?.failedSats || "0")
      });
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const [localCtx, remoteCtx] = await Promise.allSettled([
        api<RoyaltiesContextResponse>("/my/royalties", "GET"),
        api<RemoteRoyaltyContextRow[]>("/my/royalties/remote", "GET")
      ]);
      if (!active) return;

      const roleMap: Record<string, string> = {};
      const shareMap: Record<string, string> = {};
      const originMap: Record<string, string> = {};

      if (localCtx.status === "fulfilled") {
        const works = Array.isArray(localCtx.value?.works) ? localCtx.value.works : [];
        for (const work of works) {
          const contentId = String(work?.contentId || "").trim();
          if (!contentId) continue;
          const roleLabel = normalizeRoleLabel(work?.myRole);
          if (roleLabel) roleMap[contentId] = roleLabel;
          originMap[contentId] = "Local";

          const bps = Number(work?.myBps ?? NaN);
          if (Number.isFinite(bps) && bps > 0) {
            shareMap[contentId] = `${(bps / 100).toFixed(2)}%`;
            continue;
          }
          const pct = Number(work?.myPercent ?? NaN);
          if (Number.isFinite(pct) && pct > 0) {
            shareMap[contentId] = `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
          }
        }
      }

      if (remoteCtx.status === "fulfilled") {
        const rows = Array.isArray(remoteCtx.value) ? remoteCtx.value : [];
        for (const row of rows) {
          const contentId = String(row?.contentId || "").trim();
          if (!contentId) continue;
          if (!roleMap[contentId]) {
            const roleLabel = normalizeRoleLabel(row?.role);
            if (roleLabel) roleMap[contentId] = roleLabel;
          }
          originMap[contentId] = "Remote";
          if (!shareMap[contentId]) {
            const pct = Number(row?.percent ?? NaN);
            if (Number.isFinite(pct) && pct > 0) {
              shareMap[contentId] = `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
            }
          }
        }
      }

      setRoleByContent(roleMap);
      setShareByContent(shareMap);
      setOriginByContent(originMap);
    })();
    return () => {
      active = false;
    };
  }, []);

  function validateValue(code: string, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return "Value is required";
    if (code === "lightning_address" && !trimmed.includes("@")) return "Lightning address must include @";
    if (code === "lnurl" && !/^lnurl/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return "LNURL must start with LNURL or http(s)";
    if (code === "btc_onchain" && !/^bc1/i.test(trimmed) && trimmed.length < 12) return "BTC address should look like bc1…";
    if (code === "manual" && trimmed.length < 3) return "Manual payout details are too short";
    return null;
  }

  function validateLabel(code: string, raw: string) {
    if (code !== "manual") return null;
    if (raw.trim().length < 2) return "Label is required for manual payout.";
    return null;
  }

  function maskValue(code: string, raw: string) {
    if (!raw) return "";
    if (code === "lightning_address" && raw.includes("@")) {
      const [user, domain] = raw.split("@");
      const head = user.slice(0, 2);
      return `${head}…@${domain}`;
    }
    const head = raw.slice(0, 6);
    const tail = raw.slice(-4);
    return raw.length <= 12 ? raw : `${head}…${tail}`;
  }

  function formatSats(raw: string | number | null | undefined) {
    const n = Number(raw || 0);
    return Number.isFinite(n) ? `${Math.round(n).toLocaleString()} sats` : "0 sats";
  }

  function payoutStatusLabel(status: PayoutRow["status"]) {
    if (status === "paid") return "Paid";
    if (status === "forwarding" || status === "ready" || status === "pending") return "Processing";
    if (status === "failed") return "Failed";
    if (status === "blocked") return "Blocked";
    return "Processing";
  }

  function payoutStatusTone(status: PayoutRow["status"]) {
    if (status === "paid") return "text-emerald-300";
    if (status === "failed") return "text-rose-300";
    if (status === "blocked") return "text-rose-300";
    return "text-cyan-300";
  }

  function isProcessingStatus(status: PayoutRow["status"]) {
    return status === "pending" || status === "ready" || status === "forwarding";
  }

  function processingSla(row: PayoutRow): { label: string; tone: string; detail: string } {
    if (!isProcessingStatus(row.status)) return { label: "—", tone: "text-neutral-500", detail: "Not in processing state." };
    const baseTs = Date.parse(String(row.updatedAt || row.createdAt || "")) || Date.parse(String(row.createdAt || "")) || NaN;
    if (!Number.isFinite(baseTs)) {
      return { label: "Unknown", tone: "text-neutral-500", detail: "Missing timestamp for SLA age." };
    }
    const ageMs = Math.max(0, Date.now() - baseTs);
    const ageMin = Math.floor(ageMs / 60000);
    if (ageMin < 2) {
      return { label: "<2m", tone: "text-emerald-300", detail: "Normal processing window." };
    }
    if (ageMin <= 10) {
      return { label: "2-10m", tone: "text-amber-300", detail: "Watch window." };
    }
    return { label: ">10m", tone: "text-rose-300", detail: "Needs attention." };
  }

  const visiblePayoutRows = React.useMemo(() => {
    const rows = payoutRows.slice().sort((a, b) => {
      const ta = Date.parse(String(a.remittedAt || a.updatedAt || a.createdAt || "")) || 0;
      const tb = Date.parse(String(b.remittedAt || b.updatedAt || b.createdAt || "")) || 0;
      return tb - ta;
    });
    if (timePeriod === "all") return rows;
    return rows.filter((row) => isWithinPeriod(row.remittedAt, timePeriod));
  }, [payoutRows, timePeriod]);

  const rowsMissingPaidTimestamp = React.useMemo(() => {
    if (timePeriod === "all") return 0;
    return payoutRows.reduce((count, row) => (row.remittedAt ? count : count + 1), 0);
  }, [payoutRows, timePeriod]);

  async function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLabelError(null);
    if (!selected) return;

    try {
      const existingId = editingId || null;
      const enabled = selected.code !== "btc_onchain" ? true : btcEnabled;

      if (selected.code === "btc_onchain" && !enabled) {
        if (existingId) {
          await api(`/identities/${existingId}`, "DELETE");
        }
      } else {
        const validationError = validateValue(selected.code, value);
        if (validationError) throw new Error(validationError);
        const labelValidationError = validateLabel(selected.code, label);
        if (labelValidationError) {
          setLabelError(labelValidationError);
          return;
        }
        if (existingId) {
          await api(`/identities/${existingId}`, "PATCH", {
            value,
            label: label || null,
          });
        } else {
          await api<Identity>("/identities", "POST", {
            payoutMethodId: selected.id,
            value,
            label: label || null,
          });
        }
      }
      setValue("");
      setLabel("");
      setSelected(null);
      setEditingId(null);
      setShowAdd(false);
      setLabelError(null);
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to save");
    }
  }

  if (loading) return <div className="text-neutral-300">Loading payout destinations…</div>;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold">Payouts & {PAYOUT_DESTINATIONS_LABEL}</div>
        <div className="text-sm text-neutral-400">
          Payouts show payout execution status for this account.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          These payouts execute money accrued from Royalties-defined participation and share.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Paid means remitted by the configured payout path (provider-managed forwarding or direct send), not always direct wallet receipt on this node.
        </div>
        <div className="text-xs text-neutral-500 mt-1">{PAYMENTS_EXPLAINER}</div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/50 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="font-medium mb-2">Payout execution</div>
        <div className="text-sm text-neutral-400">
          Execution truth only: remittance state, destination path, and payout references.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Status model: Pending/Ready = not remitted, Forwarding = in progress, Paid = remitted, Failed/Blocked = not remitted.
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Processing SLA: &lt;2m normal, 2-10m watch, &gt;10m needs attention.
        </div>
        <div className="mt-3">
          <TimeScopeControls
            basis={timeBasis}
            onBasisChange={setTimeBasis}
            period={timePeriod}
            onPeriodChange={setTimePeriod}
            basisOptions={["paid"]}
            periodOptions={["1d", "7d", "30d", "90d", "all"]}
            helperText="Payouts are scoped by paid/remitted date when a remitted timestamp is present."
          />
        </div>
        {timePeriod !== "all" && rowsMissingPaidTimestamp > 0 ? (
          <div className="mt-2 text-xs text-neutral-500">
            {rowsMissingPaidTimestamp} non-remitted rows are excluded from this paid-time period scope.
          </div>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Paid</div>
            <div className="mt-1 text-lg font-semibold">{formatSats(payoutTotals.paidSats)}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Pending</div>
            <div className="mt-1 text-lg font-semibold">{formatSats(payoutTotals.pendingSats)}</div>
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">Failed</div>
            <div className="mt-1 text-lg font-semibold">{formatSats(payoutTotals.failedSats)}</div>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-neutral-400">
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Content</th>
                <th className="py-2 px-3">Amount</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">SLA</th>
                <th className="py-2 px-3">Destination</th>
                <th className="py-2 px-3">Reference / Hash</th>
                <th className="py-2 px-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {visiblePayoutRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-3 px-3 text-neutral-500">
                    {payoutRows.length === 0
                      ? "No payout execution rows yet for this account."
                      : "No payout rows in the selected paid-time period."}
                  </td>
                </tr>
              ) : (
                visiblePayoutRows.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr className="border-t border-neutral-800">
                        <td className="py-2 px-3 text-xs text-neutral-400">
                          {row.remittedAt
                            ? new Date(row.remittedAt).toLocaleString()
                            : row.updatedAt
                              ? new Date(row.updatedAt).toLocaleString()
                              : row.createdAt
                                ? new Date(row.createdAt).toLocaleString()
                                : "—"}
                        </td>
                        <td className="py-2 px-3 text-neutral-200">{row.content?.title || "Content"}</td>
                        <td className="py-2 px-3">{formatSats(row.amountSats)}</td>
                        <td className={["py-2 px-3", payoutStatusTone(row.status)].join(" ")}>{payoutStatusLabel(row.status)}</td>
                        <td className={["py-2 px-3 text-xs", processingSla(row).tone].join(" ")} title={processingSla(row).detail}>
                          {processingSla(row).label}
                        </td>
                        <td className="py-2 px-3">{row.payoutDestinationSummary || row.payoutDestinationType || "—"}</td>
                        <td className="py-2 px-3 font-mono text-xs text-neutral-400">
                          {row.payoutReference || row.paymentIntentId || "—"}
                        </td>
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            className="rounded-md border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800/60"
                            onClick={() => setExpandedPayouts((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                          >
                            {expandedPayouts[row.id] ? "Hide" : "Show"}
                          </button>
                        </td>
                      </tr>
                      {expandedPayouts[row.id] ? (
                        <tr className="border-t border-neutral-800/50 bg-neutral-950/40">
                          <td colSpan={8} className="px-3 py-3">
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs">
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Payment Intent</div>
                                <div className="mt-1 font-mono text-neutral-300 break-all">{row.paymentIntentId || "—"}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Payout Reference</div>
                                <div className="mt-1 font-mono text-neutral-300 break-all">{row.payoutReference || "—"}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Status</div>
                                <div className="mt-1 text-neutral-300">{payoutStatusLabel(row.status)}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Role</div>
                                <div className="mt-1 text-neutral-300">{roleByContent[String(row.content?.id || "").trim()] || "Participant"}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Origin</div>
                                <div className="mt-1 text-neutral-300">{originByContent[String(row.content?.id || "").trim()] || "—"}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Share</div>
                                <div className="mt-1 text-neutral-300">{shareByContent[String(row.content?.id || "").trim()] || "—"}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Remitted</div>
                                <div className="mt-1 text-neutral-300">{row.remittedAt ? new Date(row.remittedAt).toLocaleString() : "—"}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Attempts</div>
                                <div className="mt-1 text-neutral-300">{Number(row.attemptCount || 0)}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-wide text-neutral-500">Execution SLA</div>
                                <div className={["mt-1", processingSla(row).tone].join(" ")}>{processingSla(row).label}</div>
                              </div>
                              <div className="sm:col-span-2">
                                <div className="uppercase tracking-wide text-neutral-500">Last error / reason</div>
                                <div className="mt-1 text-neutral-300 break-all">{row.lastError || row.blockedReason || "—"}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="font-medium mb-2">Add payout destination</div>
        <div className="text-sm text-neutral-400 mb-3">
          Add destinations where your settlement allocations should be paid out.
        </div>
        <button
          type="button"
          className="rounded-lg bg-white text-black font-medium px-4 py-2"
          onClick={() => {
            setShowAdd(true);
            setSelected(null);
            setEditingId(null);
            setValue("");
            setLabel("");
            setLabelError(null);
          }}
        >
          Add payout destination
        </button>
        <details className="mt-3 text-xs text-neutral-400">
          <summary className="cursor-pointer select-none">Legal & safety notes</summary>
          <ul className="mt-2 space-y-1 list-disc pl-4">
            <li>Not financial, legal, or tax advice.</li>
            <li>You are responsible for accurate payout details; mistakes may be irreversible.</li>
            <li>Lightning and on-chain payments may be irreversible once sent.</li>
            <li>Fees, exchange rates, and confirmation times may vary by network/provider.</li>
            <li>Manual payouts are off-platform and may require additional verification or delays.</li>
            <li>By adding a destination, you confirm you control it and are authorized to receive funds.</li>
          </ul>
        </details>
      </div>

      {showAdd && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {methods.map((m) => {
            const comingSoon = m.code === "stripe_connect" || m.code === "paypal";
            const disabled = comingSoon || (!m.isEnabled && m.code !== "btc_onchain");
            const selectedNow = selected?.id === m.id;
            const configured = identities.some((i) => i.payoutMethod.id === m.id);

            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  setSelected(m);
                  setEditingId(null);
                  setValue("");
                  setLabel("");
                  setLabelError(null);
                  setBtcEnabled(true);
                }}
                className={[
                  "text-left rounded-xl border p-4 transition",
                  selectedNow
                    ? "border-white/40 bg-white/5"
                    : disabled
                      ? "border-neutral-800 bg-neutral-900/20"
                      : "border-neutral-800 bg-neutral-900/20 hover:bg-neutral-900/40",
                  disabled ? "opacity-50 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <div className="space-y-2">
                  <div className="font-medium">{m.displayName}</div>
                  <span
                    className={
                      disabled
                        ? "text-xs px-2 py-1 rounded-full border border-neutral-700 text-neutral-400 inline-flex w-fit"
                        : configured
                          ? "text-xs px-2 py-1 rounded-full border border-emerald-700 text-emerald-300 inline-flex w-fit"
                          : "text-xs px-2 py-1 rounded-full border border-neutral-700 text-neutral-300 inline-flex w-fit"
                    }
                  >
                    {disabled ? "Coming soon" : configured ? "Configured" : "Not configured"}
                  </span>
                  {m.code === "btc_onchain" ? (
                    <div className="text-xs text-neutral-500">BTC On-chain (XPUB) — generates unique receive addresses per purchase.</div>
                  ) : null}
                </div>
                <div className="text-xs text-neutral-500 mt-2">Code: {m.code}</div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <form onSubmit={saveIdentity} className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 space-y-3">
          <div className="font-medium">{PAYOUT_DESTINATIONS_LABEL}: {selected.displayName}</div>

          {selected.code === "btc_onchain" ? (
            <div className="text-xs text-neutral-400">
              Enter your XPUB so Certifyd Creator can derive a unique on-chain address per purchase.
            </div>
          ) : null}
          {selected.code === "lightning_address" ? (
            <div className="text-xs text-neutral-400">Looks like name@domain.com</div>
          ) : null}
          {selected.code === "lnurl" ? (
            <div className="text-xs text-neutral-400">Paste LNURL1… or an LNURL-pay URL.</div>
          ) : null}
          {selected.code === "btc_onchain" ? (
            <div className="text-xs text-neutral-400">Paste a Bitcoin address (bc1…) or XPUB.</div>
          ) : null}
          {selected.code === "manual" ? (
            <div className="text-xs text-neutral-400">
              Off-platform payouts (e.g., Interac e-Transfer). Use email or phone (recommended), or provide instructions.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm mb-1 text-neutral-300" htmlFor="payout-value">
                Value
              </label>
              <input
                id="payout-value"
                name="payoutValue"
                className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={
                  selected.code === "lightning_address"
                    ? "name@domain.com"
                  : selected.code === "lnurl"
                    ? "lnurl1..."
                    : selected.code === "btc_onchain"
                      ? "xpub / zpub / ypub / tpub / vpub"
                      : selected.code === "manual"
                        ? "Email or phone for Interac e-Transfer (e.g., payments@myband.example or +14165551234)"
                          : "Enter payout identifier"
                }
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-neutral-300" htmlFor="payout-label">
                {selected.code === "manual" ? "Label" : "Label (optional)"}
              </label>
              <input
                id="payout-label"
                name="payoutLabel"
                className={[
                  "w-full rounded-lg bg-neutral-950 border px-3 py-2 outline-none focus:border-neutral-600",
                  labelError ? "border-red-600" : "border-neutral-800",
                ].join(" ")}
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  if (labelError) setLabelError(null);
                }}
                placeholder={
                  selected.code === "manual"
                    ? "e.g. Interac (Band Wallet)"
                    : "e.g. Primary, Band wallet, Business account"
                }
                autoComplete="off"
              />
              {labelError ? (
                <div className="mt-1 text-xs text-red-300">{labelError}</div>
              ) : null}
            </div>
          </div>
          {selected.code === "manual" ? (
            <div className="text-xs text-neutral-500 space-y-1">
              <div>Email or phone for Interac e-Transfer is recommended.</div>
              <div>Examples: payments@myband.example · billing@studio.example · +14165551234 · 416-555-1234</div>
            </div>
          ) : null}
          {selected.code === "manual" ? (
            <div className="text-xs text-neutral-400">
              Label is required for manual payout (e.g., Interac e-Transfer).
            </div>
          ) : null}

          {selected.code === "btc_onchain" ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-neutral-300" htmlFor="payout-btc-enabled">
                <input
                  id="payout-btc-enabled"
                  name="payoutBtcEnabled"
                  type="checkbox"
                  className="accent-emerald-500"
                  checked={btcEnabled}
                  onChange={(e) => setBtcEnabled(e.target.checked)}
                />
                Enabled
              </label>
              <button className="rounded-lg bg-white text-black font-medium px-4 py-2">
                Save payout destination
              </button>
            </div>
          ) : (
              <button className="rounded-lg bg-white text-black font-medium px-4 py-2">
                Save payout destination
              </button>
          )}

          {!selected.isEnabled && (
            <div className="text-xs text-neutral-400">
              This rail is shown for demo purposes. It will be stored but not verified.
            </div>
          )}
          <div className="text-xs text-neutral-400">
            By adding a payout destination, you confirm you control it and are authorized to receive funds. Mistyped payout details may result in irreversible loss of funds.
          </div>
        </form>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="font-medium mb-2">Your payout destinations</div>
        {identities.length === 0 ? (
          <div className="text-sm text-neutral-400">None yet.</div>
        ) : (
          <div className="space-y-2">
            {identities.map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                <div>
                  <div className="text-sm">Payout method: {i.payoutMethod.displayName}</div>
                  <div className="text-xs text-neutral-400">
                    {i.label ? `${i.label} • ` : ""}{maskValue(i.payoutMethod.code, i.value)}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {i.verifiedAt ? (
                    <span className="text-emerald-300">Verified</span>
                  ) : (
                    <span className="text-neutral-400">Unverified</span>
                  )}
                  <button
                    type="button"
                    className="text-neutral-300 hover:text-white"
                    onClick={() => {
                      setShowAdd(true);
                      setSelected(i.payoutMethod);
                      setEditingId(i.id);
                      setValue(i.value);
                      setLabel(i.label || "");
                      setLabelError(null);
                      setBtcEnabled(Boolean(i.value || ""));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-red-300 hover:text-red-200"
                    onClick={async () => {
                      if (!confirm("Delete this payout destination?")) return;
                      try {
                        await api(`/identities/${i.id}`, "DELETE");
                        await load();
                      } catch (e: any) {
                        setError(e.message || "Failed to delete");
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="font-medium">Node payment intake</div>
        <div className="text-sm text-neutral-400 mt-1">
          Buyer payments are accepted via Lightning invoices or on-chain Bitcoin addresses derived from your configured payout destinations.
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="font-medium mb-2">{SETTLEMENTS_LABEL} / Revenue splits</div>
        <div className="text-sm text-neutral-400">
          Settlements are created after a payment is paid and show how revenue is split across participants.
        </div>
      </div>

      <div className="text-xs text-neutral-500 px-1">Export current view evidence (read-only).</div>
      <AuditPanel scopeType="identity" title="Audit" exportName="identity-audit.json" />
    </div>
  );
}
