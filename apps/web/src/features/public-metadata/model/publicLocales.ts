import {
  supportedLocales,
  type AppLocale,
} from "@/shared/i18n/locales";

export const PUBLIC_DEFAULT_LOCALE: AppLocale = "en";

export function isPublicLocale(value: string): value is AppLocale {
  return supportedLocales.includes(value as AppLocale);
}

function normalizePublicPath(path: string) {
  if (!path || path === "/") return "/";
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

export function localizedPublicPath(locale: AppLocale, path: string) {
  const normalizedPath = normalizePublicPath(path);
  return normalizedPath === "/" ? `/${locale}` : `/${locale}${normalizedPath}`;
}

export function publicLanguageAlternates(path: string) {
  return {
    en: localizedPublicPath("en", path),
    hr: localizedPublicPath("hr", path),
    "x-default": localizedPublicPath(PUBLIC_DEFAULT_LOCALE, path),
  };
}

export function absolutePublicLanguageAlternates(path: string, origin: string) {
  return Object.fromEntries(
    Object.entries(publicLanguageAlternates(path)).map(([locale, localizedPath]) => [
      locale,
      new URL(localizedPath, origin).toString(),
    ]),
  );
}
