import { type RaceFeePeriod } from "@raceson/domain/categories";
import { apiDownload, apiRequest } from "@/lib/api";
import { resolveOrganizerEventMedia } from "@/features/events/organizer/model/eventMedia";
import { resolveOrganizerTrackMedia } from "@/features/tracks/organizer/model/trackMedia";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { AuthAccountContext } from "@/lib/auth";
import {
  normalizeLeagueClubScoringScope,
  type LeagueClubScoringScope,
} from "@raceson/domain/leagues";
import {
  normalizeEventActivityType,
  type EventActivityType,
} from "@raceson/domain/activities";
import { DEFAULT_SPORT_CODE, type SportCode } from "@raceson/domain/sports";
import {
  defaultCompetitiveRankingConfig,
  normalizeCompetitiveRankingConfig,
  type CompetitiveRankingConfig,
  type CompetitiveTeamStanding,
} from "@/lib/ranking-config";

export type OrganizerManagedCategory = {
  id: string;
  slug: string;
  name: string;
  coverImageUrl?: string | null;
  sportCode: SportCode;
  categoryType: "competitive" | "informative";
  courseFormat?: "standard" | "laps";
  lapCount?: number;
  rankingConfig: CompetitiveRankingConfig;
  distanceKm: number | null;
  elevationGainM: number | null;
  capacity: number | null;
  feeCents: number | null;
  feePeriods?: RaceFeePeriod[];
  currency: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  allowedGenders: Array<"F" | "M" | "U">;
  eligibilityNote: string | null;
  startAt: string | null;
  parkingLabel: string | null;
  organizerNotes: string | null;
  displayOrder: number;
  status: string;
  latestPublicationState?: "provisional" | "official" | "corrected" | null;
  finishedWithoutResults?: boolean;
  registrationCount: number;
  trackTemplateId: string | null;
  trackVersionId: string | null;
  checkpoints: OrganizerManagedCheckpoint[];
};

export type OrganizerCheckpointSettings = {
  kind:
    | "checkpoint"
    | "water"
    | "refreshment"
    | "medical"
    | "marshal"
    | "danger_point"
    | "route_split"
    | "route_merge"
    | "summit"
    | "scenic_point"
    | "timing_split";
  typeTags?: Array<
    | "checkpoint"
    | "water"
    | "refreshment"
    | "medical"
    | "marshal"
    | "danger_point"
    | "route_split"
    | "route_merge"
    | "summit"
    | "scenic_point"
    | "timing_split"
  >;
  visibleOnPublicPage: boolean;
  isTimingSplit: boolean;
  isWaterPoint: boolean;
  medicalAccess: boolean;
  volunteerNote: string | null;
  athleteNote: string | null;
};

export type OrganizerManagedCheckpoint = {
  id: string;
  code: string;
  name: string;
  checkpointType: string;
  sequenceNumber: number;
  distanceFromStartKm: number | null;
  cutoffAt: string | null;
  isMandatory: boolean;
  settings: OrganizerCheckpointSettings;
};

export type OrganizerManagedEventLocation = {
  id: string;
  type: string;
  label: string;
  description: string | null;
  place: string | null;
  lat: number | null;
  lng: number | null;
  displayOrder: number;
};

export type OrganizerManagedEventTimelineItem = {
  time: string;
  description: string;
};

export type OrganizerManagedRaceView = OrganizerManagedCategory & {
  raceId: string;
  raceSlug: string;
  raceName: string;
  raceStartAt: string | null;
  raceDisplayOrder: number;
};

export type OrganizerManagedEvent = {
  id: string;
  slug: string;
  seriesId: string;
  seriesSlug: string;
  organizationId: string;
  organizationName: string | null;
  sportCodes: SportCode[];
  primarySportCode: SportCode;
  activityType: EventActivityType;
  name: string;
  createdAt: string;
  startDate: string;
  endDate: string | null;
  timezone: string;
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
  locationName: string | null;
  description: string | null;
  aboutText: string | null;
  organizerRules?: string | null;
  status: string;
  isPractice: boolean;
  isRecurrenceGenerated?: boolean;
  recurrenceRuleId?: string | null;
  recurrenceSourceEventEditionId?: string | null;
  recurrenceSourceDate?: string | null;
  publishedAt: string | null;
  isPublic: boolean;
  publicVisibility: "private" | "public" | "club_members";
  registrationAccess: "open" | "club_members";
  eligibleClubIds: string[];
  coverImageUrl: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  generalTimeline: OrganizerManagedEventTimelineItem[];
  locations: OrganizerManagedEventLocation[];
  categories: OrganizerManagedCategory[];
  totalRegistrations: number;
  totalCapacity: number;
  leagueSeasonId: string | null;
  leagueName: string | null;
  roundNumber: number | null;
  totalRounds: number | null;
};

export type OrganizerManagedEventSummary = {
  id: string;
  slug: string;
  organizationName: string | null;
  sportCodes: SportCode[];
  primarySportCode: SportCode;
  activityType: EventActivityType;
  name: string;
  startDate: string;
  endDate: string | null;
  locationName: string | null;
  status: string;
  isPractice: boolean;
  publishedAt: string | null;
  isPublic: boolean;
  coverImageUrl: string | null;
  competitiveRaceCount: number;
  totalRegistrations: number;
  totalCapacity: number;
  leagueSeasonId: string | null;
  leagueName: string | null;
  roundNumber: number | null;
};

export type OrganizerEventEligibleClubOption = {
  id: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  logoImageUrl: string | null;
};

export type OrganizerEventPublishReadiness = {
  ready: boolean;
  communications?: { ready: boolean; savedCount: number };
  blockers: Array<{
    key: string;
    code: string;
    message: string;
    categoryId?: string;
    categoryName?: string;
    overridable: boolean;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    categoryId?: string;
    categoryName?: string;
  }>;
};

export type OrganizerLeagueRound = {
  id: string;
  roundNumber: number;
  eventEditionId: string;
  eventName: string;
  eventSlug: string;
  eventDate: string;
  eventCategoryId: string;
  categoryName: string;
  status: string;
  mappings: OrganizerLeagueRaceMapping[];
  excludedCourseIds?: string[];
};

export type OrganizerLeagueRaceMapping = {
  id: string;
  competitionId: string;
  competitionName: string;
  eventCategoryId: string;
  categoryName: string;
  status: string;
};

export type OrganizerLeagueScoringRules = {
  name: string | null;
  pointsTable: number[];
  fieldSizeProfile: string;
  participationPoints: number;
  scoringMethod: "geometric" | "hybrid" | "custom";
  scoringParameters: {
    maximumPoints?: number;
    expectedFinishers?: number;
    hybridEmphasis?: "inclusive" | "balanced" | "competitive";
  } | null;
  bestN: number | null;
  minimumRounds: number | null;
  tieBreakMethod: string | null;
  clubScoringMode: string | null;
};

export type OrganizerLeagueClassification = {
  id: string;
  slug: string;
  name: string;
  eligibility: Record<string, unknown>;
  awardDepth: number | null;
  displayOrder: number;
  isDefault: boolean;
  status: string;
};

export type OrganizerLeagueCompetition = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scoringTarget: "individual" | "club";
  resultBasis: string;
  standingsMode: "points" | "best_time" | "participation" | "none";
  displayOrder: number;
  isDefault: boolean;
  status: string;
  classifications: OrganizerLeagueClassification[];
  scoringRules: OrganizerLeagueScoringRules | null;
};

export type OrganizerManagedLeagueSeason = {
  leagueId: string;
  seasonId: string;
  slug: string;
  name: string;
  sportCodes: SportCode[];
  primarySportCode: SportCode;
  description: string | null;
  organizerNotes: string | null;
  organizerRules?: string | null;
  status: string;
  year: number;
  startsOn: string | null;
  endsOn: string | null;
  timezone: string;
  clubScoringScope: LeagueClubScoringScope;
  seasonName: string;
  seasonStatus: string;
  publishedAt: string | null;
  isPublic: boolean;
  rounds: OrganizerLeagueRound[];
  competitions: OrganizerLeagueCompetition[];
  scoringRules: OrganizerLeagueScoringRules | null;
};

export type RecreationalLeagueScheduleRule = {
  id: string;
  seasonId: string;
  eventSeriesId: string;
  sourceEventEditionId: string | null;
  trackTemplateId: string;
  trackVersionId: string;
  name: string;
  validFrom: string;
  validUntil: string;
  weekdays: number[];
  localStartTime: string;
  timezone: string;
  registrationOpenDaysBefore: number | null;
  registrationCloseMinutesBefore: number;
  locationName: string | null;
  status: string;
  categories: Array<{
    id: string;
    competitionId: string;
    sourceEventCategoryId: string | null;
    trackTemplateId: string;
    trackVersionId: string;
    slug: string;
    name: string;
    sportCode: SportCode;
    distanceKm: number | null;
    selectionGroupKey: string | null;
    resultsMode: string;
  }>;
  overrides: Array<{
    id: string;
    sourceDate: string;
    action: "skip" | "cancel" | "reschedule";
    replacementDate?: string | null;
    replacementLocalStartTime?: string | null;
    reason?: string | null;
  }>;
  occurrences: Array<{
    id: string;
    sourceDate: string;
    scheduledDate: string;
    localStartTime: string;
    state: string;
    eventEditionId: string | null;
    leagueRoundEventId: string | null;
    failureMessage: string | null;
  }>;
  previewCount: number;
};

export type LegacyImportReviewWorkspace = {
  batches: Array<{
    id: string;
    sourceLabel: string;
    status: string;
    summary: Record<string, unknown>;
    athleteReviewCount: number;
    pendingAthleteReviewCount: number;
    eventReviewCount: number;
    pendingEventReviewCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type OrganizerManagedTrack = {
  templateId: string;
  slug: string;
  name: string;
  sportCode: SportCode;
  terrainType: string | null;
  notes: string | null;
  publicOverview: string | null;
  locationLabel: string | null;
  seasonLabel: string | null;
  parkingLabel: string | null;
  weatherLocationLabel: string | null;
  bestTimeLabel: string | null;
  latestVersionId: string;
  latestVersionNumber: number;
  latestVersionPublishedAt: string | null;
  latestPublishedVersionId: string | null;
  sourceFileName: string | null;
  hasGpxSource: boolean;
  distanceKm: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  difficultyLevel: number | null;
  surfaceSummary: string | null;
  safetyNotes: string | null;
  waterPointCount: number;
  segments: OrganizerTrackSegment[];
  galleryPreviewImageUrl: string | null;
  galleryItems: OrganizerTrackGalleryItem[];
  routePoints: Array<{ lat: number; lng: number }>;
  elevationPoints: Array<{ distKm: number; elev: number; grade?: number | null; lat?: number | null; lng?: number | null }>;
  checkpoints: OrganizerTrackCheckpoint[];
  publishedAt: string | null;
  isPublic: boolean;
  categoryLinkCount: number;
  eventLinkCount: number;
  leagueScheduleLinkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type OrganizerManagedTrackSummary = Omit<
  OrganizerManagedTrack,
  "galleryItems" | "routePoints" | "elevationPoints" | "checkpoints"
>;

export type OrganizerTrackCommunityComment = {
  id: string;
  reviewId: string;
  authorAthleteProfileId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type OrganizerTrackCommunityReview = {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  createdAt: string;
  helpfulCount: number;
  notHelpfulCount: number;
  comments: OrganizerTrackCommunityComment[];
};

export type OrganizerEventCommunitySummary = {
  eventEditionId: string;
  reviewCount: number;
  commentCount: number;
  latestActivityAt: string | null;
};

export type OrganizerTrackGalleryItem = {
  id: string;
  imageUrl: string;
  storagePath?: string | null;
  caption: string | null;
  isDefault: boolean;
};

export type OrganizerTrackSegment = {
  id: string;
  name: string;
  type: "climb" | "descent" | "flat";
  startKm: number;
  endKm: number;
  startElev: number;
  endElev: number;
  avgGrade: number;
  difficulty: "easy" | "moderate" | "hard" | "extreme";
  comment?: string | null;
  showOnPublic?: boolean;
};

export type OrganizerTrackCheckpointType =
  | "start"
  | "finish"
  | "checkpoint"
  | "water"
  | "refreshment"
  | "medical"
  | "marshal"
  | "danger_point"
  | "route_split"
  | "route_merge"
  | "summit"
  | "scenic_point"
  | "timing_split";

export type OrganizerTrackCheckpoint = {
  name: string;
  km: number;
  elev: number;
  lat: number;
  lng: number;
  type: OrganizerTrackCheckpointType;
  typeTags?: OrganizerTrackCheckpointType[];
};

const ORGANIZER_TRACK_CHECKPOINT_TYPES = new Set<OrganizerTrackCheckpointType>([
  "start",
  "finish",
  "checkpoint",
  "water",
  "refreshment",
  "medical",
  "marshal",
  "danger_point",
  "route_split",
  "route_merge",
  "summit",
  "scenic_point",
  "timing_split",
]);

function normalizeOrganizerTrackSegments(value: unknown): OrganizerTrackSegment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : null;
    const type =
      record.type === "climb" || record.type === "descent" || record.type === "flat"
        ? record.type
        : null;
    const difficulty =
      record.difficulty === "easy" ||
      record.difficulty === "moderate" ||
      record.difficulty === "hard" ||
      record.difficulty === "extreme"
        ? record.difficulty
        : null;
    const startKm = typeof record.startKm === "number" ? record.startKm : Number(record.startKm);
    const endKm = typeof record.endKm === "number" ? record.endKm : Number(record.endKm);
    const startElev = typeof record.startElev === "number" ? record.startElev : Number(record.startElev);
    const endElev = typeof record.endElev === "number" ? record.endElev : Number(record.endElev);
    const avgGrade = typeof record.avgGrade === "number" ? record.avgGrade : Number(record.avgGrade);

    if (!name || !type || !difficulty) return [];
    if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || !Number.isFinite(startElev) || !Number.isFinite(endElev) || !Number.isFinite(avgGrade)) {
      return [];
    }

    return [{
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `segment-${index + 1}`,
      name,
      type,
      startKm,
      endKm,
      startElev,
      endElev,
      avgGrade,
      difficulty,
      comment: typeof record.comment === "string" && record.comment.trim() ? record.comment.trim() : null,
      showOnPublic: typeof record.showOnPublic === "boolean" ? record.showOnPublic : true,
    }];
  });
}

function normalizeTrackGalleryItems(value: unknown): OrganizerTrackGalleryItem[] {
  if (!Array.isArray(value)) return [];

  let defaultAssigned = false;
  const items = value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const imageUrl = typeof record.imageUrl === "string" && record.imageUrl.trim() ? record.imageUrl.trim() : null;
    if (!imageUrl) return [];

    const isDefault = typeof record.isDefault === "boolean" ? record.isDefault : false;
    const storagePath =
      typeof record.storagePath === "string" && record.storagePath.trim()
        ? record.storagePath.trim()
        : null;

    const nextItem = {
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `gallery-${index + 1}`,
      imageUrl,
      storagePath,
      caption: typeof record.caption === "string" && record.caption.trim() ? record.caption.trim() : null,
      isDefault: isDefault && !defaultAssigned,
    };

    if (nextItem.isDefault) defaultAssigned = true;

    return [nextItem];
  });

  if (!items.length) return [];
  if (items.some((item) => item.isDefault)) return items;

  return items.map((item, index) => (index === 0 ? { ...item, isDefault: true } : item));
}

function normalizeOrganizerEventTimeline(value: unknown): OrganizerManagedEventTimelineItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const time = typeof record.time === "string" && record.time.trim().length ? record.time.trim() : null;
    const description =
      typeof record.description === "string" && record.description.trim().length
        ? record.description.trim()
        : null;
    if (!time || !description) return [];
    return [{ time, description }];
  });
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function summarizeBounds(routePoints: Array<{ lat: number; lng: number }>) {
  const latitudes = routePoints.map((point) => point.lat);
  const longitudes = routePoints.map((point) => point.lng);
  return {
    south: Math.min(...latitudes),
    west: Math.min(...longitudes),
    north: Math.max(...latitudes),
    east: Math.max(...longitudes),
  };
}

