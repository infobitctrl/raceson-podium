import type { AuthAccountContext } from "@/lib/auth";

export function formatProviderLabel(provider: string) {
  switch (provider) {
    case "email":
      return "Email + password";
    case "google":
      return "Google";
    default:
      return provider
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (value) => value.toUpperCase());
  }
}

export function formatDateLabel(value: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "Not available";

  try {
    return new Date(value).toLocaleString(undefined, options);
  } catch {
    return value;
  }
}

export function initialsForName(value: string | null | undefined) {
  const words = (value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) return "TP";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

export type AccountCompletion = {
  completedCount: number;
  totalCount: number;
  percent: number;
  remainingItems: string[];
};

export type RaceProfileCompletion = {
  completedRequiredCount: number;
  requiredCount: number;
  percent: number;
  ready: boolean;
  missingRequiredItems: string[];
  missingRecommendedItems: string[];
};

export function getAccountCompletion(
  account: AuthAccountContext | null,
): AccountCompletion {
  const items = [
    Boolean(account?.emailVerified),
    Boolean(account?.displayName?.trim() && account?.firstName?.trim() && account?.lastName?.trim()),
    Boolean(account?.avatarUrl),
    Boolean(account?.locale?.trim() && account?.timezone?.trim()),
    Boolean(account?.primaryAthleteProfileId || account?.primaryAthleteSlug),
  ];

  const labels = [
    "Verify your email",
    "Complete your name",
    "Add a profile picture",
    "Set locale and timezone",
    "Attach your athlete profile",
  ];

  const completedCount = items.filter(Boolean).length;
  const totalCount = items.length;
  const percent = Math.round((completedCount / totalCount) * 100);
  const remainingItems = labels.filter((_, index) => !items[index]);

  return {
    completedCount,
    totalCount,
    percent,
    remainingItems,
  };
}

export function getRaceProfileCompletion(
  account: AuthAccountContext | null,
): RaceProfileCompletion {
  const requiredItems = [
    { label: "Add date of birth", complete: Boolean(account?.dateOfBirth) },
    { label: "Set gender", complete: Boolean(account?.gender) },
    { label: "Add phone number", complete: Boolean(account?.phone?.trim()) },
    {
      label: "Add emergency contact",
      complete: Boolean(account?.emergencyContactName?.trim() && account?.emergencyContactPhone?.trim()),
    },
  ];

  const recommendedItems = [
    { label: "Set country", complete: Boolean(account?.countryCode?.trim()) },
    { label: "Set city", complete: Boolean(account?.city?.trim()) },
    { label: "Set shirt size", complete: Boolean(account?.shirtSize?.trim()) },
  ];

  const completedRequiredCount = requiredItems.filter((item) => item.complete).length;
  const requiredCount = requiredItems.length;
  const percent = Math.round((completedRequiredCount / requiredCount) * 100);

  return {
    completedRequiredCount,
    requiredCount,
    percent,
    ready: completedRequiredCount === requiredCount,
    missingRequiredItems: requiredItems.filter((item) => !item.complete).map((item) => item.label),
    missingRecommendedItems: recommendedItems.filter((item) => !item.complete).map((item) => item.label),
  };
}
