import type {
  PublicLeagueClubStandingItem,
  PublicLeagueCompetitionReadModel,
  PublicLeagueDetailReadModel,
  PublicLeagueEntryItem,
  PublicLeagueStandingItem,
} from "@/lib/league-read-models";
import { PLATFORM_AGE_CATEGORIES } from "@/shared/domain/ageCategories";
import {
  BELOW_DISTANCE_STAT_MINIMUM_LABEL,
  DISTANCE_STAT_BANDS,
  UNKNOWN_DISTANCE_STAT_LABEL,
  getDistanceStatBand,
  type DistanceStatBandId,
} from "@/shared/statistics/distanceBands";
import { leagueResultIsOfficial, leagueRoundOutcome } from "./leaguePublicModel";

export type LeagueRankHistoryPoint = {
  round: number;
  rank: number;
  /** Scoring value so far: points, best elapsed milliseconds, or participations. */
  points: number;
  projected?: boolean;
};

export type LeagueRankHistory = {
  athleteSlug: string;
  name: string;
  avatarUrl: string | null;
  finalRank: number;
  points: LeagueRankHistoryPoint[];
};

export type LeagueRoundInsight = {
  roundId: string;
  roundNumber: number;
  label: string;
  status: PublicLeagueDetailReadModel["rounds"][number]["status"];
  registrations: number;
  starters: number;
  finishers: number;
  startedNotFinished: number;
  didNotStart: number;
  scored: number;
  hasPublishedResults: boolean;
};

export type LeagueLeaderTakeover = {
  roundNumber: number;
  previousLeaderName: string;
  previousLeaderSlug: string;
  currentLeaderName: string;
  currentLeaderSlug: string;
};

export type LeagueClubPresence = {
  name: string;
  slug: string | null;
  athletes: number;
  entries: number;
  rounds: Array<{ roundNumber: number; entries: number }>;
};

export type LeagueAthleteParticipation = {
  athleteSlug: string;
  name: string;
  club: string;
  rounds: number;
  entries: number;
  finishes: number;
  didNotFinish: number;
  didNotStart: number;
};

export type LeagueDistanceCategoryInsight = {
  id: DistanceStatBandId | "below-minimum" | "unknown";
  label: string;
  entries: number;
  athletes: number;
  starters: number;
  finishers: number;
};

export type LeagueDistanceAgeCell = {
  distanceId: LeagueDistanceCategoryInsight["id"];
  distanceLabel: string;
  ageCategory: string;
  entries: number;
  athletes: number;
};

export type LeagueRaceAgeCell = {
  raceCategoryId: string;
  raceCategoryLabel: string;
  ageCategory: string;
  entries: number;
  athletes: number;
  points: number;
};

export type LeagueAgeLeader = {
  categoryId: string;
  ageCategory: string;
  athleteSlug: string;
  name: string;
  rank: number;
  points: number;
};

type BuildLeagueInsightsOptions = {
  competition?: PublicLeagueCompetitionReadModel;
  useEntryCounts?: boolean;
  standingsMode?: "points" | "best_time" | "participation" | "none";
  topHistoryBasis?: "latest" | "published";
};

const STARTED_STATUSES = new Set([
  "started",
  "finished",
  "dnf",
  "dsq",
  "stopped",
  "evacuated",
  "missing",
]);

const PRECISE_AGE_BANDS = new Set([
  "Under 18",
  "18–34",
  "35–44",
  "45–54",
  "55–64",
  "65+",
]);

export function buildLeagueCompetitionScope(
  league: PublicLeagueDetailReadModel,
  competition: PublicLeagueCompetitionReadModel,
) {
  const mappedRoundNumbers = new Set(
    competition.roundMappings.map((mapping) => mapping.roundNumber),
  );
  const mappedCategoryIds = new Set(
    competition.roundMappings.map((mapping) => mapping.eventCategoryId),
  );
  const entries = mappedCategoryIds.size
    ? league.entries.filter((entry) => mappedCategoryIds.has(entry.eventCategoryId))
    : league.entries;

  if (!mappedCategoryIds.size) {
    return {
      entries,
      rounds: league.rounds,
      usesMappedCategories: false,
    };
  }

  const publishedRoundNumbers = new Set(
    entries
      .filter((entry) => leagueResultIsOfficial(entry.publicationState))
      .map((entry) => entry.roundNumber),
  );

  return {
    entries,
    rounds: league.rounds
      .filter((round) => mappedRoundNumbers.has(round.roundNumber))
      .map((round) => ({
        ...round,
        // The league-level round flag means every competitive category in the
        // event has a publication. Inside one competition, its mapped category
        // is the relevant boundary; another empty distance must not hide this
        // competition's official history.
        hasPublishedResults: round.hasPublishedResults
          || publishedRoundNumbers.has(round.roundNumber),
        hasPartialPublishedResults: false,
      })),
    usesMappedCategories: true,
  };
}

