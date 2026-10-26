import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { metadataFixture } from "../lib/primaryFileMetadata.testSupport.js";
import { chromium } from "playwright-core";

const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
function browserFunction(name: string) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing browser function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated browser function ${name}`);
}

const chrome = process.env.CHROME_BIN || "/usr/bin/google-chrome";
assert.ok(fs.existsSync(chrome), `Chrome is required for this browser regression: ${chrome}`);
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const fixture = await metadataFixture();
let server: http.Server | null = null;
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  const work = await fixture.seed("mp3", "audio/mpeg", { paid: true, type: "song" });
  const legacyKey = `files/legacy-${work.id}.mp3`;
  const repoPath = work.content.repoPath;
  assert.ok(repoPath);
  const previewPath = path.join(repoPath, legacyKey);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-codec:a", "libmp3lame", "-y", previewPath]);
  fs.rmSync(path.join(repoPath, work.previewKey));
  await fixture.db.contentFile.update({
    where: { contentId_objectKey: { contentId: work.id, objectKey: work.previewKey } },
    data: { objectKey: legacyKey, originalName: `${work.id}-preview.mp3` }
  });
  await fixture.db.manifest.update({ where: { contentId: work.id }, data: {
    json: {
      ...work.manifest,
      preview: legacyKey,
      files: work.manifest.files.map((file: any) => file.objectKey === work.previewKey
        ? { ...file, objectKey: legacyKey, originalName: `${work.id}-preview.mp3` }
        : file)
    }
  } });

  const functionNames = ["streamUrl", "previewFallbackUrl", "basicPrimaryUrl", "offerCoverUrl",
    "resolveBasicDeliveryMode", "inferPreviewKind", "resolveRenderablePreview",
    "resolveAuthorizedPlayback", "renderAuthorizedPlayback"];
  const browserJs = functionNames.map(browserFunction).join("\n");
  server = http.createServer(async (req, res) => {
    if (req.url === "/browser-test") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><body><main id="app"></main><script>
        const apiBase = location.origin, contentId = ${JSON.stringify(work.id)}, shareToken = "";
        const qs = encodeURIComponent, esc = s => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
        ${browserJs}
        (async () => {
          try {
            const offerResponse = await fetch("/buy/content/" + contentId + "/offer", { credentials: "omit" });
            if (!offerResponse.ok) throw Error("offer HTTP " + offerResponse.status);
            const offer = await offerResponse.json();
            const playback = resolveAuthorizedPlayback(offer, { entitlement: null, owned: false, token: null });
            if (offer.playback?.mode !== "preview" || playback.mode !== "preview") throw Error("preview mode missing");
            document.getElementById("app").innerHTML = renderAuthorizedPlayback(playback, {});
            const player = document.getElementById("player");
            if (!(player instanceof HTMLAudioElement)) throw Error("audio player missing");
            player.addEventListener("timeupdate", () => {
              if (player.currentTime > 0.1) document.body.dataset.result = "PASS";
            });
            player.addEventListener("error", () => { document.body.dataset.result = "FAIL-media-" + (player.error?.code || 0); });
            await player.play();
            setTimeout(() => { if (!document.body.dataset.result) document.body.dataset.result = "FAIL-timeout"; }, 8000);
          } catch (error) { document.body.dataset.result = "FAIL-" + String(error); }
        })();
      </script></body></html>`);
      return;
    }
    const response = await fixture.app.inject({ method: req.method as any, url: req.url || "/", headers: { host: req.headers.host || "127.0.0.1" } });
    res.writeHead(response.statusCode, response.headers as http.OutgoingHttpHeaders);
    res.end(response.rawPayload);
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/browser-test`;
  browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => Boolean((globalThis as any).document.body.dataset.result), null, { timeout: 10000 });
  assert.equal(await page.locator("body").getAttribute("data-result"), "PASS");
  const original = await fixture.app.inject(`/public/content/${work.id}/preview-file?objectKey=${encodeURIComponent(work.key)}`);
  assert.equal(original.statusCode, 403);
  console.log("legacy_preview_browser_regression PASS: anonymous Chrome played legacy paid preview; paid original denied");
} finally {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await fixture.close();
}
