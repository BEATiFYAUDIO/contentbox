import CreatorIdentityCard from "./CreatorIdentityCard";
import VerificationProofsCard from "./VerificationProofsCard";
import { useWitnessIdentity } from "./useWitnessIdentity";

export default function VerificationPanel() {
  const witness = useWitnessIdentity();

  return (
    <div className="space-y-4">
      <CreatorIdentityCard witness={witness} />
      <VerificationProofsCard witness={witness} />
    </div>
  );
}