function countedPoints(scores: number[], bestN: number) {
  const positiveScores = scores.filter((score) => Number.isFinite(score) && score > 0).sort((left, right) => right - left);
  const counted = bestN > 0 ? positiveScores.slice(0, bestN) : positiveScores;
  return counted.reduce((sum, score) => sum + score, 0);
}

export type LeagueDemographicItem = {
  label: string;
  count: number;
  percent: number;
};

export type LeagueCourseAgeDistribution = {
  id: string;
  label: string;
  order: number;
  athletes: number;
  groups: LeagueDemographicItem[];
};

function ageBand(age: number | null, publishedCategory: string) {
  if (age !== null && Number.isFinite(age) && age >= 0) {
    if (age < 18) return "Under 18";
    if (age < 35) return "18–34";
    if (age < 45) return "35–44";
    if (age < 55) return "45–54";
    if (age < 65) return "55–64";
    return "65+";
  }

  const normalized = publishedCategory
    .trim()
    .toUpperCase()
    .replaceAll(" ", "")
    .replace(/[–—−]/g, "-");
  const platformCategory = PLATFORM_AGE_CATEGORIES.find(
    (category) => category.label.toUpperCase() === normalized,
  );
  if (platformCategory) {
    if ((platformCategory.maxAge ?? Number.POSITIVE_INFINITY) < 18) return "Under 18";
    if (platformCategory.minAge >= 18 && (platformCategory.maxAge ?? Number.POSITIVE_INFINITY) < 35) return "18–34";
    if (platformCategory.minAge >= 35 && (platformCategory.maxAge ?? Number.POSITIVE_INFINITY) < 45) return "35–44";
    if (platformCategory.minAge >= 45 && (platformCategory.maxAge ?? Number.POSITIVE_INFINITY) < 55) return "45–54";
    if (platformCategory.minAge >= 55 && (platformCategory.maxAge ?? Number.POSITIVE_INFINITY) < 65) return "55–64";
    if (platformCategory.minAge >= 65) return "65+";
  }
  const underAge = normalized.match(/^U(\d+)$/)?.[1];
  if (underAge && Number(underAge) <= 18) return "Under 18";
  const range = normalized.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/);
  if (range) {
    const from = Number(range[1]?.replace(",", "."));
    const to = Number(range[2]?.replace(",", "."));
    if (from >= 0 && to < 18) return "Under 18";
    if (from >= 18 && to <= 34.99) return "18–34";
    if (from >= 35 && to <= 44.99) return "35–44";
    if (from >= 45 && to <= 54.99) return "45–54";
    if (from >= 55 && to <= 64.99) return "55–64";
    if (from >= 65) return "65+";
    if (from < to) return "Broad age range";
  }
  if (/^65\+/.test(normalized)) return "65+";
  return "Not specified";
}

function ageCategoryPriority(publishedCategory: string) {
  const band = ageBand(null, publishedCategory);
  if (band === "Not specified") return 0;
  if (band === "Broad age range") return 1;
  return 2;
}

function demographicDistribution(values: string[], order: string[] = []) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([label, count]): LeagueDemographicItem => ({
      label,
      count,
      percent: values.length ? Math.round((count / values.length) * 100) : 0,
    }))
    .sort((left, right) => {
      if (!order.length) return right.count - left.count || left.label.localeCompare(right.label);
      const leftOrder = order.indexOf(left.label);
      const rightOrder = order.indexOf(right.label);
      return (leftOrder < 0 ? order.length : leftOrder) - (rightOrder < 0 ? order.length : rightOrder)
        || right.count - left.count
        || left.label.localeCompare(right.label);
    });
}

function distanceCategoryForEntry(entry: PublicLeagueEntryItem) {
  const band = getDistanceStatBand(entry.distanceKm);
  if (band) return { id: band.id, label: `${band.name} · ${band.rangeLabel}` } as const;
  if (typeof entry.distanceKm === "number" && Number.isFinite(entry.distanceKm) && entry.distanceKm >= 0 && entry.distanceKm < 5) {
    return { id: "below-minimum", label: BELOW_DISTANCE_STAT_MINIMUM_LABEL } as const;
  }
  return { id: "unknown", label: UNKNOWN_DISTANCE_STAT_LABEL } as const;
}

function entryAgeCategories(entry: PublicLeagueEntryItem) {
  const classificationLabels = (entry.leagueCategoryLabels ?? [])
    .map((label) => label.trim())
    .filter((label) => label && !["overall", "open", "male", "female"].includes(label.toLowerCase()))
    .filter((label) => /\d|under|junior|senior|master|veteran/i.test(label));
  if (classificationLabels.length) return Array.from(new Set(classificationLabels));
  return [ageBand(entry.age, entry.ageCategory)];
}

