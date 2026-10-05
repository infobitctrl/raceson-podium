import { format } from "date-fns";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";
import {
  normalizeLeagueClubScoringScope,
  resolveDefaultLeagueCompetition,
  type LeagueClubScoringScope,
} from "@raceson/domain/leagues";
import {
  DEFAULT_SPORT_CODE,
  normalizeSportSelection,
  type SportCode,
} from "@raceson/domain/sports";
import {
  deriveLeagueRoundStatus,
  deriveLeagueRoundPublicationStatus,
  deriveLeagueSeasonStatus,
  deriveLeagueBestTimeStandings,
  deriveLeagueClassificationStandings,
  deriveCombinedLeagueClubStandings,
  deriveLeagueCompetitionClubStandings,
  deriveLeagueParticipationStandings,
  deriveLeagueStandings,
  groupLeagueCategoryIdsByEdition,
  leagueRoundOutcome,
  leagueResultIsOfficial,
  leagueAthleteIdentity,
  matchesLeagueClassification,
  mergeLeagueClubFinishersWithParticipants,
  pointsForLeaguePlace,
  resolveLeagueCategoryLabels,
  scoreLeagueEntriesForClassifications,
  type LeagueRoundOutcome,
  type LeagueRoundStatus,
} from "@/features/leagues/public/model/leaguePublicModel";
import { selectPrimaryClubByAthlete } from "@/features/athletes/model/primaryClub";
import {
  getPublicAthleteMetadata,
  type PublicAthleteMetadata,
} from "@/features/athletes/data/publicAthleteMetadata";
import { aggregatePublicRankingPerformance } from "@/features/athletes/model/rankingPerformance";
import { buildLeagueRoundSlots } from "@/features/leagues/model/leagueRoundPlanning";
import { buildLeagueSeasonDateRange } from "@/features/leagues/model/leagueSeasonDateRange";
import { resolveLeagueImageUrl } from "@/features/leagues/model/leagueMedia";
import { getSibenikTrailLeagueDisplayName } from "@/features/leagues/model/sibenikTrailLeagueIdentity";
import { chunkRankingSourceIds, collectPaginatedRows } from "@/features/athletes/model/rankingSources";
import { platformAgeCategory } from "@/shared/domain/ageCategories";
import { getDistanceStatLabel } from "@/shared/statistics/distanceBands";
import { countryName } from "@/shared/domain/countries";
import { normalizePublicResultClubName } from "@/features/results/public/model/publicResultPresentation";
import { getPublicRegistrationCountsByCategoryId } from "@/lib/public-registration-counts";
import { getCurrentPublishedResultRows } from "@/lib/current-published-results";
import {
  getPublicLeagueClubStandingDetails,
  type PublicLeagueClubStandingDetails,
} from "@/lib/public-league-club-standings";
import { getSupabasePublicClient } from "@/lib/supabase";
import {
  mapPublicOrganizationProfile,
  type PublicOrganizationProfile,
} from "@/lib/portal-data";
import {
  getSibenikTrailLeagueLookupSlugs,
  getSibenikTrailLeagueRoundImage,
  isSibenikTrailLeague,
  SIBENIK_TRAIL_LEAGUE_DEFAULT_ROUNDS,
  SIBENIK_TRAIL_LEAGUE_DESCRIPTION,
  SIBENIK_TRAIL_LEAGUE_MEDIA,
  SIBENIK_TRAIL_LEAGUE_NAME,
  SIBENIK_TRAIL_LEAGUE_ORGANIZER_RULES,
  SIBENIK_TRAIL_LEAGUE_SLUG,
} from "@/features/leagues/public/data/sibenikTrailLeague";

export type PublicLeagueCatalogItem = {
  id: string;
  name: string;
  organizer: string;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  desc: string;
  imageUrl?: string | null;
  rounds: number;
  completed: number;
  athletes: number;
  registrations?: number;
  finishers?: number;
  clubs: number;
  leader: string;
  season: string;
  iconKey: "trophy" | "compass" | "mountain" | "zap" | "flag";
  status: "active" | "upcoming" | "completed";
  displayDate: string;
  displayDateKind: "next_round" | "last_round" | "tba";
  featuredRoundName: string;
  featuredRoundLocation: string;
  featuredRoundDistance: string;
  featuredRoundElevation: string;
};

export function sanitizePublicLeagueDescription(description: string | null | undefined) {
  return (description ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^Organizer Notes\s*:/i.test(line.trim()))
    .join("\n")
    .trim();
}

export type PublicLeagueRoundPodiumItem = {
  athleteSlug: string;
  name: string;
  club: string;
  clubSlug: string | null;
  time: string;
  points: number;
};

export type PublicLeagueRoundItem = {
  roundId: string;
  roundNumber: number;
  eventEditionId: string;
  eventCategoryId: string;
  eventSlug: string;
  eventImageUrl?: string | null;
  name: string;
  categoryName: string;
  stageLabel: string;
  date: string;
  dateIso: string | null;
  location: string;
  distance: string;
  elevation: string;
  status: LeagueRoundStatus;
  participants: number;
  finishers: number;
  hasPublishedResults: boolean;
  hasPartialPublishedResults?: boolean;
  publicationState: string | null;
  publishedAt: string | null;
  top3: PublicLeagueRoundPodiumItem[];
  isPlaceholder?: boolean;
};

export type PublicLeagueStandingItem = {
  leagueClassificationIds?: string[];
  athleteId?: string;
  rank: number;
  name: string;
  athleteSlug: string;
  avatarUrl?: string | null;
  club: string;
  clubSlug: string | null;
  points: number;
  change: number;
  races: number;
  roundScores: number[];
  roundStatuses?: LeagueRoundOutcome[];
  gender: "M" | "F" | "U";
  ageCategory: string;
  leagueCategoryLabels?: string[];
  age: number | null;
  eligible?: boolean;
  standingsMode?: "points" | "best_time" | "participation" | "none";
  bestTimeMs?: number | null;
  bestTime?: string | null;
  bestRoundNumber?: number | null;
  bestRoundLabel?: string | null;
  bestDate?: string | null;
  bestDateIso?: string | null;
  performances?: PublicLeagueBestTimePerformanceItem[];
};

export type PublicLeagueBestTimePerformanceItem = {
  roundId: string;
  roundNumber: number;
  stageLabel: string;
  date: string;
  dateIso: string | null;
  time: string;
  finishTimeMs: number;
};

export type PublicLeagueClubScorerItem = {
  name: string;
  athleteSlug: string | null;
};

export type PublicLeagueClubMemberItem = {
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

export type PublicLeagueClubStandingItem = {
  rank: number;
  name: string;
  clubSlug: string;
  points: number;
  members: number;
  wins: number;
  podiums: number;
  roundPoints: number[];
  memberRows: PublicLeagueClubMemberItem[];
  change: number;
  scorers: PublicLeagueClubScorerItem[];
  avgPoints: number;
};

export type PublicLeagueRulesReadModel = {
  pointsTable: number[];
  fieldSizeProfile: string;
  participationPoints: number;
  bestN: number;
  minimumRounds: number;
  tieBreakMethod: string;
  clubScoringMode: string;
};

export type PublicLeagueClassificationDefinition = {
  id: string;
  slug: string;
  name: string;
  eligibility: {
    classificationId?: string;
    gender?: "M" | "F";
    minimumAge?: number;
    maximumAge?: number;
  };
  awardDepth: number | null;
  displayOrder: number;
  isDefault: boolean;
};

export type PublicLeagueCompetitionRoundMapping = {
  roundId: string;
  roundNumber: number;
  eventEditionId: string;
  eventCategoryId: string;
  status: string;
  pointsMultiplier: number;
  eventSlug: string;
  eventName: string;
  categoryName: string;
};

export type PublicLeagueCompetitionReadModel = {
  id: string;
  slug: string;
  name: string;
  description: string;
  scoringTarget: "individual" | "club";
  resultBasis: string;
  standingsMode: "points" | "best_time" | "participation" | "none";
  displayOrder: number;
  isDefault: boolean;
  classifications: PublicLeagueClassificationDefinition[];
  roundMappings: PublicLeagueCompetitionRoundMapping[];
  individualStandings: PublicLeagueStandingItem[];
  classificationStandings: Record<string, PublicLeagueStandingItem[]>;
  clubStandings: PublicLeagueClubStandingItem[];
  rules: PublicLeagueRulesReadModel;
};

export type PublicLeagueSeasonSummary = {
  totalRegistrations: number;
  totalFinishers: number;
  completedRounds: number;
  publishedRounds: number;
  clubsRepresented: number;
  nextStageLabel: string | null;
};

export type PublicLeagueEntryItem = {
  leagueClassificationIds?: string[];
  registrationId: string;
  athleteId: string;
  roundId: string;
  roundNumber: number;
  eventEditionId: string;
  eventCategoryId: string;
  eventSlug: string;
  eventName: string;
  categorySlug: string;
  categoryName: string;
  distanceKm?: number | null;
  stageLabel: string;
  roundStatus: "completed" | "upcoming";
  date: string;
  dateIso: string | null;
  location: string;
  bib: string;
  athleteSlug: string;
  name: string;
  club: string;
  clubSlug: string | null;
  countryCode?: string | null;
  gender: "M" | "F" | "U";
  ageCategory: string;
  leagueCategoryLabels?: string[];
  age: number | null;
  registrationStatus: string;
  participationStatus: string;
  resultStatus: string;
  publicationState: string | null;
  publishedAt: string | null;
  time: string;
  finishTimeMs?: number | null;
  overall: number;
  genderRank: number;
  ageRank: number;
  leaguePoints: number;
  leagueRank: number | null;
};

export type PublicLeagueDetailReadModel = {
  slug: string;
  name: string;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  description: string;
  organizerRules?: string | null;
  imageUrl?: string | null;
  organizer: PublicOrganizationProfile;
  status: "active" | "upcoming" | "completed";
  seasonLabel: string;
  athleteCount: number;
  clubCount: number;
  summary: PublicLeagueSeasonSummary;
  rounds: PublicLeagueRoundItem[];
  entries: PublicLeagueEntryItem[];
  competitions: PublicLeagueCompetitionReadModel[];
  clubScoringScope: LeagueClubScoringScope;
  individualStandings: PublicLeagueStandingItem[];
  clubStandings: PublicLeagueClubStandingItem[];
  rules: PublicLeagueRulesReadModel;
};

export type PublicRankingItem = {
  rank: number;
  name: string;
  athleteSlug: string;
  avatarUrl: string | null;
  avatarInitials: string;
  club: string;
  region: string;
  races: number;
  gender: "M" | "F" | "U";
  age: string;
  totalDistanceKm: number;
  totalTimeMs: number;
  distanceBand: string;
};

function countryLabel(countryCode: string | null | undefined) {
  return countryName(countryCode, "Region");
}

function normalizeGender(value: string | null | undefined): "M" | "F" | "U" {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.startsWith("m")) return "M";
  if (normalized.startsWith("f") || normalized.startsWith("w")) return "F";
  return "U";
}

function ageAtDate(dateOfBirth: string | null | undefined, referenceDate: string | null | undefined) {
  if (!dateOfBirth || !referenceDate) return null;
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  const asOf = new Date(`${referenceDate}T00:00:00`);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(asOf.getTime())) return null;

  let age = asOf.getFullYear() - birthDate.getFullYear();
  const monthDelta = asOf.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < birthDate.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function rankingInitials(value: string | null | undefined) {
  const words = (value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words.length) return "TP";
  return words.map((word) => word.charAt(0).toUpperCase()).join("");
}

