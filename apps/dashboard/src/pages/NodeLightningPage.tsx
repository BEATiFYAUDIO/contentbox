import { useEffect, useState } from "react";
import { api } from "../lib/api";
import PaymentRailsPage from "./PaymentRailsPage";

type NodeLightningPageProps = {
  legacyRoute?: boolean;
  tunnelActive: boolean | null;
  identityVerified: boolean | null;
  lightningConfigured: boolean | null;
};

type LightningAdminConfig = {
  configured: boolean;
  restUrl: string | null;
  network: string | null;
  lastTestedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  defaults?: {
    restUrl?: string | null;
    tlsCertPath?: string | null;
    macaroonPath?: string | null;
  };
};

type LightningTestResult =
  | { ok: true; info: { alias: string; version: string; identityPubkey: string } }
  | { ok: false; error: string };

type LightningDiscoverResult =
  | { ok: true; candidates: Array<{ restUrl: string; requiresTlsCertHint?: boolean; notes?: string }> }
  | { ok: false; error: string };

function statusText(value: boolean | null, positive: string, negative: string) {
  if (value === null) return "Unknown";
  return value ? positive : negative;
}

export default function NodeLightningPage({
  legacyRoute = false,
  tunnelActive,
  identityVerified,
  lightningConfigured
}: NodeLightningPageProps) {
  const [railsRefreshTick, setRailsRefreshTick] = useState(0);
  const [lndRestUrl, setLndRestUrl] = useState("https://127.0.0.1:8080");
  const [lndNetwork, setLndNetwork] = useState<"mainnet" | "testnet" | "regtest">("mainnet");
  const [macaroonFile, setMacaroonFile] = useState<File | null>(null);
  const [macaroonFileName, setMacaroonFileName] = useState<string | null>(null);
  const [tlsCertFile, setTlsCertFile] = useState<File | null>(null);
  const [tlsCertFileName, setTlsCertFileName] = useState<string | null>(null);
  const [macaroonPath, setMacaroonPath] = useState("");
  const [tlsCertPath, setTlsCertPath] = useState("");
  const [wizardBusy, setWizardBusy] = useState<null | "discover" | "test" | "save" | "reset">(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardTest, setWizardTest] = useState<LightningTestResult | null>(null);
  const [wizardCandidates, setWizardCandidates] = useState<Array<{ restUrl: string; requiresTlsCertHint?: boolean; notes?: string }>>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const admin = await api<LightningAdminConfig>("/api/admin/lightning", "GET");
        if (!active || !admin) return;
        if (admin.restUrl) setLndRestUrl(admin.restUrl);
        else if (admin.defaults?.restUrl) setLndRestUrl(String(admin.defaults.restUrl));
        if (admin.network === "mainnet" || admin.network === "testnet" || admin.network === "regtest") {
          setLndNetwork(admin.network);
        }
        if (admin.defaults?.macaroonPath) setMacaroonPath(String(admin.defaults.macaroonPath));
        if (admin.defaults?.tlsCertPath) setTlsCertPath(String(admin.defaults.tlsCertPath));
      } catch {
        // keep defaults
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function onDiscoverLightning() {
    setWizardError(null);
    setWizardTest(null);
    setWizardBusy("discover");
    try {
      const res = await api<LightningDiscoverResult>("/api/admin/lightning/discover", "POST");
      if (!res.ok) {
        setWizardError(res.error || "Auto-detect failed");
        setWizardCandidates([]);
        return;
      }
      setWizardCandidates(Array.isArray(res.candidates) ? res.candidates : []);
      if (res.candidates?.[0]?.restUrl) setLndRestUrl(res.candidates[0].restUrl);
    } catch (e: any) {
      setWizardError(e?.message || "Auto-detect failed");
    } finally {
      setWizardBusy(null);
    }
  }

  async function onTestLightning() {
    setWizardError(null);
    setWizardTest(null);
    if (!lndRestUrl.trim()) return setWizardError("LND REST URL is required.");
    if (!macaroonFile && !macaroonPath.trim()) return setWizardError("Macaroon file or path is required.");
    setWizardBusy("test");
    try {
      const form = new FormData();
      form.append("restUrl", lndRestUrl.trim());
      form.append("network", lndNetwork);
      if (macaroonFile) form.append("macaroonFile", macaroonFile, macaroonFile.name || "invoice.macaroon");
      if (macaroonPath.trim()) form.append("macaroonPath", macaroonPath.trim());
      if (tlsCertFile) form.append("tlsCertFile", tlsCertFile, tlsCertFile.name || "tls-cert.pem");
      if (tlsCertPath.trim()) form.append("tlsCertPath", tlsCertPath.trim());
      const res = await api<LightningTestResult>("/api/admin/lightning/test", { method: "POST", body: form });
      setWizardTest(res);
      if (!res.ok) setWizardError(res.error || "Connection test failed");
    } catch (e: any) {
      setWizardError(e?.message || "Connection test failed");
    } finally {
      setWizardBusy(null);
    }
  }

  async function onSaveLightning() {
    setWizardError(null);
    if (!lndRestUrl.trim()) return setWizardError("LND REST URL is required.");
    if (!macaroonFile && !macaroonPath.trim()) return setWizardError("Macaroon file or path is required.");
    setWizardBusy("save");
    try {
      const form = new FormData();
      form.append("restUrl", lndRestUrl.trim());
      form.append("network", lndNetwork);
      if (macaroonFile) form.append("macaroonFile", macaroonFile, macaroonFile.name || "invoice.macaroon");
      if (macaroonPath.trim()) form.append("macaroonPath", macaroonPath.trim());
      if (tlsCertFile) form.append("tlsCertFile", tlsCertFile, tlsCertFile.name || "tls-cert.pem");
      if (tlsCertPath.trim()) form.append("tlsCertPath", tlsCertPath.trim());
      const res = await api<{ ok: boolean; error?: string }>("/api/admin/lightning", { method: "POST", body: form });
      if (!res.ok) {
        setWizardError(res.error || "Save failed");
        return;
      }
      setRailsRefreshTick((t) => t + 1);
    } catch (e: any) {
      setWizardError(e?.message || "Save failed");
    } finally {
      setWizardBusy(null);
    }
  }

  async function onResetLightning() {
    if (!window.confirm("Reset Lightning config?")) return;
    setWizardError(null);
    setWizardBusy("reset");
    try {
      await api<{ ok: boolean }>("/api/admin/lightning", "DELETE");
      setMacaroonFile(null);
      setMacaroonFileName(null);
      setTlsCertFile(null);
      setTlsCertFileName(null);
      setMacaroonPath("");
      setTlsCertPath("");
      setWizardTest(null);
      setRailsRefreshTick((t) => t + 1);
    } catch (e: any) {
      setWizardError(e?.message || "Reset failed");
    } finally {
      setWizardBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {legacyRoute ? (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-200">
          <div className="font-medium">Legacy route detected. Use this page for Lightning configuration and runtime.</div>
        </div>
      ) : null}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/20 p-6">
        <div className="text-lg font-semibold">Node Settings · Lightning</div>
        <div className="text-sm text-neutral-400 mt-1">Configure LND directly here: URL, macaroon, TLS cert, and readiness test.</div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Node Status</div>
          <div className="mt-2 grid gap-2 text-sm text-neutral-200 sm:grid-cols-3">
            <div>Tunnel: {statusText(tunnelActive, "Active", "Inactive")}</div>
            <div>Identity: {statusText(identityVerified, "Verified", "Not verified")}</div>
            <div>Lightning: {statusText(lightningConfigured, "Configured", "Not configured")}</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
          <div className="text-sm font-semibold text-neutral-100">Lightning Configuration</div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs text-neutral-400">LND REST URL</label>
              <input value={lndRestUrl} onChange={(e) => setLndRestUrl(e.target.value)} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm" placeholder="https://127.0.0.1:8080" />
            </div>
            <div>
              <label className="text-xs text-neutral-400">Network</label>
              <select value={lndNetwork} onChange={(e) => setLndNetwork(e.target.value as "mainnet" | "testnet" | "regtest")} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm">
                <option value="mainnet">mainnet</option>
                <option value="testnet">testnet</option>
                <option value="regtest">regtest</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-400">Macaroon (.macaroon)</label>
              <input type="file" accept=".macaroon,application/octet-stream" onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setMacaroonFile(f);
                setMacaroonFileName(f?.name || null);
              }} className="mt-1 w-full text-xs" />
              <div className="mt-1 text-[11px] text-neutral-500">{macaroonFileName || "No file selected"}</div>
            </div>
            <div>
              <label className="text-xs text-neutral-400">Macaroon path (optional)</label>
              <input
                value={macaroonPath}
                onChange={(e) => setMacaroonPath(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
                placeholder="C:\\Users\\...\\AppData\\Local\\Lnd\\data\\chain\\bitcoin\\mainnet\\admin.macaroon"
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400">TLS cert (.pem/.crt, optional)</label>
              <input type="file" accept=".pem,.crt,application/x-pem-file,application/pkix-cert" onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setTlsCertFile(f);
                setTlsCertFileName(f?.name || null);
              }} className="mt-1 w-full text-xs" />
              <div className="mt-1 text-[11px] text-neutral-500">{tlsCertFileName || "No file selected"}</div>
            </div>
            <div>
              <label className="text-xs text-neutral-400">TLS cert path (optional)</label>
              <input
                value={tlsCertPath}
                onChange={(e) => setTlsCertPath(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
                placeholder="C:\\Users\\...\\AppData\\Local\\Lnd\\tls.cert"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onDiscoverLightning} disabled={wizardBusy !== null} className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900 disabled:opacity-50">{wizardBusy === "discover" ? "Detecting..." : "Auto-detect"}</button>
            <button onClick={onTestLightning} disabled={wizardBusy !== null} className="rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900 disabled:opacity-50">{wizardBusy === "test" ? "Testing..." : "Test"}</button>
            <button onClick={onSaveLightning} disabled={wizardBusy !== null} className="rounded border border-cyan-700 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-900/20 disabled:opacity-50">{wizardBusy === "save" ? "Saving..." : "Save"}</button>
            <button onClick={onResetLightning} disabled={wizardBusy !== null} className="rounded border border-amber-700 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/20 disabled:opacity-50">{wizardBusy === "reset" ? "Resetting..." : "Reset"}</button>
          </div>

          {wizardCandidates.length > 0 ? (
            <div className="mt-3 rounded border border-neutral-800 bg-neutral-900/40 p-2 text-xs">
              <div className="text-neutral-300 mb-1">Detected endpoints</div>
              <div className="space-y-1">
                {wizardCandidates.map((c) => (
                  <button key={c.restUrl} onClick={() => setLndRestUrl(c.restUrl)} className="block w-full rounded border border-neutral-800 px-2 py-1 text-left hover:bg-neutral-900">
                    {c.restUrl}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {wizardTest ? (
            <div className={["mt-3 rounded border p-2 text-xs", wizardTest.ok ? "border-emerald-800/60 bg-emerald-950/20 text-emerald-200" : "border-amber-800/60 bg-amber-950/20 text-amber-200"].join(" ")}>
              {wizardTest.ok ? `Connected: ${wizardTest.info.alias} (${wizardTest.info.version})` : wizardTest.error}
            </div>
          ) : null}
          {wizardError ? <div className="mt-2 text-xs text-amber-300">{wizardError}</div> : null}
        </div>
      </div>

      <PaymentRailsPage refreshSignal={railsRefreshTick} />
    </div>
  );
}
