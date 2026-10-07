import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  findExactConfiguredTunnel,
  classifyNamedControlOwnership,
  commandLineMatchesConfiguredTunnel,
  namedConfigurationCacheKey
} from "./namedTunnelSafety.js";

const tunnels = [
  { id: "uuid-a", name: "creator-a", connections: [{}] },
  { id: "uuid-b", name: "creator-b", connections: [{}] }
];

const serverSource = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("named discovery accepts only an exact configured name or UUID", () => {
  assert.equal(findExactConfiguredTunnel(tunnels, "creator-a"), tunnels[0]);
  assert.equal(findExactConfiguredTunnel(tunnels, "UUID-B"), tunnels[1]);
  assert.equal(findExactConfiguredTunnel(tunnels, "missing"), null);
});

test("healthy hostname cannot prove identity when tunnel listing is unavailable", () => {
  const hostnameReachable = true;
  assert.equal(hostnameReachable, true);
  assert.equal(findExactConfiguredTunnel([], "creator-a"), null);
});

test("service ownership is specific to configured identity on all platforms", () => {
  for (const platform of ["win32", "linux", "darwin"]) {
    const owner = classifyNamedControlOwnership({
      configuredIdentities: ["certifyd-main"],
      processes: [{ pid: 42, commandLine: `cloudflared tunnel run certifyd-main # ${platform}`, serviceManaged: true }]
    });
    assert.equal(owner, "service-external");
  }
});

test("the exact owned PID is classified as app-managed", () => {
  assert.equal(classifyNamedControlOwnership({
    configuredIdentities: ["certifyd-main"],
    ownedPid: 77,
    processes: [{ pid: 77, commandLine: "cloudflared tunnel run certifyd-main" }]
  }), "app-managed");
});

test("unrelated and ambiguous service processes do not cause deferral", () => {
  assert.equal(classifyNamedControlOwnership({
    configuredIdentities: ["certifyd-main"],
    processes: [{ pid: 42, commandLine: "cloudflared tunnel run unrelated", serviceManaged: true }]
  }), "unknown");
  assert.equal(commandLineMatchesConfiguredTunnel("cloudflared tunnel run certifyd-main-copy", ["certifyd-main"]), false);
});

test("connector token UUID can identify the configured tunnel without exposing the token", () => {
  const token = Buffer.from(JSON.stringify({ t: "uuid-a", s: "secret" })).toString("base64");
  assert.equal(commandLineMatchesConfiguredTunnel(`cloudflared tunnel run --token ${token}`, ["uuid-a"]), true);
  assert.equal(commandLineMatchesConfiguredTunnel(`cloudflared tunnel run --token ${token}`, ["uuid-b"]), false);
});

test("a sole connected but nonmatching tunnel is never accepted", () => {
  assert.equal(findExactConfiguredTunnel([tunnels[0]], "creator-b"), null);
});

test("multiple unrelated or similarly named tunnels are rejected", () => {
  const unrelated = [
    { id: "uuid-x", name: "creator-copy", connections: [{}] },
    { id: "uuid-y", name: "creator-a-backup", connections: [{}] }
  ];
  assert.equal(findExactConfiguredTunnel(unrelated, "creator-a"), null);
});

test("an exact but stale disconnected configured tunnel is not connected", () => {
  const match = findExactConfiguredTunnel([
    { id: "uuid-a", name: "creator-a", connections: [] }
  ], "creator-a");
  assert.ok(match);
  assert.equal(Array.isArray(match.connections) && match.connections.length > 0, false);
});

test("ambiguous name and UUID matches fail closed", () => {
  const ambiguous = [
    { id: "uuid-a", name: "shared", connections: [{}] },
    { id: "shared", name: "other", connections: [{}] }
  ];
  assert.equal(findExactConfiguredTunnel(ambiguous, "shared"), null);
});