function formatElapsedTimeFromMs(milliseconds: number | null | undefined) {
  if (milliseconds == null || milliseconds <= 0) return "-";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDistance(distanceKm: number | null | undefined) {
  if (distanceKm == null) return "TBA";
  return distanceKm % 1 === 0 ? `${distanceKm.toFixed(0)} km` : `${distanceKm.toFixed(1)} km`;
}

function formatElevation(elevationGain: number | null | undefined) {
  if (elevationGain == null) return "TBA";
  return `${elevationGain.toLocaleString()}m D+`;
}

function formatCategoryRange(
  categories: Array<{ distance_km: number | null; elevation_gain_m: number | null }>,
) {
  const distances = categories
    .map((category) => category.distance_km)
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);
  const elevations = categories
    .map((category) => category.elevation_gain_m)
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);

  return {
    distance:
      distances.length > 1
        ? `${formatDistance(distances[0]).replace(" km", "")}–${formatDistance(distances.at(-1)).replace(" km", "")} km`
        : formatDistance(distances[0]),
    elevation:
      elevations.length > 1
        ? `${elevations[0].toLocaleString()}–${elevations.at(-1)?.toLocaleString()}m D+`
        : formatElevation(elevations[0]),
  };
}

function inferLeagueIcon(slug: string) {
  if (slug.includes("adriatic")) return "compass" as const;
  if (slug.includes("sky") || slug.includes("balkan")) return "mountain" as const;
  if (slug.includes("winter")) return "zap" as const;
  if (slug.includes("night")) return "flag" as const;
  return "trophy" as const;
}

function parseIsoDateValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCatalogRoundDate(value: string | null | undefined) {
  const parsed = parseIsoDateValue(value);
  return parsed ? format(parsed, "MMM d, yyyy") : "TBA";
}

function formatCatalogRoundLocation(locationName: string | null | undefined) {
  return locationName?.trim() || "TBA";
}

type LeagueEditionLifecycleSource = {
  status: string | null;
  start_date: string | null;
  end_date?: string | null;
  timezone?: string | null;
};

function derivePublicLeagueRoundStatus(
  edition: LeagueEditionLifecycleSource | null | undefined,
  storedRoundStatus: string | null | undefined,
) {
  return deriveLeagueRoundStatus(edition?.status, storedRoundStatus, {
    startDate: edition?.start_date,
    endDate: edition?.end_date,
    timeZone: edition?.timezone,
  });
}

function resolveLeagueCatalogSchedule(
  rounds: Array<{
    status: string | null;
    event_edition_id: string;
    event_category_id: string | null;
    round_number: number | null;
  }>,
  editionById: Map<string, {
    name: string;
    start_date: string | null;
    end_date: string | null;
    timezone: string | null;
    location_name: string | null;
    status: string | null;
  }>,
  categoryById: Map<string, { distance_km: number | null; elevation_gain_m: number | null }>,
  plannedRoundCount?: number,
): Pick<
  PublicLeagueCatalogItem,
  | "displayDate"
  | "displayDateKind"
  | "featuredRoundName"
  | "featuredRoundLocation"
  | "featuredRoundDistance"
  | "featuredRoundElevation"
> {
  const enrichedRounds = rounds
    .map((round) => {
      const edition = editionById.get(round.event_edition_id);
      const category = round.event_category_id ? categoryById.get(round.event_category_id) : undefined;
      return {
        status: derivePublicLeagueRoundStatus(edition, round.status),
        roundNumber: round.round_number ?? Number.MAX_SAFE_INTEGER,
        name: edition?.name ?? `Round ${round.round_number ?? "?"}`,
        date: edition?.start_date ?? null,
        dateValue: parseIsoDateValue(edition?.start_date),
        location: formatCatalogRoundLocation(edition?.location_name),
        distance: formatDistance(category?.distance_km ?? null),
        elevation: formatElevation(category?.elevation_gain_m ?? null),
      };
    })
    .sort((left, right) => {
      if (left.dateValue && right.dateValue) {
        return left.dateValue.getTime() - right.dateValue.getTime();
      }
      if (left.dateValue) return -1;
      if (right.dateValue) return 1;
      return left.roundNumber - right.roundNumber;
    });

  const nextRound = enrichedRounds.find((round) => round.status !== "completed");
  if (nextRound) {
    return {
      displayDate: formatCatalogRoundDate(nextRound.date),
      displayDateKind: "next_round",
      featuredRoundName: nextRound.name,
      featuredRoundLocation: nextRound.location,
      featuredRoundDistance: nextRound.distance,
      featuredRoundElevation: nextRound.elevation,
    };
  }

  if ((plannedRoundCount ?? 0) > rounds.length) {
    return {
      displayDate: "TBA",
      displayDateKind: "next_round",
      featuredRoundName: `Round ${rounds.length + 1} · Race TBA`,
      featuredRoundLocation: "Location TBA",
      featuredRoundDistance: "Distance TBA",
      featuredRoundElevation: "Elevation TBA",
    };
  }

  const lastKnownRound = [...enrichedRounds]
    .filter((round) => round.dateValue)
    .sort((left, right) => (right.dateValue?.getTime() ?? 0) - (left.dateValue?.getTime() ?? 0))[0];

  if (lastKnownRound) {
    return {
      displayDate: formatCatalogRoundDate(lastKnownRound.date),
      displayDateKind: "last_round",
      featuredRoundName: lastKnownRound.name,
      featuredRoundLocation: lastKnownRound.location,
      featuredRoundDistance: lastKnownRound.distance,
      featuredRoundElevation: lastKnownRound.elevation,
    };
  }

  const firstRound = enrichedRounds[0];
  if (firstRound) {
    return {
      displayDate: "TBA",
      displayDateKind: "tba",
      featuredRoundName: firstRound.name,
      featuredRoundLocation: firstRound.location,
      featuredRoundDistance: firstRound.distance,
      featuredRoundElevation: firstRound.elevation,
    };
  }

  return {
    displayDate: "TBA",
    displayDateKind: "tba",
    featuredRoundName: "Schedule pending",
    featuredRoundLocation: "Croatia",
    featuredRoundDistance: "TBA",
    featuredRoundElevation: "TBA",
  };
}

function ageCategoryLabel(
  dateOfBirth: string | null | undefined,
  referenceDate: string | null | undefined,
) {
  return platformAgeCategory(dateOfBirth, referenceDate) ?? "Open";
}

function distanceBandLabel(maxDistanceKm: number) {
  return getDistanceStatLabel(maxDistanceKm);
}

function labelFromSlug(slug: string) {
  const label = slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return label || "Trail League";
}

type PublicEventParticipantRpcRow = {
  registration_id: string;
  athlete_profile_id: string;
  event_category_id: string;
  event_category_slug: string;
  event_category_name: string;
  bib_number: string | null;
  athlete_slug: string | null;
  athlete_name: string | null;
  club_slug: string | null;
  club_name: string | null;
  gender: string | null;
  age_category_label: string | null;
  registration_status: string | null;
  participation_status: string | null;
  result_status: string | null;
  publication_state: string | null;
  published_at: string | null;
  finish_time_ms: number | null;
  rank_overall: number | null;
  rank_gender: number | null;
  rank_age_category: number | null;
};

type PublicLeagueCompetitionDefinitionRpc = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  scoringTarget?: string | null;
  resultBasis?: string | null;
  standingsMode?: string | null;
  displayOrder?: number | null;
  isDefault?: boolean | null;
  rules?: {
    pointsTable?: Array<number | { points?: number }> | null;
    fieldSizeProfile?: string | null;
    participationPoints?: number | null;
    bestN?: number | null;
    minimumRounds?: number | null;
    tieBreakMethod?: string | null;
    clubScoringMode?: string | null;
  } | null;
  classifications?: Array<{
    id: string;
    slug: string;
    name: string;
    eligibility?: Record<string, unknown> | null;
    awardDepth?: number | null;
    displayOrder?: number | null;
    isDefault?: boolean | null;
  }> | null;
  roundMappings?: Array<{
    roundId: string;
    roundNumber: number;
    eventEditionId: string;
    eventCategoryId: string;
    status?: string | null;
    pointsMultiplier?: number | null;
  }> | null;
};

type PublicLeagueCompetitionDefinitionsRpc = {
  leagueSeasonId?: string;
  competitions?: PublicLeagueCompetitionDefinitionRpc[];
};

const emptyPublicLeaguesCatalog: PublicLeagueCatalogItem[] = [];
const emptyPublicRankings: PublicRankingItem[] = [];
const sibenikTrailLeaguePointsTable = [
  50, 47, 45, 43, 42, 41, 39, 38, 38, 37,
  36, 35, 34, 33, 32, 31, 31, 30, 29, 28,
  27, 27, 26, 25, 25, 24, 23, 23, 22, 21,
  20, 20, 19, 18, 18, 17, 17, 16, 16, 15,
  14, 14, 13, 13, 12, 12, 11, 11, 10, 10,
  10, 10, 10, 10, 9, 9, 9, 9, 9, 9,
  8, 8, 8, 8, 8, 8, 8, 8, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
];

const sibenikTrailLeagueRules: PublicLeagueRulesReadModel = {
  pointsTable: sibenikTrailLeaguePointsTable,
  fieldSizeProfile: "custom",
  participationPoints: 5,
  bestN: 5,
  minimumRounds: 1,
  tieBreakMethod: "best_finish",
  clubScoringMode: "best_three",
};

// Podium source distributions contain no baked-in real athlete identities.
const fallbackSibenikStandings: PublicLeagueStandingItem[] = [];

function buildFallbackSibenikRounds(): PublicLeagueRoundItem[] {
  const completedRounds = SIBENIK_TRAIL_LEAGUE_DEFAULT_ROUNDS.map((round) => ({
    roundId: `default:${SIBENIK_TRAIL_LEAGUE_SLUG}:${round.roundNumber}`,
    roundNumber: round.roundNumber,
    eventEditionId: "",
    eventCategoryId: "",
    eventSlug: round.eventSlug,
    eventImageUrl: getSibenikTrailLeagueRoundImage(round.eventSlug),
    name: round.name,
    categoryName: "2 routes",
    stageLabel: `${round.name} · 2 routes`,
    date: format(new Date(`${round.dateIso}T00:00:00`), "MMM d, yyyy"),
    dateIso: round.dateIso,
    location: round.location,
    distance: round.distance,
    elevation: round.elevation,
    status: "completed" as const,
    participants: 0,
    finishers: 0,
    hasPublishedResults: true,
    hasPartialPublishedResults: false,
    publicationState: "published",
    publishedAt: null,
    top3: [],
    isPlaceholder: false,
  }));
  const plannedRounds = [5, 6, 7].map((roundNumber) => ({
    roundId: `planned:default:${SIBENIK_TRAIL_LEAGUE_SLUG}:${roundNumber}`,
    roundNumber,
    eventEditionId: "",
    eventCategoryId: "",
    eventSlug: "",
    eventImageUrl: null,
    name: "Race to be announced",
    categoryName: "Race categories TBA",
    stageLabel: `Round ${roundNumber} · Race TBA`,
    date: "Date TBA",
    dateIso: null,
    location: "Location TBA",
    distance: "Distance TBA",
    elevation: "Elevation TBA",
    status: "upcoming" as const,
    participants: 0,
    finishers: 0,
    hasPublishedResults: false,
    hasPartialPublishedResults: false,
    publicationState: null,
    publishedAt: null,
    top3: [],
    isPlaceholder: true,
  }));

  return [...completedRounds, ...plannedRounds];
}

function buildFallbackSibenikLeagueDetail(): PublicLeagueDetailReadModel {
  const rounds = buildFallbackSibenikRounds();
  return {
    slug: SIBENIK_TRAIL_LEAGUE_SLUG,
    name: SIBENIK_TRAIL_LEAGUE_NAME,
    description: SIBENIK_TRAIL_LEAGUE_DESCRIPTION,
    organizerRules: SIBENIK_TRAIL_LEAGUE_ORGANIZER_RULES,
    imageUrl: SIBENIK_TRAIL_LEAGUE_MEDIA.hero,
    organizer: mapPublicOrganizationProfile(null),
    status: "active",
    seasonLabel: buildLeagueSeasonDateRange(rounds, 7),
    athleteCount: 259,
    clubCount: 55,
    summary: {
      totalRegistrations: 432,
      totalFinishers: 0,
      completedRounds: 4,
      publishedRounds: 4,
      clubsRepresented: 55,
      nextStageLabel: "Round 5 · Race TBA",
    },
    rounds,
    entries: [],
    competitions: [],
    clubScoringScope: "combined",
    individualStandings: fallbackSibenikStandings,
    clubStandings: [],
    rules: sibenikTrailLeagueRules,
  };
}

