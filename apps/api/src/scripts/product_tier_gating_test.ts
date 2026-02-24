import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "http://127.0.0.1:4000").replace(/\/$/, "");

type ProbeResult = {
  healthOk: boolean;
  diagnosticsStatus?: number;
  identityStatus?: number;
  publicDiagnosticsStatus?: number;
  effectiveTier: "basic" | "advanced" | "lan";
  namedReady: boolean;
  notes: string[];
};

type CheckResult = { name: string; status: "PASS" | "SKIP" | "FAIL"; reason?: string };

async function postJson(url: string, body: any, token?: string | null) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function getJson(url: string, token?: string | null) {
  const res = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function inferTierFromIdentity(identity: any): "basic" | "advanced" | "lan" | null {
  const tier = String(identity?.productTier || "").toLowerCase();
  if (tier === "basic" || tier === "advanced" || tier === "lan") return tier;
  const nodeMode = String(identity?.nodeMode || "").toLowerCase();
  if (nodeMode === "basic" || nodeMode === "advanced" || nodeMode === "lan") return nodeMode;
  return null;
}

function inferNamedReadyFromDiagnostics(diag: any): boolean {
  if (typeof diag?.namedReady === "boolean") return diag.namedReady;
  const mode = String(diag?.publicStatus?.mode || "").toLowerCase();
  const status = String(diag?.publicStatus?.status || "").toLowerCase();
  return mode === "named" && status === "online";
}

async function probe(): Promise<ProbeResult> {
  const notes: string[] = [];

  const health = await getJson(`${baseUrl}/health`);
  if (!health.status || health.status >= 400) {
    return { healthOk: false, effectiveTier: "advanced", namedReady: false, notes: ["/health failed"] };
  }

  let publicDiagnosticsStatus: number | undefined;
  let publicDiagnostics: any = null;
  try {
    const pub = await getJson(`${baseUrl}/api/public/diagnostics`);
    publicDiagnosticsStatus = pub.status;
    if (pub.status === 200) publicDiagnostics = pub.json;
    else notes.push(`/api/public/diagnostics error (${pub.status})`);
  } catch {
    notes.push("/api/public/diagnostics unavailable");
  }

  let diagnosticsStatus: number | undefined;
  let diagnostics: any = null;
  try {
    const diag = await getJson(`${baseUrl}/api/diagnostics/status`);
    diagnosticsStatus = diag.status;
    if (diag.status === 200) diagnostics = diag.json;
    else notes.push(`/api/diagnostics/status protected (${diag.status})`);
  } catch {
    notes.push("/api/diagnostics/status unavailable");
  }

  let identityStatus: number | undefined;
  let identity: any = null;
  try {
    const id = await getJson(`${baseUrl}/api/identity`);
    identityStatus = id.status;
    if (id.status === 200) identity = id.json;
    else notes.push(`/api/identity protected (${id.status})`);
  } catch {
    notes.push("/api/identity unavailable");
  }

  let effectiveTier: "basic" | "advanced" | "lan" = "advanced";
  let namedReady = false;

  if (publicDiagnostics) {
    const tier = String(publicDiagnostics?.productTier || "").toLowerCase();
    if (tier === "basic" || tier === "advanced" || tier === "lan") effectiveTier = tier as any;
    namedReady = inferNamedReadyFromDiagnostics(publicDiagnostics);
  } else if (diagnostics) {
    const tier = String(diagnostics?.productTier || diagnostics?.PRODUCT_TIER || "").toLowerCase();
    if (tier === "basic" || tier === "advanced" || tier === "lan") effectiveTier = tier as any;
    namedReady = inferNamedReadyFromDiagnostics(diagnostics);
  } else if (identity) {
    const tier = inferTierFromIdentity(identity);
    if (tier) effectiveTier = tier;
    if (typeof identity?.namedReady === "boolean") namedReady = identity.namedReady;
  } else {
    const envTier = String(process.env.PRODUCT_TIER || "").toLowerCase();
    if (envTier === "basic" || envTier === "advanced" || envTier === "lan") effectiveTier = envTier as any;
    namedReady = false;
    notes.push("Falling back to env/default tier (no diagnostics/identity)");
  }

  return {
    healthOk: true,
    diagnosticsStatus,
    identityStatus,
    publicDiagnosticsStatus,
    effectiveTier,
    namedReady,
    notes
  };
}

async function trySignup(effectiveTier: string) {
  if (effectiveTier !== "basic") return { attempted: false, token: null, status: null, reason: "tier not basic" };
  const res = await postJson(`${baseUrl}/auth/signup`, {
    email: `tier+${Date.now()}@contentbox.local`,
    password: "password123"
  });
  if (res.status === 200 && res.json?.token) return { attempted: true, token: res.json.token, status: res.status };
  if (res.status === 401 || res.status === 403) {
    return { attempted: true, token: null, status: res.status, reason: "signup blocked" };
  }
  return { attempted: true, token: null, status: res.status, reason: "unexpected signup response" };
}

async function expect403Code(path: string, expectedCode: string, token?: string | null) {
  const res = await postJson(`${baseUrl}${path}`, {}, token);
  if (res.status !== 403) {
    throw new Error(`Expected 403 for ${path}, got ${res.status}`);
  }
  if (res.json?.code !== expectedCode) {
    throw new Error(`Expected code ${expectedCode} for ${path}, got ${res.json?.code}`);
  }
}

async function expectPublicCanPublish(payload: any, expectedCode: string) {
  const res = await postJson(`${baseUrl}/api/public/can-publish`, payload);
  if (res.status !== 403) {
    throw new Error(`Expected 403 for can-publish, got ${res.status}`);
  }
  if (res.json?.code !== expectedCode) {
    throw new Error(`Expected code ${expectedCode}, got ${res.json?.code}`);
  }
}

async function run() {
  const checks: CheckResult[] = [];
  const probeResult = await probe();

  console.log("product_tier_gating_test probe summary:");
  console.log({
    healthOk: probeResult.healthOk,
    publicDiagnosticsStatus: probeResult.publicDiagnosticsStatus,
    diagnosticsStatus: probeResult.diagnosticsStatus,
    identityStatus: probeResult.identityStatus,
    effectiveTier: probeResult.effectiveTier,
    namedReady: probeResult.namedReady,
    notes: probeResult.notes
  });

  if (!probeResult.healthOk) {
    console.error("/health failed; aborting test.");
    process.exit(1);
  }

  const signup = await trySignup(probeResult.effectiveTier);
  console.log("signup:", signup);

  const token = signup.token as string | null;

  let contentId: string | null = null;
  let derivativeId: string | null = null;

  if (token) {
    const created = await postJson(
      `${baseUrl}/content`,
      { title: `[test] tier ${Date.now()}`, type: "song" },
      token
    );
    assert.equal(created.status, 200, `content create failed: ${created.status}`);
    contentId = created.json?.id as string | undefined || null;

    const derivative = await postJson(
      `${baseUrl}/content`,
      { title: `[test] derivative ${Date.now()}`, type: "remix" },
      token
    );
    assert.equal(derivative.status, 200, `derivative create failed: ${derivative.status}`);
    derivativeId = derivative.json?.id as string | undefined || null;
  }

  // Public can-publish checks (no auth)
  try {
    await expectPublicCanPublish(
      {
        productTier: "advanced",
        namedReady: false,
        isDerivative: false,
        clearanceCleared: false,
        forSale: true,
        paymentsMode: "node",
        paymentsReady: true,
        splitLocked: true,
        targetLocked: true,
        publishKind: "public_buy_link"
      },
      "advanced_not_active"
    );
    checks.push({ name: "public can-publish advanced_not_active", status: "PASS" });
  } catch (e: any) {
    checks.push({ name: "public can-publish advanced_not_active", status: "FAIL", reason: e?.message || String(e) });
  }

  try {
    await expectPublicCanPublish(
      {
        productTier: "basic",
        namedReady: false,
        isDerivative: true,
        clearanceCleared: false,
        forSale: true,
        paymentsMode: "wallet",
        paymentsReady: true,
        splitLocked: false,
        targetLocked: false,
        publishKind: "public_buy_link"
      },
      "derivative_requires_advanced_clearance"
    );
    checks.push({ name: "public can-publish basic derivative blocked", status: "PASS" });
  } catch (e: any) {
    checks.push({ name: "public can-publish basic derivative blocked", status: "FAIL", reason: e?.message || String(e) });
  }

  // Auth-backed checks (if token exists)
  if (probeResult.effectiveTier === "advanced" && !probeResult.namedReady) {
    if (token && contentId) {
      try {
        await expect403Code(`/api/content/${contentId}/publish`, "advanced_not_active", token);
        checks.push({ name: "advanced_not_active publish", status: "PASS" });
      } catch (e: any) {
        checks.push({ name: "advanced_not_active publish", status: "FAIL", reason: e?.message || String(e) });
      }
    } else {
      checks.push({ name: "advanced_not_active publish", status: "SKIP", reason: "no token/content" });
    }
  }

  if (probeResult.effectiveTier === "basic") {
    if (token && derivativeId) {
      try {
        await expect403Code(`/api/content/${derivativeId}/share-link`, "basic_public_only", token);
        checks.push({ name: "basic share-link blocked", status: "PASS" });
      } catch (e: any) {
        checks.push({ name: "basic share-link blocked", status: "FAIL", reason: e?.message || String(e) });
      }
    } else {
      checks.push({ name: "basic share-link blocked", status: "SKIP", reason: "no token/content" });
    }
  }

  if (probeResult.effectiveTier === "basic") {
    if (token && contentId) {
      try {
        await expect403Code(`/api/content/${contentId}/share-link`, "basic_public_only", token);
        checks.push({ name: "basic share-link create blocked", status: "PASS" });
      } catch (e: any) {
        checks.push({ name: "basic share-link create blocked", status: "FAIL", reason: e?.message || String(e) });
      }
    } else {
      checks.push({ name: "basic share-link create blocked", status: "SKIP", reason: "no token/content" });
    }
  }

  if (probeResult.effectiveTier !== "basic") {
    if (token && derivativeId) {
      try {
        await expect403Code(`/api/content/${derivativeId}/publish`, "derivative_requires_advanced_clearance", token);
        checks.push({ name: "derivative publish requires clearance", status: "PASS" });
      } catch (e: any) {
        if (probeResult.effectiveTier === "advanced" && !probeResult.namedReady) {
          checks.push({ name: "derivative publish requires clearance", status: "SKIP", reason: "advanced inactive" });
        } else {
          checks.push({ name: "derivative publish requires clearance", status: "FAIL", reason: e?.message || String(e) });
        }
      }
    } else {
      checks.push({ name: "derivative publish requires clearance", status: "SKIP", reason: "no token/content" });
    }
  }

  console.log("product_tier_gating_test results:");
  for (const c of checks) {
    console.log(`${c.status}: ${c.name}${c.reason ? ` (${c.reason})` : ""}`);
  }

  const failed = checks.find((c) => c.status === "FAIL");
  if (failed) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("product_tier_gating_test FAILED", err);
  process.exit(1);
});
