import type { createAdminSupabaseClient } from "../../supabase.js";

type PublishedRow = {
  result_row_id: string;
  registration_id: string;
  athlete_profile_id: string;
  event_category_id: string;
};
type Profile = {
  id: string;
  gender: string | null;
  date_of_birth: string | null;
  birth_year: number | null;
};
type Registration = {
  id: string;
  athlete_profile_id: string;
  birth_year_snapshot: number | null;
};
type Competition = {
  classifications: Array<{
    id: string;
    eligibility: { gender?: string; minimumAge?: number; maximumAge?: number };
  }>;
  roundMappings: Array<{ eventCategoryId: string }>;
};

/** Only published classification membership leaves the server, never DOB/age. */
export function buildPublicLeagueClassificationIds(
  year: number,
  rows: PublishedRow[],
  profiles: Profile[],
  competitions: Competition[],
  registrations: Registration[] = [],
): Map<string, string[]> {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const registrationById = new Map(registrations.map((registration) => [registration.id, registration]));
  return new Map(rows.map((row) => {
    const profile = profileById.get(row.athlete_profile_id);
    const registration = registrationById.get(row.registration_id);
    const snapshotBirthYear = registration?.athlete_profile_id === row.athlete_profile_id
      ? Number(registration.birth_year_snapshot)
      : NaN;
    const profileBirthYear = Number(profile?.birth_year);
    const fullDateBirthYear = profile?.date_of_birth ? Number(profile.date_of_birth.slice(0, 4)) : NaN;
    const birthYear = [snapshotBirthYear, profileBirthYear, fullDateBirthYear]
      .find((value) => Number.isInteger(value) && value >= 1900 && value <= year);
    // League eligibility uses age reached by December 31 of the season year.
    const age = birthYear == null ? null : year - birthYear;
    const rawGender = profile?.gender?.toUpperCase() ?? "";
    const gender = rawGender.startsWith("M") ? "M" : /^[FW]/.test(rawGender) ? "F" : "U";
    const ids = profile ? competitions
      .filter((competition) => competition.roundMappings.some((mapping) => mapping.eventCategoryId === row.event_category_id))
      .flatMap((competition) => competition.classifications)
      .filter(({ eligibility }) =>
        (!eligibility.gender || eligibility.gender === gender)
        && (eligibility.minimumAge == null || (age != null && age >= eligibility.minimumAge))
        && (eligibility.maximumAge == null || (age != null && age <= eligibility.maximumAge)),
      )
      .map(({ id }) => id) : [];
    return [row.result_row_id, [...new Set(ids)]];
  }));
}

export async function getPublicLeagueClassificationIds(
  client: ReturnType<typeof createAdminSupabaseClient>,
  seasonId: string,
  rows: PublishedRow[],
): Promise<Map<string, string[]>> {
  const empty = new Map(rows.map((row) => [row.result_row_id, [] as string[]]));
  if (!rows.length) return empty;
  const { data: season, error: seasonError } = await client.from("league_seasons")
    .select("year,league_id").eq("id", seasonId).not("published_at", "is", null)
    .maybeSingle<{ year: number; league_id: string }>();
  if (seasonError) throw seasonError;
  if (!season || !Number.isInteger(season.year)) return empty;

  const { data: league, error: leagueError } = await client.from("leagues")
    .select("id").eq("id", season.league_id).in("status", ["published", "completed"]).maybeSingle();
  if (leagueError) throw leagueError;
  if (!league) return empty;

  // Reuse the public definition projection: active classifications and mapped,
  // non-cancelled rounds only. Clients cannot submit arbitrary age probes.
  const { data, error } = await client.rpc("public_league_competition_definitions", {
    p_league_season_id: seasonId,
  });
  if (error) throw error;
  const competitions = (data as { competitions?: Competition[] } | null)?.competitions ?? [];
  const categoryIds = new Set(competitions.flatMap((competition) =>
    competition.roundMappings.map((mapping) => mapping.eventCategoryId),
  ));
  const athleteIds = [...new Set(rows.filter((row) => categoryIds.has(row.event_category_id))
    .map((row) => row.athlete_profile_id))];
  const registrationIds = [...new Set(rows.filter((row) => categoryIds.has(row.event_category_id))
    .map((row) => row.registration_id))];
  const profiles: Profile[] = [];
  for (let offset = 0; offset < athleteIds.length; offset += 50) {
    const { data: batch, error: profileError } = await client.from("athlete_profiles")
      .select("id,gender,date_of_birth,birth_year").in("id", athleteIds.slice(offset, offset + 50))
      .eq("status", "active").is("merged_into_athlete_profile_id", null).returns<Profile[]>();
    if (profileError) throw profileError;
    profiles.push(...(batch ?? []));
  }
  const registrations: Registration[] = [];
  for (let offset = 0; offset < registrationIds.length; offset += 50) {
    const { data: batch, error: registrationError } = await client.from("registrations")
      .select("id,athlete_profile_id,birth_year_snapshot")
      .in("id", registrationIds.slice(offset, offset + 50)).returns<Registration[]>();
    if (registrationError) throw registrationError;
    registrations.push(...(batch ?? []));
  }
  return buildPublicLeagueClassificationIds(season.year, rows, profiles, competitions, registrations);
}
