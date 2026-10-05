export function EventStatisticsScopeToggle({
  combined,
  onChange,
  label,
}: {
  combined: boolean;
  onChange: (combined: boolean) => void;
  label: string;
}) {
  return (
    <div className="grid shrink-0 grid-cols-2 rounded-xl border border-border/80 bg-muted/25 p-1" aria-label={label}>
      <button
        type="button"
        aria-pressed={!combined}
        onClick={() => onChange(false)}
        className={`min-h-9 rounded-lg px-3 text-[0.62rem] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${!combined ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        By route
      </button>
      <button
        type="button"
        aria-pressed={combined}
        onClick={() => onChange(true)}
        className={`min-h-9 rounded-lg px-3 text-[0.62rem] font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${combined ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        Combined
      </button>
    </div>
  );
}
