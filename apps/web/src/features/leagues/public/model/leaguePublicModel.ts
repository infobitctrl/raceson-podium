import { leagueResultIsOfficial, matchesLeagueClassification, leagueAthleteIdentity, preferredAthleteEntry,
  type LeagueClassificationEligibility, type LeagueRoundOutcome, type LeagueScoringEntry, type DerivedLeagueStanding } from "@raceson/domain/leagues/standings";

export { leagueResultIsOfficial, pointsForLeaguePlace, matchesLeagueClassification, leagueAthleteIdentity,
  rankLeagueEntriesWithinClassification, deriveLeagueClassificationStandings, scoreLeagueEntriesForClassifications,
  deriveLeagueStandings, deriveLeagueClubStandings, deriveLeagueCompetitionClubStandings, deriveCombinedLeagueClubStandings,
} from "@raceson/domain/leagues/standings";
export type { LeagueClassificationEligibility, LeagueRoundOutcome, LeagueScoringEntry, LeagueScoredEntry,
  DerivedLeagueStanding, DerivedLeagueClubStanding, LeagueClubCompetitionScoringInput,
} from "@raceson/domain/leagues/standings";
import { formatUniversalAgeCategoryLabel } from "@/shared/domain/competitiveClassification";
import { normalizePublicResultClubName } from "@/features/results/public/model/publicResultPresentation";
import { resolveCompetitionCategoryPolicy } from "@raceson/domain/categories";
import {
  deriveLeagueRoundStatus,
  type LeagueRoundStatus,
} from "@raceson/domain/leagues";

export { deriveLeagueRoundStatus };
export type { LeagueRoundStatus };

export function latestPublishedLeagueRound(entries: Array<{
  roundNumber: number;
  publicationState?: string | null;
}>) {
  return entries.reduce((latest, entry) => leagueResultIsOfficial(entry.publicationState)
    ? Math.max(latest, entry.roundNumber) : latest, 0);
}

export function deriveLeagueSeasonStatus(
  roundStatuses: LeagueRoundStatus[],
  fallbackStatus: string | null | undefined,
  plannedRoundCount = roundStatuses.length,
): "active" | "upcoming" | "completed" {
  const normalizedFallback = (fallbackStatus ?? "").trim().toLowerCase();
  // Every announced round must be complete, including planned rounds whose
  // race/date is still TBA. Stored season metadata cannot close unfinished
  // rounds, and an empty calendar is not evidence of completion.
  if (
    roundStatuses.length
    && roundStatuses.length >= plannedRoundCount
    && roundStatuses.every((status) => status === "completed")
  ) return "completed";
  if (
    normalizedFallback.includes("active")
    || normalizedFallback.includes("publish")
    || normalizedFallback.includes("registration_open")
  ) return "active";
  // Round lifecycle is the stronger public signal when a published season has
  // stale organizer metadata. A completed, live, or registration-open round
  // means the season has already started even if its stored status is draft or
  // upcoming.
  if (roundStatuses.some((status) => status !== "upcoming")) return "active";
  if (normalizedFallback.includes("upcoming") || normalizedFallback.includes("draft")) return "upcoming";
  return "active";
}

export function groupLeagueCategoryIdsByEdition(
  categories: Array<{ id: string; eventEditionId: string }>,
) {
  const categoryIdsByEditionId = new Map<string, string[]>();
  for (const category of categories) {
    const categoryIds = categoryIdsByEditionId.get(category.eventEditionId) ?? [];
    categoryIds.push(category.id);
    categoryIdsByEditionId.set(category.eventEditionId, categoryIds);
  }
  return categoryIdsByEditionId;
}

