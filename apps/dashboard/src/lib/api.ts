import { getToken } from "./auth";

const API_BASE = ((import.meta as any).env?.VITE_API_URL || "http://127.0.0.1:4000").replace(/\/$/, "");

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

  const url = `${API_BASE}${path}`;
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
