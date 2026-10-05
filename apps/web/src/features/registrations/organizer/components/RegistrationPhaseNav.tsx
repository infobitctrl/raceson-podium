import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  CircleDollarSign,
  ClipboardCheck,
  LayoutDashboard,
  Medal,
  Radio,
  Settings2,
  Wrench,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { OrganizerEventEditProtection } from "@/shared/organizer/OrganizerEventEditProtection";

export type RegistrationWorkspacePhase =
  | "overview"
  | "setup"
  | "registrations"
  | "finance"
  | "check-in"
  | "timing"
  | "results"
  | "settings";

type RegistrationWorkspaceVariant = "race-data" | "race-day";

const RACE_DATA_ITEMS = [
  {
    id: "overview" as const,
    labelKey: "organizer.raceWorkspace.overview" as const,
    icon: LayoutDashboard,
  },
  {
    id: "settings" as const,
    labelKey: "organizer.raceWorkspace.settings" as const,
    icon: Settings2,
  },
  {
    id: "setup" as const,
    labelKey: "organizer.raceWorkspace.setup" as const,
    icon: Wrench,
  },
  {
    id: "registrations" as const,
    labelKey: "organizer.raceWorkspace.entries" as const,
    icon: Users,
  },
  {
    id: "finance" as const,
    labelKey: "organizer.finance.nav" as const,
    icon: CircleDollarSign,
  },
  {
    id: "results" as const,
    labelKey: "organizer.raceWorkspace.results" as const,
    icon: Medal,
  },
];

const RACE_DAY_ITEMS = [
  {
    id: "check-in" as const,
    labelKey: "nav.registrationDesk" as const,
    icon: ClipboardCheck,
  },
  {
    id: "timing" as const,
    labelKey: "nav.timing" as const,
    icon: Radio,
  },
];

function itemHref(phase: RegistrationWorkspacePhase, eventEditionId: string) {
  if (phase === "overview") {
    return `/organizer/events/${eventEditionId}`;
  }
  if (phase === "setup") {
    return `/organizer/events/${eventEditionId}?tab=races`;
  }
  if (phase === "registrations") {
    return `/organizer/registrations?edition=${eventEditionId}`;
  }
  if (phase === "finance") {
    return `/organizer/registrations/finance?edition=${eventEditionId}`;
  }
  if (phase === "check-in") {
    return `/organizer/registrations/desk?edition=${eventEditionId}`;
  }
  if (phase === "timing") {
    return `/organizer/race-operations?edition=${eventEditionId}&phase=timing`;
  }
  if (phase === "settings") {
    return `/organizer/events/${eventEditionId}?tab=setup`;
  }
  return `/organizer/registrations/results?edition=${eventEditionId}&view=temporary`;
}

export default function RegistrationPhaseNav({
  eventEditionId,
  eventOptions,
  onEventChange,
  activePhase,
  canViewOverview,
  canManageEvent = false,
  eventIsFinished = false,
  canManageEventProtection = canManageEvent,
  canManageRegistrations,
  canManageFinance,
  canManageCheckIn,
  canManageTiming,
  canManageResults,
  variant = "race-data",
  className,
}: {
  eventEditionId: string;
  eventOptions?: Array<{ id: string; name: string }>;
  onEventChange?: (eventEditionId: string) => void;
  activePhase: RegistrationWorkspacePhase;
  canViewOverview: boolean;
  canManageEvent?: boolean;
  eventIsFinished?: boolean;
  canManageEventProtection?: boolean;
  canManageRegistrations: boolean;
  canManageFinance: boolean;
  canManageCheckIn: boolean;
  canManageTiming: boolean;
  canManageResults: boolean;
  variant?: RegistrationWorkspaceVariant;
  className?: string;
}) {
  const { t } = useI18n();
  const activeItemRef = useRef<HTMLAnchorElement>(null);
  const items = variant === "race-day" ? RACE_DAY_ITEMS : RACE_DATA_ITEMS;
  const visibleItems = items.filter((item) => {
    if (item.id === "overview") return canViewOverview && canManageEvent;
    if (item.id === "setup" || item.id === "settings") return canManageEvent;
    if (item.id === "registrations") return canManageRegistrations;
    if (item.id === "finance") return canManageFinance;
    if (item.id === "check-in") return canManageCheckIn;
    if (item.id === "timing") return canManageTiming;
    return canManageResults;
  });

  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    activeItemRef.current?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
  }, [activePhase]);

  return (
    <nav
      aria-label={variant === "race-day"
        ? t("organizer.raceWorkspace.raceDayAria")
        : t("organizer.raceWorkspace.aria")}
      className={cn(
        "relative border-y border-border bg-card/95 shadow-[0_10px_24px_-24px_hsl(var(--foreground)/0.45)] backdrop-blur supports-[backdrop-filter]:bg-card/90 md:border-b md:border-t-0 md:bg-background md:shadow-none",
        className,
      )}
    >
      {eventOptions?.length ? (
        <label className="flex min-h-14 items-center gap-3 border-b border-border/70 px-3 py-2">
          <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">
            {t("organizer.raceWorkspace.activeRace")}
          </span>
          <select
            aria-label={t("organizer.raceWorkspace.activeRaceAria")}
            value={eventEditionId}
            onChange={(event) => onEventChange?.(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-xs font-bold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          >
            {eventOptions.map((event) => (
              <option key={event.id} value={event.id}>{event.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      <section
        aria-label={variant === "race-day"
          ? t("organizer.raceWorkspace.raceDayTools")
          : t("organizer.raceWorkspace.raceData")}
        className="min-w-0"
      >
        <div className="border-b border-border/70 bg-muted/25 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          {variant === "race-day"
            ? t("organizer.raceWorkspace.raceDayTools")
            : t("organizer.raceWorkspace.raceData")}
        </div>
        <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max items-stretch md:min-w-full md:gap-1">
            {visibleItems.map((item) => {
              const active = item.id === activePhase;
              const Icon = item.icon;
              const label = t(item.labelKey);
              return (
                <Link
                  key={item.id}
                  ref={active ? activeItemRef : undefined}
                  to={itemHref(item.id, eventEditionId)}
                  aria-label={label}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "relative inline-flex min-h-16 min-w-[76px] flex-1 flex-col items-center justify-center gap-1 border-t-2 px-2 py-2 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset md:min-h-12 md:min-w-0 md:flex-row md:gap-2 md:border-b-2 md:border-t-0 md:px-3 md:text-xs sm:px-4",
                    active
                      ? "border-primary bg-primary/[0.045] text-primary"
                      : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/35 hover:text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0 md:h-4 md:w-4" aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
      {variant === "race-data" ? (
        <OrganizerEventEditProtection
          eventEditionId={eventEditionId}
          finished={eventIsFinished}
          canManage={canManageEventProtection}
        />
      ) : null}
    </nav>
  );
}
