import type { SupabaseClient } from "@supabase/supabase-js";

export type PublicRegistrationCountSummary = {
  registeredCount: number;
  confirmedCount: number;
  waitlistedCount: number;
  dnsCount: number;
  checkedInCount: number;
  starterCount: number;
  finisherCount: number;
};

type PublicRegistrationCountRow = {
  event_category_id: string;
  registered_count: number | null;
  confirmed_count: number | null;
  waitlisted_count: number | null;
  dns_count: number | null;
  checked_in_count: number | null;
  starter_count: number | null;
  finisher_count: number | null;
};

export async function getPublicRegistrationCountsByCategoryId(
  supabase: SupabaseClient,
  categoryIds: string[],
): Promise<Map<string, PublicRegistrationCountSummary>> {
  const uniqueCategoryIds = Array.from(new Set(categoryIds.filter(Boolean)));
  if (!uniqueCategoryIds.length) {
    return new Map();
  }

  const { data, error } = await supabase.rpc("public_registration_counts", {
    target_event_category_ids: uniqueCategoryIds,
  });

  if (error) {
    throw error;
  }

  return new Map(
    ((data ?? []) as PublicRegistrationCountRow[]).map((row) => [
      row.event_category_id,
      {
        registeredCount: Number(row.registered_count ?? 0),
        confirmedCount: Number(row.confirmed_count ?? 0),
        waitlistedCount: Number(row.waitlisted_count ?? 0),
        dnsCount: Number(row.dns_count ?? 0),
        checkedInCount: Number(row.checked_in_count ?? 0),
        starterCount: Number(row.starter_count ?? 0),
        finisherCount: Number(row.finisher_count ?? 0),
      },
    ]),
  );
}
