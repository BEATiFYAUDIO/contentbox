import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseLinuxCloudflaredService,
  parseMacCloudflaredServices,
  parseWindowsCloudflaredServices,
  serviceInspectionSummary,
  evaluateNamedRouteEvidence
} from "./cloudflaredServiceInspection.js";

const serverSource = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");

test("Windows service inspection recognizes a running externally managed cloudflared service", () => {
  const records = parseWindowsCloudflaredServices(
    "Cloudflared|Running|4120|C:\\Program Files\\cloudflared\\cloudflared.exe tunnel run --token REDACTED"
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]?.pid, 4120);
  assert.equal(records[0]?.state, "running");
  assert.deepEqual(serviceInspectionSummary(records), {
    serviceDetected: true,
    serviceRunning: true,
    serviceCount: 1,
    runningServiceCount: 1,
    servicePids: [4120]
  });
});

for (const platform of ["Windows", "Linux", "macOS"]) {
  test(`${platform} external service is online only when the durable route reaches this Core`, () => {
    assert.deepEqual(
      evaluateNamedRouteEvidence({
        identityConnected: false,
        externalServiceRunning: true,
        routeReachable: true,
        routeMatchesThisCore: true,
        localListenerReady: true
      }),
      { connected: true, online: true, reason: "external_service_route_verified" }
    );
    assert.equal(
      evaluateNamedRouteEvidence({
        identityConnected: false,
        externalServiceRunning: true,
        routeReachable: true,
        routeMatchesThisCore: false,
        localListenerReady: true
      }).online,
      false
    );
  });
}

test("Linux service inspection distinguishes active and missing services", () => {
  const records = parseLinuxCloudflaredService(
    "Id=cloudflared.service\nLoadState=loaded\nActiveState=active\nMainPID=901\nExecStart={ path=/usr/bin/cloudflared ; argv[]=/usr/bin/cloudflared tunnel run }"
  );
  assert.equal(records[0]?.state, "running");
  assert.equal(records[0]?.pid, 901);
  assert.deepEqual(parseLinuxCloudflaredService("LoadState=not-found\nActiveState=inactive"), []);
});

test("macOS service inspection recognizes only cloudflared launchd jobs", () => {
  const records = parseMacCloudflaredServices("742\t0\tcom.cloudflare.cloudflared\n-\t0\tcom.apple.other");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.state, "running");
  assert.equal(records[0]?.pid, 742);
});

test("an exact connected tunnel is not online until its durable hostname reaches this Core", () => {
  const result = evaluateNamedRouteEvidence({
    identityConnected: true,
    externalServiceRunning: false,
    routeReachable: true,
    routeMatchesThisCore: false,
    localListenerReady: true
  });
  assert.equal(result.connected, true);
  assert.equal(result.online, false);
  assert.equal(result.reason, "route_points_to_different_core");
});

test("service inspection is wired for Windows Services, Linux systemd, and macOS launchd with finite bounds", () => {
  const inspector = serverSource.slice(
    serverSource.indexOf("function inspectCloudflaredServices"),
    serverSource.indexOf("function detectTunnelControlMode")
  );
  assert.match(inspector, /Win32_Service/);
  assert.match(inspector, /systemctl/);
  assert.match(inspector, /launchctl/);
  assert.match(inspector, /NAMED_CONTROL_COMMAND_TIMEOUT_MS/g);
});
