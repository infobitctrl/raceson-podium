export const PLATFORM_AGE_CATEGORIES = [
  { key: "u16", label: "U16", minAge: 0, maxAge: 15 },
  { key: "u18", label: "U18", minAge: 16, maxAge: 17 },
  { key: "u20", label: "U20", minAge: 18, maxAge: 19 },
  { key: "u23", label: "U23", minAge: 20, maxAge: 22 },
  { key: "senior", label: "23-34", minAge: 23, maxAge: 34 },
  { key: "35-39", label: "35-39", minAge: 35, maxAge: 39 },
  { key: "40-44", label: "40-44", minAge: 40, maxAge: 44 },
  { key: "45-49", label: "45-49", minAge: 45, maxAge: 49 },
  { key: "50-54", label: "50-54", minAge: 50, maxAge: 54 },
  { key: "55-59", label: "55-59", minAge: 55, maxAge: 59 },
  { key: "60-64", label: "60-64", minAge: 60, maxAge: 64 },
  { key: "65-69", label: "65-69", minAge: 65, maxAge: 69 },
  { key: "70-74", label: "70-74", minAge: 70, maxAge: 74 },
  { key: "75-79", label: "75-79", minAge: 75, maxAge: 79 },
  { key: "80-plus", label: "80+", minAge: 80, maxAge: null },
] as const;

export type PlatformAgeCategoryLabel = (typeof PLATFORM_AGE_CATEGORIES)[number]["label"];

function validIsoDateParts(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function referenceYear(value: string | Date | null | undefined) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getUTCFullYear();
  }
  return validIsoDateParts(value)?.year ?? null;
}

/**
 * Platform categories follow ITRA's season convention: the athlete's age is
 * the age reached by 31 December of the reference year.
 */
export function platformAgeAtYearEnd(
  dateOfBirth: string | null | undefined,
  referenceDate: string | Date | null | undefined,
) {
  const birth = validIsoDateParts(dateOfBirth);
  const year = referenceYear(referenceDate);
  if (!birth || year == null || year < birth.year) return null;
  return year - birth.year;
}

export function platformAgeCategoryForAge(age: number | null | undefined): PlatformAgeCategoryLabel | null {
  if (age == null || !Number.isInteger(age) || age < 0) return null;
  return (
    PLATFORM_AGE_CATEGORIES.find(
      (category) => age >= category.minAge && (category.maxAge == null || age <= category.maxAge),
    )?.label ?? null
  );
}

export function platformAgeCategory(
  dateOfBirth: string | null | undefined,
  referenceDate: string | Date | null | undefined,
) {
  return platformAgeCategoryForAge(platformAgeAtYearEnd(dateOfBirth, referenceDate));
}

export function platformAgeCategoryOrder(label: string | null | undefined) {
  const index = PLATFORM_AGE_CATEGORIES.findIndex((category) => category.label === label);
  return index >= 0 ? index : PLATFORM_AGE_CATEGORIES.length;
}
