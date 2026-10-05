"use client";

import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";
import type { AppLocale } from "@/shared/i18n/locales";

export function LanguageSwitcher({
  inverted = false,
  compact = false,
  className,
  onLocaleChange,
}: {
  inverted?: boolean;
  compact?: boolean;
  className?: string;
  onLocaleChange?: (locale: AppLocale) => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const choices: Array<{ locale: AppLocale; label: string; shortLabel: string }> = [
    { locale: "hr", label: t("common.croatian"), shortLabel: "HR" },
    { locale: "en", label: t("common.english"), shortLabel: "EN" },
  ];

  return (
    <div
      role="group"
      aria-label={t("language.change")}
      className={cn(
        "inline-flex h-9 shrink-0 items-center rounded-full border p-1 transition-colors",
        compact && "h-10",
        inverted
          ? "border-white/15 bg-white/[0.04]"
          : "border-border bg-muted/45",
        className,
      )}
    >
      {choices.map((choice) => {
        const isSelected = locale === choice.locale;
        return (
          <button
            key={choice.locale}
            type="button"
            aria-label={choice.label}
            aria-pressed={isSelected}
            title={choice.label}
            onClick={() => onLocaleChange
              ? onLocaleChange(choice.locale)
              : setLocale(choice.locale, { source: "explicit" })}
            className={cn(
              "inline-flex h-7 min-w-8 items-center justify-center rounded-full px-2 text-[10px] font-bold tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              compact && "h-8",
              isSelected
                ? "bg-primary text-primary-foreground shadow-sm"
                : inverted
                  ? "text-white/55 hover:text-white"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {choice.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
