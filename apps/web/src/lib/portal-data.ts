import { raceFeeAt, type RaceFeePeriod } from "@raceson/domain/categories";
import { format, formatDistanceToNowStrict } from "date-fns";
import { apiRequest, resolveApiUrl } from "@/lib/api";
import { resolveRecoveredPublicMediaUrl } from "@/shared/media/recoveredPublicMedia";
import {
  getPublicRaceLifecycleLabel,
  getPublicRaceLifecycleStatus,
} from "@/features/events/public/model/eventStatusPresentation";
import { BADGE_DEFINITIONS } from "@/lib/badge-catalog.generated";
import { getSupabaseBrowserClient, getSupabasePublicClient } from "@/lib/supabase";
import { resolveCurrentUserAccountContext } from "@/lib/auth";
import {
  getCatalogBadgeVisualSpec,
  type BadgeUiStatus,
  type BadgeVisualSpec,
} from "@/lib/badge-system";
import {
  buildPublicCheckpointName,
  resolvePublicLocationLabel,
} from "@/lib/public-location-labels";
import {
  emptyPublishedTrackRaceRecords,
  loadPublishedTrackRaceRecords,
  selectTrackRaceRecordSnapshots,
  type TrackSnapshotRecordLink,
} from "@/features/tracks/public/data/trackRaceRecords";
import {
  formatTrackRecordDuration,
  mergeTrackRecordCandidates,
  resolveTrackRecordOccurredAt,
  type TrackRecordSourceKind,
} from "@/features/tracks/public/model/trackRecords";
import { legacyEventMedia } from "@/features/events/public/data/legacyEventMedia";
import {
  loadPublicEventDetailBundle,
  loadPublicEventGeometryBundle,
  type PublicEventRegistrationCountRow,
} from "@/features/events/public/data/publicEventBundles";
import {
  buildEventLeagueMembershipsByEdition,
  type EventLeagueMembership,
} from "@/features/events/public/model/eventLeagueMembership";
import { selectEventPublicLocationLabel } from "@/features/events/public/model/eventPublicPresentation";
import { formatEventDistanceKm } from "@/features/events/public/model/eventInfoPresentation";
import { resolveCoursePointGeometry } from "@/features/events/model/coursePointGeometry";
import {
  getTrackDifficultyLabel,
  resolveTrackDifficultyLevel,
  type TrackDifficultyLevel,
} from "@/features/tracks/model/trackDifficulty";
import { organizationCountryLabel } from "@/features/accounts/model/organizationLocation";
import {
  DEFAULT_EVENT_ACTIVITY_TYPE,
  normalizeEventActivityType,
  type EventActivityType,
} from "@raceson/domain/activities";
import {
  DEFAULT_SPORT_CODE,
  normalizeSportSelection,
  type SportCode,
} from "@raceson/domain/sports";

export type PortalCheckpoint = {
  name: string;
  km: number;
  elev: number;
  lat: number;
  lng: number;
  type?: string;
};

export type PortalRaceCheckpoint = {
  checkpointId?: string;
  code?: string | null;
  sequenceNumber?: number;
  name: string;
  km: number | null;
  elev: number | null;
  lat: number | null;
  lng: number | null;
  type: string;
  typeTags: string[];
  athleteNote: string | null;
  isMandatory: boolean;
  cutoffLabel: string | null;
};

export type PortalEventCategory = {
  id?: string;
  slug: string;
  name: string;
  coverImageUrl?: string | null;
  sportCode?: SportCode;
  distance: string;
  elevation: string;
  participants: number;
  confirmedParticipants?: number;
  pendingParticipants?: number;
  maxParticipants: number;
  price: string;
  registrationFeeCents?: number;
  feePeriods?: RaceFeePeriod[];
  feeCurrency?: string;
  cutoff: string;
  startLabel?: string | null;
  startAtIso?: string | null;
  minimumAge?: number | null;
  maximumAge?: number | null;
  allowedGenders?: string[];
  eligibilityNote?: string | null;
  statusLabel?: string;
  linkedTrackSlug?: string | null;
  linkedTrackName?: string | null;
  organizerNotes?: string | null;
  checkpoints?: PortalCheckpoint[];
  raceCheckpoints?: PortalRaceCheckpoint[];
  trackPoints?: [number, number][];
  elevationPoints?: PortalElevPoint[];
};

export class PublicEventNotFoundError extends Error {
  constructor(slug: string) {
    super(`Race ${slug} not found`);
    this.name = "PublicEventNotFoundError";
  }
}

export class PublicTrackNotFoundError extends Error {
  constructor(slug: string) {
    super(`Route ${slug} not found`);
    this.name = "PublicTrackNotFoundError";
  }
}

export type PortalEventDocument = {
  title: string;
  documentType: string;
  storagePath: string;
};

export type PortalPreviousEdition = {
  slug: string;
  label: string;
};

export type PortalEventLocation = {
  id: string;
  type: string;
  label: string;
  description: string | null;
  place: string | null;
  lat: number | null;
  lng: number | null;
  displayOrder: number;
};

export type PortalEventTimelineItem = {
  time: string;
  description: string;
};

export type PortalEventGalleryItem = {
  id: string;
  imageUrl: string;
  caption: string;
  width?: number;
  height?: number;
};

export type PortalEventVideo = {
  id: string;
  url: string;
  title: string;
  posterUrl?: string | null;
};

export type EventDetailData = {
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  editionId?: string;
  slug: string;
  name: string;
  activityType?: EventActivityType;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  subtitle: string;
  statusLabel: string;
  dateLabel: string;
  timezone: string;
  startDateIso: string | null;
  endDateIso: string | null;
  locationLabel: string;
  countryCode: string | null;
  registeredCount: number;
  distanceSummary: string;
  organizerName: string;
  organizerLogoImageUrl: string | null;
  organizerLocationLabel: string | null;
  organizerDescription: string | null;
  organizerContactEmail: string | null;
  organizerContactPhone: string | null;
  organizerWebsiteUrl: string | null;
  organizer: PublicOrganizationProfile;
  about: string;
  organizerRules?: string | null;
  coverImageUrl?: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  locations: PortalEventLocation[];
  timeline: PortalEventTimelineItem[];
  gallery: PortalEventGalleryItem[];
  videos: PortalEventVideo[];
  categories: PortalEventCategory[];
  informativeLabels?: Array<{
    id: string;
    slug: string;
    name: string;
  }>;
  leagueMemberships?: EventLeagueMembership[];
  checkpoints: PortalCheckpoint[];
  trackPoints: [number, number][];
  documents: PortalEventDocument[];
  previousEditions: PortalPreviousEdition[];
  infoItems: Array<[string, string]>;
  linkedTrackSlug: string;
  linkedTrackName: string;
};

type PublicOrganizationProfileInput = {
  name?: string | null;
  country_code?: string | null;
  region?: string | null;
  city?: string | null;
  description?: string | null;
  website_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
  youtube_url?: string | null;
  tiktok_url?: string | null;
  x_url?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  logo_image_url?: string | null;
  profile_visibility?: string | null;
  contact_details_visibility?: string | null;
};

export type PublicOrganizationProfile = {
  name: string | null;
  logoImageUrl: string | null;
  locationLabel: string | null;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  xUrl: string | null;
};

function trimmedText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function publicImageUrl(value: string | null | undefined) {
  const imageUrl = trimmedText(value);
  if (!imageUrl || imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return null;
  return resolveRecoveredPublicMediaUrl(imageUrl);
}

function publicOrganizationLogoUrl(value: string | null | undefined) {
  const imageUrl = trimmedText(value);
  // Organization uploads persist raster data URLs; event covers and galleries
  // retain their separate remote-image policy.
  if (imageUrl && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl)) {
    return imageUrl;
  }
  return publicImageUrl(imageUrl);
}

