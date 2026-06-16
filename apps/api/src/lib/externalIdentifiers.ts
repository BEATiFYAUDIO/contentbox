export const ASSET_CATALOG_IDENTIFIER_TYPES = ["ISRC", "UPC", "ISWC", "EIDR", "ISBN", "DOI"] as const;

export type AssetCatalogIdentifierType = (typeof ASSET_CATALOG_IDENTIFIER_TYPES)[number];

export type NormalizedExternalIdentifier = {
  type: AssetCatalogIdentifierType;
  value: string;
  normalizedValue: string;
  displayValue: string;
};

export type ExternalIdentifierValidationResult =
  | { ok: true; identifier: NormalizedExternalIdentifier }
  | { ok: false; error: string };

const TYPE_SET = new Set<string>(ASSET_CATALOG_IDENTIFIER_TYPES);
const MAX_IDENTIFIER_VALUE_LENGTH = 128;

export function normalizeExternalIdentifierType(value: unknown): AssetCatalogIdentifierType | null {
  const type = String(value || "").trim().toUpperCase();
  return TYPE_SET.has(type) ? (type as AssetCatalogIdentifierType) : null;
}

function fail(error: string): ExternalIdentifierValidationResult {
  return { ok: false, error };
}

function hasInvalidGenericValueShape(value: string): boolean {
  if (!value) return true;
  if (value.length > MAX_IDENTIFIER_VALUE_LENGTH) return true;
  if (/[\r\n\t]/.test(value)) return true;
  if (/\s{2,}/.test(value)) return true;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return true;
  if (/^\+\d[\d\s().-]{7,}$/.test(value)) return true;
  return false;
}

function stripUrlPrefixForDoiLike(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

function isbn10Check(value: string): boolean {
  if (!/^\d{9}[\dX]$/i.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = value[i].toUpperCase();
    const digit = char === "X" ? 10 : Number(char);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13Check(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(value[12]);
}

function upcCheck(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    sum += Number(value[i]) * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(value[11]);
}

export function validateAndNormalizeExternalIdentifier(input: {
  type?: unknown;
  value?: unknown;
  displayValue?: unknown;
}): ExternalIdentifierValidationResult {
  const type = normalizeExternalIdentifierType(input.type);
  if (!type) return fail("Identifier type must be one of: ISRC, UPC, ISWC, EIDR, ISBN, DOI.");

  const raw = String(input.value || "").trim();
  if (hasInvalidGenericValueShape(raw)) return fail("Identifier value is invalid.");

  let normalizedValue = "";
  switch (type) {
    case "ISRC": {
      normalizedValue = raw.replace(/[\s-]+/g, "").toUpperCase();
      if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalizedValue)) {
        return fail("ISRC must use the 12-character recording code format.");
      }
      break;
    }
    case "UPC": {
      normalizedValue = raw.replace(/[\s-]+/g, "");
      if (!upcCheck(normalizedValue)) return fail("UPC must be a valid 12-digit UPC-A code.");
      break;
    }
    case "ISWC": {
      normalizedValue = raw.replace(/[\s.-]+/g, "").toUpperCase();
      if (!/^T\d{10}$/.test(normalizedValue)) return fail("ISWC must use the T followed by 10 digits format.");
      break;
    }
    case "EIDR": {
      normalizedValue = stripUrlPrefixForDoiLike(raw).toUpperCase();
      if (!/^10\.5240\/[A-Z0-9-]+$/.test(normalizedValue)) return fail("EIDR must use the 10.5240/... format.");
      break;
    }
    case "ISBN": {
      normalizedValue = raw.replace(/[\s-]+/g, "").toUpperCase();
      if (!isbn10Check(normalizedValue) && !isbn13Check(normalizedValue)) {
        return fail("ISBN must be a valid ISBN-10 or ISBN-13.");
      }
      break;
    }
    case "DOI": {
      normalizedValue = stripUrlPrefixForDoiLike(raw).toLowerCase();
      if (!/^10\.\d{4,9}\/\S+$/.test(normalizedValue)) return fail("DOI must use the 10.xxxx/... format.");
      break;
    }
  }

  const displayValue = String(input.displayValue || "").trim() || raw;
  if (displayValue.length > MAX_IDENTIFIER_VALUE_LENGTH) return fail("Display value is too long.");

  return {
    ok: true,
    identifier: {
      type,
      value: raw,
      normalizedValue,
      displayValue
    }
  };
}
