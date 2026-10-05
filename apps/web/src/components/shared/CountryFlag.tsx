"use client";

import { countryCodeForInput, countryName } from "@/shared/domain/countries";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n/I18nContext";

const localizedCountryNames = {
  en: new Intl.DisplayNames(["en"], { type: "region" }),
  hr: new Intl.DisplayNames(["hr"], { type: "region" }),
};

function countryFlagEmoji(countryCode: string) {
  return [...countryCode]
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}

export function CountryFlag({
  countryCode,
  className,
}: {
  countryCode: string | null | undefined;
  className?: string;
}) {
  const { locale } = useI18n();
  const normalizedCountryCode = countryCodeForInput(countryCode);
  if (!normalizedCountryCode) return null;

  const label = localizedCountryNames[locale].of(normalizedCountryCode)
    ?? countryName(normalizedCountryCode, normalizedCountryCode);
  const flagLabel = locale === "hr" ? `Zastava: ${label}` : `${label} flag`;
  return (
    <span
      data-i18n-skip
      role="img"
      aria-label={flagLabel}
      title={flagLabel}
      className={cn("inline-block shrink-0 text-base leading-none", className)}
    >
      {countryFlagEmoji(normalizedCountryCode)}
    </span>
  );
}

export function CountryWithFlag({
  countryCode,
  className,
  emptyFallback = "—",
  flagClassName,
  nameClassName,
}: {
  countryCode: string | null | undefined;
  className?: string;
  emptyFallback?: string;
  flagClassName?: string;
  nameClassName?: string;
}) {
  const { locale } = useI18n();
  const normalizedCountryCode = countryCodeForInput(countryCode);
  if (!normalizedCountryCode) return <span className={className}>{emptyFallback}</span>;

  return (
    <span data-i18n-skip className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <CountryFlag countryCode={normalizedCountryCode} className={flagClassName} />
      <span className={cn("truncate", nameClassName)}>{localizedCountryNames[locale].of(normalizedCountryCode) ?? countryName(normalizedCountryCode)}</span>
    </span>
  );
}
