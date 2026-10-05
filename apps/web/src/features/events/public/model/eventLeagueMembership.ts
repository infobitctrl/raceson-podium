export type EventLeagueMembership = {
  leagueSlug: string;
  leagueName: string;
  roundNumber: number;
};

type EventLeagueRoundCandidate = {
  eventEditionId: string;
  leagueSeasonId: string;
  roundNumber: number | null;
};

type EventLeagueSeasonCandidate = {
  id: string;
  leagueId: string;
};

type EventLeagueCandidate = {
  id: string;
  slug: string;
  name: string;
};

export function buildEventLeagueMembershipsByEdition({
  rounds,
  seasons,
  leagues,
}: {
  rounds: EventLeagueRoundCandidate[];
  seasons: EventLeagueSeasonCandidate[];
  leagues: EventLeagueCandidate[];
}) {
  const seasonById = new Map(seasons.map((season) => [season.id, season]));
  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const membershipsByEdition = new Map<string, EventLeagueMembership[]>();

  for (const round of rounds) {
    if (!Number.isInteger(round.roundNumber) || Number(round.roundNumber) <= 0) continue;

    const season = seasonById.get(round.leagueSeasonId);
    const league = season ? leagueById.get(season.leagueId) : undefined;
    if (!league?.slug || !league.name) continue;

    const membership = {
      leagueSlug: league.slug,
      leagueName: league.name,
      roundNumber: Number(round.roundNumber),
    } satisfies EventLeagueMembership;
    const current = membershipsByEdition.get(round.eventEditionId) ?? [];
    const duplicate = current.some((candidate) => (
      candidate.leagueSlug === membership.leagueSlug
      && candidate.roundNumber === membership.roundNumber
    ));

    if (!duplicate) {
      current.push(membership);
      membershipsByEdition.set(round.eventEditionId, current);
    }
  }

  for (const memberships of membershipsByEdition.values()) {
    memberships.sort((left, right) => (
      left.roundNumber - right.roundNumber
      || left.leagueName.localeCompare(right.leagueName)
    ));
  }

  return membershipsByEdition;
}