const fallbackSibenikLeagueCatalog: PublicLeagueCatalogItem = {
  id: SIBENIK_TRAIL_LEAGUE_SLUG,
  name: SIBENIK_TRAIL_LEAGUE_NAME,
  organizer: "RacesOn",
  sportCodes: [DEFAULT_SPORT_CODE],
  primarySportCode: DEFAULT_SPORT_CODE,
  desc: SIBENIK_TRAIL_LEAGUE_DESCRIPTION,
  imageUrl: SIBENIK_TRAIL_LEAGUE_MEDIA.hero,
  rounds: 7,
  completed: 4,
  athletes: 259,
  registrations: 432,
  clubs: 55,
  leader: "—",
  season: buildLeagueSeasonDateRange(buildFallbackSibenikRounds(), 7),
  iconKey: "trophy",
  status: "active",
  displayDate: "TBA",
  displayDateKind: "next_round",
  featuredRoundName: "Round 5 · Race TBA",
  featuredRoundLocation: "Location TBA",
  featuredRoundDistance: "Distance TBA",
  featuredRoundElevation: "Elevation TBA",
};

function applySibenikCatalogDefaults(item: PublicLeagueCatalogItem): PublicLeagueCatalogItem {
  if (!isSibenikTrailLeague(item.id)) return item;
  return {
    ...item,
    id: SIBENIK_TRAIL_LEAGUE_SLUG,
    name: getSibenikTrailLeagueDisplayName(item.name, item.id),
    desc: item.desc.trim() ? item.desc : SIBENIK_TRAIL_LEAGUE_DESCRIPTION,
    imageUrl: item.imageUrl ?? SIBENIK_TRAIL_LEAGUE_MEDIA.hero,
    registrations: item.registrations ?? item.athletes,
  };
}

function applySibenikDetailDefaults(detail: PublicLeagueDetailReadModel): PublicLeagueDetailReadModel {
  if (!isSibenikTrailLeague(detail.slug)) return detail;
  return {
    ...detail,
    slug: SIBENIK_TRAIL_LEAGUE_SLUG,
    name: getSibenikTrailLeagueDisplayName(detail.name, detail.slug),
    description: detail.description.trim() ? detail.description : SIBENIK_TRAIL_LEAGUE_DESCRIPTION,
    organizerRules: detail.organizerRules?.trim() || SIBENIK_TRAIL_LEAGUE_ORGANIZER_RULES,
    imageUrl: detail.imageUrl ?? SIBENIK_TRAIL_LEAGUE_MEDIA.hero,
    rounds: detail.rounds.map((round) => ({
      ...round,
      eventImageUrl: getSibenikTrailLeagueRoundImage(round.eventSlug, round.eventImageUrl),
    })),
  };
}

function buildEmptyPublicLeagueDetail(slug: string): PublicLeagueDetailReadModel {
  return {
    slug,
    name: labelFromSlug(slug),
    description: "",
    imageUrl: resolveLeagueImageUrl(null),
    organizer: mapPublicOrganizationProfile(null),
    status: "upcoming",
    seasonLabel: "TBA - TBA",
    athleteCount: 0,
    clubCount: 0,
    summary: {
      totalRegistrations: 0,
      totalFinishers: 0,
      completedRounds: 0,
      publishedRounds: 0,
      clubsRepresented: 0,
      nextStageLabel: null,
    },
    rounds: [],
    entries: [],
    competitions: [],
    clubScoringScope: "per_competition",
    individualStandings: [],
    clubStandings: [],
    rules: {
      pointsTable: [100, 90, 82, 75, 70, 66, 62, 58, 55, 52],
      fieldSizeProfile: "custom",
      participationPoints: 0,
      bestN: 0,
      minimumRounds: 0,
      tieBreakMethod: "best_finish",
      clubScoringMode: "best_three",
    },
  };
}

export function getFallbackPublicLeaguesCatalog(): PublicLeagueCatalogItem[] {
  return [fallbackSibenikLeagueCatalog];
}

export function getFallbackPublicLeagueDetail(slug: string): PublicLeagueDetailReadModel {
  const fallback = isSibenikTrailLeague(slug)
    ? buildFallbackSibenikLeagueDetail()
    : buildEmptyPublicLeagueDetail(slug);
  return {
    ...fallback,
    competitions: [],
    individualStandings: [],
    clubStandings: [],
  };
}

export function getFallbackPublicRankings(): PublicRankingItem[] {
  return emptyPublicRankings;
}

