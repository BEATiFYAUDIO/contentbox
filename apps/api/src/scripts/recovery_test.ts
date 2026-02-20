const BASE = process.env.API_BASE || "http://127.0.0.1:4000";

function randomEmail() {
  const n = Math.random().toString(36).slice(2, 10);
  return `recovery_${n}@example.com`;
}

async function fetchJson(path: string, opts?: any) {
  const res = await fetch(BASE + path, {
    method: opts?.method || "GET",
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    body: opts?.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function main() {
  const health = await fetch(BASE + "/health").then((r) => r.ok).catch(() => false);
  if (!health) {
    console.error("[recovery_test] FAIL: /health not ok");
    process.exit(1);
  }

  const email = randomEmail();
  const password = "password12345";
  const newPassword = "password54321";

  const signup = await fetchJson("/auth/signup", {
    method: "POST",
    body: { email, password, displayName: "Recovery Test" }
  });

  if (signup.res.status === 403 && signup.data?.error === "SINGLE_IDENTITY_NODE") {
    console.log("[recovery_test] SKIP: single-identity node blocks signup");
    process.exit(0);
  }

  if (!signup.res.ok) {
    console.error("[recovery_test] FAIL: signup failed", signup.res.status, signup.data);
    process.exit(1);
  }

  const recoveryKey = signup.data?.recoveryKey;
  if (!recoveryKey) {
    console.error("[recovery_test] FAIL: recoveryKey missing on first signup");
    process.exit(1);
  }

  const login = await fetchJson("/auth/login", { method: "POST", body: { email, password } });
  if (!login.res.ok || !login.data?.token) {
    console.error("[recovery_test] FAIL: login failed", login.res.status, login.data);
    process.exit(1);
  }
  const oldToken = login.data.token;

  const wrongReset = await fetchJson("/auth/recovery/reset", {
    method: "POST",
    body: { email, recoveryKey: "WRONGKEY", newPassword }
  });
  if (wrongReset.res.status !== 403 || wrongReset.data?.code !== "invalid_recovery_key") {
    console.error("[recovery_test] FAIL: wrong key not rejected", wrongReset.res.status, wrongReset.data);
    process.exit(1);
  }

  const goodReset = await fetchJson("/auth/recovery/reset", {
    method: "POST",
    body: { email, recoveryKey, newPassword }
  });
  if (!goodReset.res.ok || !goodReset.data?.token) {
    console.error("[recovery_test] FAIL: reset failed", goodReset.res.status, goodReset.data);
    process.exit(1);
  }

  const meOld = await fetchJson("/me", { headers: { Authorization: `Bearer ${oldToken}` } });
  if (meOld.res.status !== 401) {
    console.error("[recovery_test] FAIL: old token should be revoked", meOld.res.status, meOld.data);
    process.exit(1);
  }

  const loginNew = await fetchJson("/auth/login", { method: "POST", body: { email, password: newPassword } });
  if (!loginNew.res.ok || !loginNew.data?.token) {
    console.error("[recovery_test] FAIL: new login failed", loginNew.res.status, loginNew.data);
    process.exit(1);
  }

  console.log("[recovery_test] PASS");
}

main().catch((e) => {
  console.error("[recovery_test] FAIL", e);
  process.exit(1);
});