export function deriveLeagueRoundPublicationStatus(
  expectedCategoryIds: string[],
  entries: Array<{
    eventCategoryId: string;
    publicationState: string | null | undefined;
  }>,
) {
  const publishedCategoryIds = new Set(
    entries
      .filter((entry) => entry.publicationState === "official" || entry.publicationState === "corrected")
      .map((entry) => entry.eventCategoryId),
  );
  const hasAnyPublishedResults = publishedCategoryIds.size > 0;
  const hasPublishedResults = expectedCategoryIds.length > 0
    && expectedCategoryIds.every((categoryId) => publishedCategoryIds.has(categoryId));

  return {
    hasPublishedResults,
    hasPartialPublishedResults: hasAnyPublishedResults && !hasPublishedResults,
  };
}

export function buildLeagueRoundLookupByCategory<
  TRound extends {
    eventEditionId: string;
    eventCategoryId: string;
    roundNumber: number;
  },
>(
  rounds: TRound[],
  mappings: Array<{
    eventEditionId: string;
    eventCategoryId: string;
    roundNumber: number;
  }>,
) {
  const roundByEditionId = new Map(rounds.map((round) => [round.eventEditionId, round]));
  const roundByNumber = new Map(rounds.map((round) => [round.roundNumber, round]));
  const roundByCategoryId = new Map<string, TRound>();

  for (const mapping of mappings) {
    const round = roundByEditionId.get(mapping.eventEditionId) ?? roundByNumber.get(mapping.roundNumber);
    if (round) roundByCategoryId.set(mapping.eventCategoryId, round);
  }
  for (const round of rounds) {
    if (!roundByCategoryId.has(round.eventCategoryId)) {
      roundByCategoryId.set(round.eventCategoryId, round);
    }
  }
  return roundByCategoryId;
}

export function resolveLeagueCategoryLabels(
  participant: { gender: "M" | "F" | "U"; age: number | null; ageCategory?: string; leagueClassificationIds?: string[] },
  classifications: Array<{
    slug?: string;
    name: string;
    eligibility: LeagueClassificationEligibility;
  }>,
  lowerLevelLabel?: string | null,
) {
  const policy = resolveCompetitionCategoryPolicy({
    ...(classifications.length
      ? {
          league: classifications.map((classification, index) => ({
            key: classification.slug || `league-category-${index + 1}`,
            label: classification.name,
            eligibility: classification.eligibility,
          })),
        }
      : {}),
    ...(lowerLevelLabel?.trim()
      ? {
          race: [{
            key: "race-category",
            label: lowerLevelLabel.trim(),
            eligibility: {},
          }],
        }
      : {}),
  });

  if (!policy.rules.length) return ["Overall"];
  const labels = policy.rules
    .filter((rule) => matchesLeagueClassification(participant, rule.eligibility))
    .map((rule) => rule.label);
  return labels.length ? Array.from(new Set(labels)) : ["Unclassified"];
}

export type LeagueRosterEntry = {
  athleteId: string;
  athleteSlug: string;
  name: string;
  club: string;
  clubSlug: string | null;
  gender: "M" | "F" | "U";
  ageCategory: string;
  roundNumber: number;
  eventName: string;
  categoryName: string;
  bib: string;
  registrationStatus: string;
  participationStatus: string;
  resultStatus: string;
  dateIso: string | null;
};

export type LeagueRosterRow = {
  key: string;
  athleteId: string;
  athleteSlug: string;
  name: string;
  firstName: string;
  lastName: string;
  club: string;
  clubSlug: string | null;
  gender: "M" | "F" | "U";
  ageCategories: string[];
  ageCategory: string;
  rounds: number[];
  roundLabels: string[];
  registrationCount: number;
  startedRaceCount: number;
  categories: string[];
  bibs: string[];
  registrationStatus: "confirmed" | "pending" | "waitlisted" | "mixed";
  confirmedRounds: number;
  latestRaceStatus: string;
  latestRoundNumber: number;
};

export function splitAthleteDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Trail Runner", lastName: "—" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

const startedLeagueRaceStatuses = new Set([
  "started",
  "finished",
  "dnf",
  "dsq",
  "stopped",
  "evacuated",
  "missing",
]);

