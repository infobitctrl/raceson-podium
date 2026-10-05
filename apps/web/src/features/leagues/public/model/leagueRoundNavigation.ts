import type {
  PublicLeagueDetailReadModel,
  PublicLeagueRoundItem,
} from "@/lib/league-read-models";

export type LeagueRoundNavigationModel = {
  current: PublicLeagueRoundItem;
  previous: PublicLeagueRoundItem | null;
  next: PublicLeagueRoundItem | null;
  position: number;
  roundCount: number;
};

function encodeRouteSegment(value: string) {
  return encodeURIComponent(value.trim());
}

export function buildLeagueEventHref(leagueSlug: string, eventSlug: string) {
  return `/leagues/${encodeRouteSegment(leagueSlug)}/events/${encodeRouteSegment(eventSlug)}`;
}

export function buildLeagueCalendarRoundHref(
  leagueSlug: string,
  round: PublicLeagueRoundItem,
) {
  const eventHref = buildLeagueEventHref(leagueSlug, round.eventSlug);
  if (round.status === "completed" || round.hasPublishedResults) {
    return `${eventHref}?tab=results`;
  }
  if (round.status === "registration_open") {
    return `${eventHref}?tab=registrations`;
  }
  return eventHref;
}

function navigableLeagueRounds(
  rounds: PublicLeagueRoundItem[],
  currentEventSlug: string,
) {
  const roundByNumber = new Map<number, PublicLeagueRoundItem>();

  for (const round of rounds) {
    if (round.isPlaceholder || !round.eventSlug.trim()) continue;
    const existing = roundByNumber.get(round.roundNumber);
    if (!existing || round.eventSlug === currentEventSlug) {
      roundByNumber.set(round.roundNumber, round);
    }
  }

  return Array.from(roundByNumber.values()).sort((left, right) => {
    if (left.roundNumber !== right.roundNumber) return left.roundNumber - right.roundNumber;
    return (left.dateIso ?? "").localeCompare(right.dateIso ?? "");
  });
}

export function buildLeagueRoundNavigation(
  league: PublicLeagueDetailReadModel,
  currentEventSlug: string,
): LeagueRoundNavigationModel | null {
  const rounds = navigableLeagueRounds(league.rounds, currentEventSlug);
  const currentIndex = rounds.findIndex((round) => round.eventSlug === currentEventSlug);
  if (currentIndex < 0) return null;

  return {
    current: rounds[currentIndex],
    previous: rounds[currentIndex - 1] ?? null,
    next: rounds[currentIndex + 1] ?? null,
    position: currentIndex + 1,
    roundCount: rounds.length,
  };
}
