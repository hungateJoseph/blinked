interface ProgressBarProps {
  /** 0–100. Ignored when `indeterminate` is set. */
  value?: number;
  /** Text shown above the bar, e.g. "Uploading…". */
  label?: string;
  /** Use when the total is unknown (waiting on the AI, for instance). */
  indeterminate?: boolean;
}

/**
 * A simple progress bar. Two modes:
 *  - determinate:  a filled bar that grows with `value`
 *  - indeterminate: a stripe that slides back and forth
 */
export default function ProgressBar({ value = 0, label, indeterminate = false }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div
      className="w-full"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : percent}
    >
      {label && (
        <div className="mb-1 flex justify-between text-xs text-stone-600">
          <span>{label}</span>
          {!indeterminate && <span>{percent}%</span>}
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200">
        {indeterminate ? (
          <div className="animate-indeterminate h-full w-1/3 rounded-full bg-rose-500" />
        ) : (
          <div
            className="h-full rounded-full bg-rose-500 transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}
