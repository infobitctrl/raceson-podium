import { ChevronDown } from "lucide-react";
import { useStickyTabs } from "@/hooks/use-sticky-tabs";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";

export type EventNavigationItem = {
  key: string;
  label: string;
  type: "static" | "category";
  detail?: string;
};

type EventSectionNavigationProps = {
  items: readonly EventNavigationItem[];
  activeKey: string;
  selectedRaceKey?: string;
  onSelect: (item: EventNavigationItem) => void;
};

function raceOptionLabel(item: EventNavigationItem) {
  return item.detail ? `${item.detail} · ${item.label}` : item.label;
}

export function EventSectionNavigation({ items, activeKey, selectedRaceKey, onSelect }: EventSectionNavigationProps) {
  const { t } = useI18n();
  const { stickyRef, isStuck } = useStickyTabs();
  const sections = items.filter((item) => item.type === "static");
  const races = items.filter((item) => item.type === "category");
  const activeRace = races.find((item) => item.key === activeKey || (activeKey === "Race info" && item.key === selectedRaceKey));

  function selectItem(key: string) {
    const item = items.find((entry) => entry.key === key);
    if (item) onSelect(item);
  }

  const selectClassName = "min-h-11 w-full min-w-0 appearance-none truncate rounded-xl border border-border/80 bg-background px-4 py-2 pr-10 text-base font-semibold text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 lg:text-sm";

  // Explicit locale-fit ownership keeps generic translated pills from splitting navigation labels.
  return (
    <div
      ref={stickyRef}
      role="navigation"
      aria-label={t("event.sections")}
      className={cn(
        "sticky top-[calc(4rem+1px)] z-[80] border-y border-border/70 bg-white dark:bg-card",
        isStuck && "border-primary/50 shadow-sm",
      )}
    >
      <div className="container mx-auto px-4 py-2 lg:hidden">
        <div className="relative min-w-0">
          <select
            aria-label={t("event.chooseSection")}
            value={activeRace?.key ?? activeKey}
            onChange={(event) => selectItem(event.currentTarget.value)}
            className={selectClassName}
          >
            <optgroup label={t("event.sections")}>
              {sections.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </optgroup>
            {races.length ? (
              <optgroup label={t("common.races")}>
                {races.map((item) => <option key={item.key} value={item.key}>{raceOptionLabel(item)}</option>)}
              </optgroup>
            ) : null}
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" aria-hidden="true" />
        </div>
      </div>

      <div className="container mx-auto hidden items-center gap-4 px-4 py-2 lg:flex">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
          {sections.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item)}
              aria-pressed={activeKey === item.key || (item.key === "Race info" && Boolean(activeRace))}
              data-locale-fit="navigation"
              className={cn(
                "relative min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                activeKey === item.key || (item.key === "Race info" && Boolean(activeRace))
                  ? "bg-primary/10 text-foreground shadow-warm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {races.length ? (
          <div className="relative w-64 shrink-0 border-l border-border/70 pl-4">
            <select
              aria-label={t("event.detail.exploreRaces")}
              title={activeRace ? raceOptionLabel(activeRace) : t("event.detail.exploreRaces")}
              value={activeRace?.key ?? ""}
              onChange={(event) => selectItem(event.currentTarget.value)}
              className={cn(selectClassName, activeRace && "border-primary/50 bg-primary/10")}
            >
              <option value="" disabled>{t("event.detail.racesCount", { count: races.length })}</option>
              {races.map((item) => <option key={item.key} value={item.key}>{raceOptionLabel(item)}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