export function mapPublicOrganizationProfile(
  organization: PublicOrganizationProfileInput | null | undefined,
): PublicOrganizationProfile {
  const name = trimmedText(organization?.name);
  const profileIsPublic = organization?.profile_visibility === "public";
  const contactsArePublic = organization?.contact_details_visibility === "public";
  const countryCode = trimmedText(organization?.country_code);
  const locationParts = profileIsPublic
    ? [
        trimmedText(organization?.city),
        trimmedText(organization?.region),
        countryCode ? organizationCountryLabel(countryCode) : null,
      ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    : [];

  return {
    // The organization name is attribution, so it remains public even when the
    // expanded profile is restricted.
    name,
    logoImageUrl: profileIsPublic ? publicOrganizationLogoUrl(organization?.logo_image_url) : null,
    locationLabel: locationParts.length ? locationParts.join(", ") : null,
    description: profileIsPublic ? trimmedText(organization?.description) : null,
    contactEmail: contactsArePublic ? trimmedText(organization?.contact_email) : null,
    contactPhone: contactsArePublic ? trimmedText(organization?.contact_phone) : null,
    websiteUrl: contactsArePublic ? trimmedText(organization?.website_url) : null,
    instagramUrl: contactsArePublic ? trimmedText(organization?.instagram_url) : null,
    facebookUrl: contactsArePublic ? trimmedText(organization?.facebook_url) : null,
    linkedinUrl: contactsArePublic ? trimmedText(organization?.linkedin_url) : null,
    youtubeUrl: contactsArePublic ? trimmedText(organization?.youtube_url) : null,
    tiktokUrl: contactsArePublic ? trimmedText(organization?.tiktok_url) : null,
    xUrl: contactsArePublic ? trimmedText(organization?.x_url) : null,
  };
}

export type PortalTrackAttempt = {
  id: string;
  rank: number;
  name: string;
  athleteSlug: string | null;
  elapsedTimeMs: number;
  time: string;
  date: string;
  verified: boolean;
  strava: string | null;
  gender: "F" | "M" | null;
  sourceKind: TrackRecordSourceKind;
  sourceLabel: string;
  sourceHref: string | null;
};

export type PortalTrackReview = {
  id: string;
  name: string;
  title?: string | null;
  rating: number;
  text: string;
  date: string;
  difficulty?: string | null;
  terrainLabels?: string[];
  navigationQuality?: string | null;
  bestForTags?: string[];
  helpfulCount: number;
  notHelpfulCount: number;
  viewerReaction: "helpful" | "not_helpful" | null;
  comments: PortalTrackReviewComment[];
};

export type PortalTrackReviewComment = {
  id: string;
  reviewId: string;
  authorAthleteProfileId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type PortalEventReviewComment = {
  id: string;
  reviewId: string;
  authorAthleteProfileId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type PortalEventReview = {
  id: string;
  name: string;
  rating: number;
  title: string | null;
  text: string;
  date: string;
  comments: PortalEventReviewComment[];
};

export type PortalEventCommunity = {
  reviews: PortalEventReview[];
  reviewCount: number;
  commentCount: number;
  averageRating: number | null;
};

export type PortalTrackCondition = {
  label: string;
  status: "good" | "caution" | "warning" | "closed";
  note: string;
  reporter: string;
  date: string;
  cautionType?: "strong-wind" | "slippery-ground" | "steep-descent" | "loose-rock" | "general-caution";
  markerLat?: number;
  markerLng?: number;
  markerDistKm?: number;
  markerElev?: number;
};

export type PortalTrackBadge = {
  id: string;
  name: string;
  description: string;
  status: BadgeUiStatus;
  progress?: number;
  visual: BadgeVisualSpec;
};

export type PortalTrackSegment = {
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

export type PortalTrackGalleryItem = {
  id: string;
  imageUrl: string;
  storagePath?: string | null;
  caption: string | null;
  isDefault: boolean;
};

export type PortalElevPoint = {
  distKm: number;
  elev: number;
  grade: number;
  lat: number;
  lng: number;
};

export type TrackDetailData = {
  slug: string;
  name: string;
  sportCode: SportCode;
  location: string;
  overview: string;
  distance: number;
  elevation: number;
  difficulty: string;
  difficultyLevel: TrackDifficultyLevel;
  surface: string;
  rating: number;
  totalRatings: number;
  attempts: number;
  season: string;
  waterPoints: number;
  parking: string;
  bestTime: string;
  warnings: string;
  weatherLocation: string;
  linkedEvent: string | null;
  linkedEventId: string | null;
  linkedEventImageUrl: string | null;
  linkedEventDateLabel: string | null;
  linkedEventStatus: string | null;
  organizer: PublicOrganizationProfile;
  checkpoints: PortalCheckpoint[];
  trackPoints: [number, number][];
  elevationPoints: PortalElevPoint[];
  segments: PortalTrackSegment[];
  gallery: PortalTrackGalleryItem[];
  gpxDownloadUrl: string | null;
  gpxFileName: string | null;
  leaderboard: PortalTrackAttempt[];
  reviews: PortalTrackReview[];
  conditions: PortalTrackCondition[];
  badges: PortalTrackBadge[];
};

type TrackConditionReportMetadata = {
  cautionType?: PortalTrackCondition["cautionType"];
  lat?: number;
  lng?: number;
  distKm?: number;
  elev?: number;
};

type TrackReviewMetadata = {
  difficulty?: string;
  terrainLabels?: string[];
  navigationQuality?: string;
  bestForTags?: string[];
};

type PortalInfoItem = [string, string];

function mergeInfoItems(primary: PortalInfoItem[], fallback: PortalInfoItem[]) {
  const merged = [...primary];
  const seen = new Set(primary.map(([label]) => label));

  fallback.forEach((item) => {
    if (seen.has(item[0])) return;
    merged.push(item);
    seen.add(item[0]);
  });

  return merged;
}

type SubmitTrackConditionReportInput = {
  trackSlug: string;
  status: PortalTrackCondition["status"];
  title: string;
  note: string;
  cautionType?: PortalTrackCondition["cautionType"];
  lat?: number;
  lng?: number;
  distKm?: number;
  elev?: number;
};

type SubmitTrackReviewInput = {
  trackSlug: string;
  rating: number;
  text: string;
  difficulty?: string;
  terrainLabels?: string[];
  navigationQuality?: string;
  bestForTags?: string[];
};

const TRACK_CONDITION_META_MARKER = "\n\n[tport-condition-meta]";
const TRACK_REVIEW_META_MARKER = "\n\n[tport-review-meta]";

export type AthleteFavoriteEvent = {
  slug: string;
  name: string;
  date: string;
  location: string;
  categories: string[];
  registered: boolean;
};

export type AthleteFavoriteAthlete = {
  slug: string;
  name: string;
  club: string;
  rank: number;
  points: number;
};

export type AthleteFavoriteClub = {
  slug: string;
  name: string;
  location: string;
  members: number;
};

export type AthleteFavoritesData = {
  events: AthleteFavoriteEvent[];
  athletes: AthleteFavoriteAthlete[];
  clubs: AthleteFavoriteClub[];
};

export type AthleteTrainingSession = {
  id: string;
  title: string;
  date: string;
  location: string;
  distance: number;
  elevation: number;
  duration: string;
  effort: string;
  note: string;
  tags: string[];
};

export type AthleteTrainingFocusTrack = {
  name: string;
  target: string;
  distance: string;
  elevation: string;
  tags: string[];
};

export type AthleteTrainingData = {
  weeklyLoad: Array<{ week: string; km: number; elev: number }>;
  recentSessions: AthleteTrainingSession[];
  focusTracks: AthleteTrainingFocusTrack[];
  milestones: Array<{ label: string; tier: "default" | "bronze" | "gold" }>;
};

const fallbackEventDetails: Record<string, EventDetailData> = {};

const fallbackTrackDetails: Record<string, TrackDetailData> = {};

function parseTrackConditionReportNote(note: string | null | undefined) {
  const rawNote = typeof note === "string" ? note : "";
  const markerIndex = rawNote.lastIndexOf(TRACK_CONDITION_META_MARKER);

  if (markerIndex === -1) {
    return {
      note: rawNote.trim(),
      metadata: null as TrackConditionReportMetadata | null,
    };
  }

  const visibleNote = rawNote.slice(0, markerIndex).trim();
  const rawMetadata = rawNote.slice(markerIndex + TRACK_CONDITION_META_MARKER.length).trim();

  try {
    const parsed = JSON.parse(rawMetadata) as TrackConditionReportMetadata;
    return {
      note: visibleNote,
      metadata: parsed,
    };
  } catch {
    return {
      note: rawNote.trim(),
      metadata: null as TrackConditionReportMetadata | null,
    };
  }
}

function normalizeTrackReviewSelections(values: string[] | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function parseTrackReviewBody(body: string | null | undefined) {
  const rawBody = typeof body === "string" ? body : "";
  const markerIndex = rawBody.lastIndexOf(TRACK_REVIEW_META_MARKER);

  if (markerIndex === -1) {
    return {
      body: rawBody.trim(),
      metadata: null as TrackReviewMetadata | null,
    };
  }

  const visibleBody = rawBody.slice(0, markerIndex).trim();
  const rawMetadata = rawBody.slice(markerIndex + TRACK_REVIEW_META_MARKER.length).trim();

  try {
    const parsed = JSON.parse(rawMetadata) as TrackReviewMetadata;
    return {
      body: visibleBody,
      metadata: {
        difficulty: parsed.difficulty?.trim() || undefined,
        terrainLabels: normalizeTrackReviewSelections(parsed.terrainLabels),
        navigationQuality: parsed.navigationQuality?.trim() || undefined,
        bestForTags: normalizeTrackReviewSelections(parsed.bestForTags),
      },
    };
  } catch {
    return {
      body: rawBody.trim(),
      metadata: null as TrackReviewMetadata | null,
    };
  }
}

export const demoFavoritesData: AthleteFavoritesData = {
  events: [
    { slug: "biokovo-challenge", name: "Biokovo Mountain Challenge", date: "May 17, 2026", location: "Makarska, Croatia", categories: ["Ultra 55K", "30K"], registered: true },
  ],
  athletes: [
    { slug: "ana-kovac", name: "Ana Kovac", club: "TK Zagreb", rank: 1, points: 520 },
    { slug: "petra-novak", name: "Petra Novak", club: "PD Velebit", rank: 4, points: 410 },
    { slug: "ivan-horvat", name: "Ivan Horvat", club: "AK Slavonija", rank: 7, points: 365 },
  ],
  clubs: [
    { slug: "pd-mosor", name: "PD Mosor", location: "Split, Croatia", members: 64 },
    { slug: "tk-zagreb", name: "TK Zagreb Marathon", location: "Zagreb, Croatia", members: 234 },
  ],
};

export const emptyAthleteTrainingData: AthleteTrainingData = {
  weeklyLoad: [],
  recentSessions: [],
  focusTracks: [],
  milestones: [],
};

const legacyGhostAthleteActivityIds = new Set([
  "40000000-0000-4000-8000-000000000020",
  "40000000-0000-4000-8000-000000000021",
  "40000000-0000-4000-8000-000000000022",
]);

function buildEmptyEventDetail(slug: string): EventDetailData {
  const derivedName = slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const media = legacyEventMedia[slug] ?? { gallery: [], videos: [] };

  return {
    slug,
    name: derivedName || "Trail Race",
    activityType: DEFAULT_EVENT_ACTIVITY_TYPE,
    sportCodes: [DEFAULT_SPORT_CODE],
    primarySportCode: DEFAULT_SPORT_CODE,
    subtitle: "",
    statusLabel: "Published",
    dateLabel: "Date TBA",
    timezone: "Europe/Zagreb",
    startDateIso: null,
    endDateIso: null,
    locationLabel: "Croatia",
    countryCode: "HR",
    registeredCount: 0,
    distanceSummary: "Distances TBA",
    organizerName: "Organizer",
    organizerLogoImageUrl: null,
    organizerLocationLabel: null,
    organizerDescription: null,
    organizerContactEmail: null,
    organizerContactPhone: null,
    organizerWebsiteUrl: null,
    organizer: mapPublicOrganizationProfile(null),
    about: "",
    organizerRules: null,
    coverImageUrl: null,
    websiteUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    locations: [],
    timeline: [],
    gallery: media.gallery,
    videos: media.videos,
    categories: [],
    checkpoints: [],
    trackPoints: [],
    documents: [],
    previousEditions: [],
    infoItems: [
      ["Organizer", "Organizer"],
      ["Edition", "TBA"],
      ["Categories", "0"],
      ["Total slots", "0"],
      ["Region", "Croatia"],
      ["Status", "Published"],
    ],
    linkedTrackSlug: "",
    linkedTrackName: "",
  };
}

function buildEmptyTrackDetail(slug: string): TrackDetailData {
  return {
    slug,
    name: slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    sportCode: DEFAULT_SPORT_CODE,
    location: "Croatia",
    overview: "",
    distance: 0,
    elevation: 0,
    difficulty: "Beginner",
    difficultyLevel: 1,
    surface: "",
    rating: 0,
    totalRatings: 0,
    attempts: 0,
    season: "",
    waterPoints: 0,
    parking: "",
    bestTime: "",
    warnings: "",
    weatherLocation: "Croatia",
    linkedEvent: null,
    linkedEventId: null,
    linkedEventImageUrl: null,
    linkedEventDateLabel: null,
    linkedEventStatus: null,
    organizer: mapPublicOrganizationProfile(null),
    checkpoints: [],
    trackPoints: [],
    elevationPoints: [],
    segments: [],
    gallery: [],
    gpxDownloadUrl: null,
    gpxFileName: null,
    leaderboard: [],
    reviews: [],
    conditions: [],
    badges: [],
  };
}

function fallbackEvent(slug: string) {
  const exact = fallbackEventDetails[slug];
  if (exact) return exact;

  return buildEmptyEventDetail(slug);
}

function fallbackTrack(slug: string) {
  const direct = fallbackTrackDetails[slug];
  if (direct) return direct;

  return buildEmptyTrackDetail(slug);
}

export function getFallbackEventDetail(slug: string) {
  return fallbackEvent(slug);
}

export function getFallbackTrackDetail(slug: string) {
  return fallbackTrack(slug);
}

function buildTrackBadgeShowcase(
  badges: Array<{ slug: string; status: BadgeUiStatus; progress?: number }>,
): PortalTrackBadge[] {
  return badges.flatMap((item) => {
    const definition = BADGE_DEFINITIONS.find((candidate) => candidate.slug === item.slug);
    const visual = getCatalogBadgeVisualSpec(item.slug);

    if (!definition || !visual) {
      console.warn(`Route badge showcase item missing from catalog: ${item.slug}`);
      return [];
    }

    return [{
      id: item.slug,
      name: definition.name,
      description: definition.description,
      status: item.status,
      progress: item.progress,
      visual,
    }];
  });
}

export function formatEventStatus(status: string | null | undefined) {
  return getPublicRaceLifecycleLabel(status);
}

export function formatRaceStatus(
  status: string | null | undefined,
  eventStatusLabel: string,
) {
  const eventLifecycle = getPublicRaceLifecycleStatus(eventStatusLabel);
  const raceLifecycle = getPublicRaceLifecycleStatus(status);
  if (eventLifecycle === "finished" || raceLifecycle === "finished") return "Finished";
  if (eventLifecycle === "ongoing" || raceLifecycle === "ongoing") return "Ongoing";
  return "Open";
}

export function derivePublicEventStatus(
  status: string | null | undefined,
  _registrationOpenAt: string | null | undefined,
  _registrationCloseAt: string | null | undefined,
  _now = new Date(),
) {
  const normalized = status?.trim().toLowerCase() || "published";
  if ([
    "registration_open",
    "registration_closed",
    "in_progress",
    "completed",
    "archived",
  ].includes(normalized)) return normalized;
  return "registration_open";
}

function normalizeEventStatus(status: string | null | undefined) {
  return (status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function isEventFinishedStatus(status: string | null | undefined) {
  const normalized = normalizeEventStatus(status);
  return normalized === "completed"
    || normalized === "archived"
    || normalized === "finished"
    || normalized.includes("finish");
}

export function isEventRegistrationOpenStatus(status: string | null | undefined) {
  const normalized = normalizeEventStatus(status);
  return normalized === "open" || normalized === "registration_open";
}

function formatMoney(cents: number | null | undefined, currency: string | null | undefined) {
  if (cents == null) return "TBA";
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency ?? "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDistanceLabel(distanceKm: number | null | undefined) {
  if (distanceKm == null) return "TBA";
  return `${formatEventDistanceKm(distanceKm)} km`;
}

function formatElevationLabel(elevationGain: number | null | undefined) {
  if (elevationGain == null) return "TBA";
  return `${elevationGain.toLocaleString()}m D+`;
}

function formatEventDateLabel(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!startDate) return "Date TBA";

  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return startDate;
  if (!endDate || endDate === startDate) return format(start, "MMMM d, yyyy");

  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return format(start, "MMMM d, yyyy");

  if (format(start, "yyyy-MM") === format(end, "yyyy-MM")) {
    return `${format(start, "MMMM d")} - ${format(end, "d, yyyy")}`;
  }

  if (format(start, "yyyy") === format(end, "yyyy")) {
    return `${format(start, "MMMM d")} - ${format(end, "MMMM d, yyyy")}`;
  }

  return `${format(start, "MMMM d, yyyy")} - ${format(end, "MMMM d, yyyy")}`;
}

function formatDurationLabel(seconds: number | null | undefined) {
  if (seconds == null || seconds <= 0) return "TBA";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function mapPolylinePoint(point: unknown): [number, number] | null {
  if (!point || typeof point !== "object") return null;
  const lat = Number((point as { lat?: unknown }).lat);
  const lng = Number((point as { lng?: unknown }).lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function mapElevationPoint(
  point: unknown,
  index: number,
  routePoints: [number, number][],
): PortalElevPoint | null {
  if (!point || typeof point !== "object") return null;
  const distKm = Number((point as { km?: unknown; distKm?: unknown }).km ?? (point as { distKm?: unknown }).distKm ?? index);
  const elev = Number((point as { elev?: unknown }).elev);
  const grade = Number((point as { grade?: unknown }).grade ?? 0);
  const routePoint = routePoints[Math.min(index, routePoints.length - 1)];
  if (!routePoint || !Number.isFinite(distKm) || !Number.isFinite(elev)) return null;
  return {
    distKm,
    elev,
    grade,
    lat: routePoint[0],
    lng: routePoint[1],
  };
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function mapRenderCheckpoints(value: unknown, fallbackCheckpoints: PortalCheckpoint[] = []): PortalCheckpoint[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((checkpoint, index) => {
    if (!checkpoint || typeof checkpoint !== "object") return [];
    const record = checkpoint as Record<string, unknown>;
    const fallbackCheckpoint = fallbackCheckpoints[index];
    const km = numberFromUnknown(record.km) ?? fallbackCheckpoint?.km ?? null;
    const elev = numberFromUnknown(record.elev) ?? fallbackCheckpoint?.elev ?? null;
    const lat = numberFromUnknown(record.lat) ?? fallbackCheckpoint?.lat ?? null;
    const lng = numberFromUnknown(record.lng) ?? fallbackCheckpoint?.lng ?? null;

    if (km == null || elev == null || lat == null || lng == null) {
      return [];
    }

    return [{
      name: buildPublicCheckpointName({
        label:
          typeof record.name === "string" && record.name.trim().length
            ? record.name.trim()
            : fallbackCheckpoint?.name ?? "Checkpoint",
        index,
        totalCount: value.length,
        lat,
        lng,
        type: typeof record.type === "string" ? record.type : fallbackCheckpoint?.type,
        points: fallbackCheckpoints,
        fallbackLabel: fallbackCheckpoint?.name,
      }),
      km,
      elev,
      lat,
      lng,
      type: typeof record.type === "string" ? record.type : fallbackCheckpoint?.type,
    }];
  });
}

function approximateTrackPoint(
  trackPoints: [number, number][],
  index: number,
  totalCheckpoints: number,
) {
  if (!trackPoints.length) return null;
  const ratio = totalCheckpoints <= 1 ? 0 : index / Math.max(totalCheckpoints - 1, 1);
  const pointIndex = Math.round(ratio * (trackPoints.length - 1));
  return trackPoints[Math.min(Math.max(pointIndex, 0), trackPoints.length - 1)] ?? null;
}

function mapCategoryCheckpointRows(
  rows: Array<{
    name: string | null;
    distance_from_start_km: number | string | null;
    checkpoint_type: string | null;
  }>,
  sourceCheckpoints: PortalCheckpoint[],
  trackPoints: [number, number][],
  elevationPoints: PortalElevPoint[],
): PortalCheckpoint[] {
  return rows.flatMap((row, index) => {
    const km = numberFromUnknown(row.distance_from_start_km);
    const geometry = resolveCoursePointGeometry({
      distanceKm: km,
      checkpointType: row.checkpoint_type,
      routePoints: elevationPoints,
      trackCheckpoints: sourceCheckpoints,
    });
    const sourceCheckpoint = sourceCheckpoints.find((checkpoint) => (
      checkpoint.type === row.checkpoint_type
      || (km != null && Math.abs(checkpoint.km - km) < 0.01)
    ));
    const fallbackTrackPoint = approximateTrackPoint(trackPoints, index, rows.length);
    const resolvedKm = km ?? sourceCheckpoint?.km ?? null;
    const elev = geometry?.elev ?? sourceCheckpoint?.elev ?? 0;
    const lat = geometry?.lat ?? sourceCheckpoint?.lat ?? fallbackTrackPoint?.[0] ?? null;
    const lng = geometry?.lng ?? sourceCheckpoint?.lng ?? fallbackTrackPoint?.[1] ?? null;

    if (resolvedKm == null || lat == null || lng == null) {
      return [];
    }

    return [{
      name: buildPublicCheckpointName({
        label: row.name?.trim() || sourceCheckpoint?.name || `Checkpoint ${index + 1}`,
        index,
        totalCount: rows.length,
        lat,
        lng,
        type: row.checkpoint_type ?? sourceCheckpoint?.type,
        points: sourceCheckpoints,
        fallbackLabel: sourceCheckpoint?.name,
      }),
      km: resolvedKm,
      elev,
      lat,
      lng,
      type: row.checkpoint_type ?? sourceCheckpoint?.type,
    }];
  });
}

function normalizeEventTimeline(value: unknown): PortalEventTimelineItem[] {
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

function normalizePublicRaceCheckpointSettings(
  value: unknown,
  checkpointType: string | null | undefined,
): {
  typeTags: string[];
  athleteNote: string | null;
  visibleOnPublicPage: boolean;
} {
  const baseKind = checkpointType === "split" ? "timing_split" : checkpointType === "start" || checkpointType === "finish"
    ? checkpointType
    : "checkpoint";

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      typeTags: [baseKind],
      athleteNote: null,
      visibleOnPublicPage: true,
    };
  }

  const record = value as Record<string, unknown>;
  const rawTypeTags = Array.isArray(record.typeTags)
    ? record.typeTags.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const typeTags = rawTypeTags.length ? rawTypeTags : [baseKind];

  return {
    typeTags,
    athleteNote:
      typeof record.athleteNote === "string" && record.athleteNote.trim().length
        ? record.athleteNote.trim()
        : null,
    visibleOnPublicPage:
      typeof record.visibleOnPublicPage === "boolean" ? record.visibleOnPublicPage : true,
  };
}

function mapPublicRaceCheckpoints(
  rows: Array<{
    id?: string | null;
    code?: string | null;
    name: string | null;
    distance_from_start_km: number | string | null;
    sequence_number?: number | string | null;
    checkpoint_type: string | null;
    cutoff_at: string | null;
    is_mandatory: boolean | null;
    settings_json: unknown;
  }>,
  sourceCheckpoints: PortalCheckpoint[],
  trackPoints: [number, number][],
  elevationPoints: PortalElevPoint[],
): PortalRaceCheckpoint[] {
  return rows.flatMap((row, index) => {
    const settings = normalizePublicRaceCheckpointSettings(row.settings_json, row.checkpoint_type);
    if (!settings.visibleOnPublicPage) return [];

    const km = numberFromUnknown(row.distance_from_start_km);
    const geometry = resolveCoursePointGeometry({
      distanceKm: km,
      checkpointType: row.checkpoint_type,
      routePoints: elevationPoints,
      trackCheckpoints: sourceCheckpoints,
    });
    const sourceCheckpoint = sourceCheckpoints.find((checkpoint) => (
      checkpoint.type === row.checkpoint_type
      || (km != null && Math.abs(checkpoint.km - km) < 0.01)
    ));
    const fallbackTrackPoint = approximateTrackPoint(trackPoints, index, rows.length);
    const resolvedKm = km ?? sourceCheckpoint?.km ?? null;
    const elev = geometry?.elev ?? sourceCheckpoint?.elev ?? null;
    const lat = geometry?.lat ?? sourceCheckpoint?.lat ?? fallbackTrackPoint?.[0] ?? null;
    const lng = geometry?.lng ?? sourceCheckpoint?.lng ?? fallbackTrackPoint?.[1] ?? null;

    return [{
      checkpointId: typeof row.id === "string" && row.id ? row.id : undefined,
      code: typeof row.code === "string" && row.code.trim() ? row.code.trim() : null,
      sequenceNumber: numberFromUnknown(row.sequence_number) ?? index + 1,
      name: row.name?.trim() || sourceCheckpoint?.name || `Checkpoint ${index + 1}`,
      km: resolvedKm,
      elev,
      lat,
      lng,
      type: row.checkpoint_type ?? "checkpoint",
      typeTags: settings.typeTags,
      athleteNote: settings.athleteNote,
      isMandatory: row.is_mandatory ?? true,
      cutoffLabel: row.cutoff_at,
    }];
  });
}

export function normalizeTrackGalleryItems(value: unknown): PortalTrackGalleryItem[] {
  if (!Array.isArray(value)) return [];

  let defaultAssigned = false;
  const seenMedia = new Set<string>();
  const items = value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const imageUrl = typeof record.imageUrl === "string" ? publicImageUrl(record.imageUrl) : null;
    if (!imageUrl) return [];

    const isDefault = typeof record.isDefault === "boolean" ? record.isDefault : false;
    const storagePath = typeof record.storagePath === "string" && record.storagePath.trim()
      ? record.storagePath.trim()
      : null;
    const mediaKey = (storagePath ?? imageUrl).toLowerCase();
    if (seenMedia.has(mediaKey)) return [];
    seenMedia.add(mediaKey);
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

function normalizeTrackAttemptGender(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "F" || normalized === "FEMALE" || normalized === "W" || normalized === "WOMAN") return "F";
  if (normalized === "M" || normalized === "MALE" || normalized === "MAN") return "M";
  return null;
}

function formatTrackRecordDate(value: string | null) {
  if (!value) return "TBA";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? "TBA" : format(parsed, "MMM d, yyyy");
}

function normalizeTrackSegments(value: unknown): PortalTrackSegment[] {
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
    const startKm = numberFromUnknown(record.startKm);
    const endKm = numberFromUnknown(record.endKm);
    const startElev = numberFromUnknown(record.startElev);
    const endElev = numberFromUnknown(record.endElev);
    const avgGrade = numberFromUnknown(record.avgGrade);
    const comment =
      typeof record.comment === "string" && record.comment.trim().length ? record.comment.trim() : null;
    const showOnPublic = typeof record.showOnPublic === "boolean" ? record.showOnPublic : true;

    if (!name || !type || !difficulty) return [];
    if (startKm == null || endKm == null || startElev == null || endElev == null || avgGrade == null) return [];
    if (!showOnPublic) return [];

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
      comment,
      showOnPublic,
    }];
  });
}

function buildTrackSetupBadgeShowcase(input: {
  distanceKm: number | null | undefined;
  elevationGainM: number | null | undefined;
  segmentCount: number;
  waterPointCount: number;
}): PortalTrackBadge[] {
  const items: Array<{ slug: string; status: BadgeUiStatus; progress?: number }> = [
    { slug: "track-first-finish", status: "locked" },
  ];

  if (Number(input.distanceKm ?? 0) >= 20) {
    items.push({ slug: "triple-finisher", status: "locked" });
  }
  if (Number(input.elevationGainM ?? 0) >= 1200) {
    items.push({ slug: "weathered-route", status: "locked" });
  }
  if (input.segmentCount >= 3) {
    items.push({ slug: "track-new-pb", status: "locked" });
  }
  if (Number(input.distanceKm ?? 0) >= 35 || Number(input.elevationGainM ?? 0) >= 2200 || input.waterPointCount >= 3) {
    items.push({ slug: "top-10-time", status: "locked" });
  }

  return buildTrackBadgeShowcase(items);
}

function mapPublicRegistrationCount(row: PublicEventRegistrationCountRow) {
  return {
    registeredCount: Number(row.registered_count ?? 0),
    confirmedCount: Number(row.confirmed_count ?? 0),
    waitlistedCount: Number(row.waitlisted_count ?? 0),
    dnsCount: Number(row.dns_count ?? 0),
    checkedInCount: Number(row.checked_in_count ?? 0),
    starterCount: Number(row.starter_count ?? 0),
    finisherCount: Number(row.finisher_count ?? 0),
  };
}

export async function getEventDetail(slug: string): Promise<EventDetailData> {
  const fallback = buildEmptyEventDetail(slug);
  const hasExactFallback = Object.prototype.hasOwnProperty.call(fallbackEventDetails, slug);
  // Event detail may be public or restricted to active members of selected
  // clubs. The session-aware client lets RLS admit those members while the
  // anonymous path still sees only genuinely public editions.
  const supabase = getSupabaseBrowserClient() ?? getSupabasePublicClient();
  if (!supabase) {
    if (hasExactFallback) return fallback;
    throw new Error("Public race service is unavailable");
  }

  try {
    const bundle = await loadPublicEventDetailBundle(supabase, slug);
    const edition = bundle?.edition ?? null;
    if (!edition) throw new PublicEventNotFoundError(slug);

    const series = bundle.series;
    const categories = bundle.categories;
    const documents = bundle.documents;
    const previousEditions = bundle.previous_editions;
    const locations = bundle.locations;
    const eventSportRows = bundle.sports;
    const leagueMembershipsByEdition = buildEventLeagueMembershipsByEdition({
      rounds: bundle.league_rounds.map((round) => ({
        eventEditionId: round.event_edition_id,
        leagueSeasonId: round.league_season_id,
        roundNumber: round.round_number,
      })),
      seasons: bundle.league_seasons.map((season) => ({
        id: season.id,
        leagueId: season.league_id,
      })),
      leagues: bundle.leagues.map((league) => ({
        id: league.id,
        slug: league.slug,
        name: league.name,
      })),
    });

    const mappedLocations =
      (locations ?? []).map((location, index) => ({
        id: location.id,
        type: location.location_type,
        label: location.label,
        description: typeof location.description === "string" && location.description.trim().length
          ? location.description.trim()
          : null,
        place: typeof location.place_label === "string" && location.place_label.trim().length
          ? location.place_label.trim()
          : null,
        lat: numberFromUnknown(location.latitude),
        lng: numberFromUnknown(location.longitude),
        displayOrder: typeof location.display_order === "number" ? location.display_order : index,
      }));

    const raceCategories = (categories ?? []).filter((category) => (
      category.status !== "draft" && category.results_mode !== "informative_age"
    ));
    const informativeLabels = (categories ?? [])
      .filter((category) => category.status !== "draft" && category.results_mode === "informative_age")
      .map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
    }));
    const primaryCategory = raceCategories[0] ?? null;
    const fallbackCategoryMap = new Map(fallback.categories.map((category) => [category.slug, category]));
    const registrationCountByCategoryId = new Map(
      bundle.registration_counts.map((row) => [
        row.event_category_id,
        mapPublicRegistrationCount(row),
      ]),
    );
    const publicOrganization = mapPublicOrganizationProfile(bundle.organization);
    const snapshots = bundle.snapshots;
    const rawSnapshotByCategoryId = new Map(snapshots.map((snapshot) => [snapshot.event_category_id, snapshot]));
    const trackTemplateById = new Map(bundle.track_templates.map((template) => [template.id, template]));

    const publicEventStatusLabel = formatEventStatus(derivePublicEventStatus(
      edition.status,
      edition.registration_open_at,
      edition.registration_close_at,
    ));
    const dynamicCategories = raceCategories.map((category) => {
      const categoryFallback = fallbackCategoryMap.get(category.slug) ?? fallback.categories[0];
      const rawSnapshot = rawSnapshotByCategoryId.get(category.id);
      const linkedTrack = rawSnapshot ? trackTemplateById.get(rawSnapshot.track_template_id) : null;
      const publicCategoryCheckpoints = (hasExactFallback ? fallback.checkpoints : []).map((checkpoint, index, items) => ({
        ...checkpoint,
        name: buildPublicCheckpointName({
          label: checkpoint.name,
          index,
          totalCount: items.length,
          lat: checkpoint.lat,
          lng: checkpoint.lng,
          type: checkpoint.type,
          points: items,
          fallbackLabel: checkpoint.name,
        }),
      }));

      const registrationCounts = registrationCountByCategoryId.get(category.id);

      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        coverImageUrl: publicImageUrl(category.cover_image_url),
        sportCode: (category.sport_code as SportCode | null) ?? DEFAULT_SPORT_CODE,
        distance: formatDistanceLabel(category.distance_km),
        elevation: formatElevationLabel(category.elevation_gain_m),
        participants: registrationCounts?.registeredCount ?? 0,
        confirmedParticipants: registrationCounts?.confirmedCount ?? 0,
        pendingParticipants: Math.max(
          (registrationCounts?.registeredCount ?? 0) - (registrationCounts?.confirmedCount ?? 0),
          0,
        ),
        maxParticipants: category.capacity ?? categoryFallback?.maxParticipants ?? 0,
        price: formatMoney(category.registration_fee_periods?.length ? raceFeeAt(category.registration_fee_cents, category.registration_fee_periods) : category.registration_fee_cents, category.currency),
        feePeriods: category.registration_fee_periods ?? [],
        feeCurrency: category.currency ?? "EUR",
        registrationFeeCents: raceFeeAt(category.registration_fee_cents, category.registration_fee_periods),
        cutoff: categoryFallback?.cutoff ?? "TBA",
        startLabel: category.start_at ? format(new Date(category.start_at), "HH:mm") : null,
        startAtIso: category.start_at ?? null,
        minimumAge: numberFromUnknown(category.minimum_age),
        maximumAge: numberFromUnknown(category.maximum_age),
        allowedGenders: Array.isArray(category.allowed_genders)
          ? category.allowed_genders.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : [],
        eligibilityNote: typeof category.eligibility_note === "string" && category.eligibility_note.trim()
          ? category.eligibility_note.trim()
          : null,
        statusLabel: formatRaceStatus(category.status, publicEventStatusLabel),
        linkedTrackSlug: linkedTrack?.slug ?? (hasExactFallback ? fallback.linkedTrackSlug : null),
        linkedTrackName: linkedTrack?.name ?? (hasExactFallback ? fallback.linkedTrackName : null),
        organizerNotes: null,
        checkpoints: publicCategoryCheckpoints,
        raceCheckpoints: [],
        trackPoints: hasExactFallback ? fallback.trackPoints : [],
        elevationPoints: [],
      };
    });

    const primaryCategoryPreview = dynamicCategories.find((category) => category.id === primaryCategory?.id) ?? dynamicCategories[0] ?? null;
    const checkpoints = primaryCategoryPreview?.checkpoints?.length
      ? primaryCategoryPreview.checkpoints
      : fallback.checkpoints;
    const publicCheckpoints = checkpoints.map((checkpoint, index, items) => ({
      ...checkpoint,
      name: buildPublicCheckpointName({
        label: checkpoint.name,
        index,
        totalCount: items.length,
        lat: checkpoint.lat,
        lng: checkpoint.lng,
        type: checkpoint.type,
        points: items,
        fallbackLabel: checkpoint.name,
      }),
    }));
    const trackPoints = primaryCategoryPreview?.trackPoints?.length
      ? primaryCategoryPreview.trackPoints
      : fallback.trackPoints;
    const linkedTrackSlug = primaryCategoryPreview?.linkedTrackSlug ?? fallback.linkedTrackSlug;
    const linkedTrackName = primaryCategoryPreview?.linkedTrackName ?? fallback.linkedTrackName;
    const distanceSummary =
      dynamicCategories.length > 0
        ? `${dynamicCategories.map((category) => category.distance.replace(" km", "")).join(" / ")} km`
        : fallback.distanceSummary;
    const eventSportSelection = normalizeSportSelection({
      sportCodes: (eventSportRows ?? []).map((row) => row.sport_code),
      primarySportCode: (eventSportRows ?? []).find((row) => row.is_primary)?.sport_code,
    });

    return {
      ...fallback,
      editionId: edition.id,
      slug: edition.slug,
      name: edition.name,
      activityType: normalizeEventActivityType(edition.activity_type),
      sportCodes: eventSportSelection.sportCodes,
      primarySportCode: eventSportSelection.primarySportCode,
      subtitle: typeof series?.description === "string" && series.description.trim().length
        ? series.description.trim()
        : (hasExactFallback ? fallback.subtitle : ""),
      statusLabel: publicEventStatusLabel,
      registrationOpenAt: edition.registration_open_at ?? null,
      registrationCloseAt: edition.registration_close_at ?? null,
      dateLabel: formatEventDateLabel(edition.start_date, edition.end_date),
      timezone: edition.timezone?.trim() || fallback.timezone,
      startDateIso: edition.start_date ?? null,
      endDateIso: edition.end_date ?? null,
      locationLabel: resolvePublicLocationLabel(selectEventPublicLocationLabel({
        editionLocationLabel: edition.location_name,
        seriesLocationLabel: series?.location_name,
        locations: mappedLocations,
      }) ?? fallback.locationLabel, {
        points: publicCheckpoints,
        fallbackLabel: fallback.locationLabel,
      }),
      countryCode: series?.country_code?.trim().toUpperCase() || fallback.countryCode,
      registeredCount: dynamicCategories.reduce((sum, category) => sum + category.participants, 0),
      distanceSummary,
      organizerName: publicOrganization.name ?? fallback.organizerName,
      organizerLogoImageUrl: publicOrganization.logoImageUrl,
      organizerLocationLabel: publicOrganization.locationLabel,
      organizerDescription: publicOrganization.description,
      organizerContactEmail: publicOrganization.contactEmail,
      organizerContactPhone: publicOrganization.contactPhone,
      organizerWebsiteUrl: publicOrganization.websiteUrl,
      organizer: publicOrganization,
      about: typeof edition.about_text === "string" && edition.about_text.trim()
        ? edition.about_text.trim()
        : (hasExactFallback ? fallback.about : ""),
      organizerRules: typeof edition.organizer_rules === "string" && edition.organizer_rules.trim()
        ? edition.organizer_rules.trim()
        : null,
      coverImageUrl: publicImageUrl(edition.cover_image_url),
      websiteUrl: typeof edition.website_url === "string" && edition.website_url.trim() ? edition.website_url.trim() : null,
      instagramUrl: typeof edition.instagram_url === "string" && edition.instagram_url.trim() ? edition.instagram_url.trim() : null,
      facebookUrl: typeof edition.facebook_url === "string" && edition.facebook_url.trim() ? edition.facebook_url.trim() : null,
      locations: mappedLocations,
      timeline: normalizeEventTimeline(edition.general_timeline_json),
      categories: dynamicCategories.length ? dynamicCategories : fallback.categories,
      informativeLabels,
      leagueMemberships: leagueMembershipsByEdition.get(edition.id),
      checkpoints: publicCheckpoints,
      trackPoints,
      documents:
        documents?.map((document) => ({
          title: document.title,
          documentType: document.document_type,
          storagePath: document.storage_path,
        })) ?? fallback.documents,
      previousEditions:
        previousEditions?.map((item) => ({
          slug: item.slug,
          label: item.name ?? `Edition ${item.start_date}`,
        })) ?? fallback.previousEditions,
      linkedTrackSlug,
      linkedTrackName,
      infoItems: mergeInfoItems([
        ["Organizer", publicOrganization.name ?? fallback.organizerName],
        ["Edition", fallback.infoItems[1][1]],
        ["Categories", String(raceCategories.length || fallback.categories.length)],
        ["Total slots", String(raceCategories.reduce((sum, item) => sum + (item.capacity ?? 0), 0) || 650)],
        ["Region", publicOrganization.locationLabel ?? fallback.infoItems[4][1]],
        ["Status", publicEventStatusLabel],
      ] satisfies PortalInfoItem[], fallback.infoItems),
    };
  } catch (error) {
    if (!(error instanceof PublicEventNotFoundError)) {
      console.warn("Unable to load public race detail", error);
    }
    throw error instanceof Error ? error : new Error("Unable to load race detail");
  }
}

export type PublicEventGeometryCategory = {
  eventCategoryId: string;
  checkpoints: PortalCheckpoint[];
  raceCheckpoints: PortalRaceCheckpoint[];
  trackPoints: [number, number][];
  elevationPoints: PortalElevPoint[];
};

export async function getPublicEventGeometry(
  eventEditionId: string,
): Promise<PublicEventGeometryCategory[]> {
  const supabase = getSupabaseBrowserClient() ?? getSupabasePublicClient();
  if (!supabase || !eventEditionId) return [];

  const rows = await loadPublicEventGeometryBundle(supabase, eventEditionId);
  return rows.map((row) => {
    const trackPoints = Array.isArray(row.polyline_json)
      ? row.polyline_json.map(mapPolylinePoint).filter(Boolean) as [number, number][]
      : [];
    const elevationPoints = Array.isArray(row.elevation_profile_json)
      ? row.elevation_profile_json
          .map((point, index) => mapElevationPoint(point, index, trackPoints))
          .filter(Boolean) as PortalElevPoint[]
      : [];
    const renderCheckpoints = mapRenderCheckpoints(row.checkpoints_json, []);
    const checkpointRows = row.checkpoint_rows as Array<{
      id?: string | null;
      code?: string | null;
      name: string | null;
      distance_from_start_km: number | string | null;
      sequence_number?: number | string | null;
      checkpoint_type: string | null;
      cutoff_at: string | null;
      is_mandatory: boolean | null;
      settings_json: unknown;
    }>;

    return {
      eventCategoryId: row.event_category_id,
      checkpoints: checkpointRows.length
        ? mapCategoryCheckpointRows(
            checkpointRows,
            renderCheckpoints,
            trackPoints,
            elevationPoints,
          )
        : renderCheckpoints,
      raceCheckpoints: checkpointRows.length
        ? mapPublicRaceCheckpoints(
            checkpointRows,
            renderCheckpoints,
            trackPoints,
            elevationPoints,
          )
        : [],
      trackPoints,
      elevationPoints,
    } satisfies PublicEventGeometryCategory;
  });
}

export async function getEventCommunity(eventEditionId: string): Promise<PortalEventCommunity> {
  const supabase = getSupabasePublicClient();
  if (!supabase || !eventEditionId) {
    return { reviews: [], reviewCount: 0, commentCount: 0, averageRating: null };
  }

  const { data: reviews, error } = await supabase
    .from("event_reviews")
    .select("id,athlete_profile_id,rating,title,body,created_at")
    .eq("event_edition_id", eventEditionId)
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const reviewIds = (reviews ?? []).map((review) => review.id);
  const { data: comments, error: commentsError } = reviewIds.length
    ? await supabase
        .from("event_review_comments")
        .select("id,event_review_id,athlete_profile_id,body,created_at")
        .in("event_review_id", reviewIds)
        .eq("is_public", true)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: [], error: null };
  if (commentsError) throw commentsError;

  const athleteIds = Array.from(new Set([
    ...(reviews ?? []).map((review) => review.athlete_profile_id),
    ...(comments ?? []).map((comment) => comment.athlete_profile_id),
  ]));
  const athleteNames = new Map<string, string>();
  if (athleteIds.length) {
    const { data: athletes, error: athletesError } = await supabase
      .from("public_athlete_profiles")
      .select("id,display_name")
      .in("id", athleteIds);
    if (athletesError) throw athletesError;
    for (const athlete of athletes ?? []) athleteNames.set(athlete.id, athlete.display_name);
  }

  const mappedReviews = (reviews ?? []).map((review): PortalEventReview => ({
    id: review.id,
    name: athleteNames.get(review.athlete_profile_id) ?? "Trail Runner",
    rating: review.rating,
    title: review.title?.trim() || null,
    text: review.body,
    date: review.created_at ? format(new Date(review.created_at), "MMM d, yyyy") : "Recent",
    comments: (comments ?? [])
      .filter((comment) => comment.event_review_id === review.id)
      .map((comment) => ({
        id: comment.id,
        reviewId: comment.event_review_id,
        authorAthleteProfileId: comment.athlete_profile_id,
        authorName: athleteNames.get(comment.athlete_profile_id) ?? "Trail Runner",
        body: comment.body,
        createdAt: comment.created_at,
      })),
  }));
  const reviewCount = mappedReviews.length;
  return {
    reviews: mappedReviews,
    reviewCount,
    commentCount: mappedReviews.reduce((total, review) => total + review.comments.length, 0),
    averageRating: reviewCount
      ? mappedReviews.reduce((total, review) => total + review.rating, 0) / reviewCount
      : null,
  };
}

