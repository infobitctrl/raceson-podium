import type { PortalEventCategory } from "@/lib/portal-data";

type PublicRegistrationRow = {
  registrationStatus: string;
};

export type EventRegistrationScopeSummary = {
  totalRegistrations: number;
  publiclyVisibleRegistrations: number;
  confirmedRegistrations: number;
  pendingRegistrations: number;
};

export function buildEventRegistrationScopeSummary({
  categories,
  publicRows,
  categorySlug,
}: {
  categories: PortalEventCategory[];
  publicRows: PublicRegistrationRow[];
  categorySlug: string | null;
}): EventRegistrationScopeSummary {
  const scopedCategories = categorySlug == null
    ? categories
    : categories.filter((category) => category.slug === categorySlug);
  const totalRegistrations = scopedCategories.reduce(
    (sum, category) => sum + Math.max(category.participants, 0),
    0,
  );
  const hasAggregateStatusCounts = scopedCategories.length > 0 && scopedCategories.every(
    (category) => category.confirmedParticipants != null && category.pendingParticipants != null,
  );
  const visibleConfirmedRegistrations = publicRows.filter(
    (row) => row.registrationStatus === "confirmed",
  ).length;
  const visiblePendingRegistrations = publicRows.filter(
    (row) => row.registrationStatus === "pending",
  ).length;

  const confirmedRegistrations = hasAggregateStatusCounts
    ? scopedCategories.reduce(
        (sum, category) => sum + Math.max(category.confirmedParticipants ?? 0, 0),
        0,
      )
    : visibleConfirmedRegistrations;
  const pendingRegistrations = hasAggregateStatusCounts
    ? scopedCategories.reduce(
        (sum, category) => sum + Math.max(category.pendingParticipants ?? 0, 0),
        0,
      )
    : Math.max(visiblePendingRegistrations, totalRegistrations - confirmedRegistrations);

  return {
    totalRegistrations,
    publiclyVisibleRegistrations: publicRows.length,
    confirmedRegistrations,
    pendingRegistrations,
  };
}