export function buildLeagueDistanceBreakdown(entries: PublicLeagueEntryItem[]) {
  const categories = new Map<LeagueDistanceCategoryInsight["id"], {
    id: LeagueDistanceCategoryInsight["id"];
    label: string;
    entries: number;
    athleteKeys: Set<string>;
    starters: number;
    finishers: number;
  }>(DISTANCE_STAT_BANDS.map((band) => [band.id, {
    id: band.id,
    label: `${band.name} · ${band.rangeLabel}`,
    entries: 0,
    athleteKeys: new Set<string>(),
    starters: 0,
    finishers: 0,
  }]));
  const ageCells = new Map<string, {
    distanceId: LeagueDistanceAgeCell["distanceId"];
    distanceLabel: string;
    ageCategory: string;
    entries: number;
    athleteKeys: Set<string>;
  }>();

  for (const entry of entries) {
    const distanceCategory = distanceCategoryForEntry(entry);
    const current = categories.get(distanceCategory.id) ?? {
      id: distanceCategory.id,
      label: distanceCategory.label,
      entries: 0,
      athleteKeys: new Set<string>(),
      starters: 0,
      finishers: 0,
    };
    const athleteKey = entry.athleteId || entry.athleteSlug;
    const participationStatus = entry.participationStatus.trim().toLowerCase();
    current.entries += 1;
    current.athleteKeys.add(athleteKey);
    if (STARTED_STATUSES.has(participationStatus)) current.starters += 1;
    if (participationStatus === "finished") current.finishers += 1;
    categories.set(distanceCategory.id, current);

    for (const ageCategory of entryAgeCategories(entry)) {
      const key = `${distanceCategory.id}:${ageCategory}`;
      const ageCell = ageCells.get(key) ?? {
        distanceId: distanceCategory.id,
        distanceLabel: distanceCategory.label,
        ageCategory,
        entries: 0,
        athleteKeys: new Set<string>(),
      };
      ageCell.entries += 1;
      ageCell.athleteKeys.add(athleteKey);
      ageCells.set(key, ageCell);
    }
  }

  return {
    categories: Array.from(categories.values())
      .filter((category) => category.id !== "below-minimum" && category.id !== "unknown" || category.entries > 0)
      .map((category): LeagueDistanceCategoryInsight => ({
        id: category.id,
        label: category.label,
        entries: category.entries,
        athletes: category.athleteKeys.size,
        starters: category.starters,
        finishers: category.finishers,
      })),
    ageMatrix: Array.from(ageCells.values()).map((cell): LeagueDistanceAgeCell => ({
      distanceId: cell.distanceId,
      distanceLabel: cell.distanceLabel,
      ageCategory: cell.ageCategory,
      entries: cell.entries,
      athletes: cell.athleteKeys.size,
    })),
  };
}

export function buildLeagueDemographics(entries: PublicLeagueEntryItem[]) {
  const athletes = new Map<string, { gender: "M" | "F" | "U"; age: number | null; ageCategory: string; countryCode: string }>();
  for (const entry of entries) {
    const key = entry.athleteId || entry.athleteSlug;
    const current = athletes.get(key);
    const currentAgeCategory = current?.ageCategory ?? "";
    const ageCategory = ageCategoryPriority(entry.ageCategory) > ageCategoryPriority(currentAgeCategory)
      ? entry.ageCategory
      : currentAgeCategory || entry.ageCategory;
    athletes.set(key, {
      gender: current?.gender && current.gender !== "U" ? current.gender : entry.gender,
      age: current?.age ?? entry.age,
      ageCategory,
      countryCode: current?.countryCode || entry.countryCode?.trim().toUpperCase() || "",
    });
  }
  const values = Array.from(athletes.values());
  return {
    athletes: values.length,
    gender: demographicDistribution(
      values.map((athlete) => athlete.gender === "F" ? "Female" : athlete.gender === "M" ? "Male" : "Not specified"),
      ["Female", "Male", "Not specified"],
    ),
    ages: demographicDistribution(
      values.map((athlete) => ageBand(athlete.age, athlete.ageCategory)),
      ["Under 18", "18–34", "35–44", "45–54", "55–64", "65+", "Broad age range", "Not specified"],
    ),
    countries: demographicDistribution(
      values.map((athlete) => athlete.countryCode || "Not specified"),
    ),
  };
}

export function buildLeagueCourseAgeDistributions(
  league: PublicLeagueDetailReadModel,
): LeagueCourseAgeDistribution[] {
  const courseByCategoryId = new Map<string, { id: string; label: string; order: number }>();
  [...(league.competitions ?? [])]
    .filter((competition) => competition.scoringTarget === "individual")
    .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name))
    .forEach((competition) => competition.roundMappings.forEach((mapping) => {
      if (!courseByCategoryId.has(mapping.eventCategoryId)) {
        courseByCategoryId.set(mapping.eventCategoryId, {
          id: competition.id || competition.slug || competition.name,
          label: competition.name,
          order: competition.displayOrder,
        });
      }
    }));

  const entriesByCourse = new Map<string, { id: string; label: string; order: number; entries: PublicLeagueEntryItem[] }>();
  for (const entry of league.entries ?? []) {
    const fallbackLabel = entry.categoryName.trim() || entry.categorySlug.trim() || "Other";
    const course = courseByCategoryId.get(entry.eventCategoryId) ?? {
      id: entry.eventCategoryId || entry.categorySlug || fallbackLabel,
      label: fallbackLabel,
      order: Number.MAX_SAFE_INTEGER,
    };
    const current = entriesByCourse.get(course.id) ?? { ...course, entries: [] };
    current.entries.push(entry);
    entriesByCourse.set(course.id, current);
  }

  return Array.from(entriesByCourse.values())
    .map((course) => {
      const demographics = buildLeagueDemographics(course.entries);
      return {
        id: course.id,
        label: course.label,
        order: course.order,
        athletes: demographics.athletes,
        groups: demographics.ages,
      };
    })
    .filter((course) => course.athletes > 0)
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
}