const didNotStartLeagueRaceStatuses = new Set([
  "dns",
  "not_started",
  "checked_in",
]);

const didNotFinishLeagueRaceStatuses = new Set([
  "dnf",
  "started",
  "withdrawn",
  "stopped",
  "evacuated",
  "missing",
]);

/**
 * Normalizes the public race lifecycle into the outcomes shown on a completed
 * league-results board. Callers must still exclude upcoming rounds so a future
 * not_started registration is never presented as DNS.
 */
export function leagueRoundOutcome(participationStatus: string): LeagueRoundOutcome | null {
  const normalized = participationStatus.trim().toLowerCase();
  if (normalized === "finished") return "finished";
  if (didNotStartLeagueRaceStatuses.has(normalized)) return "dns";
  if (didNotFinishLeagueRaceStatuses.has(normalized)) return "dnf";
  if (normalized === "dsq") return "dsq";
  return null;
}

export function hasStartedLeagueRace(participationStatus: string) {
  return startedLeagueRaceStatuses.has(participationStatus.trim().toLowerCase());
}

function registrationSummary(statuses: string[]): LeagueRosterRow["registrationStatus"] {
  const normalized = Array.from(new Set(statuses.map((status) => status.trim().toLowerCase()).filter(Boolean)));
  if (normalized.length === 1 && normalized[0] === "confirmed") return "confirmed";
  if (normalized.length === 1 && normalized[0] === "pending") return "pending";
  if (normalized.length === 1 && normalized[0] === "waitlisted") return "waitlisted";
  if (normalized.includes("pending")) return "pending";
  if (normalized.includes("waitlisted")) return "waitlisted";
  return normalized.length > 1 ? "mixed" : "confirmed";
}

function latestRosterEntry(entries: LeagueRosterEntry[]) {
  return [...entries].sort((left, right) => {
    const dateComparison = (right.dateIso ?? "").localeCompare(left.dateIso ?? "");
    return dateComparison || right.roundNumber - left.roundNumber;
  })[0];
}

export function buildUniqueLeagueRoster(entries: LeagueRosterEntry[]): LeagueRosterRow[] {
  const grouped = new Map<string, LeagueRosterEntry[]>();
  for (const entry of entries) {
    const key = leagueAthleteIdentity(entry);
    const current = grouped.get(key) ?? [];
    current.push(entry);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([key, athleteEntries]) => {
      const first = preferredAthleteEntry(athleteEntries);
      const latest = latestRosterEntry(athleteEntries);
      const latestClub = normalizePublicResultClubName(latest.club);
      const athleteName = splitAthleteDisplayName(first.name);
      const rounds = Array.from(new Set(athleteEntries.map((entry) => entry.roundNumber))).sort((a, b) => a - b);
      const startedRaceCount = new Set(
        athleteEntries
          .filter((entry) => hasStartedLeagueRace(entry.participationStatus))
          .map((entry) => entry.roundNumber),
      ).size;
      const confirmedRounds = new Set(
        athleteEntries
          .filter((entry) => entry.registrationStatus.trim().toLowerCase() === "confirmed")
          .map((entry) => entry.roundNumber),
      ).size;

      return {
        key,
        athleteId: first.athleteId,
        athleteSlug: first.athleteSlug,
        name: first.name,
        firstName: athleteName.firstName,
        lastName: athleteName.lastName,
        club: latestClub,
        clubSlug: latestClub ? latest.clubSlug : null,
        gender: first.gender,
        ageCategories: Array.from(new Set(
          athleteEntries
            .map((entry) => formatUniversalAgeCategoryLabel(entry.ageCategory))
            .filter(Boolean),
        )).sort(),
        ageCategory: formatUniversalAgeCategoryLabel(latest.ageCategory) || "Open",
        rounds,
        roundLabels: rounds.map((round) => `R${round}`),
        registrationCount: rounds.length,
        startedRaceCount,
        categories: Array.from(new Set(athleteEntries.map((entry) => entry.categoryName).filter(Boolean))).sort(),
        bibs: athleteEntries
          .filter((entry) => entry.bib && entry.bib !== "—")
          .sort((left, right) => left.roundNumber - right.roundNumber)
          .map((entry) => `R${entry.roundNumber} ${entry.bib}`),
        registrationStatus: registrationSummary(athleteEntries.map((entry) => entry.registrationStatus)),
        confirmedRounds,
        latestRaceStatus: latest.participationStatus || latest.resultStatus || "not_started",
        latestRoundNumber: latest.roundNumber,
      } satisfies LeagueRosterRow;
    })
    .sort((left, right) => (
      left.lastName.localeCompare(right.lastName, "hr-HR", { sensitivity: "base" })
      || left.firstName.localeCompare(right.firstName, "hr-HR", { sensitivity: "base" })
    ));
}

