/** Shared existing portal points/club scoring. This is not reward eligibility,
 * an official publication, an identity proof or a money calculator. Callers own
 * full-source, policy, classification and duplicate validation. */


// Scoring is a property of the race's publication, not completion of every
// other distance in the event. This never changes operational round status.
export function leagueResultIsOfficial(publicationState: string | null | undefined) {
  return publicationState === "official" || publicationState === "corrected";
}


export function pointsForLeaguePlace(place: number, pointsTable: number[], participationPoints: number) {
  if (place <= 0) return 0;
  return Math.max(0, Math.round(pointsTable[place - 1] ?? participationPoints));
}


export type LeagueClassificationEligibility = {
  classificationId?: string;
  gender?: "M" | "F";
  minimumAge?: number;
  maximumAge?: number;
};


export function matchesLeagueClassification(
  standing: { gender: "M" | "F" | "U"; age: number | null; ageCategory?: string; leagueClassificationIds?: string[] },
  eligibility: LeagueClassificationEligibility,
) {
  if (eligibility.classificationId && standing.leagueClassificationIds !== undefined) {
    return standing.leagueClassificationIds.includes(eligibility.classificationId);
  }
  if (eligibility.gender && standing.gender !== eligibility.gender) return false;

  const ageCategory = standing.ageCategory?.trim() ?? "";
  const rangeMatch = ageCategory.match(
    /(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*[-\u2012\u2013\u2014]\s*(\d{1,3}(?:\.\d+)?)(?:\s|$)/,
  );
  const plusMatch = ageCategory.match(/(?:^|[MW]\s*)(\d{1,3})\s*\+/i);
  const underMatch = ageCategory.match(/(?:^|\s)U(?:nder\s*)?(\d{1,3})(?:\s|$)/i);
  const categoryMinimum = rangeMatch
    ? Number(rangeMatch[1])
    : plusMatch
      ? Number(plusMatch[1])
      : underMatch
        ? 0
        : null;
  const categoryMaximum = rangeMatch
    ? Number(rangeMatch[2])
    : plusMatch
      ? null
      : underMatch
        ? Math.max(0, Number(underMatch[1]) - 1)
        : null;

  if (eligibility.minimumAge != null) {
    if (standing.age != null) {
      if (standing.age < eligibility.minimumAge) return false;
    } else if (categoryMinimum == null || categoryMinimum < eligibility.minimumAge) {
      return false;
    }
  }
  if (eligibility.maximumAge != null) {
    if (standing.age != null) {
      if (standing.age > eligibility.maximumAge) return false;
    } else if (categoryMaximum == null || categoryMaximum > eligibility.maximumAge) {
      return false;
    }
  }
  return true;
}


export type LeagueRoundOutcome = "finished" | "dns" | "dnf" | "dsq";


export function leagueAthleteIdentity(entry: {
  athleteId?: string | null;
  athleteSlug?: string | null;
  name: string;
  gender?: "M" | "F" | "U" | null;
}) {
  const athleteId = entry.athleteId?.trim();
  if (athleteId) return `id:${athleteId}`;

  const slug = entry.athleteSlug?.trim().toLowerCase();
  if (slug && slug !== "athletes") {
    return `slug:${slug}`;
  }
  const name = entry.name.trim().toLocaleLowerCase("hr-HR").replace(/\s+/g, " ");
  if (name) return `name:${name}:${entry.gender ?? "U"}`;
  return "id:unknown";
}

export function preferredAthleteEntry<T extends { athleteSlug: string }>(entries: T[]) {
  return [...entries].sort((left, right) => {
    const leftGeneratedSuffix = /-[0-9a-f]{8}$/i.test(left.athleteSlug) ? 1 : 0;
    const rightGeneratedSuffix = /-[0-9a-f]{8}$/i.test(right.athleteSlug) ? 1 : 0;
    return leftGeneratedSuffix - rightGeneratedSuffix || left.athleteSlug.length - right.athleteSlug.length;
  })[0];
}


export type LeagueScoringEntry = {
  leagueClassificationIds?: string[];
  athleteId: string;
  athleteSlug: string;
  name: string;
  club: string;
  clubSlug: string | null;
  gender: "M" | "F" | "U";
  ageCategory: string;
  age?: number | null;
  roundNumber: number;
  roundStatus: "completed" | "upcoming";
  publicationState?: string | null;
  participationStatus: string;
  overall: number;
};


export type LeagueScoredEntry = LeagueScoringEntry & {
  leaguePoints: number;
};


export function rankLeagueEntriesWithinClassification(
  entries: LeagueScoringEntry[],
  eligibility: LeagueClassificationEligibility,
) {
  const entriesByRound = new Map<number, LeagueScoringEntry[]>();
  for (const entry of entries) {
    if (
      (entry.publicationState === undefined
        ? entry.roundStatus !== "completed"
        : !leagueResultIsOfficial(entry.publicationState))
      || entry.overall <= 0
      || entry.participationStatus.trim().toLowerCase() !== "finished"
      || !matchesLeagueClassification({
        leagueClassificationIds: entry.leagueClassificationIds,
        gender: entry.gender,
        age: entry.age ?? null,
        ageCategory: entry.ageCategory,
      }, eligibility)
    ) continue;
    const roundEntries = entriesByRound.get(entry.roundNumber) ?? [];
    roundEntries.push(entry);
    entriesByRound.set(entry.roundNumber, roundEntries);
  }

  return Array.from(entriesByRound.values()).flatMap((roundEntries) => (
    [...roundEntries]
      .sort((left, right) => left.overall - right.overall || left.name.localeCompare(right.name))
      .map((entry, index) => ({ ...entry, overall: index + 1 }))
  ));
}


export function deriveLeagueClassificationStandings(
  entries: LeagueScoringEntry[],
  eligibility: LeagueClassificationEligibility,
  pointsTable: number[],
  participationPoints: number,
  bestN: number,
  minimumRounds = 0,
  tieBreakMethod = "best_finish",
) {
  return deriveLeagueStandings(
    rankLeagueEntriesWithinClassification(entries, eligibility),
    pointsTable,
    participationPoints,
    bestN,
    minimumRounds,
    tieBreakMethod,
  );
}


export function scoreLeagueEntriesForClassifications(
  entries: LeagueScoringEntry[],
  classifications: Array<{ eligibility: LeagueClassificationEligibility }>,
  pointsTable: number[],
  participationPoints: number,
): LeagueScoredEntry[] {
  const strongestScoreByAthleteRound = new Map<string, LeagueScoredEntry>();
  const activeClassifications = classifications.length ? classifications : [{ eligibility: {} }];

  for (const classification of activeClassifications) {
    const rankedEntries = rankLeagueEntriesWithinClassification(entries, classification.eligibility);
    for (const entry of rankedEntries) {
      const key = `${entry.roundNumber}:${leagueAthleteIdentity(entry)}`;
      const scoredEntry = {
        ...entry,
        leaguePoints: pointsForLeaguePlace(entry.overall, pointsTable, participationPoints),
      };
      const existing = strongestScoreByAthleteRound.get(key);
      if (
        !existing
        || scoredEntry.leaguePoints > existing.leaguePoints
        || (scoredEntry.leaguePoints === existing.leaguePoints && scoredEntry.overall < existing.overall)
      ) {
        strongestScoreByAthleteRound.set(key, scoredEntry);
      }
    }
  }

  return Array.from(strongestScoreByAthleteRound.values());
}


export type DerivedLeagueStanding = {
  athleteId: string;
  athleteSlug: string;
  name: string;
  club: string;
  clubSlug: string | null;
  gender: "M" | "F" | "U";
  ageCategory: string;
  points: number;
  races: number;
  roundScores: number[];
  roundStatuses: LeagueRoundOutcome[];
  bestFinish: number;
  latestRound: number;
  eligible: boolean;
  wins: number;
  lastRoundPoints: number;
};


export function deriveLeagueStandings(
  entries: LeagueScoringEntry[],
  pointsTable: number[],
  participationPoints: number,
  bestN: number,
  minimumRounds = 0,
  tieBreakMethod = "best_finish",
): DerivedLeagueStanding[] {
  const grouped = new Map<string, LeagueScoringEntry[]>();
  for (const entry of entries) {
    if (entry.roundStatus !== "completed" || entry.overall <= 0) continue;
    const normalizedParticipation = entry.participationStatus.trim().toLowerCase();
    if (normalizedParticipation && normalizedParticipation !== "finished") continue;
    const identity = leagueAthleteIdentity(entry);
    const current = grouped.get(identity) ?? [];
    current.push(entry);
    grouped.set(identity, current);
  }

  return Array.from(grouped.entries())
    .map(([, athleteEntries]) => {
      const first = preferredAthleteEntry(athleteEntries);
      const scoredEntries = athleteEntries
        .map((entry) => ({ entry, points: pointsForLeaguePlace(entry.overall, pointsTable, participationPoints) }))
        .sort((left, right) => right.points - left.points || left.entry.overall - right.entry.overall);
      const count = bestN > 0 ? Math.min(bestN, scoredEntries.length) : scoredEntries.length;
      const counted = scoredEntries.slice(0, count);
      const roundScores: number[] = [];
      const roundStatuses: LeagueRoundOutcome[] = [];
      for (const score of scoredEntries) {
        const roundIndex = Math.max(0, score.entry.roundNumber - 1);
        roundScores[roundIndex] = score.points;
        roundStatuses[roundIndex] = "finished";
      }

      return {
        athleteId: first.athleteId,
        athleteSlug: first.athleteSlug,
        name: first.name,
        club: first.club,
        clubSlug: first.clubSlug,
        gender: first.gender,
        ageCategory: first.ageCategory,
        points: counted.reduce((sum, score) => sum + score.points, 0),
        races: athleteEntries.length,
        roundScores,
        roundStatuses,
        bestFinish: Math.min(...athleteEntries.map((entry) => entry.overall)),
        latestRound: Math.max(...athleteEntries.map((entry) => entry.roundNumber)),
        eligible: counted.length >= minimumRounds,
        wins: athleteEntries.filter((entry) => entry.overall === 1).length,
        lastRoundPoints: scoredEntries.find(
          (score) => score.entry.roundNumber === Math.max(...athleteEntries.map((entry) => entry.roundNumber)),
        )?.points ?? 0,
      } satisfies DerivedLeagueStanding;
    })
    .sort((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      if (left.points !== right.points) return right.points - left.points;

      if (tieBreakMethod === "most_wins" && left.wins !== right.wins) return right.wins - left.wins;
      if (tieBreakMethod === "last_round" && left.lastRoundPoints !== right.lastRoundPoints) {
        return right.lastRoundPoints - left.lastRoundPoints;
      }
      if (left.bestFinish !== right.bestFinish) return left.bestFinish - right.bestFinish;
      if (left.wins !== right.wins) return right.wins - left.wins;
      if (left.lastRoundPoints !== right.lastRoundPoints) return right.lastRoundPoints - left.lastRoundPoints;
      return left.name.localeCompare(right.name);
    });
}


export type DerivedLeagueClubStanding = {
  club: string;
  clubSlug: string;
  points: number;
  members: number;
  scoredRounds: number;
  wins: number;
  podiums: number;
  roundPoints: number[];
  scorers: Array<{ athleteId: string; athleteSlug: string; name: string }>;
  memberRows: Array<{
    athleteId: string;
    athleteSlug: string;
    name: string;
    points: number;
    countedPoints: number;
    wins: number;
    podiums: number;
    roundScores: number[];
    roundPlaces: number[];
    countedRounds: boolean[];
    roundStatuses: LeagueRoundOutcome[];
  }>;
};


function clubMembersPerRound(scoringMode: string) {
  if (scoringMode === "best_two") return 2;
  if (scoringMode === "best_four") return 4;
  if (scoringMode === "none") return 0;
  const customMatch = scoringMode.match(/^best_(\d+)$/);
  if (customMatch) return Math.min(10, Math.max(1, Number(customMatch[1])));
  return 3;
}


export function deriveLeagueClubStandings(
  entries: Array<LeagueScoringEntry & { leaguePoints?: number }>,
  pointsTable: number[],
  participationPoints: number,
  scoringMode: string,
): DerivedLeagueClubStanding[] {
  const memberLimit = clubMembersPerRound(scoringMode);
  if (memberLimit === 0) return [];

  const roundGroups = new Map<string, Array<LeagueScoringEntry & { leaguePoints?: number }>>();
  for (const entry of entries) {
    if (entry.roundStatus !== "completed" || entry.overall <= 0 || !entry.clubSlug || entry.club === "Independent") continue;
    if (entry.participationStatus.trim().toLowerCase() !== "finished") continue;
    const key = `${entry.clubSlug}:${entry.roundNumber}`;
    const current = roundGroups.get(key) ?? [];
    current.push(entry);
    roundGroups.set(key, current);
  }

  const clubs = new Map<string, {
    club: string;
    clubSlug: string;
    points: number;
    rounds: Set<number>;
    roundPoints: number[];
    members: Map<string, {
      athleteId: string;
      athleteSlug: string;
      name: string;
      points: number;
      countedPoints: number;
      wins: number;
      podiums: number;
      roundScores: number[];
      roundPlaces: number[];
      countedRounds: boolean[];
      roundStatuses: LeagueRoundOutcome[];
    }>;
  }>();

  for (const group of roundGroups.values()) {
    const strongestByAthlete = new Map<string, {
      entry: LeagueScoringEntry & { leaguePoints?: number };
      points: number;
    }>();
    for (const entry of group) {
      const score = {
        entry,
        points: entry.leaguePoints ?? pointsForLeaguePlace(entry.overall, pointsTable, participationPoints),
      };
      const athleteIdentity = leagueAthleteIdentity(entry);
      const existing = strongestByAthlete.get(athleteIdentity);
      if (!existing || score.points > existing.points || (score.points === existing.points && entry.overall < existing.entry.overall)) {
        strongestByAthlete.set(athleteIdentity, score);
      }
    }
    const counted = Array.from(strongestByAthlete.values())
      .map((entry) => ({
        entry: entry.entry,
        points: entry.points,
      }))
      .sort((left, right) => right.points - left.points || left.entry.overall - right.entry.overall)
      .slice(0, memberLimit);
    const first = counted[0]?.entry;
    if (!first?.clubSlug) continue;
    const club = clubs.get(first.clubSlug) ?? {
      club: first.club,
      clubSlug: first.clubSlug,
      points: 0,
      rounds: new Set<number>(),
      roundPoints: [],
      members: new Map(),
    };
    club.rounds.add(first.roundNumber);
    const countedAthleteIds = new Set(counted.map((score) => leagueAthleteIdentity(score.entry)));
    const roundIndex = Math.max(0, first.roundNumber - 1);
    const clubRoundPoints = counted.reduce((sum, score) => sum + score.points, 0);
    club.points += clubRoundPoints;
    club.roundPoints[roundIndex] = (club.roundPoints[roundIndex] ?? 0) + clubRoundPoints;

    for (const score of strongestByAthlete.values()) {
      const athleteIdentity = leagueAthleteIdentity(score.entry);
      const existing = club.members.get(athleteIdentity);
      const countedForRound = countedAthleteIds.has(athleteIdentity);
      const roundScores = existing?.roundScores ?? [];
      const roundPlaces = existing?.roundPlaces ?? [];
      const countedRounds = existing?.countedRounds ?? [];
      const roundStatuses = existing?.roundStatuses ?? [];
      roundScores[roundIndex] = score.points;
      roundPlaces[roundIndex] = score.entry.overall;
      countedRounds[roundIndex] = countedForRound;
      roundStatuses[roundIndex] = "finished";
      club.members.set(athleteIdentity, {
        athleteId: score.entry.athleteId,
        athleteSlug: score.entry.athleteSlug,
        name: score.entry.name,
        points: (existing?.points ?? 0) + score.points,
        countedPoints: (existing?.countedPoints ?? 0) + (countedForRound ? score.points : 0),
        wins: (existing?.wins ?? 0) + (score.entry.overall === 1 ? 1 : 0),
        podiums: (existing?.podiums ?? 0) + (score.entry.overall <= 3 ? 1 : 0),
        roundScores,
        roundPlaces,
        countedRounds,
        roundStatuses,
      });
    }
    clubs.set(first.clubSlug, club);
  }

  return Array.from(clubs.values())
    .map((club) => {
      const memberRows = Array.from(club.members.values())
        .sort((left, right) =>
          right.countedPoints - left.countedPoints
          || right.points - left.points
          || left.name.localeCompare(right.name),
        );
      return {
        club: club.club,
        clubSlug: club.clubSlug,
        points: club.points,
        members: club.members.size,
        scoredRounds: club.rounds.size,
        wins: memberRows.reduce((sum, member) => sum + member.wins, 0),
        podiums: memberRows.reduce((sum, member) => sum + member.podiums, 0),
        roundPoints: club.roundPoints,
        scorers: memberRows
          .filter((member) => member.countedPoints > 0)
          .map(({ athleteId, athleteSlug, name }) => ({ athleteId, athleteSlug, name })),
        memberRows,
      };
    })
    .sort((left, right) => right.points - left.points || right.scoredRounds - left.scoredRounds || left.club.localeCompare(right.club));
}


export function deriveLeagueCompetitionClubStandings(
  entries: Array<LeagueScoringEntry & { eventCategoryId: string }>,
  eventCategoryIds: Iterable<string>,
  classifications: Array<{ eligibility: LeagueClassificationEligibility }>,
  pointsTable: number[],
  participationPoints: number,
  scoringMode: string,
) {
  const competitionCategoryIds = new Set(eventCategoryIds);
  const competitionEntries = entries.filter((entry) => competitionCategoryIds.has(entry.eventCategoryId));
  return deriveLeagueClubStandings(
    scoreLeagueEntriesForClassifications(
      competitionEntries,
      classifications,
      pointsTable,
      participationPoints,
    ),
    pointsTable,
    participationPoints,
    scoringMode,
  );
}


export type LeagueClubCompetitionScoringInput = {
  eventCategoryIds: Iterable<string>;
  classifications: Array<{ eligibility: LeagueClassificationEligibility }>;
  pointsTable: number[];
  participationPoints: number;
};


/**
 * Scores each race category with its own rules, then pools those scored results
 * before selecting a club's strongest athletes for each event.
 */
export function deriveCombinedLeagueClubStandings(
  entries: Array<LeagueScoringEntry & { eventCategoryId: string }>,
  competitions: LeagueClubCompetitionScoringInput[],
  scoringMode: string,
) {
  const scoredEntries = competitions.flatMap((competition) => {
    const eventCategoryIds = new Set(competition.eventCategoryIds);
    return scoreLeagueEntriesForClassifications(
      entries.filter((entry) => eventCategoryIds.has(entry.eventCategoryId)),
      competition.classifications,
      competition.pointsTable,
      competition.participationPoints,
    );
  });

  return deriveLeagueClubStandings(scoredEntries, [], 0, scoringMode);
}
