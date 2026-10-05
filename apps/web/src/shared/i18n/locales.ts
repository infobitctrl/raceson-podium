export const supportedLocales = ["en", "hr"] as const;

export type AppLocale = (typeof supportedLocales)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const CROATIA_COUNTRY_CODE = "HR";
export const LOCALE_COOKIE_NAME = "raceson_locale";
export const DETECTED_LOCALE_COOKIE_NAME = "raceson_detected_locale";
export const LEGACY_LOCALE_COOKIE_NAME = "sitrail_locale";
export const LEGACY_DETECTED_LOCALE_COOKIE_NAME = "sitrail_detected_locale";

export const localeTags: Record<AppLocale, string> = {
  en: "en-GB",
  hr: "hr-HR",
};

export function normalizeAppLocale(value: string | null | undefined): AppLocale | null {
  const language = value?.trim().replace(/_/g, "-").split("-", 1)[0]?.toLowerCase();
  return supportedLocales.includes(language as AppLocale) ? language as AppLocale : null;
}

export function localeFromCountry(countryCode: string | null | undefined): AppLocale | null {
  const normalizedCountry = countryCode?.trim().toUpperCase();
  if (!normalizedCountry) return null;
  return normalizedCountry === CROATIA_COUNTRY_CODE ? "hr" : "en";
}

export function localeFromAcceptLanguage(value: string | null | undefined): AppLocale | null {
  if (!value?.trim()) return null;

  const candidates = value
    .split(",")
    .map((entry) => {
      const [locale, ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;
      return {
        locale: normalizeAppLocale(locale),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((entry): entry is { locale: AppLocale; quality: number } => Boolean(entry.locale))
    .sort((left, right) => right.quality - left.quality);

  return candidates[0]?.locale ?? null;
}

export function resolveDetectedLocale(input: {
  countryCode?: string | null;
  acceptLanguage?: string | null;
}): AppLocale {
  return localeFromCountry(input.countryCode)
    ?? localeFromAcceptLanguage(input.acceptLanguage)
    ?? DEFAULT_LOCALE;
}