function sanitizeGpxFileName(fileName: string | null | undefined, fallbackSlug: string) {
  const normalized = (fileName ?? "").trim().replace(/[/\\]+/g, "-");
  const basename = normalized || `${fallbackSlug}.gpx`;
  return basename.toLowerCase().endsWith(".gpx") ? basename : `${basename}.gpx`;
}

function formatGpxNumber(value: number, precision = 6) {
  return Number(value).toFixed(precision).replace(/\.?0+$/, "");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildTrackGpxDocument(input: {
  name: string;
  routePoints: Array<{ lat: number; lng: number }>;
  elevationPoints?: Array<{ elev?: number | null; lat?: number | null; lng?: number | null }>;
  checkpoints?: Array<{ name: string; lat: number; lng: number; elev?: number | null; type?: string | null; km?: number | null }>;
}) {
  const trackPointsXml = input.routePoints
    .map((point, index) => {
      const elevationPoint = input.elevationPoints?.[index];
      const elevation =
        elevationPoint && typeof elevationPoint.elev === "number" && Number.isFinite(elevationPoint.elev)
          ? `\n        <ele>${formatGpxNumber(elevationPoint.elev, 1)}</ele>`
          : "";
      return `      <trkpt lat="${formatGpxNumber(point.lat)}" lon="${formatGpxNumber(point.lng)}">${elevation}\n      </trkpt>`;
    })
    .join("\n");

  const checkpointsXml = (input.checkpoints ?? [])
    .map((checkpoint) => {
      const elevation =
        typeof checkpoint.elev === "number" && Number.isFinite(checkpoint.elev)
          ? `\n    <ele>${formatGpxNumber(checkpoint.elev, 1)}</ele>`
          : "";
      const commentParts = [
        checkpoint.type ? `type:${checkpoint.type}` : null,
        checkpoint.km != null ? `km:${formatGpxNumber(checkpoint.km, 2)}` : null,
      ].filter(Boolean);
      const comment = commentParts.length ? `\n    <cmt>${escapeXml(commentParts.join(" | "))}</cmt>` : "";
      return `  <wpt lat="${formatGpxNumber(checkpoint.lat)}" lon="${formatGpxNumber(checkpoint.lng)}">\n    <name>${escapeXml(checkpoint.name)}</name>${elevation}${comment}\n  </wpt>`;
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="RacesOn" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata>`,
    `    <name>${escapeXml(input.name)}</name>`,
    `  </metadata>`,
    checkpointsXml,
    `  <trk>`,
    `    <name>${escapeXml(input.name)}</name>`,
    `    <trkseg>`,
    trackPointsXml,
    `    </trkseg>`,
    `  </trk>`,
    `</gpx>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCacheRoutePoints(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ lat: number; lng: number }>;

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const lat = numberFromUnknown((entry as Record<string, unknown>).lat);
      const lng = numberFromUnknown((entry as Record<string, unknown>).lng);
      if (lat == null || lng == null) return null;
      return { lat, lng };
    })
    .filter((point): point is { lat: number; lng: number } => Boolean(point));
}

function renderCacheElevationPoints(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ elev: number; lat: number | null; lng: number | null }>;

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const elev = numberFromUnknown(record.elev);
      if (elev == null) return null;

      return {
        elev,
        lat: numberFromUnknown(record.lat),
        lng: numberFromUnknown(record.lng),
      };
    })
    .filter(Boolean) as Array<{ elev: number; lat: number | null; lng: number | null }>;
}

function renderCacheTrackElevationProfile(value: unknown): OrganizerManagedTrack["elevationPoints"] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const distKm = numberFromUnknown(record.distKm);
      const elev = numberFromUnknown(record.elev);
      if (distKm == null || elev == null) return null;

      return {
        distKm,
        elev,
        grade: numberFromUnknown(record.grade),
        lat: numberFromUnknown(record.lat),
        lng: numberFromUnknown(record.lng),
      };
    })
    .filter(Boolean) as OrganizerManagedTrack["elevationPoints"];
}

function renderCacheTrackCheckpoints(value: unknown): OrganizerTrackCheckpoint[] {
  return normalizeTrackSnapshotCheckpoints(value).flatMap((checkpoint) => (
    checkpoint.km == null || checkpoint.elev == null || checkpoint.lat == null || checkpoint.lng == null
      ? []
      : [{
          name: checkpoint.name,
          km: checkpoint.km,
          elev: checkpoint.elev,
          lat: checkpoint.lat,
          lng: checkpoint.lng,
          type: checkpoint.type,
          typeTags: checkpoint.typeTags,
        }]
  ));
}

function numberOrNull(value: unknown) {
  if (value == null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function optionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeEventVisibility(
  value: string | null | undefined,
): "private" | "public" | "club_members" {
  if (value === "public" || value === "club_members") return value;
  return "private";
}

function isSchemaCompatError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; details?: string };
  const message = `${record.message ?? ""} ${record.details ?? ""}`.toLowerCase();
  return (
    record.code === "42P01" ||
    record.code === "42703" ||
    record.code === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("could not find the")
  );
}

export type OrganizerRegistrationRecord = {
  quotedFeeCents?: number | null;
  outstandingCents?: number | null;
  feeCurrency?: string | null;
  id: string;
  eventEditionId: string;
  eventCategoryId: string;
  athleteProfileId: string;
  athleteName: string;
  athleteFirstName: string;
  athleteLastName: string;
  categoryName: string;
  clubName: string | null;
  countryCode: string | null;
  gender: "F" | "M" | null;
  dateOfBirth: string | null;
  ageOnRaceDay: number | null;
  sexCategory: string | null;
  ageCategory: string | null;
  classificationName: string | null;
  status: string;
  paymentStatus: string;
  participationStatus: string;
  createdAt: string;
  confirmedAt: string | null;
  bibNumber: string | null;
  checkedInAt?: string | null;
  paymentEvidenceCount: number;
};

export type OrganizerOnsiteAthleteMatch = {
  athleteProfileId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  birthYear: number | null;
  city: string | null;
  countryCode: string | null;
  emailHint: string | null;
  isClaimed: boolean;
  exactNameMatch: boolean;
  exactDateOfBirthMatch: boolean;
  registeredCategoryIds: string[];
};

export type CreateOrganizerOnsiteRegistrationInput = {
  eventCategoryId: string;
  existingAthleteProfileId?: string | null;
  firstName: string;
  lastName: string;
  email?: string | null;
  dateOfBirth: string;
  gender: "F" | "M" | "U";
  city?: string | null;
  countryCode?: string | null;
  phone?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  bibNumber?: string | null;
  publicStartListOptIn?: boolean;
  organizerAttested: true;
  idempotencyKey: string;
};

export type OrganizerRaceDayState = {
  edition: {
    id: string;
    slug: string;
    name: string;
    startDate: string;
    locationName: string | null;
    status: string;
    isPractice: boolean;
  };
  categories: Array<{
    id: string;
    name: string;
    status: string;
    courseFormat?: "standard" | "laps";
    lapCount?: number;
    registrationCount: number;
    checkedInCount: number;
    activeSessionId: string | null;
    latestPublicationState: string | null;
    effectiveStartAt?: string | null;
    resultInputVersion?: string | null;
    checkpoints: Array<{
      id: string;
      code: string;
      name: string;
      checkpointType: string;
      sequenceNumber: number;
      expectedPassesPerAthlete?: number;
      expectedCount: number;
      passedCount: number;
    }>;
  }>;
  sessions: Array<{
    id: string;
    eventCategoryId: string | null;
    categoryName: string | null;
    checkpointId: string | null;
    checkpointName: string | null;
    mode: string;
    status: string;
    startedAt: string;
    closedAt: string | null;
    punchCount: number;
  }>;
  expectedAthletes: Array<{
    registrationId: string;
    eventCategoryId: string;
    firstName: string;
    lastName: string;
    displayName: string;
    bibNumber: string | null;
    participationStatus: string;
    checkpointPasses: Array<{
      checkpointId: string;
      recordedAt: string;
    }>;
  }>;
  recentPunches: Array<{
    id: string;
    eventCategoryId: string;
    checkpointId: string;
    registrationId: string | null;
    bibNumber: string | null;
    athleteName: string | null;
    categoryName: string | null;
    checkpointName: string;
    recordedAt: string;
    passNumber?: number | null;
    expectedPassCount?: number;
    completesRace?: boolean;
    warnings: Array<{
      code: "unresolved_bib" | "duplicate_checkpoint" | "wrong_sequence" | "cutoff_exceeded";
      message: string;
    }>;
  }>;
  unresolvedPunches: Array<{
    id: string;
    eventCategoryId: string;
    checkpointId: string;
    registrationId: string | null;
    bibNumber: string | null;
    athleteName: string | null;
    categoryName: string | null;
    checkpointName: string;
    recordedAt: string;
    warnings: Array<{
      code: "unresolved_bib" | "duplicate_checkpoint" | "wrong_sequence" | "cutoff_exceeded";
      message: string;
    }>;
  }>;
};

export type PracticeRaceState = {
  editionId: string;
  organizationId: string;
  name: string;
  isPractice: true;
  totalRunners: number;
  bibAssignedCount: number;
  checkedInCount: number;
  startedCategoryCount: number;
  finishPunchCount: number;
  finishedRunnerCount: number;
  timingReadinessState: "draft" | "planned" | "ready" | "failed";
  teamAssignmentCount: number;
  baselineRunnerCount: number;
  runnerLimit: number;
  categories: Array<{
    id: string;
    name: string;
    runnerCount: number;
    bibStart: number;
    bibEnd: number;
  }>;
};

export type OrganizerTimingSessionDetail = {
  session: OrganizerRaceDayState["sessions"][number];
  punches: OrganizerRaceDayState["recentPunches"];
};

export type OrganizerCategoryResults = {
  calculationMode?: "imported_snapshot" | "native_timing";
  category: {
    id: string;
    name: string;
    eventEditionId: string;
    distanceKm: number | null;
    sportCode?: string;
    rankingConfig: CompetitiveRankingConfig;
  };
  checkpoints: Array<{
    id: string;
    name: string;
    sequenceNumber: number;
    checkpointType: string;
  }>;
  publication: {
    id: string;
    publicationState: string;
    resultRunId: string;
    publishedAt: string;
  } | null;
  publicationWorkflow?: {
    publicationId: string;
    workflowEventId: string;
    leagueState: "not_applicable" | "waiting_for_sources" | "ready" | "pending";
    affectedSeasonIds: string[];
    standingsVersionIds: string[];
    pendingSeasonIds: string[];
    replayed: boolean;
  };
  selectedRun: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    summary: Record<string, unknown>;
  } | null;
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    summary: Record<string, unknown>;
  }>;
  rows: Array<{
    id: string;
    registrationId: string;
    athleteName: string;
    countryCode?: string | null;
    gender: string | null;
    clubName: string | null;
    bibNumber: string | null;
    participationStatus?: string;
    ageGroupLabel: string | null;
    rankOverall: number | null;
    rankGender: number | null;
    rankAgeCategory: number | null;
    finishTimeMs: number | null;
    gapMs: number | null;
    resultStatus: string;
    points: number | null;
    splits: Array<{
      checkpointId: string;
      checkpointName: string;
      sequenceNumber: number;
      elapsedTimeMs: number | null;
      splitTimeMs: number | null;
      punchEventId?: string | null;
      recordedAt?: string | null;
    }>;
  }>;
  anomalies: Array<{
    id: string;
    registrationId: string | null;
    punchEventId: string | null;
    code: string;
    severity: "info" | "warning" | "error" | "critical";
    state: "open" | "resolved" | "waived";
    message: string;
    evidence: Record<string, unknown>;
    resolutionNote: string | null;
  }>;
  complaints: Array<{
    id: string;
    eventCategoryId: string;
    registrationId: string | null;
    bibNumber: string | null;
    complainantName: string;
    complaintText: string;
    status: "open" | "resolved" | "dismissed";
    resolutionNote: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  teamStandings: CompetitiveTeamStanding[];
};

export type OrganizerEventInput = {
  name: string;
  editionLabel?: string | null;
  organizationId?: string | null;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  activityType?: EventActivityType;
  startDate: string;
  endDate?: string | null;
  timezone?: string;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  locationName?: string | null;
  description?: string | null;
  aboutText?: string | null;
  organizerRules?: string | null;
  publicVisibility?: "private" | "public" | "club_members";
  registrationAccess?: "open" | "club_members";
  eligibleClubIds?: string[];
  coverImageUrl?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  generalTimeline?: Array<{
    time: string;
    description: string;
  }>;
  locations?: Array<{
    type: string;
    label: string;
    description?: string | null;
    place?: string | null;
    lat?: number | null;
    lng?: number | null;
  }>;
  status?: string;
};

export function composeOrganizerEventName(name: string, editionLabel?: string | null) {
  const baseName = name.trim();
  const edition = editionLabel?.trim() ?? "";
  if (!baseName) return edition;
  if (!edition) return baseName;
  return `${baseName} ${edition}`;
}

