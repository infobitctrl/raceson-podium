export type DistributionDonutSegment = {
  label: string;
  value: number;
  color: string;
};

type DistributionDonutProps = {
  segments: DistributionDonutSegment[];
  centerValue: string;
  centerLabel: string;
  ariaLabel?: string;
  className?: string;
};

const CIRCUMFERENCE = 2 * Math.PI * 44;

export function DistributionDonut({
  segments,
  centerValue,
  centerLabel,
  ariaLabel,
  className = "",
}: DistributionDonutProps) {
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  const total = visibleSegments.reduce((sum, segment) => sum + segment.value, 0);
  let progress = 0;
  const description = ariaLabel ?? visibleSegments
    .map((segment) => `${segment.label}: ${segment.value}`)
    .join("; ");

  return (
    <svg
      viewBox="0 0 120 120"
      className={`h-auto w-full max-w-[13rem] ${className}`}
      role="img"
      aria-label={description || `${centerLabel}: ${centerValue}`}
    >
      <circle cx="60" cy="60" r="44" fill="none" stroke="hsl(var(--muted))" strokeWidth="13" />
      {total > 0 ? visibleSegments.map((segment) => {
        const share = segment.value / total;
        const arcLength = share * CIRCUMFERENCE;
        const gap = visibleSegments.length > 1 ? Math.min(2.2, arcLength * 0.18) : 0;
        const dashOffset = progress * CIRCUMFERENCE;
        progress += share;
        return (
          <circle
            key={segment.label}
            cx="60"
            cy="60"
            r="44"
            fill="none"
            stroke={segment.color}
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(0, arcLength - gap)} ${CIRCUMFERENCE}`}
            strokeDashoffset={-dashOffset}
            transform="rotate(-90 60 60)"
            aria-hidden="true"
          />
        );
      }) : null}
      <text x="60" y="56" textAnchor="middle" className="fill-foreground font-display text-[1.15rem] font-black">
        {centerValue}
      </text>
      <text x="60" y="72" textAnchor="middle" className="fill-muted-foreground text-[0.5rem] font-bold uppercase tracking-[0.08em]">
        {centerLabel}
      </text>
    </svg>
  );
}
