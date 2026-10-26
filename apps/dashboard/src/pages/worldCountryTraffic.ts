import countries from "./worldCountries.json";

type Country = (typeof countries)[number];
type CountryTotal = { label: string; count: number };
export const countryId = (country: Country) => country.iso2 === "-99" ? country.name : country.iso2;

// Cloudflare returns English country names; Natural Earth and Intl sometimes use
// different names for the same ISO country. Keep ambiguous labels unassigned.
const aliases: Record<string, string[]> = {
  US: ["United States", "USA"], GB: ["United Kingdom", "UK"],
  RU: ["Russia", "Russian Federation"], KR: ["South Korea", "Republic of Korea"],
  KP: ["North Korea"], CD: ["DR Congo", "Democratic Republic of the Congo"],
  CG: ["Republic of the Congo"], CI: ["Ivory Coast", "Côte d’Ivoire"],
  CZ: ["Czech Republic", "Czechia"], TW: ["Taiwan"],
  TZ: ["Tanzania"], VN: ["Vietnam"], TR: ["Turkey", "Türkiye"]
};

const key = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryByName = new Map<string, string | null>();
const countryByCode = new Map<string, string>();

for (const country of countries) {
  if (/^[A-Z]{2}$/.test(country.iso2)) countryByCode.set(country.iso2, countryId(country));
  // Natural Earth labels Taiwan CN-TW; Cloudflare reports its ISO code TW.
  if (country.iso2 === "CN-TW") countryByCode.set("TW", countryId(country));
  const names = [country.name, ...(aliases[country.iso2] || [])];
  if (/^[A-Z]{2}$/.test(country.iso2)) names.push(displayNames.of(country.iso2) || "");
  for (const name of names) {
    const normalized = key(name);
    if (!normalized) continue;
    if (countryByName.has(normalized) && countryByName.get(normalized) !== countryId(country)) {
      countryByName.set(normalized, null);
    } else if (!countryByName.has(normalized)) {
      countryByName.set(normalized, countryId(country));
    }
  }
}

export { countries };
export type { Country };

export function mapCountryTraffic(totals: CountryTotal[]) {
  const counts = new Map<string, number>();
  const unmatched: string[] = [];
  for (const item of totals) {
    const iso2 = countryByCode.get(item.label.trim().toUpperCase()) ?? countryByName.get(key(item.label));
    if (!iso2 || !Number.isFinite(item.count) || item.count < 0) {
      unmatched.push(item.label);
      continue;
    }
    counts.set(iso2, (counts.get(iso2) || 0) + item.count);
  }
  return { counts, unmatched };
}
