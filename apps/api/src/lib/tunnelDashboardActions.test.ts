import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../../dashboard/src/pages/ConfigPage.tsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("saving blank Named fields cannot silently reuse the old public origin", () => {
  const handler = source.slice(source.indexOf("const saveTunnelConfig"), source.indexOf("const removeNamedTunnelConfig"));
  assert.match(handler, /deriveNamedPublicOrigin\(tunnelName, tunnelDomain\)/);
  assert.doesNotMatch(handler, /sanitizeNamedPublicOrigin\(publicOrigin/);
});

test("Named start, verification, and removal use explicit backend actions", () => {
  assert.match(source, /\/api\/public\/named\/start/);
  assert.match(source, /\/api\/public\/named\/verify/);
  assert.match(source, /\/api\/public\/named\/remove/);
  const tokenHandler = source.slice(source.indexOf("const saveNamedToken"), source.indexOf("const generateNamedToken"));
  assert.match(tokenHandler, /startNamedPublicLink/);
  assert.doesNotMatch(tokenHandler, /await startPublicLink\(\)/);
});

test("external service ownership offers public disable without claiming connector control", () => {
  assert.match(source, /externalNamedActive/);
  assert.match(source, /"Stop sharing"/);
  const primaryAction = source.slice(source.indexOf('<div style={{ fontWeight: 600, marginBottom: 10 }}>Public Connection'), source.indexOf('htmlFor="tunnel-settings-enabled"'));
  assert.match(primaryAction, /stopPublicLink/);
  assert.doesNotMatch(primaryAction, /externalNamedActive.*stopPublicLink/);
});

test("connection tabs only change the selected view; periodic refresh only observes", () => {
  const primary = source.slice(source.indexOf('<div style={{ fontWeight: 600, marginBottom: 10 }}>Public Connection'), source.indexOf('htmlFor="tunnel-settings-enabled"'));
  assert.match(primary, /onClick=\{\(\) => setConnectionView\("temporary"\)\}/);
  assert.match(primary, /onClick=\{\(\) => setConnectionView\("permanent"\)\}/);
  assert.match(primary, /publicStatus\.mode === \(uiTunnelMode/);
  assert.match(primary, /publicStatus\?\.availability === "reachable"/);
  assert.match(source, /api\/public\/status\?refresh=1&observe=1/);
  const periodic = source.slice(source.indexOf("// Refresh discovery while CONFIG remains open"), source.indexOf("async function loadMetadataProviders"));
  assert.doesNotMatch(periodic, /startPublicLink|startNamedPublicLink|setPublicSharingConsent|setConnectionView/);
  const endpoint = apiSource.slice(apiSource.indexOf('app.get("/api/public/status"'), apiSource.indexOf('function getNodeModeStatus()'));
  assert.match(endpoint, /if \(observe\) return reply\.send\(getPublicStatus\(false\)\)/);
  assert.ok(endpoint.indexOf('if (observe) return reply.send(getPublicStatus(false))') < endpoint.indexOf('triggerPublicStartBestEffort()'));
});

test("Named removal never changes posture implicitly", () => {
  const handler = source.slice(source.indexOf("const removeNamedTunnelConfig"), source.indexOf("const discoverTunnels"));
  assert.doesNotMatch(handler, /api\/node\/mode|setNodeMode|updateNodeMode/);
  assert.match(source, /Switch to Basic Creator before removing/);
});
