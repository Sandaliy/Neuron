/** A quiet completion ring. Only progress changes animate, never a remount. */
export function CompletionProgress({
  value,
  max,
  label,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
}) {
  const ratio = Math.min(1, Math.max(0, value / Math.max(1, max)));
  return (
    <div
      className="relative flex size-[160px] items-center justify-center"
      role="img"
      aria-label={`${label}: ${Math.round(ratio * 100)}%`}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-secondary opacity-20"
        />
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - ratio}
          className="text-accent transition-[stroke-dashoffset] dur-reveal"
        />
      </svg>
      <span className="text-44 text-primary" data-numeric="">
        {Math.round(ratio * 100)}%
      </span>
    </div>
  );
}
