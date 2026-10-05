import type { RequestSession } from "@raceson/domain/auth";
import { countryName } from "@raceson/domain/geography";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireAthleteProfileId } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type AthleteFavoriteEvent = {
  slug: string;
  name: string;
  date: string;
  location: string;
  categories: string[];
  registered: boolean;
};

export type AthleteFavoriteAthlete = {
  slug: string;
  name: string;
  club: string;
  rank: number;
  points: number;
};

export type AthleteFavoriteClub = {
  slug: string;
  name: string;
  location: string;
  members: number;
};

export type AthleteFavoritesReadModel = {
  events: AthleteFavoriteEvent[];
  athletes: AthleteFavoriteAthlete[];
  clubs: AthleteFavoriteClub[];
};

type FavoriteRow = {
  entity_type: string;
  event_edition_id: string | null;
  club_id: string | null;
  target_athlete_profile_id: string | null;
};

type EventEditionRow = {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  location_name: string | null;
};

type EventCategoryRow = {
  id: string;
  event_edition_id: string;
  name: string;
};

type AthleteRow = {
  id: string;
  slug: string;
  display_name: string;
};

type ClubRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  country_code: string | null;
};

type ClubMembershipRow = {
  athlete_profile_id: string;
  club_id: string;
  is_primary: boolean;
};

type ClubStatsRow = {
  club_id: string;
  active_member_count: number;
};

type LeagueStandingRow = {
  athlete_profile_id: string;
  points_total: number | string;
  rank_overall: number | null;
};

function formatDateLabel(dateValue: string | null | undefined) {
  if (!dateValue) return "TBA";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Europe/Zagreb",
  }).format(new Date(`${dateValue}T00:00:00`));
}