export function splitOrganizerEventName(displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return {
      name: "",
      editionLabel: "",
    };
  }

  const match = trimmed.match(/^(.*?)(?:\s+)(20\d{2}|#?\d{1,3}|No\.\s*\d+)$/i);
  if (!match || !match[1]?.trim()) {
    return {
      name: trimmed,
      editionLabel: "",
    };
  }

  return {
    name: match[1].trim(),
    editionLabel: match[2].trim(),
  };
}

export type OrganizerCategoryInput = {
  name: string;
  idempotencyKey?: string;
  coverImageUrl?: string | null;
  sportCode?: SportCode;
  categoryType?: "competitive" | "informative";
  courseFormat?: "standard" | "laps";
  lapCount?: number;
  rankingConfig?: CompetitiveRankingConfig | null;
  distanceKm?: number | null;
  elevationGainM?: number | null;
  capacity?: number | null;
  feeCents?: number | null;
  feePeriods?: RaceFeePeriod[];
  currency?: string | null;
  minimumAge?: number | null;
  maximumAge?: number | null;
  allowedGenders?: Array<"F" | "M" | "U">;
  eligibilityNote?: string | null;
  startAt?: string | null;
  parkingLabel?: string | null;
  organizerNotes?: string | null;
  displayOrder?: number;
  status?: string;
};

export type OrganizerLeagueScoringRulesInput = {
  name?: string | null;
  pointsTable?: number[];
  fieldSizeProfile?: string | null;
  participationPoints?: number | null;
  scoringMethod?: "geometric" | "hybrid" | "custom" | null;
  scoringParameters?: {
    maximumPoints: number;
    expectedFinishers: number;
    hybridEmphasis?: "inclusive" | "balanced" | "competitive";
  } | null;
  bestN?: number | null;
  minimumRounds?: number | null;
  tieBreakMethod?: string | null;
  clubScoringMode?: string | null;
};

export type OrganizerLeagueCompetitionInput = {
  name: string;
  slug?: string;
  isDefault?: boolean;
  description?: string | null;
  scoringTarget?: "individual" | "club";
  resultBasis?: string;
  standingsMode?: "points" | "best_time" | "participation" | "none";
  scoringRules?: OrganizerLeagueScoringRulesInput | null;
  classifications?: Array<{
    name: string;
    slug?: string;
    eligibility?: Record<string, unknown>;
    awardDepth?: number | null;
    isDefault?: boolean;
  }>;
};

export type OrganizerLeagueInput = {
  organizationId?: string;
  name: string;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  description?: string | null;
  organizerNotes?: string | null;
  organizerRules?: string | null;
  year?: number;
  startsOn?: string | null;
  endsOn?: string | null;
  timezone?: string;
  clubScoringScope?: LeagueClubScoringScope;
  status?: string;
  scoringRules?: OrganizerLeagueScoringRulesInput | null;
  competitions?: OrganizerLeagueCompetitionInput[];
};

export type OrganizerTrackInput = {
  organizationId?: string;
  name: string;
  sportCode?: SportCode;
  terrainType?: string | null;
  notes?: string | null;
  publicOverview?: string | null;
  locationLabel?: string | null;
  seasonLabel?: string | null;
  parkingLabel?: string | null;
  weatherLocationLabel?: string | null;
  bestTimeLabel?: string | null;
  surfaceSummary?: string | null;
  safetyNotes?: string | null;
  waterPointCount?: number | null;
  segments?: OrganizerTrackSegment[];
  galleryItems?: OrganizerTrackGalleryItem[];
  sourceFileName?: string | null;
  gpxXml?: string | null;
  gpxStoragePath?: string | null;
  routePoints?: Array<{ lat: number; lng: number }>;
  elevationPoints?: Array<{ distKm: number; elev: number; grade?: number | null; lat?: number | null; lng?: number | null }>;
  checkpoints: OrganizerTrackCheckpoint[];
  distanceKm?: number | null;
  elevationGainM?: number | null;
  elevationLossM?: number | null;
  difficultyLevel?: number | null;
};

export type OrganizerTrackUpdateInput = {
  trackTemplateId: string;
  name?: string;
  sportCode?: SportCode;
  terrainType?: string | null;
  notes?: string | null;
  publicOverview?: string | null;
  locationLabel?: string | null;
  seasonLabel?: string | null;
  parkingLabel?: string | null;
  weatherLocationLabel?: string | null;
  bestTimeLabel?: string | null;
  surfaceSummary?: string | null;
  safetyNotes?: string | null;
  waterPointCount?: number | null;
  segments?: OrganizerTrackSegment[];
  galleryItems?: OrganizerTrackGalleryItem[];
  sourceFileName?: string | null;
  gpxXml?: string | null;
  gpxStoragePath?: string | null;
  routePoints?: Array<{ lat: number; lng: number }>;
  elevationPoints?: Array<{ distKm: number; elev: number; grade?: number | null; lat?: number | null; lng?: number | null }>;
  checkpoints?: OrganizerTrackCheckpoint[];
  distanceKm?: number | null;
  elevationGainM?: number | null;
  elevationLossM?: number | null;
  difficultyLevel?: number | null;
};

export type OrganizerCategoryTrackInput = {
  trackTemplateId: string;
  trackVersionId?: string | null;
};

export type OrganizerCheckpointUpdateInput = {
  checkpointId: string;
  name?: string;
  cutoffAt?: string | null;
  isMandatory?: boolean;
  settings?: Partial<OrganizerCheckpointSettings>;
};

export type OrganizerCheckpointSyncInput = {
  categoryId: string;
  checkpoints: Array<{
    checkpointId: string | null;
    name: string;
    distanceFromStartKm: number;
    cutoffAt?: string | null;
    isMandatory?: boolean;
    settings?: Partial<OrganizerCheckpointSettings>;
  }>;
};

export type OrganizerLeagueRoundInput = {
  eventEditionId?: string;
  eventCategoryId?: string;
  raceCountMismatchAcknowledged?: boolean;
  excludedCourseIds?: string[];
  mappings?: Array<{
    competitionId: string;
    eventCategoryId: string;
  }>;
  roundNumber?: number;
  status?: string;
};

function requireClient() {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error("Supabase is not configured.");
  }
  return client;
}

type BrowserSupabaseClient = ReturnType<typeof requireClient>;

function getOrganizerTrackClient(account: AuthAccountContext | null | undefined) {
  if (!account?.hasOrganizerAccess || !account.organizationIds.length) {
    return null;
  }

  return getSupabaseBrowserClient();
}

function isPermissionLikeError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; message?: string; details?: string };
  const message = `${record.message ?? ""} ${record.details ?? ""}`.toLowerCase();
  return (
    record.code === "42501" ||
    message.includes("permission denied") ||
    message.includes("row-level security")
  );
}

function isTrackGpxSourceCompatError(error: unknown) {
  return isSchemaCompatError(error) || isPermissionLikeError(error);
}

async function loadTrackVersionSourceFileNames(
  client: BrowserSupabaseClient,
  trackVersionIds: string[],
) {
  if (!trackVersionIds.length) return [] as Array<{ track_version_id: string; file_name: string }>;

  try {
    const { data, error } = await client
      .from("track_version_gpx_sources")
      .select("track_version_id,file_name")
      .in("track_version_id", trackVersionIds);

    if (error) throw error;
    return (data ?? []) as Array<{ track_version_id: string; file_name: string }>;
  } catch (error) {
    if (isTrackGpxSourceCompatError(error)) return [];
    throw error;
  }
}

function ensureOrganizerAccount(
  account: AuthAccountContext | null | undefined,
): asserts account is AuthAccountContext & { hasOrganizerAccess: true; organizationIds: [string, ...string[]] } {
  if (!account?.hasOrganizerAccess || !account.organizationIds.length) {
    throw new Error("Organizer access is required.");
  }
}

function organizerWorkspaceQuery(
  account: AuthAccountContext | null | undefined,
) {
  const organizationId = account?.organizationIds[0]?.trim();
  return organizationId
    ? `?organization=${encodeURIComponent(organizationId)}`
    : "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64) || "item";
}

function mapCategoryType(resultsMode: string | null | undefined): OrganizerManagedCategory["categoryType"] {
  return resultsMode === "informative_age" ? "informative" : "competitive";
}

function mapResultsMode(categoryType: OrganizerManagedCategory["categoryType"] | null | undefined) {
  return categoryType === "informative" ? "informative_age" : "standard";
}

function defaultCheckpointSettings(checkpointType: string): OrganizerCheckpointSettings {
  const kind = checkpointType === "split" ? "timing_split" : "checkpoint";
  return {
    kind,
    typeTags: [kind],
    visibleOnPublicPage: true,
    isTimingSplit: checkpointType === "split",
    isWaterPoint: false,
    medicalAccess: false,
    volunteerNote: null,
    athleteNote: null,
  };
}

function normalizeCheckpointSettings(
  input: unknown,
  checkpointType: string,
): OrganizerCheckpointSettings {
  const fallback = defaultCheckpointSettings(checkpointType);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fallback;
  }

  const record = input as Record<string, unknown>;
  const kinds = new Set<OrganizerCheckpointSettings["kind"]>([
    "checkpoint",
    "water",
    "refreshment",
    "medical",
    "marshal",
    "danger_point",
    "route_split",
    "route_merge",
    "summit",
    "scenic_point",
    "timing_split",
  ]);
  const kind =
    typeof record.kind === "string" && kinds.has(record.kind as OrganizerCheckpointSettings["kind"])
      ? (record.kind as OrganizerCheckpointSettings["kind"])
      : fallback.kind;
  const typeTags = Array.isArray(record.typeTags)
    ? record.typeTags.filter(
        (tag): tag is NonNullable<OrganizerCheckpointSettings["typeTags"]>[number] =>
          typeof tag === "string" && kinds.has(tag as OrganizerCheckpointSettings["kind"]),
      )
    : [];

  return {
    kind,
    typeTags: typeTags.length ? typeTags : [kind],
    visibleOnPublicPage:
      typeof record.visibleOnPublicPage === "boolean" ? record.visibleOnPublicPage : fallback.visibleOnPublicPage,
    isTimingSplit:
      typeof record.isTimingSplit === "boolean" ? record.isTimingSplit : fallback.isTimingSplit,
    isWaterPoint:
      typeof record.isWaterPoint === "boolean" ? record.isWaterPoint : fallback.isWaterPoint,
    medicalAccess:
      typeof record.medicalAccess === "boolean" ? record.medicalAccess : fallback.medicalAccess,
    volunteerNote:
      typeof record.volunteerNote === "string" && record.volunteerNote.trim().length
        ? record.volunteerNote.trim()
        : null,
    athleteNote:
      typeof record.athleteNote === "string" && record.athleteNote.trim().length
        ? record.athleteNote.trim()
        : null,
  };
}

type TrackSnapshotCheckpoint = {
  name: string;
  km: number | null;
  elev: number | null;
  lat: number | null;
  lng: number | null;
  type: OrganizerTrackCheckpointType;
  typeTags: OrganizerTrackCheckpointType[];
};

function normalizeTrackSnapshotCheckpoints(value: unknown): TrackSnapshotCheckpoint[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== "string" || !ORGANIZER_TRACK_CHECKPOINT_TYPES.has(type as OrganizerTrackCheckpointType)) {
      return [];
    }

    const typeTags = Array.isArray(record.typeTags)
      ? record.typeTags.filter(
          (tag): tag is OrganizerTrackCheckpointType =>
            typeof tag === "string" && ORGANIZER_TRACK_CHECKPOINT_TYPES.has(tag as OrganizerTrackCheckpointType),
        )
      : [];

    return [{
      name: typeof record.name === "string" && record.name.trim().length ? record.name.trim() : type.toUpperCase(),
      km: numberOrNull(record.km),
      elev: numberOrNull(record.elev),
      lat: numberOrNull(record.lat),
      lng: numberOrNull(record.lng),
      type: type as OrganizerTrackCheckpointType,
      typeTags: typeTags.length ? typeTags : [type as OrganizerTrackCheckpointType],
    }];
  });
}

function checkpointTypeForSnapshot(type: TrackSnapshotCheckpoint["type"]) {
  return type === "start" || type === "finish" ? type : "split";
}

function checkpointCodePrefixForKind(kind: OrganizerCheckpointSettings["kind"]) {
  switch (kind) {
    case "timing_split":
      return "TIM";
    case "water":
      return "WTR";
    case "refreshment":
      return "AID";
    case "medical":
      return "MED";
    case "marshal":
      return "MAR";
    case "danger_point":
      return "DNG";
    case "route_split":
      return "SPL";
    case "route_merge":
      return "MRG";
    case "summit":
      return "SUM";
    case "scenic_point":
      return "VIEW";
    case "checkpoint":
    default:
      return "CP";
  }
}

