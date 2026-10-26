import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const start = server.indexOf("  function bindPlaybackSourceRecovery(");
const end = server.indexOf("  function bindPreviewLimit(", start);
assert.ok(start >= 0 && end > start, "Buy-page playback recovery function exists");
const recoverySource = server.slice(start, end);

function setup({ httpStatus, errorCode, offer, nextPlayback, mode = "full" }) {
  const originalSource = "https://creator.test/public/content/work/preview-file?t=expired";
  const handlers = new Map();
  const status = { textContent: "", hidden: true };
  let source = originalSource;
  let probes = 0;
  let offerFetches = 0;
  let loads = 0;
  const player = {
    error: { code: errorCode },
    getAttribute: (name) => name === "src" ? source : null,
    setAttribute: (name, value) => { if (name === "src") source = value; },
    load: () => { loads += 1; },
    addEventListener: (name, handler) => handlers.set(name, handler)
  };
  const context = {
    URL,
    window: { location: { href: "https://creator.test/buy/work", origin: "https://creator.test" } },
    document: { getElementById: (id) => id === "player" ? player : id === "playbackStatus" ? status : null },
    fetch: async (url, options) => {
      probes += 1;
      assert.equal(url, originalSource);
      assert.equal(options.headers.Range, "bytes=0-0");
      assert.equal(options.credentials, "include");
      return { status: httpStatus, body: { cancel: async () => {} } };
    },
    fetchOfferWithAccessProof: async () => { offerFetches += 1; return offer; },
    resolveAuthorizedPlayback: () => nextPlayback,
    entitlement: null,
    receiptToken: null,
    currentOffer: null
  };
  const bind = vm.runInNewContext(`${recoverySource}\n bindPlaybackSourceRecovery`, context);
  bind({ src: originalSource, mode }, null);
  return {
    fire: async (name) => handlers.get(name)?.(),
    status,
    get source() { return source; },
    get probes() { return probes; },
    get offerFetches() { return offerFetches; },
    get loads() { return loads; }
  };
}

test("unsupported video stops without requesting fresh access", async () => {
  const run = setup({ httpStatus: 206, errorCode: 4 });
  assert.equal(run.probes, 0, "normal playback performs no probe");
  await run.fire("error");
  await run.fire("error");
  assert.equal(run.probes, 1);
  assert.equal(run.offerFetches, 0);
  assert.equal(run.loads, 0);
  assert.match(run.status.textContent, /another browser/);
  await run.fire("playing");
  assert.equal(run.status.hidden, true);
});

test("decode failure does not retry access or probe the file", async () => {
  const run = setup({ httpStatus: 206, errorCode: 3 });
  await run.fire("error");
  assert.equal(run.probes, 0);
  assert.equal(run.offerFetches, 0);
  assert.match(run.status.textContent, /another browser/);
});

test("expired free-media URL refreshes once", async () => {
  const run = setup({ httpStatus: 403, errorCode: 4,
    offer: { isFree: true, hasFullAccess: true },
    nextPlayback: { mode: "full", src: "https://creator.test/public/content/work/preview-file?t=fresh" }
  });
  await run.fire("error");
  assert.match(run.source, /t=fresh/);
  assert.equal(run.loads, 1);
  await run.fire("error");
  assert.equal(run.offerFetches, 1, "a second failure cannot start an endless refresh loop");
});

test("expired paid-media URL refreshes only with renewed full access", async () => {
  const run = setup({ httpStatus: 401, errorCode: 4, mode: "full",
    offer: { isFree: false, hasFullAccess: true },
    nextPlayback: { mode: "full", src: "https://creator.test/public/content/work/preview-file?t=paid-fresh" }
  });
  await run.fire("error");
  assert.match(run.source, /t=paid-fresh/);
  assert.equal(run.loads, 1);
});

test("unauthorized paid media cannot switch to a refreshed source", async () => {
  const run = setup({ httpStatus: 403, errorCode: 4, mode: "full",
    offer: { isFree: false, hasFullAccess: false },
    nextPlayback: { mode: "full", src: "https://creator.test/public/content/work/preview-file?t=denied" }
  });
  await run.fire("error");
  assert.match(run.source, /t=expired/);
  assert.equal(run.loads, 0);
  assert.match(run.status.textContent, /access could not be refreshed/);
});

test("missing media is reported as unavailable without a fresh offer", async () => {
  const run = setup({ httpStatus: 404, errorCode: 4 });
  await run.fire("error");
  assert.equal(run.offerFetches, 0);
  assert.match(run.status.textContent, /unavailable right now/);
});
