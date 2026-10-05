import { raceFeeAt, type RaceFeePeriod } from "@raceson/domain/categories";
import { loadPublicEventPreviewMedia, loadPublicEventPreviewMediaBySlug } from "@/features/events/public/data/publicEventPreviewMedia";
import { format } from "date-fns";
import {
  getLegacyBadgeVisualSpec,
  type BadgeState,
  type BadgeUiStatus,
  type BadgeVisualSpec,
} from "@/lib/badge-system";
import { getSupabaseBrowserClient, getSupabasePublicClient } from "@/lib/supabase";
import {
  ageOnRaceDay,
  ageGroupLabelForConfig,
  defaultCompetitiveRankingConfig,
  normalizeCompetitiveRankingConfig,
  normalizeRankingGender,
  type CompetitiveRankingConfig,
  type CompetitiveTeamStanding,
} from "@/lib/ranking-config";
import { getPublicRegistrationCountsByCategoryId } from "@/lib/public-registration-counts";
import { getCurrentPublishedResultRows } from "@/lib/current-published-results";
import { resolvePublicLocationLabel } from "@/lib/public-location-labels";
import { apiRequest } from "@/lib/api";
import { getHomepageFeaturedRaces } from "@/features/homepage/data/homepageFeaturedRaces";
import { formatEventDistanceKm, formatEventEntryFees } from "@/features/events/public/model/eventInfoPresentation";
import { eventHasFinished } from "@/features/events/model/eventCompletion";
import {
  getHomepageLatestResults,
  type HomepageResultItem,
} from "@/features/homepage/data/homepageLatestResults";
import { getPublicPlatformSummary } from "@/features/homepage/data/publicPlatformSummary";
import { selectHomepageRaceCards } from "@/features/homepage/model/homepageRaceCards";
import {
  normalizeAthleteResultOutcome,
  summarizeAthletePerformance,
  type AthleteResultOutcome,
} from "@/features/athletes/model/athletePerformance";
import { formatUniversalAgeCategoryLabel } from "@/shared/domain/competitiveClassification";
import {
  getTrackDifficultyLabel,
  resolveTrackDifficultyLevel,
  type TrackDifficultyLevel,
} from "@/features/tracks/model/trackDifficulty";
import { resolveTrackCatalogCoordinates } from "@/features/tracks/public/model/trackCatalogView";
import {
  loadPublishedTrackRaceRecordsByTemplate,
  type PublishedTrackRaceRecords,
} from "@/features/tracks/public/data/trackRaceRecords";
import {
  formatTrackRecordDuration,
  mergeTrackRecordCandidates,
  resolveTrackRecordOccurredAt,
} from "@/features/tracks/public/model/trackRecords";
import { normalizePublicResultClubName } from "@/features/results/public/model/publicResultPresentation";
import { resolveTrackPreviewImage } from "@/shared/media/eventPreviewImage";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";
import { loadPublicEventLeagueMembershipsByEdition } from "@/features/events/public/data/eventLeagueMemberships";
import { loadDedupedPublicEventParticipants } from "@/features/events/public/data/publicParticipantRequestCache";
import type { EventLeagueMembership } from "@/features/events/public/model/eventLeagueMembership";
import {
  normalizeEventActivityType,
  type EventActivityType,
} from "@raceson/domain/activities";
import {
  DEFAULT_SPORT_CODE,
  normalizeSportSelection,
  type SportCode,
} from "@raceson/domain/sports";

export type EventCardStatus = "open" | "closed" | "live" | "upcoming" | "finished" | "sold_out";
export type EventArchiveBadge = "Results" | "Recap" | "Photos";


export type PortalEventCatalogItem = {
  id: string;
  editionId?: string;
  title: string;
  activityType?: EventActivityType;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  date: string;
  startDateIso?: string | null;
  location: string;
  distance: string;
  elevation: string;
  status: EventCardStatus;
  participants: number;
  clubs?: number;
  price: string;
  countryCode?: string | null;
  organizer: string;
  lat: number;
  lng: number;
  tags: string[];
  leagueMemberships?: EventLeagueMembership[];
  archiveBadges?: EventArchiveBadge[];
  coverImageUrl?: string | null;
  linkedTrackSlug?: string | null;
  linkedTrackName?: string | null;
  linkedTrackImageUrl?: string | null;
  linkedTrackVersionId?: string | null;
  trackPoints?: [number, number][];
  elevationPoints?: Array<{
    distKm: number;
    elev: number;
    grade: number;
    lat: number;
    lng: number;
  }>;
};

export type PortalTrackCatalogRecord = {
  time: string;
  athleteName: string;
  date: string;
};

export type PortalTrackCatalogItem = {
  id: string;
  name: string;
  sportCode: SportCode;
  organizer: string;
  imageUrl: string | null;
  location: string;
  distance: number;
  elevation: number;
  difficulty: string;
  difficultyLevel: TrackDifficultyLevel;
  surface: string;
  rating: number;
  reviewCount: number;
  attempts: number;
  season: string;
  lat: number;
  lng: number;
  linkedEvent: string | null;
  tags: string[];
  record: PortalTrackCatalogRecord | null;
};

function formatCatalogTrackRecordDate(value: string | null) {
  if (!value) return "TBA";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? "TBA" : format(parsed, "MMM d, yyyy");
}

export function getTrackCatalogImageUrl(value: unknown, linkedEventImageUrl?: string | null) {
  return resolveTrackPreviewImage(value, linkedEventImageUrl);
}

export { loadPublicEventPreviewMediaBySlug, type EventPreviewMedia } from "@/features/events/public/data/publicEventPreviewMedia";

export type { HomepageResultItem } from "@/features/homepage/data/homepageLatestResults";

export type HomepageReadModel = {
  stats: {
    events: number;
    tracks: number;
    leagues: number;
    athletes: number;
    registrations: number;
    clubs: number;
    completedDistanceKm: number;
    finishes: number;
    countries: number;
  };
  upcomingEvents: PortalEventCatalogItem[];
  latestResults: HomepageResultItem[];
};

export type AthleteResultItem = {
  id: string;
  eventSlug: string;
  event: string;
  eventImageUrl: string | null;
  category: string;
  distanceKm: number | null;
  elevationGainM?: number | null;
  date: string;
  place: number;
  totalRunners: number;
  time: string;
  pace: string;
  status: AthleteResultOutcome;
  splits: string[];
};

export type AthleteResultsReadModel = {
  seasonStats: {
    totalParticipations: number;
    totalRaces: number;
    totalFinishes: number;
    podiums: number;
    wins: number;
    avgFinish: string;
  };
  results: AthleteResultItem[];
};

type PublicAthleteResultHistoryRow = {
  resultRowId: string;
  eventCategoryId: string;
  eventSlug: string;
  eventName: string;
  categoryName: string;
  distanceKm: number | null;
  elevationGainM: number | null;
  eventDate: string | null;
  finishTimeMs: number | null;
  rankOverall: number | null;
  totalFinishers: number;
  outcomeLabel: string;
  splits: Array<{
    elapsedTimeMs: number | null;
    sequenceNumber: number;
  }>;
};

export type BadgeTier = "gold" | "silver" | "bronze" | "default";

export type AthleteBadgeItem = {
  id: string;
  name: string;
  description: string;
  iconKey: string;
  tier: BadgeTier;
  status?: BadgeUiStatus;
  state?: BadgeState;
  visual?: BadgeVisualSpec;
  earnedDate?: string;
  progress?: number;
};

export type AthleteBadgesReadModel = {
  earned: AthleteBadgeItem[];
  inProgress: AthleteBadgeItem[];
};

export type PublicResultsCategory = {
  id: string;
  label: string;
  rankingConfig: CompetitiveRankingConfig;
};

export type PublicResultSplit = {
  checkpointId: string;
  checkpointName: string;
  checkpointType: string;
  sequenceNumber: number;
  recordedAt: string | null;
  elapsedTimeMs: number | null;
  splitTimeMs: number | null;
  elapsedLabel: string;
  splitLabel: string;
};

export type PublicResultsRow = {
  resultRowId?: string;
  registrationId?: string;
  bib: string;
  name: string;
  athleteSlug: string;
  countryCode?: string | null;
  club: string;
  time: string;
  finishTimeMs?: number | null;
  gapMs?: number | null;
  splits: string[];
  splitDetails?: PublicResultSplit[];
  status: "finished" | "started" | "dns" | "dnf" | "dsq";
  gender: string;
  ageOnEventDate?: number | null;
  ageGroupLabel: string | null;
  genderRank: number;
  ageRank: number;
  overall: number;
};

export type PublicResultStandingClassification = {
  id: string;
  label: string;
  gender: "F" | "M" | null;
  minimumAge: number | null;
  maximumAge: number | null;
};

type PublicEventParticipantAgeRpcRow = {
  registration_id: string;
  athlete_profile_id: string;
  event_category_id: string;
  bib_number: string | null;
  athlete_slug: string | null;
  athlete_name: string | null;
  club_slug: string | null;
  club_name: string | null;
  gender: string | null;
  age_category_label: string | null;
  participation_status: string | null;
  result_status: string | null;
  publication_state: string | null;
  published_at: string | null;
  finish_time_ms: number | null;
  rank_overall: number | null;
  rank_gender: number | null;
  rank_age_category: number | null;
};

type PublicEventResultSplitRpcRow = {
  registration_id: string;
  event_category_id: string;
  checkpoint_id: string;
  checkpoint_name: string;
  checkpoint_type: string;
  sequence_number: number;
  recorded_at: string | null;
  elapsed_time_ms: number | null;
  split_time_ms: number | null;
};

export type PublicResultsPageReadModel = {
  eventSlug: string;
  eventName: string;
  publicationState: string;
  categories: PublicResultsCategory[];
  rowsByCategory: Record<string, PublicResultsRow[]>;
  teamStandingsByCategory: Record<string, CompetitiveTeamStanding[]>;
};

export type PublicEventResultsCategory = {
  id: string;
  label: string;
  rankingConfig: CompetitiveRankingConfig;
  standingClassifications: PublicResultStandingClassification[];
  distanceKm?: number | null;
  publicationState: string | null;
  publishedAt: string | null;
  rows: PublicResultsRow[];
  teamStandings: CompetitiveTeamStanding[];
};

export type PublicEventResultsReadModel = {
  eventSlug: string;
  eventName: string;
  hasPublishedResults: boolean;
  categories: PublicEventResultsCategory[];
};

export type PublicLiveEditionReadModel = {
  eventEditionId: string;
  eventName: string;
  eventSlug: string;
  timezone: string;
  status: string;
  generatedAt: string;
  categories: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    plannedStartAt: string | null;
    effectiveStartAt: string | null;
    visibleThrough: string;
    delaySeconds: number;
    isSuppressed: boolean;
    suppressionMessage: string | null;
    participantCounts: {
      started: number;
      onCourse: number;
      finished: number;
      withdrawn: number;
    } | null;
    checkpointProgress: Array<{
      id: string;
      name: string;
      code: string;
      type: string;
      sequenceNumber: number;
      observedCount: number;
      lastObservationAt: string | null;
    }>;
    lastObservationAt: string | null;
  }>;
};

export type PublicEventParticipantRow = {
  registrationId: string;
  athleteId: string;
  categoryId: string;
  categorySlug: string;
  categoryLabel: string;
  bib: string;
  name: string;
  athleteSlug: string;
  countryCode?: string | null;
  club: string;
  clubSlug: string | null;
  gender: string;
  classificationLabel: string;
  ageCategory: string;
  registrationStatus: string;
  participationStatus: string;
  resultStatus: string;
  publicationState: string | null;
  publishedAt: string | null;
  time: string;
  finishTimeMs: number | null;
  overall: number;
  genderRank: number;
  ageRank: number;
};

export type PublicEventParticipantsReadModel = {
  eventSlug: string;
  eventName: string;
  hasPublishedResults: boolean;
  rows: PublicEventParticipantRow[];
};

export type PublicResultsDirectoryRaceStatus =
  | "official"
  | "provisional"
  | "live"
  | "published"
  | "pending"
  | "pre_race";

export type PublicResultsDirectoryRace = {
  id: string;
  slug: string;
  label: string;
  distanceLabel: string | null;
  resultsStatus: PublicResultsDirectoryRaceStatus;
  resultsStatusLabel: string;
  hasPublishedResults: boolean;
  publishedAt: string | null;
};