function checkpointCodeForKind(
  kind: OrganizerCheckpointSettings["kind"],
  counters: Map<string, number>,
) {
  const prefix = checkpointCodePrefixForKind(kind);
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}${next}`;
}

export function organizerCategoryToRaceView(category: OrganizerManagedCategory): OrganizerManagedRaceView {
  return {
    ...category,
    raceId: category.id,
    raceSlug: category.slug,
    raceName: category.name,
    raceStartAt: category.startAt,
    raceDisplayOrder: category.displayOrder,
  };
}

async function uniqueScopedSlug(input: {
  table: "event_series" | "event_editions" | "event_categories" | "leagues" | "track_templates";
  scopeColumn: string;
  scopeValue: string;
  baseSlug: string;
}) {
  const client = requireClient();
  let candidate = input.baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await client
      .from(input.table)
      .select("id")
      .eq(input.scopeColumn, input.scopeValue)
      .eq("slug", candidate)
      .maybeSingle();

    if (error) throw error;
    if (!data) return candidate;

    candidate = `${input.baseSlug}-${suffix}`;
    suffix += 1;
  }
}

type OrganizerEventEditionExtraRow = {
  id: string;
  activity_type: string | null;
  is_practice: boolean;
  public_visibility: string | null;
  cover_image_url: string | null;
  about_text: string | null;
  organizer_rules: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  general_timeline_json: unknown;
};

type OrganizerRow = {
  id: string;
  name: string;
};

type OrganizerEventLocationRow = {
  id: string;
  event_edition_id: string;
  location_type: string;
  label: string;
  description: string | null;
  place_label: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  display_order: number | null;
};

async function loadOrganizerEventEditionExtras(client: ReturnType<typeof requireClient>, editionIds: string[]) {
  if (!editionIds.length) return [] as OrganizerEventEditionExtraRow[];

  try {
    const { data, error } = await client
      .from("event_editions")
      .select("id,activity_type,is_practice,public_visibility,cover_image_url,about_text,organizer_rules,website_url,instagram_url,facebook_url,general_timeline_json")
      .in("id", editionIds);

    if (error) throw error;
    return (data ?? []) as OrganizerEventEditionExtraRow[];
  } catch (error) {
    if (isSchemaCompatError(error)) return [];
    throw error;
  }
}

async function loadOrganizerEventLocations(client: ReturnType<typeof requireClient>, editionIds: string[]) {
  if (!editionIds.length) return [] as OrganizerEventLocationRow[];

  try {
    const { data, error } = await client
      .from("event_locations")
      .select("id,event_edition_id,location_type,label,description,place_label,latitude,longitude,display_order")
      .in("event_edition_id", editionIds)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (data ?? []) as OrganizerEventLocationRow[];
  } catch (error) {
    if (isSchemaCompatError(error)) return [];
    throw error;
  }
}

export async function getOrganizerEvents(
  account: AuthAccountContext | null | undefined,
): Promise<OrganizerManagedEvent[]> {
  if (account?.hasOrganizerAccess) {
    const events = await apiRequest<OrganizerManagedEvent[]>({
      path: `/v1/organizer/events${organizerWorkspaceQuery(account)}`,
    });
    return events.map(resolveOrganizerEventMedia);
  }

  const client = requireClient();
  if (!account?.hasOrganizerAccess || !account.organizationIds.length) {
    return [];
  }

  const { data: seriesRows, error: seriesError } = await client
    .from("event_series")
    .select("id,organization_id,slug,name,description,location_name")
    .in("organization_id", account.organizationIds)
    .order("created_at", { ascending: false });

  if (seriesError) throw seriesError;
  if (!seriesRows?.length) return [];

  const organizationIds = Array.from(new Set(seriesRows.map((row) => row.organization_id)));
  const organizationRows = organizationIds.length
    ? await client
        .from("organizations")
        .select("id,name")
        .in("id", organizationIds)
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []) as OrganizerRow[];
        })
    : [];

  const seriesIds = seriesRows.map((row) => row.id);
  const { data: editionRows, error: editionError } = await client
    .from("event_editions")
    .select("id,event_series_id,slug,name,created_at,start_date,end_date,timezone,location_name,registration_open_at,registration_close_at,status,published_at")
    .in("event_series_id", seriesIds)
    .order("start_date", { ascending: false });

  if (editionError) throw editionError;
  if (!editionRows?.length) return [];

  const editionIds = editionRows.map((row) => row.id);
  const [
    { data: categoryRows, error: categoryError },
    { data: roundRows, error: roundError },
    editionExtraRows,
    locationRows,
  ] = await Promise.all([
    client
      .from("event_categories")
      .select("id,event_edition_id,slug,name,cover_image_url,sport_code,distance_km,elevation_gain_m,capacity,registration_fee_cents,registration_fee_periods,currency,minimum_age,maximum_age,allowed_genders,eligibility_note,start_at,parking_label,organizer_notes,display_order,results_mode,status,ranking_config_json")
      .in("event_edition_id", editionIds)
      .order("display_order", { ascending: true })
      .order("distance_km", { ascending: true }),
    client
      .from("league_rounds")
      .select("id,league_season_id,event_edition_id,event_category_id,round_number,status")
      .in("event_edition_id", editionIds),
    loadOrganizerEventEditionExtras(client, editionIds),
    loadOrganizerEventLocations(client, editionIds),
  ]);

  if (categoryError) throw categoryError;
  if (roundError) throw roundError;

  const categories = categoryRows ?? [];
  const categoryIds = categories.map((row) => row.id);

  const [registrations, snapshots, checkpointRows] = await Promise.all([
    categoryIds.length
      ? client
          .from("registrations")
          .select("id,event_category_id,status")
          .in("event_category_id", categoryIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; event_category_id: string; status: string }>),
    categoryIds.length
      ? client
          .from("event_category_track_snapshots")
          .select("event_category_id,track_template_id,track_version_id")
          .in("event_category_id", categoryIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ event_category_id: string; track_template_id: string | null; track_version_id: string | null }>),
    categoryIds.length
      ? client
          .from("checkpoints")
          .select("id,event_category_id,code,name,checkpoint_type,sequence_number,distance_from_start_km,cutoff_at,is_mandatory,settings_json")
          .in("event_category_id", categoryIds)
          .order("sequence_number", { ascending: true })
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve(
          [] as Array<{
            id: string;
            event_category_id: string;
            code: string;
            name: string;
            checkpoint_type: string;
            sequence_number: number;
            distance_from_start_km: number | string | null;
            cutoff_at: string | null;
            is_mandatory: boolean;
            settings_json: unknown;
          }>,
        ),
  ]);

  const seasonIds = Array.from(new Set((roundRows ?? []).map((row) => row.league_season_id)));
  const seasonRows = seasonIds.length
    ? await client
        .from("league_seasons")
        .select("id,league_id,year,name,status")
        .in("id", seasonIds)
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        })
    : [];
  const leagueIds = Array.from(new Set(seasonRows.map((row) => row.league_id)));
  const leagueRows = leagueIds.length
    ? await client
        .from("leagues")
        .select("id,slug,name,description,status")
        .in("id", leagueIds)
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        })
    : [];

  const roundsBySeason = new Map<string, number>();
  const editionExtrasById = new Map(editionExtraRows.map((row) => [row.id, row]));
  const locationsByEditionId = new Map<string, OrganizerManagedEventLocation[]>();
  for (const location of locationRows) {
    const existing = locationsByEditionId.get(location.event_edition_id) ?? [];
    existing.push({
      id: location.id,
      type: location.location_type,
      label: location.label,
      description: location.description ?? null,
      place: location.place_label ?? null,
      lat: numberOrNull(location.latitude),
      lng: numberOrNull(location.longitude),
      displayOrder: location.display_order ?? existing.length,
    });
    locationsByEditionId.set(location.event_edition_id, existing);
  }
  for (const round of roundRows ?? []) {
    roundsBySeason.set(round.league_season_id, (roundsBySeason.get(round.league_season_id) ?? 0) + 1);
  }

  const registrationCountByCategory = new Map<string, number>();
  for (const registration of registrations) {
    if (!["pending", "confirmed"].includes(registration.status)) {
      continue;
    }
    registrationCountByCategory.set(
      registration.event_category_id,
      (registrationCountByCategory.get(registration.event_category_id) ?? 0) + 1,
    );
  }

  const snapshotByCategory = new Map<
    string,
    { track_template_id: string | null; track_version_id: string | null }
  >();
  for (const snapshot of snapshots) {
    snapshotByCategory.set(snapshot.event_category_id, snapshot);
  }

  const checkpointsByCategory = new Map<string, OrganizerManagedCheckpoint[]>();
  for (const checkpoint of checkpointRows) {
    const existing = checkpointsByCategory.get(checkpoint.event_category_id) ?? [];
    existing.push({
      id: checkpoint.id,
      code: checkpoint.code,
      name: checkpoint.name,
      checkpointType: checkpoint.checkpoint_type,
      sequenceNumber: checkpoint.sequence_number,
      distanceFromStartKm:
        checkpoint.distance_from_start_km != null ? Number(checkpoint.distance_from_start_km) : null,
      cutoffAt: checkpoint.cutoff_at,
      isMandatory: checkpoint.is_mandatory,
      settings: normalizeCheckpointSettings(checkpoint.settings_json, checkpoint.checkpoint_type),
    });
    checkpointsByCategory.set(checkpoint.event_category_id, existing);
  }

  const seriesById = new Map(seriesRows.map((row) => [row.id, row]));
  const organizationById = new Map(organizationRows.map((row) => [row.id, row]));
  const seasonById = new Map(seasonRows.map((row) => [row.id, row]));
  const leagueById = new Map(leagueRows.map((row) => [row.id, row]));

  const roundsByEditionId = new Map<string, typeof roundRows>();
  for (const round of roundRows ?? []) {
    const existing = roundsByEditionId.get(round.event_edition_id) ?? [];
    existing.push(round);
    roundsByEditionId.set(round.event_edition_id, existing);
  }

  const categoriesByEditionId = new Map<string, OrganizerManagedCategory[]>();
  for (const category of categories) {
    const snapshot = snapshotByCategory.get(category.id);
    const mapped: OrganizerManagedCategory = {
      id: category.id,
      slug: category.slug,
      name: category.name,
      coverImageUrl: optionalText(category.cover_image_url),
      sportCode: (category.sport_code as SportCode | null) ?? DEFAULT_SPORT_CODE,
      categoryType: mapCategoryType(category.results_mode),
      rankingConfig: normalizeCompetitiveRankingConfig(category.ranking_config_json),
      distanceKm: category.distance_km != null ? Number(category.distance_km) : null,
      elevationGainM: category.elevation_gain_m,
      capacity: category.capacity,
      feeCents: category.registration_fee_cents,
      feePeriods: category.registration_fee_periods ?? [],
      currency: category.currency,
      minimumAge: category.minimum_age,
      maximumAge: category.maximum_age,
      allowedGenders: category.allowed_genders,
      eligibilityNote: category.eligibility_note,
      startAt: category.start_at ?? null,
      parkingLabel: category.parking_label ?? null,
      organizerNotes: category.organizer_notes ?? null,
      displayOrder: category.display_order ?? 0,
      status: category.status,
      latestPublicationState: null,
      registrationCount: registrationCountByCategory.get(category.id) ?? 0,
      trackTemplateId: snapshot?.track_template_id ?? null,
      trackVersionId: snapshot?.track_version_id ?? null,
      checkpoints: checkpointsByCategory.get(category.id) ?? [],
    };
    const existing = categoriesByEditionId.get(category.event_edition_id) ?? [];
    existing.push(mapped);
    categoriesByEditionId.set(category.event_edition_id, existing);
  }

  return editionRows.map((edition) => {
    const series = seriesById.get(edition.event_series_id);
    const editionExtra = editionExtrasById.get(edition.id);
    const publicVisibility = normalizeEventVisibility(
      editionExtra?.public_visibility ?? (edition.published_at ? "public" : "private"),
    );
    const mappedCategories = (categoriesByEditionId.get(edition.id) ?? []).sort((left, right) => {
      if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
      return (right.distanceKm ?? 0) - (left.distanceKm ?? 0);
    });
    const totalRegistrations = mappedCategories.reduce(
      (sum, category) => sum + category.registrationCount,
      0,
    );
    const totalCapacity = mappedCategories.reduce(
      (sum, category) => sum + (category.capacity ?? 0),
      0,
    );
    const firstRound = (roundsByEditionId.get(edition.id) ?? [])
      .slice()
      .sort((left, right) => left.round_number - right.round_number)[0];
    const season = firstRound ? seasonById.get(firstRound.league_season_id) : null;
    const league = season ? leagueById.get(season.league_id) : null;

    return {
      id: edition.id,
      slug: edition.slug,
      seriesId: edition.event_series_id,
      seriesSlug: series?.slug ?? edition.slug,
      organizationId: series?.organization_id ?? "",
      organizationName: series ? organizationById.get(series.organization_id)?.name ?? null : null,
      sportCodes: [DEFAULT_SPORT_CODE],
      primarySportCode: DEFAULT_SPORT_CODE,
      activityType: normalizeEventActivityType(editionExtra?.activity_type),
      name: edition.name,
      createdAt: edition.created_at,
      startDate: edition.start_date,
      endDate: edition.end_date ?? null,
      timezone: edition.timezone,
      registrationOpenAt: edition.registration_open_at,
      registrationCloseAt: edition.registration_close_at,
      locationName: edition.location_name ?? series?.location_name ?? null,
      description: series?.description ?? null,
      aboutText: optionalText(editionExtra?.about_text),
      organizerRules: optionalText(editionExtra?.organizer_rules),
      status: edition.status,
      isPractice: editionExtra?.is_practice ?? false,
      publishedAt: edition.published_at ?? null,
      isPublic: Boolean(
        edition.published_at &&
        edition.status !== "draft" &&
        publicVisibility === "public",
      ),
      publicVisibility,
      registrationAccess: "open",
      eligibleClubIds: [],
      coverImageUrl: optionalText(editionExtra?.cover_image_url),
      websiteUrl: optionalText(editionExtra?.website_url),
      instagramUrl: optionalText(editionExtra?.instagram_url),
      facebookUrl: optionalText(editionExtra?.facebook_url),
      generalTimeline: normalizeOrganizerEventTimeline(editionExtra?.general_timeline_json),
      locations: locationsByEditionId.get(edition.id) ?? [],
      categories: mappedCategories,
      totalRegistrations,
      totalCapacity,
      leagueSeasonId: season?.id ?? null,
      leagueName: league?.name ?? null,
      roundNumber: firstRound?.round_number ?? null,
      totalRounds: season ? roundsBySeason.get(season.id) ?? 0 : null,
    } satisfies OrganizerManagedEvent;
  });
}

export async function getOrganizerEventSummaries(
  account: AuthAccountContext | null | undefined,
): Promise<OrganizerManagedEventSummary[]> {
  ensureOrganizerAccount(account);
  const events = await apiRequest<OrganizerManagedEventSummary[]>({
    path: `/v1/organizer/event-summaries${organizerWorkspaceQuery(account)}`,
  });
  return events.map(resolveOrganizerEventMedia);
}

export async function getOrganizerEventEligibleClubOptions(
  account: AuthAccountContext | null | undefined,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerEventEligibleClubOption[]>({
    path: "/v1/organizer/event-eligible-clubs",
  });
}

export async function getOrganizerEventById(
  account: AuthAccountContext | null | undefined,
  eventRef: string,
) {
  ensureOrganizerAccount(account);
  const event = await apiRequest<OrganizerManagedEvent | null>({
    path: `/v1/organizer/events/${encodeURIComponent(eventRef)}${organizerWorkspaceQuery(account)}`,
  });
  return event ? resolveOrganizerEventMedia(event) : null;
}

async function getOrganizerTracksDirect(
  client: BrowserSupabaseClient,
  account: AuthAccountContext,
): Promise<OrganizerManagedTrack[]> {
  const { data: templateRows, error: templateError } = await client
    .from("track_templates")
    .select(
      "id,organization_id,slug,name,sport_code,terrain_type,notes,public_overview,location_label,season_label,parking_label,weather_location_label,best_time_label,gallery_preview_image_url,gallery_items_json,created_at,updated_at",
    )
    .in("organization_id", account.organizationIds)
    .order("created_at", { ascending: false });

  if (templateError) throw templateError;
  if (!templateRows?.length) return [];

  const templateIds = templateRows.map((row) => row.id);
  const [
    { data: versionRows, error: versionError },
    { data: snapshotRows, error: snapshotError },
    { data: recurrenceRuleRows, error: recurrenceRuleError },
  ] = await Promise.all([
    client
      .from("track_versions")
      .select(
        "id,track_template_id,version_number,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,difficulty_level,published_at,surface_summary,safety_notes,water_point_count,segment_definitions_json",
      )
      .in("track_template_id", templateIds)
      .order("version_number", { ascending: false }),
    client
      .from("event_category_track_snapshots")
      .select("track_template_id,event_category_id")
      .in("track_template_id", templateIds),
    client
      .from("league_recurrence_rules")
      .select("track_template_id")
      .in("track_template_id", templateIds),
  ]);

  if (versionError) throw versionError;
  if (snapshotError) throw snapshotError;
  if (recurrenceRuleError) throw recurrenceRuleError;

  const latestVersionByTemplate = new Map<string, (typeof versionRows)[number]>();
  const latestPublishedVersionByTemplate = new Map<string, (typeof versionRows)[number]>();
  for (const version of versionRows ?? []) {
    if (!latestVersionByTemplate.has(version.track_template_id)) {
      latestVersionByTemplate.set(version.track_template_id, version);
    }
    if (version.published_at && !latestPublishedVersionByTemplate.has(version.track_template_id)) {
      latestPublishedVersionByTemplate.set(version.track_template_id, version);
    }
  }

  const latestVersionIds = Array.from(
    new Set(Array.from(latestVersionByTemplate.values()).map((version) => version.id)),
  );
  const [gpxSourceRows, { data: renderCacheRows, error: renderCacheError }] = await Promise.all([
    loadTrackVersionSourceFileNames(client, latestVersionIds),
    latestVersionIds.length
      ? client
          .from("track_render_cache")
          .select("track_version_id,polyline_json,elevation_profile_json,checkpoints_json")
          .in("track_version_id", latestVersionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (renderCacheError) throw renderCacheError;

  const gpxSourceByVersionId = new Map(gpxSourceRows.map((row) => [row.track_version_id, row.file_name]));
  const renderCacheByVersionId = new Map((renderCacheRows ?? []).map((row) => [row.track_version_id, row]));

  const categoryIds = Array.from(new Set((snapshotRows ?? []).map((snapshot) => snapshot.event_category_id)));
  const { data: categoryRows, error: categoryError } = categoryIds.length
    ? await client.from("event_categories").select("id,event_edition_id").in("id", categoryIds)
    : { data: [], error: null };

  if (categoryError) throw categoryError;

  const categoryById = new Map((categoryRows ?? []).map((row) => [row.id, row]));
  const eventEditionIdsByTemplate = new Map<string, Set<string>>();
  const categoryLinkCountByTemplate = new Map<string, number>();
  const leagueScheduleLinkCountByTemplate = new Map<string, number>();

  for (const snapshot of snapshotRows ?? []) {
    categoryLinkCountByTemplate.set(
      snapshot.track_template_id,
      (categoryLinkCountByTemplate.get(snapshot.track_template_id) ?? 0) + 1,
    );
    const category = categoryById.get(snapshot.event_category_id);
    if (!category) continue;
    const editionIds = eventEditionIdsByTemplate.get(snapshot.track_template_id) ?? new Set<string>();
    editionIds.add(category.event_edition_id);
    eventEditionIdsByTemplate.set(snapshot.track_template_id, editionIds);
  }

  for (const rule of recurrenceRuleRows ?? []) {
    leagueScheduleLinkCountByTemplate.set(
      rule.track_template_id,
      (leagueScheduleLinkCountByTemplate.get(rule.track_template_id) ?? 0) + 1,
    );
  }

  return templateRows.flatMap((template) => {
    const latestVersion = latestVersionByTemplate.get(template.id);
    if (!latestVersion) return [];
    const latestPublishedVersion = latestPublishedVersionByTemplate.get(template.id);
    const renderCache = renderCacheByVersionId.get(latestVersion.id);
    const galleryItems = normalizeTrackGalleryItems(template.gallery_items_json);

    return [{
      templateId: template.id,
      slug: template.slug,
      name: template.name,
      sportCode: (template.sport_code as SportCode | null) ?? DEFAULT_SPORT_CODE,
      terrainType: template.terrain_type ?? null,
      notes: template.notes ?? null,
      publicOverview: template.public_overview ?? null,
      locationLabel: template.location_label ?? null,
      seasonLabel: template.season_label ?? null,
      parkingLabel: template.parking_label ?? null,
      weatherLocationLabel: template.weather_location_label ?? null,
      bestTimeLabel: template.best_time_label ?? null,
      latestVersionId: latestVersion.id,
      latestVersionNumber: latestVersion.version_number,
      latestVersionPublishedAt: latestVersion.published_at ?? null,
      latestPublishedVersionId: latestPublishedVersion?.id ?? null,
      sourceFileName:
        gpxSourceByVersionId.get(latestVersion.id) ?? latestVersion.gpx_storage_path?.split("/").pop() ?? null,
      hasGpxSource: Boolean(gpxSourceByVersionId.has(latestVersion.id) || latestVersion.gpx_storage_path),
      distanceKm: latestVersion.distance_km != null ? Number(latestVersion.distance_km) : null,
      elevationGainM: latestVersion.elevation_gain_m ?? null,
      elevationLossM: latestVersion.elevation_loss_m ?? null,
      difficultyLevel: latestVersion.difficulty_level ?? null,
      surfaceSummary: latestVersion.surface_summary ?? null,
      safetyNotes: latestVersion.safety_notes ?? null,
      waterPointCount: Math.max(0, latestVersion.water_point_count ?? 0),
      segments: normalizeOrganizerTrackSegments(latestVersion.segment_definitions_json),
      galleryPreviewImageUrl:
        (galleryItems.find((item) => item.isDefault) ?? galleryItems[0])?.imageUrl
        ?? template.gallery_preview_image_url
        ?? null,
      galleryItems,
      routePoints: renderCacheRoutePoints(renderCache?.polyline_json),
      elevationPoints: renderCacheTrackElevationProfile(renderCache?.elevation_profile_json),
      checkpoints: renderCacheTrackCheckpoints(renderCache?.checkpoints_json),
      publishedAt: latestPublishedVersion?.published_at ?? null,
      isPublic: Boolean(latestPublishedVersion?.published_at),
      categoryLinkCount: categoryLinkCountByTemplate.get(template.id) ?? 0,
      eventLinkCount: eventEditionIdsByTemplate.get(template.id)?.size ?? 0,
      leagueScheduleLinkCount: leagueScheduleLinkCountByTemplate.get(template.id) ?? 0,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
    } satisfies OrganizerManagedTrack];
  });
}

export async function getOrganizerTracks(
  account: AuthAccountContext | null | undefined,
): Promise<OrganizerManagedTrack[]> {
  if (account?.hasOrganizerAccess) {
    const tracks = await apiRequest<OrganizerManagedTrack[]>({
      path: `/v1/organizer/tracks${organizerWorkspaceQuery(account)}`,
    });
    return tracks.map(resolveOrganizerTrackMedia);
  }

  return [];
}

export async function getOrganizerTrackSummaries(
  account: AuthAccountContext | null | undefined,
): Promise<OrganizerManagedTrackSummary[]> {
  ensureOrganizerAccount(account);
  const tracks = await apiRequest<OrganizerManagedTrackSummary[]>({
    path: `/v1/organizer/track-summaries${organizerWorkspaceQuery(account)}`,
  });
  return tracks.map(resolveOrganizerTrackMedia);
}

export async function getOrganizerTrackById(
  account: AuthAccountContext | null | undefined,
  trackRef: string,
): Promise<OrganizerManagedTrack | null> {
  ensureOrganizerAccount(account);
  const track = await apiRequest<OrganizerManagedTrack | null>({
    path: `/v1/organizer/tracks/${encodeURIComponent(trackRef)}${organizerWorkspaceQuery(account)}`,
  });
  return track ? resolveOrganizerTrackMedia(track) : null;
}

export async function createOrganizerEvent(
  account: AuthAccountContext | null | undefined,
  input: OrganizerEventInput,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedEvent>({
    path: "/v1/organizer/events",
    method: "POST",
    body: input,
  }).then(resolveOrganizerEventMedia);
}

export async function updateOrganizerEvent(
  account: AuthAccountContext | null | undefined,
  input: {
    id: string;
    seriesId: string;
    sportCodes?: SportCode[];
    primarySportCode?: SportCode;
    activityType?: EventActivityType;
    name?: string;
    editionLabel?: string | null;
    startDate?: string;
    endDate?: string | null;
    timezone?: string;
    registrationOpenAt?: string | null;
    registrationCloseAt?: string | null;
    locationName?: string | null;
    description?: string | null;
    aboutText?: string | null;
    organizerRules?: string | null;
    publicVisibility?: "private" | "public" | "club_members";
    registrationAccess?: "open" | "club_members";
    eligibleClubIds?: string[];
    coverImageUrl?: string | null;
    websiteUrl?: string | null;
    instagramUrl?: string | null;
    facebookUrl?: string | null;
    generalTimeline?: OrganizerEventInput["generalTimeline"];
    locations?: OrganizerEventInput["locations"];
    status?: string;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedEvent>({
    path: `/v1/organizer/events/${input.id}/update`,
    method: "POST",
    body: {
      seriesId: input.seriesId,
      sportCodes: input.sportCodes,
      primarySportCode: input.primarySportCode,
      activityType: input.activityType,
      name: input.name,
      editionLabel: input.editionLabel,
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: input.timezone,
      registrationOpenAt: input.registrationOpenAt,
      registrationCloseAt: input.registrationCloseAt,
      locationName: input.locationName,
      description: input.description,
      aboutText: input.aboutText,
      organizerRules: input.organizerRules,
      publicVisibility: input.publicVisibility,
      registrationAccess: input.registrationAccess,
      eligibleClubIds: input.eligibleClubIds,
      coverImageUrl: input.coverImageUrl,
      websiteUrl: input.websiteUrl,
      instagramUrl: input.instagramUrl,
      facebookUrl: input.facebookUrl,
      generalTimeline: input.generalTimeline,
      locations: input.locations,
      status: input.status,
    },
  }).then(resolveOrganizerEventMedia);
}

export async function publishOrganizerEvent(
  account: AuthAccountContext | null | undefined,
  eventId: string,
  input?: { acknowledgedBlockerKeys?: string[] },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedEvent>({
    path: `/v1/organizer/events/${eventId}/publish`,
    method: "POST",
    body: input,
  }).then(resolveOrganizerEventMedia);
}

export async function getOrganizerEventPublishReadiness(
  account: AuthAccountContext | null | undefined,
  eventId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerEventPublishReadiness>({
    path: `/v1/organizer/events/${eventId}/readiness`,
  });
}

export async function unpublishOrganizerEvent(
  account: AuthAccountContext | null | undefined,
  eventId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedEvent>({
    path: `/v1/organizer/events/${eventId}/unpublish`,
    method: "POST",
  }).then(resolveOrganizerEventMedia);
}

export async function deleteOrganizerEvent(
  account: AuthAccountContext | null | undefined,
  eventId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{ deleted: boolean; eventId: string }>({
    path: `/v1/organizer/events/${eventId}/delete`,
    method: "POST",
  });
}

export async function createOrganizerCategory(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
  input: OrganizerCategoryInput,
) {
  ensureOrganizerAccount(account);
  const { idempotencyKey, ...body } = input;
  return apiRequest<OrganizerManagedCategory>({
    path: `/v1/organizer/editions/${eventEditionId}/categories`,
    method: "POST",
    body,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

export async function updateOrganizerCategory(
  account: AuthAccountContext | null | undefined,
  input: {
    id: string;
    name?: string;
    coverImageUrl?: string | null;
    sportCode?: SportCode;
    categoryType?: "competitive" | "informative";
    courseFormat?: "standard" | "laps";
    lapCount?: number;
    rankingConfig?: CompetitiveRankingConfig | null;
    distanceKm?: number | null;
    elevationGainM?: number | null;
    capacity?: number | null;
    feeCents?: number | null;
    feePeriods?: RaceFeePeriod[];
    currency?: string | null;
    minimumAge?: number | null;
    maximumAge?: number | null;
    allowedGenders?: Array<"F" | "M" | "U">;
    eligibilityNote?: string | null;
    startAt?: string | null;
    parkingLabel?: string | null;
    organizerNotes?: string | null;
    displayOrder?: number;
    status?: string;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedCategory>({
    path: `/v1/organizer/categories/${input.id}/update`,
    method: "POST",
    body: {
      name: input.name,
      sportCode: input.sportCode,
      categoryType: input.categoryType,
      courseFormat: input.courseFormat,
      lapCount: input.lapCount,
      rankingConfig: input.rankingConfig,
      distanceKm: input.distanceKm,
      elevationGainM: input.elevationGainM,
      capacity: input.capacity,
      feeCents: input.feeCents,
      feePeriods: input.feePeriods,
      currency: input.currency,
      minimumAge: input.minimumAge,
      maximumAge: input.maximumAge,
      allowedGenders: input.allowedGenders,
      eligibilityNote: input.eligibilityNote,
      startAt: input.startAt,
      parkingLabel: input.parkingLabel,
      organizerNotes: input.organizerNotes,
      displayOrder: input.displayOrder,
      status: input.status,
    },
  });
}

export async function deleteOrganizerCategory(
  account: AuthAccountContext | null | undefined,
  categoryId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{ deleted: boolean; categoryId: string }>({
    path: `/v1/organizer/categories/${categoryId}/delete`,
    method: "POST",
  });
}

export async function assignOrganizerCategoryTrack(
  account: AuthAccountContext | null | undefined,
  categoryId: string,
  input: OrganizerCategoryTrackInput,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedCategory>({
    path: `/v1/organizer/categories/${categoryId}/track`,
    method: "POST",
    body: input,
  });
}

export async function detachOrganizerCategoryTrack(
  account: AuthAccountContext | null | undefined,
  categoryId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedCategory>({
    path: `/v1/organizer/categories/${categoryId}/track/detach`,
    method: "POST",
  });
}

export async function updateOrganizerCheckpoint(
  account: AuthAccountContext | null | undefined,
  input: OrganizerCheckpointUpdateInput,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedCheckpoint>({
    path: `/v1/organizer/checkpoints/${input.checkpointId}/update`,
    method: "POST",
    body: {
      name: input.name,
      cutoffAt: input.cutoffAt,
      isMandatory: input.isMandatory,
      settings: input.settings,
    },
  });
}

export async function syncOrganizerCategoryCheckpoints(
  account: AuthAccountContext | null | undefined,
  input: OrganizerCheckpointSyncInput,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedCategory>({
    path: `/v1/organizer/categories/${input.categoryId}/checkpoints/sync`,
    method: "POST",
    body: {
      checkpoints: input.checkpoints,
    },
  });

  /*
   * Legacy browser-direct checkpoint implementation retained as a temporary
   * schema reference while the organizer module is split into smaller files.
   * It is commented out so it cannot enter the runtime trust path.
  const client = getOrganizerTrackClient(account);
  if (client && account) {
    const { data: category, error: categoryError } = await client
      .from("event_categories")
      .select(
        "id,event_edition_id,slug,name,distance_km,elevation_gain_m,capacity,registration_fee_cents,registration_fee_periods,currency,start_at,parking_label,organizer_notes,display_order,results_mode,status,ranking_config_json",
      )
      .eq("id", input.categoryId)
      .maybeSingle<{
        id: string;
        event_edition_id: string;
        slug: string;
        name: string;
        distance_km: number | string | null;
        elevation_gain_m: number | null;
        capacity: number | null;
        registration_fee_cents: number | null;
        registration_fee_periods?: RaceFeePeriod[];
        currency: string | null;
        start_at: string | null;
        parking_label: string | null;
        organizer_notes: string | null;
        display_order: number | null;
        results_mode: string;
        status: string;
        ranking_config_json: unknown;
      }>();

    if (categoryError) throw categoryError;
    if (!category) throw new Error("Category not found");
    if (mapCategoryType(category.results_mode) !== "competitive") {
      throw new Error("Race checkpoints can only be managed on competitive races");
    }

    const { data: snapshot, error: snapshotError } = await client
      .from("event_category_track_snapshots")
      .select("id,track_template_id,track_version_id")
      .eq("event_category_id", input.categoryId)
      .maybeSingle<{ id: string; track_template_id: string | null; track_version_id: string | null }>();

    if (snapshotError) throw snapshotError;
    if (!snapshot?.track_version_id) {
      throw new Error("Assign a track before configuring course points");
    }

    const { data: renderCache, error: renderCacheError } = await client
      .from("track_render_cache")
      .select("checkpoints_json")
      .eq("track_version_id", snapshot.track_version_id)
      .maybeSingle<{ checkpoints_json: unknown }>();

    if (renderCacheError) throw renderCacheError;
    if (!renderCache) throw new Error("Route source not found");

    const foundationCheckpoints = normalizeTrackSnapshotCheckpoints(renderCache.checkpoints_json).filter(
      (checkpoint) => checkpoint.type === "start" || checkpoint.type === "finish",
    );
    if (foundationCheckpoints.length < 2) {
      throw new Error("Route must provide fixed start and finish points");
    }

    const normalizedRacePoints = input.checkpoints
      .map((checkpoint) => {
        const normalizedDistance = Number(checkpoint.distanceFromStartKm);
        if (!Number.isFinite(normalizedDistance) || normalizedDistance < 0) {
          throw new Error("Route point distances must be valid numbers");
        }

        return {
          name: checkpoint.name.trim(),
          distanceFromStartKm: normalizedDistance,
          cutoffAt: checkpoint.cutoffAt ?? null,
          isMandatory: checkpoint.isMandatory ?? true,
          settings: normalizeCheckpointSettings(
            {
              ...defaultCheckpointSettings("split"),
              ...(checkpoint.settings ?? {}),
            },
            "split",
          ),
        };
      })
      .filter((checkpoint) => checkpoint.name.length > 0)
      .sort((left, right) => left.distanceFromStartKm - right.distanceFromStartKm);

    const codeCounters = new Map<string, number>();
    const checkpointRows = [
      ...foundationCheckpoints.map((checkpoint) => ({
        event_category_id: input.categoryId,
        track_snapshot_id: snapshot.id,
        code: checkpoint.type === "start" ? "START" : "FINISH",
        name: checkpoint.type === "start" ? "Start" : "Finish",
        checkpoint_type: checkpointTypeForSnapshot(checkpoint.type),
        sequence_number: 0,
        distance_from_start_km: checkpoint.km,
        cutoff_at: null,
        is_mandatory: true,
        settings_json: defaultCheckpointSettings(checkpointTypeForSnapshot(checkpoint.type)),
      })),
      ...normalizedRacePoints.map((checkpoint) => ({
        event_category_id: input.categoryId,
        track_snapshot_id: snapshot.id,
        code: checkpointCodeForKind(checkpoint.settings.kind, codeCounters),
        name: checkpoint.name,
        checkpoint_type: "split",
        sequence_number: 0,
        distance_from_start_km: checkpoint.distanceFromStartKm,
        cutoff_at: checkpoint.cutoffAt,
        is_mandatory: checkpoint.isMandatory,
        settings_json: checkpoint.settings,
      })),
    ]
      .sort((left, right) => (numberOrNull(left.distance_from_start_km) ?? 0) - (numberOrNull(right.distance_from_start_km) ?? 0))
      .map((checkpoint, index) => ({
        ...checkpoint,
        sequence_number: index + 1,
      }));

    const { error: deleteCheckpointError } = await client
      .from("checkpoints")
      .delete()
      .eq("event_category_id", input.categoryId);

    if (deleteCheckpointError) throw deleteCheckpointError;

    const { error: insertCheckpointError } = await client
      .from("checkpoints")
      .insert(checkpointRows);

    if (insertCheckpointError) throw insertCheckpointError;

    const [{ data: checkpointRowsData, error: checkpointRowsError }, { count: registrationCount, error: registrationError }] =
      await Promise.all([
        client
          .from("checkpoints")
          .select("id,code,name,checkpoint_type,sequence_number,distance_from_start_km,cutoff_at,is_mandatory,settings_json")
          .eq("event_category_id", input.categoryId)
          .order("sequence_number", { ascending: true }),
        client
          .from("registrations")
          .select("id", { count: "exact", head: true })
          .eq("event_category_id", input.categoryId)
          .in("status", ["pending", "confirmed"]),
      ]);

    if (checkpointRowsError) throw checkpointRowsError;
    if (registrationError) throw registrationError;

    return {
      id: category.id,
      slug: category.slug,
      name: category.name,
      categoryType: mapCategoryType(category.results_mode),
      rankingConfig: normalizeCompetitiveRankingConfig(category.ranking_config_json),
      distanceKm: category.distance_km != null ? Number(category.distance_km) : null,
      elevationGainM: category.elevation_gain_m,
      capacity: category.capacity,
      feeCents: category.registration_fee_cents,
      feePeriods: category.registration_fee_periods ?? [],
      currency: category.currency,
      startAt: category.start_at ?? null,
      parkingLabel: category.parking_label ?? null,
      organizerNotes: category.organizer_notes ?? null,
      displayOrder: category.display_order ?? 0,
      status: category.status,
      registrationCount: registrationCount ?? 0,
      trackTemplateId: snapshot.track_template_id ?? null,
      trackVersionId: snapshot.track_version_id ?? null,
      checkpoints: (checkpointRowsData ?? []).map((checkpoint) => ({
        id: checkpoint.id,
        code: checkpoint.code,
        name: checkpoint.name,
        checkpointType: checkpoint.checkpoint_type,
        sequenceNumber: checkpoint.sequence_number,
        distanceFromStartKm:
          checkpoint.distance_from_start_km != null ? Number(checkpoint.distance_from_start_km) : null,
        cutoffAt: checkpoint.cutoff_at,
        isMandatory: checkpoint.is_mandatory,
        settings: normalizeCheckpointSettings(checkpoint.settings_json, checkpoint.checkpoint_type),
      })),
    };
  }

  return apiRequest<OrganizerManagedCategory>({
    path: `/v1/organizer/categories/${input.categoryId}/checkpoints/sync`,
    method: "POST",
    body: {
      checkpoints: input.checkpoints,
    },
  });
  */
}

/*
 * Legacy browser-direct track mutations retained as a temporary schema
 * reference while the organizer module is split. They are commented out so
 * only the protected API contracts can execute in the browser application.
async function createOrganizerTrackDirect(
  client: BrowserSupabaseClient,
  account: AuthAccountContext,
  input: OrganizerTrackInput,
) {
  const organizationId = primaryOrganizationId(account);
  if (!organizationId) {
    throw new Error("Organizer access is required.");
  }

  if (input.routePoints.length < 2) {
    throw new Error("Route requires at least two points");
  }

  const baseSlug = slugify(input.name);
  const trackSlug = await uniqueScopedSlug({
    table: "track_templates",
    scopeColumn: "organization_id",
    scopeValue: organizationId,
    baseSlug,
  });

  const { data: template, error: templateError } = await client
    .from("track_templates")
    .insert({
      organization_id: organizationId,
      slug: trackSlug,
      name: input.name,
      terrain_type: input.terrainType ?? null,
      notes: input.notes ?? null,
      public_overview: input.publicOverview ?? null,
      location_label: input.locationLabel ?? null,
      season_label: input.seasonLabel ?? null,
      parking_label: input.parkingLabel ?? null,
      weather_location_label: input.weatherLocationLabel ?? null,
      best_time_label: input.bestTimeLabel ?? null,
      gallery_items_json: normalizeTrackGalleryItems(input.galleryItems ?? []),
    })
    .select("id")
    .single<{ id: string }>();

  if (templateError) throw templateError;

  const startPoint = input.routePoints[0];
  const finishPoint = input.routePoints[input.routePoints.length - 1];
  const derivedWaterPointCount = input.checkpoints.filter(
    (checkpoint) =>
      checkpoint.type === "water" ||
      checkpoint.type === "refreshment" ||
      checkpoint.typeTags?.includes("water") ||
      checkpoint.typeTags?.includes("refreshment"),
  ).length;
  const sourceFileName = sanitizeGpxFileName(input.sourceFileName, trackSlug);
  const gpxStoragePath = `db://track-gpx/${template.id}/v1/${sourceFileName}`;

  const { error: versionInsertError } = await client.from("track_versions").insert({
    track_template_id: template.id,
    version_number: 1,
    gpx_storage_path: gpxStoragePath,
    distance_km: input.distanceKm ?? null,
    elevation_gain_m: input.elevationGainM ?? null,
    elevation_loss_m: input.elevationLossM ?? null,
    surface_summary: input.surfaceSummary ?? null,
    safety_notes: input.safetyNotes ?? null,
    water_point_count: Math.max(0, input.waterPointCount ?? derivedWaterPointCount),
    segment_definitions_json: normalizeOrganizerTrackSegments(input.segments ?? []),
    start_lat: startPoint.lat,
    start_lng: startPoint.lng,
    finish_lat: finishPoint.lat,
    finish_lng: finishPoint.lng,
  });

  if (versionInsertError) throw versionInsertError;

  const { data: version, error: versionLookupError } = await client
    .from("track_versions")
    .select("id")
    .eq("track_template_id", template.id)
    .eq("version_number", 1)
    .maybeSingle<{ id: string }>();

  if (versionLookupError) throw versionLookupError;
  if (!version) throw new Error("Created track version could not be loaded");

  const normalizedCheckpoints = input.checkpoints.map((checkpoint) => ({
    name: checkpoint.name,
    km: checkpoint.km,
    elev: checkpoint.elev,
    lat: checkpoint.lat,
    lng: checkpoint.lng,
    type: checkpoint.type,
    typeTags: checkpoint.typeTags?.length ? checkpoint.typeTags : [checkpoint.type],
  }));

  const { error: renderCacheError } = await client.from("track_render_cache").insert({
    track_version_id: version.id,
    polyline_json: input.routePoints.map((point) => ({ lat: point.lat, lng: point.lng })),
    elevation_profile_json: input.elevationPoints.map((point) => ({
      distKm: point.distKm,
      elev: point.elev,
      grade: point.grade ?? 0,
      lat: point.lat ?? null,
      lng: point.lng ?? null,
    })),
    bounds_json: summarizeBounds(input.routePoints),
    checkpoints_json: normalizedCheckpoints,
  });

  if (renderCacheError) throw renderCacheError;

  await persistTrackVersionGpxSource(client, {
    trackVersionId: version.id,
    fileName: sourceFileName,
    trackName: input.name,
    routePoints: input.routePoints,
    elevationPoints: input.elevationPoints,
    checkpoints: normalizedCheckpoints,
    gpxXml: input.gpxXml,
  });

  const tracks = await getOrganizerTracksDirect(client, account);
  const created = tracks.find((track) => track.templateId === template.id) ?? null;
  if (!created) {
    throw new Error("Created track could not be loaded");
  }

  return created;
}

