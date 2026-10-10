import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSource = await readFile(new URL("../server.ts", import.meta.url), "utf8");
const dashboardHtml = await readFile(new URL("../../../dashboard/index.html", import.meta.url), "utf8");
const dashboardManifest = JSON.parse(
  await readFile(new URL("../../../dashboard/public/manifest.json", import.meta.url), "utf8")
);

function sourceSection(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return serverSource.slice(start, end);
}

test("public creator pages use the escaped creator name and resolved avatar branding", () => {
  const section = sourceSection(
    "async function handlePublicNodeProfilePage",
    "async function handlePublicProofBundle"
  );

  assert.match(
    section,
    /creatorProfileBrowserTitle\s*=\s*asString\(user\.displayName\s*\|\|\s*""\)\.trim\(\)\s*\|\|\s*"Certifyd Creator Profile"/
  );
  assert.match(
    section,
    /creatorProfileFaviconHref\s*=\s*safeAvatarUrl\s*\|\|\s*safeCreatorProfileFaviconDataUri\s*\|\|\s*"\/certifyd-tab-icon\.svg\?v=20260601d"/
  );
  assert.match(section, /<title>\$\{escHtml\(creatorProfileBrowserTitle\)\}<\/title>/);
  assert.match(section, /<link rel="icon" href="\$\{creatorProfileFaviconHref\}" \/>/);
  assert.match(section, /<link rel="apple-touch-icon" href="\$\{creatorProfileFaviconHref\}" \/>/);
  assert.doesNotMatch(section, /<link rel="icon" type="image\/svg\+xml" href="\$\{creatorProfileFaviconHref\}"/);
});

test("buy pages separate browser, creator icon, and work social metadata", () => {
  const section = sourceSection("async function handleBuyPage", "async function handleBuyReceiptPage");

  assert.match(section, /workTitle\s*=\s*content\.title\s*\|\|\s*"Certifyd work"/);
  assert.match(section, /creatorName\s*=\s*sellerDisplayName\s*\|\|\s*"Certifyd creator"/);
  assert.match(section, /browserTitle\s*=\s*`\$\{workTitle\} — \$\{creatorName\}`/);
  assert.match(section, /socialTitle\s*=\s*workTitle/);
  assert.match(section, /buyPageFaviconHref\s*=\s*sellerAvatarUrl\s*\|\|\s*"\/certifyd-tab-icon\.svg\?v=20260601d"/);
  assert.match(section, /<title>\$\{escHtml\(browserTitle\)\}<\/title>/);
  assert.match(section, /<meta property="og:title" content="\$\{escHtml\(socialTitle\)\}" \/>/);
  assert.match(section, /<meta name="twitter:title" content="\$\{escHtml\(socialTitle\)\}" \/>/);
  assert.match(section, /<meta property="og:description" content="\$\{escHtml\(initialMetaDescription\)\}" \/>/);
  assert.match(section, /<meta name="twitter:description" content="\$\{escHtml\(initialMetaDescription\)\}" \/>/);
  assert.match(section, /<link rel="icon" href="\$\{escHtml\(buyPageFaviconHref\)\}" \/>/);
  assert.match(section, /<link rel="apple-touch-icon" href="\$\{escHtml\(buyPageFaviconHref\)\}" \/>/);
  assert.match(
    section,
    /<meta property="og:image" content="\$\{escHtml\(buildPublicUrlFromOrigin\(canonicalOrigin, `\/public\/content\/\$\{encodeURIComponent\(content\.id\)\}\/cover`\)\)\}" \/>/
  );
  assert.match(
    section,
    /<meta name="twitter:image" content="\$\{escHtml\(buildPublicUrlFromOrigin\(canonicalOrigin, `\/public\/content\/\$\{encodeURIComponent\(content\.id\)\}\/cover`\)\)\}" \/>/
  );
});

test("local dashboard and installed PWA retain Certifyd branding", () => {
  assert.match(dashboardHtml, /<title>Certifyd Creator Dashboard<\/title>/);
  assert.match(dashboardHtml, /href="\/certifyd-tab-icon\.svg\?v=20260601a"/);
  assert.equal(dashboardManifest.name, "Certifyd Core Creator Dashboard");
  assert.equal(dashboardManifest.short_name, "Certifyd Core");
  assert.ok(dashboardManifest.icons.every((icon) => icon.src.startsWith("/pwa/certifyd-")));
});
