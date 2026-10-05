export type InteractiveChartTooltipDatum = {
  id: string;
  eyebrow: string;
  title: string;
  details: Array<{ label: string; value: string }>;
  xPercent: number;
  yPercent: number;
  color?: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function InteractiveChartTooltip({
  id,
  datum,
}: {
  id: string;
  datum: InteractiveChartTooltipDatum | null;
}) {
  if (!datum) return null;

  const placeBelow = datum.yPercent < 34;

  return (
    <div
      id={id}
      role="tooltip"
      aria-live="polite"
      data-chart-tooltip={datum.id}
      className="pointer-events-none absolute z-20 w-max max-w-[13rem] rounded-2xl border border-white/15 bg-foreground px-3.5 py-3 text-background shadow-[0_16px_35px_-14px_hsl(var(--foreground)/0.72)]"
      style={{
        left: `${clamp(datum.xPercent, 14, 86)}%`,
        top: `${clamp(datum.yPercent, 8, 92)}%`,
        transform: placeBelow ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 14px))",
      }}
    >
      <span
        className="absolute bottom-3 left-3 top-3 w-0.5 rounded-full"
        style={{ backgroundColor: datum.color ?? "hsl(var(--primary))" }}
        aria-hidden="true"
      />
      <div className="pl-2.5">
        <p className="text-[0.56rem] font-black uppercase tracking-[0.14em] text-background/60">{datum.eyebrow}</p>
        <p className="mt-0.5 max-w-[11rem] truncate text-xs font-black text-background">{datum.title}</p>
        <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {datum.details.map((detail) => (
            <div key={detail.label} className="flex items-baseline gap-1">
              <dt className="text-[0.56rem] font-bold text-background/55">{detail.label}</dt>
              <dd className="text-[0.64rem] font-black text-background">{detail.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