async function updateOrganizerTrackDirect(
  client: BrowserSupabaseClient,
  account: AuthAccountContext,
  input: OrganizerTrackUpdateInput,
) {
  const { data: template, error: templateError } = await client
    .from("track_templates")
    .select("id,slug,name")
    .eq("id", input.trackTemplateId)
    .maybeSingle<{ id: string; slug: string; name: string }>();

  if (templateError) throw templateError;
  if (!template) throw new Error("Route not found");

  const templatePatch: Record<string, unknown> = {};

  if (input.name !== undefined) templatePatch.name = input.name;
  if (input.terrainType !== undefined) templatePatch.terrain_type = input.terrainType;
  if (input.notes !== undefined) templatePatch.notes = input.notes;
  if (input.publicOverview !== undefined) templatePatch.public_overview = input.publicOverview;
  if (input.locationLabel !== undefined) templatePatch.location_label = input.locationLabel;
  if (input.seasonLabel !== undefined) templatePatch.season_label = input.seasonLabel;
  if (input.parkingLabel !== undefined) templatePatch.parking_label = input.parkingLabel;
  if (input.weatherLocationLabel !== undefined) templatePatch.weather_location_label = input.weatherLocationLabel;
  if (input.bestTimeLabel !== undefined) templatePatch.best_time_label = input.bestTimeLabel;
  if (input.galleryItems !== undefined) templatePatch.gallery_items_json = normalizeTrackGalleryItems(input.galleryItems);

  if (Object.keys(templatePatch).length) {
    const { error } = await client.from("track_templates").update(templatePatch).eq("id", input.trackTemplateId);
    if (error) throw error;
  }

  const latestVersionFieldRequested =
    input.routePoints !== undefined ||
    input.elevationPoints !== undefined ||
    input.distanceKm !== undefined ||
    input.elevationGainM !== undefined ||
    input.elevationLossM !== undefined ||
    input.sourceFileName !== undefined ||
    input.gpxXml !== undefined ||
    input.surfaceSummary !== undefined ||
    input.safetyNotes !== undefined ||
    input.waterPointCount !== undefined ||
    input.segments !== undefined ||
    input.checkpoints !== undefined;

  if (latestVersionFieldRequested) {
    const { data: latestVersion, error: latestVersionError } = await client
      .from("track_versions")
      .select("id,version_number,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,surface_summary,safety_notes,water_point_count,segment_definitions_json")
      .eq("track_template_id", input.trackTemplateId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        version_number: number;
        gpx_storage_path: string | null;
        distance_km: string | number | null;
        elevation_gain_m: number | null;
        elevation_loss_m: number | null;
        surface_summary: string | null;
        safety_notes: string | null;
        water_point_count: number | null;
        segment_definitions_json: unknown;
      }>();

    if (latestVersionError) throw latestVersionError;
    if (!latestVersion) throw new Error("Route version not found");

    const [gpxSourceRows, { data: renderCache, error: renderCacheError }] = await Promise.all([
      loadTrackVersionSourceFileNames(client, [latestVersion.id]),
      client
        .from("track_render_cache")
        .select("polyline_json,elevation_profile_json,checkpoints_json")
        .eq("track_version_id", latestVersion.id)
        .maybeSingle<{
          polyline_json: unknown;
          elevation_profile_json: unknown;
          checkpoints_json: unknown;
        }>(),
    ]);

    if (renderCacheError) throw renderCacheError;
    if (!renderCache) throw new Error("Route render cache not found");

    const currentRoutePoints = renderCacheRoutePoints(renderCache.polyline_json);
    const currentElevationPoints = renderCacheTrackElevationProfile(renderCache.elevation_profile_json);
    const currentCheckpoints = renderCacheTrackCheckpoints(renderCache.checkpoints_json);
    const currentSourceFileName = sanitizeGpxFileName(
      gpxSourceRows[0]?.file_name ?? latestVersion.gpx_storage_path?.split("/").pop() ?? null,
      template.slug,
    );
    const currentWaterPointCount = Math.max(0, latestVersion.water_point_count ?? 0);
    const nextCheckpoints = (input.checkpoints ?? currentCheckpoints).map((checkpoint) => ({
      name: checkpoint.name,
      km: checkpoint.km,
      elev: checkpoint.elev,
      lat: checkpoint.lat,
      lng: checkpoint.lng,
      type: checkpoint.type,
      typeTags: checkpoint.typeTags?.length ? checkpoint.typeTags : [checkpoint.type],
    }));
    const derivedWaterPointCount = nextCheckpoints.filter(
      (checkpoint) =>
        checkpoint.type === "water" ||
        checkpoint.type === "refreshment" ||
        checkpoint.typeTags.includes("water") ||
        checkpoint.typeTags.includes("refreshment"),
    ).length;
    const currentSegments = normalizeOrganizerTrackSegments(latestVersion.segment_definitions_json);
    const currentVersionState = {
      routePoints: currentRoutePoints,
      elevationPoints: currentElevationPoints,
      checkpoints: currentCheckpoints.map((checkpoint) => ({
        name: checkpoint.name,
        km: checkpoint.km,
        elev: checkpoint.elev,
        lat: checkpoint.lat,
        lng: checkpoint.lng,
        type: checkpoint.type,
        typeTags: checkpoint.typeTags?.length ? checkpoint.typeTags : [checkpoint.type],
      })),
      surfaceSummary: latestVersion.surface_summary ?? null,
      safetyNotes: latestVersion.safety_notes ?? null,
      waterPointCount: currentWaterPointCount,
      segments: currentSegments,
      sourceFileName: currentSourceFileName,
      distanceKm: numberOrNull(latestVersion.distance_km),
      elevationGainM: latestVersion.elevation_gain_m ?? null,
      elevationLossM: latestVersion.elevation_loss_m ?? null,
    };
    const nextVersionState = {
      routePoints: input.routePoints ?? currentRoutePoints,
      elevationPoints: input.elevationPoints ?? currentElevationPoints,
      checkpoints: nextCheckpoints,
      surfaceSummary: input.surfaceSummary !== undefined ? input.surfaceSummary : latestVersion.surface_summary ?? null,
      safetyNotes: input.safetyNotes !== undefined ? input.safetyNotes : latestVersion.safety_notes ?? null,
      waterPointCount:
        input.waterPointCount !== undefined
          ? Math.max(0, input.waterPointCount ?? 0)
          : input.checkpoints !== undefined
            ? derivedWaterPointCount
            : currentWaterPointCount,
      segments: input.segments ?? currentSegments,
      sourceFileName: sanitizeGpxFileName(input.sourceFileName ?? currentSourceFileName, template.slug),
      distanceKm: input.distanceKm !== undefined ? input.distanceKm : numberOrNull(latestVersion.distance_km),
      elevationGainM: input.elevationGainM !== undefined ? input.elevationGainM : latestVersion.elevation_gain_m ?? null,
      elevationLossM: input.elevationLossM !== undefined ? input.elevationLossM : latestVersion.elevation_loss_m ?? null,
    };
    const nextGpxXml = input.gpxXml?.trim() || null;
    const shouldCreateNewVersion =
      nextGpxXml !== null || JSON.stringify(currentVersionState) !== JSON.stringify(nextVersionState);

    if (shouldCreateNewVersion) {
      if (nextVersionState.routePoints.length < 2) {
        throw new Error("Route must contain at least two points");
      }

      const nextVersionNumber = latestVersion.version_number + 1;
      const startPoint = nextVersionState.routePoints[0];
      const finishPoint = nextVersionState.routePoints[nextVersionState.routePoints.length - 1];
      const gpxStoragePath = `db://track-gpx/${template.id}/v${nextVersionNumber}/${nextVersionState.sourceFileName}`;

      const { data: createdVersion, error: versionInsertError } = await client
        .from("track_versions")
        .insert({
          track_template_id: template.id,
          version_number: nextVersionNumber,
          gpx_storage_path: gpxStoragePath,
          distance_km: nextVersionState.distanceKm ?? null,
          elevation_gain_m: nextVersionState.elevationGainM ?? null,
          elevation_loss_m: nextVersionState.elevationLossM ?? null,
          surface_summary: nextVersionState.surfaceSummary ?? null,
          safety_notes: nextVersionState.safetyNotes ?? null,
          water_point_count: nextVersionState.waterPointCount,
          segment_definitions_json: normalizeOrganizerTrackSegments(nextVersionState.segments),
          start_lat: startPoint.lat,
          start_lng: startPoint.lng,
          finish_lat: finishPoint.lat,
          finish_lng: finishPoint.lng,
        })
        .select("id")
        .single<{ id: string }>();

      if (versionInsertError) throw versionInsertError;

      const { error: renderCacheInsertError } = await client.from("track_render_cache").insert({
        track_version_id: createdVersion.id,
        polyline_json: nextVersionState.routePoints.map((point) => ({ lat: point.lat, lng: point.lng })),
        elevation_profile_json: nextVersionState.elevationPoints.map((point) => ({
          distKm: point.distKm,
          elev: point.elev,
          grade: point.grade ?? 0,
          lat: point.lat ?? null,
          lng: point.lng ?? null,
        })),
        bounds_json: summarizeBounds(nextVersionState.routePoints),
        checkpoints_json: nextVersionState.checkpoints,
      });

      if (renderCacheInsertError) throw renderCacheInsertError;

      await persistTrackVersionGpxSource(client, {
        trackVersionId: createdVersion.id,
        fileName: nextVersionState.sourceFileName,
        trackName: input.name ?? (typeof templatePatch.name === "string" ? templatePatch.name : template.name),
        routePoints: nextVersionState.routePoints,
        elevationPoints: nextVersionState.elevationPoints,
        checkpoints: nextVersionState.checkpoints,
        gpxXml: nextGpxXml,
      });
    }
  }

  const tracks = await getOrganizerTracksDirect(client, account);
  const updated = tracks.find((track) => track.templateId === input.trackTemplateId) ?? null;
  if (!updated) {
    throw new Error("Updated track could not be loaded");
  }

  return updated;
}

