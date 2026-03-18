# Proof Bundles (v1)

Proof bundles are portable JSON artifacts for offline verification of:

- split contract
- publish anchor
- optional settlement

This keeps creator evidence verifiable without requiring centralized lookup.

## What they are for

- collaborator accountability
- deterministic split verification
- optional settlement line verification

## Export

```bash
cd apps/api
npx tsx src/scripts/export_proof_bundle.ts --content <contentId> --out bundle.json
```

Optional settlement anchor:

```bash
npx tsx src/scripts/export_proof_bundle.ts --content <contentId> --settlement <settlementId> --out bundle.json
```

## Verify offline

```bash
cd apps/api
npx tsx src/scripts/verify_proof_bundle.ts --in bundle.json
```

## Canonicalization

- stable key ordering
- deterministic participant sorting
- reproducible `splitsHash` and `bundleHash`

## Notes

- bundle signatures are optional in v1
- settlement inclusion is optional
