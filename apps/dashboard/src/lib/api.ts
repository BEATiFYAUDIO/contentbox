import { getToken } from "./auth";

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function resolveApiBase(): string {
  const envBase =
    ((import.meta as any).env?.VITE_API_BASE_URL || (import.meta as any).env?.VITE_API_URL || "")
      .toString()
      .trim();

  try {
    const origin = window.location.origin;
    const hostname = window.location.hostname;
    const port = window.location.port;
    const isDevUi = port === "5173" || port === "5174";
    if (isDevUi && isLocalHost(hostname)) {
      // In local dev, default to local API unless user explicitly overrides.
      return "http://127.0.0.1:4000";
    }
    if (envBase) return envBase.replace(/\/$/, "");
    return origin.replace(/\/$/, "");
  } catch {
    return envBase ? envBase.replace(/\/$/, "") : "http://127.0.0.1:4000";
  }
}

const STORAGE_API_BASE = "contentbox.apiBase";
const STORAGE_AUTO_FIX = "contentbox.apiBase.autoFixed";
const STORAGE_SHOW_ADVANCED = "contentbox.showAdvancedNav";

function readStoredApiBase(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_API_BASE) || "";
  } catch {
    return "";
  }
}

function isAdvancedEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_SHOW_ADVANCED) === "1";
  } catch {
    return false;
  }
}

function clearStoredApiBase(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_API_BASE);
  } catch {}
}

function isPrivateHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
  const m = hostname.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    return n >= 16 && n <= 31;
  }
  return false;
}

function shouldAutoFixApiBase(currentBase: string): boolean {
  if (typeof window === "undefined") return false;
  const uiHost = window.location.hostname || "";
  if (!isLocalHost(uiHost)) return false;
  if (isAdvancedEnabled()) return false;
  const stored = readStoredApiBase();
  if (!stored) return false;
  try {
    const apiHost = new URL(currentBase).hostname;
    return isPrivateHost(apiHost) && !isLocalHost(apiHost);
  } catch {
    return false;
  }
}

function markAutoFix(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_AUTO_FIX, "1");
  } catch {}
}

function alreadyAutoFixed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_AUTO_FIX) === "1";
  } catch {
    return false;
  }
}

function normalizeBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function getApiBase(): string {
  const stored = normalizeBase(readStoredApiBase());
  const resolved = resolveApiBase();
  const base = stored || resolved;
  if (shouldAutoFixApiBase(base) && !alreadyAutoFixed()) {
    clearStoredApiBase();
    markAutoFix();
    return resolveApiBase();
  }
  return base;
}

type ApiOptions = {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
};

export async function api<T>(path: string, methodOrOptions: string | ApiOptions = "GET", bodyArg?: any): Promise<T> {
  const token = getToken();

  // Determine method, body, and extra headers based on input
  let method: string;
  let body: any;
  let extraHeaders: Record<string, string> = {};

  if (typeof methodOrOptions === "string") {
    method = methodOrOptions;
    body = bodyArg;
  } else {
    method = (methodOrOptions.method || "GET").toUpperCase().trim();
    body = methodOrOptions.body;
    extraHeaders = methodOrOptions.headers || {};
  }

  // Validate method
  if (typeof method !== "string") {
    throw new Error(`api(): "method" must be a string (e.g. "GET"), got ${typeof method}`);
  }

  // Prepare headers
  const headers: Record<string, string> = {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Only set Content-Type if the body is not FormData
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  // Prepare body (stringify if not FormData)
  const hasBody = body !== undefined && body !== null;
  const requestBody = hasBody ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined;

  const normalizedPath = path.startsWith("/api/auth") ? path.replace(/^\/api\/auth/, "/auth") : path;
  const url = `${getApiBase()}${normalizedPath}`;
  // Make the API request
  const res = await fetch(url, {
    method,
    headers,
    body: requestBody,
  });

  // Parse the response
  const text = await res.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;  // Return raw text if it's not JSON
  }

  // Handle non-2xx responses
  if (!res.ok) {
    if (res.status === 401 && shouldAutoFixApiBase(API_BASE) && !alreadyAutoFixed()) {
      clearStoredApiBase();
      markAutoFix();
      try {
        window.location.reload();
      } catch {}
    }
    const payload = data ?? text;
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    const err = new Error(`[${method} ${url}] ${res.status} ${res.statusText} :: ${detail}`);
    console.error("API Error:", {
      url,
      method,
      status: res.status,
      statusText: res.statusText,
      payload
    });
    throw err;
  }

  return data as T;
}

export default api;
