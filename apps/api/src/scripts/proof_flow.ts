import assert from "node:assert/strict";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
const EMAIL = process.env.EMAIL || "proof-test@example.com";
const PASSWORD = process.env.PASSWORD || "proof-test-strong-pass";

async function api<T>(path: string, method = "GET", body?: any, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data as T;
}

async function main() {
  let token = "";
  try {
    const signup = await api<any>("/auth/signup", "POST", { email: EMAIL, password: PASSWORD, displayName: "Proof Test" });
    token = signup.token;
  } catch (e: any) {
    if (String(e?.message || "").includes("email already in use")) {
      const login = await api<any>("/auth/login", "POST", { email: EMAIL, password: PASSWORD });
      token = login.token;
    } else {
      throw e;
    }
  }

  const content = await api<any>("/content", "POST", { title: "Proof Test Content", type: "file" }, token);

  const fd = new FormData();
  const blob = new Blob([Buffer.from("hello-proof")], { type: "text/plain" });
  fd.append("file", blob, "hello.txt");
  await api<any>(`/content/${content.id}/files`, "POST", fd, token);

  await api(`/content/${content.id}/splits`, "POST", {
    participants: [{ participantEmail: EMAIL, role: "writer", percent: 100 }]
  }, token);

  const lock = await api<any>(`/content/${content.id}/splits/v1/lock`, "POST", {}, token);
  assert.ok(lock.proofHash, "lock should return proofHash");

  const proof = await api<any>(`/content/${content.id}/splits/v1/proof`, "GET", undefined, token);
  assert.equal(proof?.payload?.contentId, content.id, "proof payload contentId should match");

  console.log("proof_flow OK", { proofHash: proof.proofHash, manifestHash: proof.manifestHash, splitsHash: proof.splitsHash });
}

main().catch((e) => {
  console.error("proof_flow failed", e);
  process.exit(1);
});