export async function getPublicLeaguesCatalog(): Promise<PublicLeagueCatalogItem[]> {
  const supabase = getSupabasePublicClient();
  if (!supabase) return [];

  try {
    const { data: seasons, error: seasonError } = await supabase
      .from("league_seasons")
      .select("id,league_id,year,name,status,published_at")
      .not("published_at", "is", null)
      .order("year", { ascending: false });

    if (seasonError) {
      throw seasonError;
    }

    if (!seasons?.length) {
      return [];
    }

    const latestSeasonByLeague = new Map<string, (typeof seasons)[number]>();
    for (const season of seasons ?? []) {
      if (!latestSeasonByLeague.has(season.league_id)) {
        latestSeasonByLeague.set(season.league_id, season);
      }
    }

    const leagueIds = Array.from(latestSeasonByLeague.keys());
    const { data: leagues, error } = await supabase
      .from("leagues")
      .select("id,organization_id,slug,name,description,status")
      .in("id", leagueIds)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    if (!leagues?.length) {
      return [];
    }

    const seasonIds = Array.from(latestSeasonByLeague.values()).map((season) => season.id);
    const organizationIds = Array.from(new Set(leagues.map((league) => league.organization_id).filter(Boolean)));
    const [roundsResponse, individualResponse, clubResponse, leagueSportsResponse, organizationsResponse] = await Promise.all([
      seasonIds.length
        ? supabase
            .from("league_rounds")
            .select("league_season_id,status,event_edition_id,event_category_id,round_number")
            .in("league_season_id", seasonIds)
        : Promise.resolve({
            error: null,
            data: [] as Array<{
              league_season_id: string;
              status: string | null;
              event_edition_id: string;
              event_category_id: string | null;
              round_number: number | null;
            }>,
          }),
      seasonIds.length
        ? supabase
            .from("league_individual_standings")
            .select("league_season_id,athlete_profile_id,rank_overall")
            .in("league_season_id", seasonIds)
        : Promise.resolve({ data: [] as Array<{ league_season_id: string; athlete_profile_id: string; rank_overall: number | null }> }),
      seasonIds.length
        ? supabase
            .from("league_club_standings")
            .select("league_season_id,club_id")
            .in("league_season_id", seasonIds)
        : Promise.resolve({ data: [] as Array<{ league_season_id: string; club_id: string }> }),
      supabase
        .from("league_sports")
        .select("league_id,sport_code,is_primary")
        .in("league_id", leagueIds),
      organizationIds.length
        ? supabase
            .from("organizations")
            .select("id,name")
            .in("id", organizationIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    ]);
    if (leagueSportsResponse.error) throw leagueSportsResponse.error;

    const roundEditionIds = Array.from(
      new Set((roundsResponse.data ?? []).map((round) => round.event_edition_id).filter(Boolean)),
    );
    const [editionsResponse, categoriesResponse] = await Promise.all([
      roundEditionIds.length
        ? supabase
            .from("event_editions")
            .select("id,name,start_date,end_date,timezone,location_name,status")
            .in("id", roundEditionIds)
            .is("organizer_deleted_at", null)
        : Promise.resolve({
            error: null,
            data: [] as Array<{
              id: string;
              name: string;
              start_date: string | null;
              end_date: string | null;
              timezone: string | null;
              location_name: string | null;
              status: string | null;
            }>,
          }),
      roundEditionIds.length
        ? supabase
            .from("event_categories")
            .select("id,event_edition_id,distance_km,elevation_gain_m")
            .in("event_edition_id", roundEditionIds)
            .is("organizer_deleted_at", null)
        : Promise.resolve({
            error: null,
            data: [] as Array<{
              id: string;
              event_edition_id: string;
              distance_km: number | null;
              elevation_gain_m: number | null;
            }>,
          }),
    ]);

    if (editionsResponse.error) throw editionsResponse.error;
    if (categoriesResponse.error) throw categoriesResponse.error;

    const registrationCountByCategoryId = await getPublicRegistrationCountsByCategoryId(
      supabase,
      (categoriesResponse.data ?? []).map((category) => category.id),
    );

    const leaderAthleteIds = Array.from(
      new Set(
        (individualResponse.data ?? [])
          .filter((standing) => standing.rank_overall === 1)
          .map((standing) => standing.athlete_profile_id),
      ),
    );
    const { data: leaders } = leaderAthleteIds.length
      ? await supabase.from("public_athlete_profiles").select("id,display_name").in("id", leaderAthleteIds)
      : { data: [] };

    const leaderById = new Map((leaders ?? []).map((leader) => [leader.id, leader.display_name]));
    const organizationNameById = new Map(
      (organizationsResponse.data ?? []).map((organization) => [organization.id, organization.name]),
    );
    const editionById = new Map(
      (editionsResponse.data ?? []).map((edition) => [
        edition.id,
        {
          name: edition.name,
          start_date: edition.start_date,
          end_date: edition.end_date,
          timezone: edition.timezone,
          location_name: edition.location_name,
          status: edition.status,
        },
      ]),
    );
    const categoryById = new Map(
      (categoriesResponse.data ?? []).map((category) => [
        category.id,
        {
          distance_km: category.distance_km,
          elevation_gain_m: category.elevation_gain_m,
        },
      ]),
    );
    const categoryIdsByEditionId = groupLeagueCategoryIdsByEdition(
      (categoriesResponse.data ?? []).map((category) => ({
        id: category.id,
        eventEditionId: category.event_edition_id,
      })),
    );
    const roundsBySeason = new Map<string, typeof roundsResponse.data>();
    const individualsBySeason = new Map<string, typeof individualResponse.data>();
    const clubsBySeason = new Map<string, typeof clubResponse.data>();
    const sportsByLeagueId = new Map<string, Array<{ sport_code: SportCode; is_primary: boolean }>>();
    for (const round of roundsResponse.data ?? []) {
      const current = roundsBySeason.get(round.league_season_id) ?? [];
      current.push(round);
      roundsBySeason.set(round.league_season_id, current);
    }
    for (const standing of individualResponse.data ?? []) {
      const current = individualsBySeason.get(standing.league_season_id) ?? [];
      current.push(standing);
      individualsBySeason.set(standing.league_season_id, current);
    }
    for (const standing of clubResponse.data ?? []) {
      const current = clubsBySeason.get(standing.league_season_id) ?? [];
      current.push(standing);
      clubsBySeason.set(standing.league_season_id, current);
    }
    for (const assignment of leagueSportsResponse.data ?? []) {
      const current = sportsByLeagueId.get(assignment.league_id) ?? [];
      current.push({
        sport_code: assignment.sport_code as SportCode,
        is_primary: assignment.is_primary,
      });
      sportsByLeagueId.set(assignment.league_id, current);
    }

    const mapped = leagues.map((league) => {
      const publicDescription = sanitizePublicLeagueDescription(league.description);
      const season = latestSeasonByLeague.get(league.id);
      const seasonRounds = season ? roundsBySeason.get(season.id) ?? [] : [];
      const plannedRoundCount = buildLeagueRoundSlots(
        seasonRounds.flatMap((round) => {
          const roundNumber = Number(round.round_number ?? 0);
          return roundNumber > 0 ? [{ roundNumber }] : [];
        }),
        league.description,
      ).length;
      const seasonIndividuals = season ? individualsBySeason.get(season.id) ?? [] : [];
      const seasonClubs = season ? clubsBySeason.get(season.id) ?? [] : [];
      const leaderId = seasonIndividuals.find((standing) => standing.rank_overall === 1)?.athlete_profile_id;
      const seasonEditionIds = Array.from(new Set(seasonRounds.map((round) => round.event_edition_id)));
      const seasonCategoryIds = seasonEditionIds.flatMap(
        (editionId) => categoryIdsByEditionId.get(editionId) ?? [],
      );
      const registrationCount = seasonCategoryIds.reduce(
        (sum, categoryId) => sum + (registrationCountByCategoryId.get(categoryId)?.registeredCount ?? 0),
        0,
      );
      const finisherCount = seasonCategoryIds.reduce(
        (sum, categoryId) => sum + (registrationCountByCategoryId.get(categoryId)?.finisherCount ?? 0),
        0,
      );
      const athleteCount = new Set(seasonIndividuals.map((standing) => standing.athlete_profile_id)).size;
      const clubCount = new Set(seasonClubs.map((standing) => standing.club_id)).size;
      const schedule = resolveLeagueCatalogSchedule(seasonRounds, editionById, categoryById, plannedRoundCount);
      const sportRows = sportsByLeagueId.get(league.id) ?? [];
      const sportSelection = normalizeSportSelection({
        sportCodes: sportRows.map((row) => row.sport_code),
        primarySportCode: sportRows.find((row) => row.is_primary)?.sport_code ?? DEFAULT_SPORT_CODE,
      });

      return {
        id: league.slug,
        name: league.name,
        organizer: organizationNameById.get(league.organization_id) ?? "League organizer",
        sportCodes: sportSelection.sportCodes,
        primarySportCode: sportSelection.primarySportCode,
        desc: publicDescription || "Seasonal endurance sports series.",
        imageUrl: resolveLeagueImageUrl(league.description),
        rounds: plannedRoundCount,
        completed: seasonRounds.filter((round) => {
          const edition = editionById.get(round.event_edition_id);
          return derivePublicLeagueRoundStatus(edition, round.status) === "completed";
        }).length,
        athletes: athleteCount || seasonIndividuals.length,
        registrations: registrationCount,
        finishers: finisherCount,
        clubs: clubCount,
        leader: leaderId ? leaderById.get(leaderId) ?? "TBD" : "TBD",
        season: buildLeagueSeasonDateRange(
          seasonRounds.map((round) => ({
            roundNumber: round.round_number ?? 0,
            dateIso: editionById.get(round.event_edition_id)?.start_date,
          })),
          plannedRoundCount,
        ),
        iconKey: inferLeagueIcon(league.slug),
        status: deriveLeagueSeasonStatus(
          seasonRounds.map((round) => {
            const edition = editionById.get(round.event_edition_id);
            return derivePublicLeagueRoundStatus(edition, round.status);
          }),
          season?.status ?? league.status,
          plannedRoundCount,
        ),
        displayDate: schedule.displayDate,
        displayDateKind: schedule.displayDateKind,
        featuredRoundName: schedule.featuredRoundName,
        featuredRoundLocation: schedule.featuredRoundLocation,
        featuredRoundDistance: schedule.featuredRoundDistance,
        featuredRoundElevation: schedule.featuredRoundElevation,
      };
    });

    return mapped.map(applySibenikCatalogDefaults);
  } catch (error) {
    console.warn("Unable to load public leagues catalog", error);
    throw error instanceof Error ? error : new Error("Unable to load public leagues catalog");
  }
}

export async function getPublicLeagueDetail(slug: string): Promise<PublicLeagueDetailReadModel> {
  const fallback = getFallbackPublicLeagueDetail(slug);
  const supabase = getSupabasePublicClient();
  if (!supabase) throw new Error("Public league data service is unavailable");

  try {
    const { data: league, error } = await supabase
      .from("leagues")
      .select("id,organization_id,slug,name,description,status")
      .in("slug", getSibenikTrailLeagueLookupSlugs(slug))
      .limit(1)
      .maybeSingle();

    if (error || !league) {
      throw error ?? new Error(`League ${slug} not found`);
    }

    const { data: organization } = await supabase
      .from("public_organization_profiles")
      .select("name,country_code,region,city,description,website_url,instagram_url,facebook_url,linkedin_url,youtube_url,tiktok_url,x_url,contact_email,contact_phone,logo_image_url,profile_visibility,contact_details_visibility")
      .eq("id", league.organization_id)
      .maybeSingle();
    const organizer = mapPublicOrganizationProfile(organization);

    const { data: detailSportRows, error: detailSportsError } = await supabase
      .from("league_sports")
      .select("sport_code,is_primary")
      .eq("league_id", league.id);
    if (detailSportsError) throw detailSportsError;
    const detailSportSelection = normalizeSportSelection({
      sportCodes: (detailSportRows ?? []).map((row) => row.sport_code),
      primarySportCode: (detailSportRows ?? []).find((row) => row.is_primary)?.sport_code,
    });

    const { data: seasons } = await supabase
      .from("league_seasons")
      .select("id,year,name,status,organizer_rules,published_at")
      .eq("league_id", league.id)
      .not("published_at", "is", null)
      .order("year", { ascending: false })
      .limit(1);

    const season = seasons?.[0];
    if (!season) {
      throw new Error(`League ${slug} is not published`);
    }

    const [
      roundsResponse,
      individualsResponse,
      clubsResponse,
      officialStandingsResponse,
      rulesResponse,
      competitionDefinitionsResponse,
      rulesExtensionResponse,
      clubScoringScopeResponse,
    ] = await Promise.all([
      supabase
        .from("league_rounds")
        .select("id,event_edition_id,event_category_id,round_number,status")
        .eq("league_season_id", season.id)
        .order("round_number", { ascending: true }),
      supabase
        .from("league_individual_standings")
        .select("athlete_profile_id,points_total,scored_rounds,rank_overall")
        .eq("league_season_id", season.id)
        .order("rank_overall", { ascending: true }),
      supabase
        .from("league_club_standings")
        .select("club_id,points_total,scored_rounds,rank_overall")
        .eq("league_season_id", season.id)
        .order("rank_overall", { ascending: true }),
      getPublicLeagueClubStandingDetails(season.id).catch((error) => {
        console.warn("Unable to load official league club contribution details", error);
        return { clubs: [] };
      }),
      supabase
        .from("league_scoring_rules")
        .select("points_table_json,best_n_rounds,minimum_rounds,tie_break_method,club_scoring_mode")
        .eq("league_season_id", season.id)
        .maybeSingle(),
      supabase.rpc("public_league_competition_definitions", {
        p_league_season_id: season.id,
      }),
      supabase
        .from("league_scoring_rules")
        .select("field_size_profile,participation_points")
        .eq("league_season_id", season.id)
        .maybeSingle(),
      supabase
        .from("league_seasons")
        .select("club_scoring_scope")
        .eq("id", season.id)
        .maybeSingle(),
    ]);

    const rounds = roundsResponse.data ?? [];
    const rulesExtensionErrorCode = (rulesExtensionResponse.error as { code?: string } | null)?.code;
    if (rulesExtensionResponse.error && !["42703", "PGRST204"].includes(rulesExtensionErrorCode ?? "")) {
      throw rulesExtensionResponse.error;
    }
    const clubScoringScopeErrorCode = (clubScoringScopeResponse.error as { code?: string } | null)?.code;
    if (
      clubScoringScopeResponse.error
      && !["42703", "PGRST204"].includes(clubScoringScopeErrorCode ?? "")
    ) {
      throw clubScoringScopeResponse.error;
    }
    const storedClubScoringScope = (clubScoringScopeResponse.data as { club_scoring_scope?: unknown } | null)
      ?.club_scoring_scope;
    const clubScoringScope = normalizeLeagueClubScoringScope(
      typeof storedClubScoringScope === "string"
        ? storedClubScoringScope
        : (isSibenikTrailLeague(league.slug) ? "combined" : undefined),
    );
    const pointsTable = Array.isArray(rulesResponse.data?.points_table_json)
      ? rulesResponse.data.points_table_json.map((entry: number | { points?: number }) =>
          Number(typeof entry === "number" ? entry : entry.points ?? 0),
        )
      : fallback.rules.pointsTable;
    const resolvedPointsTable = pointsTable.length ? pointsTable : fallback.rules.pointsTable;
    const participationPoints = Number(rulesExtensionResponse.data?.participation_points ?? 0);
    const bestN = rulesResponse.data?.best_n_rounds ?? fallback.rules.bestN;
    const seasonReferenceDate = `${season.year}-12-31`;
    const competitionDefinitionPayload = competitionDefinitionsResponse.error
      ? null
      : competitionDefinitionsResponse.data as PublicLeagueCompetitionDefinitionsRpc | null;
    const competitionDefinitions = competitionDefinitionPayload?.competitions ?? [];
    const officialClubStandings = officialStandingsResponse.clubs as PublicLeagueClubStandingDetails["clubs"];
    const definedMappedCategoryIds = new Set(
      competitionDefinitions.flatMap((competition) =>
        (competition.roundMappings ?? []).map((mapping) => mapping.eventCategoryId),
      ),
    );
    const roundEditionIds = Array.from(
      new Set(rounds.map((round) => round.event_edition_id).filter((value): value is string => Boolean(value))),
    );
    const categoriesResponse = roundEditionIds.length
      ? await supabase
          .from("event_categories")
          .select("id,event_edition_id,slug,name,distance_km,elevation_gain_m,status,results_mode")
          .in("event_edition_id", roundEditionIds)
          .is("organizer_deleted_at", null)
      : {
          data: [] as Array<{
            id: string;
            event_edition_id: string;
            slug: string;
            name: string;
            distance_km: number | null;
            elevation_gain_m: number | null;
            status: string;
            results_mode: string;
          }>,
        };
    const competitiveCategories = (categoriesResponse.data ?? []).filter(
      (category) => category.status !== "draft" && category.results_mode !== "informative_age",
    );
    const roundCategoryIds = Array.from(
      new Set(competitiveCategories.map((category) => category.id)),
    );
    const athleteIds = Array.from(new Set([
      ...(individualsResponse.data ?? []).map((standing) => standing.athlete_profile_id),
      ...officialClubStandings.flatMap((standing) =>
        (standing.contributions ?? []).flatMap((contribution) =>
          (contribution.members ?? []).map((member) => member.athleteProfileId),
        ),
      ),
    ]));
    const clubIds = Array.from(new Set([
      ...(clubsResponse.data ?? []).map((standing) => standing.club_id),
      ...officialClubStandings.map((standing) => standing.clubId),
    ]));

    const [
      editionsResponse,
      resultRowsResponse,
      athletesResponse,
      clubsMetaResponse,
      registrationCountByCategoryId,
      participantResponses,
      athleteMetadata,
    ] = await Promise.all([
      roundEditionIds.length
        ? supabase
            .from("event_editions")
            .select("id,slug,name,start_date,end_date,timezone,location_name,status,cover_image_url")
            .in("id", roundEditionIds)
            .is("organizer_deleted_at", null)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              slug: string;
              name: string;
              start_date: string;
              end_date: string | null;
              timezone: string | null;
              location_name: string | null;
              status: string | null;
              cover_image_url: string | null;
            }>,
          }),
      roundCategoryIds.length
        ? getCurrentPublishedResultRows({ eventCategoryIds: roundCategoryIds }, season.id).then((rows) => ({
            data: rows.map((row) => ({
              id: row.resultRowId,
              league_classification_ids: row.leagueClassificationIds,
              athlete_profile_id: row.athleteProfileId,
              event_category_id: row.eventCategoryId,
              publication_state: row.publicationState,
              published_at: row.publishedAt,
              result_status: row.resultStatus,
              participation_status: row.participationStatus,
              finish_time_ms: row.finishTimeMs,
              rank_overall: row.rankOverall,
              rank_gender: row.rankGender,
              rank_age_category: row.rankAgeCategory,
              club_points: row.clubPoints,
              represented_club_id: row.representedClubId,
            })),
          }))
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              league_classification_ids?: string[];
              athlete_profile_id: string;
              event_category_id: string;
              publication_state: string;
              published_at: string;
              result_status: string;
              participation_status: string | null;
              finish_time_ms: number | null;
              rank_overall: number | null;
              rank_gender: number | null;
              rank_age_category: number | null;
              club_points: number | null;
              represented_club_id: string | null;
            }>,
          }),
      athleteIds.length
        ? supabase
            .from("public_athlete_profiles")
            .select("id,slug,display_name,gender,date_of_birth,country_code")
            .in("id", athleteIds)
        : Promise.resolve({ data: [] as Array<{ id: string; slug: string; display_name: string; gender: string | null; date_of_birth: string | null; country_code: string | null }> }),
      clubIds.length
        ? supabase.from("clubs").select("id,slug,name").in("id", clubIds)
        : Promise.resolve({ data: [] as Array<{ id: string; slug: string; name: string }> }),
      getPublicRegistrationCountsByCategoryId(supabase, roundCategoryIds),
      Promise.all(
        roundEditionIds.map(async (editionId) => {
          const { data, error: participantsError } = await supabase.rpc("public_event_participants", {
            target_event_edition_id: editionId,
          });

          if (participantsError) {
            throw participantsError;
          }

          return {
            editionId,
            rows: (data ?? []) as PublicEventParticipantRpcRow[],
          };
        }),
      ),
      getPublicAthleteMetadata().catch((error): PublicAthleteMetadata[] => {
        console.warn("Unable to load public league ranking avatars", error);
        return [];
      }),
    ]);

    const roundAthleteIds = Array.from(new Set((resultRowsResponse.data ?? []).map((row) => row.athlete_profile_id)));
    const roundClubIds = Array.from(
      new Set(
        (resultRowsResponse.data ?? [])
          .map((row) => row.represented_club_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const missingAthleteIds = roundAthleteIds.filter((id) => !athleteIds.includes(id));
    const missingClubIds = roundClubIds.filter((id) => !clubIds.includes(id));

    const [roundAthletesResponse, roundClubsResponse] = await Promise.all([
      missingAthleteIds.length
        ? supabase
            .from("public_athlete_profiles")
            .select("id,slug,display_name,gender,date_of_birth,country_code")
            .in("id", missingAthleteIds)
        : Promise.resolve({ data: [] as Array<{ id: string; slug: string; display_name: string; gender: string | null; date_of_birth: string | null; country_code: string | null }> }),
      missingClubIds.length
        ? supabase.from("clubs").select("id,slug,name").in("id", missingClubIds)
        : Promise.resolve({ data: [] as Array<{ id: string; slug: string; name: string }> }),
    ]);

    const athletes = [...(athletesResponse.data ?? []), ...(roundAthletesResponse.data ?? [])];
    const clubs = [...(clubsMetaResponse.data ?? []), ...(roundClubsResponse.data ?? [])];

    const editionById = new Map((editionsResponse.data ?? []).map((edition) => [edition.id, edition]));
    const categoryById = new Map(competitiveCategories.map((category) => [category.id, category]));
    const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]));
    const avatarUrlByAthleteId = new Map(
      athleteMetadata.map((metadata) => [metadata.athleteProfileId, metadata.avatarUrl]),
    );
    const avatarUrlByAthleteSlug = new Map(
      athletes.map((athlete) => [athlete.slug, avatarUrlByAthleteId.get(athlete.id) ?? null]),
    );
    const clubById = new Map(clubs.map((club) => [club.id, club]));
    const roundByEditionId = new Map(rounds.map((round) => [round.event_edition_id, round]));
    const roundByCategoryId = new Map<string, (typeof rounds)[number]>();
    const categoryIdsByEditionId = groupLeagueCategoryIdsByEdition(
      competitiveCategories.map((category) => ({
        id: category.id,
        eventEditionId: category.event_edition_id,
      })),
    );
    for (const competition of competitionDefinitions) {
      for (const mapping of competition.roundMappings ?? []) {
        const round = roundByEditionId.get(mapping.eventEditionId)
          ?? rounds.find((candidate) => candidate.round_number === mapping.roundNumber);
        if (round) roundByCategoryId.set(mapping.eventCategoryId, round);
      }
    }
    for (const category of competitiveCategories) {
      if (roundByCategoryId.has(category.id)) continue;
      const round = roundByEditionId.get(category.event_edition_id);
      if (round) roundByCategoryId.set(category.id, round);
    }
    const leagueRankByAthleteId = new Map(
      (individualsResponse.data ?? []).map((standing) => [standing.athlete_profile_id, standing.rank_overall ?? null]),
    );

    const resultRowByAthleteCategory = new Map(
      (resultRowsResponse.data ?? []).map((row) => [
        `${row.athlete_profile_id}:${row.event_category_id}`,
        row,
      ]),
    );

    const roundScoresByAthlete = new Map<string, number[]>();
    const classificationIdsByAthlete = new Map<string, string[]>();
    for (const row of resultRowsResponse.data ?? []) {
      if (row.league_classification_ids === undefined) continue;
      classificationIdsByAthlete.set(row.athlete_profile_id, [...new Set([
        ...(classificationIdsByAthlete.get(row.athlete_profile_id) ?? []),
        ...row.league_classification_ids,
      ])]);
    }
    const scorerAthletesByClub = new Map<string, PublicLeagueClubScorerItem[]>();

    for (const row of resultRowsResponse.data ?? []) {
      const round = roundByCategoryId.get(row.event_category_id);
      if (!round) continue;
      if (row.represented_club_id && leagueRoundOutcome(row.participation_status ?? "")) {
        const athlete = athleteById.get(row.athlete_profile_id);
        const scorers = scorerAthletesByClub.get(row.represented_club_id) ?? [];
        scorers.push({
          name: athlete?.display_name ?? "Trail Runner",
          athleteSlug: athlete?.slug ?? null,
        });
        scorerAthletesByClub.set(row.represented_club_id, scorers);
      }
    }

    const mappedEntries = participantResponses
      .flatMap((response) => {
        const round = roundByEditionId.get(response.editionId);
        if (!round) return [];

        return response.rows
          .filter((row) => !definedMappedCategoryIds.size || definedMappedCategoryIds.has(row.event_category_id))
          .map((row) => {
          const edition = editionById.get(round.event_edition_id);
          const category = categoryById.get(row.event_category_id);
          const resultRow = resultRowByAthleteCategory.get(
            `${row.athlete_profile_id}:${row.event_category_id}`,
          );
          const finishTimeMs = resultRow?.finish_time_ms ?? null;
          const club = resultRow?.represented_club_id ? clubById.get(resultRow.represented_club_id) : undefined;
          const publicationState = resultRow?.publication_state ?? null;
          const resultIsOfficial = leagueResultIsOfficial(publicationState);
          const stageLabel = edition?.name && category?.name
            ? `${edition.name} · ${category.name}`
            : edition?.name ?? category?.name ?? `Round ${round.round_number ?? "?"}`;
          const clubName = normalizePublicResultClubName(club?.name ?? row.club_name);

          return {
            registrationId: row.registration_id,
            leagueClassificationIds: resultRow?.league_classification_ids,
            athleteId: row.athlete_profile_id,
            roundId: round.id,
            roundNumber: round.round_number,
            eventEditionId: round.event_edition_id,
            eventCategoryId: row.event_category_id,
            eventSlug: edition?.slug ?? `${league.slug}-round-${round.round_number ?? 0}`,
            eventName: edition?.name ?? `Round ${round.round_number ?? "?"}`,
            categorySlug: row.event_category_slug ?? category?.slug ?? "",
            categoryName: row.event_category_name ?? category?.name ?? "Race",
            distanceKm: category?.distance_km ?? null,
            stageLabel,
            roundStatus: resultIsOfficial ? "completed" : "upcoming",
            date: edition?.start_date ? format(new Date(`${edition.start_date}T00:00:00`), "MMM d, yyyy") : "TBA",
            dateIso: edition?.start_date ?? null,
            location: edition?.location_name ?? "Location TBA",
            bib: row.bib_number ?? "—",
            athleteSlug: row.athlete_slug || "athletes",
            name: row.athlete_name ?? "Trail Runner",
            club: clubName,
            clubSlug: clubName ? club?.slug ?? row.club_slug ?? null : null,
            countryCode: athleteById.get(row.athlete_profile_id)?.country_code ?? null,
            gender: normalizeGender(row.gender),
            ageCategory: row.age_category_label ?? "Open",
            leagueCategoryLabels: [],
            age: ageAtDate(athleteById.get(row.athlete_profile_id)?.date_of_birth, seasonReferenceDate),
            registrationStatus: row.registration_status ?? "confirmed",
            participationStatus: resultRow?.participation_status ?? row.participation_status ?? "not_started",
            resultStatus: resultRow?.result_status ?? "uncomputed",
            publicationState,
            publishedAt: resultRow?.published_at ?? null,
            time: formatElapsedTimeFromMs(finishTimeMs),
            finishTimeMs,
            overall: resultRow?.rank_overall ?? 0,
            genderRank: resultRow?.rank_gender ?? 0,
            ageRank: resultRow?.rank_age_category ?? 0,
            leaguePoints:
              resultIsOfficial && resultRow?.rank_overall != null && resultRow.rank_overall > 0
                ? pointsForLeaguePlace(resultRow.rank_overall, resolvedPointsTable, participationPoints)
                : 0,
            leagueRank: leagueRankByAthleteId.get(row.athlete_profile_id) ?? null,
            } satisfies PublicLeagueEntryItem;
          });
      })
      .sort((left, right) => {
        if (left.roundNumber !== right.roundNumber) return left.roundNumber - right.roundNumber;
        if (left.overall && right.overall) return left.overall - right.overall;
        if (left.overall) return -1;
        if (right.overall) return 1;
        return left.name.localeCompare(right.name);
      });

    for (const entry of mappedEntries) {
      if (entry.leaguePoints <= 0) continue;
      const existingScores = roundScoresByAthlete.get(entry.athleteId) ?? [];
      existingScores[Math.max(0, entry.roundNumber - 1)] = entry.leaguePoints;
      roundScoresByAthlete.set(entry.athleteId, existingScores);
    }

    const entriesByRoundId = new Map<string, PublicLeagueEntryItem[]>();
    for (const entry of mappedEntries) {
      const current = entriesByRoundId.get(entry.roundId) ?? [];
      current.push(entry);
      entriesByRoundId.set(entry.roundId, current);
    }

    const mappedRounds = rounds.map((round) => {
      const edition = editionById.get(round.event_edition_id);
      const category = categoryById.get(round.event_category_id);
      const roundCategoryIds = categoryIdsByEditionId.get(round.event_edition_id) ?? [];
      const roundCategories = roundCategoryIds.flatMap((categoryId) => {
        const roundCategory = categoryById.get(categoryId);
        return roundCategory ? [roundCategory] : [];
      });
      const roundRange = formatCategoryRange(roundCategories);
      const roundEntries = [...(entriesByRoundId.get(round.id) ?? [])];
      const publicationState = roundEntries.find((entry) => entry.publicationState)?.publicationState ?? null;
      const publishedAt = roundEntries.find((entry) => entry.publishedAt)?.publishedAt ?? null;
      const { hasPublishedResults, hasPartialPublishedResults } = deriveLeagueRoundPublicationStatus(
        roundCategoryIds,
        roundEntries,
      );
      const top3 = roundEntries
        .filter((entry) => entry.overall > 0)
        .sort((left, right) => left.overall - right.overall)
        .slice(0, 3)
        .map((entry) => ({
          athleteSlug: entry.athleteSlug,
          name: entry.name,
          club: entry.club,
          clubSlug: entry.clubSlug,
          time: entry.time,
          points: entry.leaguePoints,
        }));

      return {
        roundId: round.id,
        roundNumber: round.round_number,
        eventEditionId: round.event_edition_id,
        eventCategoryId: round.event_category_id,
        eventSlug: edition?.slug ?? `${league.slug}-round-${round.round_number ?? 0}`,
        eventImageUrl: resolveRecoveredPublicMediaUrl(edition?.cover_image_url),
        name: edition?.name ?? `Round ${round.round_number ?? "?"}`,
        categoryName: roundCategories.length > 1 ? `${roundCategories.length} routes` : category?.name ?? "Race",
        stageLabel:
          roundCategories.length > 1
            ? `${edition?.name ?? `Round ${round.round_number ?? "?"}`} · ${roundCategories.length} routes`
            : edition?.name && category?.name
              ? `${edition.name} · ${category.name}`
              : edition?.name ?? category?.name ?? "Round",
        date: edition?.start_date ? format(new Date(`${edition.start_date}T00:00:00`), "MMM d, yyyy") : "TBA",
        dateIso: edition?.start_date ?? null,
        location: edition?.location_name ?? "Location TBA",
        distance: roundRange.distance,
        elevation: roundRange.elevation,
        status: derivePublicLeagueRoundStatus(edition, round.status),
        participants: roundCategoryIds.reduce(
          (sum, categoryId) => sum + (registrationCountByCategoryId.get(categoryId)?.registeredCount ?? 0),
          0,
        ),
        finishers: roundEntries.filter((entry) => entry.participationStatus === "finished" || entry.overall > 0).length,
        hasPublishedResults,
        hasPartialPublishedResults,
        publicationState,
        publishedAt,
        top3,
        isPlaceholder: false,
      } satisfies PublicLeagueRoundItem;
    });

    const scheduledRounds = buildLeagueRoundSlots(mappedRounds, league.description).map((slot) => {
      if (slot.round) return slot.round;
      return {
        roundId: `planned:${season.id}:${slot.roundNumber}`,
        roundNumber: slot.roundNumber,
        eventEditionId: "",
        eventCategoryId: "",
        eventSlug: "",
        name: "Race to be announced",
        categoryName: "Race categories TBA",
        stageLabel: `Round ${slot.roundNumber} · Race TBA`,
        date: "Date TBA",
        dateIso: null,
        location: "Location TBA",
        distance: "Distance TBA",
        elevation: "Elevation TBA",
        status: "upcoming",
        participants: 0,
        finishers: 0,
        hasPublishedResults: false,
        hasPartialPublishedResults: false,
        publicationState: null,
        publishedAt: null,
        top3: [],
        isPlaceholder: true,
      } satisfies PublicLeagueRoundItem;
    });

    const persistedIndividuals = (individualsResponse.data ?? []).map((standing) => {
      const athlete = athleteById.get(standing.athlete_profile_id);
      const representativeEntry = mappedEntries.find(
        (entry) => entry.athleteId === standing.athlete_profile_id && Boolean(normalizePublicResultClubName(entry.club)),
      );

      return {
        athleteId: standing.athlete_profile_id,
        leagueClassificationIds: classificationIdsByAthlete.get(standing.athlete_profile_id),
        rank: standing.rank_overall ?? 0,
        name: athlete?.display_name ?? "Trail Runner",
        athleteSlug: athlete?.slug ?? "athletes",
        avatarUrl: avatarUrlByAthleteId.get(standing.athlete_profile_id) ?? null,
        club: representativeEntry?.club ?? "—",
        clubSlug: representativeEntry?.clubSlug ?? null,
        points: Math.round(Number(standing.points_total ?? 0)),
        change: 0,
        races: standing.scored_rounds ?? 0,
        roundScores: roundScoresByAthlete.get(standing.athlete_profile_id) ?? [],
        gender: normalizeGender(athlete?.gender),
        ageCategory: ageCategoryLabel(athlete?.date_of_birth, seasonReferenceDate),
        leagueCategoryLabels: [],
        age: ageAtDate(athlete?.date_of_birth, seasonReferenceDate),
        eligible: (standing.scored_rounds ?? 0) >= (rulesResponse.data?.minimum_rounds ?? fallback.rules.minimumRounds),
      } satisfies PublicLeagueStandingItem;
    });

    const derivedIndividuals = deriveLeagueStandings(
      mappedEntries,
      resolvedPointsTable,
      participationPoints,
      bestN,
      rulesResponse.data?.minimum_rounds ?? fallback.rules.minimumRounds,
      rulesResponse.data?.tie_break_method ?? fallback.rules.tieBreakMethod,
    ).map((standing, index) => {
      const athlete = athleteById.get(standing.athleteId);
      return {
        athleteId: standing.athleteId,
        leagueClassificationIds: classificationIdsByAthlete.get(standing.athleteId),
        rank: index + 1,
        name: standing.name,
        athleteSlug: standing.athleteSlug,
        avatarUrl: avatarUrlByAthleteId.get(standing.athleteId) ?? null,
        club: standing.clubSlug ? standing.club : "—",
        clubSlug: standing.clubSlug,
        points: standing.points,
        change: 0,
        races: standing.races,
        roundScores: standing.roundScores,
        roundStatuses: standing.roundStatuses,
        gender: standing.gender,
        ageCategory: athlete?.date_of_birth
          ? ageCategoryLabel(athlete.date_of_birth, seasonReferenceDate)
          : standing.ageCategory,
        leagueCategoryLabels: [],
        age: ageAtDate(athlete?.date_of_birth, seasonReferenceDate),
        eligible: standing.eligible,
      } satisfies PublicLeagueStandingItem;
    });
    const mappedIndividuals = derivedIndividuals.length ? derivedIndividuals : persistedIndividuals;
    const rankByAthleteIdentity = new Map(
      mappedIndividuals
        .filter((standing) => standing.eligible !== false)
        .map((standing) => [leagueAthleteIdentity(standing), standing.rank]),
    );
    for (const entry of mappedEntries) {
      entry.leagueRank = rankByAthleteIdentity.get(leagueAthleteIdentity(entry)) ?? entry.leagueRank;
    }

    const officialClubStandingById = new Map(
      officialClubStandings.map((standing) => [standing.clubId, standing]),
    );
    const persistedClubs = (clubsResponse.data ?? []).map((standing) => {
      const club = clubById.get(standing.club_id);
      const officialStanding = officialClubStandingById.get(standing.club_id);
      const scorerAthletes = Array.from(
        new Map(
          (scorerAthletesByClub.get(standing.club_id) ?? []).map((scorer) => [
            scorer.athleteSlug ?? scorer.name,
            scorer,
          ]),
        ).values(),
      );
      const memberByAthleteId = new Map<string, PublicLeagueClubMemberItem>();
      const roundPoints: number[] = [];
      for (const contribution of officialStanding?.contributions ?? []) {
        const roundIndex = Math.max(0, Math.trunc(Number(contribution.roundNumber)) - 1);
        roundPoints[roundIndex] = Number(contribution.points ?? 0);
        for (const member of contribution.members ?? []) {
          const athlete = athleteById.get(member.athleteProfileId);
          const existing = memberByAthleteId.get(member.athleteProfileId);
          const roundScores = existing?.roundScores ?? [];
          const roundPlaces = existing?.roundPlaces ?? [];
          const countedRounds = existing?.countedRounds ?? [];
          const roundStatuses = existing?.roundStatuses ?? [];
          const points = Number(member.points ?? 0);
          const rank = Math.trunc(Number(member.rank ?? 0));
          roundScores[roundIndex] = points;
          roundPlaces[roundIndex] = rank;
          countedRounds[roundIndex] = true;
          roundStatuses[roundIndex] = "finished";
          memberByAthleteId.set(member.athleteProfileId, {
            name: athlete?.display_name ?? "Trail Runner",
            athleteSlug: athlete?.slug ?? null,
            avatarUrl: avatarUrlByAthleteId.get(member.athleteProfileId) ?? null,
            points: (existing?.points ?? 0) + points,
            countedPoints: (existing?.countedPoints ?? 0) + points,
            wins: (existing?.wins ?? 0) + (rank === 1 ? 1 : 0),
            podiums: (existing?.podiums ?? 0) + (rank > 0 && rank <= 3 ? 1 : 0),
            roundScores,
            roundPlaces,
            countedRounds,
            roundStatuses,
          });
        }
      }
      const memberRows = Array.from(memberByAthleteId.values()).sort((left, right) =>
        right.countedPoints - left.countedPoints
        || right.points - left.points
        || left.name.localeCompare(right.name),
      );
      const points = Math.round(Number(officialStanding?.points ?? standing.points_total ?? 0));
      const members = scorerAthletes.length || memberRows.length || standing.scored_rounds || 0;
      return {
        rank: officialStanding?.rank ?? standing.rank_overall ?? 0,
        name: club?.name ?? "Trail Club",
        clubSlug: club?.slug ?? "clubs",
        points,
        members,
        wins: memberRows.reduce((sum, member) => sum + member.wins, 0),
        podiums: memberRows.reduce((sum, member) => sum + member.podiums, 0),
        roundPoints,
        memberRows,
        change: 0,
        scorers: (memberRows.length
          ? memberRows.map((member) => ({ name: member.name, athleteSlug: member.athleteSlug }))
          : scorerAthletes).slice(0, 4),
        avgPoints: members > 0 ? points / members : points,
      } satisfies PublicLeagueClubStandingItem;
    });
    const toPublicClubStandings = (
      standings: ReturnType<typeof deriveLeagueCompetitionClubStandings>,
    ) => standings.map((club, index) => ({
      rank: index + 1,
      name: club.club,
      clubSlug: club.clubSlug,
      points: club.points,
      members: club.members,
      wins: club.wins,
      podiums: club.podiums,
      roundPoints: club.roundPoints,
      memberRows: club.memberRows.map((member) => ({
        name: member.name,
        athleteSlug: member.athleteSlug,
        avatarUrl: avatarUrlByAthleteSlug.get(member.athleteSlug ?? "") ?? null,
        points: member.points,
        countedPoints: member.countedPoints,
        wins: member.wins,
        podiums: member.podiums,
        roundScores: member.roundScores,
        roundPlaces: member.roundPlaces,
        countedRounds: member.countedRounds,
        roundStatuses: member.roundStatuses,
      })),
      change: 0,
      scorers: club.scorers.slice(0, 4).map((scorer) => ({
        name: scorer.name,
        athleteSlug: scorer.athleteSlug,
      })),
      avgPoints: club.members ? club.points / club.members : 0,
    } satisfies PublicLeagueClubStandingItem));
    const mappedCompetitions = competitionDefinitions.map((competition, competitionIndex) => {
      const resultBasis = competition.resultBasis ?? "finish_place";
      const standingsMode = competition.standingsMode === "best_time"
        || competition.standingsMode === "participation"
        || competition.standingsMode === "none"
        ? competition.standingsMode
        : resultBasis === "elapsed_time"
          ? "best_time"
          : "points";
      const rawCompetitionPoints = Array.isArray(competition.rules?.pointsTable)
        ? competition.rules.pointsTable.map((entry) =>
            Number(typeof entry === "number" ? entry : entry.points ?? 0),
          )
        : [];
      const competitionRules = {
        pointsTable: standingsMode === "points"
          ? (rawCompetitionPoints.length ? rawCompetitionPoints : resolvedPointsTable)
          : [],
        fieldSizeProfile: competition.rules?.fieldSizeProfile ?? "custom",
        participationPoints: standingsMode === "points"
          ? Number(competition.rules?.participationPoints ?? participationPoints)
          : 0,
        bestN: Number(competition.rules?.bestN ?? bestN),
        minimumRounds: Number(
          competition.rules?.minimumRounds
            ?? rulesResponse.data?.minimum_rounds
            ?? fallback.rules.minimumRounds,
        ),
        tieBreakMethod: competition.rules?.tieBreakMethod
          ?? rulesResponse.data?.tie_break_method
          ?? fallback.rules.tieBreakMethod,
        clubScoringMode: competition.rules?.clubScoringMode
          ?? rulesResponse.data?.club_scoring_mode
          ?? fallback.rules.clubScoringMode,
      } satisfies PublicLeagueRulesReadModel;
      const competitionCategoryIds = new Set(
        (competition.roundMappings ?? []).map((mapping) => mapping.eventCategoryId),
      );
      const competitionEntries = mappedEntries.filter((entry) =>
        competitionCategoryIds.has(entry.eventCategoryId),
      );
      const competitionClassifications = (competition.classifications ?? []).map((classification, classificationIndex) => {
        const minimumAge = classification.eligibility?.minimumAge;
        const maximumAge = classification.eligibility?.maximumAge;
        return {
          id: classification.id,
          slug: classification.slug,
          name: classification.name,
          eligibility: {
            classificationId: classification.id,
            ...(classification.eligibility?.gender === "M" || classification.eligibility?.gender === "F"
              ? { gender: classification.eligibility.gender }
              : {}),
            ...(minimumAge != null && Number.isFinite(Number(minimumAge))
              ? { minimumAge: Number(minimumAge) }
              : {}),
            ...(maximumAge != null && Number.isFinite(Number(maximumAge))
              ? { maximumAge: Number(maximumAge) }
              : {}),
          },
          awardDepth: classification.awardDepth ?? null,
          displayOrder: Number(classification.displayOrder ?? classificationIndex),
          isDefault: classification.isDefault === true,
        } satisfies PublicLeagueClassificationDefinition;
      });
      if (standingsMode === "points") {
        const classificationPointsByAthleteRound = new Map(
          scoreLeagueEntriesForClassifications(
            competitionEntries,
            competitionClassifications,
            competitionRules.pointsTable,
            competitionRules.participationPoints,
          ).map((entry) => [
            `${entry.roundNumber}:${leagueAthleteIdentity(entry)}`,
            entry.leaguePoints,
          ]),
        );
        for (const entry of competitionEntries) {
          entry.leaguePoints = classificationPointsByAthleteRound.get(
            `${entry.roundNumber}:${leagueAthleteIdentity(entry)}`,
          ) ?? 0;
        }
      }
      const toPublicCompetitionStandings = (
        standings: ReturnType<typeof deriveLeagueStandings>,
        participantEntries: PublicLeagueEntryItem[],
        eligibility?: PublicLeagueClassificationDefinition["eligibility"],
        mode: "points" | "participation" = "points",
      ) => {
        const publicStandings = standings.map((standing, index) => {
          const athlete = athleteById.get(standing.athleteId);
          return {
            athleteId: standing.athleteId,
            leagueClassificationIds: classificationIdsByAthlete.get(standing.athleteId),
            rank: index + 1,
            name: standing.name,
            athleteSlug: standing.athleteSlug,
            avatarUrl: avatarUrlByAthleteId.get(standing.athleteId) ?? null,
            club: standing.clubSlug ? standing.club : "—",
            clubSlug: standing.clubSlug,
            points: standing.points,
            change: 0,
            races: standing.races,
            roundScores: standing.roundScores,
            roundStatuses: standing.roundStatuses,
            gender: standing.gender,
            ageCategory: athlete?.date_of_birth
              ? ageCategoryLabel(athlete.date_of_birth, seasonReferenceDate)
              : standing.ageCategory,
            leagueCategoryLabels: resolveLeagueCategoryLabels(
              {
                gender: standing.gender,
                leagueClassificationIds: classificationIdsByAthlete.get(standing.athleteId),
                age: ageAtDate(athlete?.date_of_birth, seasonReferenceDate),
                ageCategory: standing.ageCategory,
              },
              competitionClassifications,
              standing.ageCategory,
            ),
            age: ageAtDate(athlete?.date_of_birth, seasonReferenceDate),
            eligible: standing.eligible,
            standingsMode: mode,
          } satisfies PublicLeagueStandingItem;
        });
        const standingByAthlete = new Map(publicStandings.map((standing) => [
          leagueAthleteIdentity(standing),
          standing,
        ]));
        const outcomePriority: Record<LeagueRoundOutcome, number> = {
          dns: 1,
          dnf: 2,
          dsq: 3,
          finished: 4,
        };

        for (const entry of participantEntries) {
          if (entry.roundStatus !== "completed") continue;
          const outcome = leagueRoundOutcome(entry.participationStatus);
          if (!outcome) continue;
          if (eligibility && !matchesLeagueClassification(entry, eligibility)) continue;

          const identity = leagueAthleteIdentity(entry);
          const roundIndex = Math.max(0, entry.roundNumber - 1);
          const existing = standingByAthlete.get(identity);
          if (existing) {
            const roundStatuses = existing.roundStatuses ?? [];
            const currentOutcome = roundStatuses[roundIndex];
            if (!currentOutcome || outcomePriority[outcome] > outcomePriority[currentOutcome]) {
              roundStatuses[roundIndex] = outcome;
              existing.roundStatuses = roundStatuses;
            }
            continue;
          }

          const athlete = athleteById.get(entry.athleteId);
          const roundScores: number[] = [];
          const roundStatuses: LeagueRoundOutcome[] = [];
          roundScores[roundIndex] = 0;
          roundStatuses[roundIndex] = outcome;
          const age = ageAtDate(athlete?.date_of_birth, seasonReferenceDate) ?? entry.age;
          const participantStanding = {
            athleteId: entry.athleteId,
            leagueClassificationIds: entry.leagueClassificationIds,
            rank: 0,
            name: entry.name,
            athleteSlug: entry.athleteSlug,
            avatarUrl: avatarUrlByAthleteId.get(entry.athleteId) ?? null,
            club: entry.clubSlug ? entry.club : "—",
            clubSlug: entry.clubSlug,
            points: 0,
            change: 0,
            races: outcome === "finished" ? 1 : 0,
            roundScores,
            roundStatuses,
            gender: entry.gender,
            ageCategory: athlete?.date_of_birth
              ? ageCategoryLabel(athlete.date_of_birth, seasonReferenceDate)
              : entry.ageCategory,
            leagueCategoryLabels: resolveLeagueCategoryLabels(
              { gender: entry.gender, age, ageCategory: entry.ageCategory, leagueClassificationIds: entry.leagueClassificationIds },
              competitionClassifications,
              entry.ageCategory,
            ),
            age,
            eligible: false,
            standingsMode: mode,
          } satisfies PublicLeagueStandingItem;
          publicStandings.push(participantStanding);
          standingByAthlete.set(identity, participantStanding);
        }

        return publicStandings;
      };
      const toPublicBestTimeStandings = (
        standings: ReturnType<typeof deriveLeagueBestTimeStandings>,
      ) => {
        let previousBestTimeMs: number | null = null;
        let previousRank = 0;

        return standings.map((standing, index) => {
          const athlete = athleteById.get(standing.athleteId);
          const age = ageAtDate(athlete?.date_of_birth, seasonReferenceDate);
          const rank = previousBestTimeMs === standing.bestTimeMs
            ? previousRank
            : index + 1;
          previousBestTimeMs = standing.bestTimeMs;
          previousRank = rank;
          const roundStatuses: LeagueRoundOutcome[] = [];
          for (const performance of standing.performances) {
            roundStatuses[Math.max(0, performance.roundNumber - 1)] = "finished";
          }

          return {
            athleteId: standing.athleteId,
            leagueClassificationIds: classificationIdsByAthlete.get(standing.athleteId),
            rank,
            name: standing.name,
            athleteSlug: standing.athleteSlug,
            avatarUrl: avatarUrlByAthleteId.get(standing.athleteId) ?? null,
            club: standing.clubSlug ? standing.club : "—",
            clubSlug: standing.clubSlug,
            points: 0,
            change: 0,
            races: standing.performances.length,
            roundScores: [],
            roundStatuses,
            gender: standing.gender,
            ageCategory: athlete?.date_of_birth
              ? ageCategoryLabel(athlete.date_of_birth, seasonReferenceDate)
              : standing.ageCategory,
            leagueCategoryLabels: resolveLeagueCategoryLabels(
              { gender: standing.gender, age, ageCategory: standing.ageCategory, leagueClassificationIds: classificationIdsByAthlete.get(standing.athleteId) },
              competitionClassifications,
              standing.ageCategory,
            ),
            age,
            eligible: true,
            standingsMode: "best_time" as const,
            bestTimeMs: standing.bestTimeMs,
            bestTime: standing.bestPerformance.time,
            bestRoundNumber: standing.bestPerformance.roundNumber,
            bestRoundLabel: standing.bestPerformance.stageLabel,
            bestDate: standing.bestPerformance.date,
            bestDateIso: standing.bestPerformance.dateIso,
            performances: standing.performances,
          } satisfies PublicLeagueStandingItem;
        });
      };
      const competitionBestTimeEntries = competitionEntries.flatMap((entry) => (
        typeof entry.finishTimeMs === "number"
          ? [{ ...entry, finishTimeMs: entry.finishTimeMs }]
          : []
      ));
      const competitionIndividuals = standingsMode === "best_time"
        ? toPublicBestTimeStandings(deriveLeagueBestTimeStandings(competitionBestTimeEntries))
        : standingsMode === "participation"
          ? toPublicCompetitionStandings(
              deriveLeagueParticipationStandings(competitionEntries),
              [],
              undefined,
              "participation",
            )
          : standingsMode === "none"
            ? []
            : toPublicCompetitionStandings(deriveLeagueStandings(
                competitionEntries,
                competitionRules.pointsTable,
                competitionRules.participationPoints,
                competitionRules.bestN,
                competitionRules.minimumRounds,
                competitionRules.tieBreakMethod,
              ), competitionEntries);
      const classificationStandings = Object.fromEntries(
        competitionClassifications.map((classification) => {
          const eligibleEntries = competitionEntries.filter((entry) =>
            matchesLeagueClassification(entry, classification.eligibility),
          );
          const eligibleBestTimeEntries = competitionBestTimeEntries.filter((entry) =>
            matchesLeagueClassification(entry, classification.eligibility),
          );
          const standings = standingsMode === "best_time"
            ? toPublicBestTimeStandings(deriveLeagueBestTimeStandings(eligibleBestTimeEntries))
            : standingsMode === "participation"
              ? toPublicCompetitionStandings(
                  deriveLeagueParticipationStandings(eligibleEntries),
                  [],
                  classification.eligibility,
                  "participation",
                )
              : standingsMode === "none"
                ? []
                : toPublicCompetitionStandings(deriveLeagueClassificationStandings(
                    competitionEntries,
                    classification.eligibility,
                    competitionRules.pointsTable,
                    competitionRules.participationPoints,
                    competitionRules.bestN,
                    competitionRules.minimumRounds,
                    competitionRules.tieBreakMethod,
                  ), competitionEntries, classification.eligibility);
          return [classification.slug, standings];
        }),
      );
      const competitionClubStandings = standingsMode === "points"
        ? toPublicClubStandings(deriveLeagueCompetitionClubStandings(
            mappedEntries,
            competitionCategoryIds,
            competitionClassifications,
            competitionRules.pointsTable,
            competitionRules.participationPoints,
            competitionRules.clubScoringMode,
          ))
        : [];

      return {
        id: competition.id,
        slug: competition.slug,
        name: competition.name,
        description: competition.description ?? "",
        scoringTarget: competition.scoringTarget === "club" ? "club" : "individual",
        resultBasis,
        standingsMode,
        displayOrder: Number(competition.displayOrder ?? competitionIndex),
        isDefault: competition.isDefault === true,
        classifications: competitionClassifications,
        roundMappings: (competition.roundMappings ?? []).map((mapping) => {
          const mappedEdition = editionById.get(mapping.eventEditionId);
          const mappedCategory = categoryById.get(mapping.eventCategoryId);
          return {
            roundId: mapping.roundId,
            roundNumber: mapping.roundNumber,
            eventEditionId: mapping.eventEditionId,
            eventCategoryId: mapping.eventCategoryId,
            status: mapping.status ?? "scheduled",
            pointsMultiplier: Number(mapping.pointsMultiplier ?? 1),
            eventSlug: mappedEdition?.slug ?? "",
            eventName: mappedEdition?.name ?? `Round ${mapping.roundNumber}`,
            categoryName: mappedCategory?.name ?? "Race",
          };
        }),
        individualStandings: competitionIndividuals,
        classificationStandings,
        clubStandings: competitionClubStandings,
        rules: competitionRules,
      } satisfies PublicLeagueCompetitionReadModel;
    });
    const individualCompetitions = mappedCompetitions.filter(
      (competition) => competition.scoringTarget === "individual",
    );
    const pointsCompetitions = individualCompetitions.filter(
      (competition) => competition.standingsMode === "points",
    );
    const combinedClubStandings = toPublicClubStandings(deriveCombinedLeagueClubStandings(
      mappedEntries,
      pointsCompetitions.map((competition) => ({
        eventCategoryIds: competition.roundMappings.map((mapping) => mapping.eventCategoryId),
        classifications: competition.classifications,
        pointsTable: competition.rules.pointsTable,
        participationPoints: competition.rules.participationPoints,
      })),
      rulesResponse.data?.club_scoring_mode ?? fallback.rules.clubScoringMode,
    )).map((standing) => {
      const participantByIdentity = new Map<string, PublicLeagueClubMemberItem>();
      for (const entry of mappedEntries) {
        const outcome = leagueRoundOutcome(entry.participationStatus);
        if (
          entry.clubSlug !== standing.clubSlug
          || entry.roundStatus !== "completed"
          || !outcome
        ) continue;
        const identity = leagueAthleteIdentity(entry);
        const existing = participantByIdentity.get(identity);
        const roundIndex = Math.max(0, entry.roundNumber - 1);
        const roundScores = existing?.roundScores ?? [];
        const roundPlaces = existing?.roundPlaces ?? [];
        const countedRounds = existing?.countedRounds ?? [];
        const roundStatuses = existing?.roundStatuses ?? [];
        roundScores[roundIndex] = 0;
        roundPlaces[roundIndex] = entry.overall > 0 ? entry.overall : 0;
        countedRounds[roundIndex] = false;
        roundStatuses[roundIndex] = outcome;
        participantByIdentity.set(identity, {
          name: entry.name,
          athleteSlug: entry.athleteSlug,
          avatarUrl: avatarUrlByAthleteSlug.get(entry.athleteSlug) ?? null,
          points: 0,
          countedPoints: 0,
          wins: 0,
          podiums: 0,
          roundScores,
          roundPlaces,
          countedRounds,
          roundStatuses,
        });
      }
      const memberRows = mergeLeagueClubFinishersWithParticipants(
        standing.memberRows,
        Array.from(participantByIdentity.values()),
      );
      return {
        ...standing,
        members: memberRows.length,
        memberRows,
      };
    });
    const classificationsByCategoryId = new Map<string, PublicLeagueClassificationDefinition[]>();
    for (const competition of mappedCompetitions) {
      for (const mapping of competition.roundMappings) {
        classificationsByCategoryId.set(mapping.eventCategoryId, competition.classifications);
      }
    }
    for (const entry of mappedEntries) {
      entry.leagueCategoryLabels = resolveLeagueCategoryLabels(
        entry,
        classificationsByCategoryId.get(entry.eventCategoryId) ?? [],
        entry.ageCategory,
      );
    }
    const categoryLabelsByAthlete = new Map<string, string[]>();
    for (const entry of mappedEntries) {
      const key = leagueAthleteIdentity({
        athleteSlug: entry.athleteSlug,
        name: entry.name,
        gender: entry.gender,
      });
      categoryLabelsByAthlete.set(
        key,
        Array.from(new Set([
          ...(categoryLabelsByAthlete.get(key) ?? []),
          ...(entry.leagueCategoryLabels ?? []),
        ])),
      );
    }
    for (const standing of mappedIndividuals) {
      standing.leagueCategoryLabels = categoryLabelsByAthlete.get(leagueAthleteIdentity({
        athleteSlug: standing.athleteSlug,
        name: standing.name,
        gender: standing.gender,
      }))
        ?? resolveLeagueCategoryLabels(standing, [], standing.ageCategory);
    }
    const primaryCompetition = resolveDefaultLeagueCompetition(
      individualCompetitions,
    ) ?? resolveDefaultLeagueCompetition(mappedCompetitions);
    const publicIndividuals = primaryCompetition
      ? primaryCompetition.individualStandings
      : mappedIndividuals;
    const publicClubs = primaryCompetition?.standingsMode !== "points"
      ? []
      : clubScoringScope === "combined"
        // Legacy snapshots do not encode the current competition/classification
        // rules. Keep totals, ranks and counted members from the same combined
        // calculation, including when it is empty (disabled/no scoring results).
        ? combinedClubStandings
        : (primaryCompetition?.clubStandings.length ? primaryCompetition.clubStandings : persistedClubs);
    const publicRankByAthleteIdentity = new Map(
      publicIndividuals
        .filter((standing) => standing.eligible !== false)
        .map((standing) => [leagueAthleteIdentity(standing), standing.rank]),
    );
    for (const entry of mappedEntries) {
      entry.leagueRank = publicRankByAthleteIdentity.get(leagueAthleteIdentity(entry)) ?? null;
    }

    const totalRegistrations = mappedRounds.reduce((sum, round) => sum + round.participants, 0);
    const totalFinishers = mappedRounds.reduce((sum, round) => sum + round.finishers, 0);
    const completedRounds = mappedRounds.filter((round) => round.status === "completed").length;
    const publishedRounds = mappedRounds.filter((round) => round.hasPublishedResults || round.hasPartialPublishedResults).length;
    const clubsRepresented = new Set(
      mappedEntries
        .map((entry) => {
          const clubName = normalizePublicResultClubName(entry.club);
          return clubName ? entry.clubSlug ?? clubName : null;
        })
        .filter((value): value is string => Boolean(value)),
    ).size;
    const nextStage = [...scheduledRounds]
      .filter((round) => round.status !== "completed")
      .sort((left, right) => {
        if (left.dateIso && right.dateIso) {
          return left.dateIso.localeCompare(right.dateIso);
        }
        if (left.dateIso) return -1;
        if (right.dateIso) return 1;
        return left.roundNumber - right.roundNumber;
      })[0];

    const publicDescription = sanitizePublicLeagueDescription(league.description);
    return applySibenikDetailDefaults({
      slug: league.slug,
      name: league.name,
      sportCodes: detailSportSelection.sportCodes,
      primarySportCode: detailSportSelection.primarySportCode,
      description: publicDescription,
      organizerRules: typeof season.organizer_rules === "string" && season.organizer_rules.trim()
        ? season.organizer_rules.trim()
        : null,
      imageUrl: resolveLeagueImageUrl(league.description),
      organizer,
      status: deriveLeagueSeasonStatus(scheduledRounds.map((round) => round.status), season.status ?? league.status),
      seasonLabel: buildLeagueSeasonDateRange(scheduledRounds, scheduledRounds.length),
      athleteCount: new Set(mappedEntries.map((entry) => leagueAthleteIdentity(entry))).size || mappedIndividuals.length,
      clubCount: clubsRepresented || publicClubs.length,
      summary: {
        totalRegistrations,
        totalFinishers,
        completedRounds,
        publishedRounds,
        clubsRepresented,
        nextStageLabel: nextStage?.stageLabel ?? null,
      },
      rounds: scheduledRounds,
      entries: mappedEntries,
      competitions: mappedCompetitions,
      clubScoringScope,
      individualStandings: publicIndividuals,
      clubStandings: publicClubs,
      rules: {
        pointsTable: resolvedPointsTable,
        fieldSizeProfile: rulesExtensionResponse.data?.field_size_profile ?? "custom",
        participationPoints,
        bestN,
        minimumRounds: rulesResponse.data?.minimum_rounds ?? fallback.rules.minimumRounds,
        tieBreakMethod: rulesResponse.data?.tie_break_method ?? fallback.rules.tieBreakMethod,
        clubScoringMode: rulesResponse.data?.club_scoring_mode ?? fallback.rules.clubScoringMode,
      },
    });
  } catch (error) {
    console.warn("Unable to load public league detail", error);
    throw error instanceof Error ? error : new Error("Unable to load league detail");
  }
}

