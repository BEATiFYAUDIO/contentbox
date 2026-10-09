import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../../dashboard/src/pages/ConfigPage.tsx", import.meta.url), "utf8");

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

test("external service ownership disables the misleading Stop action", () => {
  assert.match(source, /externalNamedActive/);
  assert.match(source, /managed outside Certifyd/);
  assert.match(source, /operating-system service manager or Cloudflare/);
});

test("Named removal never changes posture implicitly", () => {
  const handler = source.slice(source.indexOf("const removeNamedTunnelConfig"), source.indexOf("const discoverTunnels"));
  assert.doesNotMatch(handler, /api\/node\/mode|setNodeMode|updateNodeMode/);
  assert.match(source, /Switch to Basic Creator before removing/);
});
