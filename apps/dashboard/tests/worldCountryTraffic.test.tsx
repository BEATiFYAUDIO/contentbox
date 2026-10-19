import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CloudflareWorldMap from "../src/pages/CloudflareWorldMap.js";
import { countries, countryId, mapCountryTraffic } from "../src/pages/worldCountryTraffic.js";

test("local world geometry has unique country shapes and no external map dependency", () => {
  assert.equal(countries.length, 177);
  assert.equal(new Set(countries.map(countryId)).size, countries.length);
  assert.ok(countries.every((country) => country.path.startsWith("M") && country.path.endsWith("Z")));
});

test("Cloudflare country names map to shapes without turning missing data into zero", () => {
  const { counts, unmatched } = mapCountryTraffic([
    { label: "United States", count: 23 }, { label: "France", count: 0 },
    { label: "Norway", count: 7 }, { label: "Unknown", count: 4 }
  ]);
  assert.equal(counts.get("US"), 23);
  assert.equal(counts.get("FR"), 0);
  assert.equal(counts.get("NO"), 7);
  assert.equal(counts.has("CA"), false);
  assert.deepEqual(unmatched, ["Unknown"]);
});

test("Cloudflare ISO country codes and existing map identifiers resolve to the same shapes", () => {
  const { counts, unmatched } = mapCountryTraffic([
    { label: "CA", count: 36 }, { label: "Canada", count: 4 },
    { label: "US", count: 23 }, { label: "DE", count: 9 },
    { label: "GB", count: 7 }, { label: "FR", count: 0 },
    { label: " tw ", count: 3 }, { label: "XX", count: 5 }
  ]);
  assert.equal(counts.get("CA"), 40);
  assert.equal(counts.get("US"), 23);
  assert.equal(counts.get("DE"), 9);
  assert.equal(counts.get("GB"), 7);
  assert.equal(counts.get("FR"), 0);
  assert.equal(counts.get("CN-TW"), 3);
  assert.equal(counts.has("NO"), false);
  assert.deepEqual(unmatched, ["XX"]);
});

test("map exposes accessible country values for recorded zero and missing observations", () => {
  const html = renderToStaticMarkup(<CloudflareWorldMap totals={[
    { label: "United States", count: 12 }, { label: "Canada", count: 0 }
  ]} />);
  assert.match(html, /United States of America: 12 reported HTTP requests/);
  assert.match(html, /Canada: 0 reported HTTP requests/);
  assert.match(html, /France: no reported country data/);
  assert.match(html, /tabindex="0"/);
});

test("map exposes Cloudflare country-code traffic through accessible country labels", () => {
  const html = renderToStaticMarkup(<CloudflareWorldMap totals={[
    { label: "CA", count: 36 }, { label: "US", count: 23 },
    { label: "DE", count: 9 }, { label: "GB", count: 7 }
  ]} />);
  assert.match(html, /Canada: 36 reported HTTP requests/);
  assert.match(html, /United States of America: 23 reported HTTP requests/);
  assert.match(html, /Germany: 9 reported HTTP requests/);
  assert.match(html, /United Kingdom: 7 reported HTTP requests/);
  assert.doesNotMatch(html, /reported country labels could not be placed/);
});
