"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { persistExplicitLocale, resolveBrowserLocale } from "@/shared/i18n/browser-locale";
import {
  I18nContext,
  type I18nContextValue,
  type LocaleSource,
  type SetLocaleOptions,
} from "@/shared/i18n/I18nContext";
import {
  DETECTED_LOCALE_COOKIE_NAME,
  LEGACY_DETECTED_LOCALE_COOKIE_NAME,
  LEGACY_LOCALE_COOKIE_NAME,
  LOCALE_COOKIE_NAME,
  localeTags,
  type AppLocale,
} from "@/shared/i18n/locales";
import { translate } from "@/shared/i18n/messages";

function initialLocaleSource(): LocaleSource {
  if (typeof document === "undefined") return "default";
  return document.cookie.includes(`${LOCALE_COOKIE_NAME}=`)
    || document.cookie.includes(`${LEGACY_LOCALE_COOKIE_NAME}=`)
    ? "explicit"
    : document.cookie.includes(`${DETECTED_LOCALE_COOKIE_NAME}=`)
      || document.cookie.includes(`${LEGACY_DETECTED_LOCALE_COOKIE_NAME}=`)
      ? "detected"
      : "device";
}

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: AppLocale;
}) {
  const [locale, setLocaleState] = useState<AppLocale>(() => initialLocale ?? resolveBrowserLocale());
  const [source, setSource] = useState<LocaleSource>(() => (
    initialLocale ? "explicit" : initialLocaleSource()
  ));

  const setLocale = useCallback((nextLocale: AppLocale, options: SetLocaleOptions = {}) => {
    setLocaleState(nextLocale);
    setSource(options.source ?? (options.persist === false ? "detected" : "explicit"));
    if (options.persist !== false) persistExplicitLocale(nextLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (locale !== "hr" || typeof document === "undefined" || !document.body) return undefined;

    let cancelled = false;
    let removeLocalization: (() => void) | undefined;
    void import("@/shared/i18n/documentLocalization").then(({ installCroatianDocumentLocalization }) => {
      if (cancelled || !document.body) return;
      removeLocalization = installCroatianDocumentLocalization(document.body);
    });

    return () => {
      cancelled = true;
      removeLocalization?.();
    };
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    localeTag: localeTags[locale],
    source,
    setLocale,
    t: (key, values) => translate(locale, key, values),
    formatNumber: (number, options) => new Intl.NumberFormat(localeTags[locale], options).format(number),
    formatDate: (date, options) => new Intl.DateTimeFormat(localeTags[locale], options).format(new Date(date)),
  }), [locale, setLocale, source]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