export async function getTrackDetail(
  slug: string,
  options?: { trackVersionId?: string | null; includeDraftVersions?: boolean },
): Promise<TrackDetailData> {
  const fallback = buildEmptyTrackDetail(slug);
  const hasFallback = Object.prototype.hasOwnProperty.call(fallbackTrackDetails, slug);
  const supabase = getSupabasePublicClient();
  if (!supabase) {
    if (hasFallback) return fallback;
    throw new Error("Public route service is unavailable");
  }

  try {
    const { data: template, error: templateError } = await supabase
      .from("track_templates")
      .select(
        "id,organization_id,slug,name,sport_code,terrain_type,notes,public_overview,location_label,season_label,parking_label,weather_location_label,best_time_label,gallery_items_json",
      )
      .eq("slug", slug)
      .maybeSingle();

    if (!template && !templateError && hasFallback) {
      return fallback;
    }

    if (templateError) throw templateError;
    if (!template) throw new PublicTrackNotFoundError(slug);

    const versionSelect =
      "id,distance_km,elevation_gain_m,elevation_loss_m,difficulty_level,surface_summary,safety_notes,water_point_count,segment_definitions_json";

    const versionPromise = (async () => {
      if (options?.trackVersionId) {
        const { data } = await supabase
          .from("track_versions")
          .select(versionSelect)
          .eq("id", options.trackVersionId)
          .eq("track_template_id", template.id)
          .single();
        return data;
      }

      if (options?.includeDraftVersions ?? false) {
        const { data: latestAnyVersion } = await supabase
          .from("track_versions")
          .select(versionSelect)
          .eq("track_template_id", template.id)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestAnyVersion) return latestAnyVersion;
      }

      const { data: latestPublishedVersion } = await supabase
        .from("track_versions")
        .select(versionSelect)
        .eq("track_template_id", template.id)
        .not("published_at", "is", null)
        .order("version_number", { ascending: false })
        .limit(1)
        .single();

      return latestPublishedVersion;
    })();

    const [
      version,
      { data: snapshots },
      { data: attemptsCount, count: verifiedAttemptCount },
      { data: attempts },
      { data: reviews },
      { data: reviewRatings },
      { data: conditions },
      { data: organizationData },
    ] = await Promise.all([
      versionPromise,
      supabase
        .from("event_category_track_snapshots")
        .select("event_category_id,track_version_id,created_at")
        .eq("track_template_id", template.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("track_attempts")
        .select("id", { count: "exact" })
        .eq("track_template_id", template.id)
        .eq("verification_status", "verified"),
      supabase
        .from("track_attempts")
        .select("id,athlete_profile_id,elapsed_time_ms,started_at,strava_url,verification_status")
        .eq("track_template_id", template.id)
        .eq("verification_status", "verified")
        .order("elapsed_time_ms", { ascending: true })
        .limit(100),
      supabase
        .from("track_reviews")
        .select("id,athlete_profile_id,rating,title,body,created_at,helpful_count,not_helpful_count")
        .eq("track_template_id", template.id)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("track_reviews")
        .select("rating")
        .eq("track_template_id", template.id),
      supabase
        .from("track_condition_reports")
        .select("athlete_profile_id,status,title,note,reported_at")
        .eq("track_template_id", template.id)
        .order("reported_at", { ascending: false })
        .limit(6),
      template.organization_id
        ? supabase
            .from("public_organization_profiles")
            .select("name,country_code,region,city,description,website_url,instagram_url,facebook_url,linkedin_url,youtube_url,tiktok_url,x_url,contact_email,contact_phone,logo_image_url,profile_visibility,contact_details_visibility")
            .eq("id", template.organization_id)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const publicOrganization = mapPublicOrganizationProfile(organizationData);

    const relevantSnapshots = selectTrackRaceRecordSnapshots(
      (snapshots ?? []) as TrackSnapshotRecordLink[],
      options?.trackVersionId ? version?.id : null,
    );
    let publishedRaceRecords = emptyPublishedTrackRaceRecords;
    try {
      publishedRaceRecords = await loadPublishedTrackRaceRecords(supabase, relevantSnapshots);
    } catch (error) {
      console.warn("Unable to load published race results for route records", error);
    }

    const reviewIds = (reviews ?? []).map((review) => review.id);
    const currentAccount = reviewIds.length ? await resolveCurrentUserAccountContext() : null;
    const [{ data: reviewComments }, { data: viewerReactions }] = await Promise.all([
      reviewIds.length
        ? supabase.from("track_review_comments")
            .select("id,track_review_id,athlete_profile_id,body,created_at")
            .in("track_review_id", reviewIds).order("created_at", { ascending: true }).limit(100)
        : Promise.resolve({ data: [] }),
      reviewIds.length && currentAccount?.primaryAthleteProfileId
        ? supabase.from("track_review_reactions").select("track_review_id,reaction")
            .in("track_review_id", reviewIds).eq("athlete_profile_id", currentAccount.primaryAthleteProfileId)
        : Promise.resolve({ data: [] }),
    ]);

    const athleteIds = Array.from(
      new Set(
        [...(attempts ?? []), ...(reviews ?? []), ...(conditions ?? []), ...(reviewComments ?? [])]
          .map((item) => item.athlete_profile_id)
          .filter(Boolean),
      ),
    );

    const athleteMap = new Map<string, { name: string; slug: string | null; gender: "F" | "M" | null }>();
    if (athleteIds.length) {
      const { data: athletes } = await supabase
        .from("public_athlete_profiles")
        .select("id,slug,display_name,gender")
        .in("id", athleteIds);

      for (const athlete of athletes ?? []) {
        athleteMap.set(athlete.id, {
          name: athlete.display_name,
          slug: athlete.slug || null,
          gender: normalizeTrackAttemptGender(athlete.gender),
        });
      }
    }

    let trackPoints = fallback.trackPoints;
    let checkpoints = fallback.checkpoints;
    let elevationPoints = fallback.elevationPoints;
    let segments = fallback.segments;
    const gallery = normalizeTrackGalleryItems(template.gallery_items_json);
    let linkedEvent: string | null = Object.prototype.hasOwnProperty.call(fallbackTrackDetails, slug)
      ? fallback.linkedEvent
      : null;
    let linkedEventId: string | null = Object.prototype.hasOwnProperty.call(fallbackTrackDetails, slug)
      ? fallback.linkedEventId
      : null;
    let linkedEventImageUrl: string | null = Object.prototype.hasOwnProperty.call(fallbackTrackDetails, slug)
      ? fallback.linkedEventImageUrl
      : null;
    let linkedEventDateLabel: string | null = Object.prototype.hasOwnProperty.call(fallbackTrackDetails, slug)
      ? fallback.linkedEventDateLabel
      : null;
    let linkedEventStatus: string | null = Object.prototype.hasOwnProperty.call(fallbackTrackDetails, slug)
      ? fallback.linkedEventStatus
      : null;

    if (version?.id) {
      const { data: renderCache } = await supabase
        .from("track_render_cache")
        .select("polyline_json,elevation_profile_json,checkpoints_json")
        .eq("track_version_id", version.id)
        .single();

      const mappedTrackPoints = Array.isArray(renderCache?.polyline_json)
        ? renderCache.polyline_json.map(mapPolylinePoint).filter(Boolean) as [number, number][]
        : [];

      const mappedCheckpoints = Array.isArray(renderCache?.checkpoints_json)
        ? renderCache.checkpoints_json
            .map((checkpoint, index) => {
              if (!checkpoint || typeof checkpoint !== "object") return null;
              const record = checkpoint as Record<string, unknown>;
              const fallbackCheckpoint = fallback.checkpoints[index];
              const km = Number(record.km ?? fallbackCheckpoint?.km ?? NaN);
              const elev = Number(record.elev ?? fallbackCheckpoint?.elev ?? NaN);
              const lat = Number(record.lat ?? fallbackCheckpoint?.lat ?? NaN);
              const lng = Number(record.lng ?? fallbackCheckpoint?.lng ?? NaN);
              if (!Number.isFinite(km) || !Number.isFinite(elev) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                return null;
              }
              return {
                name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : fallbackCheckpoint?.name ?? "Checkpoint",
                km,
                elev,
                lat,
                lng,
                type: typeof record.type === "string" ? record.type : undefined,
              };
            })
            .filter(Boolean) as PortalCheckpoint[]
        : undefined;

      const mappedElevationPoints = Array.isArray(renderCache?.elevation_profile_json)
        ? renderCache.elevation_profile_json
            .map((point, index) => mapElevationPoint(point, index, mappedTrackPoints.length ? mappedTrackPoints : fallback.trackPoints))
            .filter(Boolean) as PortalElevPoint[]
        : [];

      if (mappedTrackPoints.length) trackPoints = mappedTrackPoints;
      if (mappedCheckpoints?.length) checkpoints = mappedCheckpoints;
      if (mappedElevationPoints.length) elevationPoints = mappedElevationPoints;
      const mappedSegments = normalizeTrackSegments(version.segment_definitions_json);
      if (mappedSegments.length) segments = mappedSegments;
    }

    if (publishedRaceRecords.primaryEvent) {
      linkedEvent = publishedRaceRecords.primaryEvent.name;
      linkedEventId = publishedRaceRecords.primaryEvent.slug;
      linkedEventImageUrl = publishedRaceRecords.primaryEvent.coverImageUrl;
      linkedEventDateLabel = publishedRaceRecords.primaryEvent.startDate
        ? format(new Date(`${publishedRaceRecords.primaryEvent.startDate}T00:00:00`), "MMM d, yyyy")
        : null;
      linkedEventStatus = publishedRaceRecords.primaryEvent.status;
    }

    const publicCheckpoints = checkpoints.map((checkpoint, index, items) => ({
      ...checkpoint,
      name: buildPublicCheckpointName({
        label: checkpoint.name,
        index,
        totalCount: items.length,
        lat: checkpoint.lat,
        lng: checkpoint.lng,
        type: checkpoint.type,
        points: items,
        fallbackLabel: checkpoint.name,
      }),
    }));

    const submittedAttemptCandidates = (attempts ?? []).flatMap((attempt) => {
      const elapsedTimeMs = attempt.elapsed_time_ms == null ? null : Number(attempt.elapsed_time_ms);
      if (elapsedTimeMs == null || !Number.isFinite(elapsedTimeMs) || elapsedTimeMs <= 0) return [];
      const athlete = athleteMap.get(attempt.athlete_profile_id);
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
        gender: athlete?.gender ?? null,
        sourceKind,
        sourceLabel: stravaUrl ? "Strava" : "Verified attempt",
        sourceHref: stravaUrl,
      }];
    });
    const mappedLeaderboard = mergeTrackRecordCandidates([
      ...publishedRaceRecords.candidates,
      ...submittedAttemptCandidates,
    ]).map((record, index): PortalTrackAttempt => ({
      id: record.id,
      rank: index + 1,
      name: record.name,
      athleteSlug: record.athleteSlug,
      elapsedTimeMs: record.elapsedTimeMs,
      time: formatTrackRecordDuration(record.elapsedTimeMs),
      date: formatTrackRecordDate(record.occurredAt),
      verified: true,
      strava: record.sourceKind === "strava" ? record.sourceHref : null,
      gender: record.gender,
      sourceKind: record.sourceKind,
      sourceLabel: record.sourceLabel,
      sourceHref: record.sourceHref,
    }));

    const mappedReviews = (reviews ?? []).map((review) => {
      const parsedReview = parseTrackReviewBody(review.body);
      const comments = (reviewComments ?? []).filter((comment) => comment.track_review_id === review.id).map((comment) => ({
        id: comment.id,
        reviewId: comment.track_review_id,
        authorAthleteProfileId: comment.athlete_profile_id,
        authorName: athleteMap.get(comment.athlete_profile_id)?.name ?? "Trail Runner",
        body: comment.body,
        createdAt: comment.created_at,
      }));
      const viewerReaction = (viewerReactions ?? []).find((reaction) => reaction.track_review_id === review.id)?.reaction;

      return {
        id: review.id,
        name: athleteMap.get(review.athlete_profile_id)?.name ?? "Trail Runner",
        title: typeof review.title === "string" && review.title.trim().length ? review.title.trim() : null,
        rating: review.rating,
        text: parsedReview.body,
        date: review.created_at ? format(new Date(review.created_at), "MMM yyyy") : "Recent",
        difficulty: parsedReview.metadata?.difficulty ?? null,
        terrainLabels: parsedReview.metadata?.terrainLabels ?? [],
        navigationQuality: parsedReview.metadata?.navigationQuality ?? null,
        bestForTags: parsedReview.metadata?.bestForTags ?? [],
        helpfulCount: Math.max(0, review.helpful_count ?? 0),
        notHelpfulCount: Math.max(0, review.not_helpful_count ?? 0),
        viewerReaction: viewerReaction === 1 ? "helpful" as const : viewerReaction === -1 ? "not_helpful" as const : null,
        comments,
      };
    });

    const mappedConditions = (conditions ?? []).map((condition) => {
      const parsedNote = parseTrackConditionReportNote(condition.note);

      return {
        label: condition.title || "Recent trail report",
        status: condition.status,
        note: parsedNote.note,
        reporter: athleteMap.get(condition.athlete_profile_id)?.name ?? "Trail Runner",
        date: condition.reported_at
          ? formatDistanceToNowStrict(new Date(condition.reported_at), { addSuffix: true })
          : "recently",
        cautionType: parsedNote.metadata?.cautionType,
        markerLat: typeof parsedNote.metadata?.lat === "number" ? parsedNote.metadata.lat : undefined,
        markerLng: typeof parsedNote.metadata?.lng === "number" ? parsedNote.metadata.lng : undefined,
        markerDistKm: typeof parsedNote.metadata?.distKm === "number" ? parsedNote.metadata.distKm : undefined,
        markerElev: typeof parsedNote.metadata?.elev === "number" ? parsedNote.metadata.elev : undefined,
      };
    });

    const reviewAverage =
      (reviewRatings?.length ?? 0) > 0
        ? (reviewRatings ?? []).reduce((sum, review) => sum + review.rating, 0) / Math.max(reviewRatings?.length ?? 0, 1)
        : 0;
    const difficultyLevel = resolveTrackDifficultyLevel(
      version?.difficulty_level,
      version?.distance_km ?? fallback.distance,
      version?.elevation_gain_m ?? fallback.elevation,
    );

    return {
      ...fallback,
      slug: template.slug,
      name: template.name,
      sportCode: (template.sport_code as SportCode | null) ?? DEFAULT_SPORT_CODE,
      location: resolvePublicLocationLabel(template.location_label ?? fallback.location, {
        points: publicCheckpoints,
        fallbackLabel: fallback.location,
      }),
      overview: template.public_overview ?? fallback.overview,
      distance: version?.distance_km ?? fallback.distance,
      elevation: version?.elevation_gain_m ?? fallback.elevation,
      difficulty: getTrackDifficultyLabel(difficultyLevel),
      difficultyLevel,
      surface: version?.surface_summary ?? template.terrain_type ?? fallback.surface,
      rating: Number(reviewAverage.toFixed(1)),
      totalRatings: reviewRatings?.length ?? 0,
      attempts: Math.max(
        mappedLeaderboard.length,
        publishedRaceRecords.startCount + (verifiedAttemptCount ?? attemptsCount?.length ?? 0),
      ),
      season: template.season_label ?? "",
      waterPoints: Math.max(0, version?.water_point_count ?? fallback.waterPoints),
      parking: template.parking_label ?? "",
      bestTime: template.best_time_label ?? "",
      warnings: version?.safety_notes ?? template.notes ?? fallback.warnings,
      weatherLocation: resolvePublicLocationLabel(
        template.weather_location_label ?? template.location_label ?? fallback.weatherLocation,
        {
          points: publicCheckpoints,
          fallbackLabel: fallback.weatherLocation,
        },
      ),
      linkedEvent,
      linkedEventId,
      linkedEventImageUrl,
      linkedEventDateLabel,
      linkedEventStatus,
      organizer: publicOrganization,
      checkpoints: publicCheckpoints,
      trackPoints,
      elevationPoints,
      segments,
      gallery,
      gpxDownloadUrl: version?.id ? resolveApiUrl(`/v1/tracks/${template.slug}/gpx`) : fallback.gpxDownloadUrl,
      gpxFileName: version?.id ? `${template.slug}.gpx` : fallback.gpxFileName,
      leaderboard: mappedLeaderboard.length ? mappedLeaderboard : fallback.leaderboard,
      reviews: mappedReviews,
      conditions: mappedConditions.length ? mappedConditions : fallback.conditions,
      badges: buildTrackSetupBadgeShowcase({
        distanceKm: version?.distance_km ?? fallback.distance,
        elevationGainM: version?.elevation_gain_m ?? fallback.elevation,
        segmentCount: segments.length,
        waterPointCount: Math.max(0, version?.water_point_count ?? fallback.waterPoints),
      }),
    };
  } catch (error) {
    if (!(error instanceof PublicTrackNotFoundError)) {
      console.warn("Unable to load public route detail", error);
    }
    throw error instanceof Error ? error : new Error("Unable to load route detail");
  }
}