export type LeagueBestTimeEntry = LeagueScoringEntry & {
  roundId: string;
  stageLabel: string;
  date: string;
  dateIso: string | null;
  time: string;
  finishTimeMs: number | null;
};

export type DerivedLeagueBestTimePerformance = {
  roundId: string;
  roundNumber: number;
  stageLabel: string;
  date: string;
  dateIso: string | null;
  time: string;
  finishTimeMs: number;
};

export type DerivedLeagueBestTimeStanding = {
  athleteId: string;
  athleteSlug: string;
  name: string;
  club: string;
  clubSlug: string | null;
  gender: "M" | "F" | "U";
  ageCategory: string;
  bestTimeMs: number;
  bestPerformance: DerivedLeagueBestTimePerformance;
  performances: DerivedLeagueBestTimePerformance[];
};

export function deriveLeagueBestTimeStandings(
  entries: LeagueBestTimeEntry[],
): DerivedLeagueBestTimeStanding[] {
  const grouped = new Map<string, LeagueBestTimeEntry[]>();
  for (const entry of entries) {
    if (
      (entry.publicationState === undefined
        ? entry.roundStatus !== "completed"
        : !leagueResultIsOfficial(entry.publicationState))
      || entry.participationStatus.trim().toLowerCase() !== "finished"
      || entry.finishTimeMs == null
      || !Number.isFinite(entry.finishTimeMs)
      || entry.finishTimeMs <= 0
    ) continue;

    const identity = leagueAthleteIdentity(entry);
    const current = grouped.get(identity) ?? [];
    current.push(entry);
    grouped.set(identity, current);
  }

  return Array.from(grouped.values())
    .map((athleteEntries) => {
      const first = preferredAthleteEntry(athleteEntries);
      const performances = athleteEntries
        .map((entry) => ({
          roundId: entry.roundId,
          roundNumber: entry.roundNumber,
          stageLabel: entry.stageLabel,
          date: entry.date,
          dateIso: entry.dateIso,
          time: entry.time,
          finishTimeMs: entry.finishTimeMs as number,
        } satisfies DerivedLeagueBestTimePerformance))
        .sort((left, right) => (
          left.finishTimeMs - right.finishTimeMs
          || (left.dateIso ?? "").localeCompare(right.dateIso ?? "")
          || left.roundNumber - right.roundNumber
        ));

      return {
        athleteId: first.athleteId,
        athleteSlug: first.athleteSlug,
        name: first.name,
        club: first.club,
        clubSlug: first.clubSlug,
        gender: first.gender,
        ageCategory: first.ageCategory,
        bestTimeMs: performances[0].finishTimeMs,
        bestPerformance: performances[0],
        performances,
      } satisfies DerivedLeagueBestTimeStanding;
    })
    .sort((left, right) => (
      left.bestTimeMs - right.bestTimeMs
      || left.name.localeCompare(right.name, "hr-HR", { sensitivity: "base" })
    ));
}

