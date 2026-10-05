import { EVENT_ACTIVITY_TYPE_DEFINITIONS, type EventActivityType } from "@raceson/domain/activities";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import { ActivityTypeBadge } from "./ActivityTypeBadge";
import {
  activityTypeDescriptionKeys,
  activityTypeMessageKeys,
} from "./activityTypeMessages";

export function ActivityTypeSelector({
  value,
  onChange,
  className,
}: {
  value: EventActivityType;
  onChange: (value: EventActivityType) => void;
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="text-sm font-semibold text-foreground">{t("activity.group")}</legend>
      <p className="text-xs text-muted-foreground">{t("activity.selector.description")}</p>
      <div
        className="grid grid-cols-2 gap-2 md:grid-cols-5"
        role="radiogroup"
        aria-label={t("activity.group")}
      >
        {EVENT_ACTIVITY_TYPE_DEFINITIONS.map((activity) => {
          const selected = value === activity.code;
          const label = t(activityTypeMessageKeys[activity.code]);
          const description = t(activityTypeDescriptionKeys[activity.code]);
          const descriptionId = `activity-${activity.code}-description`;

          return (
            <button
              key={activity.code}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              aria-describedby={descriptionId}
              title={description}
              onClick={() => onChange(activity.code)}
              className={cn(
                "inline-flex min-h-11 min-w-0 items-center justify-center rounded-full border px-3 py-2 text-center transition-all last:col-span-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 md:last:col-span-1",
                selected
                  ? "border-primary/50 bg-primary/[0.08] shadow-[0_0_0_3px_hsl(var(--primary)/0.08)]"
                  : "border-border/70 bg-background hover:border-primary/35 hover:bg-primary/[0.03]",
              )}
            >
              <ActivityTypeBadge
                activityType={activity.code}
                className="min-w-0 shrink justify-center border-0 bg-transparent px-0 py-0 text-xs"
              />
              <span id={descriptionId} className="sr-only">
                {description}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