export function buildLeagueRankHistory(
  standings: PublicLeagueStandingItem[],
  totalRounds: number,
  bestN: number,
  publishedRoundNumbers: number[] = Array.from({ length: totalRounds }, (_, index) => index + 1),
  options: {
    includeProjections?: boolean;
    standingsMode?: "points" | "best_time" | "participation" | "none";
    checkpointRoundNumbers?: number[];
  } = {},
) {
  const standingsMode = options.standingsMode
    ?? standings.find((standing) => standing.standingsMode)?.standingsMode
    ?? "points";

  if (standingsMode === "none") return [];
  if (standingsMode === "best_time") {
    return buildBestTimeRankHistory(
      standings,
      totalRounds,
      publishedRoundNumbers,
      options.checkpointRoundNumbers,
    );
  }
  if (standingsMode === "participation") {
    return buildParticipationRankHistory(
      standings,
      totalRounds,
      publishedRoundNumbers,
      options.checkpointRoundNumbers,
    );
  }

  return buildScoreRankHistory(
    standings.map((standing) => ({
      id: standing.athleteSlug,
      name: standing.name,
      avatarUrl: standing.avatarUrl ?? null,
      finalRank: standing.rank,
      roundScores: standing.roundScores,
    })),
    totalRounds,
    bestN,
    publishedRoundNumbers,
    options.checkpointRoundNumbers,
    options.includeProjections ?? false,
  );
}

function normalizedRoundNumbers(totalRounds: number, roundNumbers: number[]) {
  return Array.from(new Set(roundNumbers))
    .filter((roundNumber) => Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= totalRounds)
    .sort((left, right) => left - right);
}

function rankCheckpointRounds(
  totalRounds: number,
  publishedRoundNumbers: number[],
  checkpointRoundNumbers?: number[],
) {
  return normalizedRoundNumbers(totalRounds, [
    ...publishedRoundNumbers,
    ...(checkpointRoundNumbers ?? []),
  ]);
}

function buildBestTimeRankHistory(
  standings: PublicLeagueStandingItem[],
  totalRounds: number,
  publishedRoundNumbers: number[],
  checkpointRoundNumbers?: number[],
) {
  const historyByAthlete = new Map<string, LeagueRankHistoryPoint[]>();
  const publishedRounds = normalizedRoundNumbers(totalRounds, publishedRoundNumbers);
  const publishedRoundSet = new Set(publishedRounds);
  const checkpointRounds = rankCheckpointRounds(totalRounds, publishedRounds, checkpointRoundNumbers);

  for (const roundNumber of checkpointRounds) {
    const board = standings
      .flatMap((standing) => {
        const bestTimeMs = Math.min(
          ...(standing.performances ?? [])
            .filter((performance) => (
              performance.roundNumber <= roundNumber
              && publishedRoundSet.has(performance.roundNumber)
            ))
            .map((performance) => performance.finishTimeMs),
        );
        return Number.isFinite(bestTimeMs) && bestTimeMs > 0
          ? [{ standing, scoringValue: bestTimeMs }]
          : [];
      })
      .sort((left, right) => (
        left.scoringValue - right.scoringValue
        || left.standing.rank - right.standing.rank
        || left.standing.name.localeCompare(right.standing.name)
      ));

    let previousValue: number | null = null;
    let previousRank = 0;
    board.forEach((entry, index) => {
      const rank = previousValue === entry.scoringValue ? previousRank : index + 1;
      const current = historyByAthlete.get(entry.standing.athleteSlug) ?? [];
      current.push({ round: roundNumber, rank, points: entry.scoringValue });
      historyByAthlete.set(entry.standing.athleteSlug, current);
      previousValue = entry.scoringValue;
      previousRank = rank;
    });
  }

  return standings.map((standing): LeagueRankHistory => ({
    athleteSlug: standing.athleteSlug,
    name: standing.name,
    avatarUrl: standing.avatarUrl ?? null,
    finalRank: standing.rank,
    points: historyByAthlete.get(standing.athleteSlug) ?? [],
  }));
}

