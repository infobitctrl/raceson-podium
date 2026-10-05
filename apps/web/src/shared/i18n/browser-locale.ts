import {
  DEFAULT_LOCALE,
  DETECTED_LOCALE_COOKIE_NAME,
  LEGACY_DETECTED_LOCALE_COOKIE_NAME,
  LEGACY_LOCALE_COOKIE_NAME,
  LOCALE_COOKIE_NAME,
  localeFromAcceptLanguage,
  normalizeAppLocale,
  type AppLocale,
} from "@/shared/i18n/locales";

function readCookie(name: string) {
  if (typeof document === "undefined") return null;
  const encodedName = `${encodeURIComponent(name)}=`;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(encodedName));
  return entry ? decodeURIComponent(entry.slice(encodedName.length)) : null;
}

export function readExplicitLocale(): AppLocale | null {
  return normalizeAppLocale(readCookie(LOCALE_COOKIE_NAME))
    ?? normalizeAppLocale(readCookie(LEGACY_LOCALE_COOKIE_NAME));
}

export function readDetectedLocale(): AppLocale | null {
  return normalizeAppLocale(readCookie(DETECTED_LOCALE_COOKIE_NAME))
    ?? normalizeAppLocale(readCookie(LEGACY_DETECTED_LOCALE_COOKIE_NAME));
}

export function resolveBrowserLocale(): AppLocale {
  return readExplicitLocale()
    ?? readDetectedLocale()
    ?? localeFromAcceptLanguage(typeof navigator === "undefined" ? null : navigator.languages?.join(","))
    ?? localeFromAcceptLanguage(typeof navigator === "undefined" ? null : navigator.language)
    ?? DEFAULT_LOCALE;
}

export function persistExplicitLocale(locale: AppLocale) {
  if (typeof document === "undefined") return;
  const oneYearSeconds = 60 * 60 * 24 * 365;
  document.cookie = `${encodeURIComponent(LOCALE_COOKIE_NAME)}=${locale}; Path=/; Max-Age=${oneYearSeconds}; SameSite=Lax`;
}
