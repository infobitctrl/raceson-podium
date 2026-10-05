import {
  defaultAthleteAvatarFor,
  isAllowedProfileAvatarUrl,
} from "@raceson/domain/athletes";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type PublicAthleteAgeCategory = {
  athleteProfileId: string;
  ageCategoryLabel: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
};

export type PublicAthleteResultHistoryItem = {
  resultRowId: string;
  eventCategoryId: string;
  eventSlug: string;
  eventName: string;
  categoryName: string;
  distanceKm: number | null;
  elevationGainM: number | null;
  eventDate: string | null;
  finishTimeMs: number | null;
  rankOverall: number | null;
  totalFinishers: number;
  outcomeLabel: string;
  splits: Array<{
    elapsedTimeMs: number | null;
    sequenceNumber: number;
  }>;
};

export type PublicAthleteLeagueCompetitionStanding = {
  athleteSlug: string;
  leagueSlug: string;
  leagueName: string;
  seasonLabel: string;
  seasonYear: number | null;
  competitionSlug: string;
  competitionName: string;
  rank: number | null;
  points: number;
  scoredRounds: number;
};

export type PublicAthleteFingerprintMetrics = {
  avgRaces: number | null;
  avgDistanceKm: number | null;
  avgClimbM: number | null;
  avgPositionPercent: number | null;
  avgAgeYears: number | null;
};

export type PublicAthleteFingerprintBenchmark = {
  populationAthletes: number;
  asOf: string | null;
  platform: PublicAthleteFingerprintMetrics;
  athlete: {
    races: number;
    avgDistanceKm: number | null;
    avgClimbM: number | null;
    avgPositionPercent: number | null;
  } | null;
};

export type PublicAthleteFingerprintResultRow = {
  athlete_profile_id: string;
  event_category_id: string;
  rank_overall: number | string | null;
  finish_time_ms: number | string | null;
  published_at: string | null;
};

export type PublicAthleteFingerprintProfileRow = {
  id: string;
  slug: string;
  date_of_birth: string | null;
};

export type PublicAthleteFingerprintCategoryRow = {
  id: string;
  distance_km: number | string | null;
  elevation_gain_m: number | string | null;
};

