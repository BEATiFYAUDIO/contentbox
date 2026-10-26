import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseLinuxCloudflaredService,
  parseSysVCloudflaredService,
  parseMacCloudflaredServices,
  parseMacSystemCloudflaredService,
  parseWindowsCloudflaredServices,
  serviceInspectionSummary,
  shouldDeferToExternalConnector,
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

test("SysV service is detected separately from its running state", () => {
  assert.deepEqual(parseSysVCloudflaredService(false, null), []);
  assert.equal(parseSysVCloudflaredService(true, 0)[0]?.state, "running");
  assert.equal(parseSysVCloudflaredService(true, 3)[0]?.state, "stopped");
  assert.equal(parseSysVCloudflaredService(true, 1)[0]?.state, "unknown");
});

test("an unidentified running external service prevents a competing Core connector", () => {
  assert.equal(shouldDeferToExternalConnector({ serviceRunning: true, externalProcessRunning: false }), true);
  assert.equal(shouldDeferToExternalConnector({ serviceRunning: false, externalProcessRunning: true }), true);
  assert.equal(shouldDeferToExternalConnector({ serviceRunning: false, externalProcessRunning: false }), false);
});

test("macOS service inspection recognizes only cloudflared launchd jobs", () => {
  const records = parseMacCloudflaredServices("742\t0\tcom.cloudflare.cloudflared\n-\t0\tcom.apple.other");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.state, "running");
  assert.equal(records[0]?.pid, 742);
});

test("macOS system LaunchDaemon distinguishes installed from running", () => {
  assert.equal(parseMacSystemCloudflaredService("com.cloudflare.cloudflared", "pid = 951\nstate = running").state, "running");
  assert.equal(parseMacSystemCloudflaredService("com.cloudflare.cloudflared", "state = waiting").state, "unknown");
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
  assert.match(serverSource, /await inspectWindowsCloudflared\(NAMED_CONTROL_COMMAND_TIMEOUT_MS\)/);
  assert.match(inspector, /systemctl/);
  assert.match(inspector, /\/etc\/init\.d\/cloudflared/);
  assert.match(inspector, /launchctl/);
  assert.match(inspector, /NAMED_CONTROL_COMMAND_TIMEOUT_MS/g);
});

test("matching public boot identity proves readiness without service inspection permissions", () => {
  const result = evaluateNamedRouteEvidence({
    identityConnected: false, externalServiceRunning: false,
    routeReachable: true, routeMatchesThisCore: true, localListenerReady: true
  });
  assert.equal(result.online, true);
  assert.equal(result.connected, true);
  assert.equal(result.reason, "route_verified_identity_unavailable");
});
test("a stopped listener cannot be online even with prior matching route evidence", () => {
  assert.equal(evaluateNamedRouteEvidence({
    identityConnected: true, externalServiceRunning: true,
    routeReachable: true, routeMatchesThisCore: true, localListenerReady: false
  }).online, false);
});
test("Windows service evidence survives a protected process command line", async () => {
  const { inspectWindowsCloudflared } = await import("./tunnelInspection.js");
  const result = await inspectWindowsCloudflared(1000, async () => JSON.stringify({
    services: [{ Name: "Cloudflared", State: "Running", ProcessId: 42, PathName: "cloudflared tunnel run" }],
    processes: [{ ProcessId: 42, CommandLine: null }]
  }));
  assert.equal(result.services[0].state, "running");
  assert.equal(result.processes[0].pid, 42);
  assert.equal(result.processes[0].commandLine, "cloudflared tunnel run");
});
