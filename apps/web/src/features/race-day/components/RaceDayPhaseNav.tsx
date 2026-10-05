import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";
import {
  ClipboardCheck,
  Flag,
  LayoutDashboard,
  MapPin,
  Medal,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type RaceDayWorkspacePhase =
  | "overview"
  | "check-in"
  | "start"
  | "timing"
  | "finish"
  | "results";

type PhaseItem = {
  id: RaceDayWorkspacePhase;
  label: string;
  shortLabel: string;
  icon: typeof Flag;
};

type MenuItem = {
  id: string;
  label: string;
  shortLabel: string;
  icon: typeof Flag;
  href: string;
  active: boolean;
};

const PHASES: PhaseItem[] = [
  {
    id: "overview",
    label: "Overview",
    shortLabel: "Overview",
    icon: LayoutDashboard,
  },
  {
    id: "check-in",
    label: "Desk & check-in",
    shortLabel: "Desk",
    icon: ClipboardCheck,
  },
  {
    id: "start",
    label: "Start",
    shortLabel: "Start",
    icon: Flag,
  },
  {
    id: "timing",
    label: "Control points",
    shortLabel: "CPs",
    icon: MapPin,
  },
  {
    id: "finish",
    label: "Finish",
    shortLabel: "Finish",
    icon: ShieldCheck,
  },
  {
    id: "results",
    label: "Results",
    shortLabel: "Results",
    icon: Medal,
  },
];

function phaseHref(
  phase: RaceDayWorkspacePhase,
  eventEditionId: string,
  workspace: "field-operations" | "race-day" | "testing",
) {
  if (workspace === "testing") {
    return phase === "results"
      ? `/organizer/testing/results?edition=${eventEditionId}&view=temporary`
      : `/organizer/testing?edition=${eventEditionId}&phase=${phase}`;
  }
  if (workspace === "field-operations") {
    return phase === "results"
      ? `/organizer/race-operations/results?edition=${eventEditionId}&view=temporary`
      : `/organizer/race-operations?edition=${eventEditionId}&phase=${phase}`;
  }
  return phase === "results"
    ? `/organizer/registrations/results?edition=${eventEditionId}&view=temporary`
    : `/organizer/events/${eventEditionId}/race-day?phase=${phase}`;
}

function RaceDayMenuGroup({
  label,
  items,
  activeItemRef,
}: {
  label: string;
  items: MenuItem[];
  activeItemRef: RefObject<HTMLAnchorElement | null>;
}) {
  if (!items.length) return null;

  return (
    <section aria-label={label} className="min-w-0 border-border/70 lg:border-r lg:last:border-r-0">
      <div className="border-b border-border/70 bg-muted/25 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-stretch md:min-w-full md:gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                ref={item.active ? activeItemRef : undefined}
                to={item.href}
                aria-label={item.label}
                aria-current={item.active ? "step" : undefined}
                className={cn(
                  "relative inline-flex min-h-16 min-w-[76px] flex-1 flex-col items-center justify-center gap-1 border-t-2 px-2 py-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset md:min-h-12 md:min-w-0 md:flex-row md:gap-2 md:border-b-2 md:border-t-0 md:px-3 md:text-xs sm:px-4",
                  item.active
                    ? "border-primary bg-primary/[0.045] text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/35 hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0 md:h-4 md:w-4" aria-hidden="true" />
                <span className="md:hidden">{item.shortLabel}</span>
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function RaceDayPhaseNav({
  eventEditionId,
  eventOptions,
  onEventChange,
  activePhase,
  canViewOverview,
  canManageEntrants,
  canManageRaceDay,
  canEnterTiming,
  canManageResults,
  workspace = "race-day",
  className,
}: {
  eventEditionId: string;
  eventOptions?: Array<{ id: string; name: string; isPractice?: boolean }>;
  onEventChange?: (eventEditionId: string) => void;
  activePhase: RaceDayWorkspacePhase;
  canViewOverview: boolean;
  canManageEntrants: boolean;
  canManageRaceDay: boolean;
  canEnterTiming: boolean;
  canManageResults: boolean;
  workspace?: "field-operations" | "race-day" | "testing";
  className?: string;
}) {
  const activeItemRef = useRef<HTMLAnchorElement>(null);
  const visiblePhases = PHASES.filter((phase) => {
    if (phase.id === "overview") return canViewOverview;
    if (phase.id === "check-in") return canManageEntrants || canManageRaceDay;
    if (phase.id === "timing") return canEnterTiming || canManageRaceDay;
    if (phase.id === "results") return canManageResults;
    return canManageRaceDay;
  });
  const phaseMenuItems = visiblePhases
    .filter((phase) => workspace === "testing" || ["start", "timing", "finish"].includes(phase.id))
    .map<MenuItem>((phase) => ({
      ...phase,
      href: phaseHref(phase.id, eventEditionId, workspace),
      active: phase.id === activePhase,
    }));
  const registrationAndResultsItems = phaseMenuItems.filter((phase) =>
    ["overview", "check-in", "results"].includes(phase.id),
  );
  const timingItems = phaseMenuItems.filter((phase) =>
    ["start", "timing", "finish"].includes(phase.id),
  );

  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    activeItemRef.current?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
  }, [activePhase]);

  return (
    <nav
      aria-label="Race Day operations"
      className={cn(
        "relative border-y border-border bg-card/95 shadow-[0_10px_24px_-24px_hsl(var(--foreground)/0.45)] backdrop-blur supports-[backdrop-filter]:bg-card/90 md:border-b md:border-t-0 md:bg-background md:shadow-none",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        {eventOptions?.length ? (
          <label className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/70 px-3 py-2">
            <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">
              Active race
            </span>
            <select
              aria-label="Active Race Day race"
              value={eventEditionId}
              onChange={(event) => onEventChange?.(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs font-bold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}{event.isPractice ? " · Test" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className={cn("grid min-w-0", workspace === "testing" && "lg:grid-cols-2")}>
          {workspace === "testing" ? (
            <RaceDayMenuGroup
              label="Registration & results"
              items={registrationAndResultsItems}
              activeItemRef={activeItemRef}
            />
          ) : null}
          <RaceDayMenuGroup
            label="Race timing"
            items={timingItems}
            activeItemRef={activeItemRef}
          />
        </div>
      </div>
    </nav>
  );
}