async function publishOrganizerTrackVersionDirect(
  client: BrowserSupabaseClient,
  account: AuthAccountContext,
  trackTemplateId: string,
  trackVersionId: string,
) {
  const { data: version, error: versionError } = await client
    .from("track_versions")
    .select("id,track_template_id")
    .eq("id", trackVersionId)
    .maybeSingle<{ id: string; track_template_id: string }>();

  if (versionError) throw versionError;
  if (!version || version.track_template_id !== trackTemplateId) {
    throw new Error("Route version not found");
  }

  const { data: renderCache, error: renderCacheError } = await client
    .from("track_render_cache")
    .select("track_version_id")
    .eq("track_version_id", trackVersionId)
    .maybeSingle<{ track_version_id: string }>();

  if (renderCacheError) throw renderCacheError;
  if (!renderCache) {
    throw new Error("Publish requires a persisted render cache");
  }

  const { error } = await client
    .from("track_versions")
    .update({ published_at: new Date().toISOString() })
    .eq("id", trackVersionId);

  if (error) throw error;

  const tracks = await getOrganizerTracksDirect(client, account);
  const published = tracks.find((track) => track.templateId === trackTemplateId) ?? null;
  if (!published) {
    throw new Error("Published track could not be loaded");
  }

  return published;
}

