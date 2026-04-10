import { TIME_BASIS_LABEL, TIME_PERIOD_LABEL, type TimeBasis, type TimePeriod } from "../lib/timeScope";

type TimeScopeControlsProps = {
  basis: TimeBasis;
  onBasisChange: (basis: TimeBasis) => void;
  period: TimePeriod;
  onPeriodChange: (period: TimePeriod) => void;
  basisOptions: TimeBasis[];
  periodOptions: TimePeriod[];
  basisDisabled?: boolean;
  periodDisabled?: boolean;
  helperText?: string;
};

export default function TimeScopeControls({
  basis,
  onBasisChange,
  period,
  onPeriodChange,
  basisOptions,
  periodOptions,
  basisDisabled = false,
  periodDisabled = false,
  helperText
}: TimeScopeControlsProps) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">Scope:</span>
        <label className="inline-flex items-center gap-2 text-neutral-400">
          <span>Accounting clock</span>
          <select
            value={basis}
            onChange={(e) => onBasisChange(e.target.value as TimeBasis)}
            disabled={basisDisabled || basisOptions.length <= 1}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 disabled:opacity-60"
          >
            {basisOptions.map((option) => (
              <option key={option} value={option}>
                {TIME_BASIS_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-neutral-400">
          <span>Period</span>
          <select
            value={period}
            onChange={(e) => onPeriodChange(e.target.value as TimePeriod)}
            disabled={periodDisabled || periodOptions.length <= 1}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 disabled:opacity-60"
          >
            {periodOptions.map((option) => (
              <option key={option} value={option}>
                {TIME_PERIOD_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {helperText ? <div className="mt-1 text-xs text-neutral-500">{helperText}</div> : null}
    </div>
  );
}
