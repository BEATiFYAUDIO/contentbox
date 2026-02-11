import React from "react";
import { api } from "../lib/api";
import { PAYOUT_DESTINATIONS_LABEL, PAYMENTS_EXPLAINER } from "../lib/terminology";
import AuditPanel from "../components/AuditPanel";

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

type PayoutsResponse = {
  items: Array<{ id: string; amountSats: string; status: string; method: string | null; createdAt: string; completedAt: string | null }>;
  totals: { pendingSats: string; paidSats: string };
};

export default function PayoutRailsPage() {
  const [methods, setMethods] = React.useState<PayoutMethod[]>([]);
  const [identities, setIdentities] = React.useState<Identity[]>([]);
  const [payouts, setPayouts] = React.useState<PayoutsResponse | null>(null);
  const [selected, setSelected] = React.useState<PayoutMethod | null>(null);
  const [value, setValue] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [btcEnabled, setBtcEnabled] = React.useState(true);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [labelError, setLabelError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [m, ids, p] = await Promise.all([
        api<PayoutMethod[]>("/payout-methods"),
        api<Identity[]>("/identities"),
        api<PayoutsResponse>("/finance/payouts"),
      ]);
      setMethods(m);
      setIdentities(ids);
      setPayouts(p);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
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

  const formatSats = (raw?: string | null) => {
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "0 sats";
    return `${Math.round(n).toLocaleString()} sats`;
  };

  const payoutTotalsByMethod = new Map<string, { pending: bigint; completed: bigint; lastDate: string | null }>();
  for (const m of methods) {
    payoutTotalsByMethod.set(m.code, { pending: 0n, completed: 0n, lastDate: null });
  }
  for (const p of payouts?.items || []) {
    const key = p.method || "manual";
    const row = payoutTotalsByMethod.get(key) || { pending: 0n, completed: 0n, lastDate: null };
    if (p.status === "completed") {
      row.completed += BigInt(p.amountSats || "0");
    } else {
      row.pending += BigInt(p.amountSats || "0");
    }
    const date = p.completedAt || p.createdAt;
    row.lastDate = row.lastDate && row.lastDate > date ? row.lastDate : date;
    payoutTotalsByMethod.set(key, row);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold">{PAYOUT_DESTINATIONS_LABEL}</div>
        <div className="text-sm text-neutral-400">
          Configure where your settlements should be paid out. Buyer intake rails are managed separately.
        </div>
        <div className="text-xs text-neutral-500 mt-2">{PAYMENTS_EXPLAINER}</div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/50 text-red-200 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-4">
        <div className="font-medium mb-2">Destination summary</div>
        <div className="text-sm text-neutral-400 mb-3">
          Track which payout destinations are configured and their payout totals.
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="text-left font-medium py-2">Destination</th>
                <th className="text-left font-medium py-2">Configured</th>
                <th className="text-left font-medium py-2">Total paid</th>
                <th className="text-left font-medium py-2">Total pending</th>
                <th className="text-left font-medium py-2">Last payout</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => {
                const configured = identities.some((i) => i.payoutMethod.id === m.id);
                const totals = payoutTotalsByMethod.get(m.code) || { pending: 0n, completed: 0n, lastDate: null };
                return (
                  <tr key={m.id} className="border-t border-neutral-900">
                    <td className="py-2 text-neutral-200">{m.displayName}</td>
                    <td className="py-2 text-neutral-300">{configured ? "Yes" : "No"}</td>
                    <td className="py-2">{formatSats(totals.completed.toString())}</td>
                    <td className="py-2 text-neutral-300">{formatSats(totals.pending.toString())}</td>
                    <td className="py-2 text-neutral-400">
                      {totals.lastDate ? new Date(totals.lastDate).toLocaleString() : "—"}
                    </td>
                  </tr>
                );
              })}
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
              Enter your XPUB so Contentbox can derive a unique on-chain address per purchase.
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
              <label className="block text-sm mb-1 text-neutral-300">Value</label>
              <input
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
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-neutral-300">
                {selected.code === "manual" ? "Label" : "Label (optional)"}
              </label>
              <input
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
              <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
                <input
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

      <AuditPanel scopeType="identity" title="Audit" exportName="identity-audit.json" />
    </div>
  );
}
