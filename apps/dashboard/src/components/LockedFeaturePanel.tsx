type LockedFeaturePanelProps = {
  title: string;
  message?: string;
};

const DEFAULT_MESSAGE = "This feature is not available in Basic edition.";

export default function LockedFeaturePanel({ title, message = DEFAULT_MESSAGE }: LockedFeaturePanelProps) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-6 text-neutral-400">
      <div className="text-lg font-semibold text-neutral-200">{title}</div>
      <div className="text-sm mt-2">{message}</div>
    </div>
  );
}