export type PublicResultsDirectoryEvent = {
  editionId: string;
  eventSlug: string;
  eventName: string;
  date: string;
  startDateIso: string | null;
  timeZone: string;
  coverImageUrl?: string | null;
  linkedTrackImageUrl?: string | null;
  location: string;
  lat: number;
  lng: number;
  organizer: string;
  status: EventCardStatus;
  raceCount: number;
  publishedRaceCount: number;
  registeredRunnerCount: number;
  finisherCount: number;
  races: PublicResultsDirectoryRace[];
};

export type PublicResultsDirectoryReadModel = {
  events: PublicResultsDirectoryEvent[];
};

const eventCoordsBySlug: Record<string, { lat: number; lng: number; tags: string[]; location?: string }> = {
  "velebit-ultra-2026": { lat: 44.12, lng: 15.23, tags: ["race", "ultra", "mountain", "karst"], location: "Zadar, Croatia" },
  "velebit-ultra-2025": { lat: 44.12, lng: 15.23, tags: ["race", "ultra", "mountain", "karst"], location: "Zadar, Croatia" },
};

function attachBadgeVisual(badge: AthleteBadgeItem): AthleteBadgeItem {
  const visual =
    badge.visual ??
    getLegacyBadgeVisualSpec({
      id: badge.id,
      name: badge.name,
      iconKey: badge.iconKey,
      tier: badge.tier,
    });

  return {
    ...badge,
    status:
      badge.status ??
      (badge.earnedDate
        ? "earned"
        : typeof badge.progress === "number"
          ? "in-progress"
          : "earned"),
    state: badge.state ?? visual.state,
    visual,
  };
}

const trackMetaBySlug: Record<
  string,
  { lat: number; lng: number; season: string; tags: string[]; location?: string }
> = {
  "velebit-ultra-42k": {
    lat: 44.12,
    lng: 15.23,
    season: "Mar-Nov",
    tags: ["race", "ultra", "mountain", "karst", "long", "fkt-eligible"],
    location: "Zadar, Croatia",
  },
};

const fallbackAthleteBadgesReadModel: AthleteBadgesReadModel = {
  earned: ([
    {
      id: "ultra-finisher",
      name: "Ultra Finisher",
      description: "Complete an ultra-distance race (42K+)",
      iconKey: "mountain",
      tier: "gold",
      earnedDate: "Apr 14, 2025",
    },
    {
      id: "season-leader",
      name: "Season Leader",
      description: "Hold #1 in league standings for 30+ days",
      iconKey: "trophy",
      tier: "gold",
      earnedDate: "Jun 2, 2025",
    },
    {
      id: "night-runner",
      name: "Night Runner",
      description: "Finish a night-time race",
      iconKey: "moon",
      tier: "silver",
      earnedDate: "Jan 15, 2025",
    },
    {
      id: "podium-regular",
      name: "Podium Regular",
      description: "Earn 3 podium finishes in one season",
      iconKey: "award",
      tier: "gold",
      earnedDate: "Mar 1, 2026",
    },
    {
      id: "iron-legs",
      name: "Iron Legs",
      description: "Accumulate 500km of race distance",
      iconKey: "flame",
      tier: "silver",
      earnedDate: "Oct 18, 2025",
    },
    {
      id: "speed-demon",
      name: "Speed Demon",
      description: "Finish with pace under 5:00/km in a trail race",
      iconKey: "zap",
      tier: "bronze",
      earnedDate: "Feb 8, 2026",
    },
  ] satisfies AthleteBadgeItem[]).map(attachBadgeVisual),
  inProgress: ([
    {
      id: "race-veteran",
      name: "Race Veteran",
      description: "Complete 25 races on the platform",
      iconKey: "shield",
      tier: "default",
      progress: 68,
    },
    {
      id: "mountain-goat",
      name: "Mountain Goat",
      description: "Accumulate 25,000m of elevation gain",
      iconKey: "target",
      tier: "default",
      progress: 42,
    },
    {
      id: "streak-master",
      name: "Streak Master",
      description: "Race in 6 consecutive months",
      iconKey: "star",
      tier: "default",
      progress: 83,
    },
    {
      id: "legend",
      name: "Legend",
      description: "Win 10 races on the platform",
      iconKey: "star",
      tier: "default",
      progress: 20,
    },
  ] satisfies AthleteBadgeItem[]).map(attachBadgeVisual),
};

const fallbackPublicResultsReadModel: PublicResultsPageReadModel = {
  eventSlug: "velebit-ultra-2026",
  eventName: "Velebit Ultra Trail 2026",
  publicationState: "official",
  categories: [
    { id: "ultra-42k", label: "Ultra 42K", rankingConfig: defaultCompetitiveRankingConfig() },
    { id: "marathon-21k", label: "Marathon 21K", rankingConfig: defaultCompetitiveRankingConfig() },
    { id: "short-10k", label: "Short 10K", rankingConfig: defaultCompetitiveRankingConfig() },
    { id: "kids-run-2k", label: "Kids Run 2K", rankingConfig: defaultCompetitiveRankingConfig() },
  ],
  rowsByCategory: {
    "ultra-42k": [
      { bib: "101", name: "Marko Juric", athleteSlug: "marko-juric", club: "PD Velebit", time: "4:55:12", splits: ["1:08:22", "2:18:45", "3:42:10", "4:55:12"], status: "finished", gender: "M", ageGroupLabel: "18-65", genderRank: 1, ageRank: 1, overall: 1 },
      { bib: "205", name: "Ivan Horvat", athleteSlug: "ivan-horvat", club: "AK Slavonija", time: "5:12:45", splits: ["1:12:10", "2:28:33", "3:55:20", "5:12:45"], status: "finished", gender: "M", ageGroupLabel: "18-65", genderRank: 2, ageRank: 2, overall: 2 },
      { bib: "112", name: "Ana Kovac", athleteSlug: "ana-kovac", club: "TK Zagreb", time: "5:28:33", splits: ["1:15:40", "2:35:12", "4:08:55", "5:28:33"], status: "finished", gender: "F", ageGroupLabel: "18-65", genderRank: 1, ageRank: 3, overall: 3 },
    ],
    "marathon-21k": [],
    "short-10k": [],
    "kids-run-2k": [],
  },
  teamStandingsByCategory: {
    "ultra-42k": [],
    "marathon-21k": [],
    "short-10k": [],
    "kids-run-2k": [],
  },
};

const fallbackPublicResultsDirectoryReadModel: PublicResultsDirectoryReadModel = {
  events: [
    {
      editionId: "velebit-ultra-2026",
      eventSlug: "velebit-ultra-2026",
      eventName: "Velebit Ultra Trail 2026",
      date: "Apr 12, 2026",
      startDateIso: "2026-04-12",
      timeZone: "Europe/Zagreb",
      location: "Zadar, Croatia",
      lat: 44.12,
      lng: 15.23,
      organizer: "PD Velebit",
      status: "upcoming",
      raceCount: 4,
      publishedRaceCount: 0,
      registeredRunnerCount: 312,
      finisherCount: 0,
      races: [
        { id: "ultra-42k", slug: "ultra-42k", label: "Ultra 42K", distanceLabel: "42 km", resultsStatus: "pre_race", resultsStatusLabel: "Pre-race", hasPublishedResults: false, publishedAt: null },
        { id: "marathon-21k", slug: "marathon-21k", label: "Marathon 21K", distanceLabel: "21 km", resultsStatus: "pre_race", resultsStatusLabel: "Pre-race", hasPublishedResults: false, publishedAt: null },
        { id: "short-10k", slug: "short-10k", label: "Short 10K", distanceLabel: "10 km", resultsStatus: "pre_race", resultsStatusLabel: "Pre-race", hasPublishedResults: false, publishedAt: null },
        { id: "kids-run-2k", slug: "kids-run-2k", label: "Kids Run 2K", distanceLabel: "2 km", resultsStatus: "pre_race", resultsStatusLabel: "Pre-race", hasPublishedResults: false, publishedAt: null },
      ],
    },
    {
      editionId: "vrpolje-trail-2026",
      eventSlug: "vrpolje-trail-2026",
      eventName: "Vrpolje Trail 2026",
      date: "Mar 29, 2026",
      startDateIso: "2026-03-29",
      timeZone: "Europe/Zagreb",
      location: "Vrpolje, Sibenik",
      lat: 43.95,
      lng: 15.43,
      organizer: "Vrpolje Trail",
      status: "finished",
      raceCount: 2,
      publishedRaceCount: 1,
      registeredRunnerCount: 168,
      finisherCount: 121,
      races: [
        { id: "vrpolje-velika", slug: "vrpolje-velika", label: "Vrpolje velika", distanceLabel: "14.9 km", resultsStatus: "official", resultsStatusLabel: "Official", hasPublishedResults: true, publishedAt: "2026-03-29T15:30:00Z" },
        { id: "vrpolje-trail-mala-ruta", slug: "vrpolje-trail-mala-ruta", label: "Vrpolje 5km", distanceLabel: "5.4 km", resultsStatus: "pending", resultsStatusLabel: "Pending", hasPublishedResults: false, publishedAt: null },
      ],
    },
    {
      editionId: "ucka-trail-2026",
      eventSlug: "ucka-trail-2026",
      eventName: "Učka Trail 2026",
      date: "Mar 8, 2026",
      startDateIso: "2026-03-08",
      timeZone: "Europe/Zagreb",
      location: "Opatija, Croatia",
      lat: 45.34,
      lng: 14.3,
      organizer: "TK Učka",
      status: "finished",
      raceCount: 2,
      publishedRaceCount: 2,
      registeredRunnerCount: 246,
      finisherCount: 231,
      races: [
        { id: "ucka-35k", slug: "ucka-35k", label: "35K", distanceLabel: "35 km", resultsStatus: "official", resultsStatusLabel: "Official", hasPublishedResults: true, publishedAt: "2026-03-08T14:10:00Z" },
        { id: "ucka-15k", slug: "ucka-15k", label: "15K", distanceLabel: "15 km", resultsStatus: "official", resultsStatusLabel: "Official", hasPublishedResults: true, publishedAt: "2026-03-08T13:25:00Z" },
      ],
    },
    {
      editionId: "papuk-ultra",
      eventSlug: "papuk-ultra",
      eventName: "Papuk Ultra 50",
      date: "Feb 22, 2026",
      startDateIso: "2026-02-22",
      timeZone: "Europe/Zagreb",
      location: "Velika, Croatia",
      lat: 45.52,
      lng: 17.68,
      organizer: "AK Slavonija",
      status: "finished",
      raceCount: 1,
      publishedRaceCount: 1,
      registeredRunnerCount: 124,
      finisherCount: 103,
      races: [
        { id: "papuk-ultra-50", slug: "papuk-ultra-50", label: "Ultra 50", distanceLabel: "50 km", resultsStatus: "official", resultsStatusLabel: "Official", hasPublishedResults: true, publishedAt: "2026-02-22T16:05:00Z" },
      ],
    },
  ],
};

const emptyAthleteBadgesReadModel: AthleteBadgesReadModel = {
  earned: [],
  inProgress: [],
};

const emptyPublicResultsReadModel: PublicResultsPageReadModel = {
  eventSlug: "",
  eventName: "",
  publicationState: "pending",
  categories: [],
  rowsByCategory: {},
  teamStandingsByCategory: {},
};

const emptyPublicResultsDirectoryReadModel: PublicResultsDirectoryReadModel = {
  events: [],
};

function formatDistance(distanceKm: number | null | undefined) {
  if (distanceKm == null) return "TBA";
  return `${formatEventDistanceKm(distanceKm)} km`;
}

function formatElevation(elevationGain: number | null | undefined) {
  if (elevationGain == null) return "TBA";
  return `${elevationGain.toLocaleString()}m D+`;
}