function buildParticipationRankHistory(
  standings: PublicLeagueStandingItem[],
  totalRounds: number,
  publishedRoundNumbers: number[],
  checkpointRoundNumbers?: number[],
) {
  const historyByAthlete = new Map<string, LeagueRankHistoryPoint[]>();
  const publishedRounds = normalizedRoundNumbers(totalRounds, publishedRoundNumbers);
  const checkpointRounds = rankCheckpointRounds(totalRounds, publishedRounds, checkpointRoundNumbers);

  for (const roundNumber of checkpointRounds) {
    const board = standings
      .map((standing) => ({
        standing,
        scoringValue: publishedRounds
          .filter((publishedRound) => publishedRound <= roundNumber)
          .filter((publishedRound) => standing.roundStatuses?.[publishedRound - 1] === "finished")
          .length,
      }))
      .filter((entry) => entry.scoringValue > 0)
      .sort((left, right) => (
        right.scoringValue - left.scoringValue
        || left.standing.rank - right.standing.rank
        || left.standing.name.localeCompare(right.standing.name)
      ));

    board.forEach((entry, index) => {
      const current = historyByAthlete.get(entry.standing.athleteSlug) ?? [];
      current.push({ round: roundNumber, rank: index + 1, points: entry.scoringValue });
      historyByAthlete.set(entry.standing.athleteSlug, current);
    });
  }

  return standings.map((standing): LeagueRankHistory => ({
    athleteSlug: standing.athleteSlug,
    name: standing.name,
    avatarUrl: standing.avatarUrl ?? null,
    finalRank: standing.rank,
    points: historyByAthlete.get(standing.athleteSlug) ?? [],
  }));
}

function buildScoreRankHistory(
  standings: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    finalRank: number;
    roundScores: number[];
  }>,
  totalRounds: number,
  bestN: number,
  publishedRoundNumbers: number[],
  checkpointRoundNumbers: number[] | undefined,
  includeProjections: boolean,
) {
  const historyByAthlete = new Map<string, LeagueRankHistoryPoint[]>();
  const publishedRounds = normalizedRoundNumbers(totalRounds, publishedRoundNumbers);
  const checkpointRounds = rankCheckpointRounds(totalRounds, publishedRounds, checkpointRoundNumbers);

  for (const roundNumber of checkpointRounds) {
    const board = standings
      .map((standing) => ({
        standing,
        points: countedPoints(
          publishedRounds
            .filter((publishedRound) => publishedRound <= roundNumber)
            .map((publishedRound) => standing.roundScores[publishedRound - 1] ?? 0),
          bestN,
        ),
      }))
      .filter((entry) => entry.points > 0)
      .sort((left, right) => (
        right.points - left.points
        || left.standing.finalRank - right.standing.finalRank
        || left.standing.name.localeCompare(right.standing.name)
      ));

    board.forEach((entry, index) => {
      const current = historyByAthlete.get(entry.standing.id) ?? [];
      current.push({ round: roundNumber, rank: index + 1, points: entry.points });
      historyByAthlete.set(entry.standing.id, current);
    });
  }

  const latestCheckpointRound = checkpointRounds.at(-1) ?? 0;
  const projectedRounds = includeProjections
    ? Array.from({ length: Math.max(0, totalRounds - latestCheckpointRound) }, (_, index) => latestCheckpointRound + index + 1)
    : [];

  for (const roundNumber of projectedRounds) {
    const projectionsCompleted = roundNumber - latestCheckpointRound;
    const board = standings
      .map((standing) => {
        const publishedScores = publishedRounds.map((publishedRound) => standing.roundScores[publishedRound - 1] ?? 0);
        const positiveScores = publishedScores.filter((score) => Number.isFinite(score) && score > 0);
        const averageScore = positiveScores.length
          ? positiveScores.reduce((sum, score) => sum + score, 0) / positiveScores.length
          : 0;
        return {
          standing,
          points: countedPoints([
            ...publishedScores,
            ...Array.from({ length: projectionsCompleted }, () => averageScore),
          ], bestN),
        };
      })
      .filter((entry) => entry.points > 0)
      .sort((left, right) => (
        right.points - left.points
        || left.standing.finalRank - right.standing.finalRank
        || left.standing.name.localeCompare(right.standing.name)
      ));

    board.forEach((entry, index) => {
      const current = historyByAthlete.get(entry.standing.id) ?? [];
      current.push({
        round: roundNumber,
        rank: index + 1,
        points: Math.round(entry.points),
        projected: true,
      });
      historyByAthlete.set(entry.standing.id, current);
    });
  }

  return standings.map((standing): LeagueRankHistory => ({
    athleteSlug: standing.id,
    name: standing.name,
    avatarUrl: standing.avatarUrl,
    finalRank: standing.finalRank,
    points: historyByAthlete.get(standing.id) ?? [],
  }));
}

