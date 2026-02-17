# Proof Bundles (v1)

## What is a proof bundle?
A proof bundle is a self-contained JSON package that lets stakeholders verify a published split and any associated settlement **offline**, without contacting ContentBox or any central server. This keeps the system sovereign/local-first while still being accountable to collaborators.

Proof bundles:
- Anchor the **split contract** (who gets what, and which locked artifacts it applies to).
- Anchor the **publish event** (manifest + split pairing).
- Optionally anchor a **settlement** (what was paid and how it was allocated).
- Optionally include a **parent publish anchor** for derivative works.
- Include deterministic hashes for reproducible verification.

## Bundle structure (v1)
```
{
  "version": "v1",
  "generatedAt": "2026-02-01T00:00:00.000Z",
  "publish": { ... },
  "split": { ... },
  "settlement": { ... },
  "lines": [ ... ],
  "canonicalOrigin": "https://contentbox.example.com",
  "parentPublishAnchor": { ... },
  "bundleHash": "...",
  "signatures": [ ... ]
}
```

### SplitAnchor (the contract)
```
{
  contentId,
  splitVersionId,
  lockedManifestSha256?,
  lockedFileSha256?,
  splitsHash,
  lockedAt?,
  participants: [{ recipientRef, bps, recipientDisplay? }]
}
```

### PublishAnchor (the release)
```
{
  contentId,
  manifestSha256,
  splitVersionId,
  splitsHash,
  publishedAt?
}
```

### SettlementReceipt (optional)
```
{
  settlementId,
  paymentRef?,
  amountSats,
  paidAt,
  contentId,
  manifestSha256,
  splitVersionId,
  splitsHash
}
```

### SettlementLine (optional)
```
{ recipientRef, bps, amountSats, recipientDisplay? }
```

### ParentPublishAnchor (optional, derivative-safe)
```
{
  parentContentId,
  parentManifestSha256,
  parentSplitVersionId,
  parentSplitsHash
}
```

## Canonical hashing rules
- JSON is canonicalized with stable key ordering.
- Participants/lines are sorted by `recipientRef` ASC, then `bps` DESC.
- `splitsHash` is:
  sha256(canonicalJson({ splitVersionId, contentId, lockedManifestSha256 || lockedFileSha256 || "", participants:[{recipientRef,bps}] }))
- `bundleHash` is:
  sha256(canonicalJson(bundle WITHOUT bundleHash and WITHOUT signatures))

## Export a bundle
### API
```
GET /api/proofs/content/:contentId?includeSettlement=<settlementId>
```

### CLI
```
npx tsx src/scripts/export_proof_bundle.ts --content <id> [--settlement <id>] --out bundle.json
```

## Verify offline
```
npx tsx src/scripts/verify_proof_bundle.ts --in bundle.json [--recipient <recipientRef>]
```

Verifier checks:
- `split.splitsHash` recomputation
- publish/split consistency
- settlement/split consistency
- line totals + deterministic rounding

**Remainder rule:** remainder sats are assigned to the largest `bps` recipient (tie-break `recipientRef` ASC).

## Sovereign but accountable
Proof bundles require no central server to verify. Anyone with the JSON can independently validate the split contract, publish anchor, and settlement outcomes. That gives stakeholders verifiable accountability while keeping data local.

## Future signatures (extension point)
The `signatures` array is reserved for optional schemes (PGP/Keybase/Nostr/etc.). Bundles remain valid without signatures. Future clients can add signatures without breaking older verifiers.
