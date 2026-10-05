import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { TranslationKey } from "@/shared/i18n/messages";
import { PlatformSportIcon } from "./PlatformSportIcon";
import { PLATFORM_SPORTS, type PlatformSportCode } from "./platformSports";

const ROTATION_INTERVAL_MS = 2600;
const platformSportLabelKeys: Record<PlatformSportCode, TranslationKey> = {
  running: "sport.running",
  cycling: "sport.cycling",
  swimming: "sport.swimming",
  triathlon: "sport.triathlon",
};
const platformSportEventLabelKeys: Record<PlatformSportCode, TranslationKey> = {
  running: "sport.runningEvents",
  cycling: "sport.cyclingEvents",
  swimming: "sport.swimmingEvents",
  triathlon: "sport.triathlonEvents",
};

export function MultisportSpotlight({
  className,
  compact = false,
  interactive = true,
  tone = "glass",
}: {
  className?: string;
  compact?: boolean;
  interactive?: boolean;
  tone?: "glass" | "surface";
}) {
  const { t } = useI18n();
  const prefersReducedMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSport = PLATFORM_SPORTS[activeIndex];
  const glass = tone === "glass";

  useEffect(() => {
    if (prefersReducedMotion) return undefined;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % PLATFORM_SPORTS.length);
    }, ROTATION_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [prefersReducedMotion]);

  return (
    <div
      className={cn(
        "w-fit max-w-full",
        compact
          ? "flex items-center gap-2 rounded-full border px-2 py-1.5"
          : "rounded-[22px] border px-3 py-3 backdrop-blur-md sm:px-4",
        glass
          ? "border-white/18 bg-black/20 text-white shadow-[0_18px_42px_-28px_rgba(0,0,0,0.8)]"
          : "border-border/70 bg-background/88 text-foreground shadow-soft",
        className,
      )}
      aria-label={t("sport.platformAria")}
    >
      <div className={cn("flex items-center", compact ? "min-w-[5.5rem]" : "mb-2.5 gap-2")}>
        {!compact ? (
          <span className={cn(
            "text-[9px] font-black uppercase tracking-[0.2em]",
            glass ? "text-white/62" : "text-muted-foreground",
          )}>
            {t("sport.multipleOnePlatform")}
          </span>
        ) : null}
        {compact ? (
          <span
            className={cn(
              "text-[10px] font-bold transition-colors",
              glass ? "text-trail-amber" : "text-primary",
            )}
            data-testid="active-platform-sport"
          >
            {t(platformSportEventLabelKeys[activeSport.code])}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5">
        {PLATFORM_SPORTS.map((sport, index) => {
          const active = index === activeIndex;
          const sharedClassName = cn(
            "group/sport relative inline-flex shrink-0 items-center justify-center rounded-full border transition-all duration-300",
            compact ? "h-7 w-7" : "h-10 w-10 sm:h-11 sm:w-11",
            active
              ? "border-primary bg-primary text-primary-foreground shadow-warm"
              : glass
                ? "border-white/18 bg-white/8 text-white/72 hover:border-white/35 hover:text-white"
                : "border-border bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
          );

          const contents = (
            <>
              <PlatformSportIcon
                sport={sport.code}
                className={compact ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "pointer-events-none absolute bottom-[calc(100%+0.45rem)] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-1 text-[9px] font-bold opacity-0 shadow-lg transition-opacity group-hover/sport:opacity-100 group-focus-visible/sport:opacity-100",
                  glass ? "bg-white text-slate-900" : "bg-foreground text-background",
                )}
                role="tooltip"
              >
                {t(platformSportLabelKeys[sport.code])}
              </span>
            </>
          );

          return interactive ? (
            <button
              key={sport.code}
              type="button"
              className={sharedClassName}
              aria-label={t("sport.show", { sport: t(platformSportLabelKeys[sport.code]) })}
              aria-pressed={active}
              onClick={() => setActiveIndex(index)}
            >
              {contents}
            </button>
          ) : (
            <span
              key={sport.code}
              className={sharedClassName}
              title={t(platformSportLabelKeys[sport.code])}
              aria-hidden="true"
            >
              {contents}
            </span>
          );
        })}
      </div>
    </div>
  );
}
