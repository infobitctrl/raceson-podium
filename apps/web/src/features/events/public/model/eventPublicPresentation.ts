import { formatSexLabel } from "@/shared/domain/competitiveClassification";
import { translate } from "@/shared/i18n/messages";
import type { AppLocale } from "@/shared/i18n/locales";

type EventLocationCandidate = {
  type: string;
  label: string;
  place: string | null;
};

export function selectEventPublicLocationLabel(input: {
  editionLocationLabel?: string | null;
  seriesLocationLabel?: string | null;
  locations: EventLocationCandidate[];
}) {
  const canonicalLabel = input.editionLocationLabel?.trim() || input.seriesLocationLabel?.trim();
  if (canonicalLabel) return canonicalLabel;

  const preferredTypes = ["start_zone", "registration", "parking", "finish_zone", "info_point"];
  for (const type of preferredTypes) {
    const match = input.locations.find((location) => location.type === type);
    const label = match?.place?.trim() || match?.label?.trim();
    if (label) return label;
  }

  for (const location of input.locations) {
    const label = location.place?.trim() || location.label?.trim();
    if (label) return label;
  }
  return null;
}

export type EventEligibilityPresentation = {
  ageLabel: string;
  genderLabel: string;
  note: string | null;
};

export function buildEventEligibilityPresentation(input: {
  minimumAge?: number | null;
  maximumAge?: number | null;
  allowedGenders?: string[] | null;
  note?: string | null;
}, locale: AppLocale = "en"): EventEligibilityPresentation {
  const minimumAge = Number.isFinite(input.minimumAge) ? Number(input.minimumAge) : null;
  const maximumAge = Number.isFinite(input.maximumAge) ? Number(input.maximumAge) : null;
  const ageLabel = minimumAge != null && maximumAge != null
    ? translate(locale, "event.detail.ageRange", { min: minimumAge, max: maximumAge })
    : minimumAge != null
      ? translate(locale, "event.detail.ageMinimum", { min: minimumAge })
      : maximumAge != null
        ? translate(locale, "event.detail.ageMaximum", { max: maximumAge })
        : translate(locale, "event.detail.ageOpen");
  const genderLabels = Array.from(new Set(
    (input.allowedGenders ?? [])
      .map((value) => {
        const label = formatSexLabel(value);
        return translate(locale, label === "Female" ? "event.detail.female" : label === "Male" ? "event.detail.male" : "event.detail.genderOpen");
      })
      .filter(Boolean),
  ));

  return {
    ageLabel,
    genderLabel: genderLabels.length ? genderLabels.join(" / ") : locale === "hr" ? translate(locale, "event.detail.genderOpen") : "Open category",
    note: input.note?.trim() || null,
  };
}
