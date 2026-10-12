"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, localeTags, type AppLocale } from "@/shared/i18n/locales";
import {
  type TranslationKey,
  type TranslationValues,
} from "@/shared/i18n/englishMessages";
import { translateEnglish } from "@/shared/i18n/translateEnglish";

export type LocaleSource = "default" | "detected" | "device" | "explicit" | "profile";

export type SetLocaleOptions = {
  persist?: boolean;
  source?: LocaleSource;
};

export type I18nContextValue = {
  locale: AppLocale;
  localeLocked?: boolean;
  localeTag: string;
  source: LocaleSource;
  setLocale: (locale: AppLocale, options?: SetLocaleOptions) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
};

const fallbackContext: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  localeTag: localeTags[DEFAULT_LOCALE],
  source: "default",
  setLocale: () => undefined,
  t: (key, values) => translateEnglish(key, values),
  formatNumber: (value, options) => new Intl.NumberFormat(localeTags[DEFAULT_LOCALE], options).format(value),
  formatDate: (value, options) => new Intl.DateTimeFormat(localeTags[DEFAULT_LOCALE], options).format(new Date(value)),
};

export const I18nContext = createContext<I18nContextValue>(fallbackContext);

export function useI18n() {
  return useContext(I18nContext);
}
