import { loadServerEnv, type ServerEnv } from "./env.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type PublicPlatformStats = {
  events: number;
  tracks: number;
  leagues: number;
  athletes: number;
  registrations: number;
  clubs: number;
  finishes: number;
  completedDistanceKm: number;
  countries: number;
  countryCodes: string[];
};

const PUBLISHED_ID_PAGE_SIZE = 1_000;
const IN_FILTER_CHUNK_SIZE = 200;

type RegistrationCountRow = {
  event_category_id: string;
  registered_count: number | null;
};

function chunkValues<T>(values: T[], size = IN_FILTER_CHUNK_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadPublicEventPopulation(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
) {
  const eventEditionIds: string[] = [];

  for (let offset = 0; ; offset += PUBLISHED_ID_PAGE_SIZE) {
    const { data, error } = await adminClient
      .from("event_editions")
      .select("id")
      .eq("public_visibility", "public")
      .not("published_at", "is", null)
      .neq("status", "draft")
      .range(offset, offset + PUBLISHED_ID_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = data ?? [];
    eventEditionIds.push(...rows.map((row) => row.id));
    if (rows.length < PUBLISHED_ID_PAGE_SIZE) break;
  }

  const eventCategoryIds: string[] = [];
  for (const editionIds of chunkValues(eventEditionIds)) {
    const { data, error } = await adminClient
      .from("event_categories")
      .select("id")
      .in("event_edition_id", editionIds)
      .neq("status", "draft")
      .neq("results_mode", "informative_age");
    if (error) throw error;
    eventCategoryIds.push(...(data ?? []).map((row) => row.id));
  }

  return { eventEditionIds, eventCategoryIds };
}

async function countPublicRegistrations(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  eventCategoryIds: string[],
) {
  let total = 0;
  for (const categoryIds of chunkValues(eventCategoryIds)) {
    const { data, error } = await adminClient.rpc("public_registration_counts", {
      target_event_category_ids: categoryIds,
    });
    if (error) throw error;
    total += ((data ?? []) as RegistrationCountRow[]).reduce(
      (sum, row) => sum + Math.max(0, Number(row.registered_count) || 0),
      0,
    );
  }
  return total;
}

async function loadPublishedFinishStats(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  eventCategoryIds: string[],
) {
  let finishes = 0;
  let completedDistanceMeters = 0;

  for (const categoryIds of chunkValues(eventCategoryIds)) {
    const { data: categories, error: categoryError } = await adminClient
      .from("event_categories")
      .select("id,distance_km")
      .in("id", categoryIds);
    if (categoryError) throw categoryError;
    const distanceMetersByCategory = new Map((categories ?? []).map((category) => {
      const distance = Number(category.distance_km);
      return [category.id, Number.isFinite(distance) && distance > 0 ? Math.round(distance * 1_000) : 0];
    }));

    // This projection selects one current official/corrected publication per
    // public race, excluding private, deleted and superseded results.
    for (let offset = 0; ; offset += PUBLISHED_ID_PAGE_SIZE) {
      const { data, error } = await adminClient
        .from("public_current_published_result_rows")
        .select("result_row_id,registration_id,event_category_id")
        .in("event_category_id", categoryIds)
        .gt("finish_time_ms", 0)
        .order("result_row_id", { ascending: true })
        .range(offset, offset + PUBLISHED_ID_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data ?? [];
      const finishedRegistrationIds = new Set<string>();
      for (const ids of chunkValues(rows.map((row) => row.registration_id))) {
        const { data: registrations, error: registrationError } = await adminClient
          .from("registrations")
          .select("id")
          .in("id", ids)
          .eq("participation_status", "finished");
        if (registrationError) throw registrationError;
        for (const registration of registrations ?? []) finishedRegistrationIds.add(registration.id);
      }
      for (const row of rows) {
        if (!finishedRegistrationIds.has(row.registration_id)) continue;
        finishes += 1;
        completedDistanceMeters += distanceMetersByCategory.get(row.event_category_id) ?? 0;
      }
      if (rows.length < PUBLISHED_ID_PAGE_SIZE) break;
    }
  }

  return { finishes, completedDistanceKm: completedDistanceMeters / 1_000 };
}

async function countDistinctPublishedEntities(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  table: "track_versions" | "league_seasons",
  identityColumn: "track_template_id" | "league_id",
) {
  const identities = new Set<string>();

  for (let offset = 0; ; offset += PUBLISHED_ID_PAGE_SIZE) {
    const { data, error } = await adminClient
      .from(table)
      .select(identityColumn)
      .not("published_at", "is", null)
      .range(offset, offset + PUBLISHED_ID_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = data ?? [];
    for (const row of rows) {
      const identity = (row as Record<string, unknown>)[identityColumn];
      if (typeof identity === "string") identities.add(identity);
    }
    if (rows.length < PUBLISHED_ID_PAGE_SIZE) break;
  }

  return identities.size;
}

async function loadActiveAthleteCountryCodes(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
) {
  const countryCodes = new Set<string>();

  for (let offset = 0; ; offset += PUBLISHED_ID_PAGE_SIZE) {
    const { data, error } = await adminClient
      .from("athlete_profiles")
      .select("country_code")
      .eq("status", "active")
      .is("merged_into_athlete_profile_id", null)
      .not("country_code", "is", null)
      .range(offset, offset + PUBLISHED_ID_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = data ?? [];
    for (const row of rows) {
      const countryCode = row.country_code?.trim().toUpperCase() ?? "";
      if (/^[A-Z]{2}$/.test(countryCode)) countryCodes.add(countryCode);
    }
    if (rows.length < PUBLISHED_ID_PAGE_SIZE) break;
  }

  return Array.from(countryCodes).sort();
}

export async function getPublicPlatformStats(
  env: ServerEnv = loadServerEnv(),
): Promise<PublicPlatformStats> {
  const adminClient = createAdminSupabaseClient(env);
  const population = await loadPublicEventPopulation(adminClient);
  const [
    tracks,
    leagues,
    athleteCountResult,
    clubCountResult,
    registrations,
    finishStats,
    countryCodes,
  ] = await Promise.all([
    countDistinctPublishedEntities(adminClient, "track_versions", "track_template_id"),
    countDistinctPublishedEntities(adminClient, "league_seasons", "league_id"),
    adminClient
      .from("athlete_profiles")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("merged_into_athlete_profile_id", null),
    adminClient
      .from("clubs")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    countPublicRegistrations(adminClient, population.eventCategoryIds),
    loadPublishedFinishStats(adminClient, population.eventCategoryIds),
    loadActiveAthleteCountryCodes(adminClient),
  ]);

  if (athleteCountResult.error) throw athleteCountResult.error;
  if (clubCountResult.error) throw clubCountResult.error;

  return {
    events: population.eventEditionIds.length,
    tracks,
    leagues,
    athletes: athleteCountResult.count ?? 0,
    registrations,
    clubs: clubCountResult.count ?? 0,
    ...finishStats,
    countries: countryCodes.length,
    countryCodes,
  };
}
