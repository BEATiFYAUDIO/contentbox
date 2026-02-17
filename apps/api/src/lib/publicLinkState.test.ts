import test from "node:test";
import assert from "node:assert/strict";
import { canonicalOriginForLinks, computePublicLinkState } from "./publicLinkState.js";

test("named configured => mode named, canonical, offline when health false", () => {
  const state = computePublicLinkState({
    publicModeEnv: "quick",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "contentbox", publicOrigin: "https://contentbox.example.com" },
    config: { provider: "cloudflare", domain: "contentbox.example.com", tunnelName: "contentbox" },
    quick: { status: "ACTIVE", publicOrigin: "https://abc.trycloudflare.com" },
    namedHealthOk: false
  });
  assert.equal(state.mode, "named");
  assert.equal(state.isCanonical, true);
  assert.equal(state.canonicalOrigin, "https://contentbox.example.com");
  assert.equal(state.status, "offline");
});

test("named configured but unknown health => status offline", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "contentbox", publicOrigin: "contentbox.example.com" },
    config: { provider: "cloudflare", domain: "contentbox.example.com", tunnelName: "contentbox" },
    quick: { status: "STOPPED", publicOrigin: null },
    namedHealthOk: null
  });
  assert.equal(state.mode, "named");
  assert.equal(state.status, "offline");
  assert.equal(state.canonicalOrigin, "https://contentbox.example.com");
});

test("no named config + quick active => mode quick, not canonical", () => {
  const state = computePublicLinkState({
    publicModeEnv: "quick",
    dbModeEnv: "basic",
    namedEnv: { tunnelName: null, publicOrigin: null },
    config: { provider: "cloudflare", domain: null, tunnelName: null },
    quick: { status: "ACTIVE", publicOrigin: "https://abc.trycloudflare.com" },
    namedHealthOk: null
  });
  assert.equal(state.mode, "quick");
  assert.equal(state.isCanonical, false);
  assert.equal(state.canonicalOrigin, "https://abc.trycloudflare.com");
  assert.equal(state.status, "online");
});

test("named configured wins over quick", () => {
  const state = computePublicLinkState({
    publicModeEnv: "quick",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "contentbox", publicOrigin: "https://contentbox.example.com" },
    config: { provider: "cloudflare", domain: "contentbox.example.com", tunnelName: "contentbox" },
    quick: { status: "ACTIVE", publicOrigin: "https://abc.trycloudflare.com" },
    namedHealthOk: true
  });
  assert.equal(state.mode, "named");
  assert.equal(state.canonicalOrigin, "https://contentbox.example.com");
  assert.equal(state.isCanonical, true);
});

test("canonicalOriginForLinks prefers canonical origin", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "contentbox", publicOrigin: "https://contentbox.example.com" },
    config: { provider: "cloudflare", domain: "contentbox.example.com", tunnelName: "contentbox" },
    quick: { status: "STOPPED", publicOrigin: null },
    namedHealthOk: true
  });
  const base = canonicalOriginForLinks(state, "http://127.0.0.1:4000");
  assert.equal(base, "https://contentbox.example.com");
});