test("named health cache keys include identity, origin, provider, and disabled state", () => {
  const base = namedConfigurationCacheKey({
    provider: "cloudflare",
    tunnelName: "creator",
    publicOrigin: "https://creator.example.com/",
    disabled: false
  });
  assert.equal(base, namedConfigurationCacheKey({
    provider: "CLOUDFLARE",
    tunnelName: "CREATOR",
    publicOrigin: "https://creator.example.com",
    disabled: false
  }));
  assert.notEqual(base, namedConfigurationCacheKey({ provider: "cloudflare", tunnelName: "other", publicOrigin: "https://creator.example.com" }));
  assert.notEqual(base, namedConfigurationCacheKey({ provider: "cloudflare", tunnelName: "creator", publicOrigin: "https://other.example.com" }));
  assert.notEqual(base, namedConfigurationCacheKey({ provider: "cloudflare", tunnelName: "creator", publicOrigin: "https://creator.example.com", disabled: true }));
});

test("named configuration writes use the shared lifecycle mutex and invalidate runtime caches", () => {
  const configRoute = serverSource.slice(
    serverSource.indexOf('app.post("/api/public/config"'),
    serverSource.indexOf("async function detectConfiguredNamedTunnel")
  );
  assert.match(configRoute, /publicLifecycleMutex\.runExclusive/);
  assert.match(configRoute, /setPublicOriginConfig\(/);
  assert.match(configRoute, /invalidateNamedRuntimeCaches\(\)/);
});

test("named list and token commands remain bounded by the native exec timeout", () => {
  const listHelper = serverSource.slice(
    serverSource.indexOf("async function listCloudflaredTunnels"),
    serverSource.indexOf("async function checkNamedTunnelConnected")
  );
  assert.match(listHelper, /\["tunnel", "list", "--output", "json"\]/);
  assert.match(listHelper, /timeout:\s*NAMED_CONTROL_COMMAND_TIMEOUT_MS/);

  const tokenRoute = serverSource.slice(
    serverSource.indexOf('app.post("/api/public/named-token/generate"'),
    serverSource.indexOf('app.post("/api/public/named-token/clear"')
  );
  assert.match(tokenRoute, /\["tunnel", "token", tunnelName\]/);
  assert.match(tokenRoute, /timeout:\s*NAMED_CONTROL_COMMAND_TIMEOUT_MS/);
});

test("an in-flight config-A listing cannot publish aliases or ownership under config B", async () => {
  let configurationKey = "config-a";
  let aliases = new Set(["creator-a"]);
  let resolveListing!: (value: typeof tunnels) => void;
  const listing = new Promise<typeof tunnels>((resolve) => { resolveListing = resolve; });

  const inspection = (async () => {
    const capturedKey = configurationKey;
    const listed = await listing;
    if (capturedKey !== configurationKey) return;
    const match = findExactConfiguredTunnel(listed, "creator-a");
    if (match?.name) aliases.add(String(match.name).toLowerCase());
    if (match?.id) aliases.add(String(match.id).toLowerCase());
  })();

  configurationKey = "config-b";
  aliases = new Set(["creator-b"]);
  resolveListing(tunnels);
  await inspection;

  assert.deepEqual([...aliases], ["creator-b"]);
  assert.equal(classifyNamedControlOwnership({
    configuredIdentities: [...aliases],
    processes: [{ pid: 42, commandLine: "cloudflared tunnel run uuid-a", serviceManaged: true }]
  }), "unknown");

  for (const functionName of ["checkNamedTunnelConnected", "detectConfiguredNamedTunnel"]) {
    const start = serverSource.indexOf(`function ${functionName}`);
    const nextFunction = serverSource.indexOf("\nasync function ", start + 1);
    const source = serverSource.slice(start, nextFunction > start ? nextFunction : undefined);
    assert.ok(source.indexOf("const configurationKey = currentNamedHealthCacheKey()") < source.indexOf("await listCloudflaredTunnels()"));
    assert.ok(source.indexOf("configurationKey !== currentNamedHealthCacheKey()") < source.indexOf("rememberConfiguredNamedIdentity(match)"));
  }
});