function uniqueIds(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export async function getCurrentAthleteFavoritesReadModel(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<AthleteFavoritesReadModel> {
  const athleteProfileId = requireAthleteProfileId(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data: favorites, error: favoritesError } = await adminClient
    .from("athlete_favorites")
    .select("entity_type,event_edition_id,club_id,target_athlete_profile_id")
    .eq("athlete_profile_id", athleteProfileId)
    .order("created_at", { ascending: false })
    .returns<FavoriteRow[]>();

  if (favoritesError) throw favoritesError;
  if (!favorites?.length) return { events: [], athletes: [], clubs: [] };

  const eventEditionIds = uniqueIds(favorites.map((favorite) => favorite.event_edition_id));
  const favoriteClubIds = uniqueIds(favorites.map((favorite) => favorite.club_id));
  const followedAthleteIds = uniqueIds(
    favorites.map((favorite) => favorite.target_athlete_profile_id),
  );

  const [editionResponse, categoryResponse, athleteResponse, membershipResponse, standingResponse] = await Promise.all([
    eventEditionIds.length
      ? adminClient
          .from("event_editions")
          .select("id,slug,name,start_date,location_name")
          .in("id", eventEditionIds)
          .returns<EventEditionRow[]>()
      : Promise.resolve({ data: [] as EventEditionRow[], error: null }),
    eventEditionIds.length
      ? adminClient
          .from("event_categories")
          .select("id,event_edition_id,name")
          .in("event_edition_id", eventEditionIds)
          .order("distance_km", { ascending: true })
          .returns<EventCategoryRow[]>()
      : Promise.resolve({ data: [] as EventCategoryRow[], error: null }),
    followedAthleteIds.length
      ? adminClient
          .from("public_athlete_profiles")
          .select("id,slug,display_name")
          .in("id", followedAthleteIds)
          .returns<AthleteRow[]>()
      : Promise.resolve({ data: [] as AthleteRow[], error: null }),
    followedAthleteIds.length
      ? adminClient
          .from("club_memberships")
          .select("athlete_profile_id,club_id,is_primary")
          .in("athlete_profile_id", followedAthleteIds)
          .eq("status", "active")
          .order("is_primary", { ascending: false })
          .returns<ClubMembershipRow[]>()
      : Promise.resolve({ data: [] as ClubMembershipRow[], error: null }),
    followedAthleteIds.length
      ? adminClient
          .from("league_individual_standings")
          .select("athlete_profile_id,points_total,rank_overall")
          .in("athlete_profile_id", followedAthleteIds)
          .order("rank_overall", { ascending: true, nullsFirst: false })
          .returns<LeagueStandingRow[]>()
      : Promise.resolve({ data: [] as LeagueStandingRow[], error: null }),
  ]);

  if (editionResponse.error) throw editionResponse.error;
  if (categoryResponse.error) throw categoryResponse.error;
  if (athleteResponse.error) throw athleteResponse.error;
  if (membershipResponse.error) throw membershipResponse.error;
  if (standingResponse.error) throw standingResponse.error;

  const memberships = membershipResponse.data ?? [];
  const relatedClubIds = uniqueIds([
    ...favoriteClubIds,
    ...memberships.map((membership) => membership.club_id),
  ]);
  const [clubResponse, clubStatsResponse] = await Promise.all([
    relatedClubIds.length
      ? adminClient
          .from("clubs")
          .select("id,slug,name,city,country_code")
          .in("id", relatedClubIds)
          .returns<ClubRow[]>()
      : Promise.resolve({ data: [] as ClubRow[], error: null }),
    favoriteClubIds.length
      ? adminClient
          .from("club_stats")
          .select("club_id,active_member_count")
          .in("club_id", favoriteClubIds)
          .returns<ClubStatsRow[]>()
      : Promise.resolve({ data: [] as ClubStatsRow[], error: null }),
  ]);

  if (clubResponse.error) throw clubResponse.error;
  if (clubStatsResponse.error) throw clubStatsResponse.error;

  const categoriesByEditionId = new Map<string, string[]>();
  for (const category of categoryResponse.data ?? []) {
    const current = categoriesByEditionId.get(category.event_edition_id) ?? [];
    current.push(category.name);
    categoriesByEditionId.set(category.event_edition_id, current);
  }

  const primaryClubIdByAthleteId = new Map<string, string>();
  for (const membership of memberships) {
    if (!primaryClubIdByAthleteId.has(membership.athlete_profile_id)) {
      primaryClubIdByAthleteId.set(membership.athlete_profile_id, membership.club_id);
    }
  }

  const bestStandingByAthleteId = new Map<string, LeagueStandingRow>();
  for (const standing of standingResponse.data ?? []) {
    if (!bestStandingByAthleteId.has(standing.athlete_profile_id)) {
      bestStandingByAthleteId.set(standing.athlete_profile_id, standing);
    }
  }

  const editionById = new Map((editionResponse.data ?? []).map((edition) => [edition.id, edition]));
  const athleteById = new Map((athleteResponse.data ?? []).map((athlete) => [athlete.id, athlete]));
  const clubById = new Map((clubResponse.data ?? []).map((club) => [club.id, club]));
  const clubStatsById = new Map(
    (clubStatsResponse.data ?? []).map((stats) => [stats.club_id, stats.active_member_count]),
  );

  return {
    events: favorites.flatMap((favorite) => {
      if (favorite.entity_type !== "event_edition" || !favorite.event_edition_id) return [];
      const edition = editionById.get(favorite.event_edition_id);
      if (!edition) return [];
      return [{
        slug: edition.slug,
        name: edition.name,
        date: formatDateLabel(edition.start_date),
        location: edition.location_name ?? "Croatia",
        categories: categoriesByEditionId.get(edition.id) ?? [],
        registered: false,
      }];
    }),
    athletes: favorites.flatMap((favorite) => {
      if (favorite.entity_type !== "athlete_profile" || !favorite.target_athlete_profile_id) return [];
      const athlete = athleteById.get(favorite.target_athlete_profile_id);
      if (!athlete) return [];
      const primaryClubId = primaryClubIdByAthleteId.get(athlete.id);
      const standing = bestStandingByAthleteId.get(athlete.id);
      return [{
        slug: athlete.slug,
        name: athlete.display_name,
        club: (primaryClubId ? clubById.get(primaryClubId)?.name : null) ?? "Independent athlete",
        rank: standing?.rank_overall ?? 0,
        points: Math.round(Number(standing?.points_total ?? 0)),
      }];
    }),
    clubs: favorites.flatMap((favorite) => {
      if (favorite.entity_type !== "club" || !favorite.club_id) return [];
      const club = clubById.get(favorite.club_id);
      if (!club) return [];
      return [{
        slug: club.slug,
        name: club.name,
        location: club.city
          ? `${club.city}, ${countryName(club.country_code || "HR", "Croatia")}`
          : "Croatia",
        members: clubStatsById.get(club.id) ?? 0,
      }];
    }),
  };
}
