import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type SectionOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
};

/** Keep every section discoverable without squeezing translated labels. */
export function ResponsiveSectionTabs<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: readonly SectionOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <nav aria-label={label} className="min-w-0">
      <div className="relative sm:hidden">
        <select
          aria-label={label}
          value={value}
          onChange={(event) => {
            const selected = items.find((item) => item.value === event.currentTarget.value);
            if (selected) onChange(selected.value);
          }}
          className="min-h-11 w-full min-w-0 appearance-none truncate rounded-xl border border-border bg-card py-2 pl-3 pr-10 text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="hidden min-w-0 gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] sm:flex">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              data-locale-fit="navigation"
              onClick={() => onChange(item.value)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