export async function submitTrackConditionReport(input: SubmitTrackConditionReportInput) {
  return apiRequest({
    path: `/v1/tracks/${encodeURIComponent(input.trackSlug)}/condition-reports`,
    method: "POST",
    body: {
      status: input.status,
      title: input.title.trim() || null,
      note: input.note,
      cautionType: input.cautionType,
      lat: input.lat,
      lng: input.lng,
      distKm: input.distKm,
      elev: input.elev,
    },
  });
}

export async function submitTrackReview(input: SubmitTrackReviewInput) {
  const reviewBody = input.text.trim();
  if (!reviewBody) {
    throw new Error("Write a short review before publishing it.");
  }

  if (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error("Choose a rating between 1 and 5 stars.");
  }

  return apiRequest({
    path: `/v1/tracks/${encodeURIComponent(input.trackSlug)}/reviews`,
    method: "POST",
    body: {
      rating: Math.round(input.rating),
      text: reviewBody,
      difficulty: input.difficulty?.trim() || null,
      terrainLabels: normalizeTrackReviewSelections(input.terrainLabels),
      navigationQuality: input.navigationQuality?.trim() || null,
      bestForTags: normalizeTrackReviewSelections(input.bestForTags),
    },
  });
}

export async function submitEventReview(input: { eventSlug: string; rating: number; text: string }) {
  const reviewBody = input.text.trim();
  if (reviewBody.length < 2) throw new Error("Write a short race review before publishing it.");
  if (!Number.isFinite(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new Error("Choose a rating between 1 and 5 stars.");
  }
  return apiRequest({
    path: `/v1/events/${encodeURIComponent(input.eventSlug)}/reviews`,
    method: "POST",
    body: { rating: Math.round(input.rating), text: reviewBody },
  });
}

export async function addEventReviewComment(reviewId: string, body: string) {
  return apiRequest<PortalEventReviewComment>({
    path: `/v1/event-reviews/${encodeURIComponent(reviewId)}/comments`,
    method: "POST",
    body: { body },
  });
}

export async function removeOwnEventReviewComment(commentId: string) {
  return apiRequest<{ commentId: string; removed: true }>({
    path: `/v1/event-review-comments/${encodeURIComponent(commentId)}/remove`,
    method: "POST",
  });
}

export async function setTrackReviewReaction(reviewId: string, reaction: "helpful" | "not_helpful" | null) {
  return apiRequest<{
    reviewId: string;
    reaction: "helpful" | "not_helpful" | null;
    helpfulCount: number;
    notHelpfulCount: number;
  }>({ path: `/v1/track-reviews/${encodeURIComponent(reviewId)}/reaction`, method: "POST", body: { reaction } });
}

export async function addTrackReviewComment(reviewId: string, body: string) {
  return apiRequest<PortalTrackReviewComment>({
    path: `/v1/track-reviews/${encodeURIComponent(reviewId)}/comments`,
    method: "POST",
    body: { body },
  });
}

export async function removeOwnTrackReviewComment(commentId: string) {
  return apiRequest<{ commentId: string; removed: true }>({
    path: `/v1/track-review-comments/${encodeURIComponent(commentId)}/remove`,
    method: "POST",
  });
}

export async function getAthleteFavorites(): Promise<AthleteFavoritesData> {
  return apiRequest<AthleteFavoritesData>({ path: "/v1/me/favorites" });
}

export async function removeFavoriteEvent(eventSlug: string) {
  return apiRequest<{ eventEditionId: string; removed: boolean }>({
    path: `/v1/me/favorites/events/${encodeURIComponent(eventSlug)}/remove`,
    method: "POST",
  });
}

export async function getAthleteTrainingLog(): Promise<AthleteTrainingData> {
  const supabase = getSupabaseBrowserClient();
  const account = await resolveCurrentUserAccountContext();
  if (!supabase || !account?.primaryAthleteProfileId) {
    return emptyAthleteTrainingData;
  }

  try {
    const { data: activities, error } = await supabase
      .from("athlete_activities")
      .select("id,track_template_id,title,description,performed_at,distance_km,elevation_gain_m,moving_time_seconds,summary_json")
      .eq("athlete_profile_id", account.primaryAthleteProfileId)
      .order("performed_at", { ascending: false })
      .limit(24);

    if (error) {
      throw error;
    }

    const recordedActivities = (activities ?? []).filter(
      (activity) => !legacyGhostAthleteActivityIds.has(activity.id),
    );

    if (!recordedActivities.length) {
      return emptyAthleteTrainingData;
    }

    const trackIds = Array.from(
      new Set(recordedActivities.map((activity) => activity.track_template_id).filter(Boolean)),
    );
    const { data: tracks } = trackIds.length
      ? await supabase
          .from("track_templates")
          .select("id,name")
          .in("id", trackIds)
      : { data: [] };
    const trackById = new Map((tracks ?? []).map((track) => [track.id, track.name]));

    const weeklyBuckets = new Map<string, { km: number; elev: number }>();
    for (const activity of recordedActivities) {
      const performedAt = new Date(activity.performed_at);
      const weekLabel = format(performedAt, "MMM d");
      const current = weeklyBuckets.get(weekLabel) ?? { km: 0, elev: 0 };
      current.km += Number(activity.distance_km ?? 0);
      current.elev += Number(activity.elevation_gain_m ?? 0);
      weeklyBuckets.set(weekLabel, current);
    }

    const recentSessions = recordedActivities.slice(0, 6).map((activity) => ({
      id: activity.id,
      title: activity.title,
      date: format(new Date(activity.performed_at), "MMM d, yyyy"),
      location: activity.track_template_id ? trackById.get(activity.track_template_id) ?? "Trail Route" : "Local Route",
      distance: Number(activity.distance_km ?? 0),
      elevation: Number(activity.elevation_gain_m ?? 0),
      duration: formatDurationLabel(activity.moving_time_seconds),
      effort:
        Number(activity.distance_km ?? 0) >= 25
          ? "Long"
          : Number(activity.elevation_gain_m ?? 0) >= 800
          ? "Climbing"
          : "Tempo",
      note: activity.description ?? "Structured training session.",
      tags: Array.isArray(activity.summary_json?.tags)
        ? activity.summary_json.tags.filter((tag): tag is string => typeof tag === "string")
        : ["training"],
    }));

    const focusTracks = recordedActivities
      .filter((activity) => activity.track_template_id)
      .slice(0, 3)
      .map((activity) => ({
        name: trackById.get(activity.track_template_id!) ?? "Linked Route",
        target: activity.description ?? "Linked from your recent training block.",
        distance: `${Number(activity.distance_km ?? 0).toFixed(1)} km`,
        elevation: `${Number(activity.elevation_gain_m ?? 0)}m D+`,
        tags: Array.isArray(activity.summary_json?.tags)
          ? activity.summary_json.tags.filter((tag): tag is string => typeof tag === "string")
          : ["training"],
      }));

    return {
      weeklyLoad: Array.from(weeklyBuckets.entries())
        .slice(0, 6)
        .reverse()
        .map(([week, totals]) => ({
          week,
          km: Math.round(totals.km),
          elev: Math.round(totals.elev),
        })),
      recentSessions,
      focusTracks,
      milestones: [
        { label: `${recentSessions.length} sessions logged`, tier: "default" },
        { label: `${Math.round(recentSessions.reduce((sum, session) => sum + session.distance, 0))}km recent volume`, tier: "bronze" },
        { label: `${Math.round(recentSessions.reduce((sum, session) => sum + session.elevation, 0)).toLocaleString()}m climbed`, tier: "gold" },
      ],
    };
  } catch (error) {
    console.warn("Unable to load athlete training log", error);
    return emptyAthleteTrainingData;
  }
}

export type PortalRaceCategory = PortalEventCategory;
export type PortalRaceDocument = PortalEventDocument;
export type PortalRaceLocation = PortalEventLocation;
export type PortalRaceTimelineItem = PortalEventTimelineItem;
export type RaceDetailData = EventDetailData;
export type AthleteFavoriteRace = AthleteFavoriteEvent;

export const getRaceDetail = getEventDetail;
export const getFallbackRaceDetail = getFallbackEventDetail;