export function buildLeagueClubRankHistory(
  standings: PublicLeagueClubStandingItem[],
  totalRounds: number,
  publishedRoundNumbers: number[] = Array.from({ length: totalRounds }, (_, index) => index + 1),
  options: { includeProjections?: boolean; checkpointRoundNumbers?: number[] } = {},
) {
  return buildScoreRankHistory(
    standings.map((standing) => ({
      id: standing.clubSlug,
      name: standing.name,
      avatarUrl: null,
      finalRank: standing.rank,
      roundScores: standing.roundPoints,
    })),
    totalRounds,
    0,
    publishedRoundNumbers,
    options.checkpointRoundNumbers,
    options.includeProjections ?? false,
  );
}

export function buildLeagueRaceAgeMatrix(league: PublicLeagueDetailReadModel) {
  const categoryByEventCategoryId = new Map<string, { id: string; label: string; order: number }>();
  (league.competitions ?? [])
    .filter((competition) => competition.scoringTarget === "individual")
    .forEach((competition) => {
      competition.roundMappings.forEach((mapping) => {
        categoryByEventCategoryId.set(mapping.eventCategoryId, {
          id: competition.id,
          label: competition.name,
          order: competition.displayOrder,
        });
      });
    });

  const cells = new Map<string, LeagueRaceAgeCell & { athleteKeys: Set<string>; order: number }>();
  (league.entries ?? []).forEach((entry) => {
    const configured = categoryByEventCategoryId.get(entry.eventCategoryId);
    const raceCategoryLabel = configured?.label ?? (entry.categoryName.trim() || "Other");
    const raceCategoryId = configured?.id ?? (entry.categorySlug.trim() || raceCategoryLabel.toLowerCase());
    const ageCategory = ageBand(entry.age, entry.ageCategory);
    const key = `${raceCategoryId}:${ageCategory}`;
    const current = cells.get(key) ?? {
      raceCategoryId,
      raceCategoryLabel,
      ageCategory,
      entries: 0,
      athletes: 0,
      points: 0,
      athleteKeys: new Set<string>(),
      order: configured?.order ?? Number.MAX_SAFE_INTEGER,
    };
    current.entries += 1;
    current.points += Number.isFinite(entry.leaguePoints) ? Math.max(0, entry.leaguePoints) : 0;
    current.athleteKeys.add(entry.athleteId || entry.athleteSlug);
    current.athletes = current.athleteKeys.size;
    cells.set(key, current);
  });

  const ageOrder = ["Under 18", "18–34", "35–44", "45–54", "55–64", "65+", "Broad age range", "Not specified"];
  return Array.from(cells.values())
    .sort((left, right) => (
      left.order - right.order
      || left.raceCategoryLabel.localeCompare(right.raceCategoryLabel)
      || ageOrder.indexOf(left.ageCategory) - ageOrder.indexOf(right.ageCategory)
    ))
    .map(({ athleteKeys: _athleteKeys, order: _order, ...cell }) => cell);
}

export function buildLeagueAgeLeaders(competition?: PublicLeagueCompetitionReadModel): LeagueAgeLeader[] {
  if (!competition || competition.standingsMode !== "points") return [];

  return [...competition.classifications]
    .filter(({ eligibility }) => (
      eligibility.gender != null || eligibility.minimumAge != null || eligibility.maximumAge != null
    ))
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .flatMap((classification) => {
      // Classification standings own their points and tie-breaks. Overall scores
      // and platform age bands cannot reconstruct a course's category leaders.
      const leader = (competition.classificationStandings[classification.slug] ?? [])
        .filter((standing) => standing.points > 0 && standing.rank > 0)
        .reduce<PublicLeagueStandingItem | undefined>((best, standing) => (
          !best || standing.rank < best.rank ? standing : best
        ), undefined);
      return leader ? [{
        categoryId: classification.id,
        ageCategory: classification.name,
        athleteSlug: leader.athleteSlug,
        name: leader.name,
        rank: leader.rank,
        points: leader.points,
      }] : [];
    });
}

function latestTopRankHistory(history: LeagueRankHistory[], basis: "latest" | "published" = "latest") {
  return history
    .map((series) => ({
      series,
      latest: basis === "published"
        ? [...series.points].reverse().find((point) => !point.projected)
        : series.points.at(-1),
    }))
    .filter((row): row is { series: LeagueRankHistory; latest: LeagueRankHistoryPoint } => Boolean(row.latest))
    .sort((left, right) => left.latest.rank - right.latest.rank || right.latest.points - left.latest.points)
    .slice(0, 10)
    .map((row) => row.series);
}