export function deriveLeagueParticipationStandings(
  entries: LeagueScoringEntry[],
): DerivedLeagueStanding[] {
  const grouped = new Map<string, LeagueScoringEntry[]>();
  for (const entry of entries) {
    if (
      entry.roundStatus !== "completed"
      || entry.participationStatus.trim().toLowerCase() !== "finished"
    ) continue;
    const identity = leagueAthleteIdentity(entry);
    const current = grouped.get(identity) ?? [];
    current.push(entry);
    grouped.set(identity, current);
  }

  return Array.from(grouped.values())
    .map((athleteEntries) => {
      const first = preferredAthleteEntry(athleteEntries);
      const roundScores: number[] = [];
      const roundStatuses: LeagueRoundOutcome[] = [];
      for (const entry of athleteEntries) {
        const roundIndex = Math.max(0, entry.roundNumber - 1);
        roundScores[roundIndex] = 0;
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
        points: 0,
        races: athleteEntries.length,
        roundScores,
        roundStatuses,
        bestFinish: Math.min(...athleteEntries.map((entry) => entry.overall || Number.MAX_SAFE_INTEGER)),
        latestRound: Math.max(...athleteEntries.map((entry) => entry.roundNumber)),
        eligible: true,
        wins: 0,
        lastRoundPoints: 0,
      } satisfies DerivedLeagueStanding;
    })
    .sort((left, right) => (
      right.races - left.races
      || right.latestRound - left.latestRound
      || left.name.localeCompare(right.name, "hr-HR", { sensitivity: "base" })
    ));
}

export type LeagueClubMemberDisplayRow = {
  name: string;
  athleteSlug: string | null;
  avatarUrl?: string | null;
  points: number;
  countedPoints: number;
  wins: number;
  podiums: number;
  roundScores: number[];
  roundPlaces: number[];
  countedRounds: boolean[];
  roundStatuses?: LeagueRoundOutcome[];
};

function leagueClubMemberNameKey(member: Pick<LeagueClubMemberDisplayRow, "name">) {
  return member.name.trim().toLocaleLowerCase("hr-HR");
}

function leagueClubMemberSlugKey(member: Pick<LeagueClubMemberDisplayRow, "athleteSlug">) {
  return member.athleteSlug?.trim() || null;
}

export function mergeLeagueClubFinishersWithParticipants(
  finishingMembers: LeagueClubMemberDisplayRow[],
  participatingMembers: LeagueClubMemberDisplayRow[],
): LeagueClubMemberDisplayRow[] {
  const participantBySlug = new Map(
    participatingMembers.flatMap((member) => {
      const slug = leagueClubMemberSlugKey(member);
      return slug ? [[slug, member] as const] : [];
    }),
  );
  const participantByName = new Map(
    participatingMembers.map((member) => [leagueClubMemberNameKey(member), member] as const),
  );
  const mergedParticipants = new Set<LeagueClubMemberDisplayRow>();

  const mergedFinishers = finishingMembers.map((finisher) => {
    const finisherSlug = leagueClubMemberSlugKey(finisher);
    const participant = (finisherSlug
      ? participantBySlug.get(finisherSlug)
      : undefined)
      ?? participantByName.get(leagueClubMemberNameKey(finisher));
    if (!participant) return finisher;

    mergedParticipants.add(participant);
    if (participant === finisher) return finisher;

    const roundCount = Math.max(
      finisher.roundScores.length,
      finisher.roundPlaces.length,
      finisher.countedRounds.length,
      finisher.roundStatuses?.length ?? 0,
      participant.roundScores.length,
      participant.roundPlaces.length,
      participant.countedRounds.length,
      participant.roundStatuses?.length ?? 0,
    );
    const roundStatuses: LeagueRoundOutcome[] = [];
    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const outcome = finisher.roundStatuses?.[roundIndex]
        ?? participant.roundStatuses?.[roundIndex];
      if (outcome) roundStatuses[roundIndex] = outcome;
    }

    return {
      ...finisher,
      avatarUrl: finisher.avatarUrl ?? participant.avatarUrl ?? null,
      roundScores: Array.from(
        { length: roundCount },
        (_, roundIndex) => finisher.roundScores[roundIndex]
          ?? participant.roundScores[roundIndex]
          ?? 0,
      ),
      roundPlaces: Array.from(
        { length: roundCount },
        (_, roundIndex) => finisher.roundPlaces[roundIndex]
          ?? participant.roundPlaces[roundIndex]
          ?? 0,
      ),
      countedRounds: Array.from(
        { length: roundCount },
        (_, roundIndex) => finisher.countedRounds[roundIndex]
          ?? participant.countedRounds[roundIndex]
          ?? false,
      ),
      roundStatuses,
    };
  });

  return [
    ...mergedFinishers,
    ...participatingMembers.filter((member) => !mergedParticipants.has(member)),
  ];
}

