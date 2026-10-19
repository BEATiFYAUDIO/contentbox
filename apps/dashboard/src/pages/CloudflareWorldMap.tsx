import React from "react";
import { countries, countryId, mapCountryTraffic } from "./worldCountryTraffic";

// Natural Earth 1:110m Admin 0 countries, public domain:
// https://www.naturalearthdata.com/downloads/110m-cultural-vectors/
const format = (value: number) => new Intl.NumberFormat().format(value);
const shades = ["#164e63", "#0e7490", "#0284c7", "#0ea5e9", "#38bdf8"];

export default function CloudflareWorldMap({ totals }: { totals: { label: string; count: number }[] }) {
  const [active, setActive] = React.useState<string | null>(null);
  const { counts, unmatched } = mapCountryTraffic(totals);
  const highest = Math.max(1, ...counts.values());
  const selected = countries.find((country) => countryId(country) === active);
  const selectedCount = selected ? counts.get(countryId(selected)) : undefined;

  const fill = (count: number | undefined) => {
    if (count === undefined) return "#262b37"; // No observation; never assume zero.
    if (count === 0) return "#133147"; // An explicitly reported zero.
    const level = Math.min(shades.length - 1,
      Math.floor(Math.log1p(count) / Math.log1p(highest) * (shades.length - 1)));
    return shades[level];
  };

  return <div className="mt-4 min-w-0">
    <div className="rounded-lg border border-neutral-800 bg-[#101827]">
      <svg viewBox="0 0 1000 500" role="group" aria-label="Interactive world map of reported Cloudflare HTTP requests by country"
        className="block h-auto w-full" style={{ touchAction: "pan-y" }}>
        {countries.map((country) => {
          const count = counts.get(countryId(country));
          const description = count === undefined ? "no reported country data" :
            `${format(count)} reported HTTP requests`;
          return <path key={countryId(country)}
            d={country.path} fill={fill(count)} fillRule="evenodd" stroke="#526174" strokeWidth="0.55"
            role="button" tabIndex={0} aria-label={`${country.name}: ${description}`}
            className="cursor-pointer outline-none focus:stroke-amber-300 focus:stroke-[2.5px] hover:stroke-amber-300 hover:stroke-[2px]"
            onMouseEnter={() => setActive(countryId(country))} onFocus={() => setActive(countryId(country))}
            onClick={() => setActive(countryId(country))}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault(); setActive(countryId(country));
              }
            }}>
            <title>{`${country.name}: ${description}`}</title>
          </path>;
        })}
      </svg>
    </div>
    <p className="mt-2 text-sm text-neutral-200" role="status" aria-live="polite">
      {selected ? <><strong>{selected.name}</strong>: {selectedCount === undefined ? "No reported country data" : `${format(selectedCount)} reported HTTP requests`}</> :
        "Hover, tap, or focus a country to inspect its reported traffic."}
    </p>
    <p className="mt-1 text-xs text-neutral-500">Blue indicates reported traffic; dark blue indicates a reported zero; gray means no country data. The map uses the same Cloudflare figures as the rankings.</p>
    {unmatched.length > 0 && <p className="mt-1 text-xs text-amber-300">{unmatched.length} reported country {unmatched.length === 1 ? "label could" : "labels could"} not be placed on the map; the rankings still show them.</p>}
  </div>;
}
