import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerPublicGoRoute, registerPublicStopRoute } from "./publicGoRoute.js";
import { AsyncLifecycleMutex, type QuickStartDependencies } from "./publicLifecycle.js";

type Failure = "listener" | "preparation" | "tunnel" | null;

function routeHarness(input: { namedConflict?: boolean; failure?: Failure; environmentMode?: "quick" | "named" } = {}) {
  const state = {
    mode: null as "off" | "quick" | null,
    autoStart: false,
    consent: false,
    listener: false,
    listenerHost: null as string | null,
    listenerPort: null as number | null,
    tunnel: false,
    tunnelTarget: null as string | null,
    spawns: 0
  };
  const quick = (): QuickStartDependencies => ({
    validate: async () =>
      input.namedConflict
        ? { ok: false, code: "named_configured", message: "Named tunnel configured." }
        : { ok: true },
    hasConsent: () => state.consent,
    grantConsent: () => {
      state.consent = true;
    },
    snapshot: () => ({ mode: state.mode, autoStart: state.autoStart }),
    setMode: (mode) => {
      state.mode = mode;
    },
    setAutoStart: (enabled) => {
      state.autoStart = enabled;
    },
    startListener: async () => {
      if (input.failure === "listener") throw new Error("EADDRINUSE");
      state.listenerHost = "127.0.0.1";
      state.listenerPort = 4010;
      state.listener = true;
    },
    stopListener: async () => {
      state.listener = false;
      state.listenerHost = null;
      state.listenerPort = null;
    },
    prepareTunnel: async () =>
      input.failure === "preparation" ? { ok: false, error: "download failed" } : { ok: true },
    startTunnel: async () => {
      state.spawns += 1;
      state.tunnelTarget = "http://127.0.0.1:4010";
      state.tunnel = true;
      return input.failure === "tunnel"
        ? { status: "ERROR", lastError: "no URL" }
        : { status: "ACTIVE", publicOrigin: "https://route-test.trycloudflare.com" };
    },
    stopTunnel: async () => {
      state.tunnel = false;
      state.tunnelTarget = null;
    }
  });

  const app = Fastify();
  const requireAuth = async (request: any, reply: any) => {
    if (request.headers.authorization !== "Bearer route-test") {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  };
  const status = () => ({
    mode: selection().mode,
    status: state.tunnel ? "online" : "offline",
    publicOrigin: state.tunnel ? "https://route-test.trycloudflare.com" : null,
    autoStartEnabled: state.autoStart,
    consentRequired: !state.consent
  });
  const selection = () => {
    if (input.environmentMode) return { mode: input.environmentMode, source: "environment" as const };
    if (state.mode) return { mode: state.mode, source: "user" as const };
    if (state.consent && state.autoStart) return { mode: "quick" as const, source: "legacy" as const };
    return { mode: "off" as const, source: "default" as const };
  };
  const mutex = new AsyncLifecycleMutex();
  registerPublicGoRoute(app, {
    requireAuth,
    mutex,
    getMode: () => selection().mode,
    handleNamed: async (reply) => reply.send({ mode: "named", status: "named-selected" }),
    environmentForcesQuick: () => {
      const selected = selection();
      return selected.mode === "quick" && selected.source === "environment";
    },
    quick,
    getStatus: status
  });
  registerPublicStopRoute(app, {
    requireAuth,
    mutex,
    getMode: () => selection().mode,
    getSelection: selection,
    stopTunnel: quick().stopTunnel,
    stopListener: quick().stopListener,
    persistMode: () => {
      state.mode = "off";
    },
    setAutoStart: (enabled) => {
      state.autoStart = enabled;
    },
    getStatus: status
  });
  return { app, state, selection };
}

async function postGo(app: ReturnType<typeof Fastify>, body: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/public/go",
    headers: { authorization: "Bearer route-test" },
    payload: body
  });
}

async function postStop(app: ReturnType<typeof Fastify>) {
  return app.inject({
    method: "POST",
    url: "/api/public/stop",
    headers: { authorization: "Bearer route-test" }
  });
}

test("authenticated packaged-style off state transitions to persisted Quick through POST /api/public/go", async () => {
  const h = routeHarness();
  try {
    const unauthorized = await h.app.inject({ method: "POST", url: "/api/public/go", payload: { consent: true } });
    assert.equal(unauthorized.statusCode, 401);

    const response = await postGo(h.app, { consent: true });
    assert.equal(response.statusCode, 200);
    assert.equal(h.state.mode, "quick");
    assert.equal(h.state.autoStart, true);
    assert.equal(h.state.consent, true);
    assert.equal(h.state.listener, true);
    assert.equal(h.state.listenerHost, "127.0.0.1");
    assert.equal(h.state.listenerPort, 4010);
    assert.equal(h.state.tunnelTarget, "http://127.0.0.1:4010");
    assert.equal(h.state.spawns, 1);
    assert.deepEqual(response.json(), {
      mode: "quick",
      status: "online",
      publicOrigin: "https://route-test.trycloudflare.com",
      autoStartEnabled: true,
      consentRequired: false
    });
  } finally {
    await h.app.close();
  }
});