function finiteNumber(value: unknown): number | null {
  const number = value == null ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values: number[], digits = 1): number | null {
  if (!values.length) return null;
  const factor = 10 ** digits;
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function currentAge(dateOfBirth: string | null, asOf: Date) {
  if (!dateOfBirth) return null;
  const birthDate = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime()) || birthDate > asOf) return null;
  let age = asOf.getUTCFullYear() - birthDate.getUTCFullYear();
  const birthdayPassed = asOf.getUTCMonth() > birthDate.getUTCMonth()
    || (asOf.getUTCMonth() === birthDate.getUTCMonth() && asOf.getUTCDate() >= birthDate.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

/**
 * Builds a privacy-safe public comparison. Exact athlete ages never leave this
 * boundary; the public athlete side uses its already-public age category.
 */
export function buildPublicAthleteFingerprintBenchmark(input: {
  athleteSlug: string;
  resultRows: PublicAthleteFingerprintResultRow[];
  profileRows: PublicAthleteFingerprintProfileRow[];
  categoryRows: PublicAthleteFingerprintCategoryRow[];
  asOf?: Date;
}): PublicAthleteFingerprintBenchmark {
  const asOf = input.asOf ?? new Date();
  const profileById = new Map(input.profileRows.map((profile) => [profile.id, profile]));
  const categoryById = new Map(input.categoryRows.map((category) => [category.id, category]));
  const validRows = input.resultRows.filter((row) => {
    const rank = finiteNumber(row.rank_overall);
    const finishTime = finiteNumber(row.finish_time_ms);
    return profileById.has(row.athlete_profile_id) && rank !== null && rank > 0 && finishTime !== null && finishTime > 0;
  });
  const finishersByCategory = new Map<string, number>();
  for (const row of validRows) {
    finishersByCategory.set(row.event_category_id, (finishersByCategory.get(row.event_category_id) ?? 0) + 1);
  }

  type AthleteValues = {
    races: number;
    distances: number[];
    climbs: number[];
    positions: number[];
  };
  const valuesByAthleteId = new Map<string, AthleteValues>();
  for (const row of validRows) {
    const values = valuesByAthleteId.get(row.athlete_profile_id) ?? {
      races: 0,
      distances: [],
      climbs: [],
      positions: [],
    };
    values.races += 1;
    const category = categoryById.get(row.event_category_id);
    const distance = finiteNumber(category?.distance_km);
    const climb = finiteNumber(category?.elevation_gain_m);
    const rank = finiteNumber(row.rank_overall);
    const finishers = finishersByCategory.get(row.event_category_id) ?? 0;
    if (distance !== null && distance >= 0) values.distances.push(distance);
    if (climb !== null && climb >= 0) values.climbs.push(climb);
    if (rank !== null && finishers > 0) {
      values.positions.push(Math.max(0, Math.min(100, (finishers - rank) / finishers * 100)));
    }
    valuesByAthleteId.set(row.athlete_profile_id, values);
  }

  const athleteMeans = [...valuesByAthleteId.entries()].map(([athleteProfileId, values]) => ({
    athleteProfileId,
    races: values.races,
    distanceKm: average(values.distances),
    climbM: average(values.climbs, 0),
    positionPercent: average(values.positions, 0),
  }));
  const targetProfile = input.profileRows.find((profile) => profile.slug === input.athleteSlug) ?? null;
  const target = targetProfile
    ? athleteMeans.find((item) => item.athleteProfileId === targetProfile.id) ?? null
    : null;
  const publishedAt = validRows
    .flatMap((row) => row.published_at && !Number.isNaN(Date.parse(row.published_at)) ? [row.published_at] : [])
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  return {
    populationAthletes: athleteMeans.length,
    asOf: publishedAt,
    platform: {
      avgRaces: average(athleteMeans.map((item) => item.races)),
      avgDistanceKm: average(athleteMeans.flatMap((item) => item.distanceKm === null ? [] : [item.distanceKm])),
      avgClimbM: average(athleteMeans.flatMap((item) => item.climbM === null ? [] : [item.climbM]), 0),
      avgPositionPercent: average(athleteMeans.flatMap((item) => item.positionPercent === null ? [] : [item.positionPercent]), 0),
      avgAgeYears: average(
        [...valuesByAthleteId.keys()].flatMap((athleteProfileId) => {
          const age = currentAge(profileById.get(athleteProfileId)?.date_of_birth ?? null, asOf);
          return age === null ? [] : [age];
        }),
      ),
    },
    athlete: target ? {
      races: target.races,
      avgDistanceKm: target.distanceKm,
      avgClimbM: target.climbM,
      avgPositionPercent: target.positionPercent,
    } : null,
  };
}

function publicAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 2048) return null;
  return isAllowedProfileAvatarUrl(normalized) ? normalized : null;
}

export function defaultUnclaimedAthleteAvatarUrl(input: {
  athleteProfileId: string;
  gender: string | null;
  isClaimed: boolean;
  claimedByUserId: string | null;
}) {
  if (input.isClaimed || input.claimedByUserId) return null;
  return defaultAthleteAvatarFor(input.athleteProfileId, input.gender).path;
}

