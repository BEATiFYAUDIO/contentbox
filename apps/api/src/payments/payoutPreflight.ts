// Reject a new automatic split checkout before creating an invoice when the
// supplied allocation blueprint cannot be paid. Existing settled purchases keep
// their access; this is not a claim that future Lightning routing is guaranteed.
export function participantPayoutPreflightError(allocations: unknown): string | null {
  if (!Array.isArray(allocations) || !allocations.length) return "PARTICIPANT_ALLOCATIONS_REQUIRED";
  const payable = allocations.filter(row => Number(row?.bps) > 0);
  if (!payable.length) return "PARTICIPANT_ALLOCATIONS_REQUIRED";
  for (const row of payable) {
    const address = String(row.destinationValue || row.destinationSummary || "").trim();
    if (row.destinationVerified !== true || row.destinationType !== "lightning_address" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return "PARTICIPANT_PAYOUT_DESTINATION_REQUIRED";
    }
  }
  return null;
}
