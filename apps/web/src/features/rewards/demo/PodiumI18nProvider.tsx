"use client";

import { useEffect, type ReactNode } from "react";
import { I18nContext, type I18nContextValue } from "@/shared/i18n/I18nContext";
import { localeTags } from "@/shared/i18n/locales";
import { translateEnglish } from "@/shared/i18n/translateEnglish";

// Hackathon presentation only: do not overwrite saved browser/account language.
const english: I18nContextValue = {
  locale: "en",
  localeTag: localeTags.en,
  localeLocked: true,
  source: "explicit",
  setLocale: () => undefined,
  t: translateEnglish,
  formatNumber: (number, options) => new Intl.NumberFormat(localeTags.en, options).format(number),
  formatDate: (date, options) => new Intl.DateTimeFormat(localeTags.en, options).format(new Date(date)),
};

export function PodiumI18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => { document.documentElement.lang = "en"; }, []);
  return <I18nContext.Provider value={english}>{children}</I18nContext.Provider>;
}