function formatElapsedTimeFromMs(milliseconds: number | null | undefined) {
  if (milliseconds == null || milliseconds <= 0) return "TBA";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPace(distanceKm: number | null | undefined, finishTimeMs: number | null | undefined) {
  if (!distanceKm || !finishTimeMs) return "TBA";
  const totalMinutes = finishTimeMs / 60000;
  const minutesPerKm = totalMinutes / distanceKm;
  const minutes = Math.floor(minutesPerKm);
  const seconds = Math.round((minutesPerKm - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}/km`;
}

function mapPublicResultStatus(
  participationStatus: string | null | undefined,
  resultStatus: string | null | undefined,
  finishTimeMs: number | null | undefined,
): PublicResultsRow["status"] {
  if (resultStatus === "void" || participationStatus === "dsq") return "dsq";
  if (finishTimeMs != null && finishTimeMs > 0) return "finished";
  if (["dnf", "withdrawn", "stopped", "evacuated", "missing"].includes(participationStatus ?? "")) {
    return "dnf";
  }
  if (participationStatus === "started") return "started";
  return "dns";
}

export function formatEventCardStatus(
  status: string | null | undefined,
  startDate: string | null | undefined,
  _registrationOpenAt?: string | null,
  _registrationCloseAt?: string | null,
  now = new Date(),
  evidence: {
    endDate?: string | null;
    hasPublishedResults?: boolean;
    timeZone?: string | null;
  } = {},
): EventCardStatus {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "in_progress" || normalized === "live") return "live";
  if (eventHasFinished({ status, startDate, ...evidence }, now)) return "finished";
  if (normalized.includes("sold")) return "sold_out";
  if (normalized.includes("closed")) return "closed";
  if (normalized.includes("open")) return "open";

  return normalized === "draft" ? "upcoming" : "open";
}

export function normalizeResultsDirectoryRaceStatus(
  publicationState: string | null | undefined,
  eventStatus: EventCardStatus,
  categoryStatus?: string | null,
): PublicResultsDirectoryRaceStatus {
  const normalized = (publicationState ?? "").toLowerCase();
  if (normalized.includes("official") || normalized.includes("corrected")) return "official";
  if (normalized.includes("provisional")) return "provisional";
  if (normalized.includes("live")) return "live";
  if (normalized.includes("publish")) return "published";
  const normalizedCategoryStatus = (categoryStatus ?? "").trim().toLowerCase();
  if (normalizedCategoryStatus === "in_progress") return "live";
  if (normalizedCategoryStatus === "completed") return "pending";
  if (eventStatus === "finished") return "pending";
  return "pre_race";
}

function formatResultsDirectoryRaceStatusLabel(status: PublicResultsDirectoryRaceStatus) {
  if (status === "official") return "Final";
  if (status === "provisional") return "Unofficial";
  if (status === "live") return "Live";
  if (status === "published") return "Final";
  if (status === "pending") return "Pending";
  return "Pre-race";
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function mapPolylinePoint(point: unknown): [number, number] | null {
  if (!point || typeof point !== "object") return null;
  const lat = numberFromUnknown((point as { lat?: unknown }).lat);
  const lng = numberFromUnknown((point as { lng?: unknown }).lng);
  if (lat == null || lng == null) return null;
  return [lat, lng];
}

function mapElevationPoint(
  point: unknown,
  index: number,
  routePoints: [number, number][],
) {
  if (!point || typeof point !== "object") return null;
  const distKm = numberFromUnknown((point as { km?: unknown; distKm?: unknown }).km ?? (point as { distKm?: unknown }).distKm);
  const elev = numberFromUnknown((point as { elev?: unknown }).elev);
  const grade = numberFromUnknown((point as { grade?: unknown }).grade) ?? 0;
  const routePoint = routePoints[Math.min(index, routePoints.length - 1)];
  if (!routePoint || distKm == null || elev == null) return null;
  return {
    distKm,
    elev,
    grade,
    lat: routePoint[0],
    lng: routePoint[1],
  };
}

function dedupeArchiveBadges(values: EventArchiveBadge[]) {
  return Array.from(new Set(values));
}

function buildArchiveBadges(options: {
  hasPublishedResults: boolean;
  documentSignals: Array<{ documentType: string | null; title: string | null }>;
}): EventArchiveBadge[] {
  const badges: EventArchiveBadge[] = [];

  if (options.hasPublishedResults) {
    badges.push("Results");
  }

  for (const signal of options.documentSignals) {
    const haystack = `${signal.documentType ?? ""} ${signal.title ?? ""}`.toLowerCase();
    if (haystack.includes("gallery") || haystack.includes("photo") || haystack.includes("media")) {
      badges.push("Photos");
    }
    if (haystack.includes("recap") || haystack.includes("report") || haystack.includes("summary") || haystack.includes("wrap")) {
      badges.push("Recap");
    }
  }

  return dedupeArchiveBadges(badges);
}

function inferEventTags(
  slug: string,
  categories: Array<{ distance_km: number | null; elevation_gain_m: number | null }>,
) {
  const seeded = eventCoordsBySlug[slug]?.tags;
  if (seeded?.length) return seeded;

  const tags = new Set<string>(["race"]);
  const maxDistance = Math.max(...categories.map((category) => category.distance_km ?? 0), 0);
  const maxElevation = Math.max(...categories.map((category) => category.elevation_gain_m ?? 0), 0);
  if (maxDistance >= 42) tags.add("ultra");
  if (maxDistance > 0 && maxDistance < 15) tags.add("fun-run");
  if (maxElevation >= 1800) tags.add("mountain");
  if (maxElevation >= 2500) tags.add("ridge");
  return Array.from(tags);
}

function inferTrackTags(slug: string, terrainType: string | null | undefined, distance: number | null | undefined) {
  const seeded = trackMetaBySlug[slug]?.tags;
  if (seeded?.length) return seeded;

  const tags = new Set<string>();
  const normalizedTerrain = (terrainType ?? "").toLowerCase();

  if ((distance ?? 0) >= 42) tags.add("ultra");
  if ((distance ?? 0) >= 15 && (distance ?? 0) < 35) tags.add("mid");
  if ((distance ?? 0) >= 35) tags.add("long");
  if (normalizedTerrain.includes("forest")) tags.add("forest");
  if (normalizedTerrain.includes("ridge")) tags.add("ridge");
  if (normalizedTerrain.includes("rock") || normalizedTerrain.includes("karst")) {
    tags.add("mountain");
    tags.add("karst");
  }
  if (!tags.size) tags.add("training");

  return Array.from(tags);
}

function fallbackCoords(locationLabel: string | null | undefined) {
  const normalized = (locationLabel ?? "").toLowerCase();
  if (normalized.includes("zadar")) return { lat: 44.12, lng: 15.23 };
  if (normalized.includes("zagreb")) return { lat: 45.81, lng: 15.98 };
  if (normalized.includes("split")) return { lat: 43.51, lng: 16.44 };
  if (normalized.includes("opatija")) return { lat: 45.34, lng: 14.3 };
  return { lat: 45.1, lng: 15.2 };
}

export function getFallbackAthleteBadgesReadModel(): AthleteBadgesReadModel {
  return emptyAthleteBadgesReadModel;
}

export function getFallbackPublicResultsReadModel(): PublicResultsPageReadModel {
  return emptyPublicResultsReadModel;
}

export function getFallbackPublicResultsDirectoryReadModel(): PublicResultsDirectoryReadModel {
  return emptyPublicResultsDirectoryReadModel;
}

export function buildCompetitiveTeamStandings(rows: Array<{
  clubId: string | null;
  clubName: string;
  athleteName: string;
  overall: number;
}>, rankingConfig: CompetitiveRankingConfig): CompetitiveTeamStanding[] {
  if (!rankingConfig.team.enabled) return [];

  const grouped = new Map<string, { clubName: string; scorers: Array<{ athleteName: string; overall: number }> }>();
  for (const row of rows) {
    if (!row.clubId || row.overall <= 0) continue;
    const existing = grouped.get(row.clubId) ?? {
      clubName: row.clubName,
      scorers: [],
    };
    existing.scorers.push({
      athleteName: row.athleteName,
      overall: row.overall,
    });
    grouped.set(row.clubId, existing);
  }

  return Array.from(grouped.entries())
    .map(([clubId, group]) => {
      const scorers = group.scorers
        .slice()
        .sort((left, right) => left.overall - right.overall)
        .slice(0, rankingConfig.team.scoringCount);
      return {
        rank: 0,
        clubId,
        clubName: group.clubName,
        score: scorers.reduce((sum, scorer) => sum + scorer.overall, 0),
        scorerCount: scorers.length,
        scorerRanks: scorers.map((scorer) => scorer.overall),
        scorerNames: scorers.map((scorer) => scorer.athleteName),
      } satisfies CompetitiveTeamStanding;
    })
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      const leftTieBreaker = left.scorerRanks[left.scorerRanks.length - 1] ?? Number.MAX_SAFE_INTEGER;
      const rightTieBreaker = right.scorerRanks[right.scorerRanks.length - 1] ?? Number.MAX_SAFE_INTEGER;
      if (leftTieBreaker !== rightTieBreaker) return leftTieBreaker - rightTieBreaker;
      return left.clubName.localeCompare(right.clubName);
    })
    .map((standing, index) => ({
      ...standing,
      rank: index + 1,
    }));
}

export async function getDynamicEventsCatalog(): Promise<PortalEventCatalogItem[]> {
  const supabase = getSupabasePublicClient();
  if (!supabase) return [];

  try {
    const { data: editions, error } = await supabase
      .from("event_editions")
      .select("id,event_series_id,slug,name,activity_type,start_date,end_date,timezone,location_name,status,registration_open_at,registration_close_at,cover_image_url")
      .eq("public_visibility", "public")
      .is("organizer_deleted_at", null)
      .not("published_at", "is", null)
      .neq("status", "draft")
      .order("start_date", { ascending: false });

    if (error) throw error;
    if (!editions?.length) return [];

    const editionIds = editions.map((edition) => edition.id);
    const seriesIds = Array.from(new Set(editions.map((edition) => edition.event_series_id).filter(Boolean)));

    const [
      { data: categories, error: categoriesError },
      { data: seriesRows, error: seriesError },
      { data: eventLocations, error: locationsError },
      { data: eventSportRows, error: sportsError },
      leagueMembershipsByEdition,
    ] = await Promise.all([
      supabase
        .from("event_categories")
        .select("id,event_edition_id,distance_km,elevation_gain_m,capacity,registration_fee_cents,registration_fee_periods,currency,results_mode,status")
        .in("event_edition_id", editionIds)
        .is("organizer_deleted_at", null),
      seriesIds.length
        ? supabase.from("event_series").select("id,organization_id,country_code").in("id", seriesIds)
        : Promise.resolve({ data: [], error: null }),
      editionIds.length
        ? supabase
            .from("event_locations")
            .select("event_edition_id,latitude,longitude,display_order")
            .in("event_edition_id", editionIds)
            .order("display_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("event_edition_sports")
        .select("event_edition_id,sport_code,is_primary")
        .in("event_edition_id", editionIds),
      loadPublicEventLeagueMembershipsByEdition(supabase, editionIds),
    ]);
    for (const readError of [categoriesError, seriesError, locationsError, sportsError]) {
      if (readError) throw readError;
    }

    const categoryIds = Array.from(new Set((categories ?? []).map((category) => category.id).filter(Boolean)));
    const [
      { data: publications, error: publicationsError },
      { data: documents, error: documentsError },
      { data: snapshots, error: snapshotsError },
      registrationCountByCategoryId,
    ] = await Promise.all([
      categoryIds.length
        ? supabase
            .from("result_publications")
            .select("event_category_id,result_run_id,published_at")
            .in("event_category_id", categoryIds)
            .not("published_at", "is", null)
            .order("published_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      editionIds.length
        ? supabase
            .from("event_documents")
            .select("event_edition_id,document_type,title")
            .in("event_edition_id", editionIds)
        : Promise.resolve({ data: [], error: null }),
      categoryIds.length
        ? supabase
            .from("event_category_track_snapshots")
            .select("event_category_id,track_template_id,track_version_id,created_at")
            .in("event_category_id", categoryIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      getPublicRegistrationCountsByCategoryId(supabase, categoryIds),
    ]);
    for (const readError of [publicationsError, documentsError, snapshotsError]) {
      if (readError) throw readError;
    }

    const latestResultRunByCategoryId = new Map<string, string>();
    for (const publication of publications ?? []) {
      if (!latestResultRunByCategoryId.has(publication.event_category_id)) {
        latestResultRunByCategoryId.set(publication.event_category_id, publication.result_run_id);
      }
    }
    const latestResultRunIds = Array.from(new Set(latestResultRunByCategoryId.values()));
    const { data: resultRows, error: resultsError } = latestResultRunIds.length
      ? await supabase
          .from("result_rows")
          .select("result_run_id,event_category_id,result_status,finish_time_ms,represented_club_id")
          .in("result_run_id", latestResultRunIds)
      : { data: [], error: null };
    if (resultsError) throw resultsError;

    const orgIds = Array.from(new Set((seriesRows ?? []).map((series) => series.organization_id).filter(Boolean)));
    const trackTemplateIds = Array.from(
      new Set((snapshots ?? []).map((snapshot) => snapshot.track_template_id).filter(Boolean)),
    );
    const trackVersionIds = Array.from(
      new Set((snapshots ?? []).map((snapshot) => snapshot.track_version_id).filter(Boolean)),
    );

    const [
      { data: organizations, error: organizationsError },
      { data: trackTemplates, error: templatesError },
      { data: publishedTrackVersions, error: versionsError },
    ] = await Promise.all([
      orgIds.length
        ? supabase.from("organizations").select("id,name").in("id", orgIds)
        : Promise.resolve({ data: [], error: null }),
      trackTemplateIds.length
        ? supabase.from("track_templates").select("id,slug,name,gallery_preview_image_url").in("id", trackTemplateIds)
        : Promise.resolve({ data: [], error: null }),
      trackVersionIds.length
        ? supabase
            .from("track_versions")
            .select("id")
            .in("id", trackVersionIds)
            .not("published_at", "is", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const readError of [organizationsError, templatesError, versionsError]) {
      if (readError) throw readError;
    }

    const publishedTrackVersionIds = new Set((publishedTrackVersions ?? []).map((version) => version.id));
    const rawSnapshotByCategoryId = new Map<string, {
      event_category_id: string;
      track_template_id: string;
      track_version_id: string | null;
      created_at: string;
    }>();
    const publicSnapshotByCategoryId = new Map<string, {
      event_category_id: string;
      track_template_id: string;
      track_version_id: string | null;
      created_at: string;
    }>();
    for (const snapshot of snapshots ?? []) {
      if (!rawSnapshotByCategoryId.has(snapshot.event_category_id)) {
        rawSnapshotByCategoryId.set(snapshot.event_category_id, snapshot);
      }

      if (
        snapshot.track_version_id &&
        publishedTrackVersionIds.has(snapshot.track_version_id) &&
        !publicSnapshotByCategoryId.has(snapshot.event_category_id)
      ) {
        publicSnapshotByCategoryId.set(snapshot.event_category_id, snapshot);
      }
    }

    const categoriesByEdition = new Map<string, NonNullable<typeof categories>>();
    for (const category of categories ?? []) {
      if (category.status === "draft" || category.results_mode === "informative_age") continue;
      const current = categoriesByEdition.get(category.event_edition_id) ?? [];
      current.push(category);
      categoriesByEdition.set(category.event_edition_id, current);
    }
    for (const editionCategories of categoriesByEdition.values()) {
      editionCategories.sort((left, right) => (right.distance_km ?? 0) - (left.distance_km ?? 0));
    }
    const primarySnapshotByEditionId = new Map(
      editions.map((edition) => [
        edition.id,
        (categoriesByEdition.get(edition.id) ?? [])
          .map((category) => publicSnapshotByCategoryId.get(category.id))
          .find(Boolean),
      ]),
    );
    // The catalogue displays one preview per event; other category geometry is
    // loaded by the event detail page when needed.
    const publicTrackVersionIds = Array.from(
      new Set(
        Array.from(primarySnapshotByEditionId.values())
          .map((snapshot) => snapshot?.track_version_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const { data: renderCaches, error: geometryError } = await (
      publicTrackVersionIds.length
        ? supabase
            .from("track_render_cache")
            .select("track_version_id,polyline_json,elevation_profile_json")
            .in("track_version_id", publicTrackVersionIds)
        : Promise.resolve({ data: [], error: null })
    );
    if (geometryError) throw geometryError;

    const eventLocationByEditionId = new Map<string, { lat: number; lng: number }>();
    for (const row of eventLocations ?? []) {
      if (eventLocationByEditionId.has(row.event_edition_id)) continue;
      const lat = numberFromUnknown(row.latitude);
      const lng = numberFromUnknown(row.longitude);
      if (lat == null || lng == null) continue;
      eventLocationByEditionId.set(row.event_edition_id, { lat, lng });
    }

    const publishedResultCategoryIds = new Set((publications ?? []).map((publication) => publication.event_category_id));
    const resultRowsByCategoryId = new Map<string, typeof resultRows>();
    for (const row of resultRows ?? []) {
      if (latestResultRunByCategoryId.get(row.event_category_id) !== row.result_run_id) continue;
      const current = resultRowsByCategoryId.get(row.event_category_id) ?? [];
      current.push(row);
      resultRowsByCategoryId.set(row.event_category_id, current);
    }
    const documentsByEdition = new Map<string, Array<{ documentType: string | null; title: string | null }>>();
    for (const document of documents ?? []) {
      const current = documentsByEdition.get(document.event_edition_id) ?? [];
      current.push({
        documentType: document.document_type ?? null,
        title: document.title ?? null,
      });
      documentsByEdition.set(document.event_edition_id, current);
    }

    const seriesById = new Map((seriesRows ?? []).map((series) => [series.id, series]));
    const organizationsById = new Map((organizations ?? []).map((organization) => [organization.id, organization.name]));
    const trackTemplateById = new Map((trackTemplates ?? []).map((template) => [template.id, template]));
    const renderCacheByVersionId = new Map((renderCaches ?? []).map((cache) => [cache.track_version_id, cache]));
    const sportsByEditionId = new Map<string, Array<{ sport_code: SportCode; is_primary: boolean }>>();
    for (const assignment of eventSportRows ?? []) {
      const existing = sportsByEditionId.get(assignment.event_edition_id) ?? [];
      existing.push({
        sport_code: assignment.sport_code as SportCode,
        is_primary: assignment.is_primary,
      });
      sportsByEditionId.set(assignment.event_edition_id, existing);
    }

    return editions.map((edition) => {
      const editionCategories = categoriesByEdition.get(edition.id) ?? [];
      const distances = editionCategories.map((category) => {
        const distance = category.distance_km ?? 0;
        return formatEventDistanceKm(distance);
      });
      const maxElevation = Math.max(...editionCategories.map((category) => category.elevation_gain_m ?? 0), 0);
      const entryFees = editionCategories.flatMap((category) => {
        if (category.registration_fee_cents == null) return [];
        const currency = typeof category.currency === "string" && category.currency.trim()
          ? category.currency.trim().toUpperCase()
          : "EUR";
        return [{ amountCents: raceFeeAt(category.registration_fee_cents, category.registration_fee_periods as RaceFeePeriod[] | undefined), currency }];
      });
      const totalRegistrations = editionCategories.reduce(
        (sum, category) => sum + (registrationCountByCategoryId.get(category.id)?.registeredCount ?? 0),
        0,
      );
      const latestResultRows = editionCategories.flatMap(
        (category) => resultRowsByCategoryId.get(category.id) ?? [],
      );
      const representedClubCount = new Set(
        latestResultRows
          .map((row) => row.represented_club_id)
          .filter((value): value is string => Boolean(value)),
      ).size;
      const series = seriesById.get(edition.event_series_id);
      const organizerName = series?.organization_id ? organizationsById.get(series.organization_id) : undefined;
      const seededMeta = eventCoordsBySlug[edition.slug];
      const archiveBadges = buildArchiveBadges({
        hasPublishedResults: editionCategories.some((category) => publishedResultCategoryIds.has(category.id)),
        documentSignals: documentsByEdition.get(edition.id) ?? [],
      });
      const linkedTrackTemplate =
        editionCategories
          .map((category) => {
            const snapshot = rawSnapshotByCategoryId.get(category.id);
            return snapshot ? trackTemplateById.get(snapshot.track_template_id) ?? null : null;
          })
          .find(Boolean) ?? null;
      const primaryCategorySnapshot = primarySnapshotByEditionId.get(edition.id);
      const primaryRenderCache = primaryCategorySnapshot?.track_version_id
        ? renderCacheByVersionId.get(primaryCategorySnapshot.track_version_id) ?? null
        : null;
      const previewTrackPoints = Array.isArray(primaryRenderCache?.polyline_json)
        ? primaryRenderCache.polyline_json.map(mapPolylinePoint).filter(Boolean) as [number, number][]
        : [];
      const previewElevationPoints = Array.isArray(primaryRenderCache?.elevation_profile_json)
        ? primaryRenderCache.elevation_profile_json
            .map((point, index) => mapElevationPoint(point, index, previewTrackPoints))
            .filter(Boolean)
        : [];
      const trackStartCoords = previewTrackPoints[0]
        ? { lat: previewTrackPoints[0][0], lng: previewTrackPoints[0][1] }
        : null;
      const coords = eventLocationByEditionId.get(edition.id) ?? trackStartCoords ?? seededMeta ?? fallbackCoords(edition.location_name);
      const sportRows = sportsByEditionId.get(edition.id) ?? [];
      const sportSelection = normalizeSportSelection({
        sportCodes: sportRows.map((row) => row.sport_code),
        primarySportCode: sportRows.find((row) => row.is_primary)?.sport_code ?? DEFAULT_SPORT_CODE,
      });

      return {
        id: edition.slug,
        editionId: edition.id,
        title: edition.name,
        activityType: normalizeEventActivityType(edition.activity_type),
        sportCodes: sportSelection.sportCodes,
        primarySportCode: sportSelection.primarySportCode,
        date: format(new Date(`${edition.start_date}T00:00:00`), "MMM d, yyyy"),
        startDateIso: edition.start_date ?? null,
        location: resolvePublicLocationLabel(edition.location_name, {
          fallbackLabel: seededMeta?.location ?? "Croatia",
        }),
        distance: distances.length ? `${distances.join(" / ")} km` : "TBA",
        elevation: formatElevation(maxElevation || null),
        status: formatEventCardStatus(
          edition.status,
          edition.start_date,
          edition.registration_open_at,
          edition.registration_close_at,
          new Date(),
          {
            endDate: edition.end_date,
            hasPublishedResults: editionCategories.some((category) => publishedResultCategoryIds.has(category.id)),
            timeZone: edition.timezone,
          },
        ),
        participants: totalRegistrations,
        clubs: representedClubCount,
        price: formatEventEntryFees(entryFees),
        countryCode: series?.country_code?.trim().toUpperCase() || null,
        organizer: organizerName ?? "Race organizer",
        lat: coords.lat,
        lng: coords.lng,
        tags: inferEventTags(edition.slug, editionCategories),
        leagueMemberships: leagueMembershipsByEdition.get(edition.id),
        archiveBadges: archiveBadges.length ? archiveBadges : undefined,
        coverImageUrl: resolveRecoveredPublicMediaUrl(edition.cover_image_url),
        linkedTrackSlug: linkedTrackTemplate?.slug ?? null,
        linkedTrackName: linkedTrackTemplate?.name ?? null,
        linkedTrackImageUrl: getTrackCatalogImageUrl(linkedTrackTemplate?.gallery_preview_image_url),
        linkedTrackVersionId: primaryCategorySnapshot?.track_version_id ?? null,
        trackPoints: previewTrackPoints.length ? previewTrackPoints : undefined,
        elevationPoints: previewElevationPoints.length ? previewElevationPoints : undefined,
      };
    });
  } catch (error) {
    console.warn("Unable to load public races catalog", error);
    throw error;
  }
}

export async function getPublicResultsDirectoryReadModel(): Promise<PublicResultsDirectoryReadModel> {
  const supabase = getSupabasePublicClient();
  if (!supabase) {
    throw new Error("Public results service is unavailable");
  }

  try {
    const { data: editions, error } = await supabase
      .from("event_editions")
      .select("id,event_series_id,slug,name,start_date,end_date,timezone,location_name,status,registration_open_at,registration_close_at,cover_image_url")
      .eq("public_visibility", "public")
      .is("organizer_deleted_at", null)
      .not("published_at", "is", null)
      .neq("status", "draft")
      .order("start_date", { ascending: true })
      .limit(64);

    if (error) throw error;
    if (!editions?.length) return emptyPublicResultsDirectoryReadModel;

    const editionIds = editions.map((edition) => edition.id);
    const seriesIds = Array.from(new Set(editions.map((edition) => edition.event_series_id).filter(Boolean)));

    const [{ data: categories }, { data: seriesRows }, { data: eventLocations }] = await Promise.all([
      supabase
        .from("event_categories")
        .select("id,event_edition_id,slug,name,results_mode,status,display_order,distance_km")
        .in("event_edition_id", editionIds)
        .is("organizer_deleted_at", null)
        .order("display_order", { ascending: true })
        .order("distance_km", { ascending: false }),
      seriesIds.length
        ? supabase.from("event_series").select("id,organization_id,location_name").in("id", seriesIds)
        : Promise.resolve({ data: [], error: null }),
      editionIds.length
        ? supabase
            .from("event_locations")
            .select("event_edition_id,latitude,longitude,display_order")
            .in("event_edition_id", editionIds)
            .order("display_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    const competitiveCategories = (categories ?? []).filter((category) => (
      category.status !== "draft" && category.results_mode !== "informative_age"
    ));
    const categoryIds = Array.from(new Set(competitiveCategories.map((category) => category.id)));

    const { data: resultLifecycleRows, error: resultLifecycleError } = categoryIds.length
      ? await supabase.rpc("public_results_directory_category_states")
      : { data: [], error: null };
    if (resultLifecycleError) throw resultLifecycleError;

    const registrationCountByCategoryId = await getPublicRegistrationCountsByCategoryId(supabase, categoryIds);

    const orgIds = Array.from(new Set((seriesRows ?? []).map((series) => series.organization_id).filter(Boolean)));
    const { data: organizations } = orgIds.length
      ? await supabase.from("organizations").select("id,name").in("id", orgIds)
      : { data: [] };
    const eventPreviewMediaBySlug = await loadPublicEventPreviewMedia(supabase, editions);

    const categoriesByEdition = new Map<string, typeof competitiveCategories>();
    for (const category of competitiveCategories) {
      const current = categoriesByEdition.get(category.event_edition_id) ?? [];
      current.push(category);
      categoriesByEdition.set(category.event_edition_id, current);
    }

    const effectiveResultSourceByCategory = new Map<string, {
      result_run_id: string | null;
      publication_state: string | null;
      published_at: string | null;
    }>();
    const finisherCountByCategoryId = new Map<string, number>();
    for (const lifecycleRow of resultLifecycleRows ?? []) {
      if (!categoryIds.includes(lifecycleRow.event_category_id)) continue;
      effectiveResultSourceByCategory.set(lifecycleRow.event_category_id, {
        result_run_id: lifecycleRow.result_run_id ?? null,
        publication_state: lifecycleRow.publication_state ?? null,
        published_at: lifecycleRow.published_at ?? null,
      });
      finisherCountByCategoryId.set(
        lifecycleRow.event_category_id,
        Number(lifecycleRow.finisher_count ?? 0),
      );
    }

    const seriesById = new Map((seriesRows ?? []).map((series) => [series.id, series]));
    const organizationsById = new Map((organizations ?? []).map((organization) => [organization.id, organization.name]));
    const primaryLocationByEdition = new Map<string, { latitude: number | null; longitude: number | null }>();
    for (const eventLocation of eventLocations ?? []) {
      if (!primaryLocationByEdition.has(eventLocation.event_edition_id)) {
        primaryLocationByEdition.set(eventLocation.event_edition_id, {
          latitude: eventLocation.latitude ?? null,
          longitude: eventLocation.longitude ?? null,
        });
      }
    }

    return {
      events: editions.map((edition) => {
        const editionCategories = categoriesByEdition.get(edition.id) ?? [];
        const eventStatus = formatEventCardStatus(
          edition.status,
          edition.start_date,
          edition.registration_open_at,
          edition.registration_close_at,
          new Date(),
          {
            endDate: edition.end_date,
            hasPublishedResults: editionCategories.some((category) => (
              Boolean(effectiveResultSourceByCategory.get(category.id)?.result_run_id)
            )),
            timeZone: edition.timezone,
          },
        );
        const series = seriesById.get(edition.event_series_id);
        const organizerName = series?.organization_id ? organizationsById.get(series.organization_id) : null;
        const location = resolvePublicLocationLabel(edition.location_name, {
          fallbackLabel: resolvePublicLocationLabel(series?.location_name, {
            fallbackLabel: "Croatia",
          }),
        });
        const seededMeta = eventCoordsBySlug[edition.slug];
        const primaryLocation = primaryLocationByEdition.get(edition.id);
        const coords = {
          lat: primaryLocation?.latitude ?? seededMeta?.lat ?? fallbackCoords(location).lat,
          lng: primaryLocation?.longitude ?? seededMeta?.lng ?? fallbackCoords(location).lng,
        };

        const races = editionCategories.map((category) => {
          const latestPublication = effectiveResultSourceByCategory.get(category.id);
          const raceStatus = normalizeResultsDirectoryRaceStatus(
            latestPublication?.publication_state ?? null,
            eventStatus,
            category.status,
          );

          return {
            id: category.id,
            slug: category.slug,
            label: category.name,
            distanceLabel: category.distance_km != null ? formatDistance(category.distance_km) : null,
            resultsStatus: raceStatus,
            resultsStatusLabel: formatResultsDirectoryRaceStatusLabel(raceStatus),
            hasPublishedResults: Boolean(latestPublication?.result_run_id),
            publishedAt: latestPublication?.published_at ?? null,
          } satisfies PublicResultsDirectoryRace;
        });

        return {
          editionId: edition.id,
          eventSlug: edition.slug,
          eventName: edition.name,
          date: format(new Date(`${edition.start_date}T00:00:00`), "MMM d, yyyy"),
          startDateIso: edition.start_date,
          timeZone: edition.timezone ?? "Europe/Zagreb",
          coverImageUrl: resolveRecoveredPublicMediaUrl(edition.cover_image_url),
          linkedTrackImageUrl: eventPreviewMediaBySlug.get(edition.slug)?.linkedTrackImageUrl ?? null,
          location,
          lat: coords.lat,
          lng: coords.lng,
          organizer: organizerName ?? "Trail Organizer",
          status: eventStatus,
          raceCount: races.length,
          publishedRaceCount: races.filter((race) => race.hasPublishedResults).length,
          registeredRunnerCount: editionCategories.reduce(
            (sum, category) => sum + (registrationCountByCategoryId.get(category.id)?.registeredCount ?? 0),
            0,
          ),
          finisherCount: editionCategories.reduce(
            (sum, category) => sum + (finisherCountByCategoryId.get(category.id) ?? 0),
            0,
          ),
          races,
        } satisfies PublicResultsDirectoryEvent;
      }),
    };
  } catch (error) {
    console.warn("Unable to load results directory catalog", error);
    throw error;
  }
}

export async function getDynamicTracksCatalog(): Promise<PortalTrackCatalogItem[]> {
  const supabase = getSupabasePublicClient();
  if (!supabase) return [];

  try {
    const { data: versions, error: versionError } = await supabase
      .from("track_versions")
      .select("id,track_template_id,version_number,distance_km,elevation_gain_m,difficulty_level,start_lat,start_lng,published_at")
      .not("published_at", "is", null)
      .order("version_number", { ascending: false });

    if (versionError || !versions?.length) {
      throw versionError ?? new Error("No public routes found");
    }

    const latestPublishedVersionByTemplate = new Map<string, (typeof versions)[number]>();
    for (const version of versions ?? []) {
      if (!latestPublishedVersionByTemplate.has(version.track_template_id)) {
        latestPublishedVersionByTemplate.set(version.track_template_id, version);
      }
    }

    const templateIds = Array.from(latestPublishedVersionByTemplate.keys()).slice(0, 24);
    const { data: templates, error: templateError } = await supabase
      .from("track_templates")
      .select("id,organization_id,slug,name,sport_code,terrain_type,notes,location_label,gallery_preview_image_url")
      .in("id", templateIds)
      .order("name", { ascending: true });

    if (templateError || !templates?.length) {
      throw templateError ?? new Error("No public routes found");
    }

    const organizationIds = Array.from(new Set(templates.map((template) => template.organization_id).filter(Boolean)));
    const [
      { data: attempts },
      { data: reviews },
      { data: snapshots },
      { data: organizations },
    ] = await Promise.all([
      supabase
        .from("track_attempts")
        .select("id,track_template_id,athlete_profile_id,elapsed_time_ms,started_at,strava_url")
        .in("track_template_id", templateIds)
        .eq("verification_status", "verified"),
      supabase
        .from("track_reviews")
        .select("track_template_id,rating")
        .in("track_template_id", templateIds),
      supabase
        .from("event_category_track_snapshots")
        .select("track_template_id,track_version_id,event_category_id,created_at")
        .in("track_template_id", templateIds)
        .order("created_at", { ascending: false }),
      organizationIds.length
        ? supabase
            .from("organizations")
            .select("id,name")
            .in("id", organizationIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    ]);

    const organizationNameById = new Map(
      (organizations ?? []).map((organization) => [organization.id, organization.name]),
    );

    let raceRecordsByTemplateId = new Map<string, PublishedTrackRaceRecords>();
    try {
      raceRecordsByTemplateId = await loadPublishedTrackRaceRecordsByTemplate(supabase, snapshots ?? []);
    } catch (error) {
      console.warn("Unable to load published race starts for route catalog", error);
    }

    const attemptAthleteIds = Array.from(new Set(
      (attempts ?? []).map((attempt) => attempt.athlete_profile_id).filter(Boolean),
    ));
    const attemptAthleteMap = new Map<string, { name: string; slug: string | null }>();
    if (attemptAthleteIds.length) {
      const { data: athletes } = await supabase
        .from("public_athlete_profiles")
        .select("id,slug,display_name")
        .in("id", attemptAthleteIds);

      for (const athlete of athletes ?? []) {
        attemptAthleteMap.set(athlete.id, {
          name: athlete.display_name,
          slug: athlete.slug || null,
        });
      }
    }

    return templates.map((template) => {
      const latestVersion = latestPublishedVersionByTemplate.get(template.id);
      const publishedRaceRecords = raceRecordsByTemplateId.get(template.id);
      const linkedEvent = publishedRaceRecords?.primaryEvent?.name ?? null;
      const reviewRows = (reviews ?? []).filter((review) => review.track_template_id === template.id);
      const reviewCount = reviewRows.length;
      const averageRating =
        reviewCount > 0
          ? reviewRows.reduce((sum, review) => sum + review.rating, 0) / reviewCount
          : 0;
      const verifiedAttempts = (attempts ?? []).filter((attempt) => attempt.track_template_id === template.id).length;
      const submittedAttemptCandidates = (attempts ?? []).flatMap((attempt) => {
        if (attempt.track_template_id !== template.id) return [];
        const elapsedTimeMs = attempt.elapsed_time_ms == null ? null : Number(attempt.elapsed_time_ms);
        if (elapsedTimeMs == null || !Number.isFinite(elapsedTimeMs) || elapsedTimeMs <= 0) return [];
        const athlete = attemptAthleteMap.get(attempt.athlete_profile_id);
        const stravaUrl = typeof attempt.strava_url === "string" && attempt.strava_url.trim()
          ? attempt.strava_url.trim()
          : null;
        const sourceKind = stravaUrl ? "strava" as const : "manual" as const;

        return [{
          id: `attempt:${attempt.id}`,
          athleteProfileId: attempt.athlete_profile_id,
          athleteSlug: athlete?.slug ?? null,
          name: athlete?.name ?? "Trail Runner",
          elapsedTimeMs,
          occurredAt: resolveTrackRecordOccurredAt({
            sourceKind,
            activityStartedAt: attempt.started_at,
          }),
          gender: null,
          sourceKind,
          sourceLabel: stravaUrl ? "Strava" : "Verified attempt",
          sourceHref: stravaUrl,
        }];
      });
      const trackRecord = mergeTrackRecordCandidates([
        ...(publishedRaceRecords?.candidates ?? []),
        ...submittedAttemptCandidates,
      ], 1)[0] ?? null;
      const seededMeta = trackMetaBySlug[template.slug];
      const coords = resolveTrackCatalogCoordinates({
        startLat: latestVersion?.start_lat,
        startLng: latestVersion?.start_lng,
        seeded: seededMeta,
        fallback: fallbackCoords(linkedEvent ?? template.name),
      });
      const fallbackLocationLabel = seededMeta?.location ?? (linkedEvent ? linkedEvent.replace("Trail", "").trim() : "Croatia");
      const difficultyLevel = resolveTrackDifficultyLevel(
        latestVersion?.difficulty_level,
        latestVersion?.distance_km,
        latestVersion?.elevation_gain_m,
      );

      return {
        id: template.slug,
        name: template.name,
        sportCode: (template.sport_code as SportCode | null) ?? DEFAULT_SPORT_CODE,
        organizer: organizationNameById.get(template.organization_id) ?? "Route organizer",
        imageUrl: getTrackCatalogImageUrl(
          template.gallery_preview_image_url,
          publishedRaceRecords?.primaryEvent?.coverImageUrl,
        ),
        location: resolvePublicLocationLabel(template.location_label, {
          fallbackLabel: fallbackLocationLabel,
        }),
        distance: Number(latestVersion?.distance_km ?? 0),
        elevation: Number(latestVersion?.elevation_gain_m ?? 0),
        difficulty: getTrackDifficultyLabel(difficultyLevel),
        difficultyLevel,
        surface: template.terrain_type ?? "Trail terrain",
        rating: Number(averageRating.toFixed(1)),
        reviewCount,
        attempts: verifiedAttempts + (publishedRaceRecords?.startCount ?? 0),
        season: seededMeta?.season ?? "Year-round",
        lat: coords.lat,
        lng: coords.lng,
        linkedEvent,
        tags: inferTrackTags(template.slug, template.terrain_type, latestVersion?.distance_km),
        record: trackRecord ? {
          time: formatTrackRecordDuration(trackRecord.elapsedTimeMs),
          athleteName: trackRecord.name,
          date: formatCatalogTrackRecordDate(trackRecord.occurredAt),
        } : null,
      };
    });
  } catch (error) {
    console.warn("Falling back to local routes catalog", error);
    return [];
  }
}

export async function getHomepageReadModel(): Promise<HomepageReadModel> {
  const supabase = getSupabasePublicClient();
  const emptyReadModel: HomepageReadModel = {
    stats: {
      events: 0,
      tracks: 0,
      leagues: 0,
      athletes: 0,
      registrations: 0,
      clubs: 0,
      finishes: 0,
      completedDistanceKm: 0,
      countries: 0,
    },
    upcomingEvents: [],
    latestResults: [],
  };

  let publicStats = emptyReadModel.stats;
  const latestResultsPromise = getHomepageLatestResults();
  try {
    publicStats = (await getPublicPlatformSummary()).stats;
  } catch (error) {
    console.warn("Unable to load public platform summary", error);
  }

  if (!supabase) {
    return {
      ...emptyReadModel,
      stats: publicStats,
      latestResults: await latestResultsPromise,
    };
  }

  try {
    const [eventsCatalog, latestPublishedResults] = await Promise.all([
      getHomepageFeaturedRaces(),
      latestResultsPromise,
    ]);
    const eventBySlug = new Map(eventsCatalog.map((event) => [event.id, event]));
    const latestResults = latestPublishedResults.map((result) => ({
      ...result,
      eventImageUrl:
        result.eventImageUrl
        ?? eventBySlug.get(result.eventSlug)?.coverImageUrl
        ?? eventBySlug.get(result.eventSlug)?.linkedTrackImageUrl
        ?? null,
    }));

    return {
      stats: publicStats,
      upcomingEvents: selectHomepageRaceCards(eventsCatalog),
      latestResults,
    };
  } catch (error) {
    console.warn("Falling back to local homepage data", error);
    return { ...emptyReadModel, stats: publicStats };
  }
}

export async function getPublicAthleteResultsReadModel(
  athleteSlug: string = "",
): Promise<AthleteResultsReadModel> {
  const supabase = getSupabasePublicClient();
  const emptyReadModel: AthleteResultsReadModel = {
    seasonStats: {
      totalParticipations: 0,
      totalRaces: 0,
      totalFinishes: 0,
      podiums: 0,
      wins: 0,
      avgFinish: "TBA",
    },
    results: [],
  };

  if (!supabase) {
    return emptyReadModel;
  }

  if (!athleteSlug.trim()) {
    return emptyReadModel;
  }

  try {
    const historyRows = await apiRequest<PublicAthleteResultHistoryRow[]>({
      path: `/v1/public/athletes/${encodeURIComponent(athleteSlug)}/results`,
      accessToken: null,
    }).catch(() => null);

    if (historyRows) {
      const eventSlugs = Array.from(new Set<string>(historyRows.map((row) => row.eventSlug)));
      const eventPreviewMediaBySlug = await loadPublicEventPreviewMediaBySlug(supabase, eventSlugs);
      const mappedResultsWithMetrics = historyRows.map((row) => {
        const finishTimeMs = row.finishTimeMs == null ? null : Number(row.finishTimeMs);
        const previewMedia = eventPreviewMediaBySlug.get(row.eventSlug);
        return {
          id: row.resultRowId,
          eventSlug: row.eventSlug,
          event: row.eventName,
          eventImageUrl: previewMedia?.coverImageUrl ?? previewMedia?.linkedTrackImageUrl ?? null,
          category: row.categoryName,
          distanceKm: row.distanceKm,
          elevationGainM: row.elevationGainM,
          date: row.eventDate ? format(new Date(`${row.eventDate}T00:00:00`), "MMM d, yyyy") : "TBA",
          place: row.rankOverall ?? 0,
          totalRunners: row.totalFinishers,
          time: formatElapsedTimeFromMs(finishTimeMs),
          pace: formatPace(row.distanceKm, finishTimeMs),
          status: normalizeAthleteResultOutcome(row.outcomeLabel, finishTimeMs),
          finishTimeMs,
          splits: row.splits.map((split) => formatElapsedTimeFromMs(split.elapsedTimeMs)),
        };
      });
      const performance = summarizeAthletePerformance(mappedResultsWithMetrics);
      const mappedResults: AthleteResultItem[] = mappedResultsWithMetrics.map(({ finishTimeMs: _finishTimeMs, ...result }) => result);

      return {
        seasonStats: {
          totalParticipations: performance.totalParticipations,
          totalRaces: performance.totalRaces,
          totalFinishes: performance.totalFinishes,
          podiums: performance.podiums,
          wins: performance.wins,
          avgFinish: formatElapsedTimeFromMs(performance.averageFinishMs),
        },
        results: mappedResults,
      };
    }

    const { data: athlete, error } = await supabase
      .from("public_athlete_profiles")
      .select("id")
      .eq("slug", athleteSlug)
      .single();

    if (error || !athlete) {
      throw error ?? new Error(`Athlete ${athleteSlug} not found`);
    }

    const { data: resultRows } = await supabase
      .from("result_rows")
      .select("id,result_run_id,registration_id,event_category_id,result_status,finish_time_ms,rank_overall,created_at")
      .eq("athlete_profile_id", athlete.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!resultRows?.length) {
      return emptyReadModel;
    }

    const categoryIds = Array.from(new Set(resultRows.map((row) => row.event_category_id)));
    const rowIds = resultRows.map((row) => row.id);

    const [{ data: categories }, { data: splits }, { data: publications }] = await Promise.all([
      supabase
        .from("event_categories")
        .select("id,event_edition_id,name,distance_km")
        .in("id", categoryIds),
      supabase
        .from("result_splits")
        .select("result_row_id,elapsed_time_ms,sequence_number")
        .in("result_row_id", rowIds)
        .order("sequence_number", { ascending: true }),
      supabase
        .from("result_publications")
        .select("event_category_id,result_run_id,publication_state,published_at")
        .in("event_category_id", categoryIds)
        .in("publication_state", ["official", "corrected"])
        .order("published_at", { ascending: false }),
    ]);

    const latestPublishedRunByCategory = new Map<string, string>();
    for (const publication of publications ?? []) {
      if (!latestPublishedRunByCategory.has(publication.event_category_id)) {
        latestPublishedRunByCategory.set(publication.event_category_id, publication.result_run_id);
      }
    }
    const publishedResultRows = resultRows.filter((row) => (
      ["official", "corrected"].includes(row.result_status)
      && (
        latestPublishedRunByCategory.size === 0
        || latestPublishedRunByCategory.get(row.event_category_id) === row.result_run_id
      )
    ));

    if (!publishedResultRows.length) {
      return emptyReadModel;
    }

    const editionIds = Array.from(new Set((categories ?? []).map((category) => category.event_edition_id)));
    const { data: editions } = editionIds.length
      ? await supabase.from("event_editions").select("id,slug,name,start_date,cover_image_url").in("id", editionIds)
      : { data: [] };
    const eventPreviewMediaBySlug = await loadPublicEventPreviewMedia(supabase, editions ?? []);

    const categoryById = new Map((categories ?? []).map((category) => [category.id, category]));
    const editionById = new Map((editions ?? []).map((edition) => [edition.id, edition]));
    const splitsByRowId = new Map<string, Array<{ elapsed_time_ms: number | null }>>();

    for (const split of splits ?? []) {
      const current = splitsByRowId.get(split.result_row_id) ?? [];
      current.push({ elapsed_time_ms: split.elapsed_time_ms });
      splitsByRowId.set(split.result_row_id, current);
    }

    const categoryResultCounts = new Map<string, number>();
    const { data: categoryCounts } = await supabase
      .from("result_rows")
      .select("event_category_id")
      .in("event_category_id", categoryIds);

    for (const row of categoryCounts ?? []) {
      categoryResultCounts.set(row.event_category_id, (categoryResultCounts.get(row.event_category_id) ?? 0) + 1);
    }

    const mappedResultsWithMetrics = publishedResultRows.map((row) => {
      const category = categoryById.get(row.event_category_id);
      const edition = category?.event_edition_id ? editionById.get(category.event_edition_id) : undefined;
      const previewMedia = edition?.slug ? eventPreviewMediaBySlug.get(edition.slug) : null;
      return {
        id: row.id,
        eventSlug: edition?.slug ?? "",
        event: edition?.name ?? "Trail Race",
        eventImageUrl: previewMedia?.coverImageUrl ?? previewMedia?.linkedTrackImageUrl ?? null,
        category: category?.name ?? "Category",
        distanceKm: numberFromUnknown(category?.distance_km),
        date: edition?.start_date ? format(new Date(`${edition.start_date}T00:00:00`), "MMM d, yyyy") : "TBA",
        place: row.rank_overall ?? 0,
        totalRunners: categoryResultCounts.get(row.event_category_id) ?? 0,
        time: formatElapsedTimeFromMs(row.finish_time_ms),
        pace: formatPace(category?.distance_km, row.finish_time_ms),
        status: normalizeAthleteResultOutcome(null, row.finish_time_ms),
        finishTimeMs: row.finish_time_ms == null ? null : Number(row.finish_time_ms),
        splits: (splitsByRowId.get(row.id) ?? []).map((split) => formatElapsedTimeFromMs(split.elapsed_time_ms)),
      };
    }).sort((left, right) => {
      const leftDate = Date.parse(left.date);
      const rightDate = Date.parse(right.date);
      return (Number.isNaN(rightDate) ? 0 : rightDate) - (Number.isNaN(leftDate) ? 0 : leftDate);
    });
    const performance = summarizeAthletePerformance(mappedResultsWithMetrics);
    const mappedResults: AthleteResultItem[] = mappedResultsWithMetrics.map(({ finishTimeMs: _finishTimeMs, ...result }) => result);

    return {
      seasonStats: {
        totalParticipations: performance.totalParticipations,
        totalRaces: performance.totalRaces,
        totalFinishes: performance.totalFinishes,
        podiums: performance.podiums,
        wins: performance.wins,
        avgFinish: formatElapsedTimeFromMs(performance.averageFinishMs),
      },
      results: mappedResults,
    };
  } catch (error) {
    console.warn("Unable to load public athlete results", error);
    return emptyReadModel;
  }
}

export async function getAthleteBadgesReadModel(
  athleteSlug: string = "",
): Promise<AthleteBadgesReadModel> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return emptyAthleteBadgesReadModel;
  }

  if (!athleteSlug.trim()) {
    return emptyAthleteBadgesReadModel;
  }

  try {
    const { data: athlete, error: athleteError } = await supabase
      .from("public_athlete_profiles")
      .select("id")
      .eq("slug", athleteSlug)
      .maybeSingle();

    if (athleteError || !athlete) {
      throw athleteError ?? new Error(`Athlete ${athleteSlug} not found`);
    }

    const [{ data: definitions, error: definitionError }, { data: awards, error: awardError }] =
      await Promise.all([
        supabase
          .from("badge_definitions")
          .select("id,slug,name,description,tier,icon_key,sort_order")
          .eq("scope", "athlete")
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        supabase
          .from("athlete_badges")
          .select("badge_definition_id,progress_percent,earned_at,context_json")
          .eq("athlete_profile_id", athlete.id),
      ]);

    if (definitionError || awardError) {
      throw definitionError ?? awardError;
    }

    if (!definitions?.length) {
      return emptyAthleteBadgesReadModel;
    }

    const awardsByDefinitionId = new Map(
      (awards ?? []).map((award) => [award.badge_definition_id, award]),
    );

    const earned: AthleteBadgeItem[] = [];
    const inProgress: AthleteBadgeItem[] = [];

    for (const definition of definitions) {
      const award = awardsByDefinitionId.get(definition.id);
      if (!award) continue;

      const visual = getLegacyBadgeVisualSpec({
        id: definition.slug,
        name: definition.name,
        iconKey: definition.icon_key ?? "award",
        tier: definition.tier,
      });

      const badge: AthleteBadgeItem = {
        id: definition.slug,
        name: definition.name,
        description: definition.description,
        iconKey: definition.icon_key ?? "award",
        tier: definition.tier,
        state: visual.state,
        visual,
      };

      if (award.earned_at) {
        const displayDate =
          typeof award.context_json?.display_date === "string"
            ? award.context_json.display_date
            : format(new Date(award.earned_at), "MMM d, yyyy");

        earned.push({
          ...badge,
          status: "earned",
          earnedDate: displayDate,
        });
      } else {
        inProgress.push({
          ...badge,
          status: "in-progress",
          progress: award.progress_percent,
        });
      }
    }

    return {
      earned,
      inProgress,
    };
  } catch (error) {
    console.warn("Unable to load athlete badges", error);
    return emptyAthleteBadgesReadModel;
  }
}

export async function getPublicResultsPageReadModel(): Promise<PublicResultsPageReadModel> {
  const supabase = getSupabasePublicClient();
  if (!supabase) {
    return emptyPublicResultsReadModel;
  }

  try {
    const { data: latestPublication, error: publicationError } = await supabase
      .from("result_publications")
      .select("event_category_id,publication_state,published_at")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (publicationError) {
      throw publicationError;
    }

    if (!latestPublication) {
      return emptyPublicResultsReadModel;
    }

    const { data: anchorCategory, error: categoryError } = await supabase
      .from("event_categories")
      .select("id,event_edition_id,name")
      .eq("id", latestPublication.event_category_id)
      .maybeSingle();

    if (categoryError || !anchorCategory) {
      throw categoryError ?? new Error("Published category not found");
    }

    const [{ data: edition }, { data: categories, error: categoriesError }] = await Promise.all([
      supabase
        .from("event_editions")
        .select("id,slug,name,start_date")
        .eq("id", anchorCategory.event_edition_id)
        .maybeSingle(),
      supabase
        .from("event_categories")
        .select("id,name,results_mode,ranking_config_json")
        .eq("event_edition_id", anchorCategory.event_edition_id)
        .order("distance_km", { ascending: false }),
    ]);

    const competitiveCategories = (categories ?? []).filter((category) => category.results_mode !== "informative_age");

    if (!edition || categoriesError || !competitiveCategories.length) {
      throw categoriesError ?? new Error("No result categories found");
    }

    const categoryIds = competitiveCategories.map((category) => category.id);
    const { data: publications, error: publicationsError } = await supabase
      .from("result_publications")
      .select("event_category_id,result_run_id,published_at")
      .in("event_category_id", categoryIds)
      .order("published_at", { ascending: false });

    if (publicationsError) {
      throw publicationsError;
    }

    const latestPublicationByCategory = new Map<string, { result_run_id: string; published_at: string }>();
    for (const publication of publications ?? []) {
      if (!latestPublicationByCategory.has(publication.event_category_id)) {
        latestPublicationByCategory.set(publication.event_category_id, {
          result_run_id: publication.result_run_id,
          published_at: publication.published_at,
        });
      }
    }

    const resultRunIds = Array.from(
      new Set(Array.from(latestPublicationByCategory.values()).map((publication) => publication.result_run_id)),
    );
    const { data: rows, error: rowsError } = resultRunIds.length
      ? await supabase
          .from("result_rows")
          .select("id,result_run_id,registration_id,athlete_profile_id,event_category_id,result_status,finish_time_ms,rank_overall,rank_gender,rank_age_category,represented_club_id")
          .in("result_run_id", resultRunIds)
          .order("rank_overall", { ascending: true })
      : { data: [], error: null };

    if (rowsError) {
      throw rowsError ?? new Error("No result rows found");
    }

    const rowIds = rows.map((row) => row.id);
    const athleteIds = Array.from(new Set(rows.map((row) => row.athlete_profile_id)));
    const clubIds = Array.from(new Set(rows.map((row) => row.represented_club_id).filter(Boolean)));
    const registrationIds = Array.from(new Set(rows.map((row) => row.registration_id)));

    const [{ data: athletes }, { data: clubs }, { data: bibs }, { data: splits }] = await Promise.all([
      athleteIds.length
        ? supabase.from("public_athlete_profiles").select("id,slug,display_name,gender,date_of_birth,country_code").in("id", athleteIds)
        : Promise.resolve({ data: [] }),
      clubIds.length ? supabase.from("clubs").select("id,name").in("id", clubIds) : Promise.resolve({ data: [] }),
      registrationIds.length
        ? supabase
            .from("bib_assignments")
            .select("registration_id,bib_number")
            .in("registration_id", registrationIds)
            .is("revoked_at", null)
        : Promise.resolve({ data: [] }),
      rowIds.length
        ? supabase
            .from("result_splits")
            .select("result_row_id,elapsed_time_ms,sequence_number")
            .in("result_row_id", rowIds)
            .order("sequence_number", { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);

    const athleteById = new Map((athletes ?? []).map((athlete) => [athlete.id, athlete]));
    const clubById = new Map((clubs ?? []).map((club) => [club.id, club.name]));
    const bibByRegistrationId = new Map((bibs ?? []).map((bib) => [bib.registration_id, String(bib.bib_number)]));
    const categoryById = new Map(
      competitiveCategories.map((category) => [
        category.id,
        {
          label: category.name,
          rankingConfig: normalizeCompetitiveRankingConfig(category.ranking_config_json),
        },
      ]),
    );
    const splitsByRowId = new Map<string, string[]>();

    for (const split of splits ?? []) {
      const current = splitsByRowId.get(split.result_row_id) ?? [];
      current.push(formatElapsedTimeFromMs(split.elapsed_time_ms));
      splitsByRowId.set(split.result_row_id, current);
    }

    const rowsByCategory: Record<string, PublicResultsRow[]> = {};
    const teamRowsByCategory = new Map<
      string,
      Array<{ clubId: string | null; clubName: string; athleteName: string; overall: number }>
    >();
    for (const category of competitiveCategories) {
      rowsByCategory[category.id] = [];
      teamRowsByCategory.set(category.id, []);
    }

    for (const row of rows) {
      const athlete = athleteById.get(row.athlete_profile_id);
      const category = categoryById.get(row.event_category_id);
      if (!category) continue;
      const clubName = normalizePublicResultClubName(
        row.represented_club_id ? clubById.get(row.represented_club_id) : null,
      );
      const mappedRow: PublicResultsRow = {
        bib: bibByRegistrationId.get(row.registration_id) ?? "—",
        name: athlete?.display_name ?? "Trail Runner",
        athleteSlug: athlete?.slug ?? "athletes",
        countryCode: athlete?.country_code?.trim().toUpperCase() || null,
        club: clubName,
        time: formatElapsedTimeFromMs(row.finish_time_ms),
        splits: splitsByRowId.get(row.id) ?? [],
        status: row.result_status === "void" ? "dsq" : row.finish_time_ms ? "finished" : "dns",
        gender: normalizeRankingGender(athlete?.gender) ?? "U",
        ageOnEventDate: ageOnRaceDay(athlete?.date_of_birth, edition.start_date),
        ageGroupLabel: ageGroupLabelForConfig(category.rankingConfig, athlete?.date_of_birth, edition.start_date),
        genderRank: row.rank_gender ?? 0,
        ageRank: row.rank_age_category ?? 0,
        overall: row.rank_overall ?? 0,
      };

      rowsByCategory[row.event_category_id].push(mappedRow);
      const existingTeamRows = teamRowsByCategory.get(row.event_category_id) ?? [];
      existingTeamRows.push({
        clubId: row.represented_club_id ?? null,
        clubName,
        athleteName: mappedRow.name,
        overall: mappedRow.overall,
      });
      teamRowsByCategory.set(row.event_category_id, existingTeamRows);
    }

    const teamStandingsByCategory = Object.fromEntries(
      competitiveCategories.map((category) => [
        category.id,
        buildCompetitiveTeamStandings(
          teamRowsByCategory.get(category.id) ?? [],
          normalizeCompetitiveRankingConfig(category.ranking_config_json),
        ),
      ]),
    );

    return {
      eventSlug: edition.slug,
      eventName: edition.name,
      publicationState: latestPublication.publication_state,
      categories: competitiveCategories.map((category) => ({
        id: category.id,
        label: category.name,
        rankingConfig: normalizeCompetitiveRankingConfig(category.ranking_config_json),
      })),
      rowsByCategory,
      teamStandingsByCategory,
    };
  } catch (error) {
    console.warn("Unable to load public results page", error);
    return emptyPublicResultsReadModel;
  }
}

export async function getPublicEventResultsReadModel(
  editionId: string,
): Promise<PublicEventResultsReadModel> {
  const emptyState: PublicEventResultsReadModel = {
    eventSlug: "",
    eventName: "",
    hasPublishedResults: false,
    categories: [],
  };

  const supabase = getSupabasePublicClient();
  if (!supabase || !editionId) {
    return emptyState;
  }

  try {
    const [
      { data: edition, error: editionError },
      { data: categories, error: categoriesError },
      { data: publicParticipants, error: publicParticipantsError },
      { data: publicResultSplits, error: publicResultSplitsError },
    ] = await Promise.all([
      supabase
        .from("event_editions")
        .select("id,slug,name,start_date")
        .eq("id", editionId)
        .maybeSingle(),
      supabase
        .from("event_categories")
        .select("id,name,results_mode,ranking_config_json,display_order,status,distance_km")
        .eq("event_edition_id", editionId)
        .order("display_order", { ascending: true })
        .order("distance_km", { ascending: false }),
      loadDedupedPublicEventParticipants(editionId, () => (
        supabase.rpc("public_event_participants", {
          target_event_edition_id: editionId,
        })
      )),
      supabase.rpc("public_event_result_splits", {
        target_event_edition_id: editionId,
      }),
    ]);

    if (editionError) throw editionError;
    if (categoriesError) throw categoriesError;
    if (publicParticipantsError) throw publicParticipantsError;
    if (publicResultSplitsError) throw publicResultSplitsError;

    const competitiveCategories = (categories ?? []).filter((category) => (
      category.status !== "draft" && category.results_mode !== "informative_age"
    ));
    if (!edition || !competitiveCategories.length) {
      return {
        eventSlug: edition?.slug ?? "",
        eventName: edition?.name ?? "",
        hasPublishedResults: false,
        categories: [],
      };
    }

    const categoryIds = competitiveCategories.map((category) => category.id);
    const currentResultRows = await getCurrentPublishedResultRows({ eventCategoryIds: categoryIds });
    const latestPublicationByCategory = new Map<string, {
      published_at: string;
      publication_state: string;
    }>();
    for (const result of currentResultRows) {
      const current = latestPublicationByCategory.get(result.eventCategoryId);
      if (!current || result.publishedAt > current.published_at) {
        latestPublicationByCategory.set(result.eventCategoryId, {
          published_at: result.publishedAt,
          publication_state: result.publicationState,
        });
      }
    }
    const publicParticipantRows = (publicParticipants ?? []) as PublicEventParticipantAgeRpcRow[];
    const publicParticipantByResultIdentity = new Map(
      publicParticipantRows.map((participant) => [
        `${participant.athlete_profile_id}:${participant.event_category_id}`,
        participant,
      ]),
    );
    const publicLifecycleByCategoryId = new Map<string, {
      publicationState: string;
      publishedAt: string | null;
    }>();
    for (const participant of publicParticipantRows) {
      if (!participant.publication_state || publicLifecycleByCategoryId.has(participant.event_category_id)) continue;
      publicLifecycleByCategoryId.set(participant.event_category_id, {
        publicationState: participant.publication_state,
        publishedAt: participant.published_at,
      });
    }

    const athleteIds = Array.from(new Set([
      ...currentResultRows.map((row) => row.athleteProfileId),
      ...publicParticipantRows.map((row) => row.athlete_profile_id),
    ]));
    const clubIds = Array.from(
      new Set(currentResultRows.map((row) => row.representedClubId).filter((value): value is string => Boolean(value))),
    );
    const [{ data: athletes, error: athletesError }, { data: clubs, error: clubsError }] = await Promise.all([
        athleteIds.length
          ? supabase.from("public_athlete_profiles").select("id,slug,display_name,gender,date_of_birth,country_code").in("id", athleteIds)
          : Promise.resolve({ data: [], error: null }),
        clubIds.length ? supabase.from("clubs").select("id,name").in("id", clubIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (athletesError) throw athletesError;
    if (clubsError) throw clubsError;

    const athleteById = new Map((athletes ?? []).map((athlete) => [athlete.id, athlete]));
    const clubById = new Map((clubs ?? []).map((club) => [club.id, club.name]));
    const publicAgeCategoryByRegistrationId = new Map(
      publicParticipantRows.map((participant) => [
        participant.registration_id,
        participant.age_category_label,
      ]),
    );
    const rankingConfigByCategoryId = new Map(
      competitiveCategories.map((category) => [category.id, normalizeCompetitiveRankingConfig(category.ranking_config_json)]),
    );
    const splitDetailsByRegistrationId = new Map<string, PublicResultSplit[]>();
    for (const split of (publicResultSplits ?? []) as PublicEventResultSplitRpcRow[]) {
      const details = splitDetailsByRegistrationId.get(split.registration_id) ?? [];
      details.push({
        checkpointId: split.checkpoint_id,
        checkpointName: split.checkpoint_name ?? `Checkpoint ${split.sequence_number}`,
        checkpointType: split.checkpoint_type ?? "checkpoint",
        sequenceNumber: split.sequence_number,
        recordedAt: split.recorded_at,
        elapsedTimeMs: split.elapsed_time_ms,
        splitTimeMs: split.split_time_ms,
        elapsedLabel: formatElapsedTimeFromMs(split.elapsed_time_ms),
        splitLabel: formatElapsedTimeFromMs(split.split_time_ms),
      });
      splitDetailsByRegistrationId.set(split.registration_id, details);
    }
    for (const details of splitDetailsByRegistrationId.values()) {
      details.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    }

    const rowsByCategory = new Map<string, PublicResultsRow[]>();
    const teamRowsByCategory = new Map<
      string,
      Array<{ clubId: string | null; clubName: string; athleteName: string; overall: number }>
    >();
    const mappedRegistrationIds = new Set<string>();

    for (const category of competitiveCategories) {
      rowsByCategory.set(category.id, []);
      teamRowsByCategory.set(category.id, []);
    }

    for (const row of currentResultRows) {
      const athlete = athleteById.get(row.athleteProfileId);
      const publicParticipant = publicParticipantByResultIdentity.get(
        `${row.athleteProfileId}:${row.eventCategoryId}`,
      );
      const rankingConfig = rankingConfigByCategoryId.get(row.eventCategoryId);
      if (!rankingConfig) continue;

      const clubName = normalizePublicResultClubName(
        publicParticipant?.club_name
          ?? (row.representedClubId ? clubById.get(row.representedClubId) : null),
      );
      const registrationId = publicParticipant?.registration_id ?? row.resultRowId;
      const splitDetails = splitDetailsByRegistrationId.get(registrationId) ?? [];
      const mappedRow: PublicResultsRow = {
        resultRowId: row.resultRowId,
        registrationId,
        bib: publicParticipant?.bib_number ?? "—",
        name: publicParticipant?.athlete_name ?? athlete?.display_name ?? "Trail Runner",
        athleteSlug: publicParticipant?.athlete_slug ?? athlete?.slug ?? "athletes",
        countryCode: athlete?.country_code?.trim().toUpperCase() || null,
        club: clubName,
        time: formatElapsedTimeFromMs(row.finishTimeMs),
        finishTimeMs: row.finishTimeMs,
        gapMs: row.gapMs,
        splits: splitDetails.map((split) => split.elapsedLabel),
        splitDetails,
        status: mapPublicResultStatus(
          row.participationStatus ?? publicParticipant?.participation_status,
          row.resultStatus,
          row.finishTimeMs,
        ),
        gender: normalizeRankingGender(publicParticipant?.gender ?? athlete?.gender) ?? "U",
        ageOnEventDate: ageOnRaceDay(athlete?.date_of_birth, edition.start_date),
        ageGroupLabel: publicAgeCategoryByRegistrationId.get(registrationId)
          ?? ageGroupLabelForConfig(rankingConfig, athlete?.date_of_birth, edition.start_date),
        genderRank: row.rankGender ?? 0,
        ageRank: row.rankAgeCategory ?? 0,
        overall: row.rankOverall ?? 0,
      };
      if (publicParticipant) mappedRegistrationIds.add(publicParticipant.registration_id);

      const nextRows = rowsByCategory.get(row.eventCategoryId) ?? [];
      nextRows.push(mappedRow);
      rowsByCategory.set(row.eventCategoryId, nextRows);

      const nextTeamRows = teamRowsByCategory.get(row.eventCategoryId) ?? [];
      nextTeamRows.push({
        clubId: row.representedClubId ?? publicParticipant?.club_slug ?? null,
        clubName,
        athleteName: mappedRow.name,
        overall: mappedRow.overall,
      });
      teamRowsByCategory.set(row.eventCategoryId, nextTeamRows);
    }

    const visibleResultStatuses = new Set([
      "started",
      "finished",
      "dnf",
      "dns",
      "dsq",
      "withdrawn",
      "stopped",
      "evacuated",
      "missing",
      "not_started",
      "checked_in",
    ]);
    for (const participant of publicParticipantRows) {
      if (
        mappedRegistrationIds.has(participant.registration_id)
        || !participant.publication_state
        || !rankingConfigByCategoryId.has(participant.event_category_id)
        || (
          participant.finish_time_ms == null
          && !visibleResultStatuses.has(participant.participation_status ?? "")
        )
      ) {
        continue;
      }
      if (
        participant.publication_state === "live"
        && !["started", "finished", "dnf", "dsq", "stopped", "withdrawn", "evacuated", "missing"]
          .includes(participant.participation_status ?? "")
      ) {
        continue;
      }

      const splitDetails = splitDetailsByRegistrationId.get(participant.registration_id) ?? [];
      const athlete = athleteById.get(participant.athlete_profile_id);
      const mappedRow: PublicResultsRow = {
        registrationId: participant.registration_id,
        bib: participant.bib_number ?? "—",
        name: participant.athlete_name ?? "Trail Runner",
        athleteSlug: participant.athlete_slug ?? "athletes",
        countryCode: athlete?.country_code?.trim().toUpperCase() || null,
        club: normalizePublicResultClubName(participant.club_name),
        time: formatElapsedTimeFromMs(participant.finish_time_ms),
        finishTimeMs: participant.finish_time_ms,
        gapMs: null,
        splits: splitDetails.map((split) => split.elapsedLabel),
        splitDetails,
        status: mapPublicResultStatus(
          participant.participation_status,
          participant.result_status,
          participant.finish_time_ms,
        ),
        gender: normalizeRankingGender(participant.gender) ?? "U",
        ageOnEventDate: null,
        ageGroupLabel: participant.age_category_label,
        genderRank: participant.rank_gender ?? 0,
        ageRank: participant.rank_age_category ?? 0,
        overall: participant.rank_overall ?? 0,
      };
      const nextRows = rowsByCategory.get(participant.event_category_id) ?? [];
      nextRows.push(mappedRow);
      rowsByCategory.set(participant.event_category_id, nextRows);

      const nextTeamRows = teamRowsByCategory.get(participant.event_category_id) ?? [];
      nextTeamRows.push({
        clubId: participant.club_slug ?? null,
        clubName: mappedRow.club,
        athleteName: mappedRow.name,
        overall: mappedRow.overall,
      });
      teamRowsByCategory.set(participant.event_category_id, nextTeamRows);
    }

    for (const categoryRows of rowsByCategory.values()) {
      categoryRows.sort((left, right) => {
        if (left.overall > 0 && right.overall > 0) return left.overall - right.overall;
        if (left.overall > 0) return -1;
        if (right.overall > 0) return 1;
        return left.name.localeCompare(right.name);
      });
    }

    const mappedCategories = competitiveCategories.map((category) => {
      const rankingConfig = rankingConfigByCategoryId.get(category.id) ?? defaultCompetitiveRankingConfig();
      const publication = latestPublicationByCategory.get(category.id);
      const publicLifecycle = publicLifecycleByCategoryId.get(category.id);
      return {
        id: category.id,
        label: category.name,
        rankingConfig,
        standingClassifications: rankingConfig.classifications.map((classification) => ({
          id: classification.key,
          label: classification.label,
          gender: classification.gender,
          minimumAge: classification.minimumAge,
          maximumAge: classification.maximumAge,
        })),
        distanceKm: numberFromUnknown(category.distance_km),
        publicationState: publication?.publication_state ?? publicLifecycle?.publicationState ?? null,
        publishedAt: publication?.published_at ?? publicLifecycle?.publishedAt ?? null,
        rows: rowsByCategory.get(category.id) ?? [],
        teamStandings: buildCompetitiveTeamStandings(teamRowsByCategory.get(category.id) ?? [], rankingConfig),
      } satisfies PublicEventResultsCategory;
    });

    return {
      eventSlug: edition.slug,
      eventName: edition.name,
      hasPublishedResults: mappedCategories.some((category) => category.rows.length > 0),
      categories: mappedCategories,
    };
  } catch (error) {
    console.warn("Unable to load public race results", error);
    throw error;
  }
}

export async function getPublicEventParticipantsReadModel(
  editionId: string,
): Promise<PublicEventParticipantsReadModel> {
  const emptyState: PublicEventParticipantsReadModel = {
    eventSlug: "",
    eventName: "",
    hasPublishedResults: false,
    rows: [],
  };

  const supabase = getSupabasePublicClient();
  if (!supabase || !editionId) {
    return emptyState;
  }

  try {
    const [{ data: edition, error: editionError }, { data: rows, error: rowsError }] = await Promise.all([
      supabase
        .from("event_editions")
        .select("id,slug,name")
        .eq("id", editionId)
        .maybeSingle(),
      loadDedupedPublicEventParticipants(editionId, () => (
        supabase.rpc("public_event_participants", {
          target_event_edition_id: editionId,
        })
      )),
    ]);

    if (!edition || editionError || rowsError) {
      throw editionError ?? rowsError ?? new Error("No public race participants found");
    }

    const athleteIds = Array.from(new Set((rows ?? []).map((row) => row.athlete_profile_id).filter(Boolean)));
    const { data: athletes, error: athletesError } = athleteIds.length
      ? await supabase
          .from("public_athlete_profiles")
          .select("id,country_code")
          .in("id", athleteIds)
      : { data: [], error: null };
    if (athletesError) throw athletesError;
    const countryCodeByAthleteId = new Map(
      (athletes ?? []).map((athlete) => [athlete.id, athlete.country_code?.trim().toUpperCase() || null]),
    );

    const mappedRows = (rows ?? []).map((row) => ({
      registrationId: row.registration_id,
      athleteId: row.athlete_profile_id,
      categoryId: row.event_category_id,
      categorySlug: row.event_category_slug,
      categoryLabel: row.event_category_name,
      bib: row.bib_number ?? "—",
      name: row.athlete_name ?? "Trail Runner",
      athleteSlug: row.athlete_slug || "athletes",
      countryCode: countryCodeByAthleteId.get(row.athlete_profile_id) ?? null,
      club: normalizePublicResultClubName(row.club_name),
      clubSlug: row.club_slug || null,
      gender: normalizeRankingGender(row.gender) ?? "U",
      classificationLabel: row.classification_label?.trim() || "Open",
      ageCategory: formatUniversalAgeCategoryLabel(row.age_category_label),
      registrationStatus: row.registration_status ?? "confirmed",
      participationStatus: row.participation_status ?? "not_started",
      resultStatus: row.result_status ?? "uncomputed",
      publicationState: row.publication_state ?? null,
      publishedAt: row.published_at ?? null,
      time: formatElapsedTimeFromMs(row.finish_time_ms),
      finishTimeMs: row.finish_time_ms,
      overall: row.rank_overall ?? 0,
      genderRank: row.rank_gender ?? 0,
      ageRank: row.rank_age_category ?? 0,
    })) satisfies PublicEventParticipantRow[];

    return {
      eventSlug: edition.slug,
      eventName: edition.name,
      hasPublishedResults: mappedRows.some((row) => row.publicationState != null || row.overall > 0),
      rows: mappedRows,
    };
  } catch (error) {
    console.warn("Unable to load public race participants", error);
    throw error;
  }
}

export async function getPublicLiveEditionReadModel(
  eventEditionId: string,
): Promise<PublicLiveEditionReadModel | null> {
  const supabase = getSupabasePublicClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("read_public_live_edition", {
      p_event_edition_id: eventEditionId,
    });
    if (error) throw error;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as PublicLiveEditionReadModel;
  } catch (error) {
    console.warn("Unable to load delayed public live state", error);
    return null;
  }
}

export type RaceCardStatus = EventCardStatus;
export type RaceArchiveBadge = EventArchiveBadge;
export type PortalRaceCatalogItem = PortalEventCatalogItem;
export type PublicRaceParticipantsReadModel = PublicEventParticipantsReadModel;
export type PublicRaceResultsCategory = PublicEventResultsCategory;
export type PublicRaceResultsReadModel = PublicEventResultsReadModel;

export const getDynamicRacesCatalog = getDynamicEventsCatalog;
export const getPublicRaceParticipantsReadModel = getPublicEventParticipantsReadModel;
export const getPublicRaceResultsReadModel = getPublicEventResultsReadModel;