export function buildLeagueInsights(
  league: PublicLeagueDetailReadModel,
  options: BuildLeagueInsightsOptions = {},
) {
  const standingsMode = options.standingsMode
    ?? league.individualStandings.find((standing) => standing.standingsMode)?.standingsMode
    ?? "points";
  const publishedRoundNumbers = league.rounds
    .filter((round) => round.hasPublishedResults)
    .map((round) => round.roundNumber)
    .sort((left, right) => left - right);
  const rankCheckpointRoundNumbers = league.rounds
    .filter((round) => round.hasPublishedResults || round.status === "completed")
    .map((round) => round.roundNumber)
    .sort((left, right) => left - right);
  const publishedRounds = publishedRoundNumbers.length;
  const history = buildLeagueRankHistory(
    league.individualStandings,
    league.rounds.length,
    league.rules.bestN,
    publishedRoundNumbers,
    {
      checkpointRoundNumbers: rankCheckpointRoundNumbers,
      includeProjections: standingsMode === "points",
      standingsMode,
    },
  );
  const focusedHistory = latestTopRankHistory(history, options.topHistoryBasis);
  const clubHistory = latestTopRankHistory(buildLeagueClubRankHistory(
    league.clubStandings ?? [],
    league.rounds.length,
    publishedRoundNumbers,
    { checkpointRoundNumbers: rankCheckpointRoundNumbers, includeProjections: true },
  ), options.topHistoryBasis);
  const roundLeaders = rankCheckpointRoundNumbers.flatMap((roundNumber) => {
    const leader = history.find((series) => (
      series.points.some((point) => point.round === roundNumber && point.rank === 1)
    ));
    return leader ? [{ roundNumber, athleteSlug: leader.athleteSlug, name: leader.name }] : [];
  });
  const leadChanges = roundLeaders.reduce((count, leader, index) => (
    index > 0 && roundLeaders[index - 1]?.athleteSlug !== leader.athleteSlug ? count + 1 : count
  ), 0);

  const currentLeader = roundLeaders.at(-1) ?? null;
  let takeover: LeagueLeaderTakeover | null = null;
  if (currentLeader) {
    for (let index = 1; index < roundLeaders.length; index += 1) {
      const previous = roundLeaders[index - 1]!;
      const next = roundLeaders[index]!;
      if (next.athleteSlug === currentLeader.athleteSlug && previous.athleteSlug !== next.athleteSlug) {
        takeover = {
          roundNumber: next.roundNumber,
          previousLeaderName: previous.name,
          previousLeaderSlug: previous.athleteSlug,
          currentLeaderName: next.name,
          currentLeaderSlug: next.athleteSlug,
        };
      }
    }
  }

  let biggestMover: {
    name: string;
    athleteSlug: string;
    places: number;
    fromRank: number;
    toRank: number;
    fromRound: number;
    toRound: number;
  } | null = null;
  for (const series of history) {
    for (let index = 1; index < series.points.length; index += 1) {
      const previous = series.points[index - 1]!;
      const next = series.points[index]!;
      if (next.projected) continue;
      const places = previous.rank - next.rank;
      if (places > 0 && (!biggestMover || places > biggestMover.places)) {
        biggestMover = {
          name: series.name,
          athleteSlug: series.athleteSlug,
          places,
          fromRank: previous.rank,
          toRank: next.rank,
          fromRound: previous.round,
          toRound: next.round,
        };
      }
    }
  }

  const completedOutcomeRoundIds = new Set(
    league.rounds
      .filter((round) => round.status === "completed" || round.hasPublishedResults)
      .map((round) => round.roundId),
  );
  const roundsByAthlete = new Map<string, {
    athleteSlug: string;
    name: string;
    club: string;
    roundIds: Set<string>;
    registrationIds: Set<string>;
    finishedRegistrationIds: Set<string>;
    didNotFinishRegistrationIds: Set<string>;
    didNotStartRegistrationIds: Set<string>;
  }>();
  for (const entry of league.entries) {
    if (entry.roundStatus !== "completed" && !completedOutcomeRoundIds.has(entry.roundId)) continue;
    const athleteKey = entry.athleteId || entry.athleteSlug;
    const current = roundsByAthlete.get(athleteKey) ?? {
      athleteSlug: entry.athleteSlug,
      name: entry.name,
      club: entry.club,
      roundIds: new Set<string>(),
      registrationIds: new Set<string>(),
      finishedRegistrationIds: new Set<string>(),
      didNotFinishRegistrationIds: new Set<string>(),
      didNotStartRegistrationIds: new Set<string>(),
    };
    const registrationKey = `${entry.roundNumber}:${entry.registrationId}`;
    const outcome = leagueRoundOutcome(entry.participationStatus);
    current.roundIds.add(entry.roundId);
    current.registrationIds.add(registrationKey);
    if (outcome === "finished") current.finishedRegistrationIds.add(registrationKey);
    else if (outcome === "dnf" || outcome === "dsq") current.didNotFinishRegistrationIds.add(registrationKey);
    else current.didNotStartRegistrationIds.add(registrationKey);
    if (!current.club && entry.club) current.club = entry.club;
    roundsByAthlete.set(athleteKey, current);
  }

  const athleteParticipation: LeagueAthleteParticipation[] = Array.from(roundsByAthlete.values())
    .map((athlete) => ({
      athleteSlug: athlete.athleteSlug,
      name: athlete.name,
      club: athlete.club,
      rounds: athlete.roundIds.size,
      entries: athlete.registrationIds.size,
      finishes: athlete.finishedRegistrationIds.size,
      didNotFinish: athlete.didNotFinishRegistrationIds.size,
      didNotStart: athlete.didNotStartRegistrationIds.size,
    }))
    .sort((left, right) => right.entries - left.entries || right.finishes - left.finishes || left.name.localeCompare(right.name));

  const demographics = buildLeagueDemographics(league.entries);
  const distanceBreakdown = buildLeagueDistanceBreakdown(league.entries);
  const returningAthletes = athleteParticipation.filter((athlete) => athlete.rounds >= 2).length;
  const ageKnown = demographics.ages
    .filter((group) => PRECISE_AGE_BANDS.has(group.label))
    .reduce((sum, group) => sum + group.count, 0);
  const ageUnknown = Math.max(0, demographics.athletes - ageKnown);

  const clubsByKey = new Map<string, {
    name: string;
    slug: string | null;
    athleteKeys: Set<string>;
    entries: number;
    entriesByRound: Map<number, number>;
  }>();
  for (const entry of league.entries) {
    const name = entry.club.trim();
    const normalizedName = name.toLowerCase();
    if (!name || ["ind", "independent", "neovisni", "nezavisni"].includes(normalizedName)) continue;
    const key = entry.clubSlug ?? name.toLowerCase();
    const current = clubsByKey.get(key) ?? {
      name,
      slug: entry.clubSlug,
      athleteKeys: new Set<string>(),
      entries: 0,
      entriesByRound: new Map<number, number>(),
    };
    current.athleteKeys.add(entry.athleteId || entry.athleteSlug);
    current.entries += 1;
    current.entriesByRound.set(entry.roundNumber, (current.entriesByRound.get(entry.roundNumber) ?? 0) + 1);
    clubsByKey.set(key, current);
  }
  const clubs: LeagueClubPresence[] = Array.from(clubsByKey.values())
    .map((club) => ({
      name: club.name,
      slug: club.slug,
      athletes: club.athleteKeys.size,
      entries: club.entries,
      rounds: Array.from(club.entriesByRound.entries())
        .map(([roundNumber, entries]) => ({ roundNumber, entries }))
        .sort((left, right) => left.roundNumber - right.roundNumber),
    }))
    .sort((left, right) => right.entries - left.entries || right.athletes - left.athletes || left.name.localeCompare(right.name));

  const rankedStandings = [...league.individualStandings]
    .filter((standing) => standing.points > 0)
    .sort((left, right) => left.rank - right.rank);
  const leaderMargin = rankedStandings.length > 1
    ? Math.max(0, rankedStandings[0]!.points - rankedStandings[1]!.points)
    : null;
  const bestN = league.rules.bestN > 0 ? league.rules.bestN : Math.max(1, publishedRounds);
  const rounds: LeagueRoundInsight[] = league.rounds.map((round) => {
    const entries = league.entries.filter((entry) => entry.roundId === round.roundId);
    const registrations = options.useEntryCounts ? entries.length : entries.length || round.participants;
    const startersFromEntries = entries.filter((entry) => STARTED_STATUSES.has(entry.participationStatus.trim().toLowerCase())).length;
    const finishersFromEntries = entries.filter((entry) => entry.participationStatus.trim().toLowerCase() === "finished").length;
    const starters = entries.length || options.useEntryCounts ? startersFromEntries : Math.max(round.finishers, 0);
    const finishers = entries.length || options.useEntryCounts ? finishersFromEntries : round.finishers;
    return {
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      label: round.stageLabel,
      status: round.status,
      registrations,
      starters,
      finishers,
      startedNotFinished: Math.max(0, starters - finishers),
      didNotStart: Math.max(0, registrations - starters),
      scored: round.hasPublishedResults ? entries.filter((entry) => entry.leaguePoints > 0).length : 0,
      hasPublishedResults: round.hasPublishedResults,
    };
  });

  return {
    history: focusedHistory,
    clubHistory,
    publishedRounds,
    leadChanges,
    takeover,
    currentLeader,
    leaderMargin,
    biggestMover,
    athleteParticipation,
    returningAthletes,
    returningRate: demographics.athletes ? Math.round(returningAthletes / demographics.athletes * 100) : 0,
    demographics,
    courseAgeDistributions: buildLeagueCourseAgeDistributions(league),
    distanceCategories: distanceBreakdown.categories,
    distanceAgeMatrix: distanceBreakdown.ageMatrix,
    raceAgeMatrix: buildLeagueRaceAgeMatrix(league),
    ageLeaders: buildLeagueAgeLeaders(options.competition),
    ageKnown,
    ageUnknown,
    ageCoverage: demographics.athletes ? Math.round(ageKnown / demographics.athletes * 100) : 0,
    clubs,
    bestN,
    rounds,
    totalRegistrations: rounds.reduce((sum, round) => sum + round.registrations, 0),
    latestPublishedAt: league.entries.flatMap((entry) => entry.publishedAt ? [entry.publishedAt] : []).sort().at(-1) ?? null,
  };
}