/**
 * Keeps published club contributions authoritative while filling the display
 * roster with every athlete who participated in at least one league race.
 */
export function mergeOfficialClubContributorsWithParticipants(
  officialMembers: LeagueClubMemberDisplayRow[],
  finishingMembers: LeagueClubMemberDisplayRow[],
): LeagueClubMemberDisplayRow[] {
  const officialBySlug = new Map(
    officialMembers.flatMap((member) => member.athleteSlug
      ? [[member.athleteSlug, member] as const]
      : []),
  );
  const officialByName = new Map(
    officialMembers.map((member) => [leagueClubMemberNameKey(member), member] as const),
  );
  const matchedOfficialMembers = new Set<LeagueClubMemberDisplayRow>();

  const merged = finishingMembers.map((member) => {
    const official = (member.athleteSlug ? officialBySlug.get(member.athleteSlug) : undefined)
      ?? officialByName.get(leagueClubMemberNameKey(member));
    if (!official) {
      return {
        ...member,
        countedPoints: 0,
        countedRounds: Array.from({ length: member.roundScores.length }, () => false),
      };
    }

    matchedOfficialMembers.add(official);
    const countedRoundCount = Math.max(
      member.roundScores.length,
      member.countedRounds.length,
      member.roundStatuses?.length ?? 0,
      official.roundScores.length,
      official.roundPlaces.length,
      official.countedRounds.length,
      official.roundStatuses?.length ?? 0,
    );
    const countedRounds = Array.from(
      { length: countedRoundCount },
      (_, roundIndex) => official.countedRounds[roundIndex] ?? false,
    );
    const roundStatuses = [...(member.roundStatuses ?? [])];
    for (let roundIndex = 0; roundIndex < countedRoundCount; roundIndex += 1) {
      if (countedRounds[roundIndex]) {
        roundStatuses[roundIndex] = official.roundStatuses?.[roundIndex] ?? "finished";
      }
    }
    return {
      ...member,
      avatarUrl: member.avatarUrl ?? official.avatarUrl ?? null,
      countedPoints: official.countedPoints,
      roundScores: Array.from(
        { length: countedRoundCount },
        (_, roundIndex) => countedRounds[roundIndex]
          ? official.roundScores[roundIndex] ?? 0
          : member.roundScores[roundIndex] ?? 0,
      ),
      roundPlaces: Array.from(
        { length: countedRoundCount },
        (_, roundIndex) => countedRounds[roundIndex]
          ? official.roundPlaces[roundIndex] ?? 0
          : member.roundPlaces[roundIndex] ?? 0,
      ),
      countedRounds,
      roundStatuses,
    };
  });

  for (const official of officialMembers) {
    if (!matchedOfficialMembers.has(official)) merged.push(official);
  }

  return merged.sort((left, right) => (
    right.countedPoints - left.countedPoints
    || right.points - left.points
    || left.name.localeCompare(right.name, "hr-HR")
  ));
}
