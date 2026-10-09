import assert from "node:assert/strict";
import test from "node:test";
import { dashboardAssetCacheControl } from "./dashboardAssetCaching.js";

test("dashboard entry points and service worker always bypass browser caches", () => {
  assert.equal(dashboardAssetCacheControl("/"), "no-store");
  assert.equal(dashboardAssetCacheControl("/index.html"), "no-store");
  assert.equal(dashboardAssetCacheControl("/manifest.json"), "no-store");
  assert.equal(dashboardAssetCacheControl("/service-worker.js"), "no-store");
});

test("only content-hashed build assets receive immutable caching", () => {
  assert.equal(
    dashboardAssetCacheControl("/assets/index-C4Z44TLR.js"),
    "public, max-age=31536000, immutable"
  );
  assert.equal(dashboardAssetCacheControl("/assets/certifyd-logo-refined.svg"), "no-cache");
  assert.equal(dashboardAssetCacheControl("/pwa/certifyd-192.png"), "no-cache");
});
