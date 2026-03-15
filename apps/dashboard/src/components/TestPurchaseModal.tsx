import React from "react";
import QRCode from "qrcode";
import { getToken } from "../lib/auth";
import { getApiBase } from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  contentId: string;
  manifestSha256: string;
  defaultAmountSats?: string;
  storefrontStatus?: string | null;
  contentStatus?: string | null;
};

function apiBase() {
  return getApiBase();
}
const IS_DEV = Boolean((import.meta as any).env?.DEV);
const DEV_SIMULATE = IS_DEV && String((import.meta as any).env?.VITE_DEV_ALLOW_SIMULATE_PAYMENTS || "") === "1";

async function fetchJson(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.error || json?.message || text || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

export default function TestPurchaseModal({
  open,
  onClose,
  contentId,
  manifestSha256,
  defaultAmountSats,
  storefrontStatus,
  contentStatus
}: Props) {
  const [amountSats, setAmountSats] = React.useState(defaultAmountSats || "1000");
  const [authToken, setAuthToken] = React.useState<string | null>(null);
  const [intentId, setIntentId] = React.useState<string | null>(null);
  const [bolt11, setBolt11] = React.useState<string | null>(null);
  const [onchainAddress, setOnchainAddress] = React.useState<string | null>(null);
  const [onchainReason, setOnchainReason] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [manualPayment, setManualPayment] = React.useState<{
    amountSats: number;
    intentId: string;
    destination: { type: string; value: string };
    memo: string;
    message?: string | null;
  } | null>(null);
  const [receiptToken, setReceiptToken] = React.useState<string | null>(null);
  const [unlockPayload, setUnlockPayload] = React.useState<any | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [bolt11Qr, setBolt11Qr] = React.useState<string | null>(null);
  const [onchainQr, setOnchainQr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setAuthToken(getToken());
      setAmountSats(defaultAmountSats || "1000");
      setIntentId(null);
      setBolt11(null);
      setOnchainAddress(null);
      setOnchainReason(null);
      setStatus(null);
      setManualPayment(null);
      setReceiptToken(null);
      setUnlockPayload(null);
      setError(null);
      setLoading(false);
      setBolt11Qr(null);
      setOnchainQr(null);
    }
  }, [open, defaultAmountSats]);

  React.useEffect(() => {
    if (!intentId || manualPayment) return;

    let statusTimer: number | null = null;
    let refreshTimer: number | null = null;
    let stopped = false;

    const pollStatus = async () => {
      try {
        const data = await fetchJson(`${apiBase()}/api/payments/intents/${intentId}`);
        if (stopped) return;
        setStatus(String(data?.status || ""));
        if (data?.receiptToken && !receiptToken) {
          setReceiptToken(String(data.receiptToken));
        }
      } catch (e: any) {
        if (!stopped) setError(e?.message || "Failed to get status");
      }
    };

    const refresh = async () => {
      try {
        const data = await fetchJson(`${apiBase()}/api/payments/intents/${intentId}/refresh`, { method: "POST" });
        if (stopped) return;
        setStatus(String(data?.status || ""));
        if (data?.receiptToken && !receiptToken) {
          setReceiptToken(String(data.receiptToken));
        }
      } catch (e: any) {
        if (!stopped) setError(e?.message || "Failed to refresh");
      }
    };

    pollStatus();
    statusTimer = window.setInterval(pollStatus, 3000);
    refreshTimer = window.setInterval(refresh, 10000);

    return () => {
      stopped = true;
      if (statusTimer) window.clearInterval(statusTimer);
      if (refreshTimer) window.clearInterval(refreshTimer);
    };
  }, [intentId, receiptToken, manualPayment]);

  React.useEffect(() => {
    if (status !== "paid") return;
    if (!manifestSha256) return;

    const run = async () => {
      try {
        if (authToken) {
          const data = await fetchJson(
            `${apiBase()}/api/content/${encodeURIComponent(contentId)}/access?manifestSha256=${encodeURIComponent(manifestSha256)}`,
            { headers: { Authorization: `Bearer ${authToken}` } }
          );
          setUnlockPayload(data);
          return;
        }
        if (!receiptToken) return;
        const url = `${apiBase()}/public/content/${encodeURIComponent(contentId)}/access?manifestSha256=${encodeURIComponent(
          manifestSha256
        )}&receiptToken=${encodeURIComponent(receiptToken)}`;
        const data = await fetchJson(url);
        setUnlockPayload(data);
      } catch (e: any) {
        setError(e?.message || "Failed to unlock");
      }
    };

    run();
  }, [receiptToken, status, contentId, manifestSha256, authToken]);

  React.useEffect(() => {
    let alive = true;
    const makeQr = async () => {
      try {
        if (bolt11) {
          const dataUrl = await QRCode.toDataURL(bolt11, { margin: 1, width: 140 });
          if (alive) setBolt11Qr(dataUrl);
        } else {
          if (alive) setBolt11Qr(null);
        }
        if (onchainAddress) {
          const dataUrl = await QRCode.toDataURL(onchainAddress, { margin: 1, width: 140 });
          if (alive) setOnchainQr(dataUrl);
        } else {
          if (alive) setOnchainQr(null);
        }
      } catch {
        if (alive) {
          setBolt11Qr(null);
          setOnchainQr(null);
        }
      }
    };
    makeQr();
    return () => {
      alive = false;
    };
  }, [bolt11, onchainAddress]);

  if (!open) return null;

  const storefrontBlocked = (storefrontStatus || "DISABLED") === "DISABLED";
  const notPublished = contentStatus !== "published";
  const missingManifest = !manifestSha256;
  const isAuthed = Boolean(authToken);
  const modeLabel = isAuthed ? "Private (authenticated)" : "Public storefront";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl rounded-xl border border-neutral-800 bg-neutral-950 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Test public purchase</div>
          <button className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-3 space-y-3 text-sm text-neutral-300">
          <div className="text-xs text-neutral-400">
            This tool validates the checkout plumbing. It prefers authenticated mode when you are signed in.
          </div>
          <div className="text-xs text-neutral-500">Mode: {modeLabel}</div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="block text-xs text-neutral-400 mb-1" htmlFor="test-purchase-amount">
                Amount (sats)
              </label>
              <input
                id="test-purchase-amount"
                name="testPurchaseAmount"
                className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 outline-none focus:border-neutral-600"
                value={amountSats}
                onChange={(e) => setAmountSats(e.target.value)}
                placeholder="1000"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Manifest</label>
              <div className="text-xs rounded-lg border border-neutral-800 px-3 py-2 bg-neutral-950/60 break-all">
                {manifestSha256 || "Missing"}
              </div>
            </div>
          </div>

          {((!isAuthed && storefrontBlocked) || notPublished || missingManifest) && (
            <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              {!isAuthed && storefrontBlocked && "Enable storefront (Unlisted or Listed) to test public purchase flow."}
              {!storefrontBlocked && notPublished && "Publish content to generate a manifest before purchase."}
              {!storefrontBlocked && !notPublished && missingManifest && "Manifest missing. Publish content to generate one."}
            </div>
          )}

          <button
            type="button"
            className="rounded-lg bg-white text-black font-medium px-3 py-2 disabled:opacity-60"
            disabled={loading || (!isAuthed && storefrontBlocked) || notPublished || missingManifest}
            onClick={async () => {
              setError(null);
              setLoading(true);
              setManualPayment(null);
              try {
                const payload = {
                  purpose: "CONTENT_PURCHASE",
                  subjectType: "CONTENT",
                  subjectId: contentId,
                  manifestSha256,
                  amountSats: String(amountSats || "0")
                };
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (authToken) headers.Authorization = `Bearer ${authToken}`;
                const data = await fetchJson(`${apiBase()}/api/payments/intents`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify(payload)
                });
                const nextIntentId = String(data?.intentId || "");
                const responseError =
                  data?.code || data?.error || (data?.message && !data?.lightning?.bolt11 && !data?.onchain?.address);
                if (data?.status === "manual_required") {
                  setIntentId(nextIntentId);
                  setBolt11(null);
                  setOnchainAddress(null);
                  setOnchainReason(null);
                  setStatus("manual_required");
                  setManualPayment({
                    amountSats: Number(data?.amountSats || 0),
                    intentId: nextIntentId,
                    destination: data?.destination || { type: "lightning_address", value: "" },
                    memo: String(data?.memo || ""),
                    message: data?.message || null
                  });
                } else if (responseError) {
                  const msg =
                    typeof responseError === "string"
                      ? responseError
                      : data?.code
                        ? `${String(data.code)}${data?.lightningReason ? `: ${String(data.lightningReason)}` : ""}`
                        : "Failed to create intent";
                  setError(msg);
                } else {
                  setIntentId(nextIntentId);
                  setBolt11(data?.lightning?.bolt11 || null);
                  setOnchainAddress(data?.onchain?.address || null);
                  setOnchainReason(data?.onchainReason || null);
                  setStatus("pending");
                }
              } catch (e: any) {
                setError(e?.message || "Failed to create intent");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Creating…" : "Create public intent"}
          </button>

          {error && <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">{error}</div>}

          {intentId && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 space-y-3">
              <div className="text-xs text-neutral-400">Intent: {intentId}</div>
              <div className="text-xs text-neutral-400">Payment status: {status || "pending"}</div>

              {manualPayment && (
                <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 space-y-2">
                  <div className="text-xs font-semibold text-amber-200">Manual payment required</div>
                  <div className="text-xs text-amber-100">Amount: {manualPayment.amountSats} sats</div>
                  <div className="text-xs text-amber-100">
                    Send to: <code className="text-amber-100 break-all">{manualPayment.destination?.value || ""}</code>
                  </div>
                  <div className="text-xs text-amber-100">
                    Memo: <code className="text-amber-100">{manualPayment.memo}</code>
                  </div>
                  {manualPayment.message ? (
                    <div className="text-xs text-amber-200">{manualPayment.message}</div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="text-xs rounded-lg border border-amber-800/60 px-2 py-1 hover:bg-amber-950/40"
                      onClick={() => navigator.clipboard.writeText(manualPayment.destination?.value || "")}
                    >
                      Copy address
                    </button>
                    <button
                      className="text-xs rounded-lg border border-amber-800/60 px-2 py-1 hover:bg-amber-950/40"
                      onClick={() => navigator.clipboard.writeText(manualPayment.memo)}
                    >
                      Copy memo
                    </button>
                  </div>
                  <div className="text-[11px] text-amber-300/80">
                    This Basic link does not generate invoices. Send manually from your wallet.
                  </div>
                </div>
              )}

              {bolt11 && (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                  <div className="text-xs text-neutral-400 mb-2">Lightning invoice</div>
                  <div className="flex flex-col md:flex-row gap-4">
                    {bolt11Qr ? (
                      <img src={bolt11Qr} alt="Lightning invoice QR" className="h-[140px] w-[140px] rounded bg-neutral-900" />
                    ) : (
                      <div className="h-[140px] w-[140px] rounded bg-neutral-900" />
                    )}
                    <div className="flex-1 space-y-2">
                      <div className="text-xs break-all text-neutral-300">{bolt11}</div>
                      <button
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        onClick={() => navigator.clipboard.writeText(bolt11)}
                      >
                        Copy invoice
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {onchainAddress ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                  <div className="text-xs text-neutral-400 mb-2">On-chain address</div>
                  <div className="flex flex-col md:flex-row gap-4">
                    {onchainQr ? (
                      <img src={onchainQr} alt="On-chain address QR" className="h-[140px] w-[140px] rounded bg-neutral-900" />
                    ) : (
                      <div className="h-[140px] w-[140px] rounded bg-neutral-900" />
                    )}
                    <div className="flex-1 space-y-2">
                      <div className="text-xs break-all text-neutral-300">{onchainAddress}</div>
                      <button
                        className="text-xs rounded-lg border border-neutral-800 px-2 py-1 hover:bg-neutral-900"
                        onClick={() => navigator.clipboard.writeText(onchainAddress)}
                      >
                        Copy address
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-xs text-neutral-400">
                  On-chain not configured: add BTC On-chain (XPUB) in Profile → Payment rails.
                  {onchainReason ? <div className="mt-1 text-neutral-500">Reason: {onchainReason}</div> : null}
                </div>
              )}

              {DEV_SIMULATE && (
                <button
                  className="text-xs rounded-lg border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-emerald-200"
                  onClick={async () => {
                    try {
                      const headers: Record<string, string> = { "Content-Type": "application/json" };
                      if (authToken) headers.Authorization = `Bearer ${authToken}`;
                      await fetchJson(`${apiBase()}/api/dev/simulate-pay`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ paymentIntentId: intentId, paidVia: "ONCHAIN" })
                      });
                      setStatus("paid");
                    } catch (e: any) {
                      setError(e?.message || "Failed to simulate payment");
                    }
                  }}
                >
                  Simulate paid
                </button>
              )}

              {status === "paid" && (
                <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
                  Paid — {receiptToken ? "unlocking…" : "waiting for receipt token"}
                </div>
              )}

              {unlockPayload && (
                <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                  <div className="text-xs text-neutral-400 mb-2">Unlocked payload</div>
                  <pre className="text-xs text-neutral-200 whitespace-pre-wrap break-words">{JSON.stringify(unlockPayload, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
