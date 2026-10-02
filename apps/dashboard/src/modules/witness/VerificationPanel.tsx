import CreatorIdentityCard from "./CreatorIdentityCard";
import ConnectedAppsCard from "./ConnectedAppsCard";
import VerificationProofsCard from "./VerificationProofsCard";
import { useWitnessIdentity } from "./useWitnessIdentity";

export default function VerificationPanel() {
  const witness = useWitnessIdentity();

  return (
    <div className="space-y-4">
      <CreatorIdentityCard witness={witness} />
      <ConnectedAppsCard witness={witness} />
      <VerificationProofsCard witness={witness} />
    </div>
  );
}