export async function getPublicAthleteAgeCategories(
  env: ServerEnv = loadServerEnv(),
): Promise<PublicAthleteAgeCategory[]> {
  const adminClient = createAdminSupabaseClient(env);
  const ageCategoryResult = await adminClient.rpc("public_athlete_age_categories");
  if (ageCategoryResult.error) throw ageCategoryResult.error;

  const publicMetadataByAthleteProfileId = new Map<string, PublicAthleteAgeCategory>();
  for (const row of Array.isArray(ageCategoryResult.data) ? ageCategoryResult.data : []) {
    const athleteProfileId = String(row.athlete_profile_id);
    publicMetadataByAthleteProfileId.set(athleteProfileId, {
      athleteProfileId,
      ageCategoryLabel: typeof row.age_category_label === "string" ? row.age_category_label : null,
      avatarUrl: null,
      coverImageUrl: null,
    });
  }

  // Read-only previews deliberately use the publishable key. Keep this public
  // projection on its security-definer RPC instead of attempting private
  // profile reads that require the service role.
  if (env.readOnly) return [...publicMetadataByAthleteProfileId.values()];

  const [avatarResult, athleteResult] = await Promise.all([
    adminClient
      .from("user_profiles")
      .select("primary_athlete_profile_id,avatar_url,cover_image_url")
      .not("primary_athlete_profile_id", "is", null)
      .or("avatar_url.not.is.null,cover_image_url.not.is.null"),
    adminClient
      .from("athlete_profiles")
      .select("id,gender,is_claimed,claimed_by_user_id")
      .eq("status", "active")
      .is("merged_into_athlete_profile_id", null),
  ]);
  if (avatarResult.error) throw avatarResult.error;
  if (athleteResult.error) throw athleteResult.error;

  for (const row of athleteResult.data ?? []) {
    const athleteProfileId = typeof row.id === "string" ? row.id : null;
    if (!athleteProfileId) continue;
    const existing = publicMetadataByAthleteProfileId.get(athleteProfileId);
    publicMetadataByAthleteProfileId.set(athleteProfileId, {
      athleteProfileId,
      ageCategoryLabel: existing?.ageCategoryLabel ?? null,
      avatarUrl: defaultUnclaimedAthleteAvatarUrl({
        athleteProfileId,
        gender: row.gender,
        isClaimed: row.is_claimed,
        claimedByUserId: row.claimed_by_user_id,
      }),
      coverImageUrl: existing?.coverImageUrl ?? null,
    });
  }

  for (const row of avatarResult.data ?? []) {
    const athleteProfileId = typeof row.primary_athlete_profile_id === "string"
      ? row.primary_athlete_profile_id
      : null;
    const avatarUrl = publicAvatarUrl(row.avatar_url);
    const coverImageUrl = publicAvatarUrl(row.cover_image_url);
    if (!athleteProfileId || (!avatarUrl && !coverImageUrl)) continue;

    const existing = publicMetadataByAthleteProfileId.get(athleteProfileId);
    publicMetadataByAthleteProfileId.set(athleteProfileId, {
      athleteProfileId,
      ageCategoryLabel: existing?.ageCategoryLabel ?? null,
      avatarUrl: avatarUrl ?? existing?.avatarUrl ?? null,
      coverImageUrl: coverImageUrl ?? existing?.coverImageUrl ?? null,
    });
  }

  return [...publicMetadataByAthleteProfileId.values()];
}

