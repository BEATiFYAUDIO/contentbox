import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeExternalIdentifierType,
  validateAndNormalizeExternalIdentifier
} from "./externalIdentifiers.js";

test("normalizes supported asset/catalog identifier types only", () => {
  assert.equal(normalizeExternalIdentifierType("isrc"), "ISRC");
  assert.equal(normalizeExternalIdentifierType("UPC"), "UPC");
  assert.equal(normalizeExternalIdentifierType("iswc"), "ISWC");
  assert.equal(normalizeExternalIdentifierType("eidr"), "EIDR");
  assert.equal(normalizeExternalIdentifierType("isbn"), "ISBN");
  assert.equal(normalizeExternalIdentifierType("doi"), "DOI");
  assert.equal(normalizeExternalIdentifierType("IPI"), null);
  assert.equal(normalizeExternalIdentifierType("ISNI"), null);
  assert.equal(normalizeExternalIdentifierType("PRO"), null);
});

test("validates and normalizes ISRC", () => {
  const result = validateAndNormalizeExternalIdentifier({ type: "isrc", value: "US-S1Z-99-00001" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.identifier.type, "ISRC");
    assert.equal(result.identifier.normalizedValue, "USS1Z9900001");
  }
});

test("validates UPC-A checksum", () => {
  const result = validateAndNormalizeExternalIdentifier({ type: "UPC", value: "036000291452" });
  assert.equal(result.ok, true);
  const invalid = validateAndNormalizeExternalIdentifier({ type: "UPC", value: "036000291453" });
  assert.equal(invalid.ok, false);
});

test("validates ISWC", () => {
  const result = validateAndNormalizeExternalIdentifier({ type: "ISWC", value: "T-034.524.680-1" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.identifier.normalizedValue, "T0345246801");
});

test("validates EIDR and DOI URL prefixes without storing URLs", () => {
  const eidr = validateAndNormalizeExternalIdentifier({
    type: "EIDR",
    value: "https://doi.org/10.5240/XXXX-XXXX-XXXX-XXXX-3"
  });
  assert.equal(eidr.ok, true);
  if (eidr.ok) assert.equal(eidr.identifier.normalizedValue, "10.5240/XXXX-XXXX-XXXX-XXXX-3");

  const doi = validateAndNormalizeExternalIdentifier({ type: "DOI", value: "doi:10.1234/Example.Asset" });
  assert.equal(doi.ok, true);
  if (doi.ok) assert.equal(doi.identifier.normalizedValue, "10.1234/example.asset");
});

test("validates ISBN-10 and ISBN-13 checksums", () => {
  assert.equal(validateAndNormalizeExternalIdentifier({ type: "ISBN", value: "0-306-40615-2" }).ok, true);
  assert.equal(validateAndNormalizeExternalIdentifier({ type: "ISBN", value: "978-0-306-40615-7" }).ok, true);
  assert.equal(validateAndNormalizeExternalIdentifier({ type: "ISBN", value: "978-0-306-40615-8" }).ok, false);
});

test("rejects party identifiers and contact-like values", () => {
  assert.equal(validateAndNormalizeExternalIdentifier({ type: "IPI", value: "12345678901" }).ok, false);
  assert.equal(validateAndNormalizeExternalIdentifier({ type: "ISNI", value: "000000012146438X" }).ok, false);
  assert.equal(validateAndNormalizeExternalIdentifier({ type: "ISRC", value: "creator@example.com" }).ok, false);
});