export async function getPublicRankings(): Promise<PublicRankingItem[]> {
  const supabase = getSupabasePublicClient();
  if (!supabase) return emptyPublicRankings;

  try {
    const athletes = await collectPaginatedRows({
      loadPage: async (from, to) => {
        const { data, error } = await supabase
          .from("public_athlete_profiles")
          .select("id,slug,display_name,gender,country_code")
          .eq("status", "active")
          .order("display_name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);

        if (error) throw error;
        return data ?? [];
      },
    });

    if (!athletes.length) {
      return emptyPublicRankings;
    }

    const athleteIds = athletes.map((athlete) => athlete.id);
    const athleteIdBatches = chunkRankingSourceIds(athleteIds);
    const [membershipResponses, resultRows, athleteMetadata] = await Promise.all([
      Promise.all(
        athleteIdBatches.map((batch) =>
          supabase
            .from("club_memberships")
            .select("athlete_profile_id,club_id,is_primary,membership_origin,joined_at")
            .in("athlete_profile_id", batch)
            .eq("status", "active")
            .order("is_primary", { ascending: false }),
        ),
      ),
      getCurrentPublishedResultRows({ athleteProfileIds: athleteIds }),
      getPublicAthleteMetadata().catch((error): PublicAthleteMetadata[] => {
        console.warn("Unable to load public ranking metadata", error);
        return [];
      }),
    ]);

    const relatedQueryError = membershipResponses.find((response) => response.error)?.error;
    if (relatedQueryError) throw relatedQueryError;

    const memberships = membershipResponses.flatMap((response) => response.data ?? []);
    const clubIds = Array.from(new Set(memberships.map((membership) => membership.club_id)));
    const categoryIds = Array.from(new Set(resultRows.map((row) => row.eventCategoryId)));

    const [clubsResponse, categoriesResponse] = await Promise.all([
      clubIds.length ? supabase.from("clubs").select("id,name").in("id", clubIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      categoryIds.length
        ? supabase.from("event_categories").select("id,distance_km").in("id", categoryIds)
        : Promise.resolve({ data: [] as Array<{ id: string; distance_km: number | null }> }),
    ]);

    const primaryClubByAthlete = selectPrimaryClubByAthlete(memberships);
    const ageCategoryByAthlete = new Map(
      athleteMetadata.map((metadata) => [metadata.athleteProfileId, metadata.ageCategoryLabel]),
    );
    const avatarUrlByAthlete = new Map<string, string | null>(
      athleteMetadata.map((metadata): [string, string | null] => [
        metadata.athleteProfileId,
        metadata.avatarUrl,
      ]),
    );

    const clubById = new Map((clubsResponse.data ?? []).map((club) => [club.id, club.name]));
    const categoryById = new Map((categoriesResponse.data ?? []).map((category) => [category.id, Number(category.distance_km ?? 0)]));
    const aggregateByAthlete = aggregatePublicRankingPerformance({
      resultRows: resultRows.map((row) => ({
        athleteProfileId: row.athleteProfileId,
        eventCategoryId: row.eventCategoryId,
        resultRunId: row.resultRunId,
        resultStatus: row.resultStatus,
        finishTimeMs: row.finishTimeMs,
      })),
      publications: resultRows.map((row) => ({
        id: row.publicationId,
        eventCategoryId: row.eventCategoryId,
        resultRunId: row.resultRunId,
        publicationState: row.publicationState,
        publishedAt: row.publishedAt,
        createdAt: row.publishedAt,
      })),
      distanceKmByCategoryId: categoryById,
    });

    const mapped = athletes
      .map((athlete) => {
        const aggregate = aggregateByAthlete.get(athlete.id) ?? {
          races: 0,
          totalDistanceKm: 0,
          totalTimeMs: 0,
          maxDistance: 0,
        };
        return {
          rank: 0,
          name: athlete.display_name,
          athleteSlug: athlete.slug,
          avatarUrl: avatarUrlByAthlete.get(athlete.id) ?? null,
          avatarInitials: rankingInitials(athlete.display_name),
          club: primaryClubByAthlete.get(athlete.id) ? clubById.get(primaryClubByAthlete.get(athlete.id)!) ?? "" : "",
          region: countryLabel(athlete.country_code),
          races: aggregate.races,
          gender: normalizeGender(athlete.gender),
          age: ageCategoryByAthlete.get(athlete.id) ?? "",
          totalDistanceKm: aggregate.totalDistanceKm,
          totalTimeMs: aggregate.totalTimeMs,
          distanceBand: distanceBandLabel(aggregate.maxDistance),
        } satisfies PublicRankingItem;
      })
      .filter((athlete) => athlete.races > 0)
      .sort((left, right) =>
        right.totalDistanceKm - left.totalDistanceKm
        || right.races - left.races
        || right.totalTimeMs - left.totalTimeMs
        || left.name.localeCompare(right.name),
      )
      .map((athlete, index) => ({ ...athlete, rank: index + 1 }));

    return mapped.length ? mapped : emptyPublicRankings;
  } catch (error) {
    console.warn("Unable to load public rankings", error);
    return emptyPublicRankings;
  }
}
