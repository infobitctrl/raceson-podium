import {
  Compass,
  Dumbbell,
  Flag,
  HeartHandshake,
  Trophy,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_EVENT_ACTIVITY_TYPE,
  type EventActivityType,
} from "@raceson/domain/activities";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { activityTypeMessageKeys } from "./activityTypeMessages";

const iconByActivityType: Record<EventActivityType, LucideIcon> = {
  race: Flag,
  training: Dumbbell,
  recreational: Compass,
  club_activity: UsersRound,
  community: HeartHandshake,
};

export function ActivityTypeBadge({
  activityType,
  kind = "event",
  compact = false,
  className,
}: {
  activityType?: EventActivityType | null;
  kind?: "event" | "league";
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const resolvedActivityType = activityType ?? DEFAULT_EVENT_ACTIVITY_TYPE;
  const Icon = kind === "league" ? Trophy : iconByActivityType[resolvedActivityType];
  const label = kind === "league"
    ? t("activity.league")
    : t(activityTypeMessageKeys[resolvedActivityType]);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-trail-amber/30 bg-trail-amber/10 px-2.5 py-1 text-xs font-semibold text-foreground",
        compact ? "px-2 py-0.5 text-[10px]" : null,
        className,
      )}
      data-activity-type={kind === "league" ? "league" : resolvedActivityType}
    >
      <Icon className="h-3.5 w-3.5 text-trail-amber" aria-hidden="true" />
      {label}
    </span>
  );
}
