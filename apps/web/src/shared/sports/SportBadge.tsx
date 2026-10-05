import {
  Activity,
  Bike,
  Droplets,
  Footprints,
  Repeat2,
  Waves,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_SPORT_CODE,
  getSportDefinition,
  normalizeSportCodes,
  type SportCode,
} from "@raceson/domain/sports";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { sportMessageKeys } from "./sportMessages";

const iconBySportCode: Record<SportCode, LucideIcon> = {
  trail_running: Footprints,
  road_running: Footprints,
  swimming: Waves,
  road_cycling: Bike,
  mountain_biking: Bike,
  duathlon: Repeat2,
  triathlon: Activity,
  aquathlon: Droplets,
};

export function SportIcon({
  sportCode,
  className,
}: {
  sportCode?: SportCode | null;
  className?: string;
}) {
  const Icon = iconBySportCode[sportCode ?? DEFAULT_SPORT_CODE];
  return <Icon className={cn("shrink-0", className)} aria-hidden="true" />;
}

export function SportBadge({
  sportCode,
  compact = false,
  className,
}: {
  sportCode?: SportCode | null;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const code = sportCode ?? DEFAULT_SPORT_CODE;
  const definition = getSportDefinition(code);
  const label = t(sportMessageKeys[code]);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary",
        className,
      )}
      data-sport={code}
    >
      <SportIcon sportCode={code} className="h-3.5 w-3.5" />
      {compact ? definition.shortLabel : label}
    </span>
  );
}

export function SportBadgeList({
  sportCodes,
  primarySportCode,
  compact = false,
  className,
  badgeClassName,
}: {
  sportCodes?: readonly SportCode[] | null;
  primarySportCode?: SportCode | null;
  compact?: boolean;
  className?: string;
  badgeClassName?: string;
}) {
  const { t } = useI18n();
  const normalized = normalizeSportCodes(sportCodes, primarySportCode ?? DEFAULT_SPORT_CODE);
  const ordered = primarySportCode && normalized.includes(primarySportCode)
    ? [primarySportCode, ...normalized.filter((code) => code !== primarySportCode)]
    : normalized;

  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label={t("sport.group")}>
      {ordered.map((sportCode) => (
        <SportBadge
          key={sportCode}
          sportCode={sportCode}
          compact={compact}
          className={badgeClassName}
        />
      ))}
    </span>
  );
}
