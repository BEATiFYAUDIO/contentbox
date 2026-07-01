import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(process.cwd(), "src/server.ts"), "utf8");

function has(pattern: RegExp, label: string) {
  assert.match(source, pattern, label);
}

function notHas(pattern: RegExp, label: string) {
  assert.doesNotMatch(source, pattern, label);
}

has(/data-certifyd-play="1"/, "Play in Certifyd links carry mini-player handoff metadata");
has(/data-offer-url=/, "Play links include canonical offer URL");
has(/data-buy-url=/, "Play links include existing buy/support URL");
has(/data-title=/, "Play links include title metadata");
has(/data-creator=/, "Play links include creator metadata");
has(/data-artwork=/, "Play links include artwork metadata");
has(/className = "mini-player"/, "Mini-player dock is created in-page");
has(/event\.preventDefault\(\)/, "Play links are intercepted without navigation");
has(/fetch\(link\.getAttribute\("data-offer-url"\) \|\| link\.href, \{ credentials: "same-origin" \}\)/, "Offer fetch avoids cross-origin credentialed CORS failure");
has(/var playback = offer && offer\.playback \? offer\.playback : null;/, "Mini-player uses canonical offer.playback");
has(/if \(!playback \|\| playback\.mode === "none" \|\| !playback\.streamUrl\)/, "No-playback offers fail gracefully");
has(/attachMedia\(mediaKind\(offer, playback\.streamUrl\), playback\.streamUrl\)/, "Preview and full use same playback path");
has(/d\.querySelector\("\.mini-support"\)\.setAttribute\("href", buyUrl\)/, "Support\/Buy CTA points to existing buy page");
has(/d\.querySelector\("\.mini-support"\)\.textContent = offer && Number\(offer\.priceSats \|\| 0\) > 0 \? "Buy" : "Support";/, "Support\/Buy CTA label is present");
has(/d\.querySelector\("\.mini-title"\)\.textContent = title;/, "Title renders in dock");
has(/d\.querySelector\("\.mini-meta"\)\.textContent = creator;/, "Creator renders in dock");
has(/art\.setAttribute\("src", artwork\)/, "Artwork renders in dock");
has(/clearMedia\(\);\n\s*currentMode = playback/, "Starting a second item clears current playback first");
has(/dock\.querySelector\("\.mini-btn"\)\.addEventListener\("click"/, "Play\/pause control is wired");
has(/dock\.querySelector\("\.mini-progress"\)\.addEventListener\("input"/, "Progress seek control is wired");
has(/media\.addEventListener\("timeupdate"/, "Progress updates during playback");
has(/@media \(max-width: 640px\)[\s\S]*\.mini-player/, "Mobile mini-player styles exist");
notHas(/openDockFromOffer[\s\S]*fullMediaUrl[\s\S]*attachMedia/, "Mini-player does not fall back to fullMediaUrl");

console.log("stage1a_miniplayer_qa OK");
