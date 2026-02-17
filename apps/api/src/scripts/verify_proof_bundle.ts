import fs from "node:fs";
import assert from "node:assert/strict";
import {
  computeBundleHash,
  computeSplitsHash,
  sortLines,
  sortParticipants,
  type ProofBundleV1,
  type SettlementLine,
  type SplitParticipantRef
} from "../lib/proofs/proofBundle.js";

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

function computeExpectedLines(amountSats: number, participants: SplitParticipantRef[]): SettlementLine[] {
  const ordered = [...participants].sort((a, b) => {
    if (a.bps !== b.bps) return b.bps - a.bps;
    return a.recipientRef.localeCompare(b.recipientRef);
  });
  const expected = ordered.map((p) => ({
    recipientRef: p.recipientRef,
    bps: Math.floor(Number(p.bps || 0)),
    amountSats: Math.floor((amountSats * Math.floor(Number(p.bps || 0))) / 10000),
    recipientDisplay: p.recipientDisplay
  }));
  const baseSum = expected.reduce((sum, line) => sum + line.amountSats, 0);
  const remainder = amountSats - baseSum;
  if (remainder > 0 && expected.length > 0) {
    expected[0].amountSats += remainder;
  }
  return expected;
}

export function verifyBundle(bundle: ProofBundleV1, recipientFilter?: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (bundle.version !== "v1") {
    errors.push(`unsupported bundle version: ${bundle.version}`);
  }

  const recomputedBundleHash = computeBundleHash(bundle);
  if (recomputedBundleHash !== bundle.bundleHash) {
    errors.push("bundleHash mismatch");
  }

  const splitParticipants = sortParticipants(bundle.split.participants || []);
  const recomputedSplitsHash = computeSplitsHash({
    splitVersionId: bundle.split.splitVersionId,
    contentId: bundle.split.contentId,
    lockedManifestSha256: bundle.split.lockedManifestSha256 || bundle.split.lockedFileSha256 || "",
    participants: splitParticipants
  });
  if (recomputedSplitsHash !== bundle.split.splitsHash) {
    errors.push("split.splitsHash mismatch");
  }

  if (bundle.publish.splitVersionId !== bundle.split.splitVersionId) {
    errors.push("publish.splitVersionId does not match split.splitVersionId");
  }
  if (bundle.publish.splitsHash !== bundle.split.splitsHash) {
    errors.push("publish.splitsHash does not match split.splitsHash");
  }

  if (bundle.parentPublishAnchor) {
    const parent = bundle.parentPublishAnchor;
    if (!parent.parentContentId || !parent.parentManifestSha256 || !parent.parentSplitVersionId || !parent.parentSplitsHash) {
      errors.push("parentPublishAnchor missing required fields");
    }
    if (parent.parentContentId === bundle.publish.contentId) {
      errors.push("parentPublishAnchor parentContentId matches child contentId");
    }
  }

  if (bundle.settlement) {
    if (!bundle.lines || bundle.lines.length === 0) {
      errors.push("settlement present but lines are missing");
    }
    if (bundle.settlement.splitsHash !== bundle.split.splitsHash) {
      errors.push("settlement.splitsHash does not match split.splitsHash");
    }
    if (bundle.settlement.splitVersionId !== bundle.split.splitVersionId) {
      errors.push("settlement.splitVersionId does not match split.splitVersionId");
    }
    if (bundle.settlement.manifestSha256 !== bundle.publish.manifestSha256) {
      errors.push("settlement.manifestSha256 does not match publish.manifestSha256");
    }

    if (bundle.lines && bundle.lines.length > 0) {
      const expectedLines = computeExpectedLines(bundle.settlement.amountSats, splitParticipants);
      const expectedByRef = new Map(expectedLines.map((line) => [line.recipientRef, line]));
      const actualByRef = new Map(sortLines(bundle.lines).map((line) => [line.recipientRef, line]));

      const actualSum = [...actualByRef.values()].reduce((sum, line) => sum + line.amountSats, 0);
      if (actualSum !== bundle.settlement.amountSats) {
        errors.push(`settlement lines sum mismatch (expected ${bundle.settlement.amountSats}, got ${actualSum})`);
      }

      for (const [ref, expected] of expectedByRef.entries()) {
        const actual = actualByRef.get(ref);
        if (!actual) {
          errors.push(`missing settlement line for ${ref}`);
          continue;
        }
        if (actual.amountSats !== expected.amountSats) {
          errors.push(`settlement line mismatch for ${ref} (expected ${expected.amountSats}, got ${actual.amountSats})`);
        }
      }

      for (const ref of actualByRef.keys()) {
        if (!expectedByRef.has(ref)) {
          errors.push(`unexpected settlement line for ${ref}`);
        }
      }

      if (recipientFilter) {
        const expected = expectedByRef.get(recipientFilter);
        const actual = actualByRef.get(recipientFilter);
        if (!expected) {
          errors.push(`recipient ${recipientFilter} not found in expected lines`);
        } else if (!actual) {
          errors.push(`recipient ${recipientFilter} not found in actual lines`);
        } else if (actual.amountSats !== expected.amountSats) {
          errors.push(`recipient ${recipientFilter} mismatch (expected ${expected.amountSats}, got ${actual.amountSats})`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

async function run() {
  const inputPath = argValue("--in");
  const recipient = argValue("--recipient");
  if (!inputPath) {
    console.error("Usage: npx tsx src/scripts/verify_proof_bundle.ts --in bundle.json [--recipient <recipientRef>]");
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const bundle = JSON.parse(raw) as ProofBundleV1;
  assert.ok(bundle, "bundle JSON is required");

  const result = verifyBundle(bundle, recipient || undefined);
  if (!result.ok) {
    console.error("verify_proof_bundle FAILED", result.errors);
    process.exit(1);
  }
  console.log("verify_proof_bundle OK", { bundleHash: bundle.bundleHash });
}

const invokedAsScript = process.argv[1]?.includes("verify_proof_bundle");
if (invokedAsScript) {
  run().catch((err) => {
    console.error("verify_proof_bundle FAILED", err);
    process.exit(1);
  });
}