async function unpublishOrganizerTrackVersionDirect(
  client: BrowserSupabaseClient,
  account: AuthAccountContext,
  trackTemplateId: string,
  trackVersionId: string,
) {
  const { data: version, error: versionError } = await client
    .from("track_versions")
    .select("id,track_template_id")
    .eq("id", trackVersionId)
    .maybeSingle<{ id: string; track_template_id: string }>();

  if (versionError) throw versionError;
  if (!version || version.track_template_id !== trackTemplateId) {
    throw new Error("Route version not found");
  }

  const { error } = await client
    .from("track_versions")
    .update({ published_at: null })
    .eq("track_template_id", trackTemplateId);

  if (error) throw error;

  const tracks = await getOrganizerTracksDirect(client, account);
  const unpublished = tracks.find((track) => track.templateId === trackTemplateId) ?? null;
  if (!unpublished) {
    throw new Error("Unpublished track could not be loaded");
  }

  return unpublished;
}

async function deleteOrganizerTrackDirect(
  client: BrowserSupabaseClient,
  trackTemplateId: string,
) {
  const { count: assignmentCount, error: assignmentError } = await client
    .from("event_category_track_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("track_template_id", trackTemplateId);

  if (assignmentError) throw assignmentError;
  if ((assignmentCount ?? 0) > 0) {
    throw new Error("Cannot delete a track that is already assigned to event categories");
  }

  const { error } = await client.from("track_templates").delete().eq("id", trackTemplateId);
  if (error) throw error;

  return { deleted: true, trackTemplateId };
}
*/

export async function createOrganizerTrack(
  account: AuthAccountContext | null | undefined,
  input: OrganizerTrackInput,
) {
  ensureOrganizerAccount(account);

  return apiRequest<OrganizerManagedTrack>({
    path: "/v1/organizer/tracks",
    method: "POST",
    body: input,
  }).then(resolveOrganizerTrackMedia);
}

export async function updateOrganizerTrack(
  account: AuthAccountContext | null | undefined,
  input: OrganizerTrackUpdateInput,
) {
  ensureOrganizerAccount(account);

  return apiRequest<OrganizerManagedTrack>({
    path: `/v1/organizer/tracks/${input.trackTemplateId}/update`,
    method: "POST",
    body: {
      name: input.name,
      sportCode: input.sportCode,
      terrainType: input.terrainType,
      notes: input.notes,
      publicOverview: input.publicOverview,
      locationLabel: input.locationLabel,
      seasonLabel: input.seasonLabel,
      parkingLabel: input.parkingLabel,
      weatherLocationLabel: input.weatherLocationLabel,
      bestTimeLabel: input.bestTimeLabel,
      surfaceSummary: input.surfaceSummary,
      safetyNotes: input.safetyNotes,
      waterPointCount: input.waterPointCount,
      segments: input.segments,
      galleryItems: input.galleryItems,
      sourceFileName: input.sourceFileName,
      gpxXml: input.gpxXml,
      gpxStoragePath: input.gpxStoragePath,
      routePoints: input.routePoints,
      elevationPoints: input.elevationPoints,
      checkpoints: input.checkpoints,
      distanceKm: input.distanceKm,
      elevationGainM: input.elevationGainM,
      elevationLossM: input.elevationLossM,
      difficultyLevel: input.difficultyLevel,
    },
  }).then(resolveOrganizerTrackMedia);
}

export async function publishOrganizerTrackVersion(
  account: AuthAccountContext | null | undefined,
  trackTemplateId: string,
  trackVersionId: string,
) {
  ensureOrganizerAccount(account);

  return apiRequest<OrganizerManagedTrack>({
    path: `/v1/organizer/tracks/${trackTemplateId}/versions/${trackVersionId}/publish`,
    method: "POST",
  }).then(resolveOrganizerTrackMedia);
}

export async function unpublishOrganizerTrackVersion(
  account: AuthAccountContext | null | undefined,
  trackTemplateId: string,
  trackVersionId: string,
) {
  ensureOrganizerAccount(account);

  return apiRequest<OrganizerManagedTrack>({
    path: `/v1/organizer/tracks/${trackTemplateId}/versions/${trackVersionId}/unpublish`,
    method: "POST",
  }).then(resolveOrganizerTrackMedia);
}

export async function downloadOrganizerTrackGpx(
  account: AuthAccountContext | null | undefined,
  trackTemplateId: string,
  trackVersionId: string,
) {
  ensureOrganizerAccount(account);
  return apiDownload({
    path: `/v1/organizer/tracks/${trackTemplateId}/versions/${trackVersionId}/gpx`,
  });
}

export async function deleteOrganizerTrack(
  account: AuthAccountContext | null | undefined,
  trackTemplateId: string,
) {
  ensureOrganizerAccount(account);

  return apiRequest<{ deleted: boolean; trackTemplateId: string }>({
    path: `/v1/organizer/tracks/${trackTemplateId}/delete`,
    method: "POST",
  });
}

export async function getOrganizerTrackCommunity(
  account: AuthAccountContext | null | undefined,
  trackTemplateId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerTrackCommunityReview[]>({
    path: `/v1/organizer/tracks/${trackTemplateId}/community`,
  });
}

export async function getOrganizerEventCommunitySummaries(
  account: AuthAccountContext | null | undefined,
  eventEditionIds: string[],
) {
  ensureOrganizerAccount(account);
  if (!eventEditionIds.length) return [] as OrganizerEventCommunitySummary[];
  return apiRequest<OrganizerEventCommunitySummary[]>({
    path: "/v1/organizer/events/community-summaries",
    method: "POST",
    body: { eventEditionIds },
  });
}

export async function removeOrganizerTrackReview(
  account: AuthAccountContext | null | undefined,
  trackTemplateId: string,
  reviewId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{ reviewId: string; removed: true }>({
    path: `/v1/organizer/tracks/${trackTemplateId}/reviews/${reviewId}/remove`,
    method: "POST",
  });
}

export async function removeOrganizerTrackReviewComment(
  account: AuthAccountContext | null | undefined,
  trackTemplateId: string,
  commentId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{ commentId: string; removed: true }>({
    path: `/v1/organizer/tracks/${trackTemplateId}/comments/${commentId}/remove`,
    method: "POST",
  });
}

export async function getOrganizerLeagueSeasons(
  account: AuthAccountContext | null | undefined,
): Promise<OrganizerManagedLeagueSeason[]> {
  if (account?.hasOrganizerAccess) {
    return apiRequest<OrganizerManagedLeagueSeason[]>({
      path: `/v1/organizer/league-seasons${organizerWorkspaceQuery(account)}`,
    });
  }

  const client = requireClient();
  if (!account?.hasOrganizerAccess || !account.organizationIds.length) {
    return [];
  }

  const { data: leagueRows, error: leagueError } = await client
    .from("leagues")
    .select("id,organization_id,slug,name,description,status")
    .in("organization_id", account.organizationIds)
    .order("name");

  if (leagueError) throw leagueError;
  if (!leagueRows?.length) return [];

  const leagueIds = leagueRows.map((row) => row.id);
  const { data: seasonRows, error: seasonError } = await client
    .from("league_seasons")
    .select("id,league_id,year,name,status,club_scoring_scope,organizer_rules,published_at")
    .in("league_id", leagueIds)
    .order("year", { ascending: false });

  if (seasonError) throw seasonError;
  if (!seasonRows?.length) return [];

  const seasonIds = seasonRows.map((row) => row.id);
  const [roundResponse, scoringRulesResponse] = await Promise.all([
    client
      .from("league_rounds")
      .select("id,league_season_id,event_edition_id,event_category_id,round_number,status")
      .in("league_season_id", seasonIds)
      .order("round_number", { ascending: true }),
    client
      .from("league_scoring_rules")
      .select("league_season_id,name,points_table_json,best_n_rounds,minimum_rounds,tie_break_method,club_scoring_mode")
      .in("league_season_id", seasonIds),
  ]);

  const roundRows = roundResponse.data ?? [];
  if (roundResponse.error) throw roundResponse.error;
  if (scoringRulesResponse.error) throw scoringRulesResponse.error;

  const eventEditionIds = Array.from(new Set(roundRows.map((row) => row.event_edition_id)));
  const categoryIds = Array.from(new Set(roundRows.map((row) => row.event_category_id)));

  const [editionRows, categoryRows] = await Promise.all([
    eventEditionIds.length
      ? client
          .from("event_editions")
          .select("id,slug,name,start_date")
          .in("id", eventEditionIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; slug: string; name: string; start_date: string }>),
    categoryIds.length
      ? client
          .from("event_categories")
          .select("id,name")
          .in("id", categoryIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  const editionById = new Map(editionRows.map((row) => [row.id, row]));
  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  const roundsBySeasonId = new Map<string, OrganizerLeagueRound[]>();

  for (const round of roundRows) {
    const edition = editionById.get(round.event_edition_id);
    const category = categoryById.get(round.event_category_id);
    if (!edition || !category) continue;

    const mapped: OrganizerLeagueRound = {
      id: round.id,
      roundNumber: round.round_number,
      eventEditionId: edition.id,
      eventName: edition.name,
      eventSlug: edition.slug,
      eventDate: edition.start_date,
      eventCategoryId: round.event_category_id,
      categoryName: category.name,
      status: round.status,
      mappings: [{
        id: round.id,
        competitionId: round.league_season_id,
        competitionName: "Overall",
        eventCategoryId: round.event_category_id,
        categoryName: category.name,
        status: "mapped",
      }],
    };

    const existing = roundsBySeasonId.get(round.league_season_id) ?? [];
    existing.push(mapped);
    roundsBySeasonId.set(round.league_season_id, existing);
  }

  const leagueById = new Map(leagueRows.map((row) => [row.id, row]));
  const scoringRulesBySeasonId = new Map(
    (scoringRulesResponse.data ?? []).map((row) => [
      row.league_season_id,
      {
        name: row.name ?? null,
        pointsTable: Array.isArray(row.points_table_json)
          ? row.points_table_json.map((entry: { points?: number }) => Number(entry?.points ?? 0))
          : [],
        fieldSizeProfile: "custom",
        participationPoints: 0,
        scoringMethod: "custom",
        scoringParameters: null,
        bestN: row.best_n_rounds ?? null,
        minimumRounds: row.minimum_rounds ?? null,
        tieBreakMethod: row.tie_break_method ?? null,
        clubScoringMode: row.club_scoring_mode ?? null,
      } satisfies OrganizerLeagueScoringRules,
    ]),
  );

  return seasonRows.map((season) => {
    const league = leagueById.get(season.league_id)!;
    const scoringRules = scoringRulesBySeasonId.get(season.id) ?? null;
    return {
      leagueId: league.id,
      seasonId: season.id,
      slug: league.slug,
      name: league.name,
      sportCodes: [DEFAULT_SPORT_CODE],
      primarySportCode: DEFAULT_SPORT_CODE,
      description: league.description,
      organizerNotes: null,
      organizerRules: optionalText(season.organizer_rules),
      status: league.status,
      year: season.year,
      startsOn: null,
      endsOn: null,
      timezone: "Europe/Zagreb",
      clubScoringScope: normalizeLeagueClubScoringScope(season.club_scoring_scope),
      seasonName: season.name,
      seasonStatus: season.status,
      publishedAt: season.published_at ?? null,
      isPublic: Boolean(season.published_at),
      rounds: (roundsBySeasonId.get(season.id) ?? []).sort(
        (left, right) => left.roundNumber - right.roundNumber,
      ),
      competitions: [{
        id: season.id,
        slug: "overall",
        name: "Overall",
        description: "All eligible league races.",
        scoringTarget: "individual",
        resultBasis: "finish_place",
        standingsMode: "points",
        displayOrder: 0,
        isDefault: true,
        status: season.status === "draft" ? "draft" : "active",
        classifications: [{
          id: season.id,
          slug: "overall",
          name: "Overall",
          eligibility: {},
          awardDepth: null,
          displayOrder: 0,
          isDefault: true,
          status: "active",
        }],
        scoringRules,
      }],
      scoringRules,
    } satisfies OrganizerManagedLeagueSeason;
  });
}

export async function getOrganizerLeagueSeasonById(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
) {
  if (account?.hasOrganizerAccess) {
    return apiRequest<OrganizerManagedLeagueSeason>({
      path: `/v1/organizer/league-seasons/${seasonId}${organizerWorkspaceQuery(account)}`,
    });
  }

  const seasons = await getOrganizerLeagueSeasons(account);
  return seasons.find((season) => season.seasonId === seasonId) ?? null;
}

export async function createOrganizerLeagueSeason(
  account: AuthAccountContext | null | undefined,
  input: OrganizerLeagueInput,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedLeagueSeason>({
    path: "/v1/organizer/league-seasons",
    method: "POST",
    body: input,
  });
}

export async function updateOrganizerLeagueSeason(
  account: AuthAccountContext | null | undefined,
  input: {
    leagueId: string;
    seasonId: string;
    sportCodes?: SportCode[];
    primarySportCode?: SportCode;
    name?: string;
    description?: string | null;
    organizerNotes?: string | null;
    organizerRules?: string | null;
    year?: number;
    startsOn?: string | null;
    endsOn?: string | null;
    timezone?: string;
    clubScoringScope?: LeagueClubScoringScope;
    status?: string;
    scoringRules?: OrganizerLeagueScoringRulesInput | null;
    competitions?: OrganizerLeagueCompetitionInput[];
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedLeagueSeason>({
    path: `/v1/organizer/league-seasons/${input.seasonId}/update`,
    method: "POST",
    body: input,
  });
}

export async function attachOrganizerLeagueRound(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
  input: OrganizerLeagueRoundInput,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedLeagueSeason>({
    path: `/v1/organizer/league-seasons/${seasonId}/rounds`,
    method: "POST",
    body: input,
  });
}

export async function getRecreationalLeagueSchedules(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<RecreationalLeagueScheduleRule[]>({
    path: `/v1/organizer/league-seasons/${seasonId}/recurrence-rules`,
  });
}

export async function createRecreationalLeagueSchedule(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
  input: {
    generateNow?: boolean;
    sourceEventEditionId: string;
    name: string;
    validFrom: string;
    validUntil: string;
    weekdays: number[];
    localStartTime: string;
    timezone?: string;
    registrationOpenDaysBefore?: number | null;
    registrationCloseMinutesBefore?: number;
    locationName?: string | null;
    mappings: Array<{
      competitionId: string;
      sourceEventCategoryId: string;
    }>;
    overrides?: Array<{
      sourceDate: string;
      action: "skip" | "cancel" | "reschedule";
      replacementDate?: string | null;
      replacementLocalStartTime?: string | null;
      reason?: string | null;
    }>;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<RecreationalLeagueScheduleRule>({
    path: `/v1/organizer/league-seasons/${seasonId}/recurrence-rules`,
    method: "POST",
    body: input,
  });
}

export async function materializeRecreationalLeagueSchedule(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
  ruleId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<RecreationalLeagueScheduleRule>({
    path: `/v1/organizer/league-seasons/${seasonId}/recurrence-rules/${ruleId}/materialize`,
    method: "POST",
  });
}

export async function getLegacyImportReviewWorkspace(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<LegacyImportReviewWorkspace>({
    path: `/v1/organizer/league-seasons/${seasonId}/import-review`,
  });
}

export async function detachOrganizerLeagueRound(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
  roundId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedLeagueSeason>({
    path: `/v1/organizer/league-seasons/${seasonId}/rounds/${roundId}/delete`,
    method: "POST",
  });
}

export async function detachAllOrganizerLeagueRounds(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedLeagueSeason>({
    path: `/v1/organizer/league-seasons/${seasonId}/rounds/delete-all`,
    method: "POST",
  });
}

export type PublishOrganizerLeagueSeasonRacesResult = {
  seasonId: string;
  roundCount: number;
  eventCount: number;
  raceCount: number;
  publishedRaceCount: number;
  unchangedRaceCount: number;
  publishedEventCount: number;
  unchangedEventCount: number;
};

export async function publishOrganizerLeagueSeasonRaces(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<PublishOrganizerLeagueSeasonRacesResult>({
    path: `/v1/organizer/league-seasons/${seasonId}/races/publish-all`,
    method: "POST",
  });
}

export async function deleteOrganizerLeague(
  account: AuthAccountContext | null | undefined,
  leagueId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{ deleted: boolean; leagueId: string }>({
    path: `/v1/organizer/leagues/${leagueId}/delete`,
    method: "POST",
  });
}

export async function publishOrganizerLeagueSeason(
  account: AuthAccountContext | null | undefined,
  seasonId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerManagedLeagueSeason>({
    path: `/v1/organizer/league-seasons/${seasonId}/publish`,
    method: "POST",
  });
}

export async function getOrganizerRegistrations(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
): Promise<OrganizerRegistrationRecord[]> {
  if (account?.hasOrganizerAccess) {
    return apiRequest<OrganizerRegistrationRecord[]>({
      path: `/v1/organizer/editions/${eventEditionId}/registrations`,
    });
  }

  const client = requireClient();
  if (!account?.hasOrganizerAccess) return [];

  const { data: categoryRows, error: categoryError } = await client
    .from("event_categories")
    .select("id,name")
    .eq("event_edition_id", eventEditionId)
    .order("distance_km", { ascending: true });

  if (categoryError) throw categoryError;
  if (!categoryRows?.length) return [];

  const categoryIds = categoryRows.map((row) => row.id);
  const [
    { data: registrationRows, error: registrationError },
    { data: bibRows, error: bibError },
    { data: checkinRows, error: checkinError },
  ] = await Promise.all([
    client
      .from("registrations")
      .select("id,event_category_id,athlete_profile_id,represented_club_id,status,payment_status,participation_status,created_at,confirmed_at")
      .in("event_category_id", categoryIds)
      .order("created_at", { ascending: false }),
    client
      .from("bib_assignments")
      .select("registration_id,bib_number,revoked_at,event_category_id,event_edition_id")
      .eq("event_edition_id", eventEditionId)
      .is("revoked_at", null),
    client
      .from("checkins")
      .select("registration_id,checked_in_at"),
  ]);

  if (registrationError) throw registrationError;
  if (bibError) throw bibError;
  if (checkinError) throw checkinError;
  if (!registrationRows?.length) return [];

  const athleteIds = Array.from(new Set(registrationRows.map((row) => row.athlete_profile_id)));
  const clubIds = Array.from(
    new Set(
      registrationRows
        .map((row) => row.represented_club_id)
        .filter(Boolean),
    ),
  ) as string[];

  const [athleteRows, clubRows] = await Promise.all([
    athleteIds.length
      ? client
          .from("public_athlete_profiles")
          .select("id,display_name")
          .in("id", athleteIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; display_name: string }>),
    clubIds.length
      ? client
          .from("clubs")
          .select("id,name")
          .in("id", clubIds)
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  const athleteById = new Map(athleteRows.map((row) => [row.id, row.display_name]));
  const clubById = new Map(clubRows.map((row) => [row.id, row.name]));
  const categoryById = new Map(categoryRows.map((row) => [row.id, row.name]));
  const bibByRegistrationId = new Map(
    (bibRows ?? []).map((row) => [row.registration_id, row.bib_number]),
  );
  const checkInByRegistrationId = new Map(
    (checkinRows ?? []).map((row) => [row.registration_id, row.checked_in_at]),
  );

  return registrationRows.map((row) => ({
    id: row.id,
    eventEditionId,
    eventCategoryId: row.event_category_id,
    athleteProfileId: row.athlete_profile_id,
    athleteName: athleteById.get(row.athlete_profile_id) ?? "Unknown athlete",
    athleteFirstName: (athleteById.get(row.athlete_profile_id) ?? "Unknown athlete").trim().split(/\s+/)[0] ?? "Unknown athlete",
    athleteLastName: (athleteById.get(row.athlete_profile_id) ?? "").trim().split(/\s+/).slice(1).join(" "),
    categoryName: categoryById.get(row.event_category_id) ?? "Category",
    clubName: row.represented_club_id ? clubById.get(row.represented_club_id) ?? null : null,
    countryCode: null,
    gender: null,
    dateOfBirth: null,
    ageOnRaceDay: null,
    sexCategory: null,
    ageCategory: null,
    classificationName: null,
    status: row.status,
    paymentStatus: row.payment_status,
    participationStatus: row.participation_status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    bibNumber: bibByRegistrationId.get(row.id) ?? null,
    checkedInAt: checkInByRegistrationId.get(row.id) ?? null,
    paymentEvidenceCount: 0,
  }));
}

export async function findOrganizerOnsiteAthleteMatches(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
  input: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerOnsiteAthleteMatch[]>({
    path: `/v1/organizer/editions/${encodeURIComponent(eventEditionId)}/onsite-athlete-matches`,
    method: "POST",
    body: input,
  });
}

export async function createOrganizerOnsiteRegistration(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
  input: CreateOrganizerOnsiteRegistrationInput,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{
    registration: OrganizerRegistrationRecord;
    profileCreated: boolean;
    replayed: boolean;
  }>({
    path: `/v1/organizer/editions/${encodeURIComponent(eventEditionId)}/onsite-registrations`,
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: {
      eventCategoryId: input.eventCategoryId,
      existingAthleteProfileId: input.existingAthleteProfileId ?? null,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      city: input.city ?? null,
      countryCode: input.countryCode ?? null,
      phone: input.phone ?? null,
      emergencyContactName: input.emergencyContactName ?? null,
      emergencyContactPhone: input.emergencyContactPhone ?? null,
      bibNumber: input.bibNumber ?? null,
      publicStartListOptIn: input.publicStartListOptIn ?? false,
      organizerAttested: input.organizerAttested,
    },
  });
}

export async function updateOrganizerRegistration(
  account: AuthAccountContext | null | undefined,
  input: {
    registrationId: string;
    eventEditionId: string;
    eventCategoryId: string;
    bibNumber?: string | null;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerRegistrationRecord>({
    path: `/v1/organizer/registrations/${input.registrationId}/update`,
    method: "POST",
    body: {
      bibNumber: input.bibNumber,
    },
  });
}

export async function removeOrganizerRegistration(
  account: AuthAccountContext | null | undefined,
  registrationId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{
    removed: boolean;
    replayed: boolean;
    registrationId: string;
    cancellation: {
      registrationId: string;
      status: string;
      paymentStatus?: string;
      refundRequired?: boolean;
    } | null;
    registrations: OrganizerRegistrationRecord[];
  }>({
    path: `/v1/organizer/registrations/${encodeURIComponent(registrationId)}/remove`,
    method: "POST",
  });
}

export async function removeAllOrganizerRegistrations(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<{
    eventEditionId: string;
    removedCount: number;
    cancelledCount: number;
    registrations: OrganizerRegistrationRecord[];
  }>({
    path: `/v1/organizer/editions/${encodeURIComponent(eventEditionId)}/registrations/remove-all`,
    method: "POST",
  });
}

export const removeInactiveOrganizerRegistration = removeOrganizerRegistration;

export async function bulkAssignBibNumbers(
  account: AuthAccountContext | null | undefined,
  assignments: Array<{
    registrationId: string;
    eventEditionId: string;
    eventCategoryId: string;
    bibNumber: string;
  }>,
) {
  for (const assignment of assignments) {
    await updateOrganizerRegistration(account, {
      registrationId: assignment.registrationId,
      eventEditionId: assignment.eventEditionId,
      eventCategoryId: assignment.eventCategoryId,
      bibNumber: assignment.bibNumber,
    });
  }
}

export async function checkInOrganizerRegistration(
  account: AuthAccountContext | null | undefined,
  input: {
    registrationId: string;
    locationLabel?: string | null;
    notes?: string | null;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerRegistrationRecord>({
    path: `/v1/organizer/registrations/${input.registrationId}/check-in`,
    method: "POST",
    body: {
      locationLabel: input.locationLabel ?? null,
      notes: input.notes ?? null,
    },
  });
}

export async function undoOrganizerRegistrationCheckIn(
  account: AuthAccountContext | null | undefined,
  registrationId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerRegistrationRecord>({
    path: `/v1/organizer/registrations/${registrationId}/check-in`,
    method: "DELETE",
  });
}

export async function getOrganizerRaceDayState(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerRaceDayState>({
    path: `/v1/organizer/editions/${eventEditionId}/race-day`,
  });
}

export async function createOrganizerPracticeRace(
  account: AuthAccountContext | null | undefined,
  organizationId: string,
  sourceEditionId?: string | null,
) {
  ensureOrganizerAccount(account);
  return apiRequest<PracticeRaceState>({
    path: `/v1/organizer/organizations/${organizationId}/practice-race`,
    method: "POST",
    body: sourceEditionId ? { sourceEditionId } : {},
  });
}

export async function getOrganizerPracticeRaceState(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<PracticeRaceState>({
    path: `/v1/organizer/editions/${eventEditionId}/practice-race`,
  });
}

export async function createOrganizerPracticeRegistration(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
  input: {
    eventCategoryId: string;
    firstName: string;
    lastName: string;
    birthYear: number;
    gender: "F" | "M" | "U";
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<PracticeRaceState>({
    path: `/v1/organizer/editions/${eventEditionId}/practice-race/registrations`,
    method: "POST",
    body: input,
  });
}

export async function assignOrganizerPracticeRaceBibs(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<PracticeRaceState>({
    path: `/v1/organizer/editions/${eventEditionId}/practice-race/assign-bibs`,
    method: "POST",
  });
}

export async function resetOrganizerPracticeRace(
  account: AuthAccountContext | null | undefined,
  eventEditionId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<PracticeRaceState>({
    path: `/v1/organizer/editions/${eventEditionId}/practice-race/reset`,
    method: "POST",
  });
}

export async function getOrganizerTimingSessionDetail(
  account: AuthAccountContext | null | undefined,
  sessionId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerTimingSessionDetail>({
    path: `/v1/organizer/timing-sessions/${sessionId}`,
  });
}

export async function createOrganizerTimingSession(
  account: AuthAccountContext | null | undefined,
  input: {
    eventEditionId: string;
    eventCategoryId?: string | null;
    checkpointId?: string | null;
    mode?: "online" | "offline_buffered";
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerTimingSessionDetail>({
    path: "/v1/organizer/timing-sessions",
    method: "POST",
    body: input,
  });
}

export async function closeOrganizerTimingSession(
  account: AuthAccountContext | null | undefined,
  sessionId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerTimingSessionDetail>({
    path: `/v1/organizer/timing-sessions/${sessionId}/close`,
    method: "POST",
  });
}

export async function recordOrganizerPunch(
  account: AuthAccountContext | null | undefined,
  input: {
    timingSessionId: string;
    checkpointId: string;
    clientEventId: string;
    recordedAt: string;
    registrationId?: string | null;
    bibNumber?: string | null;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<{
    punch: OrganizerRaceDayState["recentPunches"][number] | null;
    warnings: OrganizerRaceDayState["recentPunches"][number]["warnings"];
    idempotent: boolean;
    passNumber: number | null;
    expectedPassCount: number;
    completesRace: boolean;
  }>({
    path: "/v1/organizer/punches",
    method: "POST",
    body: input,
  });
}

export async function recordOrganizerSharedPunch(
  account: AuthAccountContext | null | undefined,
  input: {
    eventEditionId: string;
    checkpointIds: string[];
    clientEventId: string;
    recordedAt: string;
    bibNumber: string;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<{
    punch: OrganizerRaceDayState["recentPunches"][number] | null;
    warnings: OrganizerRaceDayState["recentPunches"][number]["warnings"];
    idempotent: boolean;
    passNumber: number | null;
    expectedPassCount: number;
    completesRace: boolean;
  }>({
    path: "/v1/organizer/shared-punches",
    method: "POST",
    body: input,
  });
}

export async function getOrganizerCategoryResults(
  account: AuthAccountContext | null | undefined,
  categoryId: string,
  resultRunId?: string | null,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerCategoryResults>({
    path: `/v1/organizer/categories/${categoryId}/results${
      resultRunId ? `?resultRunId=${encodeURIComponent(resultRunId)}` : ""
    }`,
  });
}

export async function recomputeOrganizerCategoryResults(
  account: AuthAccountContext | null | undefined,
  categoryId: string,
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerCategoryResults>({
    path: `/v1/organizer/categories/${categoryId}/results/recompute`,
    method: "POST",
  });
}

export async function createOrganizerResultComplaint(
  account: AuthAccountContext | null | undefined,
  categoryId: string,
  input: {
    registrationId?: string | null;
    bibNumber?: string | null;
    complainantName: string;
    complaintText: string;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerCategoryResults>({
    path: `/v1/organizer/categories/${categoryId}/result-complaints`,
    method: "POST",
    body: input,
  });
}

export async function resolveOrganizerResultComplaint(
  account: AuthAccountContext | null | undefined,
  complaintId: string,
  input: {
    status: "resolved" | "dismissed";
    resolutionNote: string;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerCategoryResults>({
    path: `/v1/organizer/result-complaints/${complaintId}`,
    method: "POST",
    body: input,
  });
}

export async function publishOrganizerCategoryResults(
  account: AuthAccountContext | null | undefined,
  categoryId: string,
  input: {
    resultRunId?: string | null;
    publicationState?: "provisional" | "official" | "corrected";
    changeNote?: string | null;
    clientEventId: string;
  },
) {
  ensureOrganizerAccount(account);
  return apiRequest<OrganizerCategoryResults>({
    path: `/v1/organizer/categories/${categoryId}/results/publish`,
    method: "POST",
    body: input,
  });
}

export type OrganizerManagedRace = OrganizerManagedEvent;
export type OrganizerManagedRaceLocation = OrganizerManagedEventLocation;
export type OrganizerManagedRaceTimelineItem = OrganizerManagedEventTimelineItem;
export type OrganizerRaceInput = OrganizerEventInput;

export const getOrganizerRaces = getOrganizerEvents;
export const getOrganizerRaceById = getOrganizerEventById;
export const createOrganizerRace = createOrganizerEvent;
export const updateOrganizerRace = updateOrganizerEvent;
export const publishOrganizerRace = publishOrganizerEvent;
export const unpublishOrganizerRace = unpublishOrganizerEvent;
export const deleteOrganizerRace = deleteOrganizerEvent;
