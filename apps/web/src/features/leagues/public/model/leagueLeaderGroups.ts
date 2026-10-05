import {
  resolveDefaultLeagueClassification,
  resolveDefaultLeagueCompetition,
} from "@raceson/domain/leagues";
import type {
  PublicLeagueClassificationDefinition,
  PublicLeagueCompetitionReadModel,
  PublicLeagueDetailReadModel,
  PublicLeagueStandingItem,
} from "@/lib/league-read-models";
import {
  formatUniversalAgeCategoryLabel,
  getClassificationLabels,
} from "@/shared/domain/competitiveClassification";

export type LeagueLeaderGroup = {
  id: string;
  label: string;
  shortLabel: string;
  leaders: PublicLeagueStandingItem[];
};

export type LeagueRankingBoard = {
  competition: PublicLeagueCompetitionReadModel;
  classification: PublicLeagueClassificationDefinition;
  standings: PublicLeagueStandingItem[];
};

function intrinsicOverall(
  competition: PublicLeagueCompetitionReadModel,
): PublicLeagueClassificationDefinition {
  return {
    id: `${competition.id}:overall`,
    slug: "overall",
    name: "Overall",
    eligibility: {},
    awardDepth: null,
    displayOrder: -1,
    isDefault: !competition.classifications.some((classification) => classification.isDefault),
  };
}

function isConfiguredOverall(classification: PublicLeagueClassificationDefinition) {
  const normalizedSlug = classification.slug.trim().toLowerCase();
  const normalizedName = classification.name.trim().toLowerCase();
  const eligibility = classification.eligibility;
  const hasEligibility = eligibility.gender === "F"
    || eligibility.gender === "M"
    || eligibility.minimumAge != null
    || eligibility.maximumAge != null;
  return !hasEligibility && (normalizedSlug === "overall" || normalizedName === "overall");
}

export function getLeagueCompetitionRankingBoards(
  competition: PublicLeagueCompetitionReadModel,
): LeagueRankingBoard[] {
  const configuredOverall = competition.classifications.find(isConfiguredOverall);
  const overall = configuredOverall ?? intrinsicOverall(competition);
  const configuredBoards = competition.classifications
    .filter((classification) => !isConfiguredOverall(classification))
    .map((classification) => ({
      competition,
      classification,
      standings: competition.classificationStandings[classification.slug] ?? [],
    }));

  return [{
    competition,
    classification: overall,
    standings: competition.individualStandings,
  }, ...configuredBoards];
}

export function getDefaultLeagueCompetition(
  league: Pick<PublicLeagueDetailReadModel, "competitions">,
) {
  const individualCompetitions = league.competitions.filter(
    (competition) => competition.scoringTarget === "individual",
  );
  return resolveDefaultLeagueCompetition(individualCompetitions)
    ?? resolveDefaultLeagueCompetition(league.competitions);
}

export function getDefaultLeagueRankingBoard(
  league: Pick<PublicLeagueDetailReadModel, "competitions">,
): LeagueRankingBoard | null {
  const competition = getDefaultLeagueCompetition(league);
  if (!competition) return null;
  const boards = getLeagueCompetitionRankingBoards(competition);
  const defaultClassification = resolveDefaultLeagueClassification(
    boards.map((board) => board.classification),
  );
  return boards.find((board) => board.classification.id === defaultClassification?.id)
    ?? boards[0]
    ?? null;
}

/** Build preview groups from the canonical configured boards, without
 * reclassifying athletes or inventing UI-only categories. */
export function buildConfiguredLeagueLeaderGroups(
  league: Pick<PublicLeagueDetailReadModel, "competitions">,
  limit = 3,
): LeagueLeaderGroup[] {
  const competition = getDefaultLeagueCompetition(league);
  if (!competition) return [];
  return getLeagueCompetitionRankingBoards(competition).map((board) => {
    return {
      id: board.classification.id,
      ...getClassificationLabels(board.classification.name),
      leaders: board.standings
        .filter((standing) => standing.eligible !== false)
        .slice(0, limit),
    };
  });
}

function isU16(standing: PublicLeagueStandingItem) {
  return formatUniversalAgeCategoryLabel(standing.ageCategory) === "U16"
    || (standing.age != null && standing.age <= 15);
}

export function buildLeagueLeaderGroups(
  standings: PublicLeagueStandingItem[],
  limit = 3,
): LeagueLeaderGroup[] {
  const eligible = standings.filter((standing) => standing.eligible !== false);
  const take = (gender: "M" | "F", youth: boolean) => eligible
    .filter((standing) => standing.gender === gender && isU16(standing) === youth)
    .slice(0, limit);

  return [
    { id: "male", label: "Male", shortLabel: "M", leaders: take("M", false) },
    { id: "female", label: "Female", shortLabel: "F", leaders: take("F", false) },
    { id: "u16-male", label: "Male U16", shortLabel: "MU16", leaders: take("M", true) },
    { id: "u16-female", label: "Female U16", shortLabel: "FU16", leaders: take("F", true) },
  ];
}
