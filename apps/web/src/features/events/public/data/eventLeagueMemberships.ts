import { getSupabasePublicClient } from "@/lib/supabase";
import {
  buildEventLeagueMembershipsByEdition,
  type EventLeagueMembership,
} from "@/features/events/public/model/eventLeagueMembership";

export async function loadPublicEventLeagueMembershipsByEdition(
  supabase: NonNullable<ReturnType<typeof getSupabasePublicClient>>,
  editionIds: string[],
) {
  if (!editionIds.length) return new Map<string, EventLeagueMembership[]>();

  try {
    const { data: rounds, error: roundsError } = await supabase
      .from("league_rounds")
      .select("league_season_id,event_edition_id,round_number")
      .in("event_edition_id", editionIds);
    if (roundsError) throw roundsError;

    const seasonIds = Array.from(new Set(
      (rounds ?? []).map((round) => round.league_season_id).filter(Boolean),
    ));
    if (!seasonIds.length) return new Map<string, EventLeagueMembership[]>();

    const { data: seasons, error: seasonsError } = await supabase
      .from("league_seasons")
      .select("id,league_id,published_at")
      .in("id", seasonIds)
      .not("published_at", "is", null);
    if (seasonsError) throw seasonsError;

    const leagueIds = Array.from(new Set(
      (seasons ?? []).map((season) => season.league_id).filter(Boolean),
    ));
    if (!leagueIds.length) return new Map<string, EventLeagueMembership[]>();

    const { data: leagues, error: leaguesError } = await supabase
      .from("leagues")
      .select("id,slug,name")
      .in("id", leagueIds);
    if (leaguesError) throw leaguesError;

    return buildEventLeagueMembershipsByEdition({
      rounds: (rounds ?? []).map((round) => ({
        eventEditionId: round.event_edition_id,
        leagueSeasonId: round.league_season_id,
        roundNumber: round.round_number,
      })),
      seasons: (seasons ?? []).map((season) => ({
        id: season.id,
        leagueId: season.league_id,
      })),
      leagues: (leagues ?? []).map((league) => ({
        id: league.id,
        slug: league.slug,
        name: league.name,
      })),
    });
  } catch (error) {
    console.warn("Unable to load public race league memberships", error);
    return new Map<string, EventLeagueMembership[]>();
  }
}
