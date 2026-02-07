export type HealthPath = "/health" | "/api/health" | "/public/health";

export type ProbeErrorType =
  | "FETCH_FAILED"
  | "TIMEOUT"
  | "BAD_STATUS"
  | "INVALID_URL";

export type ProbeResult = {
  ok: boolean;
  url: string;
  status?: number;
  latencyMs?: number;
  errorType?: ProbeErrorType;
  errorMessage?: string;
};

export type HostCandidate = {
  label: string;
  origin: string;
};

function normalizeHost(host: string): string {
  return (host || "").trim();
}

function normalizePort(port?: number | string | null): string {
  return (port ?? "").toString().trim();
}

function safeOriginFromHostPort(host: string, port?: number | string | null): string | null {
  const h = normalizeHost(host);
  if (!h) return null;
  const p = normalizePort(port);
  if (h.startsWith("http://") || h.startsWith("https://")) return h.replace(/\/+$/, "");
  const portPart = p ? `:${p}` : "";
  return `https://${h}${portPart}`;
}

/**
 * StorePage expects:
 * buildHostCandidates(link.host, link.port, { sharedFallbackHost })
 */
export function buildHostCandidates(
  host: string | null | undefined,
  port: number | string | null | undefined,
  opts?: { sharedFallbackHost?: string | null }
): HostCandidate[] {
  const out: HostCandidate[] = [];

  const primary = safeOriginFromHostPort(host || "", port);
  if (primary) out.push({ label: "Primary", origin: primary });

  const fallbackHost = normalizeHost(opts?.sharedFallbackHost || "");
  if (fallbackHost) {
    const fb = safeOriginFromHostPort(fallbackHost, port);
    if (fb) out.push({ label: "Fallback", origin: fb });
  }

  return out;
}

export async function probeHealth(args: {
  origin: string;
  path?: HealthPath;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const path: HealthPath = args.path || "/health";
  const timeoutMs = args.timeoutMs ?? 3500;

  let url: string;
  try {
    url = new URL(path, args.origin.endsWith("/") ? args.origin : args.origin + "/").toString();
  } catch (e: any) {
    return {
      ok: false,
      url: `${args.origin}${path}`,
      errorType: "INVALID_URL",
      errorMessage: e?.message || "Invalid URL",
    };
  }

  const controller = new AbortController();
  const t0 = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    const latencyMs = Date.now() - t0;
    clearTimeout(timer);

    if (!res.ok) return { ok: false, url, status: res.status, latencyMs, errorType: "BAD_STATUS" };
    return { ok: true, url, status: res.status, latencyMs };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = e?.message || String(e);
    const isAbort = msg.toLowerCase().includes("abort");
    return {
      ok: false,
      url,
      errorType: isAbort ? "TIMEOUT" : "FETCH_FAILED",
      errorMessage: msg,
    };
  }
}
