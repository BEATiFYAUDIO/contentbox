import test from "node:test";
import assert from "node:assert/strict";
import { canonicalOriginForLinks, computePublicLinkState } from "./publicLinkState.js";

test("named configured in quick mode keeps quick canonical origin", () => {
  const state = computePublicLinkState({
    publicModeEnv: "quick",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "contentbox", publicOrigin: "https://contentbox.example.com" },
    config: { provider: "cloudflare", domain: "contentbox.example.com", tunnelName: "contentbox" },
    quick: { status: "ACTIVE", publicOrigin: "https://abc.trycloudflare.com" },
    namedHealthOk: false
  });
  assert.equal(state.mode, "quick");
  assert.equal(state.isCanonical, false);
  assert.equal(state.canonicalOrigin, "https://abc.trycloudflare.com");
  assert.equal(state.status, "online");
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

test("missing public mode defaults to local-only", () => {
  const state = computePublicLinkState({
    publicModeEnv: undefined,
    dbModeEnv: "basic",
    namedEnv: { tunnelName: null, publicOrigin: null },
    config: { provider: null, domain: null, tunnelName: null },
    quick: { status: "ACTIVE", publicOrigin: "https://abc.trycloudflare.com" },
    namedHealthOk: null
  });
  assert.equal(state.mode, "off");
  assert.equal(state.status, "offline");
  assert.equal(state.canonicalOrigin, null);
});

test("named configured only wins when mode is named", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
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

test("root domain config stays canonical (no tunnel subdomain rewrite)", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "contentbox", publicOrigin: "https://darrylhillock.com" },
    config: { provider: "cloudflare", domain: "darrylhillock.com", tunnelName: "contentbox" },
    quick: { status: "STOPPED", publicOrigin: null },
    namedHealthOk: true
  });
  assert.equal(state.canonicalOrigin, "https://darrylhillock.com");
});

test("publicOrigin config enables canonical named identity without tunnel-name coupling", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: null, publicOrigin: null },
    config: { provider: null, domain: null, tunnelName: null, publicOrigin: "https://inklinguy.pro" },
    quick: { status: "ACTIVE", publicOrigin: "https://abc.trycloudflare.com" },
    namedHealthOk: true
  });
  assert.equal(state.mode, "named");
  assert.equal(state.isCanonical, true);
  assert.equal(state.canonicalOrigin, "https://inklinguy.pro");
});

test("explicit publicOrigin subdomain wins over domain+tunnel derivation", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "certifyd-m4", publicOrigin: null },
    config: {
      provider: "cloudflare",
      domain: "inklinguy.pro",
      tunnelName: "certifyd-m4",
      publicOrigin: "https://certifyd2.inklinguy.pro"
    },
    quick: { status: "ACTIVE", publicOrigin: "https://abc.trycloudflare.com" },
    namedHealthOk: true
  });
  assert.equal(state.mode, "named");
  assert.equal(state.canonicalOrigin, "https://certifyd2.inklinguy.pro");
});

test("canonical origin never rewrites root domain to tunnel subdomain", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: "certifyd-m4", publicOrigin: "https://darrylhillock.com" },
    config: {
      provider: "cloudflare",
      domain: "darrylhillock.com",
      tunnelName: "certifyd-m4",
      publicOrigin: null
    },
    quick: { status: "STOPPED", publicOrigin: null },
    namedHealthOk: true
  });
  assert.equal(state.canonicalOrigin, "https://darrylhillock.com");
});

test("domain-only named config derives tunnel subdomain", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: null, publicOrigin: null },
    config: {
      provider: "cloudflare",
      domain: "blessedrthe.fyi",
      tunnelName: "certifyd",
      publicOrigin: null
    },
    quick: { status: "STOPPED", publicOrigin: null },
    namedHealthOk: true
  });
  assert.equal(state.canonicalOrigin, "https://certifyd.blessedrthe.fyi");
});

test("full host named config does not prepend tunnel name", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: null, publicOrigin: null },
    config: {
      provider: "cloudflare",
      domain: "certifyd.beatifygroup.com",
      tunnelName: "beatifygroup",
      publicOrigin: null
    },
    quick: { status: "STOPPED", publicOrigin: null },
    namedHealthOk: true
  });
  assert.equal(state.canonicalOrigin, "https://certifyd.beatifygroup.com");
});

test("stale tunnel-prefixed public origin is ignored when domain is already full host", () => {
  const state = computePublicLinkState({
    publicModeEnv: "named",
    dbModeEnv: "advanced",
    namedEnv: { tunnelName: null, publicOrigin: null },
    config: {
      provider: "cloudflare",
      domain: "certifyd.beatifygroup.com",
      tunnelName: "beatifygroup",
      publicOrigin: "https://beatifygroup.certifyd.beatifygroup.com"
    },
    quick: { status: "STOPPED", publicOrigin: null },
    namedHealthOk: true
  });
  assert.equal(state.canonicalOrigin, "https://certifyd.beatifygroup.com");
});