export async function getPublicAthleteResultHistory(
  athleteSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicAthleteResultHistoryItem[]> {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("public_athlete_result_history", {
    target_athlete_slug: athleteSlug,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const eventCategoryIds = [...new Set(rows.map((row) => String(row.event_category_id)))];
  const [snapshotResponse, categoryResponse] = eventCategoryIds.length
    ? await Promise.all([
        adminClient
          .from("event_category_track_snapshots")
          .select("event_category_id,elevation_gain_m")
          .in("event_category_id", eventCategoryIds)
          .returns<Array<{ event_category_id: string; elevation_gain_m: number | string | null }>>(),
        adminClient
          .from("event_categories")
          .select("id,elevation_gain_m")
          .in("id", eventCategoryIds)
          .returns<Array<{ id: string; elevation_gain_m: number | string | null }>>(),
      ])
    : [
        { data: [] as Array<{ event_category_id: string; elevation_gain_m: number | string | null }>, error: null },
        { data: [] as Array<{ id: string; elevation_gain_m: number | string | null }>, error: null },
      ];
  if (snapshotResponse.error) throw snapshotResponse.error;
  if (categoryResponse.error) throw categoryResponse.error;
  const categoryElevationById = new Map(
    (categoryResponse.data ?? []).map((category) => [category.id, finiteNumber(category.elevation_gain_m)]),
  );
  const snapshotElevationByCategoryId = new Map(
    (snapshotResponse.data ?? []).map((snapshot) => [snapshot.event_category_id, finiteNumber(snapshot.elevation_gain_m)]),
  );

  return rows.map((row) => {
    const rawSplits = Array.isArray(row.splits_json) ? row.splits_json : [];
    const distanceKm = finiteNumber(row.distance_km);
    const finishTimeMs = finiteNumber(row.finish_time_ms);
    const rankOverall = finiteNumber(row.rank_overall);
    const eventCategoryId = String(row.event_category_id);
    const elevationGainM = snapshotElevationByCategoryId.get(eventCategoryId)
      ?? categoryElevationById.get(eventCategoryId)
      ?? null;
    return {
      resultRowId: String(row.result_row_id),
      eventCategoryId,
      eventSlug: String(row.event_slug),
      eventName: String(row.event_name),
      categoryName: String(row.category_name),
      distanceKm: distanceKm != null && distanceKm >= 0 ? distanceKm : null,
      elevationGainM: elevationGainM != null && elevationGainM >= 0 ? Math.round(elevationGainM) : null,
      eventDate: typeof row.event_date === "string" ? row.event_date : null,
      finishTimeMs: finishTimeMs != null && finishTimeMs > 0 ? Math.trunc(finishTimeMs) : null,
      rankOverall: rankOverall != null && rankOverall > 0 ? Math.trunc(rankOverall) : null,
      totalFinishers: Math.max(0, Math.trunc(finiteNumber(row.total_finishers) ?? 0)),
      outcomeLabel: typeof row.outcome_label === "string" ? row.outcome_label : "unknown",
      splits: rawSplits.flatMap((split: unknown) => {
        if (!split || typeof split !== "object") return [];
        const record = split as Record<string, unknown>;
        const sequenceNumber = finiteNumber(record.sequenceNumber);
        if (sequenceNumber == null) return [];
        return [{
          elapsedTimeMs: finiteNumber(record.elapsedTimeMs),
          sequenceNumber: Math.max(0, Math.trunc(sequenceNumber)),
        }];
      }),
    };
  });
}

export async function getPublicAthleteLeagueCompetitionStandings(
  athleteSlug: string | null,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicAthleteLeagueCompetitionStanding[]> {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "public_athlete_league_competition_standings",
    { p_athlete_slug: athleteSlug },
  );
  if (error) throw error;

  return (Array.isArray(data) ? data : []).map((row) => ({
    athleteSlug: String(row.athlete_slug),
    leagueSlug: String(row.league_slug),
    leagueName: String(row.league_name),
    seasonLabel: String(row.season_label),
    seasonYear: finiteNumber(row.season_year),
    competitionSlug: String(row.competition_slug),
    competitionName: String(row.competition_name),
    rank: finiteNumber(row.rank_overall),
    points: Math.round(finiteNumber(row.points_total) ?? 0),
    scoredRounds: Math.max(0, Math.trunc(finiteNumber(row.scored_rounds) ?? 0)),
  }));
}

const FINGERPRINT_PAGE_SIZE = 1_000;
const FINGERPRINT_LOOKUP_CHUNK_SIZE = 200;

function chunks<T>(values: T[], size = FINGERPRINT_LOOKUP_CHUNK_SIZE) {
  return Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );
}

export async function getPublicAthleteFingerprintBenchmark(
  athleteSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PublicAthleteFingerprintBenchmark> {
  const adminClient = createAdminSupabaseClient(env);
  const resultRows: PublicAthleteFingerprintResultRow[] = [];

  for (let offset = 0; ; offset += FINGERPRINT_PAGE_SIZE) {
    const { data, error } = await adminClient
      .from("public_current_published_result_rows")
      .select("athlete_profile_id,event_category_id,rank_overall,finish_time_ms,published_at")
      .not("finish_time_ms", "is", null)
      .not("rank_overall", "is", null)
      .order("published_at", { ascending: false })
      .order("result_row_id", { ascending: true })
      .range(offset, offset + FINGERPRINT_PAGE_SIZE - 1)
      .returns<PublicAthleteFingerprintResultRow[]>();
    if (error) throw error;
    const page = data ?? [];
    resultRows.push(...page);
    if (page.length < FINGERPRINT_PAGE_SIZE) break;
  }

  const athleteProfileIds = [...new Set(resultRows.map((row) => row.athlete_profile_id))];
  const eventCategoryIds = [...new Set(resultRows.map((row) => row.event_category_id))];
  const [profilePages, categoryPages] = await Promise.all([
    Promise.all(chunks(athleteProfileIds).map(async (ids) => {
      const { data, error } = await adminClient
        .from("athlete_profiles")
        .select("id,slug,date_of_birth")
        .in("id", ids)
        .eq("status", "active")
        .is("merged_into_athlete_profile_id", null)
        .returns<PublicAthleteFingerprintProfileRow[]>();
      if (error) throw error;
      return data ?? [];
    })),
    Promise.all(chunks(eventCategoryIds).map(async (ids) => {
      const { data, error } = await adminClient
        .from("event_categories")
        .select("id,distance_km,elevation_gain_m")
        .in("id", ids)
        .returns<PublicAthleteFingerprintCategoryRow[]>();
      if (error) throw error;
      return data ?? [];
    })),
  ]);

  return buildPublicAthleteFingerprintBenchmark({
    athleteSlug,
    resultRows,
    profileRows: profilePages.flat(),
    categoryRows: categoryPages.flat(),
  });
}
