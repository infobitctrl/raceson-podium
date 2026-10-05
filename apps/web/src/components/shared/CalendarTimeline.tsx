import type { CalendarTimelineAccent } from "@/components/shared/calendarTimelineAccents";
import { useI18n } from "@/shared/i18n/I18nContext";

function MonthMarkerArtwork({
  label,
  accent,
  variant,
}: {
  label: string;
  accent: CalendarTimelineAccent;
  variant: number;
}) {
  const monthMark = label === "Date TBA" ? "TBA" : label.slice(0, 3).toUpperCase();
  const pattern = variant % 4;

  return (
    <div className={`relative flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[28px] border shadow-soft ${accent.dateFrame}`}>
      <div className={`absolute inset-0 ${accent.dateBody}`} />
      <div className={`absolute -right-4 -top-4 h-14 w-14 rounded-full blur-2xl ${accent.dot}`} />
      <div className={`absolute -bottom-5 left-4 h-12 w-12 rounded-full blur-xl ${accent.line}`} />
      <div className={`absolute left-3 top-3 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.22em] ${accent.dateTop}`}>
        {monthMark}
      </div>
      <svg viewBox="0 0 84 84" className={`relative z-10 h-16 w-16 ${accent.monthLabel}`} fill="none" aria-hidden="true">
        {pattern === 0 ? (
          <>
            <path d="M10 56C18 52 22 42 28 36C35 29 40 32 45 39C49 45 53 48 60 46C66 44 71 39 74 34" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M14 61H70" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.45" />
            <circle cx="62" cy="23" r="6" fill="currentColor" opacity="0.18" />
          </>
        ) : pattern === 1 ? (
          <>
            <path d="M17 54C27 44 30 32 42 26C50 22 58 23 67 18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M20 63C26 56 35 55 41 47C48 38 49 29 58 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.42" />
            <circle cx="23" cy="56" r="4" fill="currentColor" opacity="0.18" />
          </>
        ) : pattern === 2 ? (
          <>
            <path d="M14 58L28 40L38 49L51 30L70 58" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
            <path d="M23 58H61" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.4" />
            <circle cx="61" cy="22" r="5.5" fill="currentColor" opacity="0.16" />
          </>
        ) : (
          <>
            <path d="M22 59C27 53 29 43 36 36C42 31 49 31 54 38C58 44 61 48 68 49" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M44 51V24" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
            <path d="M44 24L56 28L44 33V24Z" fill="currentColor" />
          </>
        )}
      </svg>
    </div>
  );
}

export function CalendarTimelineMonthHeader({
  label,
  countLabel,
  accent,
  variant,
}: {
  label: string;
  countLabel: string;
  accent: CalendarTimelineAccent;
  variant: number;
}) {
  const monthMark = label === "Date TBA" ? "TBA" : label.slice(0, 3).toUpperCase();

  return (
    <div className="relative flex items-center gap-4 overflow-hidden rounded-[28px] border border-border/60 bg-card/70 px-4 py-4 shadow-soft">
      <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-display text-[3.4rem] font-black tracking-[0.18em] text-muted-foreground/[0.08]">
        {monthMark}
      </div>
      <MonthMarkerArtwork label={label} accent={accent} variant={variant} />
      <div className="relative z-10">
        <div className="font-display text-2xl font-extrabold tracking-tight text-foreground">{label}</div>
        <div className={`mt-1 text-xs font-bold uppercase tracking-[0.22em] ${accent.monthSubtle}`}>
          {countLabel}
        </div>
      </div>
      <div className="relative z-10 ml-auto hidden min-w-[160px] flex-1 items-center gap-3 lg:flex">
        <div className="h-px flex-1 bg-border/70" />
        <div className="flex gap-1.5">
          <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
          <span className={`h-2 w-2 rounded-full ${accent.dot} opacity-70`} />
          <span className={`h-2 w-2 rounded-full ${accent.dot} opacity-45`} />
        </div>
      </div>
    </div>
  );
}

export function CalendarTimelineDateBadge({
  dateValue,
  accent,
  isLast,
  size = "md",
  showConnector = true,
}: {
  dateValue: Date | null;
  accent: CalendarTimelineAccent;
  isLast: boolean;
  size?: "md" | "sm";
  showConnector?: boolean;
}) {
  const { localeTag, t } = useI18n();
  const monthLabel = dateValue
    ? new Intl.DateTimeFormat(localeTag, { month: "short" }).format(dateValue).replace(".", "").toUpperCase()
    : t("league.calendar.dateTba").toUpperCase();
  const dayLabel = dateValue
    ? new Intl.DateTimeFormat(localeTag, { day: "2-digit" }).format(dateValue)
    : "—";
  const weekdayLabel = dateValue
    ? new Intl.DateTimeFormat(localeTag, { weekday: "short" }).format(dateValue).replace(".", "").toUpperCase()
    : t("league.calendar.dateTba").toUpperCase();
  const isSmall = size === "sm";

  return (
    <div className="relative flex h-full justify-center self-stretch">
      {showConnector && !isLast ? (
        <div className={`absolute bottom-[-1.25rem] left-1/2 h-5 w-px -translate-x-1/2 ${accent.line}`} />
      ) : null}
      <div className={`relative z-10 flex h-full ${isSmall ? "w-[62px] rounded-[18px]" : "w-[76px] rounded-[22px]"} min-h-[100%] flex-col overflow-hidden border shadow-soft ${accent.dateFrame}`}>
        <div className={`${isSmall ? "px-2 py-1.5 text-[9px]" : "px-3 py-2 text-[10px]"} text-center font-bold uppercase tracking-[0.24em] ${accent.dateTop}`}>
          {monthLabel}
        </div>
        <div className={`${isSmall ? "px-2 pb-2.5 pt-2.5" : "px-3 pb-3 pt-3"} flex flex-1 flex-col items-center justify-center text-center ${accent.dateBody}`}>
          <div className={`font-display ${isSmall ? "text-2xl" : "text-3xl"} font-black leading-none ${accent.dateDay}`}>{dayLabel}</div>
          <div className={`${isSmall ? "mt-1.5 text-[9px]" : "mt-2 text-[10px]"} font-bold uppercase tracking-[0.24em] text-muted-foreground`}>
            {weekdayLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
