import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(dashboardRoot, "src/App.tsx"), "utf8");
const css = readFileSync(path.join(dashboardRoot, "src/index.css"), "utf8");
const html = readFileSync(path.join(dashboardRoot, "index.html"), "utf8");

test("dashboard retains a device-width viewport and a compact mobile shell", () => {
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1\.0"/);
  assert.match(app, /aria-controls="dashboard-navigation"/);
  assert.match(app, /aria-expanded=\{mobileNavOpen\}/);
  assert.match(app, /aria-label="Dashboard navigation"/);
  assert.match(app, /className="[^\"]*md:hidden/);
  assert.match(app, /md:static md:z-auto md:h-screen md:w-64/);
});

test("mobile drawer supports backdrop, Escape, focus containment, and navigation close", () => {
  assert.match(app, /aria-label="Close navigation"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /event\.key !== "Tab"/);
  assert.match(app, /setMobileNavOpen\(false\)/);
  assert.match(app, /onClickCapture=/);
  assert.match(app, /previousActive \|\| mobileNavButtonRef\.current/);
});

test("mobile presentation prevents shell overflow and keeps controls touchable", () => {
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /max-width: 100vw/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /input:not\(\.sr-only\)/);
  assert.match(css, /min-width: 44px/);
  assert.match(css, /\[role="tablist"\]/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /max-height: calc\(100dvh - 1rem\)/);
});