test("authenticated named conflict rejects Quick before any route-level mutation", async () => {
  const h = routeHarness({ namedConflict: true });
  try {
    const response = await postGo(h.app, { consent: true });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().lastError, "named_configured");
    assert.equal(h.state.mode, null);
    assert.equal(h.state.autoStart, false);
    assert.equal(h.state.consent, false);
    assert.equal(h.state.listener, false);
    assert.equal(h.state.spawns, 0);
  } finally {
    await h.app.close();
  }
});

for (const failure of ["listener", "preparation", "tunnel"] as const) {
  test(`POST /api/public/go reports ${failure} failure and rolls real route state back`, async () => {
    const h = routeHarness({ failure });
    try {
      const response = await postGo(h.app, { consent: true });
      assert.equal(response.statusCode, 503);
      assert.equal(
        response.json().lastError,
        failure === "listener"
          ? "public_listener_start_failed"
          : failure === "preparation"
            ? "cloudflared_download_failed"
            : "quick_tunnel_start_failed"
      );
      assert.equal(h.state.mode, null);
      assert.equal(h.state.autoStart, false);
      assert.equal(h.state.consent, true);
      assert.equal(h.state.listener, false);
      assert.equal(h.state.tunnel, false);
      assert.equal(response.json().mode, "off");
      assert.equal(response.json().status, "offline");
      assert.equal(response.json().publicOrigin, null);
    } finally {
      await h.app.close();
    }
  });
}

test("environment-forced Quick keeps source behavior without persisting user selection", async () => {
  const h = routeHarness({ environmentMode: "quick" });
  try {
    const response = await postGo(h.app);
    assert.equal(response.statusCode, 200);
    assert.equal(h.state.mode, null);
    assert.equal(h.state.autoStart, false);
    assert.equal(h.state.consent, false);
    assert.equal(h.state.listener, true);
    assert.equal(h.state.tunnel, true);
  } finally {
    await h.app.close();
  }
});

test("environment-selected named mode is not misclassified as forced Quick", async () => {
  const h = routeHarness({ environmentMode: "named" });
  try {
    const response = await postGo(h.app);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { mode: "named", status: "named-selected" });
    assert.equal(h.state.spawns, 0);
    assert.equal(h.state.listener, false);
  } finally {
    await h.app.close();
  }
});

test("production Stop persists explicit user Quick as private while preserving consent", async () => {
  const h = routeHarness();
  h.state.mode = "quick";
  h.state.autoStart = true;
  h.state.consent = true;
  h.state.listener = true;
  h.state.tunnel = true;
  try {
    const response = await postStop(h.app);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "STOPPED");
    assert.deepEqual(h.selection(), { mode: "off", source: "user" });
    assert.equal(h.state.autoStart, false);
    assert.equal(h.state.consent, true);
    assert.equal(h.state.listener, false);
    assert.equal(h.state.tunnel, false);
  } finally {
    await h.app.close();
  }
});

test("production Stop persists legacy user-managed Quick as private while preserving consent", async () => {
  const h = routeHarness();
  h.state.mode = null;
  h.state.autoStart = true;
  h.state.consent = true;
  h.state.listener = true;
  h.state.tunnel = true;
  assert.deepEqual(h.selection(), { mode: "quick", source: "legacy" });
  try {
    const response = await postStop(h.app);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "STOPPED");
    assert.deepEqual(h.selection(), { mode: "off", source: "user" });
    assert.equal(h.state.autoStart, false);
    assert.equal(h.state.consent, true);
    assert.equal(h.state.listener, false);
    assert.equal(h.state.tunnel, false);
  } finally {
    await h.app.close();
  }
});

test("production Stop does not rewrite administrator-forced environment Quick", async () => {
  const h = routeHarness({ environmentMode: "quick" });
  h.state.listener = true;
  h.state.tunnel = true;
  try {
    const response = await postStop(h.app);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(h.selection(), { mode: "quick", source: "environment" });
    assert.equal(h.state.listener, false);
    assert.equal(h.state.tunnel, false);
  } finally {
    await h.app.close();
  }
});
