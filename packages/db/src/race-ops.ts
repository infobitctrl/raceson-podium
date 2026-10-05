import { statusFromRegistration } from "./registrations/athlete-registration-status.js";
import { storedEventSlug } from "@raceson/domain";
import { loadRegistrationFeeBalances } from "./registrations/fee-balances.js";
import { validateRaceFeePeriods, type RaceFeePeriod } from "@raceson/domain/categories";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import {
  DEFAULT_EVENT_ACTIVITY_TYPE,
  normalizeEventActivityType,
  type EventActivityType,
} from "@raceson/domain/activities";
import { PORTAL_DEFAULT_COMPETITION_CATEGORY_POLICY } from "@raceson/domain/categories";
import {
  deriveLeagueRoundStatus,
  getLeagueCourseCoverageIssue,
  getLeagueRaceRankingCompatibilityIssue,
  normalizeLeagueClubScoringScope,
  type LeagueClubScoringScope,
} from "@raceson/domain/leagues";
import {
  DEFAULT_SPORT_CODE,
  normalizeSportSelection,
  type SportCode,
} from "@raceson/domain/sports";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { readEventEmailSetupStatus } from "./event-communications.js";
import {
  hasEventPermission,
  hasOrganizationPermission,
  requireAthleteProfileId,
  requireCategoryAccess,
  requireCheckpointAccess,
  requireEditionAccess,
  requireOrganizationAccess,
  requireRegistrationAccess,
  requireTimingSessionAccess,
  resolveRegistrationContext,
} from "./permissions.js";
import { ensureDefaultRegistrationConfiguration } from "./registration-forms.js";
import { reorderOrganizerLeagueRoundsChronologically } from "./features/league-round-ordering.js";
import { requireLiveRaceOperations } from "./features/live-race-operations.js";
import { withRaceFinishEvidence } from "./features/race-finish-read-model.js";
import {
  loadImportedResultSnapshot,
  selectResultSnapshotRun,
  type ResultRunSnapshotRow,
} from "./features/result-snapshot-policy.js";
import {
  derivePublishedEventStatus,
  resolveOrganizerEventUpdateStatus,
} from "./public-races.js";
import { createAdminSupabaseClient } from "./supabase.js";
import { parseTrackGpxSource } from "./track-gpx.js";

const POSTGRES_UUID_REFERENCE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPostgresUuidReference(value: string) {
  return POSTGRES_UUID_REFERENCE_PATTERN.test(value);
}

export type AthleteRegistrationItem = {
  id: string;
  categoryId: string;
  categorySlug: string;
  eventSlug: string;
  event: string;
  eventImageUrl: string | null;
  linkedTrackImageUrl: string | null;
  category: string;
  date: string;
  location: string;
  status:
    | "confirmed"
    | "pending"
    | "waitlisted"
    | "offered"
    | "completed"
    | "dns"
    | "cancelled"
    | "expired";
  registrationStatus: string;
  paymentStatus: string;
  participationStatus: string;
  canPay: boolean;
  bib: number | null;
  paid: boolean;
  place: number | null;
  paymentEvidenceCount: number;
};

export type AthleteRegistrationsReadModel = {
  displayName: string;
  upcoming: AthleteRegistrationItem[];
  past: AthleteRegistrationItem[];
};

export type AthleteDashboardReadModel = {
  displayName: string;
  nextRaceLabel: string;
  publicProfileSlug: string;
  upcomingRegistrations: Array<{
    event: string;
    category: string;
    date: string;
    status: "confirmed" | "pending";
    bib: number | null;
  }>;
  recentResults: Array<{
    event: string;
    place: number;
    time: string;
    points: number;
  }>;
  stats: {
    upcomingCount: number;
    seasonRaces: number;
    leagueRankLabel: string;
  };
};

export type OrganizerDashboardReadModel = {
  organizationName: string;
  activeEvents: number;
  totalRegistrations: number;
  checkedIn: number;
  publishedResults: number;
  ownedTracks: number;
  ownedLeagueSeasons: number;
  eventsPendingPublish: number;
  tracksPendingPublish: number;
  leagueSeasonsPendingPublish: number;
  upcomingEvents: Array<{
    id: string;
    slug: string;
    name: string;
    date: string;
    registrations: number;
    capacity: number;
    checkedIn: number;
    status: "prep" | "live" | "completed";
    isPublic: boolean;
    publishedAt: string | null;
    coverImageUrl?: string | null;
    linkedTrackImageUrl?: string | null;
  }>;
  finishedEvents: Array<{
    id: string;
    slug: string;
    name: string;
    date: string;
    registrations: number;
    capacity: number;
    checkedIn: number;
    status: "prep" | "live" | "completed";
    isPublic: boolean;
    publishedAt: string | null;
    coverImageUrl?: string | null;
    linkedTrackImageUrl?: string | null;
  }>;
  recentActivity: Array<{
    text: string;
    time: string;
  }>;
  staff: Array<{
    name: string;
    role: string;
  }>;
};

export type OrganizerManagedCategory = {
  id: string;
  slug: string;
  name: string;
  coverImageUrl?: string | null;
  sportCode: SportCode;
  categoryType: "competitive" | "informative";
  courseFormat: "standard" | "laps";
  lapCount: number;
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
  organizerRules: string | null;
  status: string;
  isPractice: boolean;
  isRecurrenceGenerated: boolean;
  recurrenceRuleId: string | null;
  recurrenceSourceEventEditionId: string | null;
  recurrenceSourceDate: string | null;
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
  organizerRules: string | null;
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
  latestPublishedVersionNumber: number | null;
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

export type OrganizerTrackGalleryItem = {
  id: string;
  imageUrl: string;
  storagePath?: string | null;
  caption: string | null;
  isDefault: boolean;
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

export type OrganizerTrackCheckpoint = {
  name: string;
  km: number;
  elev: number;
  lat: number;
  lng: number;
  type: OrganizerTrackCheckpointType;
  typeTags?: OrganizerTrackCheckpointType[];
};

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
  checkedInAt: string | null;
  paymentEvidenceCount: number;
};

export type RegistrationPaymentEvidenceRecord = {
  id: string;
  registrationId: string;
  originalFileName: string;
  contentType: string;
  amountCents: number | null;
  currency: string | null;
  reviewStatus: "submitted" | "verified" | "rejected";
  organizerNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  signedUrl: string | null;
};

export type SubmitRegistrationPaymentEvidenceInput = {
  registrationId: string;
  objectPath: string;
  originalFileName: string;
  contentType: string;
  amountCents?: number | null;
  currency?: string | null;
};

export type RaceDayCategoryState = {
  id: string;
  name: string;
  status: string;
  courseFormat: "standard" | "laps";
  lapCount: number;
  registrationCount: number;
  checkedInCount: number;
  activeSessionId: string | null;
  latestPublicationState: string | null;
  effectiveStartAt: string | null;
  resultInputVersion: string | null;
  checkpoints: Array<{
    id: string;
    code: string;
    name: string;
    checkpointType: string;
    sequenceNumber: number;
    expectedPassesPerAthlete: number;
    expectedCount: number;
    passedCount: number;
  }>;
};

export type RaceDaySessionState = {
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
};

export type RaceDayPunchWarning = {
  code: "unresolved_bib" | "duplicate_checkpoint" | "wrong_sequence" | "cutoff_exceeded";
  message: string;
};

export type RaceDayPunchRecord = {
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
  warnings: RaceDayPunchWarning[];
};

export type RaceDayState = {
  edition: {
    id: string;
    slug: string;
    name: string;
    startDate: string;
    locationName: string | null;
    status: string;
    isPractice: boolean;
  };
  categories: RaceDayCategoryState[];
  sessions: RaceDaySessionState[];
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
  recentPunches: RaceDayPunchRecord[];
  unresolvedPunches: RaceDayPunchRecord[];
};

export type TimingSessionDetail = {
  session: RaceDaySessionState;
  punches: RaceDayPunchRecord[];
};

export type CategoryResultSplit = {
  checkpointId: string;
  checkpointName: string;
  sequenceNumber: number;
  elapsedTimeMs: number | null;
  splitTimeMs: number | null;
  punchEventId: string | null;
  recordedAt: string | null;
};

export type CategoryResultRow = {
  id: string;
  registrationId: string;
  athleteName: string;
  countryCode: string | null;
  gender: string | null;
  clubName: string | null;
  bibNumber: string | null;
  participationStatus: string;
  ageGroupLabel: string | null;
  rankOverall: number | null;
  rankGender: number | null;
  rankAgeCategory: number | null;
  finishTimeMs: number | null;
  gapMs: number | null;
  resultStatus: string;
  points: number | null;
  splits: CategoryResultSplit[];
};

export type CompetitiveSexBucket = {
  key: string;
  label: string;
  gender: "F" | "M";
};

export type CompetitiveAgeBucket = {
  key: string;
  label: string;
  minAge: number;
  maxAge: number | null;
};

export type CompetitiveTeamConfig = {
  enabled: boolean;
  mode: "club";
  label: string;
  scoringMethod: "best_three_by_place";
  scoringCount: number;
};

export type CompetitiveRankingClassification = {
  key: string;
  label: string;
  gender: "F" | "M" | null;
  minimumAge: number | null;
  maximumAge: number | null;
};

export type CompetitiveRankingConfig = {
  overall: {
    enabled: true;
  };
  sex: {
    enabled: boolean;
    buckets: CompetitiveSexBucket[];
  };
  age: {
    enabled: boolean;
    buckets: CompetitiveAgeBucket[];
  };
  classifications?: CompetitiveRankingClassification[];
  team: CompetitiveTeamConfig;
};

export type CompetitiveTeamStanding = {
  rank: number;
  clubId: string;
  clubName: string;
  score: number;
  scorerCount: number;
  scorerRanks: number[];
  scorerNames: string[];
};

export type ResultComplaint = {
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
};

export type OrganizerCategoryResults = {
  calculationMode: "imported_snapshot" | "native_timing";
  category: {
    id: string;
    name: string;
    eventEditionId: string;
    distanceKm: number | null;
    sportCode: string;
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
  rows: CategoryResultRow[];
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
  complaints: ResultComplaint[];
  teamStandings: CompetitiveTeamStanding[];
};

export type CreateRegistrationInput = {
  eventCategoryId: string;
  representedClubId?: string | null;
  publicStartListOptIn?: boolean;
  idempotencyKey: string;
  formVersionId: string;
  answers: Record<string, unknown>;
  acceptedDocumentIds: string[];
};

export type CreateGuestRegistrationInput = CreateRegistrationInput & {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  gender: "F" | "M" | "U";
  city?: string | null;
  countryCode?: string | null;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  shirtSize?: string | null;
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
  organizerAttested: boolean;
  idempotencyKey: string;
};

type AdminSupabaseClient = ReturnType<typeof createAdminSupabaseClient>;

const PAYMENT_EVIDENCE_BUCKET = "registration-payment-evidence";
const PAYMENT_EVIDENCE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type RegistrationPaymentEvidenceRow = {
  id: string;
  registration_id: string;
  object_path: string;
  original_file_name: string;
  content_type: string;
  amount_cents: number | null;
  currency: string | null;
  review_status: "submitted" | "verified" | "rejected";
  organizer_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

type RegistrationCategoryForCreate = {
  id: string;
  event_edition_id: string;
  status: string;
  capacity: number | null;
  registration_fee_cents: number | null;
  registration_fee_periods?: RaceFeePeriod[];
};

type AtomicRegistrationRow = {
  registration_id: string;
  registration_status: string;
  payment_status: string;
};

type AtomicGuestRegistrationRow = AtomicRegistrationRow & {
  athlete_profile_id: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const RESULTS_ENGINE_VERSION = "sitrail-results-v2.4-laps";

export function maximumPlausibleAverageSpeedKph(sportCode: string) {
  if (sportCode === "swimming") return 10;
  if (sportCode === "trail_running") return 30;
  if (sportCode === "road_running") return 35;
  if (sportCode === "mountain_biking") return 90;
  if (sportCode === "road_cycling") return 130;
  return 80;
}

type ResultAnomalyIdentity = {
  event_category_id?: string;
  registration_id: string | null;
  punch_event_id: string | null;
  anomaly_code: string;
  severity: "info" | "warning" | "error" | "critical";
  evidence_json: Record<string, unknown>;
};

type ClosedResultAnomaly = ResultAnomalyIdentity & {
  state: "resolved" | "waived";
  resolution_note: string | null;
  resolved_by_user_id: string | null;
  resolved_at: string;
};

const RESULT_ANOMALY_SCOPE_KEYS: Record<string, readonly string[]> = {
  unresolved_timing_event: ["checkpointId"],
  checkpoint_cutoff_exceeded: ["checkpointId", "cutoffAt"],
  duplicate_checkpoint_observation: ["checkpointId"],
  checkpoint_time_out_of_sequence: ["checkpointId", "previousCheckpointId"],
  finish_time_before_race_start: ["checkpointId", "effectiveStartAt"],
  finished_missing_mandatory_checkpoint: ["missingCheckpointIds"],
  implausible_average_speed: [
    "checkpointId",
    "sportCode",
    "distanceKm",
    "plausibleSpeedLimitKph",
  ],
  participant_missing: [],
  participant_unresolved_in_field: ["participationStatus"],
  participant_unresolved_before_publication: ["participationStatus"],
  participant_non_finisher_status: ["participationStatus"],
};

function canonicalResultAnomalyEvidence(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalResultAnomalyEvidence)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalResultAnomalyEvidence(entry)]),
  );
}

function resultAnomalyResolutionKey(anomaly: ResultAnomalyIdentity) {
  const scopeKeys = RESULT_ANOMALY_SCOPE_KEYS[anomaly.anomaly_code];
  const scopeEvidence = scopeKeys
    ? Object.fromEntries(
        scopeKeys
          .filter((key) => key in anomaly.evidence_json)
          .map((key) => [key, anomaly.evidence_json[key]]),
      )
    : anomaly.evidence_json;

  return JSON.stringify({
    eventCategoryId: anomaly.event_category_id ?? null,
    registrationId: anomaly.registration_id,
    punchEventId: anomaly.punch_event_id,
    code: anomaly.anomaly_code,
    severity: anomaly.severity,
    scope: canonicalResultAnomalyEvidence(scopeEvidence),
  });
}

export function carryForwardResultAnomalyResolutions<T extends ResultAnomalyIdentity>(
  anomalies: readonly T[],
  previousClosedAnomalies: readonly ClosedResultAnomaly[],
) {
  const previousResolutionByKey = new Map(
    previousClosedAnomalies.map((anomaly) => [
      resultAnomalyResolutionKey(anomaly),
      anomaly,
    ]),
  );

  return anomalies.map((anomaly) => {
    const previous = previousResolutionByKey.get(resultAnomalyResolutionKey(anomaly));
    if (!previous) {
      return {
        ...anomaly,
        state: "open" as const,
        resolution_note: null,
        resolved_by_user_id: null,
        resolved_at: null,
      };
    }
    return {
      ...anomaly,
      state: previous.state,
      resolution_note: previous.resolution_note,
      resolved_by_user_id: previous.resolved_by_user_id,
      resolved_at: previous.resolved_at,
    };
  });
}

type ResultInputStartEvent = {
  id: string;
  event_type: "actual_start" | "restart";
  occurred_at: string;
  start_method: string;
  sequence_number: number;
};

function buildCategoryResultInputDigest(input: {
  categoryId: string;
  categoryDistanceKm: number | null;
  courseFormat: OrganizerManagedCategory["courseFormat"];
  lapCount: number;
  sportCode: string;
  startEvent: ResultInputStartEvent;
  checkpoints: Array<Pick<CheckpointRow, "id" | "sequence_number" | "is_mandatory">>;
  registrations: Array<{ id: string; participation_status: string }>;
  punches: Array<{
    id: string;
    registration_id: string | null;
    checkpoint_id: string;
    effective_recorded_at: string;
  }>;
}) {
  return sha256(JSON.stringify({
    engineVersion: RESULTS_ENGINE_VERSION,
    eventCategoryId: input.categoryId,
    categoryDistanceKm: input.categoryDistanceKm,
    courseFormat: input.courseFormat,
    lapCount: input.lapCount,
    sportCode: input.sportCode,
    startEvent: {
      id: input.startEvent.id,
      eventType: input.startEvent.event_type,
      occurredAt: input.startEvent.occurred_at,
      startMethod: input.startEvent.start_method,
      sequenceNumber: input.startEvent.sequence_number,
    },
    checkpoints: [...input.checkpoints]
      .sort((left, right) => left.sequence_number - right.sequence_number || left.id.localeCompare(right.id))
      .map((checkpoint) => ({
        id: checkpoint.id,
        sequenceNumber: checkpoint.sequence_number,
        mandatory: checkpoint.is_mandatory,
      })),
    registrations: [...input.registrations]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((registration) => ({
        id: registration.id,
        participationStatus: registration.participation_status,
      })),
    punches: [...input.punches]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((punch) => ({
        id: punch.id,
        registrationId: punch.registration_id,
        checkpointId: punch.checkpoint_id,
        effectiveRecordedAt: punch.effective_recorded_at,
      })),
  }));
}

function throwAtomicRegistrationError(error: { message?: string | null; code?: string | null }): never {
  const message = error.message ?? "registration_failed";
  if (message.includes("category_full")) throw conflict("This category is full");
  if (message.includes("already_registered")) throw conflict("You are already registered for this category");
  if (message.includes("idempotency_key_reused")) throw conflict("This registration request key was already used for different details");
  if (message.includes("registration_closed")) throw conflict("Registration is closed");
  if (message.includes("event_club_membership_required")) {
    throw forbidden("Registration is limited to active members of the selected clubs");
  }
  if (message.includes("terms_acceptance_required")) throw badRequest("Accept the current participation terms before registering");
  if (message.includes("registration_form_version_invalid")) {
    throw conflict("The registration form changed. Reload it and review the current terms.");
  }
  if (message.includes("registration_required_answer_missing")) {
    throw badRequest("Complete every required registration question");
  }
  if (message.includes("registration_required_consent_missing")) {
    throw badRequest("Accept every required race document before registering");
  }
  if (message.includes("eligibility_birth_date_required")) {
    throw badRequest("Add a verified date of birth before registering for this race");
  }
  if (message.includes("eligibility_minimum_age_not_met")) {
    throw conflict("The athlete does not meet this race's minimum age on race day");
  }
  if (message.includes("eligibility_maximum_age_exceeded")) {
    throw conflict("The athlete exceeds this race's maximum age on race day");
  }
  if (message.includes("eligibility_gender_not_allowed")) {
    throw conflict("The athlete is not eligible for this race category");
  }
  if (
    message.includes("registration_answers_must_be_object")
    || message.includes("registration_answer_field_unknown")
  ) {
    throw badRequest("The registration answers do not match the published form");
  }
  if (message.includes("category_not_found")) throw notFound("Category not found");
  if (message.includes("edition_not_found")) throw notFound("Edition not found");
  throw error;
}

function cleanOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanRequiredText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw badRequest(`${label} is required`);
  }
  return trimmed;
}

async function requireRegistrationPaymentEvidenceAccess(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv,
) {
  const context = await resolveRegistrationContext(registrationId, env);
  if (session.account.primaryAthleteProfileId === context.athleteProfileId) {
    return context;
  }

  requireOrganizationAccess(session, context.organizationId, "finance.manage");
  return context;
}

async function loadRegistrationPaymentEvidence(
  registrationId: string,
  env: ServerEnv,
): Promise<RegistrationPaymentEvidenceRecord[]> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: rows, error } = await adminClient
    .from("registration_payment_evidence")
    .select(
      "id,registration_id,object_path,original_file_name,content_type,amount_cents,currency,review_status,organizer_note,submitted_at,reviewed_at",
    )
    .eq("registration_id", registrationId)
    .order("submitted_at", { ascending: false })
    .returns<RegistrationPaymentEvidenceRow[]>();

  if (error) throw error;
  if (!rows?.length) return [];

  const { data: signedRows, error: signedError } = await adminClient.storage
    .from(PAYMENT_EVIDENCE_BUCKET)
    .createSignedUrls(rows.map((row) => row.object_path), 10 * 60);

  if (signedError) throw signedError;
  const signedUrlByPath = new Map(
    (signedRows ?? [])
      .filter((row) => Boolean(row.signedUrl))
      .map((row) => [row.path, row.signedUrl] as const),
  );

  return rows.map((row) => ({
    id: row.id,
    registrationId: row.registration_id,
    originalFileName: row.original_file_name,
    contentType: row.content_type,
    amountCents: row.amount_cents,
    currency: row.currency,
    reviewStatus: row.review_status,
    organizerNote: row.organizer_note,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    signedUrl: signedUrlByPath.get(row.object_path) ?? null,
  }));
}

function isValidPastIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isRealDate) return false;
  return value <= new Date().toISOString().slice(0, 10);
}

function normalizeGuestEmail(value: string) {
  const email = cleanRequiredText(value, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("A valid email address is required");
  }
  return email;
}

function normalizeGuestDateOfBirth(value: string) {
  const dateOfBirth = cleanRequiredText(value, "Date of birth");
  if (!isValidPastIsoDate(dateOfBirth)) {
    throw badRequest("A valid date of birth is required");
  }
  return dateOfBirth;
}

function normalizeGuestGender(value: string) {
  if (value !== "F" && value !== "M" && value !== "U") {
    throw badRequest("Gender is required");
  }
  return value;
}

function normalizeGuestCountryCode(value: string | null | undefined) {
  const countryCode = cleanOptionalText(value)?.toUpperCase() ?? null;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw badRequest("Choose a valid country");
  }
  return countryCode;
}

async function resolveRepresentedClubId(
  athleteProfileId: string,
  input: CreateRegistrationInput,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const hasExplicitClubChoice = Object.prototype.hasOwnProperty.call(input, "representedClubId");

  if (hasExplicitClubChoice && input.representedClubId == null) {
    return null;
  }

  if (input.representedClubId) {
    const { data: membership, error } = await adminClient
      .from("club_memberships")
      .select("club_id")
      .eq("club_id", input.representedClubId)
      .eq("athlete_profile_id", athleteProfileId)
      .eq("status", "active")
      .maybeSingle<{ club_id: string }>();

    if (error) throw error;
    if (!membership) {
      throw forbidden("You can only represent clubs where you have an active membership.");
    }

    return input.representedClubId;
  }

  const { data: primaryMembership, error: primaryMembershipError } = await adminClient
    .from("club_memberships")
    .select("club_id")
    .eq("athlete_profile_id", athleteProfileId)
    .eq("status", "active")
    .order("is_primary", { ascending: false })
    .order("joined_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ club_id: string }>();

  if (primaryMembershipError) throw primaryMembershipError;

  return primaryMembership?.club_id ?? null;
}

async function assertRaceProfileReady(
  athleteProfileId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: athleteProfile, error: athleteProfileError }, { data: registrationProfile, error: registrationProfileError }] = await Promise.all([
    adminClient
      .from("athlete_profiles")
      .select("date_of_birth,gender")
      .eq("id", athleteProfileId)
      .maybeSingle<{ date_of_birth: string | null; gender: string | null }>(),
    adminClient
      .from("athlete_registration_profiles")
      .select("phone,emergency_contact_name,emergency_contact_phone")
      .eq("athlete_profile_id", athleteProfileId)
      .maybeSingle<{
        phone: string | null;
        emergency_contact_name: string | null;
        emergency_contact_phone: string | null;
      }>(),
  ]);

  if (athleteProfileError) throw athleteProfileError;
  if (registrationProfileError) throw registrationProfileError;

  const missingFields: string[] = [];
  if (!athleteProfile?.date_of_birth) missingFields.push("date of birth");
  if (!athleteProfile?.gender) missingFields.push("gender");
  if (!registrationProfile?.phone) missingFields.push("phone");
  if (!registrationProfile?.emergency_contact_name || !registrationProfile?.emergency_contact_phone) {
    missingFields.push("emergency contact");
  }

  if (missingFields.length > 0) {
    throw badRequest(
      `Complete your race profile before registering. Missing: ${missingFields.join(", ")}.`,
    );
  }
}

async function loadCategoryForPublicRegistration(
  adminClient: AdminSupabaseClient,
  eventCategoryId: string,
) {
  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,event_edition_id,status,capacity,registration_fee_cents")
    .eq("id", eventCategoryId)
    .is("organizer_deleted_at", null)
    .maybeSingle<RegistrationCategoryForCreate>();

  if (categoryError) throw categoryError;
  if (!category) throw notFound("Category not found");
  if (category.status === "closed" || category.status === "completed") {
    throw conflict("Registration is closed for this category");
  }

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("id,status,registration_open_at,registration_close_at")
    .eq("id", category.event_edition_id)
    .is("organizer_deleted_at", null)
    .maybeSingle<{
      id: string;
      status: string;
      registration_open_at: string | null;
      registration_close_at: string | null;
    }>();

  if (editionError) throw editionError;
  if (!edition) throw notFound("Edition not found");

  if (!["published", "registration_open", "registration_closed"].includes(edition.status)) {
    throw conflict("This race is not open for registration");
  }

  const nowIso = new Date().toISOString();
  if (edition.registration_open_at && edition.registration_open_at > nowIso) {
    throw conflict("Registration has not opened yet");
  }
  if (edition.registration_close_at && edition.registration_close_at < nowIso) {
    throw conflict("Registration is closed");
  }

  return category;
}

export type OrganizerEventLocationInput = {
  type: string;
  label: string;
  description?: string | null;
  place?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type OrganizerEventTimelineItemInput = {
  time: string;
  description: string;
};

export type CreateOrganizerEventInput = {
  name: string;
  editionLabel?: string | null;
  organizationId?: string | null;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  activityType?: EventActivityType;
  countryCode?: string | null;
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
  generalTimeline?: OrganizerEventTimelineItemInput[];
  locations?: OrganizerEventLocationInput[];
  status?: string;
};

export type UpdateOrganizerEventInput = {
  id: string;
  seriesId: string;
  sportCodes?: SportCode[];
  primarySportCode?: SportCode;
  activityType?: EventActivityType;
  name?: string;
  editionLabel?: string | null;
  countryCode?: string | null;
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
  generalTimeline?: OrganizerEventTimelineItemInput[];
  locations?: OrganizerEventLocationInput[];
  status?: string;
};

export type CreateOrganizerCategoryInput = {
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

export type UpdateOrganizerCategoryInput = {
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
};

export type UpdateOrganizerCheckpointInput = {
  checkpointId: string;
  name?: string;
  cutoffAt?: string | null;
  isMandatory?: boolean;
  settings?: Partial<OrganizerCheckpointSettings>;
};

export type SyncOrganizerCategoryCheckpointsInput = {
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

export type AttachOrganizerLeagueRoundInput = {
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

export type UpdateOrganizerRegistrationInput = {
  registrationId: string;
  bibNumber?: string | null;
};

export type CreateOrganizerTrackInput = {
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

export type UpdateOrganizerTrackInput = {
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

export type AssignOrganizerCategoryTrackInput = {
  trackTemplateId: string;
  trackVersionId?: string | null;
};

export type TrackGpxDownload = {
  fileName: string;
  mimeType: string;
  content: string;
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

export type CreateOrganizerLeagueInput = {
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

export type UpdateOrganizerLeagueInput = {
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
};

export type CheckInInput = {
  locationLabel?: string | null;
  notes?: string | null;
};

export type CreateTimingSessionInput = {
  eventEditionId: string;
  eventCategoryId?: string | null;
  checkpointId?: string | null;
  mode?: string | null;
};

export type RecordPunchInput = {
  timingSessionId: string;
  checkpointId: string;
  clientEventId: string;
  recordedAt: string;
  registrationId?: string | null;
  bibNumber?: string | null;
};

export type RecordSharedPunchInput = {
  eventEditionId: string;
  checkpointIds: string[];
  clientEventId: string;
  recordedAt: string;
  bibNumber: string;
};

export type PublishResultsInput = {
  resultRunId?: string | null;
  publicationState?: "provisional" | "official" | "corrected";
  changeNote?: string | null;
  clientEventId: string;
};

export type CreateResultComplaintInput = {
  registrationId?: string | null;
  bibNumber?: string | null;
  complainantName: string;
  complaintText: string;
};

export type ResolveResultComplaintInput = {
  status: "resolved" | "dismissed";
  resolutionNote: string;
};

type RegistrationRow = {
  current_quote_id?: string | null;
  id: string;
  athlete_profile_id: string;
  event_category_id: string;
  represented_club_id: string | null;
  status: string;
  payment_status: string;
  participation_status: string;
  result_status: string;
  created_at: string;
  confirmed_at: string | null;
};

type CheckpointRow = {
  id: string;
  event_category_id: string;
  code: string;
  name: string;
  checkpoint_type: string;
  sequence_number: number;
  distance_from_start_km: number | null;
  cutoff_at: string | null;
  is_mandatory: boolean;
  settings_json: unknown;
};

const REGISTERED_RACE_STATUSES = ["pending", "confirmed"] as const;
const STARTED_RACE_PARTICIPATION_STATUSES = new Set([
  "started",
  "finished",
  "dnf",
  "dsq",
  "stopped",
  "evacuated",
  "missing",
]);

type OrganizerRegistrationCountRow = {
  event_category_id: string;
  registered_count: number;
};

async function loadOrganizerRegistrationCounts(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  categoryIds: string[],
) {
  if (!categoryIds.length) return new Map<string, number>();
  const { data, error } = await adminClient.rpc("service_organizer_registration_counts", {
    target_event_category_ids: categoryIds,
  });
  if (error) {
    if (error.code !== "PGRST202") throw error;
    const { data: registrationRows, error: fallbackError } = await adminClient
      .from("registrations")
      .select("event_category_id")
      .in("event_category_id", categoryIds)
      .in("status", REGISTERED_RACE_STATUSES)
      .is("organizer_removed_at", null)
      .returns<Array<{ event_category_id: string }>>();
    if (fallbackError) throw fallbackError;
    const fallbackCounts = new Map<string, number>();
    for (const registration of registrationRows ?? []) {
      fallbackCounts.set(
        registration.event_category_id,
        (fallbackCounts.get(registration.event_category_id) ?? 0) + 1,
      );
    }
    return fallbackCounts;
  }
  return new Map(
    ((data ?? []) as OrganizerRegistrationCountRow[]).map((row) => [
      row.event_category_id,
      Math.max(0, Number(row.registered_count) || 0),
    ]),
  );
}

export function selectOperationalRaceDayRegistrationIds(
  registrations: ReadonlyArray<{
    id: string;
    event_category_id: string;
    status: string;
    participation_status: string;
  }>,
  checkedInRegistrationIds: ReadonlySet<string>,
) {
  const startedCategoryIds = new Set(
    registrations
      .filter((registration) =>
        STARTED_RACE_PARTICIPATION_STATUSES.has(registration.participation_status),
      )
      .map((registration) => registration.event_category_id),
  );

  return new Set(
    registrations
      .filter((registration) => {
        if (!REGISTERED_RACE_STATUSES.includes(
          registration.status as (typeof REGISTERED_RACE_STATUSES)[number],
        )) {
          return false;
        }
        return startedCategoryIds.has(registration.event_category_id)
          ? STARTED_RACE_PARTICIPATION_STATUSES.has(registration.participation_status)
          : checkedInRegistrationIds.has(registration.id);
      })
      .map((registration) => registration.id),
  );
}

function formatDateLabel(dateValue: string | null | undefined) {
  if (!dateValue) return "TBA";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Europe/Zagreb",
  }).format(new Date(`${dateValue}T00:00:00`));
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

function normalizeCourseFormat(value: string | null | undefined): OrganizerManagedCategory["courseFormat"] {
  return value === "laps" ? "laps" : "standard";
}

function normalizeLapCount(
  courseFormat: OrganizerManagedCategory["courseFormat"],
  value: number | null | undefined,
) {
  if (courseFormat !== "laps") return 1;
  return Math.max(2, Math.min(100, Math.trunc(value ?? 2)));
}

function expectedCheckpointPasses(
  courseFormat: OrganizerManagedCategory["courseFormat"],
  lapCount: number,
  checkpointType: string,
) {
  return courseFormat === "laps" && checkpointType !== "start" ? lapCount : 1;
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
  const allowedKinds = new Set<OrganizerCheckpointSettings["kind"]>([
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
    typeof record.kind === "string" && allowedKinds.has(record.kind as OrganizerCheckpointSettings["kind"])
      ? (record.kind as OrganizerCheckpointSettings["kind"])
      : fallback.kind;
  const typeTags = Array.isArray(record.typeTags)
    ? record.typeTags.filter(
        (tag): tag is NonNullable<OrganizerCheckpointSettings["typeTags"]>[number] =>
          typeof tag === "string" && allowedKinds.has(tag as OrganizerCheckpointSettings["kind"]),
      )
    : [];

  return {
    kind,
    typeTags: typeTags.length ? typeTags : [kind],
    visibleOnPublicPage:
      typeof record.visibleOnPublicPage === "boolean"
        ? record.visibleOnPublicPage
        : fallback.visibleOnPublicPage,
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
  type: OrganizerTrackCheckpoint["type"];
  typeTags: OrganizerTrackCheckpointType[];
};

function normalizeTrackGalleryItems(value: unknown): OrganizerTrackGalleryItem[] {
  if (!Array.isArray(value)) return [];

  let defaultAssigned = false;
  const items = value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const imageUrl = typeof record.imageUrl === "string" && record.imageUrl.trim() ? record.imageUrl.trim() : null;
    if (!imageUrl) return [];

    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `gallery-${index + 1}`;
    const caption =
      typeof record.caption === "string" && record.caption.trim()
        ? record.caption.trim()
        : null;
    const isDefault = typeof record.isDefault === "boolean" ? record.isDefault : false;
    const storagePath =
      typeof record.storagePath === "string" && record.storagePath.trim()
        ? record.storagePath.trim()
        : null;

    const nextItem = {
      id,
      imageUrl,
      storagePath,
      caption,
      isDefault: isDefault && !defaultAssigned,
    };

    if (nextItem.isDefault) defaultAssigned = true;

    return [nextItem];
  });

  if (!items.length) return [];
  if (items.some((item) => item.isDefault)) return items;

  return items.map((item, index) => (index === 0 ? { ...item, isDefault: true } : item));
}

function normalizeTrackPreviewImageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const imageUrl = value.trim();
  if (!imageUrl || imageUrl.toLowerCase().startsWith("data:")) return null;
  return imageUrl;
}

function previewImageFromTrackGallery(items: OrganizerTrackGalleryItem[]) {
  const preferred = items.find((item) => item.isDefault) ?? items[0] ?? null;
  return normalizeTrackPreviewImageUrl(preferred?.imageUrl);
}

const TRACK_TEMPLATE_DRAFT_KEYS = [
  "name",
  "terrain_type",
  "notes",
  "public_overview",
  "location_label",
  "season_label",
  "parking_label",
  "weather_location_label",
  "best_time_label",
  "gallery_items_json",
] as const;

function normalizeTrackTemplateDraftPatch(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    TRACK_TEMPLATE_DRAFT_KEYS.flatMap((key) => (
      Object.prototype.hasOwnProperty.call(source, key) ? [[key, source[key]]] : []
    )),
  );
}

function trackTemplateDraftValue<T>(
  template: Record<string, unknown>,
  patch: Record<string, unknown>,
  key: string,
) {
  return (Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : template[key]) as T;
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

function normalizeTrackSegments(value: unknown): OrganizerTrackSegment[] {
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

    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `segment-${index + 1}`;

    return [{
      id,
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

function normalizeTrackSnapshotCheckpoints(value: unknown): TrackSnapshotCheckpoint[] {
  if (!Array.isArray(value)) return [];
  const allowedTypes = new Set<OrganizerTrackCheckpoint["type"]>([
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
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const typeTags = Array.isArray(record.typeTags)
      ? record.typeTags.filter(
          (entry): entry is OrganizerTrackCheckpointType =>
            typeof entry === "string" && allowedTypes.has(entry as OrganizerTrackCheckpointType),
        )
      : [];
    const type =
      typeof record.type === "string" && allowedTypes.has(record.type as OrganizerTrackCheckpoint["type"])
        ? (record.type as OrganizerTrackCheckpoint["type"])
        : typeTags[0] ?? "checkpoint";
    const lat = record.lat == null ? null : Number(record.lat);
    const lng = record.lng == null ? null : Number(record.lng);
    const km = record.km == null ? null : Number(record.km);
    const elev = record.elev == null ? null : Number(record.elev);
    if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) return [];
    return [{
      name: String(record.name ?? type.toUpperCase()),
      km: km != null && Number.isFinite(km) ? km : null,
      elev: elev != null && Number.isFinite(elev) ? elev : null,
      lat,
      lng,
      type,
      typeTags: typeTags.length ? typeTags : [type],
    }];
  });
}

function checkpointTypeForSnapshot(type: TrackSnapshotCheckpoint["type"]) {
  return type === "start" || type === "finish" ? type : "split";
}

function checkpointCodeForSnapshot(type: TrackSnapshotCheckpoint["type"], checkpointIndex: number) {
  if (type === "start") return "START";
  if (type === "finish") return "FINISH";
  return `CP${checkpointIndex}`;
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

function defaultCheckpointSettingsForTrackType(checkpoint: Pick<TrackSnapshotCheckpoint, "type" | "typeTags">) {
  const tags = checkpoint.typeTags.length ? checkpoint.typeTags : [checkpoint.type];
  const base = defaultCheckpointSettings(checkpointTypeForSnapshot(checkpoint.type));
  if (tags.includes("timing_split")) {
    return {
      ...base,
      kind: "timing_split" as const,
      isTimingSplit: true,
    };
  }
  if (tags.includes("water")) {
    return {
      ...base,
      kind: "water" as const,
      isTimingSplit: false,
      isWaterPoint: true,
    };
  }
  if (tags.includes("refreshment")) {
    return {
      ...base,
      kind: "refreshment" as const,
      isTimingSplit: false,
      isWaterPoint: true,
    };
  }
  if (tags.includes("medical")) {
    return {
      ...base,
      kind: "medical" as const,
      isTimingSplit: false,
      medicalAccess: true,
    };
  }
  if (tags.includes("marshal")) {
    return {
      ...base,
      kind: "marshal" as const,
      isTimingSplit: false,
    };
  }
  if (tags.includes("danger_point")) {
    return {
      ...base,
      kind: "danger_point" as const,
      isTimingSplit: false,
    };
  }
  if (tags.includes("route_split")) {
    return {
      ...base,
      kind: "route_split" as const,
      isTimingSplit: false,
    };
  }
  if (tags.includes("route_merge")) {
    return {
      ...base,
      kind: "route_merge" as const,
      isTimingSplit: false,
    };
  }
  if (tags.includes("summit")) {
    return {
      ...base,
      kind: "summit" as const,
      isTimingSplit: false,
    };
  }
  if (tags.includes("scenic_point")) {
    return {
      ...base,
      kind: "scenic_point" as const,
      isTimingSplit: false,
    };
  }
  if (tags.includes("checkpoint")) {
    return {
      ...base,
      kind: "checkpoint",
      isTimingSplit: false,
    };
  }
  return base;
}

async function uniqueScopedSlug(
  input: {
    table: "event_series" | "event_editions" | "event_categories" | "leagues" | "track_templates";
    scopeColumn: string;
    scopeValue: string;
    baseSlug: string;
  },
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  let candidate = input.baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await adminClient
      .from(input.table)
      .select("id")
      .eq(input.scopeColumn, input.scopeValue)
      .eq("slug", candidate)
      .maybeSingle<{ id: string }>();

    if (error) throw error;
    if (!data) return candidate;

    candidate = `${input.baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function uniqueGlobalEventEditionSlug(baseSlug: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await adminClient
      .from("event_editions")
      .select("id")
      .eq("slug", candidate)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (error) throw error;
    if (!data && storedEventSlug(candidate) === candidate) return candidate;

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

function formatShortDateLabel(dateValue: string | null | undefined) {
  if (!dateValue) return "TBA";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Europe/Zagreb",
  }).format(new Date(`${dateValue}T00:00:00`));
}

function formatElapsedTime(milliseconds: number | null | undefined) {
  if (milliseconds == null || milliseconds <= 0) return "TBA";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRelativeTime(dateValue: string | null | undefined) {
  if (!dateValue) return "recently";
  const differenceMs = Date.now() - new Date(dateValue).getTime();
  if (differenceMs < 60_000) return "just now";
  const minutes = Math.round(differenceMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function startOfTodayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function numberOrNull(value: string | number | null | undefined) {
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
    record.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the")
  );
}

function isForeignKeyViolation(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && (error as { code?: string }).code === "23503"
  );
}

type StoredSportAssignment = {
  sport_code: SportCode;
  is_primary: boolean;
};

function mapStoredSportSelection(rows: StoredSportAssignment[] | null | undefined) {
  return normalizeSportSelection({
    sportCodes: rows?.map((row) => row.sport_code),
    primarySportCode: rows?.find((row) => row.is_primary)?.sport_code,
  });
}

async function replaceEventEditionSports(
  adminClient: AdminSupabaseClient,
  eventEditionId: string,
  input: { sportCodes?: SportCode[]; primarySportCode?: SportCode },
) {
  let existing: StoredSportAssignment[] = [];
  if (input.sportCodes === undefined) {
    const { data, error } = await adminClient
      .from("event_edition_sports")
      .select("sport_code,is_primary")
      .eq("event_edition_id", eventEditionId)
      .returns<StoredSportAssignment[]>();
    if (error) throw error;
    existing = data ?? [];
  }
  const current = mapStoredSportSelection(existing);
  const selection = normalizeSportSelection({
    sportCodes: input.sportCodes ?? current.sportCodes,
    primarySportCode: input.primarySportCode
      ?? (input.sportCodes === undefined ? current.primarySportCode : input.sportCodes[0]),
  });
  const { error: deleteError } = await adminClient
    .from("event_edition_sports")
    .delete()
    .eq("event_edition_id", eventEditionId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await adminClient.from("event_edition_sports").insert(
    selection.sportCodes.map((sportCode) => ({
      event_edition_id: eventEditionId,
      sport_code: sportCode,
      is_primary: sportCode === selection.primarySportCode,
    })),
  );
  if (insertError) throw insertError;
  return selection;
}

async function replaceLeagueSports(
  adminClient: AdminSupabaseClient,
  leagueId: string,
  input: { sportCodes?: SportCode[]; primarySportCode?: SportCode },
) {
  let existing: StoredSportAssignment[] = [];
  if (input.sportCodes === undefined) {
    const { data, error } = await adminClient
      .from("league_sports")
      .select("sport_code,is_primary")
      .eq("league_id", leagueId)
      .returns<StoredSportAssignment[]>();
    if (error) throw error;
    existing = data ?? [];
  }
  const current = mapStoredSportSelection(existing);
  const selection = normalizeSportSelection({
    sportCodes: input.sportCodes ?? current.sportCodes,
    primarySportCode: input.primarySportCode
      ?? (input.sportCodes === undefined ? current.primarySportCode : input.sportCodes[0]),
  });
  const { error: deleteError } = await adminClient
    .from("league_sports")
    .delete()
    .eq("league_id", leagueId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await adminClient.from("league_sports").insert(
    selection.sportCodes.map((sportCode) => ({
      league_id: leagueId,
      sport_code: sportCode,
      is_primary: sportCode === selection.primarySportCode,
    })),
  );
  if (insertError) throw insertError;
  return selection;
}

async function loadPrimaryEventSport(
  adminClient: AdminSupabaseClient,
  eventEditionId: string,
): Promise<SportCode> {
  const { data, error } = await adminClient
    .from("event_edition_sports")
    .select("sport_code,is_primary")
    .eq("event_edition_id", eventEditionId)
    .returns<StoredSportAssignment[]>();
  if (error) throw error;
  return mapStoredSportSelection(data).primarySportCode;
}

async function synchronizeEventEditionSportsFromCategories(
  adminClient: AdminSupabaseClient,
  eventEditionId: string,
  preferredPrimarySport?: SportCode,
) {
  const [{ data: categorySports, error: categorySportsError }, { data: storedSports, error: storedSportsError }] = await Promise.all([
    adminClient
      .from("event_categories")
      .select("sport_code")
      .eq("event_edition_id", eventEditionId)
      .is("organizer_deleted_at", null)
      .returns<Array<{ sport_code: SportCode }>>(),
    adminClient
      .from("event_edition_sports")
      .select("sport_code,is_primary")
      .eq("event_edition_id", eventEditionId)
      .returns<StoredSportAssignment[]>(),
  ]);
  if (categorySportsError) throw categorySportsError;
  if (storedSportsError) throw storedSportsError;

  const sportCodes = Array.from(new Set((categorySports ?? []).map((row) => row.sport_code)));
  if (!sportCodes.length) return;
  const storedPrimarySport = (storedSports ?? []).find((row) => row.is_primary)?.sport_code;
  const primarySportCode = storedPrimarySport && sportCodes.includes(storedPrimarySport)
    ? storedPrimarySport
    : preferredPrimarySport && sportCodes.includes(preferredPrimarySport)
      ? preferredPrimarySport
      : sportCodes[0]!;
  await replaceEventEditionSports(adminClient, eventEditionId, {
    sportCodes,
    primarySportCode,
  });
}

function isLeagueScoringRulesUnchangedError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { message?: string; details?: string };
  return `${record.message ?? ""} ${record.details ?? ""}`
    .toLowerCase()
    .includes("league_scoring_rules_unchanged");
}

function immutableLeagueTieBreakMethod(value: string | null | undefined) {
  if (value === "best_finish") return "best_finish";
  if (value === "last_round" || value === "last_round_better") return "last_round";
  return "most_wins";
}

function defaultSexBuckets(): CompetitiveSexBucket[] {
  return PORTAL_DEFAULT_COMPETITION_CATEGORY_POLICY.classifications.map((category) => ({
    key: category.key,
    label: category.label,
    gender: category.eligibility.gender,
  }));
}

function defaultAgeBuckets(): CompetitiveAgeBucket[] {
  return [
    { key: "u16", label: "U16", minAge: 0, maxAge: 15.99 },
    { key: "u18", label: "U18", minAge: 16, maxAge: 17.99 },
    { key: "u20", label: "U20", minAge: 18, maxAge: 19.99 },
    { key: "u23", label: "U23", minAge: 20, maxAge: 22.99 },
    { key: "senior", label: "23-34", minAge: 23, maxAge: 34.99 },
    { key: "35-39", label: "35-39", minAge: 35, maxAge: 39.99 },
    { key: "40-44", label: "40-44", minAge: 40, maxAge: 44.99 },
    { key: "45-49", label: "45-49", minAge: 45, maxAge: 49.99 },
    { key: "50-54", label: "50-54", minAge: 50, maxAge: 54.99 },
    { key: "55-59", label: "55-59", minAge: 55, maxAge: 59.99 },
    { key: "60-64", label: "60-64", minAge: 60, maxAge: 64.99 },
    { key: "65-69", label: "65-69", minAge: 65, maxAge: 69.99 },
    { key: "70-74", label: "70-74", minAge: 70, maxAge: 74.99 },
    { key: "75-79", label: "75-79", minAge: 75, maxAge: 79.99 },
    { key: "80-plus", label: "80+", minAge: 80, maxAge: null },
  ];
}

function roundAgeBoundary(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeClosedAgeBucketMaxAge(value: number | null) {
  if (value == null) return null;
  const rounded = roundAgeBoundary(Math.max(0, value));
  return Number.isInteger(rounded) ? rounded + 0.99 : rounded;
}

function defaultCompetitiveRankingConfig(): CompetitiveRankingConfig {
  return {
    overall: { enabled: true },
    sex: {
      enabled: true,
      buckets: defaultSexBuckets(),
    },
    age: {
      enabled: false,
      buckets: defaultAgeBuckets(),
    },
    classifications: [
      { key: "female", label: "Female", gender: "F", minimumAge: 16, maximumAge: 64.99 },
      { key: "male", label: "Male", gender: "M", minimumAge: 16, maximumAge: 64.99 },
      { key: "girls-u16", label: "Female U16", gender: "F", minimumAge: null, maximumAge: 15.99 },
      { key: "boys-u16", label: "Male U16", gender: "M", minimumAge: null, maximumAge: 15.99 },
      { key: "senior-65-plus", label: "Senior 65+", gender: null, minimumAge: 65, maximumAge: null },
    ],
    team: {
      enabled: false,
      mode: "club",
      label: "Club / Team",
      scoringMethod: "best_three_by_place",
      scoringCount: 3,
    },
  };
}

function normalizeRankingGender(value: string | null | undefined): "F" | "M" | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "F" || normalized === "FEMALE" || normalized === "W") return "F";
  if (normalized === "M" || normalized === "MALE") return "M";
  return null;
}

function normalizeCompetitiveRankingConfig(value: unknown): CompetitiveRankingConfig {
  const defaults = defaultCompetitiveRankingConfig();
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const sexRecord = record.sex && typeof record.sex === "object" ? (record.sex as Record<string, unknown>) : {};
  const ageRecord = record.age && typeof record.age === "object" ? (record.age as Record<string, unknown>) : {};
  const teamRecord = record.team && typeof record.team === "object" ? (record.team as Record<string, unknown>) : {};

  const sexBuckets = (Array.isArray(sexRecord.buckets) ? sexRecord.buckets : defaults.sex.buckets)
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const bucket = item as Record<string, unknown>;
      const gender = normalizeRankingGender(typeof bucket.gender === "string" ? bucket.gender : null);
      if (!gender) return [];
      const label =
        typeof bucket.label === "string" && bucket.label.trim()
          ? bucket.label.trim()
          : gender === "F"
          ? "Female"
          : "Male";
      return [
        {
          key:
            typeof bucket.key === "string" && bucket.key.trim()
              ? bucket.key.trim()
              : slugify(`${label}-${index + 1}`),
          label,
          gender,
        } satisfies CompetitiveSexBucket,
      ];
    })
    .filter((bucket, index, items) => items.findIndex((entry) => entry.gender === bucket.gender) === index);

  const ageBuckets = (Array.isArray(ageRecord.buckets) ? ageRecord.buckets : defaults.age.buckets)
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const bucket = item as Record<string, unknown>;
      const minAge = numberOrNull(bucket.minAge as string | number | null | undefined);
      const maxAge =
        bucket.maxAge == null
          ? null
          : normalizeClosedAgeBucketMaxAge(numberOrNull(bucket.maxAge as string | number | null | undefined));
      if (minAge == null || minAge < 0) return [];
      if (maxAge != null && maxAge < minAge) return [];
      const label =
        typeof bucket.label === "string" && bucket.label.trim()
          ? bucket.label.trim()
          : maxAge == null
          ? `${minAge}+`
          : `${minAge}-${maxAge}`;
      return [
        {
          key:
            typeof bucket.key === "string" && bucket.key.trim()
              ? bucket.key.trim()
              : slugify(`${label}-${index + 1}`),
          label,
          minAge,
          maxAge,
        } satisfies CompetitiveAgeBucket,
      ];
    })
    .sort((left, right) => left.minAge - right.minAge);

  const femaleBucket = sexBuckets.find((bucket) => bucket.gender === "F");
  const maleBucket = sexBuckets.find((bucket) => bucket.gender === "M");
  const sex = {
    enabled: sexRecord.enabled === undefined ? defaults.sex.enabled : Boolean(sexRecord.enabled),
    buckets: femaleBucket && maleBucket ? [femaleBucket, maleBucket] : defaultSexBuckets(),
  };
  const age = {
    enabled: ageRecord.enabled === undefined ? defaults.age.enabled : Boolean(ageRecord.enabled),
    buckets: ageBuckets.length ? ageBuckets : defaultAgeBuckets(),
  };
  const rawClassifications = Array.isArray(record.classifications) ? record.classifications : null;
  const classifications = rawClassifications
    ? rawClassifications.flatMap((item, index) => {
        if (!item || typeof item !== "object") return [];
        const classification = item as Record<string, unknown>;
        const label = typeof classification.label === "string" ? classification.label.trim() : "";
        if (!label) return [];
        const gender = normalizeRankingGender(
          typeof classification.gender === "string" ? classification.gender : null,
        );
        const minimumAge = numberOrNull(classification.minimumAge as string | number | null | undefined);
        const rawMaximumAge = numberOrNull(classification.maximumAge as string | number | null | undefined);
        const maximumAge = rawMaximumAge == null ? null : roundAgeBoundary(rawMaximumAge);
        if (minimumAge != null && (minimumAge < 0 || minimumAge > 120)) return [];
        if (maximumAge != null && (maximumAge < 0 || maximumAge > 120)) return [];
        if (minimumAge != null && maximumAge != null && minimumAge > maximumAge) return [];
        return [{
          key: typeof classification.key === "string" && classification.key.trim()
            ? classification.key.trim()
            : slugify(`${label}-${index + 1}`),
          label,
          gender,
          minimumAge,
          maximumAge,
        } satisfies CompetitiveRankingClassification];
      })
    : Object.keys(record).length
      ? [
          ...(sex.enabled ? sex.buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            gender: bucket.gender,
            minimumAge: null,
            maximumAge: null,
          })) : []),
          ...(age.enabled ? age.buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            gender: null,
            minimumAge: bucket.minAge,
            maximumAge: bucket.maxAge,
          })) : []),
        ]
      : defaults.classifications;

  return {
    overall: { enabled: true },
    sex,
    age,
    classifications,
    team: {
      enabled: teamRecord.enabled === undefined ? defaults.team.enabled : Boolean(teamRecord.enabled),
      mode: "club",
      label:
        typeof teamRecord.label === "string" && teamRecord.label.trim()
          ? teamRecord.label.trim()
          : defaults.team.label,
      scoringMethod: "best_three_by_place",
      scoringCount: Math.max(
        1,
        Math.round(numberOrNull(teamRecord.scoringCount as string | number | null | undefined) ?? defaults.team.scoringCount),
      ),
    },
  };
}

function ageOnRaceDay(dateOfBirth: string | null | undefined, eventDate: string | null | undefined) {
  if (!dateOfBirth || !eventDate) return null;
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  const raceDate = new Date(`${eventDate}T00:00:00`);
  if (Number.isNaN(birthDate.getTime()) || Number.isNaN(raceDate.getTime())) return null;

  let age = raceDate.getFullYear() - birthDate.getFullYear();
  const monthDelta = raceDate.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && raceDate.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function findCompetitiveAgeBucket(
  rankingConfig: CompetitiveRankingConfig,
  dateOfBirth: string | null | undefined,
  eventDate: string | null | undefined,
) {
  if (!rankingConfig.age.enabled) return null;
  const age = ageOnRaceDay(dateOfBirth, eventDate);
  if (age == null) return null;
  return (
    rankingConfig.age.buckets.find(
      (bucket) => age >= bucket.minAge && (bucket.maxAge == null || age <= bucket.maxAge),
    ) ?? null
  );
}

function findCompetitiveClassification(
  rankingConfig: CompetitiveRankingConfig,
  gender: "F" | "M" | null,
  age: number | null,
) {
  return (rankingConfig.classifications ?? []).find((classification) => {
    if (classification.gender != null && classification.gender !== gender) return false;
    if ((classification.minimumAge != null || classification.maximumAge != null) && age == null) return false;
    if (classification.minimumAge != null && (age == null || age < classification.minimumAge)) return false;
    if (classification.maximumAge != null && (age == null || age > classification.maximumAge)) return false;
    return true;
  }) ?? null;
}


function nextRaceLabel(dateLabel: string | null | undefined) {
  if (!dateLabel) return "No upcoming race yet";
  const nextRaceDate = new Date(`${dateLabel}T00:00:00`);
  const differenceMs = nextRaceDate.getTime() - Date.now();
  if (differenceMs <= 0) return "Race day is here";
  const days = Math.max(1, Math.ceil(differenceMs / 86_400_000));
  return `Your next race is in ${days} day${days === 1 ? "" : "s"}`;
}

function assignCompetitionRanks<T extends { finishTimeMs: number }>(rows: T[]) {
  let previousTime: number | null = null;
  let previousRank = 0;
  return rows.map((row, index) => {
    const rank = previousTime === row.finishTimeMs ? previousRank : index + 1;
    previousTime = row.finishTimeMs;
    previousRank = rank;
    return {
      ...row,
      rank,
    };
  });
}

export function buildCompetitiveTeamStandings(input: {
  rankingConfig: CompetitiveRankingConfig;
  rows: Array<{
    representedClubId: string | null;
    clubName: string | null;
    athleteName: string;
    rankOverall: number | null;
  }>;
}) {
  if (!input.rankingConfig.team.enabled) return [] as CompetitiveTeamStanding[];

  const scoringCount = Math.max(1, input.rankingConfig.team.scoringCount);
  const grouped = new Map<
    string,
    {
      clubName: string;
      scorers: Array<{ athleteName: string; rankOverall: number }>;
    }
  >();

  for (const row of input.rows) {
    if (!row.representedClubId || row.rankOverall == null) continue;
    const existing = grouped.get(row.representedClubId) ?? {
      clubName: row.clubName ?? "Club",
      scorers: [],
    };
    existing.scorers.push({
      athleteName: row.athleteName,
      rankOverall: row.rankOverall,
    });
    grouped.set(row.representedClubId, existing);
  }

  const standings = Array.from(grouped.entries())
    .map(([clubId, value]) => {
      const scorers = value.scorers
        .slice()
        .sort((left, right) => left.rankOverall - right.rankOverall)
        .slice(0, scoringCount);
      return {
        clubId,
        clubName: value.clubName,
        score: scorers.reduce((sum, scorer) => sum + scorer.rankOverall, 0),
        scorerCount: scorers.length,
        scorerRanks: scorers.map((scorer) => scorer.rankOverall),
        scorerNames: scorers.map((scorer) => scorer.athleteName),
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      const leftTieBreaker = left.scorerRanks[left.scorerRanks.length - 1] ?? Number.MAX_SAFE_INTEGER;
      const rightTieBreaker = right.scorerRanks[right.scorerRanks.length - 1] ?? Number.MAX_SAFE_INTEGER;
      if (leftTieBreaker !== rightTieBreaker) return leftTieBreaker - rightTieBreaker;
      return left.clubName.localeCompare(right.clubName);
    });

  return standings.map((standing, index) => ({
    ...standing,
    rank: index + 1,
  }));
}

async function loadRegistrationRowsForAthlete(
  athleteProfileId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: registrations, error } = await adminClient
    .from("registrations")
    .select(
      "id,athlete_profile_id,event_category_id,represented_club_id,status,payment_status,participation_status,result_status,created_at,confirmed_at",
    )
    .eq("athlete_profile_id", athleteProfileId)
    .is("organizer_removed_at", null)
    .order("created_at", { ascending: false })
    .returns<RegistrationRow[]>();

  if (error) throw error;
  return registrations ?? [];
}

async function loadRegistrationListForEdition(
  eventEditionId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const [
    { data: categoryRows, error: categoryError },
    { data: editionRow, error: editionError },
  ] = await Promise.all([
    adminClient
      .from("event_categories")
      .select("id,name,ranking_config_json")
      .eq("event_edition_id", eventEditionId)
      .order("distance_km", { ascending: false })
      .returns<Array<{ id: string; name: string; ranking_config_json: unknown }>>(),
    adminClient
      .from("event_editions")
      .select("start_date")
      .eq("id", eventEditionId)
      .maybeSingle<{ start_date: string }>(),
  ]);

  if (categoryError) throw categoryError;
  if (editionError) throw editionError;
  if (!categoryRows?.length) return [] as OrganizerRegistrationRecord[];

  const categoryIds = categoryRows.map((row) => row.id);
  const [
    { data: registrationRows, error: registrationError },
    { data: bibRows, error: bibError },
    { data: checkins, error: checkinsError },
  ] =
    await Promise.all([
      adminClient
        .from("registrations")
        .select(
          "id,athlete_profile_id,event_category_id,represented_club_id,status,payment_status,participation_status,created_at,confirmed_at,current_quote_id",
        )
        .in("event_category_id", categoryIds)
        .in("status", REGISTERED_RACE_STATUSES)
        .is("organizer_removed_at", null)
        .order("created_at", { ascending: false })
        .returns<RegistrationRow[]>(),
      adminClient
        .from("bib_assignments")
        .select("registration_id,bib_number")
        .eq("event_edition_id", eventEditionId)
        .is("revoked_at", null)
        .returns<Array<{ registration_id: string; bib_number: string }>>(),
      adminClient
        .from("checkins")
        .select("registration_id,checked_in_at")
        .returns<Array<{ registration_id: string; checked_in_at: string }>>(),
    ]);

  if (registrationError) throw registrationError;
  if (bibError) throw bibError;
  if (checkinsError) throw checkinsError;
  if (!registrationRows?.length) return [];

  const { data: evidenceRows, error: evidenceError } = await adminClient
    .from("registration_payment_evidence")
    .select("registration_id")
    .in("registration_id", registrationRows.map((registration) => registration.id))
    .returns<Array<{ registration_id: string }>>();

  if (evidenceError) throw evidenceError;

  const athleteIds = Array.from(new Set(registrationRows.map((row) => row.athlete_profile_id)));
  const clubIds = Array.from(
    new Set(registrationRows.map((row) => row.represented_club_id).filter((value): value is string => Boolean(value))),
  );

  const [athleteRows, clubRows] = await Promise.all([
    athleteIds.length
      ? adminClient
          .from("athlete_profiles")
          .select("id,display_name,first_name,last_name,country_code,gender,date_of_birth")
          .in("id", athleteIds)
          .returns<Array<{
            id: string;
            display_name: string;
            first_name: string | null;
            last_name: string | null;
            country_code: string | null;
            gender: string | null;
            date_of_birth: string | null;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          id: string;
          display_name: string;
          first_name: string | null;
          last_name: string | null;
          country_code: string | null;
          gender: string | null;
          date_of_birth: string | null;
        }>),
    clubIds.length
      ? adminClient
          .from("clubs")
          .select("id,name")
          .in("id", clubIds)
          .returns<Array<{ id: string; name: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  const balances = await loadRegistrationFeeBalances(registrationRows, env);

  const categoryById = new Map(categoryRows.map((row) => [row.id, row]));
  const athleteById = new Map(athleteRows.map((row) => [row.id, row]));
  const clubById = new Map(clubRows.map((row) => [row.id, row.name]));
  const bibByRegistrationId = new Map((bibRows ?? []).map((row) => [row.registration_id, row.bib_number]));
  const checkInByRegistrationId = new Map((checkins ?? []).map((row) => [row.registration_id, row.checked_in_at]));
  const paymentEvidenceCountByRegistrationId = new Map<string, number>();
  for (const evidence of evidenceRows ?? []) {
    paymentEvidenceCountByRegistrationId.set(
      evidence.registration_id,
      (paymentEvidenceCountByRegistrationId.get(evidence.registration_id) ?? 0) + 1,
    );
  }

  return registrationRows.map((row) => {
    const athlete = athleteById.get(row.athlete_profile_id);
    const category = categoryById.get(row.event_category_id);
    const athleteName = athlete?.display_name?.trim() || "Unknown athlete";
    const athleteNameParts = athleteName.split(/\s+/).filter(Boolean);
    const rankingConfig = normalizeCompetitiveRankingConfig(category?.ranking_config_json);
    const gender = normalizeRankingGender(athlete?.gender);
    const age = ageOnRaceDay(athlete?.date_of_birth, editionRow?.start_date);
    return {
      id: row.id,
      eventEditionId,
      eventCategoryId: row.event_category_id,
      athleteProfileId: row.athlete_profile_id,
      athleteName,
      athleteFirstName: athlete?.first_name?.trim() || athleteNameParts[0] || "Unknown athlete",
      athleteLastName: athlete?.last_name?.trim() || athleteNameParts.slice(1).join(" "),
      categoryName: category?.name ?? "Category",
      clubName: row.represented_club_id ? clubById.get(row.represented_club_id) ?? null : null,
      countryCode: athlete?.country_code?.trim().toUpperCase() || null,
      gender,
      dateOfBirth: athlete?.date_of_birth ?? null,
      ageOnRaceDay: age,
      sexCategory: rankingConfig.sex.enabled
        ? rankingConfig.sex.buckets.find((bucket) => bucket.gender === gender)?.label ?? null
        : null,
      ageCategory: findCompetitiveAgeBucket(
        rankingConfig,
        athlete?.date_of_birth,
        editionRow?.start_date,
      )?.label ?? null,
      classificationName: findCompetitiveClassification(rankingConfig, gender, age)?.label ?? null,
      status: row.status,
      paymentStatus: row.payment_status,
      ...balances.get(row.id),
      participationStatus: row.participation_status,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      bibNumber: bibByRegistrationId.get(row.id) ?? null,
      checkedInAt: checkInByRegistrationId.get(row.id) ?? null,
      paymentEvidenceCount: paymentEvidenceCountByRegistrationId.get(row.id) ?? 0,
    };
  });
}

async function setRegistrationBibNumber(
  registrationId: string,
  eventEditionId: string,
  eventCategoryId: string,
  bibNumber: string | null | undefined,
  userId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const trimmed = bibNumber?.trim() ?? "";
  const { data: registration, error: registrationError } = await adminClient
    .from("registrations")
    .select("status,payment_status,confirmed_at,participation_status")
    .eq("id", registrationId)
    .maybeSingle<{
      status: string;
      payment_status: string;
      confirmed_at: string | null;
      participation_status: string;
    }>();

  if (registrationError) throw registrationError;
  if (!registration) throw notFound("Registration not found");
  const { data: existing, error: existingError } = await adminClient
    .from("bib_assignments")
    .select("id,bib_number")
    .eq("registration_id", registrationId)
    .is("revoked_at", null)
    .maybeSingle<{ id: string; bib_number: string }>();

  if (existingError) throw existingError;

  const { data: operationalControl, error: operationalControlError } = await adminClient
    .from("edition_operational_controls")
    .select("start_list_state")
    .eq("event_edition_id", eventEditionId)
    .maybeSingle<{ start_list_state: string }>();
  if (operationalControlError) throw operationalControlError;
  if (operationalControl?.start_list_state === "frozen") {
    throw conflict("Reopen the start list before changing bib assignments");
  }

  if (trimmed) {
    if (registration.status !== "pending" && registration.status !== "confirmed") {
      throw conflict("Only active pending or confirmed runners can receive a bib");
    }
    const { data: conflictBib, error: conflictError } = await adminClient
      .from("bib_assignments")
      .select("id")
      .eq("event_edition_id", eventEditionId)
      .eq("bib_number", trimmed)
      .is("revoked_at", null)
      .neq("registration_id", registrationId)
      .maybeSingle<{ id: string }>();

    if (conflictError) throw conflictError;
    if (conflictBib) {
      throw conflict(`Bib ${trimmed} is already assigned for this edition`);
    }

    if (existing) {
      const { error } = await adminClient
        .from("bib_assignments")
        .update({
          bib_number: trimmed,
          assigned_by_user_id: userId,
          assigned_at: new Date().toISOString(),
          revoked_at: null,
        })
        .eq("id", existing.id);

      if (error) throw error;
    } else {
      const { error } = await adminClient.from("bib_assignments").insert({
        registration_id: registrationId,
        event_edition_id: eventEditionId,
        event_category_id: eventCategoryId,
        bib_number: trimmed,
        assigned_by_user_id: userId,
      });

      if (error) throw error;
    }

    return trimmed;
  }

  if (existing) {
    const { error } = await adminClient
      .from("bib_assignments")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (error) throw error;
  }

  return null;
}

async function loadCheckpointsByCategoryIds(
  categoryIds: string[],
  env: ServerEnv,
) {
  if (!categoryIds.length) return [] as CheckpointRow[];
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("checkpoints")
    .select("id,event_category_id,code,name,checkpoint_type,sequence_number,distance_from_start_km,cutoff_at,is_mandatory,settings_json")
    .in("event_category_id", categoryIds)
    .order("sequence_number", { ascending: true })
    .returns<CheckpointRow[]>();

  if (error) throw error;
  return data ?? [];
}

type OrganizerEventEditionExtraRow = {
  id: string;
  activity_type: string | null;
  is_practice: boolean;
  is_recurrence_generated: boolean;
  recurrence_rule_id: string | null;
  recurrence_source_event_edition_id: string | null;
  recurrence_source_date: string | null;
  public_visibility: string | null;
  registration_access: string | null;
  cover_image_url: string | null;
  about_text: string | null;
  organizer_rules: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  general_timeline_json: unknown;
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

async function loadOrganizerEventLocations(
  editionIds: string[],
  env: ServerEnv,
) {
  if (!editionIds.length) return [] as OrganizerEventLocationRow[];
  const adminClient = createAdminSupabaseClient(env);

  try {
    const { data, error } = await adminClient
      .from("event_locations")
      .select("id,event_edition_id,location_type,label,description,place_label,latitude,longitude,display_order")
      .in("event_edition_id", editionIds)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true })
      .returns<OrganizerEventLocationRow[]>();

    if (error) throw error;
    return data ?? [];
  } catch (error) {
    if (isSchemaCompatError(error)) return [];
    throw error;
  }
}

type OrganizerEventDetailEditionRow = OrganizerEventEditionExtraRow & {
  id: string;
  event_series_id: string;
  slug: string;
  name: string;
  created_at: string;
  start_date: string;
  end_date: string | null;
  timezone: string;
  location_name: string | null;
  registration_open_at: string | null;
  registration_close_at: string | null;
  status: string;
  published_at: string | null;
};

type OrganizerEventDetailCategoryRow = {
  id: string;
  event_edition_id: string;
  slug: string;
  name: string;
  cover_image_url: string | null;
  sport_code: SportCode;
  course_format: string;
  lap_count: number;
  distance_km: string | number | null;
  elevation_gain_m: number | null;
  capacity: number | null;
  registration_fee_cents: number | null;
  registration_fee_periods?: RaceFeePeriod[];
  currency: string | null;
  minimum_age: number | null;
  maximum_age: number | null;
  allowed_genders: Array<"F" | "M" | "U">;
  eligibility_note: string | null;
  start_at: string | null;
  parking_label: string | null;
  organizer_notes: string | null;
  display_order: number | null;
  results_mode: string;
  status: string;
  ranking_config_json: unknown;
};

type OrganizerEventDetailBundle = {
  edition: OrganizerEventDetailEditionRow;
  series: {
    id: string;
    organization_id: string;
    slug: string;
    name: string;
    description: string | null;
    location_name: string | null;
  };
  organization: { id: string; name: string } | null;
  eligible_clubs: Array<{ event_edition_id: string; club_id: string }>;
  categories: OrganizerEventDetailCategoryRow[];
  league_rounds: Array<{
    id: string;
    league_season_id: string;
    event_edition_id: string;
    event_category_id: string;
    round_number: number;
    status: string;
  }>;
  sports: Array<StoredSportAssignment & { event_edition_id: string }>;
  locations: OrganizerEventLocationRow[];
  registration_counts: OrganizerRegistrationCountRow[];
  snapshots: Array<{
    event_category_id: string;
    track_template_id: string | null;
    track_version_id: string | null;
  }>;
  checkpoints: CheckpointRow[];
  publications: Array<{
    event_category_id: string;
    publication_state: "provisional" | "official" | "corrected";
    published_at: string;
  }>;
  league_seasons: Array<{
    id: string;
    league_id: string;
    year: number;
    name: string;
    status: string;
    published_at: string | null;
  }>;
  leagues: Array<{ id: string; name: string }>;
};

function mapOrganizerEventDetailBundle(
  bundle: OrganizerEventDetailBundle,
): OrganizerManagedEvent {
  const edition = bundle.edition;
  const series = bundle.series;
  const registrationCountByCategory = new Map(
    (bundle.registration_counts ?? []).map((row) => [
      row.event_category_id,
      Math.max(0, Number(row.registered_count) || 0),
    ]),
  );
  const snapshotByCategory = new Map(
    (bundle.snapshots ?? []).map((row) => [row.event_category_id, row]),
  );
  const latestPublicationByCategory = new Map(
    (bundle.publications ?? []).map((row) => [
      row.event_category_id,
      row.publication_state,
    ]),
  );
  const checkpointsByCategory = new Map<string, OrganizerManagedCheckpoint[]>();
  for (const checkpoint of bundle.checkpoints ?? []) {
    const existing = checkpointsByCategory.get(checkpoint.event_category_id) ?? [];
    existing.push({
      id: checkpoint.id,
      code: checkpoint.code,
      name: checkpoint.name,
      checkpointType: checkpoint.checkpoint_type,
      sequenceNumber: checkpoint.sequence_number,
      distanceFromStartKm: numberOrNull(checkpoint.distance_from_start_km),
      cutoffAt: checkpoint.cutoff_at,
      isMandatory: checkpoint.is_mandatory,
      settings: normalizeCheckpointSettings(
        checkpoint.settings_json,
        checkpoint.checkpoint_type,
      ),
    });
    checkpointsByCategory.set(checkpoint.event_category_id, existing);
  }

  const categories = (bundle.categories ?? []).map((category) => {
    const snapshot = snapshotByCategory.get(category.id);
    const courseFormat = normalizeCourseFormat(category.course_format);
    return {
      id: category.id,
      slug: category.slug,
      name: category.name,
      coverImageUrl: optionalText(category.cover_image_url),
      sportCode: category.sport_code ?? DEFAULT_SPORT_CODE,
      categoryType: mapCategoryType(category.results_mode),
      courseFormat,
      lapCount: normalizeLapCount(courseFormat, category.lap_count),
      rankingConfig: normalizeCompetitiveRankingConfig(category.ranking_config_json),
      distanceKm: numberOrNull(category.distance_km),
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
      latestPublicationState: latestPublicationByCategory.get(category.id) ?? null,
      registrationCount: registrationCountByCategory.get(category.id) ?? 0,
      trackTemplateId: snapshot?.track_template_id ?? null,
      trackVersionId: snapshot?.track_version_id ?? null,
      checkpoints: checkpointsByCategory.get(category.id) ?? [],
    } satisfies OrganizerManagedCategory;
  });

  const rounds = bundle.league_rounds ?? [];
  const firstRound = rounds
    .slice()
    .sort((left, right) => left.round_number - right.round_number)[0];
  const season = firstRound
    ? (bundle.league_seasons ?? []).find(
        (row) => row.id === firstRound.league_season_id,
      ) ?? null
    : null;
  const league = season
    ? (bundle.leagues ?? []).find((row) => row.id === season.league_id) ?? null
    : null;
  const publicVisibility = normalizeEventVisibility(
    edition.public_visibility ?? (edition.published_at ? "public" : "private"),
  );
  const sportSelection = mapStoredSportSelection(bundle.sports);
  const totalRegistrations = categories.reduce(
    (sum, category) => sum + category.registrationCount,
    0,
  );
  const totalCapacity = categories.reduce(
    (sum, category) => sum + (category.capacity ?? 0),
    0,
  );

  return {
    id: edition.id,
    slug: edition.slug,
    seriesId: edition.event_series_id,
    seriesSlug: series.slug ?? edition.slug,
    organizationId: series.organization_id,
    organizationName: bundle.organization?.name ?? null,
    sportCodes: sportSelection.sportCodes,
    primarySportCode: sportSelection.primarySportCode,
    activityType: normalizeEventActivityType(edition.activity_type),
    name: edition.name,
    createdAt: edition.created_at,
    startDate: edition.start_date,
    endDate: edition.end_date ?? null,
    timezone: edition.timezone,
    registrationOpenAt: edition.registration_open_at,
    registrationCloseAt: edition.registration_close_at,
    locationName: edition.location_name ?? series.location_name ?? null,
    description: series.description ?? null,
    aboutText: optionalText(edition.about_text),
    organizerRules: optionalText(edition.organizer_rules),
    status: edition.status,
    isPractice: edition.is_practice ?? false,
    isRecurrenceGenerated: edition.is_recurrence_generated ?? false,
    recurrenceRuleId: edition.recurrence_rule_id ?? null,
    recurrenceSourceEventEditionId:
      edition.recurrence_source_event_edition_id ?? null,
    recurrenceSourceDate: edition.recurrence_source_date ?? null,
    publishedAt: edition.published_at ?? null,
    isPublic: Boolean(
      edition.published_at
      && edition.status !== "draft"
      && publicVisibility === "public"
    ),
    publicVisibility,
    registrationAccess:
      edition.registration_access === "club_members" ? "club_members" : "open",
    eligibleClubIds: (bundle.eligible_clubs ?? []).map((row) => row.club_id),
    coverImageUrl: optionalText(edition.cover_image_url),
    websiteUrl: optionalText(edition.website_url),
    instagramUrl: optionalText(edition.instagram_url),
    facebookUrl: optionalText(edition.facebook_url),
    generalTimeline: normalizeOrganizerEventTimeline(edition.general_timeline_json),
    locations: (bundle.locations ?? []).map((location, index) => ({
      id: location.id,
      type: location.location_type,
      label: location.label,
      description: location.description ?? null,
      place: location.place_label ?? null,
      lat: numberOrNull(location.latitude),
      lng: numberOrNull(location.longitude),
      displayOrder: location.display_order ?? index,
    })),
    categories,
    totalRegistrations,
    totalCapacity,
    leagueSeasonId: season?.id ?? null,
    leagueName: league?.name ?? null,
    roundNumber: firstRound?.round_number ?? null,
    totalRounds: season
      ? rounds.filter((round) => round.league_season_id === season.id).length
      : null,
  };
}

async function loadOrganizerManagedEventBundle(
  organizationIds: string[],
  assignedEventIds: string[],
  eventRef: string,
  env: ServerEnv,
): Promise<OrganizerManagedEvent | null | undefined> {
  const adminClient = createAdminSupabaseClient(env);
  const isId = isPostgresUuidReference(eventRef);
  const { data, error } = await adminClient.rpc(
    "service_organizer_event_detail_bundle",
    {
      target_event_id: isId ? eventRef : null,
      target_event_slug: isId ? null : eventRef,
      target_organization_ids: organizationIds,
      target_assigned_event_ids: assignedEventIds,
    },
  );
  if (error) {
    if (error.code === "PGRST202") return undefined;
    throw error;
  }
  if (!data) return null;
  const [event] = await withRaceFinishEvidence([
    mapOrganizerEventDetailBundle(data as OrganizerEventDetailBundle),
  ], env);
  return event;
}

async function replaceOrganizerEventLocations(
  eventEditionId: string,
  locations: OrganizerEventLocationInput[] | undefined,
  env: ServerEnv,
) {
  if (locations === undefined) return;
  const adminClient = createAdminSupabaseClient(env);

  try {
    const { error: deleteError } = await adminClient
      .from("event_locations")
      .delete()
      .eq("event_edition_id", eventEditionId);

    if (deleteError) throw deleteError;

    const normalizedLocations = locations
      .map((location, index) => ({
        event_edition_id: eventEditionId,
        location_type: location.type,
        label: location.label.trim(),
        description: optionalText(location.description),
        place_label: optionalText(location.place),
        latitude: location.lat ?? null,
        longitude: location.lng ?? null,
        display_order: index,
      }))
      .filter((location) => location.label.length > 0);

    if (!normalizedLocations.length) return;

    const { error: insertError } = await adminClient
      .from("event_locations")
      .insert(normalizedLocations);

    if (insertError) throw insertError;
  } catch (error) {
    if (isSchemaCompatError(error)) return;
    throw error;
  }
}

async function loadOrganizerManagedEvents(
  organizationIds: string[],
  env: ServerEnv,
  eventRef?: string,
) {
  const adminClient = createAdminSupabaseClient(env);
  if (!organizationIds.length) return [] as OrganizerManagedEvent[];

  const { data: seriesRows, error: seriesError } = await adminClient
    .from("event_series")
    .select("id,organization_id,slug,name,description,location_name")
    .in("organization_id", organizationIds)
    .order("created_at", { ascending: false })
    .returns<Array<{ id: string; organization_id: string; slug: string; name: string; description: string | null; location_name: string | null }>>();

  if (seriesError) throw seriesError;
  if (!seriesRows?.length) return [];

  const seriesIds = seriesRows.map((row) => row.id);
  const editionQuery = adminClient
    .from("event_editions")
    .select("id,event_series_id,slug,name,created_at,start_date,end_date,timezone,location_name,registration_open_at,registration_close_at,status,published_at,activity_type,is_practice,is_recurrence_generated,recurrence_rule_id,recurrence_source_event_edition_id,recurrence_source_date,public_visibility,registration_access,cover_image_url,about_text,organizer_rules,website_url,instagram_url,facebook_url,general_timeline_json")
    .in("event_series_id", seriesIds)
    .is("organizer_deleted_at", null);
  const scopedEditionQuery = eventRef
    ? (
        isPostgresUuidReference(eventRef)
          ? editionQuery.eq("id", eventRef)
          : editionQuery.eq("slug", eventRef)
      )
    : editionQuery;
  const [
    { data: organizationRows, error: organizationError },
    { data: loadedEditionRows, error: editionError },
  ] = await Promise.all([
    adminClient
      .from("organizations")
      .select("id,name")
      .in("id", Array.from(new Set(seriesRows.map((row) => row.organization_id))))
      .returns<Array<{ id: string; name: string }>>(),
    scopedEditionQuery
      .order("start_date", { ascending: false })
      .returns<Array<{
        id: string;
        event_series_id: string;
        slug: string;
        name: string;
        created_at: string;
        start_date: string;
        end_date: string | null;
        timezone: string;
        location_name: string | null;
        registration_open_at: string | null;
        registration_close_at: string | null;
        status: string;
        published_at: string | null;
      } & OrganizerEventEditionExtraRow>>(),
  ]);
  if (organizationError) throw organizationError;
  if (editionError) throw editionError;
  if (!loadedEditionRows?.length) return [];

  const generatedEditionIds = loadedEditionRows
    .filter((edition) => edition.is_recurrence_generated)
    .map((edition) => edition.id);
  const materializedGeneratedEditionIds = generatedEditionIds.length
    ? await adminClient
        .from("league_recurrence_occurrences")
        .select("event_edition_id")
        .in("event_edition_id", generatedEditionIds)
        .eq("state", "materialized")
        .returns<Array<{ event_edition_id: string }>>()
        .then(({ data, error }) => {
          if (error) throw error;
          return new Set((data ?? []).map((row) => row.event_edition_id));
        })
    : new Set<string>();
  const editionRows = loadedEditionRows.filter((edition) => (
    !edition.is_recurrence_generated
    || materializedGeneratedEditionIds.has(edition.id)
  ));
  if (!editionRows.length) return [];

  const editionIds = editionRows.map((row) => row.id);
  const [
    { data: eligibleClubRows, error: eligibleClubError },
    { data: categoryRows, error: categoryError },
    { data: roundRows, error: roundError },
    { data: eventSportRows, error: eventSportError },
    locationRows,
  ] = await Promise.all([
    adminClient
      .from("event_eligible_clubs")
      .select("event_edition_id,club_id")
      .in("event_edition_id", editionIds)
      .returns<Array<{ event_edition_id: string; club_id: string }>>(),
    adminClient
      .from("event_categories")
      .select("id,event_edition_id,slug,name,cover_image_url,sport_code,course_format,lap_count,distance_km,elevation_gain_m,capacity,registration_fee_cents,registration_fee_periods,currency,minimum_age,maximum_age,allowed_genders,eligibility_note,start_at,parking_label,organizer_notes,display_order,results_mode,status,ranking_config_json")
      .in("event_edition_id", editionIds)
      .is("organizer_deleted_at", null)
      .order("display_order", { ascending: true })
      .order("distance_km", { ascending: false })
      .returns<Array<{
        id: string;
        event_edition_id: string;
        slug: string;
        name: string;
        cover_image_url: string | null;
        sport_code: SportCode;
        course_format: string;
        lap_count: number;
        distance_km: string | number | null;
        elevation_gain_m: number | null;
        capacity: number | null;
        registration_fee_cents: number | null;
        registration_fee_periods?: RaceFeePeriod[];
        currency: string | null;
        minimum_age: number | null;
        maximum_age: number | null;
        allowed_genders: Array<"F" | "M" | "U">;
        eligibility_note: string | null;
        start_at: string | null;
        parking_label: string | null;
        organizer_notes: string | null;
        display_order: number | null;
        results_mode: string;
        status: string;
        ranking_config_json: unknown;
      }>>(),
    adminClient
      .from("league_rounds")
      .select("id,league_season_id,event_edition_id,event_category_id,round_number,status")
      .in("event_edition_id", editionIds)
      .returns<Array<{
        id: string;
        league_season_id: string;
        event_edition_id: string;
        event_category_id: string;
        round_number: number;
        status: string;
      }>>(),
    adminClient
      .from("event_edition_sports")
      .select("event_edition_id,sport_code,is_primary")
      .in("event_edition_id", editionIds)
      .returns<Array<StoredSportAssignment & { event_edition_id: string }>>(),
    loadOrganizerEventLocations(editionIds, env),
  ]);

  if (eligibleClubError) throw eligibleClubError;
  if (categoryError) throw categoryError;
  if (roundError) throw roundError;
  if (eventSportError) throw eventSportError;

  const categories = categoryRows ?? [];
  const categoryIds = categories.map((row) => row.id);

  const [registrationCountByCategory, snapshotRows, checkpointRows, publicationRows] = await Promise.all([
    loadOrganizerRegistrationCounts(adminClient, categoryIds),
    categoryIds.length
      ? adminClient
          .from("event_category_track_snapshots")
          .select("event_category_id,track_template_id,track_version_id")
          .in("event_category_id", categoryIds)
          .returns<Array<{ event_category_id: string; track_template_id: string | null; track_version_id: string | null }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ event_category_id: string; track_template_id: string | null; track_version_id: string | null }>),
    loadCheckpointsByCategoryIds(categoryIds, env),
    categoryIds.length
      ? adminClient
          .from("result_publications")
          .select("event_category_id,publication_state,published_at")
          .in("event_category_id", categoryIds)
          .order("published_at", { ascending: false })
          .returns<Array<{
            event_category_id: string;
            publication_state: "provisional" | "official" | "corrected";
            published_at: string;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          event_category_id: string;
          publication_state: "provisional" | "official" | "corrected";
          published_at: string;
        }>),
  ]);

  const seasonIds = Array.from(new Set((roundRows ?? []).map((row) => row.league_season_id)));
  const seasonRows = seasonIds.length
    ? await adminClient
        .from("league_seasons")
        .select("id,league_id,year,name,status,published_at")
        .in("id", seasonIds)
        .returns<Array<{ id: string; league_id: string; year: number; name: string; status: string; published_at: string | null }>>()
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        })
    : [];
  const leagueIds = Array.from(new Set(seasonRows.map((row) => row.league_id)));
  const leagueRows = leagueIds.length
    ? await adminClient
        .from("leagues")
        .select("id,name")
        .in("id", leagueIds)
        .returns<Array<{ id: string; name: string }>>()
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        })
    : [];

  const snapshotByCategory = new Map(snapshotRows.map((row) => [row.event_category_id, row]));
  const latestPublicationByCategory = new Map<
    string,
    "provisional" | "official" | "corrected"
  >();
  for (const publication of publicationRows) {
    if (!latestPublicationByCategory.has(publication.event_category_id)) {
      latestPublicationByCategory.set(
        publication.event_category_id,
        publication.publication_state,
      );
    }
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
      distanceFromStartKm: numberOrNull(checkpoint.distance_from_start_km),
      cutoffAt: checkpoint.cutoff_at,
      isMandatory: checkpoint.is_mandatory,
      settings: normalizeCheckpointSettings(checkpoint.settings_json, checkpoint.checkpoint_type),
    });
    checkpointsByCategory.set(checkpoint.event_category_id, existing);
  }
  const seriesById = new Map(seriesRows.map((row) => [row.id, row]));
  const organizationById = new Map((organizationRows ?? []).map((row) => [row.id, row]));
  const editionExtrasById = new Map(editionRows.map((row) => [row.id, row]));
  const eligibleClubIdsByEditionId = new Map<string, string[]>();
  for (const eligibleClub of eligibleClubRows ?? []) {
    const existing = eligibleClubIdsByEditionId.get(eligibleClub.event_edition_id) ?? [];
    existing.push(eligibleClub.club_id);
    eligibleClubIdsByEditionId.set(eligibleClub.event_edition_id, existing);
  }
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
  const seasonById = new Map(seasonRows.map((row) => [row.id, row]));
  const leagueById = new Map(leagueRows.map((row) => [row.id, row]));
  const roundsBySeason = new Map<string, number>();
  const roundsByEdition = new Map<string, Array<{ league_season_id: string; round_number: number }>>();

  for (const round of roundRows ?? []) {
    roundsBySeason.set(round.league_season_id, (roundsBySeason.get(round.league_season_id) ?? 0) + 1);
    const existing = roundsByEdition.get(round.event_edition_id) ?? [];
    existing.push({
      league_season_id: round.league_season_id,
      round_number: round.round_number,
    });
    roundsByEdition.set(round.event_edition_id, existing);
  }

  const categoriesByEditionId = new Map<string, OrganizerManagedCategory[]>();
  for (const category of categories) {
    const snapshot = snapshotByCategory.get(category.id);
    const courseFormat = normalizeCourseFormat(category.course_format);
    const mapped: OrganizerManagedCategory = {
      id: category.id,
      slug: category.slug,
      name: category.name,
      coverImageUrl: optionalText(category.cover_image_url),
      sportCode: category.sport_code ?? DEFAULT_SPORT_CODE,
      categoryType: mapCategoryType(category.results_mode),
      courseFormat,
      lapCount: normalizeLapCount(courseFormat, category.lap_count),
      rankingConfig: normalizeCompetitiveRankingConfig(category.ranking_config_json),
      distanceKm: numberOrNull(category.distance_km),
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
      latestPublicationState: latestPublicationByCategory.get(category.id) ?? null,
      registrationCount: registrationCountByCategory.get(category.id) ?? 0,
      trackTemplateId: snapshot?.track_template_id ?? null,
      trackVersionId: snapshot?.track_version_id ?? null,
      checkpoints: checkpointsByCategory.get(category.id) ?? [],
    };
    const existing = categoriesByEditionId.get(category.event_edition_id) ?? [];
    existing.push(mapped);
    categoriesByEditionId.set(category.event_edition_id, existing);
  }

  const sportsByEditionId = new Map<string, StoredSportAssignment[]>();
  for (const assignment of eventSportRows ?? []) {
    const existing = sportsByEditionId.get(assignment.event_edition_id) ?? [];
    existing.push(assignment);
    sportsByEditionId.set(assignment.event_edition_id, existing);
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
    const totalRegistrations = mappedCategories.reduce((sum, category) => sum + category.registrationCount, 0);
    const totalCapacity = mappedCategories.reduce((sum, category) => sum + (category.capacity ?? 0), 0);
    const firstRound = (roundsByEdition.get(edition.id) ?? [])
      .slice()
      .sort((left, right) => left.round_number - right.round_number)[0];
    const season = firstRound ? seasonById.get(firstRound.league_season_id) : null;
    const league = season ? leagueById.get(season.league_id) : null;
    const sportSelection = mapStoredSportSelection(sportsByEditionId.get(edition.id));

    return {
      id: edition.id,
      slug: edition.slug,
      seriesId: edition.event_series_id,
      seriesSlug: series?.slug ?? edition.slug,
      organizationId: series?.organization_id ?? "",
      organizationName: series ? organizationById.get(series.organization_id)?.name ?? null : null,
      sportCodes: sportSelection.sportCodes,
      primarySportCode: sportSelection.primarySportCode,
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
      isRecurrenceGenerated: editionExtra?.is_recurrence_generated ?? false,
      recurrenceRuleId: editionExtra?.recurrence_rule_id ?? null,
      recurrenceSourceEventEditionId:
        editionExtra?.recurrence_source_event_edition_id ?? null,
      recurrenceSourceDate: editionExtra?.recurrence_source_date ?? null,
      publishedAt: edition.published_at ?? null,
      isPublic: Boolean(
        edition.published_at &&
        edition.status !== "draft" &&
        publicVisibility === "public",
      ),
      publicVisibility,
      registrationAccess:
        editionExtra?.registration_access === "club_members" ? "club_members" : "open",
      eligibleClubIds: eligibleClubIdsByEditionId.get(edition.id) ?? [],
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

async function loadOrganizerManagedEventSummaries(
  organizationIds: string[],
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  if (!organizationIds.length) return [] as OrganizerManagedEventSummary[];

  const { data: seriesRows, error: seriesError } = await adminClient
    .from("event_series")
    .select("id,organization_id,location_name")
    .in("organization_id", organizationIds)
    .returns<Array<{
      id: string;
      organization_id: string;
      location_name: string | null;
    }>>();
  if (seriesError) throw seriesError;
  if (!seriesRows?.length) return [];

  const organizationIdsInUse = Array.from(new Set(seriesRows.map((row) => row.organization_id)));
  const [{ data: organizationRows, error: organizationError }, { data: loadedEditionRows, error: editionError }] = await Promise.all([
    adminClient
      .from("organizations")
      .select("id,name")
      .in("id", organizationIdsInUse)
      .returns<Array<{ id: string; name: string }>>(),
    adminClient
      .from("event_editions")
      .select("id,event_series_id,slug,name,start_date,end_date,location_name,status,published_at,activity_type,is_practice,is_recurrence_generated,public_visibility,cover_image_url")
      .in("event_series_id", seriesRows.map((row) => row.id))
      .is("organizer_deleted_at", null)
      .order("start_date", { ascending: false })
      .returns<Array<{
        id: string;
        event_series_id: string;
        slug: string;
        name: string;
        start_date: string;
        end_date: string | null;
        location_name: string | null;
        status: string;
        published_at: string | null;
        activity_type: string | null;
        is_practice: boolean | null;
        is_recurrence_generated: boolean | null;
        public_visibility: string | null;
        cover_image_url: string | null;
      }>>(),
  ]);
  if (organizationError) throw organizationError;
  if (editionError) throw editionError;
  if (!loadedEditionRows?.length) return [];

  const generatedEditionIds = loadedEditionRows
    .filter((edition) => edition.is_recurrence_generated)
    .map((edition) => edition.id);
  const materializedGeneratedEditionIds = generatedEditionIds.length
    ? await adminClient
        .from("league_recurrence_occurrences")
        .select("event_edition_id")
        .in("event_edition_id", generatedEditionIds)
        .eq("state", "materialized")
        .returns<Array<{ event_edition_id: string }>>()
        .then(({ data, error }) => {
          if (error) throw error;
          return new Set((data ?? []).map((row) => row.event_edition_id));
        })
    : new Set<string>();
  const editionRows = loadedEditionRows.filter((edition) => (
    !edition.is_recurrence_generated
    || materializedGeneratedEditionIds.has(edition.id)
  ));
  if (!editionRows.length) return [];

  const editionIds = editionRows.map((row) => row.id);
  const [
    { data: categoryRows, error: categoryError },
    { data: roundRows, error: roundError },
    { data: eventSportRows, error: eventSportError },
  ] = await Promise.all([
    adminClient
      .from("event_categories")
      .select("id,event_edition_id,capacity,results_mode")
      .in("event_edition_id", editionIds)
      .is("organizer_deleted_at", null)
      .returns<Array<{
        id: string;
        event_edition_id: string;
        capacity: number | null;
        results_mode: string;
      }>>(),
    adminClient
      .from("league_rounds")
      .select("league_season_id,event_edition_id,round_number")
      .in("event_edition_id", editionIds)
      .returns<Array<{
        league_season_id: string;
        event_edition_id: string;
        round_number: number;
      }>>(),
    adminClient
      .from("event_edition_sports")
      .select("event_edition_id,sport_code,is_primary")
      .in("event_edition_id", editionIds)
      .returns<Array<StoredSportAssignment & { event_edition_id: string }>>(),
  ]);
  if (categoryError) throw categoryError;
  if (roundError) throw roundError;
  if (eventSportError) throw eventSportError;

  const categories = categoryRows ?? [];
  const categoryIds = categories.map((category) => category.id);
  const registrationCountByCategoryPromise = loadOrganizerRegistrationCounts(
    adminClient,
    categoryIds,
  );

  const seasonIds = Array.from(new Set((roundRows ?? []).map((row) => row.league_season_id)));
  const seasonRows = seasonIds.length
    ? await adminClient
        .from("league_seasons")
        .select("id,league_id")
        .in("id", seasonIds)
        .returns<Array<{ id: string; league_id: string }>>()
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        })
    : [];
  const leagueIds = Array.from(new Set(seasonRows.map((row) => row.league_id)));
  const leagueRows = leagueIds.length
    ? await adminClient
        .from("leagues")
        .select("id,name")
        .in("id", leagueIds)
        .returns<Array<{ id: string; name: string }>>()
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        })
    : [];

  const registrationCountByCategory = await registrationCountByCategoryPromise;

  const categoryStatsByEdition = new Map<string, {
    competitiveRaceCount: number;
    totalCapacity: number;
    totalRegistrations: number;
  }>();
  for (const category of categories) {
    const stats = categoryStatsByEdition.get(category.event_edition_id) ?? {
      competitiveRaceCount: 0,
      totalCapacity: 0,
      totalRegistrations: 0,
    };
    stats.competitiveRaceCount += mapCategoryType(category.results_mode) === "competitive" ? 1 : 0;
    stats.totalCapacity += category.capacity ?? 0;
    stats.totalRegistrations += registrationCountByCategory.get(category.id) ?? 0;
    categoryStatsByEdition.set(category.event_edition_id, stats);
  }

  const seriesById = new Map(seriesRows.map((row) => [row.id, row]));
  const organizationById = new Map((organizationRows ?? []).map((row) => [row.id, row]));
  const seasonById = new Map(seasonRows.map((row) => [row.id, row]));
  const leagueById = new Map(leagueRows.map((row) => [row.id, row]));
  const roundsByEdition = new Map<string, Array<{ league_season_id: string; round_number: number }>>();
  for (const round of roundRows ?? []) {
    const existing = roundsByEdition.get(round.event_edition_id) ?? [];
    existing.push(round);
    roundsByEdition.set(round.event_edition_id, existing);
  }
  const sportsByEditionId = new Map<string, StoredSportAssignment[]>();
  for (const assignment of eventSportRows ?? []) {
    const existing = sportsByEditionId.get(assignment.event_edition_id) ?? [];
    existing.push(assignment);
    sportsByEditionId.set(assignment.event_edition_id, existing);
  }

  return editionRows.map((edition) => {
    const series = seriesById.get(edition.event_series_id);
    const publicVisibility = normalizeEventVisibility(
      edition.public_visibility ?? (edition.published_at ? "public" : "private"),
    );
    const firstRound = (roundsByEdition.get(edition.id) ?? [])
      .slice()
      .sort((left, right) => left.round_number - right.round_number)[0];
    const season = firstRound ? seasonById.get(firstRound.league_season_id) : null;
    const league = season ? leagueById.get(season.league_id) : null;
    const sportSelection = mapStoredSportSelection(sportsByEditionId.get(edition.id));
    const categoryStats = categoryStatsByEdition.get(edition.id) ?? {
      competitiveRaceCount: 0,
      totalCapacity: 0,
      totalRegistrations: 0,
    };

    return {
      id: edition.id,
      slug: edition.slug,
      organizationName: series
        ? organizationById.get(series.organization_id)?.name ?? null
        : null,
      sportCodes: sportSelection.sportCodes,
      primarySportCode: sportSelection.primarySportCode,
      activityType: normalizeEventActivityType(edition.activity_type),
      name: edition.name,
      startDate: edition.start_date,
      endDate: edition.end_date,
      locationName: edition.location_name ?? series?.location_name ?? null,
      status: edition.status,
      isPractice: edition.is_practice ?? false,
      publishedAt: edition.published_at,
      isPublic: Boolean(
        edition.published_at
        && edition.status !== "draft"
        && publicVisibility === "public"
      ),
      coverImageUrl: optionalText(edition.cover_image_url),
      ...categoryStats,
      leagueSeasonId: season?.id ?? null,
      leagueName: league?.name ?? null,
      roundNumber: firstRound?.round_number ?? null,
    } satisfies OrganizerManagedEventSummary;
  });
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

const TRACK_GPX_BUCKET = "track-gpx";
const TRACK_MEDIA_BUCKET = "track-media";
const MAX_TRACK_GPX_BYTES = 50 * 1024 * 1024;

function requireOrganizationStoragePath(
  storagePath: string,
  organizationId: string,
  folder: "gallery" | "gpx",
) {
  const expectedPrefix = `${organizationId}/${folder}/`;
  const objectName = storagePath.slice(expectedPrefix.length);
  if (
    !storagePath.startsWith(expectedPrefix) ||
    !objectName ||
    objectName.includes("..") ||
    objectName.includes("/")
  ) {
    throw badRequest(`Invalid ${folder === "gpx" ? "GPX" : "gallery"} storage path`);
  }
  return storagePath;
}

function normalizeTrackGalleryItemsForOrganization(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  organizationId: string,
  value: unknown,
) {
  return normalizeTrackGalleryItems(value).map((item) => {
    if (!item.storagePath) return item;

    const storagePath = requireOrganizationStoragePath(
      item.storagePath,
      organizationId,
      "gallery",
    );
    const { data } = adminClient.storage.from(TRACK_MEDIA_BUCKET).getPublicUrl(storagePath);
    if (!data.publicUrl) throw badRequest("Gallery image URL is unavailable");
    return { ...item, imageUrl: data.publicUrl, storagePath };
  });
}

async function loadUploadedTrackGpx(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  organizationId: string,
  storagePath: string,
) {
  const verifiedPath = requireOrganizationStoragePath(storagePath, organizationId, "gpx");
  const { data, error } = await adminClient.storage.from(TRACK_GPX_BUCKET).download(verifiedPath);
  if (error) throw badRequest(`GPX upload could not be read: ${error.message}`);
  if (!data) throw badRequest("GPX upload could not be read");
  if (data.size > MAX_TRACK_GPX_BYTES) throw badRequest("GPX file must be 50 MB or smaller");

  const gpxXml = await data.text();
  try {
    return {
      ...parseTrackGpxSource(gpxXml),
      gpxXml,
      byteSize: data.size,
      storagePath: verifiedPath,
    };
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "GPX file is invalid");
  }
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

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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

function renderCacheCheckpoints(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ name: string; lat: number; lng: number; elev: number | null; type: string | null; km: number | null }>;
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : null;
      const lat = numberFromUnknown(record.lat);
      const lng = numberFromUnknown(record.lng);
      if (!name || lat == null || lng == null) return null;
      const type = typeof record.type === "string" && record.type.trim() ? record.type.trim() : null;
      return {
        name,
        lat,
        lng,
        elev: numberFromUnknown(record.elev),
        type,
        km: numberFromUnknown(record.km),
      };
    })
    .filter(Boolean) as Array<{ name: string; lat: number; lng: number; elev: number | null; type: string | null; km: number | null }>;
}

async function loadTrackVersionGpxDownload(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  input: {
    trackVersionId: string;
    trackName: string;
    fallbackFileName: string;
  },
): Promise<TrackGpxDownload> {
  const { data: sourceRow, error: sourceError } = await adminClient
    .from("track_version_gpx_sources")
    .select("file_name,mime_type,gpx_xml,storage_path")
    .eq("track_version_id", input.trackVersionId)
    .maybeSingle<{
      file_name: string;
      mime_type: string;
      gpx_xml: string | null;
      storage_path: string | null;
    }>();

  if (sourceError) throw sourceError;
  if (sourceRow) {
    let content = sourceRow.gpx_xml;
    if (!content && sourceRow.storage_path) {
      const { data, error } = await adminClient.storage
        .from(TRACK_GPX_BUCKET)
        .download(sourceRow.storage_path);
      if (error) throw error;
      content = data ? await data.text() : null;
    }
    if (!content) throw notFound("GPX source not found");
    return {
      fileName: sourceRow.file_name,
      mimeType: sourceRow.mime_type,
      content,
    };
  }

  const { data: renderCache, error: renderCacheError } = await adminClient
    .from("track_render_cache")
    .select("polyline_json,elevation_profile_json,checkpoints_json")
    .eq("track_version_id", input.trackVersionId)
    .maybeSingle<{
      polyline_json: unknown;
      elevation_profile_json: unknown;
      checkpoints_json: unknown;
    }>();

  if (renderCacheError) throw renderCacheError;
  if (!renderCache) throw notFound("GPX source not found");

  const routePoints = renderCacheRoutePoints(renderCache.polyline_json);
  if (routePoints.length < 2) {
    throw notFound("GPX source not found");
  }

  return {
    fileName: sanitizeGpxFileName(input.fallbackFileName, slugify(input.trackName)),
    mimeType: "application/gpx+xml",
    content: buildTrackGpxDocument({
      name: input.trackName,
      routePoints,
      elevationPoints: renderCacheElevationPoints(renderCache.elevation_profile_json),
      checkpoints: renderCacheCheckpoints(renderCache.checkpoints_json),
    }),
  };
}

async function loadOrganizerManagedTracks(
  organizationIds: string[],
  env: ServerEnv,
  options: {
    includeGallery?: boolean;
    includeGeometry?: boolean;
    trackRef?: string;
  } = {},
) {
  const adminClient = createAdminSupabaseClient(env);
  if (!organizationIds.length) return [] as OrganizerManagedTrack[];

  const includeGallery = options.includeGallery !== false;
  const templateColumns = [
    "id",
    "organization_id",
    "slug",
    "name",
    "sport_code",
    "terrain_type",
    "notes",
    "public_overview",
    "location_label",
    "season_label",
    "parking_label",
    "weather_location_label",
    "best_time_label",
    "gallery_preview_image_url",
    ...(includeGallery ? ["gallery_items_json"] : []),
    "created_at",
    "updated_at",
  ].join(",");

  const templateQuery = adminClient
    .from("track_templates")
    .select(templateColumns)
    .in("organization_id", organizationIds);
  const scopedTemplateQuery = options.trackRef
    ? (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.trackRef)
          ? templateQuery.eq("id", options.trackRef)
          : templateQuery.eq("slug", options.trackRef)
      )
    : templateQuery;
  const { data: templateRows, error: templateError } = await scopedTemplateQuery
    .order("created_at", { ascending: false })
    .returns<Array<{
      id: string;
      organization_id: string;
      slug: string;
      name: string;
      sport_code: SportCode;
      terrain_type: string | null;
      notes: string | null;
      public_overview: string | null;
      location_label: string | null;
      season_label: string | null;
      parking_label: string | null;
      weather_location_label: string | null;
      best_time_label: string | null;
      gallery_preview_image_url: string | null;
      gallery_items_json?: unknown;
      created_at: string;
      updated_at: string;
    }>>();

  if (templateError) throw templateError;
  if (!templateRows?.length) return [];

  const templateIds = templateRows.map((row) => row.id);
  const [
    { data: versionRows, error: versionError },
    { data: snapshotRows, error: snapshotError },
    { data: recurrenceRuleRows, error: recurrenceRuleError },
    { data: recurrenceCategoryTemplateRows, error: recurrenceCategoryTemplateError },
  ] = await Promise.all([
    adminClient
      .from("track_versions")
      .select(
        `id,track_template_id,version_number,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,difficulty_level,published_at,surface_summary,safety_notes,water_point_count,segment_definitions_json,${includeGallery ? "template_patch_json" : "template_summary_patch_json"}`,
      )
      .in("track_template_id", templateIds)
      .order("version_number", { ascending: false })
      .returns<Array<{
        id: string;
        track_template_id: string;
        version_number: number;
        gpx_storage_path: string;
        distance_km: string | number | null;
        elevation_gain_m: number | null;
        elevation_loss_m: number | null;
        difficulty_level: number | null;
        published_at: string | null;
        surface_summary: string | null;
        safety_notes: string | null;
        water_point_count: number | null;
        segment_definitions_json: unknown;
        template_patch_json?: unknown;
        template_summary_patch_json?: unknown;
      }>>(),
    adminClient
      .from("event_category_track_snapshots")
      .select("track_template_id,event_category_id")
      .in("track_template_id", templateIds)
      .returns<Array<{ track_template_id: string; event_category_id: string }>>(),
    adminClient
      .from("league_recurrence_rules")
      .select("id,track_template_id")
      .in("track_template_id", templateIds)
      .returns<Array<{ id: string; track_template_id: string }>>(),
    adminClient
      .from("league_recurrence_category_templates")
      .select("recurrence_rule_id,track_template_id")
      .in("track_template_id", templateIds)
      .returns<Array<{ recurrence_rule_id: string; track_template_id: string }>>(),
  ]);

  if (versionError) throw versionError;
  if (snapshotError) throw snapshotError;
  if (recurrenceRuleError) throw recurrenceRuleError;
  if (recurrenceCategoryTemplateError) throw recurrenceCategoryTemplateError;

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

  const latestVersionIds = Array.from(new Set(Array.from(latestVersionByTemplate.values()).map((version) => version.id)));
  const [{ data: gpxSourceRows, error: gpxSourceError }, { data: renderCacheRows, error: renderCacheError }] = await Promise.all(
    latestVersionIds.length
      ? [
          adminClient
            .from("track_version_gpx_sources")
            .select("track_version_id,file_name")
            .in("track_version_id", latestVersionIds)
            .returns<Array<{ track_version_id: string; file_name: string }>>(),
          options.includeGeometry === false
            ? Promise.resolve({
                data: [] as Array<{
                  track_version_id: string;
                  polyline_json: unknown;
                  elevation_profile_json: unknown;
                  checkpoints_json: unknown;
                }>,
                error: null,
              })
            : adminClient
                .from("track_render_cache")
                .select("track_version_id,polyline_json,elevation_profile_json,checkpoints_json")
                .in("track_version_id", latestVersionIds)
                .returns<Array<{
                  track_version_id: string;
                  polyline_json: unknown;
                  elevation_profile_json: unknown;
                  checkpoints_json: unknown;
                }>>(),
        ]
      : [
          Promise.resolve({ data: [] as Array<{ track_version_id: string; file_name: string }>, error: null }),
          Promise.resolve({
            data: [] as Array<{
              track_version_id: string;
              polyline_json: unknown;
              elevation_profile_json: unknown;
              checkpoints_json: unknown;
            }>,
            error: null,
          }),
        ],
  );

  if (gpxSourceError) throw gpxSourceError;
  if (renderCacheError) throw renderCacheError;

  const gpxSourceByVersionId = new Map((gpxSourceRows ?? []).map((row) => [row.track_version_id, row.file_name]));
  const renderCacheByVersionId = new Map((renderCacheRows ?? []).map((row) => [row.track_version_id, row]));

  const categoryIds = Array.from(new Set((snapshotRows ?? []).map((snapshot) => snapshot.event_category_id)));
  const { data: categoryRows, error: categoryError } = categoryIds.length
    ? await adminClient
        .from("event_categories")
        .select("id,event_edition_id,organizer_deleted_at")
        .in("id", categoryIds)
        .returns<Array<{
          id: string;
          event_edition_id: string;
          organizer_deleted_at: string | null;
        }>>()
    : {
        data: [] as Array<{
          id: string;
          event_edition_id: string;
          organizer_deleted_at: string | null;
        }>,
        error: null,
      };

  if (categoryError) throw categoryError;

  const categoryById = new Map((categoryRows ?? []).map((row) => [row.id, row]));
  const eventEditionIds = Array.from(new Set((categoryRows ?? []).map((row) => row.event_edition_id)));
  const { data: eventEditionRows, error: eventEditionError } = eventEditionIds.length
    ? await adminClient
        .from("event_editions")
        .select("id,organizer_deleted_at")
        .in("id", eventEditionIds)
        .returns<Array<{ id: string; organizer_deleted_at: string | null }>>()
    : {
        data: [] as Array<{ id: string; organizer_deleted_at: string | null }>,
        error: null,
      };

  if (eventEditionError) throw eventEditionError;

  const eventEditionById = new Map((eventEditionRows ?? []).map((row) => [row.id, row]));
  const eventEditionIdsByTemplate = new Map<string, Set<string>>();
  const categoryLinkCountByTemplate = new Map<string, number>();
  const leagueScheduleRuleIdsByTemplate = new Map<string, Set<string>>();

  for (const snapshot of snapshotRows ?? []) {
    const category = categoryById.get(snapshot.event_category_id);
    const edition = category ? eventEditionById.get(category.event_edition_id) : null;
    if (!category || !edition || category.organizer_deleted_at || edition.organizer_deleted_at) {
      continue;
    }
    categoryLinkCountByTemplate.set(
      snapshot.track_template_id,
      (categoryLinkCountByTemplate.get(snapshot.track_template_id) ?? 0) + 1,
    );
    const editionIds = eventEditionIdsByTemplate.get(snapshot.track_template_id) ?? new Set<string>();
    editionIds.add(category.event_edition_id);
    eventEditionIdsByTemplate.set(snapshot.track_template_id, editionIds);
  }

  for (const rule of recurrenceRuleRows ?? []) {
    const ruleIds = leagueScheduleRuleIdsByTemplate.get(rule.track_template_id) ?? new Set<string>();
    ruleIds.add(rule.id);
    leagueScheduleRuleIdsByTemplate.set(rule.track_template_id, ruleIds);
  }

  for (const template of recurrenceCategoryTemplateRows ?? []) {
    const ruleIds = leagueScheduleRuleIdsByTemplate.get(template.track_template_id) ?? new Set<string>();
    ruleIds.add(template.recurrence_rule_id);
    leagueScheduleRuleIdsByTemplate.set(template.track_template_id, ruleIds);
  }

  return templateRows.flatMap((template) => {
      const latestVersion = latestVersionByTemplate.get(template.id);
      if (!latestVersion) return [];
      const latestPublishedVersion = latestPublishedVersionByTemplate.get(template.id);
      const templateDraftPatch = latestVersion.published_at
        ? {}
        : normalizeTrackTemplateDraftPatch(
            includeGallery
              ? latestVersion.template_patch_json
              : latestVersion.template_summary_patch_json,
          );
      const templateRecord = template as unknown as Record<string, unknown>;
      const galleryItems = includeGallery
        ? normalizeTrackGalleryItems(
            trackTemplateDraftValue<unknown>(templateRecord, templateDraftPatch, "gallery_items_json"),
          )
        : [];

      return [{
        templateId: template.id,
        slug: template.slug,
        name: trackTemplateDraftValue<string>(templateRecord, templateDraftPatch, "name"),
        sportCode: template.sport_code ?? DEFAULT_SPORT_CODE,
        terrainType: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "terrain_type"),
        notes: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "notes"),
        publicOverview: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "public_overview"),
        locationLabel: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "location_label"),
        seasonLabel: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "season_label"),
        parkingLabel: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "parking_label"),
        weatherLocationLabel: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "weather_location_label"),
        bestTimeLabel: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "best_time_label"),
        latestVersionId: latestVersion.id,
        latestVersionNumber: latestVersion.version_number,
        latestVersionPublishedAt: latestVersion.published_at,
        latestPublishedVersionId: latestPublishedVersion?.id ?? null,
        latestPublishedVersionNumber: latestPublishedVersion?.version_number ?? null,
        sourceFileName: gpxSourceByVersionId.get(latestVersion.id) ?? sanitizeGpxFileName(latestVersion.gpx_storage_path.split("/").pop() ?? null, template.slug),
        hasGpxSource: Boolean(gpxSourceByVersionId.has(latestVersion.id) || latestVersion.gpx_storage_path),
        distanceKm: numberOrNull(latestVersion.distance_km),
        elevationGainM: latestVersion.elevation_gain_m,
        elevationLossM: latestVersion.elevation_loss_m,
        difficultyLevel: latestVersion.difficulty_level,
        surfaceSummary: latestVersion.surface_summary,
        safetyNotes: latestVersion.safety_notes,
        waterPointCount: Math.max(0, latestVersion.water_point_count ?? 0),
        segments: normalizeTrackSegments(latestVersion.segment_definitions_json),
        galleryPreviewImageUrl:
          previewImageFromTrackGallery(galleryItems)
          ?? normalizeTrackPreviewImageUrl(template.gallery_preview_image_url),
        galleryItems,
        routePoints: renderCacheRoutePoints(renderCacheByVersionId.get(latestVersion.id)?.polyline_json),
        elevationPoints: renderCacheTrackElevationProfile(renderCacheByVersionId.get(latestVersion.id)?.elevation_profile_json),
        checkpoints: normalizeTrackSnapshotCheckpoints(renderCacheByVersionId.get(latestVersion.id)?.checkpoints_json).flatMap((checkpoint) => (
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
        )),
        publishedAt: latestPublishedVersion?.published_at ?? null,
        isPublic: Boolean(latestPublishedVersion?.published_at),
        categoryLinkCount: categoryLinkCountByTemplate.get(template.id) ?? 0,
        eventLinkCount: eventEditionIdsByTemplate.get(template.id)?.size ?? 0,
        leagueScheduleLinkCount: leagueScheduleRuleIdsByTemplate.get(template.id)?.size ?? 0,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      } satisfies OrganizerManagedTrack];
    });
}

async function loadOrganizerManagedLeagueSeasonsLegacy(
  organizationIds: string[],
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  if (!organizationIds.length) return [] as OrganizerManagedLeagueSeason[];

  const { data: leagueRows, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id,slug,name,description,status")
    .in("organization_id", organizationIds)
    .order("name", { ascending: true })
    .returns<Array<{
      id: string;
      organization_id: string;
      slug: string;
      name: string;
      description: string | null;
      status: string;
    }>>();

  if (leagueError) throw leagueError;
  if (!leagueRows?.length) return [];

  const leagueIds = leagueRows.map((row) => row.id);
  const { data: seasonRows, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,league_id,year,name,status,starts_on,ends_on,timezone,club_scoring_scope,organizer_rules,published_at")
    .in("league_id", leagueIds)
    .order("year", { ascending: false })
    .returns<Array<{
      id: string;
      league_id: string;
      year: number;
      name: string;
      status: string;
      starts_on: string | null;
      ends_on: string | null;
      timezone: string;
      club_scoring_scope: string | null;
      organizer_rules: string | null;
      published_at: string | null;
    }>>();

  if (seasonError) throw seasonError;
  if (!seasonRows?.length) return [];

  const seasonIds = seasonRows.map((row) => row.id);
  const [roundResponse, scoringRulesResponse, leagueSportsResponse] = await Promise.all([
    adminClient
      .from("league_rounds")
      .select("id,league_season_id,event_edition_id,event_category_id,round_number,status")
      .in("league_season_id", seasonIds)
      .order("round_number", { ascending: true })
      .returns<Array<{
        id: string;
        league_season_id: string;
        event_edition_id: string;
        event_category_id: string;
        round_number: number;
        status: string;
      }>>(),
    adminClient
      .from("league_scoring_rules")
      .select("league_season_id,name,points_table_json,best_n_rounds,minimum_rounds,tie_break_method,club_scoring_mode")
      .in("league_season_id", seasonIds)
      .returns<Array<{
        league_season_id: string;
        name: string | null;
        points_table_json: Array<{ points?: number }> | null;
        best_n_rounds: number | null;
        minimum_rounds: number | null;
        tie_break_method: string | null;
        club_scoring_mode: string | null;
      }>>(),
    adminClient
      .from("league_sports")
      .select("league_id,sport_code,is_primary")
      .in("league_id", leagueIds)
      .returns<Array<StoredSportAssignment & { league_id: string }>>(),
  ]);

  const roundRows = roundResponse.data ?? [];
  if (roundResponse.error) throw roundResponse.error;
  if (scoringRulesResponse.error) throw scoringRulesResponse.error;
  if (leagueSportsResponse.error) throw leagueSportsResponse.error;

  const scoringExtensionsResponse = await adminClient
    .from("league_scoring_rules")
    .select("league_season_id,field_size_profile,participation_points")
    .in("league_season_id", seasonIds)
    .returns<Array<{
      league_season_id: string;
      field_size_profile: string;
      participation_points: number;
    }>>();
  if (scoringExtensionsResponse.error && !isSchemaCompatError(scoringExtensionsResponse.error)) {
    throw scoringExtensionsResponse.error;
  }
  const scoringExtensionsBySeasonId = new Map(
    (scoringExtensionsResponse.data ?? []).map((row) => [row.league_season_id, row]),
  );
  const scoringCurveResponse = await adminClient
    .from("league_scoring_rules")
    .select("league_season_id,scoring_method,scoring_parameters_json")
    .in("league_season_id", seasonIds)
    .returns<Array<{
      league_season_id: string;
      scoring_method: string;
      scoring_parameters_json: unknown;
    }>>();
  if (scoringCurveResponse.error && !isSchemaCompatError(scoringCurveResponse.error)) {
    throw scoringCurveResponse.error;
  }
  const scoringCurveBySeasonId = new Map(
    (scoringCurveResponse.data ?? []).map((row) => [row.league_season_id, row]),
  );

  const eventEditionIds = Array.from(new Set(roundRows.map((row) => row.event_edition_id)));
  const categoryIds = Array.from(new Set(roundRows.map((row) => row.event_category_id)));
  const [editionRows, categoryRows] = await Promise.all([
    eventEditionIds.length
      ? adminClient
          .from("event_editions")
          .select("id,slug,name,start_date,end_date,timezone,status")
          .in("id", eventEditionIds)
          .returns<Array<{ id: string; slug: string; name: string; start_date: string; end_date: string | null; timezone: string | null; status: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; slug: string; name: string; start_date: string; end_date: string | null; timezone: string | null; status: string }>),
    categoryIds.length
      ? adminClient
          .from("event_categories")
          .select("id,name")
          .in("id", categoryIds)
          .returns<Array<{ id: string; name: string }>>()
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
    const existing = roundsBySeasonId.get(round.league_season_id) ?? [];
    existing.push({
      id: round.id,
      roundNumber: round.round_number,
      eventEditionId: edition.id,
      eventName: edition.name,
      eventSlug: edition.slug,
      eventDate: edition.start_date,
      eventCategoryId: round.event_category_id,
      categoryName: category.name,
      status: deriveLeagueRoundStatus(edition.status, round.status, {
        startDate: edition.start_date,
        endDate: edition.end_date,
        timeZone: edition.timezone,
      }),
      mappings: [{
        id: round.id,
        competitionId: round.league_season_id,
        competitionName: "Overall",
        eventCategoryId: round.event_category_id,
        categoryName: category.name,
        status: "mapped",
      }],
    });
    roundsBySeasonId.set(round.league_season_id, existing);
  }

  const leagueById = new Map(leagueRows.map((row) => [row.id, row]));
  const sportsByLeagueId = new Map<string, StoredSportAssignment[]>();
  for (const assignment of leagueSportsResponse.data ?? []) {
    const existing = sportsByLeagueId.get(assignment.league_id) ?? [];
    existing.push(assignment);
    sportsByLeagueId.set(assignment.league_id, existing);
  }
  const scoringRulesBySeasonId = new Map(
    (scoringRulesResponse.data ?? []).map((row) => [
      row.league_season_id,
      {
        name: row.name ?? null,
        pointsTable: Array.isArray(row.points_table_json)
          ? row.points_table_json.map((entry) => Number(entry?.points ?? 0))
          : [],
        fieldSizeProfile: scoringExtensionsBySeasonId.get(row.league_season_id)?.field_size_profile ?? "custom",
        participationPoints: Number(scoringExtensionsBySeasonId.get(row.league_season_id)?.participation_points ?? 0),
        scoringMethod: normalizeLeagueScoringMethod(scoringCurveBySeasonId.get(row.league_season_id)?.scoring_method),
        scoringParameters: normalizeLeagueScoringParameters(
          scoringCurveBySeasonId.get(row.league_season_id)?.scoring_parameters_json,
        ),
        bestN: row.best_n_rounds ?? null,
        minimumRounds: row.minimum_rounds ?? null,
        tieBreakMethod: row.tie_break_method ?? null,
        clubScoringMode: row.club_scoring_mode ?? null,
      } satisfies OrganizerLeagueScoringRules,
    ]),
  );
  return seasonRows.map((season) => {
    const league = leagueById.get(season.league_id);
    if (!league) {
      throw notFound("League not found");
    }
    const legacyScoringRules = scoringRulesBySeasonId.get(season.id) ?? null;
    const sportSelection = mapStoredSportSelection(sportsByLeagueId.get(league.id));
    return {
      leagueId: league.id,
      seasonId: season.id,
      slug: league.slug,
      name: league.name,
      sportCodes: sportSelection.sportCodes,
      primarySportCode: sportSelection.primarySportCode,
      description: league.description,
      organizerNotes: null,
      organizerRules: optionalText(season.organizer_rules),
      status: league.status,
      year: season.year,
      startsOn: season.starts_on,
      endsOn: season.ends_on,
      timezone: season.timezone,
      clubScoringScope: normalizeLeagueClubScoringScope(season.club_scoring_scope),
      seasonName: season.name,
      seasonStatus: season.status,
      publishedAt: season.published_at,
      isPublic: Boolean(season.published_at),
      rounds: (roundsBySeasonId.get(season.id) ?? []).sort((left, right) => left.roundNumber - right.roundNumber),
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
        scoringRules: legacyScoringRules,
      }],
      scoringRules: legacyScoringRules,
    } satisfies OrganizerManagedLeagueSeason;
  });
}

function normalizeLeaguePointsTable(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const candidate = entry && typeof entry === "object" && "points" in entry
      ? (entry as { points?: unknown }).points
      : entry;
    const points = Number(candidate);
    return Number.isFinite(points) && points >= 0 ? [points] : [];
  });
}

function normalizeLeagueScoringMethod(value: string | null | undefined): OrganizerLeagueScoringRules["scoringMethod"] {
  return value === "geometric" || value === "hybrid" ? value : "custom";
}

function normalizeLeagueScoringParameters(
  value: unknown,
): OrganizerLeagueScoringRules["scoringParameters"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const maximumPoints = Number(candidate.maximumPoints);
  const expectedFinishers = Number(candidate.expectedFinishers);
  const hybridEmphasis = candidate.hybridEmphasis;
  if (!Number.isFinite(maximumPoints) || !Number.isFinite(expectedFinishers)) return null;
  return {
    maximumPoints,
    expectedFinishers,
    hybridEmphasis: hybridEmphasis === "inclusive" || hybridEmphasis === "competitive"
      ? hybridEmphasis
      : "balanced",
  };
}

async function loadOrganizerManagedLeagueSeasons(
  organizationIds: string[],
  env: ServerEnv,
) {
  const legacySeasons = await loadOrganizerManagedLeagueSeasonsLegacy(organizationIds, env);
  if (!legacySeasons.length) return legacySeasons;

  const adminClient = createAdminSupabaseClient(env);
  const seasonIds = legacySeasons.map((season) => season.seasonId);
  const privateSettingsResponse = await adminClient
    .from("league_season_private_settings")
    .select("league_season_id,organizer_notes")
    .in("league_season_id", seasonIds)
    .returns<Array<{ league_season_id: string; organizer_notes: string | null }>>();
  if (privateSettingsResponse.error && !isSchemaCompatError(privateSettingsResponse.error)) {
    throw privateSettingsResponse.error;
  }
  const organizerNotesBySeasonId = new Map(
    (privateSettingsResponse.data ?? []).map((settings) => [settings.league_season_id, settings.organizer_notes]),
  );
  const seasonsWithPrivateSettings = legacySeasons.map((season) => ({
    ...season,
    organizerNotes: organizerNotesBySeasonId.get(season.seasonId) ?? null,
  }));
  const competitionResponse = await adminClient
    .from("league_competitions")
    .select("id,league_season_id,slug,name,description,scoring_target,result_basis,standings_mode,display_order,is_default,status,current_scoring_policy_version_id")
    .in("league_season_id", seasonIds)
    .order("display_order", { ascending: true })
    .returns<Array<{
      id: string;
      league_season_id: string;
      slug: string;
      name: string;
      description: string | null;
      scoring_target: "individual" | "club";
      result_basis: string;
      standings_mode: "points" | "best_time" | "participation" | "none";
      display_order: number;
      is_default: boolean;
      status: string;
      current_scoring_policy_version_id: string | null;
    }>>();

  if (competitionResponse.error) {
    if (isSchemaCompatError(competitionResponse.error)) return seasonsWithPrivateSettings;
    throw competitionResponse.error;
  }

  const competitionRows = competitionResponse.data ?? [];
  if (!competitionRows.length) return seasonsWithPrivateSettings;
  const competitionIds = competitionRows.map((competition) => competition.id);

  const [classificationResponse, policyResponse, roundResponse] = await Promise.all([
    adminClient
      .from("league_classifications")
      .select("id,league_competition_id,slug,name,eligibility_json,award_depth,display_order,is_default,status")
      .in("league_competition_id", competitionIds)
      .neq("status", "archived")
      .order("display_order", { ascending: true })
      .returns<Array<{
        id: string;
        league_competition_id: string;
        slug: string;
        name: string;
        eligibility_json: Record<string, unknown> | null;
        award_depth: number | null;
        display_order: number;
        is_default: boolean;
        status: string;
      }>>(),
    adminClient
      .from("league_scoring_policy_versions")
      .select("id,league_competition_id,version_number,name,points_table_json,best_n_rounds,minimum_rounds,tie_break_method,club_scoring_mode")
      .in("league_competition_id", competitionIds)
      .order("version_number", { ascending: false })
      .returns<Array<{
        id: string;
        league_competition_id: string;
        version_number: number;
        name: string | null;
        points_table_json: unknown;
        best_n_rounds: number | null;
        minimum_rounds: number | null;
        tie_break_method: string | null;
        club_scoring_mode: string | null;
      }>>(),
    adminClient
      .from("league_round_events")
      .select("id,league_season_id,event_edition_id,round_number,status,excluded_event_category_ids")
      .in("league_season_id", seasonIds)
      .order("round_number", { ascending: true })
      .returns<Array<{
        id: string;
        league_season_id: string;
        event_edition_id: string;
        round_number: number;
        status: string;
        excluded_event_category_ids: string[];
      }>>(),
  ]);

  for (const response of [classificationResponse, policyResponse, roundResponse]) {
    if (response.error) {
      if (isSchemaCompatError(response.error)) return seasonsWithPrivateSettings;
      throw response.error;
    }
  }

  const policyExtensionResponse = await adminClient
    .from("league_scoring_policy_versions")
    .select("id,field_size_profile,participation_points")
    .in("league_competition_id", competitionIds)
    .returns<Array<{
      id: string;
      field_size_profile: string;
      participation_points: number;
    }>>();
  if (policyExtensionResponse.error && !isSchemaCompatError(policyExtensionResponse.error)) {
    throw policyExtensionResponse.error;
  }
  const policyExtensionsById = new Map(
    (policyExtensionResponse.data ?? []).map((policy) => [policy.id, policy]),
  );
  const policyCurveResponse = await adminClient
    .from("league_scoring_policy_versions")
    .select("id,scoring_method,scoring_parameters_json")
    .in("league_competition_id", competitionIds)
    .returns<Array<{
      id: string;
      scoring_method: string;
      scoring_parameters_json: unknown;
    }>>();
  if (policyCurveResponse.error && !isSchemaCompatError(policyCurveResponse.error)) {
    throw policyCurveResponse.error;
  }
  const policyCurveById = new Map(
    (policyCurveResponse.data ?? []).map((policy) => [policy.id, policy]),
  );

  const roundRows = roundResponse.data ?? [];
  const roundIds = roundRows.map((round) => round.id);
  const mappingResponse = roundIds.length
    ? await adminClient
        .from("league_round_race_mappings")
        .select("id,league_round_event_id,league_competition_id,event_category_id,status")
        .in("league_round_event_id", roundIds)
        .returns<Array<{
          id: string;
          league_round_event_id: string;
          league_competition_id: string;
          event_category_id: string;
          status: string;
        }>>()
    : { data: [] as Array<{
        id: string;
        league_round_event_id: string;
        league_competition_id: string;
        event_category_id: string;
        status: string;
      }>, error: null };

  if (mappingResponse.error) {
    if (isSchemaCompatError(mappingResponse.error)) return seasonsWithPrivateSettings;
    throw mappingResponse.error;
  }

  const mappingRows = mappingResponse.data ?? [];
  const eventEditionIds = Array.from(new Set(roundRows.map((round) => round.event_edition_id)));
  const eventCategoryIds = Array.from(new Set(mappingRows.map((mapping) => mapping.event_category_id)));
  const [editionRows, categoryRows] = await Promise.all([
    eventEditionIds.length
      ? adminClient
          .from("event_editions")
          .select("id,slug,name,start_date,end_date,timezone,status")
          .in("id", eventEditionIds)
          .returns<Array<{ id: string; slug: string; name: string; start_date: string; end_date: string | null; timezone: string | null; status: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; slug: string; name: string; start_date: string; end_date: string | null; timezone: string | null; status: string }>),
    eventCategoryIds.length
      ? adminClient
          .from("event_categories")
          .select("id,name")
          .in("id", eventCategoryIds)
          .returns<Array<{ id: string; name: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);

  type LeaguePolicyRow = NonNullable<typeof policyResponse.data>[number];
  const policyById = new Map((policyResponse.data ?? []).map((policy) => [policy.id, policy]));
  const latestPolicyByCompetitionId = new Map<string, LeaguePolicyRow>();
  for (const policy of policyResponse.data ?? []) {
    if (!latestPolicyByCompetitionId.has(policy.league_competition_id)) {
      latestPolicyByCompetitionId.set(policy.league_competition_id, policy);
    }
  }
  const classificationsByCompetitionId = new Map<string, OrganizerLeagueClassification[]>();
  for (const classification of classificationResponse.data ?? []) {
    const existing = classificationsByCompetitionId.get(classification.league_competition_id) ?? [];
    existing.push({
      id: classification.id,
      slug: classification.slug,
      name: classification.name,
      eligibility: classification.eligibility_json ?? {},
      awardDepth: classification.award_depth,
      displayOrder: classification.display_order,
      isDefault: classification.is_default,
      status: classification.status,
    });
    classificationsByCompetitionId.set(classification.league_competition_id, existing);
  }

  const competitionsBySeasonId = new Map<string, OrganizerLeagueCompetition[]>();
  const competitionNameById = new Map<string, string>();
  for (const competition of competitionRows) {
    competitionNameById.set(competition.id, competition.name);
    const policy = (competition.current_scoring_policy_version_id
      ? policyById.get(competition.current_scoring_policy_version_id)
      : null) ?? latestPolicyByCompetitionId.get(competition.id) ?? null;
    const scoringRules = policy
      ? {
          name: policy.name,
          pointsTable: normalizeLeaguePointsTable(policy.points_table_json),
          fieldSizeProfile: policyExtensionsById.get(policy.id)?.field_size_profile ?? "custom",
          participationPoints: Number(policyExtensionsById.get(policy.id)?.participation_points ?? 0),
          scoringMethod: normalizeLeagueScoringMethod(policyCurveById.get(policy.id)?.scoring_method),
          scoringParameters: normalizeLeagueScoringParameters(
            policyCurveById.get(policy.id)?.scoring_parameters_json,
          ),
          bestN: policy.best_n_rounds,
          minimumRounds: policy.minimum_rounds,
          tieBreakMethod: policy.tie_break_method,
          clubScoringMode: policy.club_scoring_mode,
        } satisfies OrganizerLeagueScoringRules
      : null;
    const existing = competitionsBySeasonId.get(competition.league_season_id) ?? [];
    existing.push({
      id: competition.id,
      slug: competition.slug,
      name: competition.name,
      description: competition.description,
      scoringTarget: competition.scoring_target,
      resultBasis: competition.result_basis,
      standingsMode: competition.standings_mode ?? "points",
      displayOrder: competition.display_order,
      isDefault: competition.is_default,
      status: competition.status,
      classifications: classificationsByCompetitionId.get(competition.id) ?? [],
      scoringRules,
    });
    competitionsBySeasonId.set(competition.league_season_id, existing);
  }

  const editionById = new Map(editionRows.map((edition) => [edition.id, edition]));
  const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
  const mappingsByRoundId = new Map<string, OrganizerLeagueRaceMapping[]>();
  for (const mapping of mappingRows) {
    const category = categoryById.get(mapping.event_category_id);
    if (!category) continue;
    const existing = mappingsByRoundId.get(mapping.league_round_event_id) ?? [];
    existing.push({
      id: mapping.id,
      competitionId: mapping.league_competition_id,
      competitionName: competitionNameById.get(mapping.league_competition_id) ?? "Competition",
      eventCategoryId: mapping.event_category_id,
      categoryName: category.name,
      status: mapping.status,
    });
    mappingsByRoundId.set(mapping.league_round_event_id, existing);
  }

  const roundsBySeasonId = new Map<string, OrganizerLeagueRound[]>();
  for (const round of roundRows) {
    const edition = editionById.get(round.event_edition_id);
    if (!edition) continue;
    const mappings = mappingsByRoundId.get(round.id) ?? [];
    const primaryMapping = mappings[0];
    const existing = roundsBySeasonId.get(round.league_season_id) ?? [];
    existing.push({
      id: round.id,
      roundNumber: round.round_number,
      eventEditionId: edition.id,
      eventName: edition.name,
      eventSlug: edition.slug,
      eventDate: edition.start_date,
      eventCategoryId: primaryMapping?.eventCategoryId ?? "",
      categoryName: primaryMapping?.categoryName ?? "Unmapped",
      excludedCourseIds: round.excluded_event_category_ids ?? [],
      status: deriveLeagueRoundStatus(edition.status, round.status, {
        startDate: edition.start_date,
        endDate: edition.end_date,
        timeZone: edition.timezone,
      }),
      mappings,
    });
    roundsBySeasonId.set(round.league_season_id, existing);
  }

  return seasonsWithPrivateSettings.map((season) => {
    const competitions = competitionsBySeasonId.get(season.seasonId) ?? season.competitions;
    return {
      ...season,
      competitions,
      rounds: (roundsBySeasonId.get(season.seasonId) ?? []).sort((left, right) => left.roundNumber - right.roundNumber),
      scoringRules: competitions.find((competition) => competition.scoringTarget === "individual")?.scoringRules
        ?? season.scoringRules,
    } satisfies OrganizerManagedLeagueSeason;
  });
}

async function loadCategoryResultsSnapshot(
  categoryId: string,
  env: ServerEnv,
  options?: {
    preferredRunId?: string | null;
  },
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,name,event_edition_id,distance_km,sport_code,ranking_config_json")
    .eq("id", categoryId)
    .maybeSingle<{
      id: string;
      name: string;
      event_edition_id: string;
      distance_km: number | null;
      sport_code: string;
      ranking_config_json: unknown;
    }>();

  if (categoryError) throw categoryError;
  if (!category) throw notFound("Category not found");
  const rankingConfig = normalizeCompetitiveRankingConfig(category.ranking_config_json);

  const { data: editionRow, error: editionError } = await adminClient
    .from("event_editions")
    .select("start_date")
    .eq("id", category.event_edition_id)
    .maybeSingle<{ start_date: string }>();

  if (editionError) throw editionError;
  const eventDate = editionRow?.start_date ?? null;

  const { data: checkpointRows, error: checkpointError } = await adminClient
    .from("checkpoints")
    .select("id,name,sequence_number,checkpoint_type")
    .eq("event_category_id", categoryId)
    .eq("is_mandatory", true)
    .order("sequence_number", { ascending: true })
    .returns<Array<{ id: string; name: string; sequence_number: number; checkpoint_type: string }>>();

  if (checkpointError) throw checkpointError;

  const { data: publication, error: publicationError } = await adminClient
    .from("result_publications")
    .select("id,publication_state,result_run_id,published_at")
    .eq("event_category_id", categoryId)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; publication_state: string; result_run_id: string; published_at: string }>();

  if (publicationError) throw publicationError;

  const importedRun = await loadImportedResultSnapshot(adminClient, categoryId);
  const { data: recentRunRows, error: runError } = await adminClient
    .from("result_runs")
    .select("id,status,started_at,completed_at,summary_json")
    .eq("event_category_id", categoryId)
    .order("started_at", { ascending: false })
    .limit(10)
    .returns<ResultRunSnapshotRow[]>();

  if (runError) throw runError;
  let runRows = recentRunRows ?? [];
  if (importedRun && !runRows.some((run) => run.id === importedRun.id)) {
    runRows = [...runRows, importedRun];
  }
  for (const requiredRunId of new Set([options?.preferredRunId, publication?.result_run_id])) {
    if (!requiredRunId || runRows.some((run) => run.id === requiredRunId)) continue;
    const { data: preferredRun, error: preferredRunError } = await adminClient
      .from("result_runs")
      .select("id,status,started_at,completed_at,summary_json")
      .eq("id", requiredRunId)
      .eq("event_category_id", categoryId)
      .maybeSingle<ResultRunSnapshotRow>();
    if (preferredRunError) throw preferredRunError;
    if (preferredRun) runRows = [...runRows, preferredRun];
  }

  const { data: complaintRows, error: complaintError } = await adminClient
    .from("result_complaints")
    .select(
      "id,event_category_id,registration_id,bib_number,complainant_name,complaint_text,status,resolution_note,created_at,resolved_at",
    )
    .eq("event_category_id", categoryId)
    .order("created_at", { ascending: false })
    .returns<Array<{
      id: string;
      event_category_id: string;
      registration_id: string | null;
      bib_number: string | null;
      complainant_name: string;
      complaint_text: string;
      status: "open" | "resolved" | "dismissed";
      resolution_note: string | null;
      created_at: string;
      resolved_at: string | null;
    }>>();

  if (complaintError) throw complaintError;
  const complaints: ResultComplaint[] = (complaintRows ?? []).map((complaint) => ({
    id: complaint.id,
    eventCategoryId: complaint.event_category_id,
    registrationId: complaint.registration_id,
    bibNumber: complaint.bib_number,
    complainantName: complaint.complainant_name,
    complaintText: complaint.complaint_text,
    status: complaint.status,
    resolutionNote: complaint.resolution_note,
    createdAt: complaint.created_at,
    resolvedAt: complaint.resolved_at,
  }));

  const calculationMode = importedRun ? "imported_snapshot" : "native_timing";
  const selectedRunId = selectResultSnapshotRun({
    runs: runRows,
    preferredRunId: options?.preferredRunId,
    publishedRunId: publication?.result_run_id,
    importedRunId: importedRun?.id,
  });
  if (!selectedRunId) {
    return {
      calculationMode,
      category: {
        id: category.id,
        name: category.name,
        eventEditionId: category.event_edition_id,
        distanceKm: category.distance_km != null ? Number(category.distance_km) : null,
        sportCode: category.sport_code,
        rankingConfig,
      },
      checkpoints: (checkpointRows ?? []).map((checkpoint) => ({
        id: checkpoint.id,
        name: checkpoint.name,
        sequenceNumber: checkpoint.sequence_number,
        checkpointType: checkpoint.checkpoint_type,
      })),
      publication: publication
        ? {
            id: publication.id,
            publicationState: publication.publication_state,
            resultRunId: publication.result_run_id,
            publishedAt: publication.published_at,
          }
        : null,
      selectedRun: null,
      runs: runRows.map((run) => ({
        id: run.id,
        status: run.status,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        summary: run.summary_json ?? {},
      })),
      rows: [],
      anomalies: [],
      complaints,
      teamStandings: [],
    } satisfies OrganizerCategoryResults;
  }

  const { data: rowRecords, error: rowError } = await adminClient
    .from("result_rows")
    .select(
      "id,registration_id,athlete_profile_id,result_status,finish_time_ms,gap_ms,rank_overall,rank_gender,rank_age_category,club_points,represented_club_id",
    )
    .eq("result_run_id", selectedRunId)
    .order("rank_overall", { ascending: true, nullsFirst: false })
    .order("finish_time_ms", { ascending: true, nullsFirst: false })
    .returns<Array<{
      id: string;
      registration_id: string;
      athlete_profile_id: string;
      result_status: string;
      finish_time_ms: number | null;
      gap_ms: number | null;
      rank_overall: number | null;
      rank_gender: number | null;
      rank_age_category: number | null;
      club_points: number | null;
      represented_club_id: string | null;
    }>>();

  if (rowError) throw rowError;

  const registrationIds = Array.from(new Set((rowRecords ?? []).map((row) => row.registration_id)));
  const athleteIds = Array.from(new Set((rowRecords ?? []).map((row) => row.athlete_profile_id)));
  const clubIds = Array.from(
    new Set((rowRecords ?? []).map((row) => row.represented_club_id).filter((value): value is string => Boolean(value))),
  );

  const [registrations, athletes, clubs, splits, bibs, anomalies, punchEvidence] = await Promise.all([
    registrationIds.length
      ? adminClient
          .from("registrations")
          .select("id,participation_status")
          .in("id", registrationIds)
          .returns<Array<{ id: string; participation_status: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; participation_status: string }>),
    athleteIds.length
      ? adminClient
          .from("athlete_profiles")
          .select("id,display_name,country_code,gender,date_of_birth")
          .in("id", athleteIds)
          .returns<Array<{ id: string; display_name: string; country_code: string | null; gender: string | null; date_of_birth: string | null }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; display_name: string; country_code: string | null; gender: string | null; date_of_birth: string | null }>),
    clubIds.length
      ? adminClient
          .from("clubs")
          .select("id,name")
          .in("id", clubIds)
          .returns<Array<{ id: string; name: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    rowRecords?.length && checkpointRows?.length
      ? adminClient
          .from("result_splits")
          .select("result_row_id,checkpoint_id,sequence_number,elapsed_time_ms,split_time_ms")
          .in("result_row_id", rowRecords.map((row) => row.id))
          .in("checkpoint_id", checkpointRows.map((checkpoint) => checkpoint.id))
          .order("sequence_number", { ascending: true })
          .returns<Array<{
            result_row_id: string;
            checkpoint_id: string;
            sequence_number: number;
            elapsed_time_ms: number | null;
            split_time_ms: number | null;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          result_row_id: string;
          checkpoint_id: string;
          sequence_number: number;
          elapsed_time_ms: number | null;
          split_time_ms: number | null;
        }>),
    registrationIds.length
      ? adminClient
          .from("bib_assignments")
          .select("registration_id,bib_number")
          .in("registration_id", registrationIds)
          .is("revoked_at", null)
          .returns<Array<{ registration_id: string; bib_number: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ registration_id: string; bib_number: string }>),
    adminClient
      .from("result_anomalies")
      .select(
        "id,registration_id,punch_event_id,anomaly_code,severity,state,message,evidence_json,resolution_note",
      )
      .eq("result_run_id", selectedRunId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      }),
    registrationIds.length
      ? adminClient
          .from("punch_events")
          .select("id,registration_id,checkpoint_id,effective_recorded_at")
          .eq("event_category_id", categoryId)
          .in("registration_id", registrationIds)
          .eq("is_voided", false)
          .order("effective_recorded_at", { ascending: true })
          .returns<Array<{
            id: string;
            registration_id: string;
            checkpoint_id: string;
            effective_recorded_at: string;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          id: string;
          registration_id: string;
          checkpoint_id: string;
          effective_recorded_at: string;
        }>),
  ]);

  const participationStatusByRegistrationId = new Map(
    registrations.map((registration) => [registration.id, registration.participation_status]),
  );
  const athleteById = new Map(athletes.map((row) => [row.id, row]));
  const clubById = new Map(clubs.map((row) => [row.id, row.name]));
  const bibByRegistrationId = new Map(bibs.map((row) => [row.registration_id, row.bib_number]));
  const checkpointById = new Map((checkpointRows ?? []).map((row) => [row.id, row]));
  const punchEvidenceByRegistrationCheckpoint = new Map<
    string,
    Array<{ id: string; effectiveRecordedAt: string }>
  >();
  for (const punch of punchEvidence) {
    const key = `${punch.registration_id}:${punch.checkpoint_id}`;
    const observations = punchEvidenceByRegistrationCheckpoint.get(key) ?? [];
    observations.push({
        id: punch.id,
        effectiveRecordedAt: punch.effective_recorded_at,
    });
    punchEvidenceByRegistrationCheckpoint.set(key, observations);
  }
  const registrationIdByResultRowId = new Map(
    (rowRecords ?? []).map((row) => [row.id, row.registration_id]),
  );
  const splitsByRowId = new Map<string, CategoryResultSplit[]>();

  for (const split of splits) {
    const checkpoint = checkpointById.get(split.checkpoint_id);
    const registrationId = registrationIdByResultRowId.get(split.result_row_id);
    const selectedPunchEvidence = registrationId
      ? punchEvidenceByRegistrationCheckpoint.get(`${registrationId}:${split.checkpoint_id}`)?.[0]
      : null;
    const mapped: CategoryResultSplit = {
      checkpointId: split.checkpoint_id,
      checkpointName: checkpoint?.name ?? "Checkpoint",
      sequenceNumber: split.sequence_number,
      elapsedTimeMs: split.elapsed_time_ms,
      splitTimeMs: split.split_time_ms,
      punchEventId: selectedPunchEvidence?.id ?? null,
      recordedAt: selectedPunchEvidence?.effectiveRecordedAt ?? null,
    };
    const existing = splitsByRowId.get(split.result_row_id) ?? [];
    existing.push(mapped);
    splitsByRowId.set(split.result_row_id, existing);
  }

  const runs = runRows.map((run) => ({
    id: run.id,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    summary: run.summary_json ?? {},
  }));

  const mappedRows = (rowRecords ?? []).map((row) => {
    const athlete = athleteById.get(row.athlete_profile_id);
    return {
      id: row.id,
      registrationId: row.registration_id,
      athleteName: athlete?.display_name ?? "Unknown athlete",
      countryCode: athlete?.country_code?.trim().toUpperCase() || null,
      gender: athlete?.gender ?? null,
      clubName: row.represented_club_id ? clubById.get(row.represented_club_id) ?? null : null,
      bibNumber: bibByRegistrationId.get(row.registration_id) ?? null,
      participationStatus: participationStatusByRegistrationId.get(row.registration_id) ?? "not_started",
      ageGroupLabel: findCompetitiveAgeBucket(rankingConfig, athlete?.date_of_birth ?? null, eventDate)?.label ?? null,
      rankOverall: row.rank_overall,
      rankGender: row.rank_gender,
      rankAgeCategory: row.rank_age_category,
      finishTimeMs: row.finish_time_ms,
      gapMs: row.gap_ms,
      resultStatus: row.result_status,
      points: row.club_points != null ? Number(row.club_points) : null,
      representedClubId: row.represented_club_id,
      splits: splitsByRowId.get(row.id) ?? [],
    };
  });
  const mappedAnomalies = anomalies.flatMap((anomaly) => {
    const evidence = anomaly.evidence_json as Record<string, unknown>;
    const checkpointId = typeof evidence.checkpointId === "string" ? evidence.checkpointId : null;
    if (checkpointId && !checkpointById.has(checkpointId)) return [];
    const duplicateObservations = anomaly.anomaly_code === "duplicate_checkpoint_observation"
      && anomaly.registration_id
      && checkpointId
      ? punchEvidenceByRegistrationCheckpoint.get(`${anomaly.registration_id}:${checkpointId}`) ?? []
      : [];
    const checkpointName = checkpointId ? checkpointById.get(checkpointId)?.name ?? "Checkpoint" : "Checkpoint";
    const bibNumber = anomaly.registration_id ? bibByRegistrationId.get(anomaly.registration_id) ?? null : null;

    return [{
      id: anomaly.id,
      registrationId: anomaly.registration_id,
      punchEventId: anomaly.punch_event_id,
      code: anomaly.anomaly_code,
      severity: anomaly.severity as "info" | "warning" | "error" | "critical",
      state: anomaly.state as "open" | "resolved" | "waived",
      message: duplicateObservations.length > 1
        ? `${duplicateObservations.length} timing entries were recorded${bibNumber ? ` for Bib ${bibNumber}` : ""} at ${checkpointName}. Compare both local times below.`
        : anomaly.message,
      evidence: duplicateObservations.length > 1
        ? {
            ...evidence,
            checkpointName,
            observationCount: duplicateObservations.length,
            observations: duplicateObservations.map((observation, index) => ({
              punchEventId: observation.id,
              effectiveRecordedAt: observation.effectiveRecordedAt,
              usedForResult: index === 0,
            })),
          }
        : evidence,
      resolutionNote: anomaly.resolution_note,
    }];
  });

  return {
    calculationMode,
    category: {
      id: category.id,
      name: category.name,
      eventEditionId: category.event_edition_id,
      distanceKm: category.distance_km != null ? Number(category.distance_km) : null,
      sportCode: category.sport_code,
      rankingConfig,
    },
    checkpoints: (checkpointRows ?? []).map((checkpoint) => ({
      id: checkpoint.id,
      name: checkpoint.name,
      sequenceNumber: checkpoint.sequence_number,
      checkpointType: checkpoint.checkpoint_type,
    })),
    publication: publication
      ? {
          id: publication.id,
          publicationState: publication.publication_state,
          resultRunId: publication.result_run_id,
          publishedAt: publication.published_at,
        }
      : null,
    selectedRun: runs.find((run) => run.id === selectedRunId) ?? null,
    runs,
    rows: mappedRows.map(({ representedClubId: _representedClubId, ...row }) => row),
    anomalies: mappedAnomalies,
    complaints,
    teamStandings: buildCompetitiveTeamStandings({
      rankingConfig,
      rows: mappedRows,
    }),
  } satisfies OrganizerCategoryResults;
}

export async function getAthleteRegistrationsReadModel(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<AthleteRegistrationsReadModel> {
  const adminClient = createAdminSupabaseClient(env);
  const athleteProfileId = requireAthleteProfileId(session);

  const [{ data: athlete, error: athleteError }, registrations] = await Promise.all([
    adminClient
      .from("athlete_profiles")
      .select("id,display_name")
      .eq("id", athleteProfileId)
      .maybeSingle<{ id: string; display_name: string }>(),
    loadRegistrationRowsForAthlete(athleteProfileId, env),
  ]);

  if (athleteError) throw athleteError;
  if (!athlete) throw notFound("Athlete profile not found");
  if (!registrations.length) {
    return {
      displayName: athlete.display_name,
      upcoming: [],
      past: [],
    };
  }

  const categoryIds = Array.from(new Set(registrations.map((registration) => registration.event_category_id)));
  const clubIds = Array.from(
    new Set(registrations.map((registration) => registration.represented_club_id).filter((value): value is string => Boolean(value))),
  );

  const [
    { data: categories, error: categoryError },
    { data: clubs, error: clubError },
    { data: bibs, error: bibError },
    { data: results, error: resultError },
    { data: evidenceRows, error: evidenceError },
    { data: trackSnapshots, error: trackSnapshotsError },
  ] =
    await Promise.all([
      adminClient
        .from("event_categories")
        .select("id,event_edition_id,slug,name,status")
        .in("id", categoryIds)
        .returns<Array<{ id: string; event_edition_id: string; slug: string; name: string; status: string }>>(),
      clubIds.length
        ? adminClient
            .from("clubs")
            .select("id,name")
            .in("id", clubIds)
            .returns<Array<{ id: string; name: string }>>()
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
      adminClient
        .from("bib_assignments")
        .select("registration_id,bib_number")
        .in("registration_id", registrations.map((registration) => registration.id))
        .is("revoked_at", null)
        .returns<Array<{ registration_id: string; bib_number: string }>>(),
      adminClient
        .from("current_published_result_rows")
        .select("registration_id,rank_overall,published_at")
        .in("registration_id", registrations.map((registration) => registration.id))
        .returns<Array<{
          registration_id: string;
          rank_overall: number | null;
          published_at: string;
        }>>(),
      adminClient
        .from("registration_payment_evidence")
        .select("registration_id")
        .in("registration_id", registrations.map((registration) => registration.id))
        .returns<Array<{ registration_id: string }>>(),
      adminClient
        .from("event_category_track_snapshots")
        .select("event_category_id,track_template_id,created_at")
        .in("event_category_id", categoryIds)
        .order("created_at", { ascending: false })
        .returns<Array<{
          event_category_id: string;
          track_template_id: string;
          created_at: string;
        }>>(),
    ]);

  if (categoryError) throw categoryError;
  if (clubError) throw clubError;
  if (bibError) throw bibError;
  if (resultError) throw resultError;
  if (evidenceError) throw evidenceError;
  if (trackSnapshotsError) throw trackSnapshotsError;

  const editionIds = Array.from(new Set((categories ?? []).map((category) => category.event_edition_id)));
  const trackTemplateIds = Array.from(new Set(
    (trackSnapshots ?? []).map((snapshot) => snapshot.track_template_id).filter(Boolean),
  ));
  const [editionResult, trackTemplateResult] = await Promise.all([
    editionIds.length
      ? adminClient
          .from("event_editions")
          .select("id,slug,name,start_date,location_name,cover_image_url")
          .in("id", editionIds)
          .returns<Array<{
            id: string;
            slug: string;
            name: string;
            start_date: string;
            location_name: string | null;
            cover_image_url: string | null;
          }>>()
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            slug: string;
            name: string;
            start_date: string;
            location_name: string | null;
            cover_image_url: string | null;
          }>,
          error: null,
        }),
    trackTemplateIds.length
      ? adminClient
          .from("track_templates")
          .select("id,gallery_preview_image_url")
          .in("id", trackTemplateIds)
          .returns<Array<{ id: string; gallery_preview_image_url: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; gallery_preview_image_url: string | null }>, error: null }),
  ]);
  const { data: editions, error: editionError } = editionResult;
  const { data: trackTemplates, error: trackTemplatesError } = trackTemplateResult;

  if (editionError) throw editionError;
  if (trackTemplatesError) throw trackTemplatesError;

  const categoryById = new Map((categories ?? []).map((category) => [category.id, category]));
  const editionById = new Map((editions ?? []).map((edition) => [edition.id, edition]));
  const latestTrackTemplateIdByCategory = new Map<string, string>();
  for (const snapshot of trackSnapshots ?? []) {
    if (!latestTrackTemplateIdByCategory.has(snapshot.event_category_id)) {
      latestTrackTemplateIdByCategory.set(snapshot.event_category_id, snapshot.track_template_id);
    }
  }
  const trackImageByTemplateId = new Map(
    (trackTemplates ?? []).map((template) => [
      template.id,
      normalizeTrackPreviewImageUrl(template.gallery_preview_image_url),
    ]),
  );
  const bibByRegistrationId = new Map(
    (bibs ?? []).map((bib) => [bib.registration_id, numberOrNull(bib.bib_number)]),
  );
  const publishedResultByRegistrationId = new Map<string, number | null>();
  const paymentEvidenceCountByRegistrationId = new Map<string, number>();
  for (const evidence of evidenceRows ?? []) {
    paymentEvidenceCountByRegistrationId.set(
      evidence.registration_id,
      (paymentEvidenceCountByRegistrationId.get(evidence.registration_id) ?? 0) + 1,
    );
  }
  for (const result of results ?? []) {
    publishedResultByRegistrationId.set(result.registration_id, result.rank_overall);
  }

  const mapped = registrations.map((registration) => {
    const category = categoryById.get(registration.event_category_id);
    const edition = category ? editionById.get(category.event_edition_id) : null;
    const status = statusFromRegistration({
      registrationStatus: registration.status,
      paymentStatus: registration.payment_status,
      participationStatus: registration.participation_status,
      resultStatus: registration.result_status,
      eventStatus: category?.status,
      confirmedAt: registration.confirmed_at,
      hasBib: bibByRegistrationId.get(registration.id) != null,
    });

    return {
      id: registration.id,
      categoryId: registration.event_category_id,
      categorySlug: category?.slug ?? "category",
      eventSlug: edition?.slug ?? "events",
      event: edition?.name ?? "Trail Race",
      eventImageUrl: optionalText(edition?.cover_image_url),
      linkedTrackImageUrl: trackImageByTemplateId.get(
        latestTrackTemplateIdByCategory.get(registration.event_category_id) ?? "",
      ) ?? null,
      category: category?.name ?? "Category",
      date: formatDateLabel(edition?.start_date),
      location: edition?.location_name ? `${edition.location_name}, Croatia` : "Croatia",
      status,
      registrationStatus: registration.status,
      paymentStatus: registration.payment_status,
      participationStatus: registration.participation_status,
      canPay:
        (registration.status === "pending" || registration.status === "offered")
        && !["paid", "refunded", "partially_refunded"].includes(registration.payment_status),
      bib: bibByRegistrationId.get(registration.id) ?? null,
      paid: registration.payment_status === "paid",
      place: publishedResultByRegistrationId.get(registration.id) ?? null,
      paymentEvidenceCount: paymentEvidenceCountByRegistrationId.get(registration.id) ?? 0,
    } satisfies AthleteRegistrationItem;
  });

  return {
    displayName: athlete.display_name,
    upcoming: mapped.filter((item) =>
      item.status === "confirmed"
      || item.status === "pending"
      || item.status === "waitlisted"
      || item.status === "offered"
    ),
    past: mapped.filter((item) =>
      item.status === "completed"
      || item.status === "dns"
      || item.status === "expired"
    ),
  };
}

export async function getAthleteDashboardReadModel(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<AthleteDashboardReadModel> {
  const adminClient = createAdminSupabaseClient(env);
  const athleteProfileId = requireAthleteProfileId(session);

  const [{ data: athlete, error: athleteError }, registrationsData, leagueStandingResponse, resultsResponse] = await Promise.all([
    adminClient
      .from("athlete_profiles")
      .select("id,slug,display_name")
      .eq("id", athleteProfileId)
      .maybeSingle<{ id: string; slug: string; display_name: string }>(),
    getAthleteRegistrationsReadModel(session, env),
    adminClient
      .from("league_individual_standings")
      .select("rank_overall")
      .eq("athlete_profile_id", athleteProfileId)
      .order("rank_overall", { ascending: true })
      .limit(1)
      .maybeSingle<{ rank_overall: number | null }>(),
    adminClient
      .from("current_published_result_rows")
      .select("event_category_id,finish_time_ms,rank_overall,club_points,published_at")
      .eq("athlete_profile_id", athleteProfileId)
      .order("published_at", { ascending: false })
      .limit(6)
      .returns<Array<{
        event_category_id: string;
        finish_time_ms: number | null;
        rank_overall: number | null;
        club_points: number | null;
        published_at: string;
      }>>(),
  ]);

  if (athleteError) throw athleteError;
  if (!athlete) throw notFound("Athlete profile not found");

  const resultCategoryIds = Array.from(
    new Set((resultsResponse.data ?? []).map((result) => result.event_category_id)),
  );
  const { data: resultCategories, error: resultCategoriesError } = resultCategoryIds.length
    ? await adminClient
        .from("event_categories")
        .select("id,event_edition_id")
        .in("id", resultCategoryIds)
        .returns<Array<{ id: string; event_edition_id: string }>>()
    : { data: [] as Array<{ id: string; event_edition_id: string }>, error: null };

  if (resultCategoriesError) throw resultCategoriesError;

  const resultEditionIds = Array.from(new Set((resultCategories ?? []).map((category) => category.event_edition_id)));
  const { data: resultEditions, error: resultEditionsError } = resultEditionIds.length
    ? await adminClient
        .from("event_editions")
        .select("id,name,start_date")
        .in("id", resultEditionIds)
        .returns<Array<{ id: string; name: string; start_date: string }>>()
    : { data: [] as Array<{ id: string; name: string; start_date: string }>, error: null };

  if (resultEditionsError) throw resultEditionsError;

  const resultCategoryById = new Map((resultCategories ?? []).map((category) => [category.id, category]));
  const resultEditionById = new Map((resultEditions ?? []).map((edition) => [edition.id, edition]));

  const upcomingRegistrations = registrationsData.upcoming.slice(0, 5).map((registration) => ({
    event: registration.event,
    category: registration.category,
    date: registration.date.replace(`, ${new Date().getFullYear()}`, ""),
    status: (registration.status === "pending" ? "pending" : "confirmed") as "pending" | "confirmed",
    bib: registration.bib,
  }));

  const recentResults = (resultsResponse.data ?? []).slice(0, 3).map((result) => {
    const category = resultCategoryById.get(result.event_category_id);
    const edition = category ? resultEditionById.get(category.event_edition_id) : null;
    return {
      event: edition?.name ?? "Trail Race",
      place: result.rank_overall ?? 0,
      time: formatElapsedTime(result.finish_time_ms),
      points: Math.round(Number(result.club_points ?? 0)),
    };
  });

  return {
    displayName: session.account.displayName ?? athlete.display_name,
    nextRaceLabel: nextRaceLabel(registrationsData.upcoming[0]?.date ? registrationsData.upcoming[0].date.split(", ").reverse().join("-") : null),
    publicProfileSlug: athlete.slug,
    upcomingRegistrations,
    recentResults,
    stats: {
      upcomingCount: registrationsData.upcoming.length,
      seasonRaces: recentResults.length,
      leagueRankLabel: leagueStandingResponse.data?.rank_overall ? `#${leagueStandingResponse.data.rank_overall}` : "TBA",
    },
  };
}

const ORGANIZER_EVENT_DASHBOARD_PERMISSIONS = new Set([
  "events.manage",
  "entrants.manage",
  "race_day.manage",
  "checkpoint_timing.enter",
  "results.manage",
  "team.manage",
  "communications.manage",
  "safety.manage",
  "logistics.manage",
  "finance.manage",
]);

export function selectOrganizerWorkspaceOrganizationIds(
  availableOrganizationIds: string[],
  requestedOrganizationId?: string | null,
) {
  const authorizedOrganizationIds = Array.from(new Set(
    availableOrganizationIds
      .map((organizationId) => organizationId.trim())
      .filter(Boolean),
  ));
  const requestedId = requestedOrganizationId?.trim();
  if (!requestedId) return authorizedOrganizationIds;
  return authorizedOrganizationIds.includes(requestedId) ? [requestedId] : [];
}

function organizerEventReadScope(
  session: RequestSession,
  requestedOrganizationId?: string | null,
) {
  const availableOrganizationIds = session.account.isMasterAdmin
    ? session.account.organizationIds
    : session.account.organizations
        .filter((organization) =>
          (
            organization.role === "owner"
            || (
              organization.role === "admin"
              && organization.permissions.some((permission) =>
                ORGANIZER_EVENT_DASHBOARD_PERMISSIONS.has(permission)
              )
            )
          )
        )
        .map((organization) => organization.organizationId);
  const organizationIds = selectOrganizerWorkspaceOrganizationIds(
    availableOrganizationIds,
    requestedOrganizationId,
  );
  const scopedEventAccess = requestedOrganizationId
    ? session.account.eventAccess.filter(
        (assignment) => assignment.organizationId === requestedOrganizationId,
      )
    : session.account.eventAccess;
  const assignedEventIds = new Set(
    scopedEventAccess
      .filter((assignment) =>
        assignment.permissions.some((permission) =>
          ORGANIZER_EVENT_DASHBOARD_PERMISSIONS.has(permission)
        )
      )
      .map((assignment) => assignment.eventEditionId),
  );
  const assignedOrganizationIds = Array.from(new Set(
    scopedEventAccess
      .filter((assignment) => assignedEventIds.has(assignment.eventEditionId))
      .map((assignment) => assignment.organizationId),
  ));
  return { organizationIds, assignedEventIds, assignedOrganizationIds };
}

export async function getOrganizerEvents(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerManagedEvent[]> {
  if (!session.account.hasOrganizerAccess) {
    throw forbidden("Organizer access is required");
  }
  const { organizationIds, assignedEventIds, assignedOrganizationIds } = organizerEventReadScope(
    session,
    requestedOrganizationId,
  );
  if (!organizationIds.length && !assignedEventIds.size) return [];
  const events = organizationIds.length
    ? await loadOrganizerManagedEvents(organizationIds, env)
    : [];
  if (assignedEventIds.size) {
    const assignedEvents = assignedOrganizationIds.length
      ? await loadOrganizerManagedEvents(assignedOrganizationIds, env)
      : [];
    const eventById = new Map(events.map((event) => [event.id, event]));
    for (const event of assignedEvents) {
      if (assignedEventIds.has(event.id)) eventById.set(event.id, event);
    }
    return withRaceFinishEvidence(Array.from(eventById.values()), env);
  }
  return withRaceFinishEvidence(events, env);
}

export async function getOrganizerEventSummaries(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerManagedEventSummary[]> {
  if (!session.account.hasOrganizerAccess) {
    throw forbidden("Organizer access is required");
  }
  const { organizationIds, assignedEventIds, assignedOrganizationIds } = organizerEventReadScope(
    session,
    requestedOrganizationId,
  );
  if (!organizationIds.length && !assignedEventIds.size) return [];
  const events = organizationIds.length
    ? await loadOrganizerManagedEventSummaries(organizationIds, env)
    : [];
  if (!assignedEventIds.size) return events;

  const assignedEvents = assignedOrganizationIds.length
    ? await loadOrganizerManagedEventSummaries(assignedOrganizationIds, env)
    : [];
  const eventById = new Map(events.map((event) => [event.id, event]));
  for (const event of assignedEvents) {
    if (assignedEventIds.has(event.id)) eventById.set(event.id, event);
  }
  return Array.from(eventById.values());
}

export async function getOrganizerEventEligibleClubOptions(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerEventEligibleClubOption[]> {
  if (!session.account.hasOrganizerAccess) {
    throw forbidden("Organizer access is required");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("clubs")
    .select("id,name,city,country_code,logo_image_url")
    .eq("status", "active")
    .is("merged_into_club_id", null)
    .order("name", { ascending: true })
    .returns<Array<{
      id: string;
      name: string;
      city: string | null;
      country_code: string | null;
      logo_image_url: string | null;
    }>>();
  if (error) throw error;

  return (data ?? []).map((club) => ({
    id: club.id,
    name: club.name,
    city: club.city,
    countryCode: club.country_code,
    logoImageUrl: club.logo_image_url,
  }));
}

export async function getOrganizerEventById(
  session: RequestSession,
  eventRef: string,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
) {
  if (!session.account.hasOrganizerAccess) {
    throw forbidden("Organizer access is required");
  }
  const { organizationIds, assignedEventIds, assignedOrganizationIds } = organizerEventReadScope(
    session,
    requestedOrganizationId,
  );

  if (!organizationIds.length && !assignedEventIds.size) return null;
  const bundledEvent = await loadOrganizerManagedEventBundle(
    organizationIds,
    Array.from(assignedEventIds),
    eventRef,
    env,
  );
  if (bundledEvent !== undefined) return bundledEvent;

  if (organizationIds.length) {
    const [event] = await loadOrganizerManagedEvents(organizationIds, env, eventRef);
    if (event) return (await withRaceFinishEvidence([event], env))[0];
  }
  if (!assignedEventIds.size) return null;

  const assignedEvents = assignedOrganizationIds.length
    ? await loadOrganizerManagedEvents(assignedOrganizationIds, env, eventRef)
    : [];
  const event = assignedEvents.find((candidate) => assignedEventIds.has(candidate.id));
  return event ? (await withRaceFinishEvidence([event], env))[0] : null;
}

function organizerTrackOrganizationIds(
  session: RequestSession,
  requestedOrganizationId?: string | null,
) {
  const availableOrganizationIds = session.account.isMasterAdmin
    ? session.account.organizationIds
    : session.account.organizations
        .filter((organization) =>
          (
            organization.role === "owner"
            || (
              organization.role === "admin"
              && organization.permissions.includes("events.manage")
            )
          )
        )
        .map((organization) => organization.organizationId);
  return selectOrganizerWorkspaceOrganizationIds(
    availableOrganizationIds,
    requestedOrganizationId,
  );
}

export async function getOrganizerTracks(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerManagedTrack[]> {
  if (!session.account.hasOrganizerAccess) {
    throw forbidden("Organizer access is required");
  }
  const organizationIds = organizerTrackOrganizationIds(session, requestedOrganizationId);
  return organizationIds.length
    ? loadOrganizerManagedTracks(organizationIds, env)
    : [];
}

export async function getOrganizerTrackSummaries(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerManagedTrackSummary[]> {
  if (!session.account.hasOrganizerAccess) {
    throw forbidden("Organizer access is required");
  }
  const organizationIds = organizerTrackOrganizationIds(session, requestedOrganizationId);
  const tracks = organizationIds.length
    ? await loadOrganizerManagedTracks(organizationIds, env, { includeGallery: false, includeGeometry: false })
    : [];
  return tracks.map((track) => {
    const {
      galleryItems: _galleryItems,
      routePoints: _routePoints,
      elevationPoints: _elevationPoints,
      checkpoints: _checkpoints,
      ...summary
    } = track;
    return summary;
  });
}

export async function getOrganizerTrackById(
  session: RequestSession,
  trackRef: string,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerManagedTrack | null> {
  if (!session.account.hasOrganizerAccess) {
    throw forbidden("Organizer access is required");
  }
  const organizationIds = organizerTrackOrganizationIds(session, requestedOrganizationId);
  if (!organizationIds.length) return null;
  const [track] = await loadOrganizerManagedTracks(organizationIds, env, { trackRef });
  return track ?? null;
}

export async function getOrganizerLeagueSeasons(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerManagedLeagueSeason[]> {
  if (!session.account.hasOrganizerAccess || !session.account.organizationIds.length) {
    throw forbidden("Organizer access is required");
  }
  const organizationIds = selectOrganizerWorkspaceOrganizationIds(
    session.account.organizationIds,
    requestedOrganizationId,
  );
  return organizationIds.length
    ? loadOrganizerManagedLeagueSeasons(organizationIds, env)
    : [];
}

export async function getOrganizerLeagueSeasonById(
  session: RequestSession,
  seasonId: string,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerManagedLeagueSeason> {
  if (!session.account.hasOrganizerAccess || !session.account.organizationIds.length) {
    throw forbidden("Organizer access is required");
  }

  const organizationIds = selectOrganizerWorkspaceOrganizationIds(
    session.account.organizationIds,
    requestedOrganizationId,
  );
  const seasons = organizationIds.length
    ? await loadOrganizerManagedLeagueSeasons(organizationIds, env)
    : [];
  const season = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
  if (!season) {
    throw notFound("League season not found");
  }

  return season;
}

export async function createOrganizerEvent(
  session: RequestSession,
  input: CreateOrganizerEventInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const organizationId = input.organizationId?.trim() || session.account.organizationIds[0];
  if (!organizationId) {
    throw forbidden("Organizer access is required");
  }

  requireOrganizationAccess(session, organizationId, "events.manage");

  const baseName = input.name.trim();
  const editionLabel = input.editionLabel?.trim() ?? "";
  const displayName = editionLabel ? `${baseName} ${editionLabel}` : baseName;
  const seriesName = baseName || displayName;
  const seriesBaseSlug = slugify(seriesName);
  const editionBaseSlug = slugify(displayName);

  let seriesId: string;
  const { data: existingSeries, error: existingSeriesError } = await adminClient
    .from("event_series")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("slug", seriesBaseSlug)
    .maybeSingle<{ id: string }>();

  if (existingSeriesError) throw existingSeriesError;

  if (existingSeries) {
    seriesId = existingSeries.id;
  } else {
    const seriesSlug = await uniqueScopedSlug(
      {
        table: "event_series",
        scopeColumn: "organization_id",
        scopeValue: organizationId,
        baseSlug: seriesBaseSlug,
      },
      env,
    );

    const { data: series, error: seriesError } = await adminClient
      .from("event_series")
      .insert({
        organization_id: organizationId,
        slug: seriesSlug,
        name: seriesName,
        description: input.description ?? null,
        location_name: input.locationName ?? null,
        country_code: normalizeGuestCountryCode(input.countryCode),
        status: "active",
      })
      .select("id")
      .single<{ id: string }>();

    if (seriesError) throw seriesError;
    seriesId = series.id;
  }

  if (input.countryCode !== undefined) {
    const { error: countryCodeError } = await adminClient
      .from("event_series")
      .update({ country_code: normalizeGuestCountryCode(input.countryCode) })
      .eq("id", seriesId);
    if (countryCodeError) throw countryCodeError;
  }

  const editionSlug = await uniqueGlobalEventEditionSlug(editionBaseSlug, env);

  const editionInsert = {
    event_series_id: seriesId,
    slug: editionSlug,
    name: displayName,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    timezone: input.timezone?.trim() || "Europe/Zagreb",
    registration_open_at: input.registrationOpenAt ?? null,
    registration_close_at: input.registrationCloseAt ?? null,
    location_name: input.locationName ?? null,
    activity_type: input.activityType ?? DEFAULT_EVENT_ACTIVITY_TYPE,
    public_visibility: input.publicVisibility ?? "private",
    registration_access: input.registrationAccess ?? "open",
    cover_image_url: optionalText(input.coverImageUrl),
    about_text: optionalText(input.aboutText),
    organizer_rules: optionalText(input.organizerRules),
    website_url: optionalText(input.websiteUrl),
    instagram_url: optionalText(input.instagramUrl),
    facebook_url: optionalText(input.facebookUrl),
    general_timeline_json:
      input.generalTimeline
        ?.map((item) => ({
          time: item.time.trim(),
          description: item.description.trim(),
        }))
        .filter((item) => item.time.length && item.description.length) ?? [],
    status: input.status ?? "registration_open",
  };

  let edition: { id: string } | null = null;
  try {
    const result = await adminClient
      .from("event_editions")
      .insert(editionInsert)
      .select("id")
      .single<{ id: string }>();

    if (result.error) throw result.error;
    edition = result.data;
  } catch (error) {
    if (!isSchemaCompatError(error)) throw error;

    const fallbackResult = await adminClient
      .from("event_editions")
      .insert({
        event_series_id: seriesId,
        slug: editionSlug,
        name: displayName,
        start_date: input.startDate,
        end_date: input.endDate ?? null,
        timezone: input.timezone?.trim() || "Europe/Zagreb",
        registration_open_at: input.registrationOpenAt ?? null,
        registration_close_at: input.registrationCloseAt ?? null,
        location_name: input.locationName ?? null,
        status: input.status ?? "registration_open",
      })
      .select("id")
      .single<{ id: string }>();

    if (fallbackResult.error) throw fallbackResult.error;
    edition = fallbackResult.data;
  }

  if (!edition) throw conflict("Race could not be created");

  await replaceEventEditionSports(adminClient, edition.id, {
    sportCodes: input.sportCodes,
    primarySportCode: input.primarySportCode,
  });
  await replaceOrganizerEventLocations(edition.id, input.locations, env);
  if (input.registrationAccess !== undefined || input.eligibleClubIds !== undefined) {
    const { error: registrationAccessError } = await adminClient.rpc(
      "service_set_event_registration_access",
      {
        p_event_edition_id: edition.id,
        p_registration_access: input.registrationAccess ?? "open",
        p_club_ids: input.eligibleClubIds ?? [],
      },
    );
    if (registrationAccessError) {
      if (registrationAccessError.message.includes("event_eligible_club_required")) {
        throw badRequest("Select at least one eligible club for a club-members race");
      }
      if (registrationAccessError.message.includes("event_eligible_club_invalid")) {
        throw badRequest("One or more eligible clubs are no longer active");
      }
      throw registrationAccessError;
    }
  }

  const created = await getOrganizerEventById(session, edition.id, env);
  if (!created) throw notFound("Created race could not be loaded");
  return created;
}

export async function updateOrganizerEvent(
  session: RequestSession,
  input: UpdateOrganizerEventInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireEditionAccess(session, input.id, "manage", env);

  if (input.registrationAccess !== undefined || input.eligibleClubIds !== undefined) {
    const { error: registrationAccessError } = await adminClient.rpc(
      "service_set_event_registration_access",
      {
        p_event_edition_id: input.id,
        p_registration_access: input.registrationAccess ?? "open",
        p_club_ids: input.eligibleClubIds ?? [],
      },
    );
    if (registrationAccessError) {
      if (registrationAccessError.message.includes("event_eligible_club_required")) {
        throw badRequest("Select at least one eligible club for a club-members race");
      }
      if (registrationAccessError.message.includes("event_eligible_club_invalid")) {
        throw badRequest("One or more eligible clubs are no longer active");
      }
      throw registrationAccessError;
    }
  }

  const { data: currentEdition, error: currentEditionError } = await adminClient
    .from("event_editions")
    .select("status,published_at,registration_open_at,registration_close_at")
    .eq("id", input.id)
    .maybeSingle<{
      status: string;
      published_at: string | null;
      registration_open_at: string | null;
      registration_close_at: string | null;
    }>();
  if (currentEditionError) throw currentEditionError;
  if (!currentEdition) throw notFound("Race not found");

  const editionPatch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const nextName = input.name.trim();
    const nextEditionLabel = input.editionLabel?.trim() ?? "";
    editionPatch.name = nextEditionLabel ? `${nextName} ${nextEditionLabel}` : nextName;
  }
  if (input.startDate !== undefined) editionPatch.start_date = input.startDate;
  if (input.endDate !== undefined) editionPatch.end_date = input.endDate;
  if (input.timezone !== undefined) editionPatch.timezone = input.timezone.trim();
  if (input.registrationOpenAt !== undefined) {
    editionPatch.registration_open_at = input.registrationOpenAt;
  }
  if (input.registrationCloseAt !== undefined) {
    editionPatch.registration_close_at = input.registrationCloseAt;
  }
  if (input.locationName !== undefined) editionPatch.location_name = input.locationName;
  if (input.activityType !== undefined) editionPatch.activity_type = input.activityType;
  if (input.publicVisibility !== undefined) editionPatch.public_visibility = input.publicVisibility;
  if (input.coverImageUrl !== undefined) editionPatch.cover_image_url = optionalText(input.coverImageUrl);
  if (input.aboutText !== undefined) editionPatch.about_text = optionalText(input.aboutText);
  if (input.organizerRules !== undefined) editionPatch.organizer_rules = optionalText(input.organizerRules);
  if (input.websiteUrl !== undefined) editionPatch.website_url = optionalText(input.websiteUrl);
  if (input.instagramUrl !== undefined) editionPatch.instagram_url = optionalText(input.instagramUrl);
  if (input.facebookUrl !== undefined) editionPatch.facebook_url = optionalText(input.facebookUrl);
  if (input.generalTimeline !== undefined) {
    editionPatch.general_timeline_json = input.generalTimeline
      .map((item) => ({
        time: item.time.trim(),
        description: item.description.trim(),
      }))
      .filter((item) => item.time.length && item.description.length);
  }
  const nextStatus = resolveOrganizerEventUpdateStatus({
    currentStatus: currentEdition.status,
    publishedAt: currentEdition.published_at,
    currentRegistrationOpenAt: currentEdition.registration_open_at,
    currentRegistrationCloseAt: currentEdition.registration_close_at,
    requestedStatus: input.status,
    registrationOpenAt: input.registrationOpenAt,
    registrationCloseAt: input.registrationCloseAt,
  });
  if (nextStatus !== undefined) editionPatch.status = nextStatus;

  if (Object.keys(editionPatch).length) {
    try {
      const { error } = await adminClient
        .from("event_editions")
        .update(editionPatch)
        .eq("id", input.id);
      if (error) throw error;
    } catch (error) {
      if (!isSchemaCompatError(error)) throw error;

      const fallbackPatch: Record<string, string | null> = {};
      if (input.name !== undefined) {
        const nextName = input.name.trim();
        const nextEditionLabel = input.editionLabel?.trim() ?? "";
        fallbackPatch.name = nextEditionLabel ? `${nextName} ${nextEditionLabel}` : nextName;
      }
      if (input.startDate !== undefined) fallbackPatch.start_date = input.startDate;
      if (input.endDate !== undefined) fallbackPatch.end_date = input.endDate;
      if (input.timezone !== undefined) fallbackPatch.timezone = input.timezone.trim();
      if (input.registrationOpenAt !== undefined) {
        fallbackPatch.registration_open_at = input.registrationOpenAt;
      }
      if (input.registrationCloseAt !== undefined) {
        fallbackPatch.registration_close_at = input.registrationCloseAt;
      }
      if (input.locationName !== undefined) fallbackPatch.location_name = input.locationName;
      if (editionPatch.status !== undefined) fallbackPatch.status = String(editionPatch.status);

      if (Object.keys(fallbackPatch).length) {
        const { error: fallbackError } = await adminClient
          .from("event_editions")
          .update(fallbackPatch)
          .eq("id", input.id);
        if (fallbackError) throw fallbackError;
      }
    }
  }

  if (input.description !== undefined) {
    const { error } = await adminClient
      .from("event_series")
      .update({ description: input.description })
      .eq("id", input.seriesId);
    if (error) throw error;
  }

  if (input.countryCode !== undefined) {
    const { error } = await adminClient
      .from("event_series")
      .update({ country_code: normalizeGuestCountryCode(input.countryCode) })
      .eq("id", input.seriesId);
    if (error) throw error;
  }

  if (input.sportCodes !== undefined || input.primarySportCode !== undefined) {
    await replaceEventEditionSports(adminClient, input.id, {
      sportCodes: input.sportCodes,
      primarySportCode: input.primarySportCode,
    });
  }
  await replaceOrganizerEventLocations(input.id, input.locations, env);

  const updated = await getOrganizerEventById(session, input.id, env);
  if (!updated) throw notFound("Updated race could not be loaded");
  return updated;
}

function organizerEventPublishBlockerKey(blocker: {
  code: string;
  categoryId?: string;
}) {
  return `${blocker.code}:${blocker.categoryId ?? "event"}`;
}

export function getPrivateOrganizerEventTrackVersions(input: {
  snapshots: Array<{ trackTemplateId: string; trackVersionId: string }>;
  versions: Array<{ id: string; trackTemplateId: string; publishedAt: string | null }>;
}) {
  const versionById = new Map(input.versions.map((version) => [version.id, version]));
  const privateVersions = new Map<string, { trackTemplateId: string; trackVersionId: string }>();

  for (const snapshot of input.snapshots) {
    const version = versionById.get(snapshot.trackVersionId);
    if (!version || version.trackTemplateId !== snapshot.trackTemplateId) {
      throw conflict("A race is linked to an invalid route version");
    }
    if (!version.publishedAt) {
      privateVersions.set(version.id, {
        trackTemplateId: snapshot.trackTemplateId,
        trackVersionId: version.id,
      });
    }
  }

  return Array.from(privateVersions.values());
}

async function publishPrivateTracksLinkedToOrganizerEvent(
  session: RequestSession,
  eventId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: categories, error: categoriesError } = await adminClient
    .from("event_categories")
    .select("id,status,results_mode")
    .eq("event_edition_id", eventId)
    .returns<Array<{ id: string; status: string; results_mode: string }>>();

  if (categoriesError) throw categoriesError;
  const categoryIds = (categories ?? [])
    .filter((category) => category.status !== "draft" && mapCategoryType(category.results_mode) === "competitive")
    .map((category) => category.id);
  if (!categoryIds.length) return;

  const { data: snapshots, error: snapshotsError } = await adminClient
    .from("event_category_track_snapshots")
    .select("track_template_id,track_version_id")
    .in("event_category_id", categoryIds)
    .returns<Array<{ track_template_id: string; track_version_id: string }>>();

  if (snapshotsError) throw snapshotsError;
  const versionIds = Array.from(new Set((snapshots ?? []).map((snapshot) => snapshot.track_version_id)));
  if (!versionIds.length) return;

  const { data: versions, error: versionsError } = await adminClient
    .from("track_versions")
    .select("id,track_template_id,published_at")
    .in("id", versionIds)
    .returns<Array<{ id: string; track_template_id: string; published_at: string | null }>>();

  if (versionsError) throw versionsError;
  const privateVersions = getPrivateOrganizerEventTrackVersions({
    snapshots: (snapshots ?? []).map((snapshot) => ({
      trackTemplateId: snapshot.track_template_id,
      trackVersionId: snapshot.track_version_id,
    })),
    versions: (versions ?? []).map((version) => ({
      id: version.id,
      trackTemplateId: version.track_template_id,
      publishedAt: version.published_at,
    })),
  });

  for (const version of privateVersions) {
    await publishOrganizerTrackVersion(
      session,
      version.trackTemplateId,
      version.trackVersionId,
      env,
    );
  }
}

export async function publishOrganizerEvent(
  session: RequestSession,
  eventId: string,
  input: {
    acknowledgedBlockerKeys?: string[];
  } = {},
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const editionContext = await requireEditionAccess(session, eventId, "manage", env);
  const readiness = await getOrganizerEventPublishReadiness(session, eventId, env);
  const acknowledgedBlockerKeys = new Set(input.acknowledgedBlockerKeys ?? []);
  const overriddenBlockers = readiness.blockers.filter(
    (blocker) => blocker.overridable && acknowledgedBlockerKeys.has(blocker.key),
  );
  const remainingBlockers = readiness.blockers.filter(
    (blocker) => !blocker.overridable || !acknowledgedBlockerKeys.has(blocker.key),
  );
  if (remainingBlockers.length) {
    throw conflict("Resolve the race publishing blockers before going live", {
      blockers: remainingBlockers,
      warnings: readiness.warnings,
    });
  }

  const now = new Date().toISOString();
  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("status,is_practice,registration_open_at,registration_close_at")
    .eq("id", eventId)
    .maybeSingle<{
      status: string;
      is_practice: boolean;
      registration_open_at: string | null;
      registration_close_at: string | null;
    }>();

  if (editionError) throw editionError;
  if (!edition) throw notFound("Race not found");
  if (edition.is_practice) {
    throw conflict("Practice races stay private and cannot be published");
  }

  await publishPrivateTracksLinkedToOrganizerEvent(session, eventId, env);

  const { error } = await adminClient
    .from("event_editions")
    .update({
      published_at: now,
      public_visibility: "public",
      status: derivePublishedEventStatus(
        edition.status,
        edition.registration_open_at,
        edition.registration_close_at,
        new Date(now),
      ),
    })
    .eq("id", eventId);

  if (error) throw error;

  if (overriddenBlockers.length) {
    const { error: auditError } = await adminClient.from("audit_log").insert({
      organization_id: editionContext.organizationId,
      actor_user_id: session.account.userId,
      entity_type: "event_edition",
      entity_id: eventId,
      action: "event.publish_blockers_overridden",
      metadata_json: {
        publishedAt: now,
        blockerKeys: overriddenBlockers.map((blocker) => blocker.key),
        blockers: overriddenBlockers.map((blocker) => ({
          code: blocker.code,
          categoryId: blocker.categoryId ?? null,
          categoryName: blocker.categoryName ?? null,
          message: blocker.message,
        })),
      },
    });
    if (auditError) throw auditError;
  }

  const published = await getOrganizerEventById(session, eventId, env);
  if (!published) throw notFound("Published race could not be loaded");
  return published;
}

export async function unpublishOrganizerEvent(
  session: RequestSession,
  eventId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireEditionAccess(session, eventId, "manage", env);

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("status")
    .eq("id", eventId)
    .maybeSingle<{ status: string }>();

  if (editionError) throw editionError;
  if (!edition) throw notFound("Race not found");

  const { error } = await adminClient
    .from("event_editions")
    .update({
      published_at: null,
      public_visibility: "private",
      status: edition.status === "published" ? "draft" : edition.status,
    })
    .eq("id", eventId);

  if (error) throw error;

  const updated = await getOrganizerEventById(session, eventId, env);
  if (!updated) throw notFound("Updated race could not be loaded");
  return updated;
}

export type OrganizerEventPublishReadiness = {
  ready: boolean;
  communications: { ready: boolean; savedCount: number };
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

type OrganizerEventRacePublishCandidate = {
  id: string;
  name: string;
  status: string;
  results_mode: string;
};

export function getOrganizerEventRaceStatusPublishBlockers(
  categories: OrganizerEventRacePublishCandidate[],
) {
  const races = categories.filter(
    (category) => mapCategoryType(category.results_mode) === "competitive",
  );
  if (races.some((race) => race.status !== "draft")) return [];

  if (!races.length) {
    return [{
      code: "competitive_race_missing",
      message: "Add at least one race before publishing this race.",
    }];
  }

  return races.map((race) => ({
    code: "race_still_draft",
    message: `${race.name} is still a draft. Set the race status to Published before publishing this race.`,
    categoryId: race.id,
    categoryName: race.name,
  }));
}

export async function getOrganizerEventPublishReadiness(
  session: RequestSession,
  eventId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerEventPublishReadiness> {
  const adminClient = createAdminSupabaseClient(env);
  const editionContext = await requireEditionAccess(session, eventId, "manage", env);
  const blockers: Array<Omit<OrganizerEventPublishReadiness["blockers"][number], "key" | "overridable">> = [];
  const warnings: OrganizerEventPublishReadiness["warnings"] = [];

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select(
      "id,name,start_date,end_date,timezone,location_name,registration_open_at,registration_close_at",
    )
    .eq("id", eventId)
    .maybeSingle<{
      id: string;
      name: string;
      start_date: string;
      end_date: string | null;
      timezone: string;
      location_name: string | null;
      registration_open_at: string | null;
      registration_close_at: string | null;
    }>();

  if (editionError) throw editionError;
  if (!edition) throw notFound("Race not found");

  if (!edition.name.trim()) {
    blockers.push({ code: "event_name_missing", message: "Add the race name." });
  }
  if (!edition.start_date) {
    blockers.push({ code: "event_date_missing", message: "Add the race date." });
  }
  if (!edition.timezone.trim()) {
    blockers.push({ code: "event_timezone_missing", message: "Choose the race timezone." });
  }
  if (
    edition.registration_open_at
    && edition.registration_close_at
    && edition.registration_open_at >= edition.registration_close_at
  ) {
    blockers.push({
      code: "registration_window_invalid",
      message: "Registration must close after it opens.",
    });
  }
  if (!edition.location_name?.trim()) {
    warnings.push({ code: "event_location_missing", message: "Add a public location." });
  }

  const { data: categories, error: categoriesError } = await adminClient
    .from("event_categories")
    .select(
      "id,name,status,results_mode,sport_code,distance_km,elevation_gain_m,start_at,registration_fee_cents,registration_fee_periods,currency",
    )
    .eq("event_edition_id", eventId)
    .returns<Array<{
      id: string;
      name: string;
      status: string;
      results_mode: string;
      sport_code: SportCode;
      distance_km: string | number | null;
      elevation_gain_m: number | null;
      start_at: string | null;
      registration_fee_cents: number | null;
      registration_fee_periods?: RaceFeePeriod[];
      currency: string | null;
    }>>();

  if (categoriesError) throw categoriesError;
  blockers.push(...getOrganizerEventRaceStatusPublishBlockers(categories ?? []));
  const competitiveCategories = (categories ?? []).filter(
    (category) => category.status !== "draft" && mapCategoryType(category.results_mode) === "competitive",
  );

  const categoryIds = competitiveCategories.map((category) => category.id);
  const [
    { data: snapshots, error: snapshotsError },
    { data: forms, error: formsError },
    { data: bankTransferProfile, error: bankTransferProfileError },
    { data: eventPaymentSetting, error: eventPaymentSettingError },
    communications,
  ] = await Promise.all([
    categoryIds.length
      ? adminClient
          .from("event_category_track_snapshots")
          .select("event_category_id")
          .in("event_category_id", categoryIds)
          .returns<Array<{ event_category_id: string }>>()
      : Promise.resolve({ data: [] as Array<{ event_category_id: string }>, error: null }),
    categoryIds.length
      ? adminClient
          .from("registration_form_versions")
          .select("id,event_category_id")
          .in("event_category_id", categoryIds)
          .eq("status", "published")
          .returns<Array<{ id: string; event_category_id: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; event_category_id: string }>, error: null }),
    adminClient
      .from("organization_bank_transfer_profiles")
      .select("id,is_active,updated_at")
      .eq("organization_id", editionContext.organizationId)
      .maybeSingle<{
        id: string;
        is_active: boolean;
        updated_at: string;
      }>(),
    adminClient
      .from("event_bank_transfer_settings")
      .select("bank_transfer_profile_id,is_enabled,onsite_payment_enabled,confirmed_at")
      .eq("event_edition_id", eventId)
      .maybeSingle<{
        bank_transfer_profile_id: string | null;
        is_enabled: boolean;
        onsite_payment_enabled: boolean;
        confirmed_at: string;
      }>(),
    readEventEmailSetupStatus(adminClient, eventId),
  ]);

  if (snapshotsError) throw snapshotsError;
  if (formsError) throw formsError;
  if (bankTransferProfileError) throw bankTransferProfileError;
  if (eventPaymentSettingError) throw eventPaymentSettingError;
  if (!communications.ready) {
    blockers.push({ code: "event_communication_not_configured", message: "Save all three email templates in the Communication step before publishing." });
  }

  const paidCategories = competitiveCategories.filter(
    (category) => (category.registration_fee_cents ?? 0) > 0,
  );
  if (paidCategories.length) {
    const bankTransferEnabled = eventPaymentSetting?.is_enabled === true;
    const onsitePaymentEnabled = eventPaymentSetting?.onsite_payment_enabled === true;
    if (!bankTransferEnabled && !onsitePaymentEnabled) {
      blockers.push({
        code: "event_payment_not_confirmed",
        message: "Choose and save at least one payment method for this paid race.",
      });
    } else if (bankTransferEnabled && !bankTransferProfile?.is_active) {
      blockers.push({
        code: "payment_account_not_ready",
        message: "Configure and activate the organizer bank-transfer details, or disable bank transfer for this race.",
      });
    } else if (bankTransferEnabled && bankTransferProfile && (
      !eventPaymentSetting
      || eventPaymentSetting.bank_transfer_profile_id !== bankTransferProfile.id
      || Date.parse(eventPaymentSetting.confirmed_at) < Date.parse(bankTransferProfile.updated_at)
    )) {
      blockers.push({
        code: "event_payment_not_confirmed",
        message: "Review and save the race payment methods with the current organizer bank details.",
      });
    }
  }

  const snapshotCategoryIds = new Set((snapshots ?? []).map((snapshot) => snapshot.event_category_id));
  const formsByCategoryId = new Map((forms ?? []).map((form) => [form.event_category_id, form.id]));
  const formIds = (forms ?? []).map((form) => form.id);
  const { data: requiredDocuments, error: requiredDocumentsError } = formIds.length
    ? await adminClient
        .from("registration_legal_documents")
        .select("form_version_id")
        .in("form_version_id", formIds)
        .eq("is_required", true)
        .returns<Array<{ form_version_id: string }>>()
    : { data: [] as Array<{ form_version_id: string }>, error: null };
  if (requiredDocumentsError) throw requiredDocumentsError;
  const formIdsWithRequiredDocuments = new Set(
    (requiredDocuments ?? []).map((document) => document.form_version_id),
  );

  for (const category of competitiveCategories) {
    const categoryContext = { categoryId: category.id, categoryName: category.name };
    if (!category.start_at) {
      blockers.push({
        code: "race_start_missing",
        message: `${category.name} needs a start date and time.`,
        ...categoryContext,
      });
    }
    if (Number(category.distance_km ?? 0) <= 0) {
      blockers.push({
        code: "race_distance_missing",
        message: `${category.name} needs a positive route distance.`,
        ...categoryContext,
      });
    }
    if (!snapshotCategoryIds.has(category.id)) {
      blockers.push({
        code: "race_route_missing",
        message: `${category.name} needs an immutable route snapshot.`,
        ...categoryContext,
      });
    }
    const formId = formsByCategoryId.get(category.id);
    if (!formId || !formIdsWithRequiredDocuments.has(formId)) {
      blockers.push({
        code: "registration_contract_missing",
        message: `${category.name} needs a published registration form with required terms.`,
        ...categoryContext,
      });
    }
    if ((category.registration_fee_cents ?? 0) > 0) {
      if (!category.currency?.trim()) {
        blockers.push({
          code: "race_currency_missing",
          message: `${category.name} needs a currency for its entry fee.`,
          ...categoryContext,
        });
      }
    }
    if (
      (category.sport_code === "trail_running" || category.sport_code === "mountain_biking")
      && (category.elevation_gain_m ?? 0) <= 0
    ) {
      warnings.push({
        code: "race_elevation_missing",
        message: `${category.name} has no positive elevation gain.`,
        ...categoryContext,
      });
    }
  }

  return {
    ready: blockers.length === 0,
    communications,
    blockers: blockers.map((blocker) => ({
      ...blocker,
      key: organizerEventPublishBlockerKey(blocker),
      overridable: blocker.code !== "event_communication_not_configured",
    })),
    warnings,
  };
}

export async function deleteOrganizerEvent(
  session: RequestSession,
  eventId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireEditionAccess(session, eventId, "manage", env);

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("id,event_series_id,status,published_at")
    .eq("id", eventId)
    .is("organizer_deleted_at", null)
    .maybeSingle<{ id: string; event_series_id: string; status: string; published_at: string | null }>();
  if (editionError) throw editionError;
  if (!edition) throw notFound("Race not found");

  const { data: categories, error: categoriesError } = await adminClient
    .from("event_categories")
    .select("id")
    .eq("event_edition_id", eventId)
    .returns<Array<{ id: string }>>();

  if (categoriesError) throw categoriesError;

  const categoryIds = (categories ?? []).map((category) => category.id);
  let retainedRegistrationCount = 0;
  if (categoryIds.length) {
    const { count: visibleRegistrationCount, error: registrationError } = await adminClient
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .in("event_category_id", categoryIds)
      .is("organizer_removed_at", null);

    if (registrationError) throw registrationError;
    if ((visibleRegistrationCount ?? 0) > 0) {
      throw conflict("Cannot delete a race that already has registrations");
    }

    const { count, error: retainedRegistrationError } = await adminClient
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .in("event_category_id", categoryIds);
    if (retainedRegistrationError) throw retainedRegistrationError;
    retainedRegistrationCount = count ?? 0;

    if (retainedRegistrationCount === 0 && edition.status === "draft" && !edition.published_at) {
      const { data: formVersions, error: formVersionsError } = await adminClient
        .from("registration_form_versions")
        .select("id")
        .in("event_category_id", categoryIds)
        .returns<Array<{ id: string }>>();
      if (formVersionsError) throw formVersionsError;

      const formVersionIds = (formVersions ?? []).map((form) => form.id);
      if (formVersionIds.length) {
        const { error: formFieldsDeleteError } = await adminClient
          .from("registration_form_fields")
          .delete()
          .in("form_version_id", formVersionIds);
        if (formFieldsDeleteError) throw formFieldsDeleteError;

        const { error: legalDocumentsDeleteError } = await adminClient
          .from("registration_legal_documents")
          .delete()
          .in("form_version_id", formVersionIds);
        if (legalDocumentsDeleteError) throw legalDocumentsDeleteError;

        const { error: formVersionsDeleteError } = await adminClient
          .from("registration_form_versions")
          .delete()
          .in("id", formVersionIds);
        if (formVersionsDeleteError) throw formVersionsDeleteError;
      }
    }
  }

  if (retainedRegistrationCount > 0 || edition.status !== "draft" || edition.published_at) {
    // Retained registration and lifecycle evidence stays immutable. The
    // atomic tombstone makes the event disappear from organizer and public
    // reads without breaking those audit links.
    const { error: tombstoneError } = await adminClient.rpc(
      "service_delete_organizer_event",
      {
        p_event_edition_id: eventId,
        p_actor_user_id: session.account.userId,
      },
    );
    if (tombstoneError) {
      const errorMessage = tombstoneError.message?.toLowerCase() ?? "";
      if (tombstoneError.code === "23514" && errorMessage.includes("event_has_visible_registrations")) {
        throw conflict("Cannot delete a race that already has registrations");
      }
      if (tombstoneError.code === "P0002" && errorMessage.includes("event_not_found")) {
        throw notFound("Race not found");
      }
      throw tombstoneError;
    }
    return { deleted: true, eventId };
  }

  const [roundEventResponse, legacyRoundResponse] = await Promise.all([
    adminClient
      .from("league_round_events")
      .select("id,league_season_id")
      .eq("event_edition_id", eventId)
      .returns<Array<{ id: string; league_season_id: string }>>(),
    adminClient
      .from("league_rounds")
      .select("id,league_season_id")
      .eq("event_edition_id", eventId)
      .returns<Array<{ id: string; league_season_id: string }>>(),
  ]);
  if (roundEventResponse.error && !isSchemaCompatError(roundEventResponse.error)) {
    throw roundEventResponse.error;
  }
  if (legacyRoundResponse.error) throw legacyRoundResponse.error;

  const linkedRoundEvents = roundEventResponse.data ?? [];
  const linkedRoundEventIds = linkedRoundEvents.map((round) => round.id);
  const affectedSeasonIds = Array.from(new Set([
    ...linkedRoundEvents.map((round) => round.league_season_id),
    ...(legacyRoundResponse.data ?? []).map((round) => round.league_season_id),
  ]));

  // Generated league occurrences retain both the event and its round with
  // restrictive foreign keys. Remove those derivative records before either
  // parent so a draft event can be deleted directly from the events workspace.
  const { error: occurrenceByEventError } = await adminClient
    .from("league_recurrence_occurrences")
    .delete()
    .eq("event_edition_id", eventId);
  if (occurrenceByEventError && !isSchemaCompatError(occurrenceByEventError)) {
    throw occurrenceByEventError;
  }
  if (linkedRoundEventIds.length) {
    const { error: occurrenceByRoundError } = await adminClient
      .from("league_recurrence_occurrences")
      .delete()
      .in("league_round_event_id", linkedRoundEventIds);
    if (occurrenceByRoundError && !isSchemaCompatError(occurrenceByRoundError)) {
      throw occurrenceByRoundError;
    }

    const { error: roundEventDeleteError } = await adminClient
      .from("league_round_events")
      .delete()
      .in("id", linkedRoundEventIds);
    if (roundEventDeleteError) throw roundEventDeleteError;
  }

  const { error: legacyRoundDeleteError } = await adminClient
    .from("league_rounds")
    .delete()
    .eq("event_edition_id", eventId);
  if (legacyRoundDeleteError) throw legacyRoundDeleteError;

  const { error } = await adminClient.from("event_editions").delete().eq("id", eventId);
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw conflict("Cannot delete a race that has retained finance, publication, or operations records");
    }
    throw error;
  }

  for (const seasonId of affectedSeasonIds) {
    await reorderOrganizerLeagueRoundsChronologically(adminClient, seasonId);
  }

  let eventSeriesDeleted = false;
  const { count: remainingEditionCount, error: remainingEditionError } = await adminClient
    .from("event_editions")
    .select("id", { count: "exact", head: true })
    .eq("event_series_id", edition.event_series_id);
  if (remainingEditionError) throw remainingEditionError;

  if ((remainingEditionCount ?? 0) === 0) {
    const { count: recurrenceRuleCount, error: recurrenceRuleError } = await adminClient
      .from("league_recurrence_rules")
      .select("id", { count: "exact", head: true })
      .eq("event_series_id", edition.event_series_id);
    if (recurrenceRuleError && !isSchemaCompatError(recurrenceRuleError)) throw recurrenceRuleError;

    if ((recurrenceRuleCount ?? 0) === 0) {
      const { error: seriesDeleteError } = await adminClient
        .from("event_series")
        .delete()
        .eq("id", edition.event_series_id);
      if (seriesDeleteError && !isForeignKeyViolation(seriesDeleteError)) throw seriesDeleteError;
      eventSeriesDeleted = !seriesDeleteError;
    }
  }

  return { deleted: true, eventId, eventSeriesDeleted };
}

export async function createOrganizerCategory(
  session: RequestSession,
  eventEditionId: string,
  input: CreateOrganizerCategoryInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireEditionAccess(session, eventEditionId, "manage", env);
  const feeIssue = validateRaceFeePeriods(input.feePeriods ?? [], input.startAt);
  if (feeIssue) throw badRequest(feeIssue);
  const courseFormat = input.categoryType === "informative"
    ? "standard"
    : normalizeCourseFormat(input.courseFormat);
  const lapCount = normalizeLapCount(courseFormat, input.lapCount);
  if (courseFormat === "laps" && (input.lapCount ?? 0) < 2) {
    throw badRequest("A lap route must use at least two laps");
  }

  async function loadCategoryForIdempotencyKey() {
    if (!input.idempotencyKey) return null;
    const { data, error } = await adminClient
      .from("event_categories")
      .select("id")
      .eq("event_edition_id", eventEditionId)
      .eq("creation_idempotency_key", input.idempotencyKey)
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!data) return null;

    const event = await getOrganizerEventById(session, eventEditionId, env);
    return event?.categories.find((item) => item.id === data.id) ?? null;
  }

  const existingCategory = await loadCategoryForIdempotencyKey();
  if (existingCategory) {
    await ensureDefaultRegistrationConfiguration(existingCategory.id, session.account.userId, env);
    return existingCategory;
  }

  const categorySlug = await uniqueScopedSlug(
    {
      table: "event_categories",
      scopeColumn: "event_edition_id",
      scopeValue: eventEditionId,
      baseSlug: slugify(input.name),
    },
    env,
  );

  const displayOrder =
    input.displayOrder !== undefined
      ? input.displayOrder
      : await adminClient
          .from("event_categories")
          .select("display_order")
          .eq("event_edition_id", eventEditionId)
          .order("display_order", { ascending: false })
          .limit(1)
          .returns<Array<{ display_order: number | null }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return (data?.[0]?.display_order ?? -1) + 1;
          });

  const sportCode = input.sportCode ?? await loadPrimaryEventSport(adminClient, eventEditionId);

  const { data: category, error } = await adminClient
    .from("event_categories")
    .insert({
      event_edition_id: eventEditionId,
      slug: categorySlug,
      name: input.name,
      cover_image_url: optionalText(input.coverImageUrl),
      creation_idempotency_key: input.idempotencyKey ?? null,
      sport_code: sportCode,
      results_mode: mapResultsMode(input.categoryType),
      course_format: courseFormat,
      lap_count: lapCount,
      ranking_config_json: normalizeCompetitiveRankingConfig(input.rankingConfig ?? defaultCompetitiveRankingConfig()),
      distance_km: input.distanceKm ?? null,
      elevation_gain_m: input.elevationGainM ?? null,
      capacity: input.capacity ?? null,
      registration_fee_cents: input.feeCents ?? null,
      registration_fee_periods: input.feePeriods ?? [],
      currency: input.currency ?? "EUR",
      minimum_age: input.minimumAge ?? null,
      maximum_age: input.maximumAge ?? null,
      allowed_genders: input.allowedGenders ?? ["F", "M", "U"],
      eligibility_note: optionalText(input.eligibilityNote),
      start_at: input.startAt ?? null,
      parking_label: input.parkingLabel ?? null,
      organizer_notes: input.organizerNotes ?? null,
      display_order: Math.max(0, displayOrder),
      status: input.status ?? "published",
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.code === "23505" && input.idempotencyKey) {
      const concurrentlyCreatedCategory = await loadCategoryForIdempotencyKey();
      if (concurrentlyCreatedCategory) {
        await ensureDefaultRegistrationConfiguration(
          concurrentlyCreatedCategory.id,
          session.account.userId,
          env,
        );
        return concurrentlyCreatedCategory;
      }
    }
    throw error;
  }

  await ensureDefaultRegistrationConfiguration(category.id, session.account.userId, env);

  const event = await getOrganizerEventById(session, eventEditionId, env);
  const created = event?.categories.find((item) => item.id === category.id) ?? null;
  if (!created) throw notFound("Created category could not be loaded");
  return created;
}

export async function updateOrganizerCategory(
  session: RequestSession,
  input: UpdateOrganizerCategoryInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const categoryContext = await requireCategoryAccess(session, input.id, "manage", env);
  const feeIssue = validateRaceFeePeriods(input.feePeriods ?? [], input.startAt);
  if (feeIssue) throw badRequest(feeIssue);

  if (input.categoryType === "informative") {
    input.courseFormat = "standard";
    input.lapCount = 1;
  }

  if (input.courseFormat !== undefined || input.lapCount !== undefined) {
    const { data: storedCourse, error: storedCourseError } = await adminClient
      .from("event_categories")
      .select("course_format,lap_count")
      .eq("id", input.id)
      .maybeSingle<{ course_format: string; lap_count: number }>();
    if (storedCourseError) throw storedCourseError;
    if (!storedCourse) throw notFound("Category not found");
    const nextCourseFormat = normalizeCourseFormat(input.courseFormat ?? storedCourse.course_format);
    const requestedLapCount = input.lapCount ?? storedCourse.lap_count;
    if (nextCourseFormat === "laps" && requestedLapCount < 2) {
      throw badRequest("A lap route must use at least two laps");
    }
    const nextLapCount = normalizeLapCount(nextCourseFormat, requestedLapCount);
    if (
      nextCourseFormat !== normalizeCourseFormat(storedCourse.course_format)
      || nextLapCount !== normalizeLapCount(
        normalizeCourseFormat(storedCourse.course_format),
        storedCourse.lap_count,
      )
    ) {
      const { count: punchCount, error: punchCountError } = await adminClient
        .from("punch_events")
        .select("id", { count: "exact", head: true })
        .eq("event_category_id", input.id)
        .eq("is_voided", false);
      if (punchCountError) throw punchCountError;
      if ((punchCount ?? 0) > 0) {
        throw conflict("Route format and lap count cannot change after timing entries exist");
      }
    }
    input.courseFormat = nextCourseFormat;
    input.lapCount = nextLapCount;
  }

  if (input.rankingConfig !== undefined || input.categoryType === "informative") {
    await assertMappedRaceRankingUpdate(
      adminClient,
      input.id,
      input.name,
      input.rankingConfig,
      input.categoryType,
    );
  }

  if (input.sportCode !== undefined) {
    const { data: assignedSnapshot, error: assignedSnapshotError } = await adminClient
      .from("event_category_track_snapshots")
      .select("track_template_id")
      .eq("event_category_id", input.id)
      .maybeSingle<{ track_template_id: string | null }>();
    if (assignedSnapshotError) throw assignedSnapshotError;
    if (assignedSnapshot?.track_template_id) {
      const { data: assignedTrack, error: assignedTrackError } = await adminClient
        .from("track_templates")
        .select("sport_code")
        .eq("id", assignedSnapshot.track_template_id)
        .maybeSingle<{ sport_code: SportCode }>();
      if (assignedTrackError) throw assignedTrackError;
      if (assignedTrack && assignedTrack.sport_code !== input.sportCode) {
        throw conflict("Race sport must match the assigned route sport");
      }
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.coverImageUrl !== undefined) patch.cover_image_url = optionalText(input.coverImageUrl);
  if (input.sportCode !== undefined) patch.sport_code = input.sportCode;
  if (input.categoryType !== undefined) patch.results_mode = mapResultsMode(input.categoryType);
  if (input.courseFormat !== undefined) patch.course_format = input.courseFormat;
  if (input.lapCount !== undefined) patch.lap_count = input.lapCount;
  if (input.rankingConfig !== undefined) {
    patch.ranking_config_json = normalizeCompetitiveRankingConfig(input.rankingConfig ?? defaultCompetitiveRankingConfig());
  }
  if (input.distanceKm !== undefined) patch.distance_km = input.distanceKm;
  if (input.elevationGainM !== undefined) patch.elevation_gain_m = input.elevationGainM;
  if (input.capacity !== undefined) patch.capacity = input.capacity;
  if (input.feeCents !== undefined) patch.registration_fee_cents = input.feeCents;
  if (input.feePeriods !== undefined) patch.registration_fee_periods = input.feePeriods;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.minimumAge !== undefined) patch.minimum_age = input.minimumAge;
  if (input.maximumAge !== undefined) patch.maximum_age = input.maximumAge;
  if (input.allowedGenders !== undefined) patch.allowed_genders = input.allowedGenders;
  if (input.eligibilityNote !== undefined) patch.eligibility_note = optionalText(input.eligibilityNote);
  if (input.startAt !== undefined) patch.start_at = input.startAt;
  if (input.parkingLabel !== undefined) patch.parking_label = input.parkingLabel;
  if (input.organizerNotes !== undefined) patch.organizer_notes = input.organizerNotes;
  if (input.displayOrder !== undefined) patch.display_order = Math.max(0, input.displayOrder);
  if (input.status !== undefined) patch.status = input.status;

  const { error } = await adminClient.from("event_categories").update(patch).eq("id", input.id);
  if (error) throw error;

  if (input.sportCode !== undefined) {
    await synchronizeEventEditionSportsFromCategories(
      adminClient,
      categoryContext.eventEditionId,
      input.sportCode,
    );
  }

  if (input.categoryType === "informative") {
    const { error: deleteCheckpointError } = await adminClient
      .from("checkpoints")
      .delete()
      .eq("event_category_id", input.id);
    if (deleteCheckpointError) throw deleteCheckpointError;

    const { error: deleteSnapshotError } = await adminClient
      .from("event_category_track_snapshots")
      .delete()
      .eq("event_category_id", input.id);
    if (deleteSnapshotError) throw deleteSnapshotError;
  }

  const event = await getOrganizerEventById(session, categoryContext.eventEditionId, env);
  const updated = event?.categories.find((item) => item.id === input.id) ?? null;
  if (!updated) throw notFound("Updated category could not be loaded");
  return updated;
}

export async function deleteOrganizerCategory(
  session: RequestSession,
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireCategoryAccess(session, categoryId, "manage", env);

  const { count, error: registrationError } = await adminClient
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("event_category_id", categoryId)
    .is("organizer_removed_at", null);

  if (registrationError) throw registrationError;
  if ((count ?? 0) > 0) {
    throw conflict("Cannot delete a category that already has registrations");
  }

  const { data: deleted, error } = await adminClient.rpc(
    "service_delete_organizer_event_category",
    {
      p_category_id: categoryId,
      p_actor_user_id: session.account.userId,
    },
  );
  if (error) {
    const errorMessage = error.message?.toLowerCase() ?? "";
    if (error.code === "23514" && errorMessage.includes("event_category_has_visible_registrations")) {
      throw conflict("Cannot delete a category that already has registrations");
    }
    if (error.code === "P0002" && errorMessage.includes("event_category_not_found")) {
      throw notFound("Category not found");
    }
    if (isForeignKeyViolation(error)) {
      throw conflict("Cannot delete a category that has retained league, safety, timing, or results records");
    }
    if (error.code === "55000" && errorMessage.includes("published_registration_configuration_is_immutable")) {
      throw conflict("Cannot delete a category that has retained registration evidence");
    }
    throw error;
  }
  if (!deleted) throw notFound("Category not found");

  return { deleted: true, categoryId };
}

export async function assignOrganizerCategoryTrack(
  session: RequestSession,
  categoryId: string,
  input: AssignOrganizerCategoryTrackInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const categoryContext = await requireCategoryAccess(session, categoryId, "manage", env);

  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,event_edition_id,distance_km,elevation_gain_m,results_mode,course_format,lap_count")
    .eq("id", categoryId)
    .maybeSingle<{
      id: string;
      event_edition_id: string;
      distance_km: string | number | null;
      elevation_gain_m: number | null;
      results_mode: string;
      course_format: string;
      lap_count: number;
    }>();

  if (categoryError) throw categoryError;
  if (!category) throw notFound("Category not found");
  if (mapCategoryType(category.results_mode) !== "competitive") {
    throw conflict("Informative categories do not accept route assignments");
  }

  const { data: edition, error: editionError } = await adminClient
    .from("event_editions")
    .select("id,event_series_id")
    .eq("id", category.event_edition_id)
    .maybeSingle<{ id: string; event_series_id: string }>();

  if (editionError) throw editionError;
  if (!edition) throw notFound("Race not found");

  const { data: series, error: seriesError } = await adminClient
    .from("event_series")
    .select("id,organization_id")
    .eq("id", edition.event_series_id)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (seriesError) throw seriesError;
  if (!series) throw notFound("Race series not found");

  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .select("id,organization_id,name,sport_code")
    .eq("id", input.trackTemplateId)
    .maybeSingle<{ id: string; organization_id: string; name: string; sport_code: SportCode }>();

  if (templateError) throw templateError;
  if (!template) throw notFound("Route not found");
  requireOrganizationAccess(session, template.organization_id, "manage");
  if (template.organization_id !== series.organization_id) {
    throw conflict("Routes can only be assigned from the same organizer workspace");
  }

  const versionQuery = adminClient
    .from("track_versions")
    .select("id,track_template_id,version_number,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,published_at,template_patch_json")
    .eq("track_template_id", template.id)
    .order("version_number", { ascending: false })
    .limit(1);

  const { data: version, error: versionError } = input.trackVersionId
    ? await adminClient
        .from("track_versions")
        .select("id,track_template_id,version_number,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,published_at,template_patch_json")
        .eq("id", input.trackVersionId)
        .eq("track_template_id", template.id)
        .maybeSingle<{
          id: string;
          track_template_id: string;
          version_number: number;
          gpx_storage_path: string;
          distance_km: string | number | null;
          elevation_gain_m: number | null;
          elevation_loss_m: number | null;
          published_at: string | null;
          template_patch_json: unknown;
        }>()
    : await versionQuery.maybeSingle<{
        id: string;
        track_template_id: string;
        version_number: number;
        gpx_storage_path: string;
        distance_km: string | number | null;
        elevation_gain_m: number | null;
        elevation_loss_m: number | null;
        published_at: string | null;
        template_patch_json: unknown;
      }>();

  if (versionError) throw versionError;
  if (!version) throw notFound("Route version not found");

  const { data: renderCache, error: renderCacheError } = await adminClient
    .from("track_render_cache")
    .select("polyline_json,elevation_profile_json,checkpoints_json")
    .eq("track_version_id", version.id)
    .maybeSingle<{
      polyline_json: unknown;
      elevation_profile_json: unknown;
      checkpoints_json: unknown;
    }>();

  if (renderCacheError) throw renderCacheError;
  if (!renderCache) throw conflict("Route render cache is missing for this version");

  const checkpoints = normalizeTrackSnapshotCheckpoints(renderCache.checkpoints_json);
  if (!checkpoints.length) {
    throw conflict("Route checkpoints are missing for this version");
  }

  const { data: existingSnapshot, error: existingSnapshotError } = await adminClient
    .from("event_category_track_snapshots")
    .select("id")
    .eq("event_category_id", categoryId)
    .maybeSingle<{ id: string }>();

  if (existingSnapshotError) throw existingSnapshotError;

  const snapshotPayload = {
    event_category_id: categoryId,
    track_template_id: template.id,
    track_version_id: version.id,
    snapshot_name: trackTemplateDraftValue<string>(
      template as unknown as Record<string, unknown>,
      version.published_at ? {} : normalizeTrackTemplateDraftPatch(version.template_patch_json),
      "name",
    ),
    snapshot_gpx_storage_path: version.gpx_storage_path,
    distance_km: numberOrNull(version.distance_km),
    elevation_gain_m: version.elevation_gain_m,
    elevation_loss_m: version.elevation_loss_m,
    snapshot_json: {
      sourceTrackTemplateId: template.id,
      sourceTrackVersionId: version.id,
      polyline: renderCache.polyline_json ?? [],
      elevationProfile: renderCache.elevation_profile_json ?? [],
      checkpoints,
    },
  };

  let snapshotId = existingSnapshot?.id ?? null;
  if (existingSnapshot) {
    const { error } = await adminClient
      .from("event_category_track_snapshots")
      .update(snapshotPayload)
      .eq("id", existingSnapshot.id);
    if (error) throw error;
  } else {
    const { data, error } = await adminClient
      .from("event_category_track_snapshots")
      .insert(snapshotPayload)
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    snapshotId = data.id;
  }

  if (!snapshotId) throw conflict("Unable to assign route to category");

  const { data: existingCheckpoints, error: existingCheckpointsError } = await adminClient
    .from("checkpoints")
    .select("id,code,name,checkpoint_type,sequence_number,distance_from_start_km,cutoff_at,is_mandatory,settings_json")
    .eq("event_category_id", categoryId)
    .returns<Array<{
      id: string;
      code: string;
      name: string;
      checkpoint_type: string;
      sequence_number: number;
      distance_from_start_km: string | number | null;
      cutoff_at: string | null;
      is_mandatory: boolean;
      settings_json: unknown;
    }>>();
  if (existingCheckpointsError) throw existingCheckpointsError;

  const existingFoundationCheckpointIds = new Map(
    (existingCheckpoints ?? [])
      .filter((checkpoint) => checkpoint.checkpoint_type === "start" || checkpoint.checkpoint_type === "finish")
      .map((checkpoint) => [checkpoint.checkpoint_type, checkpoint.id]),
  );

  const foundationCheckpoints = checkpoints.filter(
    (checkpoint) => checkpoint.type === "start" || checkpoint.type === "finish",
  );

  const checkpointRows = [
    ...foundationCheckpoints.map((checkpoint) => ({
      id: existingFoundationCheckpointIds.get(checkpoint.type) ?? null,
      code: checkpointCodeForSnapshot(checkpoint.type, 0),
      name: checkpoint.name,
      checkpoint_type: checkpointTypeForSnapshot(checkpoint.type),
      sequence_number: 0,
      distance_from_start_km: checkpoint.km,
      cutoff_at: null,
      is_mandatory: true,
      settings_json: defaultCheckpointSettingsForTrackType(checkpoint),
    })),
    ...(existingCheckpoints ?? [])
      .filter((checkpoint) => checkpoint.checkpoint_type !== "start" && checkpoint.checkpoint_type !== "finish")
      .map((checkpoint) => ({
        id: checkpoint.id,
        code: checkpoint.code,
        name: checkpoint.name,
        checkpoint_type: checkpoint.checkpoint_type,
        sequence_number: 0,
        distance_from_start_km: numberOrNull(checkpoint.distance_from_start_km),
        cutoff_at: checkpoint.cutoff_at,
        is_mandatory: checkpoint.is_mandatory,
        settings_json: normalizeCheckpointSettings(checkpoint.settings_json, checkpoint.checkpoint_type),
      })),
  ]
    .sort((left, right) => {
      const leftDistance = numberOrNull(left.distance_from_start_km) ?? 0;
      const rightDistance = numberOrNull(right.distance_from_start_km) ?? 0;
      return leftDistance - rightDistance;
    })
    .map((checkpoint, index) => ({
      ...checkpoint,
      sequence_number: index + 1,
    }));

  const { error: reconcileCheckpointError } = await adminClient.rpc(
    "service_reconcile_organizer_category_checkpoints",
    {
      p_category_id: categoryId,
      p_track_snapshot_id: snapshotId,
      p_checkpoints: checkpointRows,
    },
  );
  if (reconcileCheckpointError) {
    if (reconcileCheckpointError.message.includes("course_point_has_operational_history")) {
      throw conflict("A route point used by race-day operations cannot be removed");
    }
    if (reconcileCheckpointError.message.includes("checkpoint_id_not_in_category")) {
      throw conflict("Route points changed while the route was being assigned. Reload the race and try again");
    }
    throw reconcileCheckpointError;
  }

  const { error: categoryUpdateError } = await adminClient
    .from("event_categories")
    .update({
      sport_code: template.sport_code,
      distance_km: numberOrNull(version.distance_km) == null
        ? null
        : Number(numberOrNull(version.distance_km)) * normalizeLapCount(
            normalizeCourseFormat(category.course_format),
            category.lap_count,
          ),
      elevation_gain_m: version.elevation_gain_m == null
        ? null
        : version.elevation_gain_m * normalizeLapCount(
            normalizeCourseFormat(category.course_format),
            category.lap_count,
          ),
    })
    .eq("id", categoryId);
  if (categoryUpdateError) throw categoryUpdateError;

  await synchronizeEventEditionSportsFromCategories(
    adminClient,
    category.event_edition_id,
    template.sport_code,
  );

  const event = await getOrganizerEventById(session, categoryContext.eventEditionId, env);
  const updated = event?.categories.find((item) => item.id === categoryId) ?? null;
  if (!updated) throw notFound("Updated category could not be loaded");
  return updated;
}

export async function detachOrganizerCategoryTrack(
  session: RequestSession,
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const categoryContext = await requireCategoryAccess(session, categoryId, "manage", env);

  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,results_mode")
    .eq("id", categoryId)
    .maybeSingle<{ id: string; results_mode: string }>();

  if (categoryError) throw categoryError;
  if (!category) throw notFound("Category not found");
  if (mapCategoryType(category.results_mode) !== "competitive") {
    throw conflict("Informative categories do not use route assignments");
  }

  const { error: deleteCheckpointError } = await adminClient
    .from("checkpoints")
    .delete()
    .eq("event_category_id", categoryId);
  if (deleteCheckpointError) throw deleteCheckpointError;

  const { error: deleteSnapshotError } = await adminClient
    .from("event_category_track_snapshots")
    .delete()
    .eq("event_category_id", categoryId);
  if (deleteSnapshotError) throw deleteSnapshotError;

  const event = await getOrganizerEventById(session, categoryContext.eventEditionId, env);
  const updated = event?.categories.find((item) => item.id === categoryId) ?? null;
  if (!updated) throw notFound("Updated category could not be loaded");
  return updated;
}

export async function updateOrganizerCheckpoint(
  session: RequestSession,
  input: UpdateOrganizerCheckpointInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: checkpoint, error: checkpointError } = await adminClient
    .from("checkpoints")
    .select("id,event_category_id,checkpoint_type,settings_json")
    .eq("id", input.checkpointId)
    .maybeSingle<{
      id: string;
      event_category_id: string;
      checkpoint_type: string;
      settings_json: unknown;
    }>();

  if (checkpointError) throw checkpointError;
  if (!checkpoint) throw notFound("Checkpoint not found");

  const categoryContext = await requireCategoryAccess(session, checkpoint.event_category_id, "manage", env);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.cutoffAt !== undefined) patch.cutoff_at = input.cutoffAt;
  if (input.isMandatory !== undefined) patch.is_mandatory = input.isMandatory;
  if (input.settings !== undefined) {
    patch.settings_json = {
      ...normalizeCheckpointSettings(checkpoint.settings_json, checkpoint.checkpoint_type),
      ...input.settings,
    };
  }

  const { error } = await adminClient.from("checkpoints").update(patch).eq("id", input.checkpointId);
  if (error) throw error;

  const event = await getOrganizerEventById(session, categoryContext.eventEditionId, env);
  const updatedCheckpoint =
    event?.categories
      .find((item) => item.id === checkpoint.event_category_id)
      ?.checkpoints.find((item) => item.id === input.checkpointId) ?? null;

  if (!updatedCheckpoint) throw notFound("Updated checkpoint could not be loaded");
  return updatedCheckpoint;
}

export async function syncOrganizerCategoryCheckpoints(
  session: RequestSession,
  input: SyncOrganizerCategoryCheckpointsInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const categoryContext = await requireCategoryAccess(session, input.categoryId, "manage", env);

  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,results_mode")
    .eq("id", input.categoryId)
    .maybeSingle<{ id: string; results_mode: string }>();

  if (categoryError) throw categoryError;
  if (!category) throw notFound("Category not found");
  if (mapCategoryType(category.results_mode) !== "competitive") {
    throw badRequest("Race checkpoints can only be managed on competitive races");
  }

  const { data: snapshot, error: snapshotError } = await adminClient
    .from("event_category_track_snapshots")
    .select("id,track_version_id")
    .eq("event_category_id", input.categoryId)
    .maybeSingle<{ id: string; track_version_id: string | null }>();

  if (snapshotError) throw snapshotError;
  if (!snapshot?.track_version_id) {
    throw badRequest("Assign a route before configuring race points");
  }

  const { data: renderCache, error: renderCacheError } = await adminClient
    .from("track_render_cache")
    .select("checkpoints_json")
    .eq("track_version_id", snapshot.track_version_id)
    .maybeSingle<{ checkpoints_json: unknown }>();

  if (renderCacheError) throw renderCacheError;
  if (!renderCache) throw notFound("Route source not found");

  const { data: existingCheckpoints, error: existingCheckpointsError } = await adminClient
    .from("checkpoints")
    .select("id,checkpoint_type")
    .eq("event_category_id", input.categoryId)
    .returns<Array<{ id: string; checkpoint_type: string }>>();

  if (existingCheckpointsError) throw existingCheckpointsError;
  const existingFoundationCheckpointIds = new Map(
    (existingCheckpoints ?? [])
      .filter((checkpoint) => checkpoint.checkpoint_type === "start" || checkpoint.checkpoint_type === "finish")
      .map((checkpoint) => [checkpoint.checkpoint_type, checkpoint.id]),
  );

  const foundationCheckpoints = normalizeTrackSnapshotCheckpoints(renderCache.checkpoints_json).filter(
    (checkpoint) => checkpoint.type === "start" || checkpoint.type === "finish",
  );
  if (foundationCheckpoints.length < 2) {
    throw badRequest("Route must provide fixed start and finish points");
  }

  const normalizedRacePoints = input.checkpoints
    .map((checkpoint) => {
      const normalizedDistance = Number(checkpoint.distanceFromStartKm);
      if (!Number.isFinite(normalizedDistance) || normalizedDistance < 0) {
        throw badRequest("Race point distances must be valid numbers");
      }
      const settings = normalizeCheckpointSettings(
        {
          ...defaultCheckpointSettings("split"),
          ...(checkpoint.settings ?? {}),
        },
        "split",
      );

      return {
        checkpointId: checkpoint.checkpointId,
        name: checkpoint.name.trim(),
        distanceFromStartKm: normalizedDistance,
        cutoffAt: checkpoint.cutoffAt ?? null,
        isMandatory: checkpoint.isMandatory ?? true,
        settings,
      };
    })
    .filter((checkpoint) => checkpoint.name.length > 0)
    .sort((left, right) => left.distanceFromStartKm - right.distanceFromStartKm);

  const codeCounters = new Map<string, number>();
  const checkpointRows = [
    ...foundationCheckpoints.map((checkpoint) => ({
      id: existingFoundationCheckpointIds.get(checkpoint.type) ?? null,
      event_category_id: input.categoryId,
      track_snapshot_id: snapshot.id,
      code: checkpoint.type === "start" ? "START" : "FINISH",
      name: checkpoint.type === "start" ? "Start" : "Finish",
      checkpoint_type: checkpoint.type,
      sequence_number: 0,
      distance_from_start_km: checkpoint.km,
      cutoff_at: null,
      is_mandatory: true,
      settings_json: defaultCheckpointSettingsForTrackType(checkpoint),
    })),
    ...normalizedRacePoints.map((checkpoint) => ({
      id: checkpoint.checkpointId,
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
    .sort((left, right) => {
      const leftDistance = numberOrNull(left.distance_from_start_km) ?? 0;
      const rightDistance = numberOrNull(right.distance_from_start_km) ?? 0;
      return leftDistance - rightDistance;
    })
    .map((checkpoint, index) => ({
      ...checkpoint,
      sequence_number: index + 1,
    }));

  const { error: reconcileCheckpointError } = await adminClient.rpc(
    "service_reconcile_organizer_category_checkpoints",
    {
      p_category_id: input.categoryId,
      p_track_snapshot_id: snapshot.id,
      p_checkpoints: checkpointRows.map((checkpoint) => ({
        id: checkpoint.id,
        code: checkpoint.code,
        name: checkpoint.name,
        checkpoint_type: checkpoint.checkpoint_type,
        sequence_number: checkpoint.sequence_number,
        distance_from_start_km: checkpoint.distance_from_start_km,
        cutoff_at: checkpoint.cutoff_at,
        is_mandatory: checkpoint.is_mandatory,
        settings_json: checkpoint.settings_json,
      })),
    },
  );
  if (reconcileCheckpointError) {
    if (reconcileCheckpointError.message.includes("course_point_has_operational_history")) {
      throw conflict("A route point used by race-day operations cannot be removed");
    }
    if (reconcileCheckpointError.message.includes("checkpoint_id_not_in_category")) {
      throw conflict("Route points changed since this editor was opened. Reload the race and try again");
    }
    throw reconcileCheckpointError;
  }

  const event = await getOrganizerEventById(session, categoryContext.eventEditionId, env);
  const updated = event?.categories.find((item) => item.id === input.categoryId) ?? null;
  if (!updated) throw notFound("Updated category could not be loaded");
  return updated;
}

export async function createOrganizerTrack(
  session: RequestSession,
  input: CreateOrganizerTrackInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const organizationId = input.organizationId ?? session.account.organizationIds[0];
  if (!organizationId) {
    throw forbidden("Organizer access is required");
  }
  requireOrganizationAccess(session, organizationId, "manage");

  const uploadedGpx = input.gpxStoragePath
    ? await loadUploadedTrackGpx(adminClient, organizationId, input.gpxStoragePath)
    : null;
  const routePoints = uploadedGpx?.routePoints ?? input.routePoints ?? [];
  const elevationPoints = uploadedGpx?.elevationPoints ?? input.elevationPoints ?? [];

  if (routePoints.length < 2) {
    throw badRequest("A route requires at least two points");
  }

  const baseSlug = slugify(input.name);
  const trackSlug = await uniqueScopedSlug(
    {
      table: "track_templates",
      scopeColumn: "organization_id",
      scopeValue: organizationId,
      baseSlug,
    },
    env,
  );

  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .insert({
      organization_id: organizationId,
      slug: trackSlug,
      name: input.name,
      sport_code: input.sportCode ?? DEFAULT_SPORT_CODE,
      terrain_type: input.terrainType ?? null,
      notes: input.notes ?? null,
      public_overview: input.publicOverview ?? null,
      location_label: input.locationLabel ?? null,
      season_label: input.seasonLabel ?? null,
      parking_label: input.parkingLabel ?? null,
      weather_location_label: input.weatherLocationLabel ?? null,
      best_time_label: input.bestTimeLabel ?? null,
      gallery_items_json: normalizeTrackGalleryItemsForOrganization(
        adminClient,
        organizationId,
        input.galleryItems ?? [],
      ),
    })
    .select("id")
    .single<{ id: string }>();

  if (templateError) throw templateError;

  const startPoint = routePoints[0];
  const finishPoint = routePoints[routePoints.length - 1];
  const derivedWaterPointCount = input.checkpoints.filter(
    (checkpoint) => checkpoint.type === "water" || checkpoint.type === "refreshment",
  ).length;
  const sourceFileName = sanitizeGpxFileName(input.sourceFileName, trackSlug);
  const gpxStoragePath =
    uploadedGpx?.storagePath ?? `db://track-gpx/${template.id}/v1/${sourceFileName}`;
  const { data: version, error: versionError } = await adminClient
    .from("track_versions")
    .insert({
      track_template_id: template.id,
      version_number: 1,
      gpx_storage_path: gpxStoragePath,
      distance_km: uploadedGpx ? uploadedGpx.distanceKm : input.distanceKm ?? null,
      elevation_gain_m: uploadedGpx ? uploadedGpx.elevationGainM : input.elevationGainM ?? null,
      elevation_loss_m: uploadedGpx ? uploadedGpx.elevationLossM : input.elevationLossM ?? null,
      difficulty_level: input.difficultyLevel ?? null,
      surface_summary: input.surfaceSummary ?? null,
      safety_notes: input.safetyNotes ?? null,
      water_point_count: Math.max(0, input.waterPointCount ?? derivedWaterPointCount),
      segment_definitions_json: normalizeTrackSegments(input.segments ?? []),
      start_lat: startPoint.lat,
      start_lng: startPoint.lng,
      finish_lat: finishPoint.lat,
      finish_lng: finishPoint.lng,
    })
    .select("id")
    .single<{ id: string }>();

  if (versionError) throw versionError;

  const { error: renderCacheError } = await adminClient.from("track_render_cache").insert({
    track_version_id: version.id,
    polyline_json: routePoints.map((point) => ({ lat: point.lat, lng: point.lng })),
    elevation_profile_json: elevationPoints.map((point) => ({
      distKm: point.distKm,
      elev: point.elev,
      grade: point.grade ?? 0,
      lat: point.lat ?? null,
      lng: point.lng ?? null,
    })),
    bounds_json: summarizeBounds(routePoints),
    checkpoints_json: input.checkpoints.map((checkpoint) => ({
      name: checkpoint.name,
      km: checkpoint.km,
      elev: checkpoint.elev,
      lat: checkpoint.lat,
      lng: checkpoint.lng,
      type: checkpoint.type,
      typeTags: checkpoint.typeTags?.length ? checkpoint.typeTags : [checkpoint.type],
    })),
  });

  if (renderCacheError) throw renderCacheError;

  const gpxXml = uploadedGpx
    ? null
    : input.gpxXml?.trim() ||
      buildTrackGpxDocument({
        name: input.name,
        routePoints,
        elevationPoints,
        checkpoints: input.checkpoints,
      });

  const { error: gpxSourceError } = await adminClient.from("track_version_gpx_sources").insert({
    track_version_id: version.id,
    file_name: sourceFileName,
    mime_type: "application/gpx+xml",
    gpx_xml: gpxXml,
    storage_path: uploadedGpx?.storagePath ?? null,
    byte_size: uploadedGpx?.byteSize ?? Buffer.byteLength(gpxXml ?? "", "utf8"),
  });

  if (gpxSourceError) throw gpxSourceError;

  const tracks = await getOrganizerTracks(session, env);
  const created = tracks.find((track) => track.templateId === template.id) ?? null;
  if (!created) throw notFound("Created route could not be loaded");
  return created;
}

export async function updateOrganizerTrack(
  session: RequestSession,
  input: UpdateOrganizerTrackInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .select("id,organization_id,slug,name")
    .eq("id", input.trackTemplateId)
    .maybeSingle<{ id: string; organization_id: string; slug: string; name: string }>();

  if (templateError) throw templateError;
  if (!template) throw notFound("Route not found");
  requireOrganizationAccess(session, template.organization_id, "manage");
  const uploadedGpx = input.gpxStoragePath
    ? await loadUploadedTrackGpx(adminClient, template.organization_id, input.gpxStoragePath)
    : null;

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
  if (input.galleryItems !== undefined) {
    templatePatch.gallery_items_json = normalizeTrackGalleryItemsForOrganization(
      adminClient,
      template.organization_id,
      input.galleryItems,
    );
  }

  const templatePatchRequested = Object.keys(templatePatch).length > 0;

  const latestVersionFieldRequested =
    input.routePoints !== undefined ||
    input.elevationPoints !== undefined ||
    input.distanceKm !== undefined ||
    input.elevationGainM !== undefined ||
    input.elevationLossM !== undefined ||
    input.difficultyLevel !== undefined ||
    input.sourceFileName !== undefined ||
    input.gpxXml !== undefined ||
    input.gpxStoragePath !== undefined ||
    input.surfaceSummary !== undefined ||
    input.safetyNotes !== undefined ||
    input.waterPointCount !== undefined ||
    input.segments !== undefined ||
    input.checkpoints !== undefined;

  if (latestVersionFieldRequested || templatePatchRequested) {
    const { data: latestVersion, error: latestVersionError } = await adminClient
      .from("track_versions")
      .select("id,version_number,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,difficulty_level,surface_summary,safety_notes,water_point_count,segment_definitions_json,published_at,template_patch_json")
      .eq("track_template_id", input.trackTemplateId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        version_number: number;
        gpx_storage_path: string;
        distance_km: string | number | null;
        elevation_gain_m: number | null;
        elevation_loss_m: number | null;
        difficulty_level: number | null;
        surface_summary: string | null;
        safety_notes: string | null;
        water_point_count: number | null;
        segment_definitions_json: unknown;
        published_at: string | null;
        template_patch_json: unknown;
      }>();

    if (latestVersionError) throw latestVersionError;
    if (!latestVersion) throw notFound("Route version not found");

    if (input.difficultyLevel !== undefined) {
      // Difficulty is lightweight public comparison metadata. Keep it live on
      // both the organizer's working version and the current public version;
      // route geometry, GPX, checkpoints, and safety data remain publish-gated.
      const { data: latestPublishedVersion, error: latestPublishedVersionError } = await adminClient
        .from("track_versions")
        .select("id")
        .eq("track_template_id", input.trackTemplateId)
        .not("published_at", "is", null)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (latestPublishedVersionError) throw latestPublishedVersionError;

      const liveDifficultyVersionIds = Array.from(new Set([
        latestVersion.id,
        latestPublishedVersion?.id,
      ].filter((versionId): versionId is string => Boolean(versionId))));
      const { error: difficultyUpdateError } = await adminClient
        .from("track_versions")
        .update({ difficulty_level: input.difficultyLevel })
        .in("id", liveDifficultyVersionIds);

      if (difficultyUpdateError) throw difficultyUpdateError;
    }

    const [{ data: currentGpxSource, error: currentGpxSourceError }, { data: renderCache, error: renderCacheError }] = await Promise.all([
      adminClient
        .from("track_version_gpx_sources")
        .select("file_name")
        .eq("track_version_id", latestVersion.id)
        .maybeSingle<{ file_name: string }>(),
      adminClient
        .from("track_render_cache")
        .select("polyline_json,elevation_profile_json,checkpoints_json")
        .eq("track_version_id", latestVersion.id)
        .maybeSingle<{
          polyline_json: unknown;
          elevation_profile_json: unknown;
          checkpoints_json: unknown;
        }>(),
    ]);

    if (currentGpxSourceError) throw currentGpxSourceError;
    if (renderCacheError) throw renderCacheError;
    if (!renderCache) throw notFound("Route render cache not found");

    const currentRoutePoints = renderCacheRoutePoints(renderCache.polyline_json);
    const currentElevationPoints = renderCacheTrackElevationProfile(renderCache.elevation_profile_json);
    const currentCheckpoints = normalizeTrackSnapshotCheckpoints(renderCache.checkpoints_json).flatMap((checkpoint) => (
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
    const currentWaterPointCount = Math.max(0, latestVersion.water_point_count ?? 0);
    const currentSegments = normalizeTrackSegments(latestVersion.segment_definitions_json);
    const currentSourceFileName = sanitizeGpxFileName(
      currentGpxSource?.file_name ?? latestVersion.gpx_storage_path.split("/").pop() ?? null,
      template.slug,
    );
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
      routePoints: uploadedGpx?.routePoints ?? input.routePoints ?? currentRoutePoints,
      elevationPoints: uploadedGpx?.elevationPoints ?? input.elevationPoints ?? currentElevationPoints,
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
      distanceKm:
        uploadedGpx
          ? uploadedGpx.distanceKm
          : input.distanceKm !== undefined
            ? input.distanceKm
            : numberOrNull(latestVersion.distance_km),
      elevationGainM:
        uploadedGpx
          ? uploadedGpx.elevationGainM
          : input.elevationGainM !== undefined
            ? input.elevationGainM
            : latestVersion.elevation_gain_m ?? null,
      elevationLossM:
        uploadedGpx
          ? uploadedGpx.elevationLossM
          : input.elevationLossM !== undefined
            ? input.elevationLossM
            : latestVersion.elevation_loss_m ?? null,
    };
    const nextDifficultyLevel = input.difficultyLevel !== undefined
      ? input.difficultyLevel
      : latestVersion.difficulty_level ?? null;
    const nextGpxXml = input.gpxXml?.trim() || null;
    const currentTemplatePatch = latestVersion.published_at
      ? {}
      : normalizeTrackTemplateDraftPatch(latestVersion.template_patch_json);
    const nextTemplatePatch = {
      ...currentTemplatePatch,
      ...templatePatch,
    };
    const versionStateChanged =
      uploadedGpx !== null ||
      nextGpxXml !== null ||
      JSON.stringify(currentVersionState) !== JSON.stringify(nextVersionState);
    const shouldCreateNewVersion = versionStateChanged || (
      templatePatchRequested && Boolean(latestVersion.published_at)
    );

    if (shouldCreateNewVersion) {
      if (nextVersionState.routePoints.length < 2) {
        throw conflict("A route must contain at least two points");
      }

      const nextVersionNumber = latestVersion.version_number + 1;
      const startPoint = nextVersionState.routePoints[0];
      const finishPoint = nextVersionState.routePoints[nextVersionState.routePoints.length - 1];
      const gpxStoragePath =
        uploadedGpx?.storagePath ??
        `db://track-gpx/${template.id}/v${nextVersionNumber}/${nextVersionState.sourceFileName}`;
      const { data: createdVersion, error: versionInsertError } = await adminClient
        .from("track_versions")
        .insert({
          track_template_id: template.id,
          version_number: nextVersionNumber,
          gpx_storage_path: gpxStoragePath,
          distance_km: nextVersionState.distanceKm ?? null,
          elevation_gain_m: nextVersionState.elevationGainM ?? null,
          elevation_loss_m: nextVersionState.elevationLossM ?? null,
          difficulty_level: nextDifficultyLevel,
          surface_summary: nextVersionState.surfaceSummary ?? null,
          safety_notes: nextVersionState.safetyNotes ?? null,
          water_point_count: nextVersionState.waterPointCount,
          segment_definitions_json: normalizeTrackSegments(nextVersionState.segments),
          template_patch_json: nextTemplatePatch,
          start_lat: startPoint.lat,
          start_lng: startPoint.lng,
          finish_lat: finishPoint.lat,
          finish_lng: finishPoint.lng,
        })
        .select("id")
        .single<{ id: string }>();

      if (versionInsertError) throw versionInsertError;

      const { error: renderCacheInsertError } = await adminClient.from("track_render_cache").insert({
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

      const gpxXml = uploadedGpx
        ? null
        : nextGpxXml ||
          buildTrackGpxDocument({
            name: input.name ?? (typeof templatePatch.name === "string" ? templatePatch.name : template.name),
            routePoints: nextVersionState.routePoints,
            elevationPoints: nextVersionState.elevationPoints,
            checkpoints: nextVersionState.checkpoints,
          });
      const { error: insertGpxSourceError } = await adminClient
        .from("track_version_gpx_sources")
        .insert({
          track_version_id: createdVersion.id,
          file_name: nextVersionState.sourceFileName,
          mime_type: "application/gpx+xml",
          gpx_xml: gpxXml,
          storage_path: uploadedGpx?.storagePath ?? null,
          byte_size: uploadedGpx?.byteSize ?? Buffer.byteLength(gpxXml ?? "", "utf8"),
        });
      if (insertGpxSourceError) throw insertGpxSourceError;

    } else if (templatePatchRequested) {
      const { error: patchError } = await adminClient
        .from("track_versions")
        .update({ template_patch_json: nextTemplatePatch })
        .eq("id", latestVersion.id)
        .is("published_at", null);
      if (patchError) throw patchError;
    }
  }

  if (input.sportCode !== undefined) {
    const { error: sportUpdateError } = await adminClient.rpc(
      "service_update_organizer_track_sport",
      {
        p_track_template_id: input.trackTemplateId,
        p_organization_id: template.organization_id,
        p_sport_code: input.sportCode,
        p_actor_user_id: session.account.userId,
      },
    );
    if (sportUpdateError) {
      if (sportUpdateError.message.includes("track_sport_change_has_historical_race")) {
        throw conflict(
          "Route sport cannot change after an assigned race has started or produced results",
        );
      }
      throw sportUpdateError;
    }
  }

  const tracks = await getOrganizerTracks(session, env);
  const updated = tracks.find((track) => track.templateId === input.trackTemplateId) ?? null;
  if (!updated) throw notFound("Updated route could not be loaded");
  return updated;
}

export function getOrganizerTrackPublishReadinessIssues(input: {
  name?: string | null;
  terrainType?: string | null;
  publicOverview?: string | null;
  locationLabel?: string | null;
  weatherLocationLabel?: string | null;
  galleryItemCount?: number | null;
  surfaceSummary?: string | null;
  safetyNotes?: string | null;
  difficultyLevel?: number | null;
  distanceKm?: number | null;
  elevationGainM?: number | null;
  elevationLossM?: number | null;
  routePointCount?: number | null;
  elevationPointCount?: number | null;
}) {
  const issues: string[] = [];
  const hasText = (value: string | null | undefined) => Boolean(value?.trim());
  if (!hasText(input.name)) issues.push("route name");
  if ((input.routePointCount ?? 0) < 2) issues.push("route geometry");
  return issues;
}

export async function publishOrganizerTrackVersion(
  session: RequestSession,
  trackTemplateId: string,
  trackVersionId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .select("id,organization_id,name,terrain_type,public_overview,location_label,weather_location_label,gallery_items_json")
    .eq("id", trackTemplateId)
    .maybeSingle<{
      id: string;
      organization_id: string;
      name: string;
      terrain_type: string | null;
      public_overview: string | null;
      location_label: string | null;
      weather_location_label: string | null;
      gallery_items_json: unknown;
    }>();

  if (templateError) throw templateError;
  if (!template) throw notFound("Route not found");
  requireOrganizationAccess(session, template.organization_id, "manage");

  const { data: version, error: versionError } = await adminClient
    .from("track_versions")
    .select("id,track_template_id,gpx_storage_path,distance_km,elevation_gain_m,elevation_loss_m,surface_summary,safety_notes,difficulty_level,template_patch_json")
    .eq("id", trackVersionId)
    .maybeSingle<{
      id: string;
      track_template_id: string;
      gpx_storage_path: string | null;
      distance_km: string | number | null;
      elevation_gain_m: number | null;
      elevation_loss_m: number | null;
      surface_summary: string | null;
      safety_notes: string | null;
      difficulty_level: number | null;
      template_patch_json: unknown;
    }>();

  if (versionError) throw versionError;
  if (!version || version.track_template_id !== trackTemplateId) {
    throw notFound("Route version not found");
  }

  const { data: renderCache, error: renderCacheError } = await adminClient
    .from("track_render_cache")
    .select("track_version_id,polyline_json,elevation_profile_json,checkpoints_json")
    .eq("track_version_id", trackVersionId)
    .maybeSingle<{
      track_version_id: string;
      polyline_json: unknown;
      elevation_profile_json: unknown;
      checkpoints_json: unknown;
    }>();

  if (renderCacheError) throw renderCacheError;
  if (!renderCache) {
    throw conflict("Publish requires a persisted render cache");
  }

  const templateDraftPatch = normalizeTrackTemplateDraftPatch(version.template_patch_json);
  const templateRecord = template as unknown as Record<string, unknown>;
  const effectiveName = trackTemplateDraftValue<string>(templateRecord, templateDraftPatch, "name");
  const effectiveGallery = trackTemplateDraftValue<unknown>(templateRecord, templateDraftPatch, "gallery_items_json");
  const readinessIssues = getOrganizerTrackPublishReadinessIssues({
    name: effectiveName,
    terrainType: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "terrain_type"),
    publicOverview: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "public_overview"),
    locationLabel: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "location_label"),
    weatherLocationLabel: trackTemplateDraftValue<string | null>(templateRecord, templateDraftPatch, "weather_location_label"),
    galleryItemCount: Array.isArray(effectiveGallery) ? effectiveGallery.length : 0,
    surfaceSummary: version.surface_summary,
    safetyNotes: version.safety_notes,
    difficultyLevel: version.difficulty_level,
    distanceKm: numberOrNull(version.distance_km),
    elevationGainM: version.elevation_gain_m,
    elevationLossM: version.elevation_loss_m,
    routePointCount: renderCacheRoutePoints(renderCache.polyline_json).length,
    elevationPointCount: renderCacheTrackElevationProfile(renderCache.elevation_profile_json).length,
  });
  if (readinessIssues.length) {
    throw conflict(`Route publish blocked. Complete: ${readinessIssues.join(", ")}.`);
  }

  const publishedAt = new Date().toISOString();
  const { error } = await adminClient.rpc("publish_track_version_with_template_patch", {
    target_track_template_id: trackTemplateId,
    target_track_version_id: trackVersionId,
    target_published_at: publishedAt,
  });

  if (error) throw error;

  const tracks = await getOrganizerTracks(session, env);
  const published = tracks.find((track) => track.templateId === trackTemplateId) ?? null;
  if (!published) throw notFound("Published route could not be loaded");
  return published;
}

export async function unpublishOrganizerTrackVersion(
  session: RequestSession,
  trackTemplateId: string,
  trackVersionId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .select("id,organization_id")
    .eq("id", trackTemplateId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (templateError) throw templateError;
  if (!template) throw notFound("Route not found");
  requireOrganizationAccess(session, template.organization_id, "manage");

  const { data: version, error: versionError } = await adminClient
    .from("track_versions")
    .select("id,track_template_id")
    .eq("id", trackVersionId)
    .maybeSingle<{ id: string; track_template_id: string }>();

  if (versionError) throw versionError;
  if (!version || version.track_template_id !== trackTemplateId) {
    throw notFound("Route version not found");
  }

  const { data: assignedSnapshots, error: assignedSnapshotsError } = await adminClient
    .from("event_category_track_snapshots")
    .select("event_category_id")
    .eq("track_template_id", trackTemplateId)
    .returns<Array<{ event_category_id: string }>>();

  if (assignedSnapshotsError) throw assignedSnapshotsError;

  const assignedCategoryIds = Array.from(
    new Set((assignedSnapshots ?? []).map((snapshot) => snapshot.event_category_id)),
  );

  if (assignedCategoryIds.length) {
    const { data: assignedCategories, error: assignedCategoriesError } = await adminClient
      .from("event_categories")
      .select("event_edition_id,status")
      .in("id", assignedCategoryIds)
      .returns<Array<{ event_edition_id: string; status: string }>>();

    if (assignedCategoriesError) throw assignedCategoriesError;

    const assignedEditionIds = Array.from(
      new Set(
        (assignedCategories ?? [])
          .filter((category) => category.status !== "draft")
          .map((category) => category.event_edition_id),
      ),
    );

    if (assignedEditionIds.length) {
      const { data: publishedEditions, error: publishedEditionsError } = await adminClient
        .from("event_editions")
        .select("id")
        .in("id", assignedEditionIds)
        .neq("status", "draft")
        .not("published_at", "is", null)
        .limit(1)
        .returns<Array<{ id: string }>>();

      if (publishedEditionsError) throw publishedEditionsError;
      if (publishedEditions?.length) {
        throw conflict("Cannot unpublish a route used by a published race");
      }
    }
  }

  const { error } = await adminClient
    .from("track_versions")
    .update({ published_at: null })
    .eq("track_template_id", trackTemplateId);

  if (error) throw error;

  const tracks = await getOrganizerTracks(session, env);
  const unpublished = tracks.find((track) => track.templateId === trackTemplateId) ?? null;
  if (!unpublished) throw notFound("Unpublished route could not be loaded");
  return unpublished;
}

export async function deleteOrganizerTrack(
  session: RequestSession,
  trackTemplateId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .select("id,organization_id")
    .eq("id", trackTemplateId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (templateError) throw templateError;
  if (!template) throw notFound("Route not found");
  requireOrganizationAccess(session, template.organization_id, "manage");

  const { error: deletionError } = await adminClient.rpc(
    "service_delete_organizer_track",
    {
      p_track_template_id: trackTemplateId,
      p_organization_id: template.organization_id,
      p_actor_user_id: session.account.userId,
    },
  );
  if (deletionError) {
    const errorMessage = deletionError.message?.toLowerCase() ?? "";
    if (deletionError.code === "23514" && errorMessage.includes("track_has_race_assignments")) {
      throw conflict("Cannot delete a route that is already assigned to race categories");
    }
    if (deletionError.code === "23514" && errorMessage.includes("track_has_generated_league_events")) {
      throw conflict("Cannot delete a route used by generated league races");
    }
    if (deletionError.code === "P0002" && errorMessage.includes("track_not_found")) {
      throw notFound("Route not found");
    }
    throw deletionError;
  }

  return { deleted: true, trackTemplateId };
}

export async function getOrganizerTrackGpxDownload(
  session: RequestSession,
  trackTemplateId: string,
  trackVersionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<TrackGpxDownload> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .select("id,organization_id,name,slug")
    .eq("id", trackTemplateId)
    .maybeSingle<{ id: string; organization_id: string; name: string; slug: string }>();

  if (templateError) throw templateError;
  if (!template) throw notFound("Route not found");
  requireOrganizationAccess(session, template.organization_id, "manage");

  const { data: version, error: versionError } = await adminClient
    .from("track_versions")
    .select("id,track_template_id,version_number")
    .eq("id", trackVersionId)
    .maybeSingle<{ id: string; track_template_id: string; version_number: number }>();

  if (versionError) throw versionError;
  if (!version || version.track_template_id !== trackTemplateId) {
    throw notFound("Route version not found");
  }

  return loadTrackVersionGpxDownload(adminClient, {
    trackVersionId,
    trackName: template.name,
    fallbackFileName: `${template.slug}-v${version.version_number}.gpx`,
  });
}

export async function getPublicTrackGpxDownload(
  trackSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<TrackGpxDownload> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: template, error: templateError } = await adminClient
    .from("track_templates")
    .select("id,name,slug")
    .eq("slug", trackSlug)
    .maybeSingle<{ id: string; name: string; slug: string }>();

  if (templateError) throw templateError;
  if (!template) throw notFound("Route not found");

  const { data: version, error: versionError } = await adminClient
    .from("track_versions")
    .select("id,version_number,published_at")
    .eq("track_template_id", template.id)
    .not("published_at", "is", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; version_number: number; published_at: string | null }>();

  if (versionError) throw versionError;
  if (!version?.published_at) throw notFound("Route not found");

  return loadTrackVersionGpxDownload(adminClient, {
    trackVersionId: version.id,
    trackName: template.name,
    fallbackFileName: `${template.slug}-v${version.version_number}.gpx`,
  });
}

const DEFAULT_LEAGUE_POINTS_TABLE = [100, 90, 82, 75, 70, 66, 62, 58, 55, 52];

function defaultLeagueClassificationInputs() {
  return PORTAL_DEFAULT_COMPETITION_CATEGORY_POLICY.classifications.map((category) => ({
    name: category.label,
    slug: category.key,
    eligibility: { ...category.eligibility },
    awardDepth: null,
    isDefault: false,
  }));
}

export function getOmittedLeagueClassificationIds(
  savedClassifications: Array<{ id: string; slug: string }>,
  configuredClassificationSlugs: Iterable<string>,
) {
  const configuredSlugs = new Set(configuredClassificationSlugs);
  return savedClassifications
    .filter((classification) => !configuredSlugs.has(classification.slug))
    .map((classification) => classification.id);
}

export function getUniqueLeagueClassificationSlugs(
  classifications: Array<{ name: string; slug?: string }>,
) {
  const usedSlugs = new Set<string>();
  return classifications.map((classification, index) => {
    const baseSlug = slugify(classification.slug ?? classification.name)
      || `classification-${index + 1}`;
    let uniqueSlug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(uniqueSlug)) {
      uniqueSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(uniqueSlug);
    return uniqueSlug;
  });
}

async function persistOrganizerLeagueCompetitions(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  seasonId: string,
  leagueName: string,
  seasonStatus: string,
  competitions: OrganizerLeagueCompetitionInput[] | undefined,
  defaultScoringRules: OrganizerLeagueScoringRulesInput | null | undefined,
) {
  const configuredCompetitions: OrganizerLeagueCompetitionInput[] = competitions?.length
    ? competitions
    : [{
        name: "Overall",
        slug: "overall",
        isDefault: true,
        description: "All eligible league races.",
        scoringTarget: "individual" as const,
        resultBasis: "finish_place",
        standingsMode: "points" as const,
        scoringRules: defaultScoringRules,
        classifications: defaultLeagueClassificationInputs(),
      }];

  const existingResponse = await adminClient
    .from("league_competitions")
    .select("id,slug,current_scoring_policy_version_id")
    .eq("league_season_id", seasonId)
    .returns<Array<{ id: string; slug: string; current_scoring_policy_version_id: string | null }>>();

  if (existingResponse.error) {
    if (isSchemaCompatError(existingResponse.error)) return false;
    throw existingResponse.error;
  }

  const existingBySlug = new Map((existingResponse.data ?? []).map((competition) => [competition.slug, competition]));
  const usedSlugs = new Set<string>();
  const configuredDefaultCompetitionIndex = Math.max(
    0,
    configuredCompetitions.findIndex((competition) => competition.isDefault === true),
  );

  const { error: clearCompetitionDefaultError } = await adminClient
    .from("league_competitions")
    .update({ is_default: false })
    .eq("league_season_id", seasonId)
    .eq("is_default", true);
  if (clearCompetitionDefaultError) {
    if (isSchemaCompatError(clearCompetitionDefaultError)) return false;
    throw clearCompetitionDefaultError;
  }

  for (const [displayOrder, configured] of configuredCompetitions.entries()) {
    const baseSlug = slugify(configured.slug ?? configured.name) || `competition-${displayOrder + 1}`;
    let competitionSlug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(competitionSlug)) {
      competitionSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(competitionSlug);

    const competitionPatch = {
      league_season_id: seasonId,
      slug: competitionSlug,
      name: configured.name,
      description: configured.description ?? null,
      scoring_target: configured.scoringTarget ?? "individual",
      result_basis: configured.resultBasis ?? "finish_place",
      standings_mode: configured.standingsMode ?? "points",
      display_order: displayOrder,
      is_default: displayOrder === configuredDefaultCompetitionIndex,
      status: seasonStatus === "draft" ? "draft" : "active",
    };
    const existing = existingBySlug.get(competitionSlug);
    let competitionId: string;

    if (existing) {
      const { error } = await adminClient
        .from("league_competitions")
        .update(competitionPatch)
        .eq("id", existing.id);
      if (error) throw error;
      competitionId = existing.id;
    } else {
      const { data, error } = await adminClient
        .from("league_competitions")
        .insert(competitionPatch)
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      competitionId = data.id;
    }

    const configuredClassifications = configured.classifications === undefined
      ? defaultLeagueClassificationInputs()
      : configured.classifications;
    const configuredDefaultClassificationIndex = configuredClassifications.findIndex(
      (classification) => classification.isDefault === true,
    );
    const { error: clearClassificationDefaultError } = await adminClient
      .from("league_classifications")
      .update({ is_default: false })
      .eq("league_competition_id", competitionId)
      .eq("is_default", true);
    if (clearClassificationDefaultError) throw clearClassificationDefaultError;
    const classificationSlugs = getUniqueLeagueClassificationSlugs(configuredClassifications);
    const classificationRows = configuredClassifications.map((classification, classificationIndex) => ({
      league_competition_id: competitionId,
      slug: classificationSlugs[classificationIndex],
      name: classification.name,
      eligibility_json: classification.eligibility ?? {},
      award_depth: classification.awardDepth ?? null,
      display_order: classificationIndex,
      is_default: classificationIndex === configuredDefaultClassificationIndex,
      status: "active",
    }));
    if (classificationRows.length) {
      const { error: classificationError } = await adminClient
        .from("league_classifications")
        .upsert(classificationRows, { onConflict: "league_competition_id,slug" });
      if (classificationError) throw classificationError;
    }

    const { data: savedClassifications, error: savedClassificationsError } = await adminClient
      .from("league_classifications")
      .select("id,slug")
      .eq("league_competition_id", competitionId)
      .returns<Array<{ id: string; slug: string }>>();
    if (savedClassificationsError) throw savedClassificationsError;
    const omittedClassificationIds = getOmittedLeagueClassificationIds(
      savedClassifications ?? [],
      classificationRows.map((classification) => classification.slug),
    );
    if (omittedClassificationIds.length) {
      const { error: archiveClassificationsError } = await adminClient
        .from("league_classifications")
        .update({ status: "archived" })
        .in("id", omittedClassificationIds);
      if (archiveClassificationsError) throw archiveClassificationsError;
    }

    const standingsMode = configured.standingsMode ?? "points";
    if (standingsMode !== "points") {
      const { error: clearScoringPolicyError } = await adminClient
        .from("league_competitions")
        .update({ current_scoring_policy_version_id: null })
        .eq("id", competitionId);
      if (clearScoringPolicyError) throw clearScoringPolicyError;
      continue;
    }

    const scoringRules = configured.scoringRules ?? defaultScoringRules ?? {};
    const { data: policyRows, error: policyLookupError } = await adminClient
      .from("league_scoring_policy_versions")
      .select("version_number")
      .eq("league_competition_id", competitionId)
      .order("version_number", { ascending: false })
      .limit(1)
      .returns<Array<{ version_number: number }>>();
    if (policyLookupError) throw policyLookupError;
    const nextVersion = (policyRows?.[0]?.version_number ?? 0) + 1;
    const pointsTable = (scoringRules.pointsTable ?? DEFAULT_LEAGUE_POINTS_TABLE)
      .map(Number)
      .filter((points) => Number.isFinite(points) && points >= 0);
    const policyPayload = {
      league_competition_id: competitionId,
      version_number: nextVersion,
      name: scoringRules.name ?? `${configured.name || leagueName} scoring`,
      points_table_json: pointsTable.length ? pointsTable : DEFAULT_LEAGUE_POINTS_TABLE,
      best_n_rounds: scoringRules.bestN ?? null,
      minimum_rounds: scoringRules.minimumRounds ?? 1,
      tie_break_method: scoringRules.tieBreakMethod ?? "best_finish",
      club_scoring_mode: scoringRules.clubScoringMode ?? null,
      change_note: nextVersion === 1 ? "Initial competition scoring policy." : "Updated from the league editor.",
    };
    let policyResponse = await adminClient
      .from("league_scoring_policy_versions")
      .insert({
        ...policyPayload,
        field_size_profile: scoringRules.fieldSizeProfile ?? "custom",
        participation_points: scoringRules.participationPoints ?? 0,
        scoring_method: scoringRules.scoringMethod ?? "custom",
        scoring_parameters_json: scoringRules.scoringParameters ?? {},
      })
      .select("id")
      .single<{ id: string }>();
    if (policyResponse.error && isSchemaCompatError(policyResponse.error)) {
      policyResponse = await adminClient
        .from("league_scoring_policy_versions")
        .insert({
          ...policyPayload,
          field_size_profile: scoringRules.fieldSizeProfile ?? "custom",
          participation_points: scoringRules.participationPoints ?? 0,
        })
        .select("id")
        .single<{ id: string }>();
    }
    if (policyResponse.error && isSchemaCompatError(policyResponse.error)) {
      policyResponse = await adminClient
        .from("league_scoring_policy_versions")
        .insert(policyPayload)
        .select("id")
        .single<{ id: string }>();
    }
    if (policyResponse.error) throw policyResponse.error;
    const policy = policyResponse.data;

    const { error: pointerError } = await adminClient
      .from("league_competitions")
      .update({ current_scoring_policy_version_id: policy.id })
      .eq("id", competitionId);
    if (pointerError) throw pointerError;
  }

  if (competitions?.length) {
    const omittedCompetitionIds = Array.from(existingBySlug.values())
      .filter((competition) => !usedSlugs.has(competition.slug))
      .map((competition) => competition.id);
    if (omittedCompetitionIds.length) {
      const { error } = await adminClient
        .from("league_competitions")
        .update({ status: "archived" })
        .in("id", omittedCompetitionIds);
      if (error) throw error;
    }
  }

  return true;
}

async function publishOrganizerLeagueScoringRuleVersion(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  session: RequestSession,
  organizationId: string,
  seasonId: string,
) {
  const { data: scoringRules, error: scoringRulesError } = await adminClient
    .from("league_scoring_rules")
    .select("name,points_table_json,best_n_rounds,minimum_rounds,tie_break_method,club_scoring_mode")
    .eq("league_season_id", seasonId)
    .maybeSingle<{
      name: string;
      points_table_json: unknown;
      best_n_rounds: number | null;
      minimum_rounds: number | null;
      tie_break_method: string | null;
      club_scoring_mode: string | null;
    }>();
  if (scoringRulesError) throw scoringRulesError;
  if (!scoringRules) throw conflict("Publish requires season scoring rules");

  const { error: scoringRuleVersionError } = await adminClient.rpc(
    "service_publish_league_scoring_rules",
    {
      p_organization_id: organizationId,
      p_league_season_id: seasonId,
      p_actor_user_id: session.account.userId,
      p_name: scoringRules.name,
      p_points_table_json: scoringRules.points_table_json,
      p_best_n_rounds: scoringRules.best_n_rounds,
      p_minimum_rounds: scoringRules.minimum_rounds ?? 1,
      p_tie_break_method: immutableLeagueTieBreakMethod(scoringRules.tie_break_method),
      p_club_members_per_round: scoringRules.club_scoring_mode === "best_one" ? 1 : 3,
      p_eligibility_json: {},
      p_client_event_id: randomUUID(),
    },
  );
  if (scoringRuleVersionError && !isLeagueScoringRulesUnchangedError(scoringRuleVersionError)) {
    throw scoringRuleVersionError;
  }
}

export function normalizeOrganizerLeagueLifecycleStatus(
  requestedStatus: string | null | undefined,
  publishedAt: string | null,
) {
  if (!publishedAt) return "draft";

  const normalized = requestedStatus?.trim().toLowerCase();
  return normalized === "active" || normalized === "completed" || normalized === "archived"
    ? normalized
    : "published";
}

export async function createOrganizerLeagueSeason(
  session: RequestSession,
  input: CreateOrganizerLeagueInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const organizationId = input.organizationId ?? session.account.organizationIds[0];
  if (!organizationId) {
    throw forbidden("Organizer access is required");
  }
  requireOrganizationAccess(session, organizationId, "manage");

  const year = input.year ?? new Date().getFullYear();
  const initialStatus = normalizeOrganizerLeagueLifecycleStatus(input.status, null);
  const leagueSlug = await uniqueScopedSlug(
    {
      table: "leagues",
      scopeColumn: "organization_id",
      scopeValue: organizationId,
      baseSlug: slugify(input.name),
    },
    env,
  );

  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .insert({
      organization_id: organizationId,
      slug: leagueSlug,
      name: input.name,
      description: input.description ?? null,
      status: initialStatus,
    })
    .select("id")
    .single<{ id: string }>();

  if (leagueError) throw leagueError;

  try {
    await replaceLeagueSports(adminClient, league.id, {
      sportCodes: input.sportCodes,
      primarySportCode: input.primarySportCode,
    });
  } catch (error) {
    await adminClient.from("leagues").delete().eq("id", league.id);
    throw error;
  }

  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .insert({
      league_id: league.id,
      year,
      name: input.name,
      status: initialStatus,
      starts_on: input.startsOn ?? null,
      ends_on: input.endsOn ?? null,
      timezone: input.timezone?.trim() || "Europe/Zagreb",
      club_scoring_scope: normalizeLeagueClubScoringScope(input.clubScoringScope),
      organizer_rules: optionalText(input.organizerRules),
    })
    .select("id")
    .single<{ id: string }>();

  if (seasonError) throw seasonError;
  if (input.organizerNotes !== undefined) {
    const { error: privateSettingsError } = await adminClient
      .from("league_season_private_settings")
      .upsert({
        league_season_id: season.id,
        organizer_notes: input.organizerNotes?.trim() || null,
        updated_by_user_id: session.account.userId,
      }, { onConflict: "league_season_id" });
    if (privateSettingsError) {
      await adminClient.from("leagues").delete().eq("id", league.id);
      throw privateSettingsError;
    }
  }
  if (input.scoringRules) {
    const scoringRulesPayload = {
      league_season_id: season.id,
      name: input.scoringRules.name ?? `${input.name} scoring`,
      points_table_json: (input.scoringRules.pointsTable ?? []).map((points) => ({ points })),
      best_n_rounds: input.scoringRules.bestN ?? null,
      minimum_rounds: input.scoringRules.minimumRounds ?? null,
      tie_break_method: input.scoringRules.tieBreakMethod ?? null,
      club_scoring_mode: input.scoringRules.clubScoringMode ?? null,
    };
    let scoringRulesResponse = await adminClient
      .from("league_scoring_rules")
      .insert({
        ...scoringRulesPayload,
        field_size_profile: input.scoringRules.fieldSizeProfile ?? "custom",
        participation_points: input.scoringRules.participationPoints ?? 0,
        scoring_method: input.scoringRules.scoringMethod ?? "custom",
        scoring_parameters_json: input.scoringRules.scoringParameters ?? {},
      });
    if (scoringRulesResponse.error && isSchemaCompatError(scoringRulesResponse.error)) {
      scoringRulesResponse = await adminClient.from("league_scoring_rules").insert({
        ...scoringRulesPayload,
        field_size_profile: input.scoringRules.fieldSizeProfile ?? "custom",
        participation_points: input.scoringRules.participationPoints ?? 0,
      });
    }
    if (scoringRulesResponse.error && isSchemaCompatError(scoringRulesResponse.error)) {
      scoringRulesResponse = await adminClient.from("league_scoring_rules").insert(scoringRulesPayload);
    }
    if (scoringRulesResponse.error) throw scoringRulesResponse.error;
  }

  try {
    await persistOrganizerLeagueCompetitions(
      adminClient,
      season.id,
      input.name,
      initialStatus,
      input.competitions,
      input.scoringRules,
    );
  } catch (error) {
    await adminClient.from("leagues").delete().eq("id", league.id);
    throw error;
  }

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const created = seasons.find((candidate) => candidate.seasonId === season.id) ?? null;
  if (!created) throw notFound("Created league season could not be loaded");
  return created;
}

export async function updateOrganizerLeagueSeason(
  session: RequestSession,
  input: UpdateOrganizerLeagueInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id")
    .eq("id", input.leagueId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,status,published_at")
    .eq("id", input.seasonId)
    .eq("league_id", input.leagueId)
    .maybeSingle<{ id: string; status: string; published_at: string | null }>();
  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  if (input.organizerNotes !== undefined) {
    const { error: privateSettingsError } = await adminClient
      .from("league_season_private_settings")
      .upsert({
        league_season_id: input.seasonId,
        organizer_notes: input.organizerNotes?.trim() || null,
        updated_by_user_id: session.account.userId,
      }, { onConflict: "league_season_id" });
    if (privateSettingsError) throw privateSettingsError;
  }

  if (input.competitions) {
    await assertMappedLeagueCompetitionRankingUpdates(
      adminClient,
      input.seasonId,
      input.competitions,
    );
  }

  const lifecycleStatus = normalizeOrganizerLeagueLifecycleStatus(
    input.status ?? season.status,
    season.published_at,
  );
  const leaguePatch: Record<string, string | null> = {};
  if (input.name !== undefined) leaguePatch.name = input.name;
  if (input.description !== undefined) leaguePatch.description = input.description;
  if (input.status !== undefined) leaguePatch.status = lifecycleStatus;

  if (Object.keys(leaguePatch).length) {
    const { error } = await adminClient.from("leagues").update(leaguePatch).eq("id", input.leagueId);
    if (error) throw error;
  }

  if (input.sportCodes !== undefined || input.primarySportCode !== undefined) {
    await replaceLeagueSports(adminClient, input.leagueId, {
      sportCodes: input.sportCodes,
      primarySportCode: input.primarySportCode,
    });
  }

  const seasonPatch: Record<string, string | number | null> = {};
  if (input.name !== undefined) seasonPatch.name = input.name;
  if (input.year !== undefined) seasonPatch.year = input.year;
  if (input.status !== undefined) seasonPatch.status = lifecycleStatus;
  if (input.startsOn !== undefined) seasonPatch.starts_on = input.startsOn;
  if (input.endsOn !== undefined) seasonPatch.ends_on = input.endsOn;
  if (input.timezone !== undefined) seasonPatch.timezone = input.timezone.trim();
  if (input.organizerRules !== undefined) seasonPatch.organizer_rules = optionalText(input.organizerRules);
  if (input.clubScoringScope !== undefined) {
    seasonPatch.club_scoring_scope = normalizeLeagueClubScoringScope(input.clubScoringScope);
  }

  if (Object.keys(seasonPatch).length) {
    const { error } = await adminClient.from("league_seasons").update(seasonPatch).eq("id", input.seasonId);
    if (error) throw error;
  }
  if (input.scoringRules) {
    const scoringRulesPayload = {
      league_season_id: input.seasonId,
      name: input.scoringRules.name ?? `${input.name ?? "League"} scoring`,
      points_table_json: (input.scoringRules.pointsTable ?? []).map((points) => ({ points })),
      best_n_rounds: input.scoringRules.bestN ?? null,
      minimum_rounds: input.scoringRules.minimumRounds ?? null,
      tie_break_method: input.scoringRules.tieBreakMethod ?? null,
      club_scoring_mode: input.scoringRules.clubScoringMode ?? null,
    };
    let scoringRulesResponse = await adminClient
      .from("league_scoring_rules")
      .upsert({
        ...scoringRulesPayload,
        field_size_profile: input.scoringRules.fieldSizeProfile ?? "custom",
        participation_points: input.scoringRules.participationPoints ?? 0,
        scoring_method: input.scoringRules.scoringMethod ?? "custom",
        scoring_parameters_json: input.scoringRules.scoringParameters ?? {},
      }, {
        onConflict: "league_season_id",
      });
    if (scoringRulesResponse.error && isSchemaCompatError(scoringRulesResponse.error)) {
      scoringRulesResponse = await adminClient
        .from("league_scoring_rules")
        .upsert({
          ...scoringRulesPayload,
          field_size_profile: input.scoringRules.fieldSizeProfile ?? "custom",
          participation_points: input.scoringRules.participationPoints ?? 0,
        }, { onConflict: "league_season_id" });
    }
    if (scoringRulesResponse.error && isSchemaCompatError(scoringRulesResponse.error)) {
      scoringRulesResponse = await adminClient
        .from("league_scoring_rules")
        .upsert(scoringRulesPayload, { onConflict: "league_season_id" });
    }
    if (scoringRulesResponse.error) throw scoringRulesResponse.error;
  }

  if (input.competitions || input.scoringRules) {
    await persistOrganizerLeagueCompetitions(
      adminClient,
      input.seasonId,
      input.name ?? "League",
      lifecycleStatus,
      input.competitions,
      input.scoringRules,
    );
  }
  if (season.published_at && input.scoringRules) {
    await publishOrganizerLeagueScoringRuleVersion(
      adminClient,
      session,
      league.organization_id,
      input.seasonId,
    );
  }

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const updated = seasons.find((candidate) => candidate.seasonId === input.seasonId) ?? null;
  if (!updated) throw notFound("Updated league season could not be loaded");
  return updated;
}

async function attachOrganizerLeagueRoundLegacy(
  session: RequestSession,
  seasonId: string,
  input: AttachOrganizerLeagueRoundInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const eventCategoryId = input.eventCategoryId ?? input.mappings?.[0]?.eventCategoryId;
  if (!eventCategoryId) throw badRequest("A race mapping is required");
  const categoryContext = await requireCategoryAccess(session, eventCategoryId, "manage", env);

  const [{ data: season, error: seasonError }, { data: category, error: categoryError }] = await Promise.all([
    adminClient
      .from("league_seasons")
      .select("id,league_id")
      .eq("id", seasonId)
      .maybeSingle<{ id: string; league_id: string }>(),
    adminClient
      .from("event_categories")
      .select("id,event_edition_id,results_mode,sport_code")
      .eq("id", eventCategoryId)
      .maybeSingle<{ id: string; event_edition_id: string; results_mode: string; sport_code: SportCode }>(),
  ]);

  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");
  if (categoryError) throw categoryError;
  if (!category) throw notFound("Race not found");
  if (mapCategoryType(category.results_mode) !== "competitive") {
    throw conflict("Only competitive races can be attached as league rounds");
  }

  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id")
    .eq("id", season.league_id)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  if (league.organization_id !== categoryContext.organizationId) {
    throw conflict("Rounds can only be attached inside the same organizer workspace");
  }

  const { data: leagueSportRows, error: leagueSportsError } = await adminClient
    .from("league_sports")
    .select("sport_code")
    .eq("league_id", league.id)
    .returns<Array<{ sport_code: SportCode }>>();
  if (leagueSportsError) throw leagueSportsError;
  const leagueSportCodes = new Set((leagueSportRows ?? []).map((row) => row.sport_code));
  if (!leagueSportCodes.has(category.sport_code)) {
    throw conflict("The race sport must be included in the league sports");
  }

  const { data: existingRound, error: existingRoundError } = await adminClient
    .from("league_rounds")
    .select("id")
    .eq("league_season_id", seasonId)
    .eq("event_category_id", eventCategoryId)
    .maybeSingle<{ id: string }>();

  if (existingRoundError) throw existingRoundError;
  if (existingRound) throw conflict("This race is already attached to the league season");

  const { data: roundRows, error: roundError } = await adminClient
    .from("league_rounds")
    .select("id,round_number")
    .eq("league_season_id", seasonId)
    .order("round_number", { ascending: true })
    .returns<Array<{ id: string; round_number: number }>>();

  if (roundError) throw roundError;

  const requestedRoundNumber = input.roundNumber ?? ((roundRows?.at(-1)?.round_number ?? 0) + 1);
  const nextRoundNumber = Math.max(1, requestedRoundNumber);

  if (input.roundNumber !== undefined) {
    const roundsToShift = (roundRows ?? []).filter((round) => round.round_number >= nextRoundNumber);
    for (const round of roundsToShift.reverse()) {
      const { error } = await adminClient
        .from("league_rounds")
        .update({ round_number: round.round_number + 1 })
        .eq("id", round.id);
      if (error) throw error;
    }
  }

  const { error: insertError } = await adminClient.from("league_rounds").insert({
    league_season_id: seasonId,
    event_edition_id: category.event_edition_id,
    event_category_id: eventCategoryId,
    round_number: nextRoundNumber,
    status: input.status ?? "scheduled",
  });

  if (insertError) throw insertError;

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const updated = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
  if (!updated) throw notFound("Updated league season could not be loaded");
  return updated;
}

type LeagueRankingCompetitionRow = {
  id: string;
  name: string;
};

type LeagueRankingClassificationRow = {
  league_competition_id: string;
  name: string;
  eligibility_json: Record<string, unknown> | null;
};

type LeagueRankingRaceRow = {
  id: string;
  name: string;
  ranking_config_json: unknown;
};

async function assertMappedRaceRankingUpdate(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  eventCategoryId: string,
  requestedName: string | undefined,
  requestedRankingConfig: CompetitiveRankingConfig | null | undefined,
  requestedCategoryType: "competitive" | "informative" | undefined,
) {
  const mappingResponse = await adminClient
    .from("league_round_race_mappings")
    .select("league_competition_id")
    .eq("event_category_id", eventCategoryId)
    .eq("status", "mapped")
    .returns<Array<{ league_competition_id: string }>>();
  if (mappingResponse.error) {
    if (isSchemaCompatError(mappingResponse.error)) return;
    throw mappingResponse.error;
  }
  const competitionIds = Array.from(new Set(
    (mappingResponse.data ?? []).map((mapping) => mapping.league_competition_id),
  ));
  if (!competitionIds.length) return;
  if (requestedCategoryType === "informative") {
    throw conflict("A race mapped into a league round must remain competitive");
  }

  const [competitionResponse, classificationResponse, raceResponse] = await Promise.all([
    adminClient
      .from("league_competitions")
      .select("id,name")
      .in("id", competitionIds)
      .returns<LeagueRankingCompetitionRow[]>(),
    adminClient
      .from("league_classifications")
      .select("league_competition_id,name,eligibility_json")
      .in("league_competition_id", competitionIds)
      .neq("status", "archived")
      .returns<LeagueRankingClassificationRow[]>(),
    adminClient
      .from("event_categories")
      .select("id,name,ranking_config_json")
      .eq("id", eventCategoryId)
      .single<LeagueRankingRaceRow>(),
  ]);
  if (competitionResponse.error) throw competitionResponse.error;
  if (classificationResponse.error) throw classificationResponse.error;
  if (raceResponse.error) throw raceResponse.error;

  const currentRace = raceResponse.data;
  const race = {
    ...currentRace,
    name: requestedName ?? currentRace.name,
    ranking_config_json: requestedRankingConfig === undefined
      ? currentRace.ranking_config_json
      : requestedRankingConfig ?? defaultCompetitiveRankingConfig(),
  };
  const issue = findLeagueRoundRankingCompatibilityIssue(
    competitionIds.map((competitionId) => ({ competitionId, eventCategoryId })),
    competitionResponse.data ?? [],
    classificationResponse.data ?? [],
    [race],
  );
  if (issue) throw conflict(issue);
}

async function assertMappedLeagueCompetitionRankingUpdates(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  seasonId: string,
  configuredCompetitions: OrganizerLeagueCompetitionInput[],
) {
  const [competitionResponse, roundResponse] = await Promise.all([
    adminClient
      .from("league_competitions")
      .select("id,slug")
      .eq("league_season_id", seasonId)
      .returns<Array<{ id: string; slug: string }>>(),
    adminClient
      .from("league_round_events")
      .select("id")
      .eq("league_season_id", seasonId)
      .returns<Array<{ id: string }>>(),
  ]);
  for (const response of [competitionResponse, roundResponse]) {
    if (response.error) {
      if (isSchemaCompatError(response.error)) return;
      throw response.error;
    }
  }
  const roundIds = (roundResponse.data ?? []).map((round) => round.id);
  if (!roundIds.length) return;

  const mappingResponse = await adminClient
    .from("league_round_race_mappings")
    .select("league_competition_id,event_category_id")
    .in("league_round_event_id", roundIds)
    .eq("status", "mapped")
    .returns<Array<{ league_competition_id: string; event_category_id: string }>>();
  if (mappingResponse.error) throw mappingResponse.error;
  if (!mappingResponse.data?.length) return;

  const existingBySlug = new Map(
    (competitionResponse.data ?? []).map((competition) => [competition.slug, competition]),
  );
  const proposedCompetitions: LeagueRankingCompetitionRow[] = [];
  const proposedClassifications: LeagueRankingClassificationRow[] = [];
  const usedSlugs = new Set<string>();
  for (const [displayOrder, configured] of configuredCompetitions.entries()) {
    const baseSlug = slugify(configured.slug ?? configured.name) || `competition-${displayOrder + 1}`;
    let competitionSlug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(competitionSlug)) {
      competitionSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(competitionSlug);
    const existing = existingBySlug.get(competitionSlug);
    if (!existing) continue;
    proposedCompetitions.push({ id: existing.id, name: configured.name });
    const classifications = configured.classifications?.length
      ? configured.classifications
      : [{ name: "Overall", eligibility: {} }];
    proposedClassifications.push(...classifications.map((classification) => ({
      league_competition_id: existing.id,
      name: classification.name,
      eligibility_json: classification.eligibility ?? {},
    })));
  }

  const proposedCompetitionIds = new Set(proposedCompetitions.map((competition) => competition.id));
  const mappings = mappingResponse.data
    .filter((mapping) => proposedCompetitionIds.has(mapping.league_competition_id))
    .map((mapping) => ({
      competitionId: mapping.league_competition_id,
      eventCategoryId: mapping.event_category_id,
    }));
  if (!mappings.length) return;
  const raceIds = Array.from(new Set(mappings.map((mapping) => mapping.eventCategoryId)));
  const raceResponse = await adminClient
    .from("event_categories")
    .select("id,name,ranking_config_json")
    .in("id", raceIds)
    .returns<LeagueRankingRaceRow[]>();
  if (raceResponse.error) throw raceResponse.error;
  const issue = findLeagueRoundRankingCompatibilityIssue(
    mappings,
    proposedCompetitions,
    proposedClassifications,
    raceResponse.data ?? [],
  );
  if (issue) throw conflict(issue);
}

function findLeagueRoundRankingCompatibilityIssue(
  mappings: Array<{ competitionId: string; eventCategoryId: string }>,
  competitions: LeagueRankingCompetitionRow[],
  classifications: LeagueRankingClassificationRow[],
  races: LeagueRankingRaceRow[],
) {
  const competitionsById = new Map(competitions.map((competition) => [competition.id, competition]));
  const racesById = new Map(races.map((race) => [race.id, race]));
  for (const mapping of mappings) {
    const competition = competitionsById.get(mapping.competitionId);
    const race = racesById.get(mapping.eventCategoryId);
    if (!competition || !race) continue;
    const issue = getLeagueRaceRankingCompatibilityIssue(
      competition.name,
      classifications
        .filter((classification) => classification.league_competition_id === competition.id)
        .map((classification) => ({
          name: classification.name,
          eligibility: classification.eligibility_json,
        })),
      race.name,
      normalizeCompetitiveRankingConfig(race.ranking_config_json),
    );
    if (issue) return issue;
  }
  return null;
}

async function reconcileOrganizerLeagueResultSources(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  session: RequestSession,
  organizationId: string,
  seasonId: string,
) {
  const { error } = await adminClient.rpc("service_reconcile_league_result_sources", {
    p_organization_id: organizationId,
    p_league_season_id: seasonId,
    p_actor_user_id: session.account.userId,
    p_change_note: "Reconciled result sources after organizer league round mapping.",
  });
  if (error && !isSchemaCompatError(error)) throw error;
}

export async function attachOrganizerLeagueRound(
  session: RequestSession,
  seasonId: string,
  input: AttachOrganizerLeagueRoundInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const competitionResponse = await adminClient
    .from("league_competitions")
    .select("id,league_season_id,name,scoring_target,status")
    .eq("league_season_id", seasonId)
    .returns<Array<{ id: string; league_season_id: string; name: string; scoring_target: string; status: string }>>();

  if (competitionResponse.error) {
    if (isSchemaCompatError(competitionResponse.error)) {
      return attachOrganizerLeagueRoundLegacy(session, seasonId, input, env);
    }
    throw competitionResponse.error;
  }

  const allCompetitions = competitionResponse.data ?? [];
  if (!allCompetitions.length) {
    return attachOrganizerLeagueRoundLegacy(session, seasonId, input, env);
  }
  const competitions = allCompetitions.filter((competition) => competition.status !== "archived");
  const scoredCompetitions = competitions.filter((competition) => competition.scoring_target === "individual");
  if (!scoredCompetitions.length) throw badRequest("Define at least one active league race category first");

  const primaryCompetition = scoredCompetitions[0];
  const requestedMappings = input.mappings?.length
    ? input.mappings
    : input.eventCategoryId && primaryCompetition
      ? [{ competitionId: primaryCompetition.id, eventCategoryId: input.eventCategoryId }]
      : [];
  if (!requestedMappings.length) throw badRequest("Map at least one competition to a race");

  const duplicateCompetitionId = requestedMappings.find((mapping, index) =>
    requestedMappings.findIndex((candidate) => candidate.competitionId === mapping.competitionId) !== index
  )?.competitionId;
  if (duplicateCompetitionId) throw conflict("Each competition can map to only one race in a round");

  const duplicateRaceId = requestedMappings.find((mapping, index) =>
    requestedMappings.findIndex((candidate) => candidate.eventCategoryId === mapping.eventCategoryId) !== index
  )?.eventCategoryId;
  if (duplicateRaceId) throw conflict("Each race can map to only one league race category");

  const competitionIds = new Set(competitions.map((competition) => competition.id));
  if (requestedMappings.some((mapping) => !competitionIds.has(mapping.competitionId))) {
    throw conflict("Every mapped competition must belong to this league season");
  }
  const scoredCompetitionIds = new Set(scoredCompetitions.map((competition) => competition.id));
  if (requestedMappings.some((mapping) => !scoredCompetitionIds.has(mapping.competitionId))) {
    throw conflict("Every mapped competition must be an active league race category");
  }

  const categoryIds = Array.from(new Set(requestedMappings.map((mapping) => mapping.eventCategoryId)));
  const categoryContexts = await Promise.all(
    categoryIds.map((categoryId) => requireCategoryAccess(session, categoryId, "manage", env)),
  );
  const { data: categoryRows, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,event_edition_id,name,results_mode,ranking_config_json,sport_code")
    .in("id", categoryIds)
    .returns<Array<{
      id: string;
      event_edition_id: string;
      name: string;
      results_mode: string;
      ranking_config_json: unknown;
      sport_code: SportCode;
    }>>();
  if (categoryError) throw categoryError;
  if ((categoryRows ?? []).length !== categoryIds.length) throw notFound("One or more mapped races were not found");
  if ((categoryRows ?? []).some((category) => mapCategoryType(category.results_mode) !== "competitive")) {
    throw conflict("Only competitive races can be mapped into league competitions");
  }

  const eventEditionIds = new Set((categoryRows ?? []).map((category) => category.event_edition_id));
  if (eventEditionIds.size !== 1) {
    throw conflict("All competition races in one round must belong to the same race edition");
  }
  const eventEditionId = Array.from(eventEditionIds)[0];
  if (input.eventEditionId && input.eventEditionId !== eventEditionId) {
    throw conflict("Mapped races must belong to the selected round race");
  }
  const { data: eventRaceRows, error: eventRaceError } = await adminClient
    .from("event_categories")
    .select("id,results_mode")
    .eq("event_edition_id", eventEditionId)
    .returns<Array<{ id: string; results_mode: string }>>();
  if (eventRaceError) throw eventRaceError;
  const competitiveRaceIds = new Set(
    (eventRaceRows ?? [])
      .filter((category) => mapCategoryType(category.results_mode) === "competitive")
      .map((category) => category.id),
  );
  const excludedCourseIds = input.excludedCourseIds ?? [];
  const coverageIssue = getLeagueCourseCoverageIssue({
    competitionIds: Array.from(scoredCompetitionIds),
    courseIds: Array.from(competitiveRaceIds),
    mappings: requestedMappings,
    excludedCourseIds,
  });
  if (coverageIssue) throw conflict(coverageIssue);

  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,league_id")
    .eq("id", seasonId)
    .maybeSingle<{ id: string; league_id: string }>();
  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");

  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id")
    .eq("id", season.league_id)
    .maybeSingle<{ id: string; organization_id: string }>();
  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");
  if (categoryContexts.some((context) => context.organizationId !== league.organization_id)) {
    throw conflict("Rounds can only use races inside the same organizer workspace");
  }


  const { data: leagueSportRows, error: leagueSportsError } = await adminClient
    .from("league_sports")
    .select("sport_code")
    .eq("league_id", league.id)
    .returns<Array<{ sport_code: SportCode }>>();
  if (leagueSportsError) throw leagueSportsError;
  const leagueSportCodes = new Set((leagueSportRows ?? []).map((row) => row.sport_code));
  if ((categoryRows ?? []).some((category) => !leagueSportCodes.has(category.sport_code))) {
    throw conflict("Every mapped race sport must be included in the league sports");
  }

  const { data: classificationRows, error: classificationError } = await adminClient
    .from("league_classifications")
    .select("league_competition_id,name,eligibility_json")
    .in("league_competition_id", Array.from(scoredCompetitionIds))
    .neq("status", "archived")
    .returns<LeagueRankingClassificationRow[]>();
  if (classificationError) throw classificationError;
  const rankingCompatibilityIssue = findLeagueRoundRankingCompatibilityIssue(
    requestedMappings,
    scoredCompetitions,
    classificationRows ?? [],
    categoryRows ?? [],
  );
  if (rankingCompatibilityIssue) throw conflict(rankingCompatibilityIssue);

  const { data: existingEventRound, error: existingEventError } = await adminClient
    .from("league_round_events")
    .select("id")
    .eq("league_season_id", seasonId)
    .eq("event_edition_id", eventEditionId)
    .maybeSingle<{ id: string }>();
  if (existingEventError) throw existingEventError;
  if (existingEventRound) {
    const { error: upsertMappingError } = await adminClient
      .from("league_round_race_mappings")
      .upsert(
        requestedMappings.map((mapping) => ({
          league_round_event_id: existingEventRound.id,
          league_competition_id: mapping.competitionId,
          event_category_id: mapping.eventCategoryId,
          status: "mapped",
        })),
        { onConflict: "league_round_event_id,league_competition_id" },
      );
    if (upsertMappingError) throw upsertMappingError;

    const { data: savedMappings, error: savedMappingsError } = await adminClient
      .from("league_round_race_mappings")
      .select("id,league_competition_id")
      .eq("league_round_event_id", existingEventRound.id)
      .returns<Array<{ id: string; league_competition_id: string }>>();
    if (savedMappingsError) throw savedMappingsError;
    const requestedCompetitionIds = new Set(requestedMappings.map((mapping) => mapping.competitionId));
    const staleMappingIds = (savedMappings ?? [])
      .filter((mapping) => !requestedCompetitionIds.has(mapping.league_competition_id))
      .map((mapping) => mapping.id);
    if (staleMappingIds.length) {
      const { error: staleMappingError } = await adminClient
        .from("league_round_race_mappings")
        .delete()
        .in("id", staleMappingIds);
      if (staleMappingError) throw staleMappingError;
    }

    const primaryMapping = requestedMappings.find((mapping) => mapping.competitionId === primaryCompetition.id)
      ?? requestedMappings[0];
    const { data: legacyRoundRows, error: legacyRoundLookupError } = await adminClient
      .from("league_rounds")
      .select("id")
      .eq("league_season_id", seasonId)
      .eq("event_edition_id", eventEditionId)
      .returns<Array<{ id: string }>>();
    if (legacyRoundLookupError) throw legacyRoundLookupError;
    if (legacyRoundRows?.length) {
      const { error: legacyRoundUpdateError } = await adminClient
        .from("league_rounds")
        .update({ event_category_id: primaryMapping.eventCategoryId })
        .eq("league_season_id", seasonId)
        .eq("event_edition_id", eventEditionId);
      if (legacyRoundUpdateError) throw legacyRoundUpdateError;
    } else {
      const { data: existingRoundEvent, error: existingRoundEventError } = await adminClient
        .from("league_round_events")
        .select("round_number,status")
        .eq("id", existingEventRound.id)
        .single<{ round_number: number; status: string }>();
      if (existingRoundEventError) throw existingRoundEventError;
      const { error: legacyRoundInsertError } = await adminClient.from("league_rounds").insert({
        league_season_id: seasonId,
        event_edition_id: eventEditionId,
        event_category_id: primaryMapping.eventCategoryId,
        round_number: existingRoundEvent.round_number,
        status: existingRoundEvent.status,
      });
      if (legacyRoundInsertError) throw legacyRoundInsertError;
    }

    const { error: coverageSaveError } = await adminClient
      .from("league_round_events")
      .update({ excluded_event_category_ids: excludedCourseIds })
      .eq("id", existingEventRound.id);
    if (coverageSaveError) throw coverageSaveError;

    await reconcileOrganizerLeagueResultSources(
      adminClient,
      session,
      league.organization_id,
      seasonId,
    );

    const seasons = await getOrganizerLeagueSeasons(session, env);
    const updated = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
    if (!updated) throw notFound("Updated league season could not be loaded");
    return updated;
  }

  const [{ data: roundRows, error: roundError }, { data: legacyRoundRows, error: legacyRoundError }] = await Promise.all([
    adminClient
      .from("league_round_events")
      .select("id,round_number")
      .eq("league_season_id", seasonId)
      .order("round_number", { ascending: true })
      .returns<Array<{ id: string; round_number: number }>>(),
    adminClient
      .from("league_rounds")
      .select("id,round_number")
      .eq("league_season_id", seasonId)
      .order("round_number", { ascending: true })
      .returns<Array<{ id: string; round_number: number }>>(),
  ]);
  if (roundError) throw roundError;
  if (legacyRoundError) throw legacyRoundError;

  const requestedRoundNumber = input.roundNumber ?? ((roundRows?.at(-1)?.round_number ?? 0) + 1);
  const nextRoundNumber = Math.max(1, requestedRoundNumber);
  if (input.roundNumber !== undefined) {
    const roundsToShift = (roundRows ?? []).filter((round) => round.round_number >= nextRoundNumber).reverse();
    for (const round of roundsToShift) {
      const { error } = await adminClient
        .from("league_round_events")
        .update({ round_number: round.round_number + 1 })
        .eq("id", round.id);
      if (error) throw error;
    }
    const legacyRoundsToShift = (legacyRoundRows ?? []).filter((round) => round.round_number >= nextRoundNumber).reverse();
    for (const round of legacyRoundsToShift) {
      const { error } = await adminClient
        .from("league_rounds")
        .update({ round_number: round.round_number + 1 })
        .eq("id", round.id);
      if (error) throw error;
    }
  }

  const { data: roundEvent, error: roundEventError } = await adminClient
    .from("league_round_events")
    .insert({
      league_season_id: seasonId,
      event_edition_id: eventEditionId,
      round_number: nextRoundNumber,
      status: input.status ?? "scheduled",
      excluded_event_category_ids: excludedCourseIds,
    })
    .select("id")
    .single<{ id: string }>();
  if (roundEventError) throw roundEventError;

  try {
    const { error: mappingError } = await adminClient.from("league_round_race_mappings").insert(
      requestedMappings.map((mapping) => ({
        league_round_event_id: roundEvent.id,
        league_competition_id: mapping.competitionId,
        event_category_id: mapping.eventCategoryId,
        status: "mapped",
      })),
    );
    if (mappingError) throw mappingError;

    const primaryMapping = requestedMappings.find((mapping) => mapping.competitionId === primaryCompetition?.id)
      ?? requestedMappings[0];
    const { error: legacyInsertError } = await adminClient.from("league_rounds").insert({
      league_season_id: seasonId,
      event_edition_id: eventEditionId,
      event_category_id: primaryMapping.eventCategoryId,
      round_number: nextRoundNumber,
      status: input.status ?? "scheduled",
    });
    if (legacyInsertError) throw legacyInsertError;
  } catch (error) {
    await adminClient.from("league_round_events").delete().eq("id", roundEvent.id);
    throw error;
  }

  await reorderOrganizerLeagueRoundsChronologically(adminClient, seasonId);

  await reconcileOrganizerLeagueResultSources(
    adminClient,
    session,
    league.organization_id,
    seasonId,
  );

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const updated = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
  if (!updated) throw notFound("Updated league season could not be loaded");
  return updated;
}

async function detachOrganizerLeagueRoundLegacy(
  session: RequestSession,
  seasonId: string,
  roundId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);

  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,league_id")
    .eq("id", seasonId)
    .maybeSingle<{ id: string; league_id: string }>();

  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");

  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id")
    .eq("id", season.league_id)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  const { data: round, error: roundError } = await adminClient
    .from("league_rounds")
    .select("id,round_number")
    .eq("id", roundId)
    .eq("league_season_id", seasonId)
    .maybeSingle<{ id: string; round_number: number }>();

  if (roundError) throw roundError;
  if (!round) throw notFound("League round not found");

  const { error: deleteError } = await adminClient.from("league_rounds").delete().eq("id", roundId);
  if (deleteError) throw deleteError;

  await reorderOrganizerLeagueRoundsChronologically(adminClient, seasonId);

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const updated = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
  if (!updated) throw notFound("Updated league season could not be loaded");
  return updated;
}

export async function detachOrganizerLeagueRound(
  session: RequestSession,
  seasonId: string,
  roundId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: roundEvent, error: roundEventError } = await adminClient
    .from("league_round_events")
    .select("id,league_season_id,event_edition_id,round_number")
    .eq("id", roundId)
    .eq("league_season_id", seasonId)
    .maybeSingle<{ id: string; league_season_id: string; event_edition_id: string; round_number: number }>();

  if (roundEventError) {
    if (isSchemaCompatError(roundEventError)) {
      return detachOrganizerLeagueRoundLegacy(session, seasonId, roundId, env);
    }
    throw roundEventError;
  }
  if (!roundEvent) {
    return detachOrganizerLeagueRoundLegacy(session, seasonId, roundId, env);
  }

  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,league_id")
    .eq("id", seasonId)
    .maybeSingle<{ id: string; league_id: string }>();
  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");
  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id")
    .eq("id", season.league_id)
    .maybeSingle<{ id: string; organization_id: string }>();
  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  // Recurrence occurrences are derivative materialization records. Their
  // foreign key intentionally prevents a generated round from being orphaned,
  // so remove the occurrence before detaching the round. The recurrence rule
  // remains the source of truth and can generate the occurrence again later.
  const { error: recurrenceOccurrenceDeleteError } = await adminClient
    .from("league_recurrence_occurrences")
    .delete()
    .eq("league_round_event_id", roundEvent.id);
  if (recurrenceOccurrenceDeleteError && !isSchemaCompatError(recurrenceOccurrenceDeleteError)) {
    throw recurrenceOccurrenceDeleteError;
  }

  const { error: deleteError } = await adminClient.from("league_round_events").delete().eq("id", roundEvent.id);
  if (deleteError) throw deleteError;
  const { error: legacyDeleteError } = await adminClient
    .from("league_rounds")
    .delete()
    .eq("league_season_id", seasonId)
    .eq("event_edition_id", roundEvent.event_edition_id);
  if (legacyDeleteError) throw legacyDeleteError;

  const { error: recurrenceEventTombstoneError } = await adminClient.rpc(
    "service_tombstone_orphaned_recurrence_event",
    { p_event_edition_id: roundEvent.event_edition_id },
  );
  if (recurrenceEventTombstoneError && !isSchemaCompatError(recurrenceEventTombstoneError)) {
    throw recurrenceEventTombstoneError;
  }

  await reorderOrganizerLeagueRoundsChronologically(adminClient, seasonId);

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const updated = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
  if (!updated) throw notFound("Updated league season could not be loaded");
  return updated;
}

export async function detachAllOrganizerLeagueRounds(
  session: RequestSession,
  seasonId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,league_id")
    .eq("id", seasonId)
    .maybeSingle<{ id: string; league_id: string }>();
  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");

  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id")
    .eq("id", season.league_id)
    .maybeSingle<{ id: string; organization_id: string }>();
  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  const { data: rounds, error: roundsError } = await adminClient
    .from("league_round_events")
    .select("id,event_edition_id")
    .eq("league_season_id", seasonId)
    .returns<Array<{ id: string; event_edition_id: string }>>();
  if (roundsError && !isSchemaCompatError(roundsError)) throw roundsError;
  const roundIds = (rounds ?? []).map((round) => round.id);
  const roundEventEditionIds = (rounds ?? []).map((round) => round.event_edition_id);

  if (roundIds.length) {
    const { error: occurrenceDeleteError } = await adminClient
      .from("league_recurrence_occurrences")
      .delete()
      .in("league_round_event_id", roundIds);
    if (occurrenceDeleteError && !isSchemaCompatError(occurrenceDeleteError)) {
      throw occurrenceDeleteError;
    }

    const { error: roundDeleteError } = await adminClient
      .from("league_round_events")
      .delete()
      .eq("league_season_id", seasonId);
    if (roundDeleteError) throw roundDeleteError;
  }

  const { error: legacyDeleteError } = await adminClient
    .from("league_rounds")
    .delete()
    .eq("league_season_id", seasonId);
  if (legacyDeleteError) throw legacyDeleteError;

  for (const eventEditionId of roundEventEditionIds) {
    const { error: recurrenceEventTombstoneError } = await adminClient.rpc(
      "service_tombstone_orphaned_recurrence_event",
      { p_event_edition_id: eventEditionId },
    );
    if (recurrenceEventTombstoneError && !isSchemaCompatError(recurrenceEventTombstoneError)) {
      throw recurrenceEventTombstoneError;
    }
  }

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const updated = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
  if (!updated) throw notFound("Updated league season could not be loaded");
  return updated;
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
  session: RequestSession,
  seasonId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PublishOrganizerLeagueSeasonRacesResult> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,league_id")
    .eq("id", seasonId)
    .maybeSingle<{ id: string; league_id: string }>();
  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");

  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("organization_id")
    .eq("id", season.league_id)
    .maybeSingle<{ organization_id: string }>();
  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  let roundEventIds: string[] = [];
  let roundCount = 0;
  const { data: roundEvents, error: roundEventsError } = await adminClient
    .from("league_round_events")
    .select("event_edition_id")
    .eq("league_season_id", seasonId)
    .returns<Array<{ event_edition_id: string }>>();
  if (roundEventsError && !isSchemaCompatError(roundEventsError)) throw roundEventsError;

  if (roundEventsError) {
    const { data: legacyRounds, error: legacyRoundsError } = await adminClient
      .from("league_rounds")
      .select("event_edition_id")
      .eq("league_season_id", seasonId)
      .returns<Array<{ event_edition_id: string }>>();
    if (legacyRoundsError) throw legacyRoundsError;
    roundCount = legacyRounds?.length ?? 0;
    roundEventIds = Array.from(new Set((legacyRounds ?? []).map((round) => round.event_edition_id)));
  } else {
    roundCount = roundEvents?.length ?? 0;
    roundEventIds = Array.from(new Set((roundEvents ?? []).map((round) => round.event_edition_id)));
  }

  if (!roundEventIds.length) {
    return {
      seasonId,
      roundCount,
      eventCount: 0,
      raceCount: 0,
      publishedRaceCount: 0,
      unchangedRaceCount: 0,
      publishedEventCount: 0,
      unchangedEventCount: 0,
    };
  }

  await Promise.all(
    roundEventIds.map((eventEditionId) => (
      requireEditionAccess(session, eventEditionId, "manage", env)
    )),
  );

  const { data: editions, error: editionsError } = await adminClient
    .from("event_editions")
    .select("id,published_at,public_visibility")
    .in("id", roundEventIds)
    .returns<Array<{
      id: string;
      published_at: string | null;
      public_visibility: string | null;
    }>>();
  if (editionsError) throw editionsError;

  const eventIdsToPublish = (editions ?? [])
    .filter((edition) => !edition.published_at || edition.public_visibility === "private")
    .map((edition) => edition.id);

  const { data: categories, error: categoriesError } = await adminClient
    .from("event_categories")
    .select("id,status,results_mode")
    .in("event_edition_id", roundEventIds)
    .returns<Array<{ id: string; status: string; results_mode: string }>>();
  if (categoriesError) throw categoriesError;

  const races = (categories ?? []).filter(
    (category) => mapCategoryType(category.results_mode) === "competitive",
  );
  const draftRaceIds = races
    .filter((race) => race.status === "draft")
    .map((race) => race.id);

  if (draftRaceIds.length) {
    const { error: publishError } = await adminClient
      .from("event_categories")
      .update({ status: "published" })
      .in("id", draftRaceIds);
    if (publishError) throw publishError;
  }

  const readinessByEvent = await Promise.all(
    eventIdsToPublish.map(async (eventEditionId) => ({
      eventEditionId,
      readiness: await getOrganizerEventPublishReadiness(session, eventEditionId, env),
    })),
  );
  const blockedEvents = readinessByEvent
    .filter(({ readiness }) => readiness.blockers.length > 0)
    .map(({ eventEditionId, readiness }) => ({
      eventEditionId,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
    }));
  if (blockedEvents.length) {
    throw conflict("Resolve the linked race publishing blockers before going live", {
      events: blockedEvents,
    });
  }

  await Promise.all(
    eventIdsToPublish.map((eventEditionId) => (
      publishOrganizerEvent(session, eventEditionId, {}, env)
    )),
  );

  return {
    seasonId,
    roundCount,
    eventCount: roundEventIds.length,
    raceCount: races.length,
    publishedRaceCount: draftRaceIds.length,
    unchangedRaceCount: races.length - draftRaceIds.length,
    publishedEventCount: eventIdsToPublish.length,
    unchangedEventCount: roundEventIds.length - eventIdsToPublish.length,
  };
}

export async function deleteOrganizerLeague(
  session: RequestSession,
  leagueId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id")
    .eq("id", leagueId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  const { data: seasons, error: seasonsError } = await adminClient
    .from("league_seasons")
    .select("id")
    .eq("league_id", leagueId)
    .returns<Array<{ id: string }>>();
  if (seasonsError) throw seasonsError;

  const seasonIds = (seasons ?? []).map((season) => season.id);
  const generatedEventEditionIds: string[] = [];
  if (seasonIds.length) {
    const { data: recurrenceRules, error: recurrenceRulesError } = await adminClient
      .from("league_recurrence_rules")
      .select("id")
      .in("league_season_id", seasonIds)
      .returns<Array<{ id: string }>>();
    if (recurrenceRulesError && !isSchemaCompatError(recurrenceRulesError)) {
      throw recurrenceRulesError;
    }

    const recurrenceRuleIds = (recurrenceRules ?? []).map((rule) => rule.id);
    if (recurrenceRuleIds.length) {
      const { data: recurrenceOccurrences, error: recurrenceOccurrencesError } = await adminClient
        .from("league_recurrence_occurrences")
        .select("event_edition_id")
        .in("recurrence_rule_id", recurrenceRuleIds)
        .not("event_edition_id", "is", null)
        .returns<Array<{ event_edition_id: string }>>();
      if (recurrenceOccurrencesError && !isSchemaCompatError(recurrenceOccurrencesError)) {
        throw recurrenceOccurrencesError;
      }
      generatedEventEditionIds.push(...new Set(
        (recurrenceOccurrences ?? []).map((occurrence) => occurrence.event_edition_id),
      ));

      const { error: occurrencesDeleteError } = await adminClient
        .from("league_recurrence_occurrences")
        .delete()
        .in("recurrence_rule_id", recurrenceRuleIds);
      if (occurrencesDeleteError && !isSchemaCompatError(occurrencesDeleteError)) {
        throw occurrencesDeleteError;
      }

      const { error: categoryTemplatesDeleteError } = await adminClient
        .from("league_recurrence_category_templates")
        .delete()
        .in("recurrence_rule_id", recurrenceRuleIds);
      if (categoryTemplatesDeleteError && !isSchemaCompatError(categoryTemplatesDeleteError)) {
        throw categoryTemplatesDeleteError;
      }

      const { error: recurrenceRulesDeleteError } = await adminClient
        .from("league_recurrence_rules")
        .delete()
        .in("id", recurrenceRuleIds);
      if (recurrenceRulesDeleteError && !isSchemaCompatError(recurrenceRulesDeleteError)) {
        throw recurrenceRulesDeleteError;
      }
    }
  }

  const { error } = await adminClient.from("leagues").delete().eq("id", leagueId);
  if (error) {
    if (isForeignKeyViolation(error)) {
      throw conflict("Cannot delete a league that has retained standings, scoring, or import history");
    }
    throw error;
  }

  for (const eventEditionId of generatedEventEditionIds) {
    const { error: recurrenceEventTombstoneError } = await adminClient.rpc(
      "service_tombstone_orphaned_recurrence_event",
      { p_event_edition_id: eventEditionId },
    );
    if (recurrenceEventTombstoneError && !isSchemaCompatError(recurrenceEventTombstoneError)) {
      throw recurrenceEventTombstoneError;
    }
  }

  return { deleted: true, leagueId };
}

export async function publishOrganizerLeagueSeason(
  session: RequestSession,
  seasonId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: season, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,league_id,status")
    .eq("id", seasonId)
    .maybeSingle<{ id: string; league_id: string; status: string }>();

  if (seasonError) throw seasonError;
  if (!season) throw notFound("League season not found");

  const { data: league, error: leagueError } = await adminClient
    .from("leagues")
    .select("id,organization_id,status")
    .eq("id", season.league_id)
    .maybeSingle<{ id: string; organization_id: string; status: string }>();

  if (leagueError) throw leagueError;
  if (!league) throw notFound("League not found");
  requireOrganizationAccess(session, league.organization_id, "manage");

  const { count, error: roundError } = await adminClient
    .from("league_rounds")
    .select("id", { count: "exact", head: true })
    .eq("league_season_id", seasonId);

  if (roundError) throw roundError;
  if ((count ?? 0) < 1) {
    throw conflict("Publish requires at least one round");
  }

  const competitionResponse = await adminClient
    .from("league_competitions")
    .select("id,name,scoring_target,standings_mode,current_scoring_policy_version_id")
    .eq("league_season_id", seasonId)
    .neq("status", "archived")
    .returns<Array<{
      id: string;
      name: string;
      scoring_target: string;
      standings_mode: "points" | "best_time" | "participation" | "none";
      current_scoring_policy_version_id: string | null;
    }>>();
  if (competitionResponse.error && !isSchemaCompatError(competitionResponse.error)) {
    throw competitionResponse.error;
  }
  if (!competitionResponse.error) {
    const competitions = competitionResponse.data ?? [];
    const scoredCompetitions = competitions.filter((competition) => competition.scoring_target === "individual");
    if (!scoredCompetitions.length) {
      throw conflict("Publish requires at least one individual competition");
    }
    const competitionWithoutPolicy = scoredCompetitions.find((competition) => (
      competition.standings_mode === "points"
      && !competition.current_scoring_policy_version_id
    ));
    if (competitionWithoutPolicy) {
      throw conflict(`${competitionWithoutPolicy.name} needs a scoring policy before publishing`);
    }

    const { data: roundEvents, error: roundEventsError } = await adminClient
      .from("league_round_events")
      .select("id,event_edition_id,excluded_event_category_ids")
      .eq("league_season_id", seasonId)
      .returns<Array<{ id: string; event_edition_id: string; excluded_event_category_ids: string[] }>>();
    if (roundEventsError) throw roundEventsError;
    const roundIds = (roundEvents ?? []).map((round) => round.id);
    if (!roundIds.length) throw conflict("Publish requires at least one race round");
    const eventEditionIds = Array.from(new Set((roundEvents ?? []).map((round) => round.event_edition_id)));
    const [{ data: mappings, error: mappingError }, { data: eventRaceRows, error: eventRaceError }] = await Promise.all([
      adminClient
        .from("league_round_race_mappings")
        .select("league_round_event_id,league_competition_id,event_category_id,status")
        .in("league_round_event_id", roundIds)
        .eq("status", "mapped")
        .returns<Array<{
          league_round_event_id: string;
          league_competition_id: string;
          event_category_id: string;
          status: string;
        }>>(),
      adminClient
        .from("event_categories")
        .select("id,event_edition_id,results_mode")
        .in("event_edition_id", eventEditionIds)
        .returns<Array<{ id: string; event_edition_id: string; results_mode: string }>>(),
    ]);
    if (mappingError) throw mappingError;
    if (eventRaceError) throw eventRaceError;
    const scoredCompetitionIds = scoredCompetitions.map((competition) => competition.id);
    const scoredCompetitionIdSet = new Set(scoredCompetitionIds);
    for (const round of roundEvents ?? []) {
      const issue = getLeagueCourseCoverageIssue({
        competitionIds: scoredCompetitionIds,
        courseIds: (eventRaceRows ?? []).filter((race) => race.event_edition_id === round.event_edition_id && mapCategoryType(race.results_mode) === "competitive").map((race) => race.id),
        mappings: (mappings ?? []).filter((mapping) => mapping.league_round_event_id === round.id).map((mapping) => ({ competitionId: mapping.league_competition_id, eventCategoryId: mapping.event_category_id })),
        excludedCourseIds: round.excluded_event_category_ids ?? [],
      });
      if (issue) throw conflict(issue);
    }

    const scoredMappings = (mappings ?? []).filter((mapping) =>
      scoredCompetitionIdSet.has(mapping.league_competition_id)
    );
    const mappedRaceIds = Array.from(new Set(scoredMappings.map((mapping) => mapping.event_category_id)));
    const [classificationResponse, raceResponse] = await Promise.all([
      adminClient
        .from("league_classifications")
        .select("league_competition_id,name,eligibility_json")
        .in("league_competition_id", scoredCompetitionIds)
        .neq("status", "archived")
        .returns<LeagueRankingClassificationRow[]>(),
      adminClient
        .from("event_categories")
        .select("id,name,ranking_config_json")
        .in("id", mappedRaceIds)
        .returns<LeagueRankingRaceRow[]>(),
    ]);
    if (classificationResponse.error) throw classificationResponse.error;
    if (raceResponse.error) throw raceResponse.error;
    const rankingCompatibilityIssue = findLeagueRoundRankingCompatibilityIssue(
      scoredMappings.map((mapping) => ({
        competitionId: mapping.league_competition_id,
        eventCategoryId: mapping.event_category_id,
      })),
      scoredCompetitions,
      classificationResponse.data ?? [],
      raceResponse.data ?? [],
    );
    if (rankingCompatibilityIssue) throw conflict(rankingCompatibilityIssue);
  }

  const hasPointsCompetition = !competitionResponse.error
    ? (competitionResponse.data ?? []).some((competition) => (
        competition.scoring_target === "individual" && competition.standings_mode === "points"
      ))
    : true;
  if (hasPointsCompetition) {
    await publishOrganizerLeagueScoringRuleVersion(
      adminClient,
      session,
      league.organization_id,
      seasonId,
    );
  }

  // Public league read models expose active competitions only. Publishing the
  // season must promote every configured, non-archived competition in the same
  // workflow or valid result mappings remain invisible to public standings.
  if (!competitionResponse.error) {
    const { error: competitionPublishError } = await adminClient
      .from("league_competitions")
      .update({ status: "active" })
      .eq("league_season_id", seasonId)
      .neq("status", "archived");
    if (competitionPublishError) throw competitionPublishError;
  }

  const now = new Date().toISOString();
  const { error: seasonUpdateError } = await adminClient
    .from("league_seasons")
    .update({
      published_at: now,
      status: season.status === "draft" ? "published" : season.status,
    })
    .eq("id", seasonId);

  if (seasonUpdateError) throw seasonUpdateError;

  if (league.status === "draft") {
    const { error: leagueUpdateError } = await adminClient
      .from("leagues")
      .update({ status: "published" })
      .eq("id", league.id);
    if (leagueUpdateError) throw leagueUpdateError;
  }

  const seasons = await getOrganizerLeagueSeasons(session, env);
  const published = seasons.find((candidate) => candidate.seasonId === seasonId) ?? null;
  if (!published) throw notFound("Published league season could not be loaded");
  return published;
}

async function loadOrganizerDashboardLeagueSeasonSummary(
  organizationIds: string[],
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  if (!organizationIds.length) {
    return { total: 0, pendingPublish: 0 };
  }

  const { data: leagueRows, error: leagueError } = await adminClient
    .from("leagues")
    .select("id")
    .in("organization_id", organizationIds)
    .returns<Array<{ id: string }>>();

  if (leagueError) throw leagueError;
  const leagueIds = (leagueRows ?? []).map((league) => league.id);
  if (!leagueIds.length) {
    return { total: 0, pendingPublish: 0 };
  }

  const { data: seasonRows, error: seasonError } = await adminClient
    .from("league_seasons")
    .select("id,published_at")
    .in("league_id", leagueIds)
    .returns<Array<{ id: string; published_at: string | null }>>();

  if (seasonError) throw seasonError;
  const seasons = seasonRows ?? [];
  return {
    total: seasons.length,
    pendingPublish: seasons.filter((season) => !season.published_at).length,
  };
}

export function selectOrganizerDashboardEvents<T extends { isPractice: boolean }>(events: T[]) {
  return events.filter((event) => !event.isPractice);
}

export const ORGANIZER_DASHBOARD_RECENT_PUBLICATION_LIMIT = 2;

export function selectOrganizerDashboardEventWindow<
  T extends { isPractice: boolean; startDate: string; status: string },
>(events: T[], _today = startOfTodayDate()) {
  const dashboardEvents = selectOrganizerDashboardEvents(events);
  const upcomingCandidates = dashboardEvents
    .filter((event) => event.status !== "completed" && event.status !== "archived")
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  const finishedCandidates = dashboardEvents
    .filter(
      (event) =>
        event.status === "completed"
        || event.status === "archived",
    )
    .sort((left, right) => right.startDate.localeCompare(left.startDate));

  return {
    events: dashboardEvents,
    activeEventCount: upcomingCandidates.length,
    upcomingEvents: upcomingCandidates.slice(0, 3),
    finishedEvents: finishedCandidates.slice(0, 4),
  };
}

export async function getOrganizerDashboardReadModel(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
  requestedOrganizationId?: string | null,
): Promise<OrganizerDashboardReadModel> {
  const dashboardPermissions = new Set([
    "events.manage",
    "entrants.manage",
    "race_day.manage",
    "results.manage",
  ]);
  const availableOrganizationIds = session.account.isMasterAdmin
    ? session.account.organizationIds
    : session.account.organizations
        .filter(
          (organization) =>
            (
              organization.role === "owner"
              || (
                organization.role === "admin"
                && organization.permissions.some((permission) =>
                  dashboardPermissions.has(permission)
                )
              )
            ),
        )
        .map((organization) => organization.organizationId);
  const organizationIds = requestedOrganizationId
    ? availableOrganizationIds.filter((organizationId) => organizationId === requestedOrganizationId)
    : availableOrganizationIds;
  if (!session.account.hasOrganizerAccess || !organizationIds.length) {
    throw forbidden("Organizer access is required");
  }

  const adminClient = createAdminSupabaseClient(env);
  const [events, tracks, leagueSeasonSummary] = await Promise.all([
    loadOrganizerManagedEventSummaries(organizationIds, env),
    loadOrganizerManagedTracks(organizationIds, env, { includeGallery: false, includeGeometry: false }),
    loadOrganizerDashboardLeagueSeasonSummary(organizationIds, env),
  ]);
  const eventWindow = selectOrganizerDashboardEventWindow(events);
  const managedEvents = eventWindow.events;
  const managedTracks = tracks.filter((track) => track.slug !== "sitrail-practice-route");
  const organizationId = organizationIds[0];
  const organizationName =
    session.account.organizations.find(
      (organization) => organization.organizationId === organizationId,
    )?.organizationName
    ?? "Organization";
  const activeEventCount = eventWindow.activeEventCount;
  const upcomingEventSummaries = eventWindow.upcomingEvents;
  const finishedEventSummaries = eventWindow.finishedEvents;

  const editionIds = managedEvents.map((event) => event.id);
  const { data: dashboardCategoryRows, error: dashboardCategoryError } = editionIds.length
    ? await adminClient
        .from("event_categories")
        .select("id,event_edition_id")
        .in("event_edition_id", editionIds)
        .is("organizer_deleted_at", null)
        .returns<Array<{ id: string; event_edition_id: string }>>()
    : {
        data: [] as Array<{ id: string; event_edition_id: string }>,
        error: null,
      };
  if (dashboardCategoryError) throw dashboardCategoryError;

  const categoryRows = dashboardCategoryRows ?? [];
  const categoryIds = categoryRows.map((category) => category.id);
  const categoryIdsByEventId = new Map<string, string[]>();
  const eventIdByCategoryId = new Map<string, string>();
  for (const category of categoryRows) {
    const eventCategoryIds = categoryIdsByEventId.get(category.event_edition_id) ?? [];
    eventCategoryIds.push(category.id);
    categoryIdsByEventId.set(category.event_edition_id, eventCategoryIds);
    eventIdByCategoryId.set(category.id, category.event_edition_id);
  }
  const dashboardEventIds = new Set([
    ...upcomingEventSummaries.map((event) => event.id),
    ...finishedEventSummaries.map((event) => event.id),
  ]);
  const dashboardCategoryIds = categoryRows
    .filter((category) => dashboardEventIds.has(category.event_edition_id))
    .map((category) => category.id);
  const upcomingCategoryIds = upcomingEventSummaries.flatMap(
    (event) => categoryIdsByEventId.get(event.id) ?? [],
  );

  const [publicationsResponse, membershipsResponse, recentRegistrationsResponse, trackSnapshotsResponse, upcomingRegistrationsResponse] = await Promise.all([
    categoryIds.length
      ? adminClient
          .from("result_publications")
          .select("event_category_id,published_at,publication_state", { count: "exact" })
          .in("event_category_id", categoryIds)
          .order("published_at", { ascending: false })
          .limit(ORGANIZER_DASHBOARD_RECENT_PUBLICATION_LIMIT)
          .returns<Array<{ event_category_id: string; published_at: string; publication_state: string }>>()
      : Promise.resolve({
          data: [] as Array<{ event_category_id: string; published_at: string; publication_state: string }>,
          error: null,
          count: 0,
        }),
    adminClient
      .from("organization_memberships")
      .select("user_id,role,account_template_key")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .returns<Array<{
        user_id: string;
        role: string;
        account_template_key: string | null;
      }>>(),
    categoryIds.length
      ? adminClient
          .from("registrations")
          .select("event_category_id,created_at")
          .in("event_category_id", categoryIds)
          .order("created_at", { ascending: false })
          .limit(5)
          .returns<Array<{ event_category_id: string; created_at: string }>>()
      : Promise.resolve({ data: [] as Array<{ event_category_id: string; created_at: string }>, error: null }),
    dashboardCategoryIds.length
      ? adminClient
          .from("event_category_track_snapshots")
          .select("event_category_id,track_template_id")
          .in("event_category_id", dashboardCategoryIds)
          .returns<Array<{ event_category_id: string; track_template_id: string | null }>>()
      : Promise.resolve({
          data: [] as Array<{ event_category_id: string; track_template_id: string | null }>,
          error: null,
        }),
    upcomingCategoryIds.length
      ? adminClient
          .from("registrations")
          .select("id,event_category_id")
          .in("event_category_id", upcomingCategoryIds)
          .is("organizer_removed_at", null)
          .returns<Array<{ id: string; event_category_id: string }>>()
      : Promise.resolve({
          data: [] as Array<{ id: string; event_category_id: string }>,
          error: null,
        }),
  ]);

  if (publicationsResponse.error) throw publicationsResponse.error;
  if (membershipsResponse.error) throw membershipsResponse.error;
  if (recentRegistrationsResponse.error) throw recentRegistrationsResponse.error;
  if (trackSnapshotsResponse.error) throw trackSnapshotsResponse.error;
  if (upcomingRegistrationsResponse.error) throw upcomingRegistrationsResponse.error;

  const membershipUserIds = Array.from(new Set(
    (membershipsResponse.data ?? []).map((membership) => membership.user_id),
  ));
  const registrationIdsForUpcoming = (upcomingRegistrationsResponse.data ?? []).map(
    (registration) => registration.id,
  );
  const [userProfilesResponse, checkinsResponse] = await Promise.all([
    membershipUserIds.length
      ? adminClient
          .from("user_profiles")
          .select("user_id,display_name")
          .in("user_id", membershipUserIds)
          .returns<Array<{ user_id: string; display_name: string | null }>>()
      : Promise.resolve({
          data: [] as Array<{ user_id: string; display_name: string | null }>,
          error: null,
        }),
    registrationIdsForUpcoming.length
      ? adminClient
          .from("checkins")
          .select("registration_id")
          .in("registration_id", registrationIdsForUpcoming)
          .returns<Array<{ registration_id: string }>>()
      : Promise.resolve({ data: [] as Array<{ registration_id: string }>, error: null }),
  ]);
  if (userProfilesResponse.error) throw userProfilesResponse.error;
  if (checkinsResponse.error) throw checkinsResponse.error;

  const eventById = new Map(managedEvents.map((event) => [event.id, event]));
  const categoryToEvent = new Map<string, OrganizerManagedEventSummary>();
  for (const category of categoryRows) {
    const event = eventById.get(category.event_edition_id);
    if (event) categoryToEvent.set(category.id, event);
  }

  const eventIdByRegistrationId = new Map(
    (upcomingRegistrationsResponse.data ?? []).flatMap((registration) => {
      const eventId = eventIdByCategoryId.get(registration.event_category_id);
      return eventId ? [[registration.id, eventId] as const] : [];
    }),
  );
  const checkedInByEventId = new Map<string, number>();
  for (const checkin of checkinsResponse.data ?? []) {
    const eventId = eventIdByRegistrationId.get(checkin.registration_id);
    if (!eventId) continue;
    checkedInByEventId.set(eventId, (checkedInByEventId.get(eventId) ?? 0) + 1);
  }

  const trackTemplateIdsByEventId = new Map<string, string[]>();
  for (const snapshot of trackSnapshotsResponse.data ?? []) {
    const eventId = eventIdByCategoryId.get(snapshot.event_category_id);
    if (!eventId || !snapshot.track_template_id) continue;
    const templateIds = trackTemplateIdsByEventId.get(eventId) ?? [];
    if (!templateIds.includes(snapshot.track_template_id)) {
      templateIds.push(snapshot.track_template_id);
    }
    trackTemplateIdsByEventId.set(eventId, templateIds);
  }
  const managedTrackById = new Map(managedTracks.map((track) => [track.templateId, track]));
  const toDashboardEvent = (
    event: OrganizerManagedEventSummary,
    statusOverride?: "completed",
  ): OrganizerDashboardReadModel["upcomingEvents"][number] => {
    const linkedTrackImageUrl = (trackTemplateIdsByEventId.get(event.id) ?? [])
      .map((trackTemplateId) => managedTrackById.get(trackTemplateId))
      .map((track) => track?.galleryPreviewImageUrl)
      .find((imageUrl): imageUrl is string => Boolean(imageUrl))
      ?? null;

    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      date: formatShortDateLabel(event.startDate),
      registrations: event.totalRegistrations,
      capacity: event.totalCapacity,
      checkedIn: checkedInByEventId.get(event.id) ?? 0,
      status: statusOverride ?? (
        event.status === "in_progress"
          ? "live"
          : event.status === "completed" || event.status === "archived"
          ? "completed"
          : "prep"
      ),
      isPublic: event.isPublic,
      publishedAt: event.publishedAt,
      coverImageUrl: event.coverImageUrl,
      linkedTrackImageUrl,
    };
  };
  const upcomingEvents = upcomingEventSummaries.map((event) => toDashboardEvent(event));
  const finishedEvents = finishedEventSummaries.map((event) => toDashboardEvent(event, "completed"));

  const checkedInCount = checkinsResponse.data?.length ?? 0;
  const publicationCount = publicationsResponse.count ?? 0;
  const eventsPendingPublish = managedEvents.filter((event) => !event.isPublic).length;
  const tracksPendingPublish = managedTracks.filter((track) => !track.isPublic).length;
  const leagueSeasonsPendingPublish = leagueSeasonSummary.pendingPublish;

  const recentActivity = [
    ...(eventsPendingPublish > 0
      ? [
          {
            text: `${eventsPendingPublish} event${eventsPendingPublish === 1 ? "" : "s"} still private`,
            time: "publish queue",
          },
        ]
      : []),
    ...(recentRegistrationsResponse.data ?? []).map((registration) => {
      const event = categoryToEvent.get(registration.event_category_id);
      return {
        text: `New registration received for ${event?.name ?? "event"}`,
        time: formatRelativeTime(registration.created_at),
      };
    }),
    ...(publicationsResponse.data ?? []).slice(0, 2).map((publication) => {
      const event = categoryToEvent.get(publication.event_category_id);
      return {
        text: `${publication.publication_state} results published for ${event?.name ?? "event"}`,
        time: formatRelativeTime(publication.published_at),
      };
    }),
  ].slice(0, 5);

  const userProfileById = new Map((userProfilesResponse.data ?? []).map((row) => [row.user_id, row.display_name]));
  const staff = (membershipsResponse.data ?? []).map((membership) => {
    const role =
      membership.role === "owner"
        ? "Organization Owner"
        : membership.account_template_key === "organization-admin"
        ? "Organization Admin"
        : membership.account_template_key === "checkpoint-timer"
        ? "Checkpoint Timer"
        : "Race Day Operator";
    return {
      name:
        membership.user_id === session.account.userId
          ? "You"
          : userProfileById.get(membership.user_id)
            ?? (membership.account_template_key === "checkpoint-timer"
              ? "Checkpoint timer"
              : "Team member"),
      role,
    };
  });

  return {
    organizationName,
    activeEvents: activeEventCount,
    totalRegistrations: managedEvents.reduce((sum, event) => sum + event.totalRegistrations, 0),
    checkedIn: checkedInCount,
    publishedResults: publicationCount,
    ownedTracks: managedTracks.length,
    ownedLeagueSeasons: leagueSeasonSummary.total,
    eventsPendingPublish,
    tracksPendingPublish,
    leagueSeasonsPendingPublish,
    upcomingEvents,
    finishedEvents,
    recentActivity,
    staff,
  };
}

export async function getOrganizerRegistrations(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(
    session,
    eventEditionId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  return loadRegistrationListForEdition(eventEditionId, env);
}

function normalizeOnsiteAthleteMatchText(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("hr")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function onsiteEmailHint(value: string | null | undefined) {
  const email = value?.trim();
  if (!email) return null;
  const separator = email.indexOf("@");
  if (separator <= 0) return "Email saved";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, 1)}${local.length > 1 ? "***" : ""}@${domain}`;
}

export async function findOrganizerOnsiteAthleteMatches(
  session: RequestSession,
  eventEditionId: string,
  input: {
    firstName: string;
    lastName: string;
    dateOfBirth?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizerOnsiteAthleteMatch[]> {
  await requireEditionAccess(
    session,
    eventEditionId,
    ["entrants.manage", "race_day.manage"],
    env,
  );

  const firstName = cleanRequiredText(input.firstName, "First name");
  const lastName = cleanRequiredText(input.lastName, "Last name");
  if (firstName.length < 2 || lastName.length < 2) return [];
  const dateOfBirth = input.dateOfBirth?.trim()
    ? normalizeGuestDateOfBirth(input.dateOfBirth)
    : null;
  const safeFirstName = firstName.replace(/[%_]/g, "");
  const safeLastName = lastName.replace(/[%_]/g, "");
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: athleteRows, error: athleteError }, { data: categoryRows, error: categoryError }] = await Promise.all([
    adminClient
      .from("athlete_profiles")
      .select("id,display_name,first_name,last_name,date_of_birth,birth_year,city,country_code,primary_email,is_claimed")
      .eq("status", "active")
      .is("merged_into_athlete_profile_id", null)
      .ilike("first_name", `%${safeFirstName}%`)
      .ilike("last_name", `%${safeLastName}%`)
      .limit(12)
      .returns<Array<{
        id: string;
        display_name: string;
        first_name: string;
        last_name: string;
        date_of_birth: string | null;
        birth_year: number | null;
        city: string | null;
        country_code: string | null;
        primary_email: string | null;
        is_claimed: boolean;
      }>>(),
    adminClient
      .from("event_categories")
      .select("id")
      .eq("event_edition_id", eventEditionId)
      .is("organizer_deleted_at", null)
      .returns<Array<{ id: string }>>(),
  ]);
  if (athleteError) throw athleteError;
  if (categoryError) throw categoryError;
  if (!athleteRows?.length) return [];

  const athleteIds = athleteRows.map((athlete) => athlete.id);
  const categoryIds = (categoryRows ?? []).map((category) => category.id);
  const { data: registrationRows, error: registrationError } = categoryIds.length
    ? await adminClient
        .from("registrations")
        .select("athlete_profile_id,event_category_id,status")
        .in("athlete_profile_id", athleteIds)
        .in("event_category_id", categoryIds)
        .not("status", "in", "(cancelled,expired,transferred,deferred)")
        .returns<Array<{
          athlete_profile_id: string;
          event_category_id: string;
          status: string;
        }>>()
    : { data: [], error: null };
  if (registrationError) throw registrationError;

  const registeredCategoryIdsByAthlete = new Map<string, string[]>();
  for (const registration of registrationRows ?? []) {
    const registeredCategoryIds = registeredCategoryIdsByAthlete.get(registration.athlete_profile_id) ?? [];
    if (!registeredCategoryIds.includes(registration.event_category_id)) {
      registeredCategoryIds.push(registration.event_category_id);
    }
    registeredCategoryIdsByAthlete.set(registration.athlete_profile_id, registeredCategoryIds);
  }

  const normalizedFirstName = normalizeOnsiteAthleteMatchText(firstName);
  const normalizedLastName = normalizeOnsiteAthleteMatchText(lastName);
  return athleteRows
    .map((athlete) => ({
      athleteProfileId: athlete.id,
      displayName: athlete.display_name,
      firstName: athlete.first_name,
      lastName: athlete.last_name,
      birthYear: athlete.birth_year
        ?? (athlete.date_of_birth ? Number(athlete.date_of_birth.slice(0, 4)) : null),
      city: athlete.city,
      countryCode: athlete.country_code?.trim().toUpperCase() || null,
      emailHint: onsiteEmailHint(athlete.primary_email),
      isClaimed: athlete.is_claimed,
      exactNameMatch:
        normalizeOnsiteAthleteMatchText(athlete.first_name) === normalizedFirstName
        && normalizeOnsiteAthleteMatchText(athlete.last_name) === normalizedLastName,
      exactDateOfBirthMatch: Boolean(
        dateOfBirth && athlete.date_of_birth === dateOfBirth,
      ),
      registeredCategoryIds: registeredCategoryIdsByAthlete.get(athlete.id) ?? [],
    }))
    .sort((left, right) =>
      Number(right.exactDateOfBirthMatch) - Number(left.exactDateOfBirthMatch)
      || Number(right.exactNameMatch) - Number(left.exactNameMatch)
      || left.displayName.localeCompare(right.displayName, "hr"),
    );
}

export async function createOrganizerOnsiteRegistration(
  session: RequestSession,
  eventEditionId: string,
  input: CreateOrganizerOnsiteRegistrationInput,
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(
    session,
    eventEditionId,
    ["entrants.manage", "race_day.manage"],
    env,
  );

  const firstName = cleanRequiredText(input.firstName, "First name");
  const lastName = cleanRequiredText(input.lastName, "Last name");
  const dateOfBirth = normalizeGuestDateOfBirth(input.dateOfBirth);
  const gender = normalizeGuestGender(input.gender);
  const email = cleanOptionalText(input.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("Enter a valid email address or leave it empty");
  }
  const countryCode = normalizeGuestCountryCode(input.countryCode);
  if (!input.organizerAttested) {
    throw badRequest("Confirm the athlete's onsite registration consent");
  }

  const normalizedRequest = {
    eventEditionId,
    eventCategoryId: input.eventCategoryId,
    existingAthleteProfileId: input.existingAthleteProfileId ?? null,
    firstName,
    lastName,
    email,
    dateOfBirth,
    gender,
    city: cleanOptionalText(input.city),
    countryCode,
    phone: cleanOptionalText(input.phone),
    emergencyContactName: cleanOptionalText(input.emergencyContactName),
    emergencyContactPhone: cleanOptionalText(input.emergencyContactPhone),
    bibNumber: cleanOptionalText(input.bibNumber),
    publicStartListOptIn: input.publicStartListOptIn ?? false,
    organizerAttested: true,
  };
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const requestHash = sha256(JSON.stringify(normalizedRequest));
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "service_create_organizer_onsite_registration",
    {
      p_event_edition_id: eventEditionId,
      p_event_category_id: input.eventCategoryId,
      p_existing_athlete_profile_id: input.existingAthleteProfileId ?? null,
      p_athlete_slug_base: slugify(`${firstName}-${lastName}`),
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: email,
      p_date_of_birth: dateOfBirth,
      p_gender: gender,
      p_city: normalizedRequest.city,
      p_country_code: countryCode,
      p_phone: normalizedRequest.phone,
      p_emergency_contact_name: normalizedRequest.emergencyContactName,
      p_emergency_contact_phone: normalizedRequest.emergencyContactPhone,
      p_public_start_list_opt_in: normalizedRequest.publicStartListOptIn,
      p_organizer_attested: true,
      p_actor_user_id: session.account.userId,
      p_idempotency_key_hash: idempotencyKeyHash,
      p_idempotency_request_hash: requestHash,
    },
  );

  if (error) {
    const message = error.message ?? "onsite_registration_failed";
    if (
      error.code === "PGRST202"
      || (
        message.includes("service_create_organizer_onsite_registration")
        && (
          message.toLowerCase().includes("schema cache")
          || message.toLowerCase().includes("could not find the function")
          || message.toLowerCase().includes("does not exist")
        )
      )
    ) {
      throw serviceUnavailable(
        "Onsite registration is temporarily unavailable while the database update completes",
      );
    }
    if (message.includes("onsite_email_exists")) {
      throw conflict("That email belongs to an existing athlete. Select the matching athlete instead of creating a duplicate.");
    }
    if (message.includes("already_registered")) {
      throw conflict("This athlete is already registered for the selected race");
    }
    if (message.includes("onsite_registration_closed")) {
      throw conflict("Onsite registration is no longer available after the race starts or closes");
    }
    if (message.includes("onsite_category_not_found")) throw notFound("Race not found");
    if (message.includes("onsite_athlete_not_found")) {
      throw notFound("The selected athlete profile is no longer available");
    }
    if (
      message.includes("onsite_registration_input_invalid")
      || message.includes("onsite_country_code_invalid")
    ) {
      throw badRequest("Complete the required onsite athlete details");
    }
    throwAtomicRegistrationError(error);
  }

  const created = data as {
    registrationId: string;
    athleteProfileId: string;
    registrationStatus: string;
    paymentStatus: string;
    profileCreated: boolean;
    replayed: boolean;
  };
  if (!created?.registrationId) {
    throw new Error("Onsite registration transaction returned no record");
  }

  if (
    normalizedRequest.bibNumber
    && ["pending", "confirmed"].includes(created.registrationStatus)
  ) {
    await setRegistrationBibNumber(
      created.registrationId,
      eventEditionId,
      input.eventCategoryId,
      normalizedRequest.bibNumber,
      session.account.userId,
      env,
    );
  }

  const registrations = await loadRegistrationListForEdition(eventEditionId, env);
  const registration = registrations.find((item) => item.id === created.registrationId);
  if (!registration) throw notFound("Onsite registration could not be loaded");
  return {
    registration,
    profileCreated: created.profileCreated,
    replayed: created.replayed,
  };
}

export async function getRegistrationPaymentEvidence(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireRegistrationPaymentEvidenceAccess(session, registrationId, env);
  return loadRegistrationPaymentEvidence(registrationId, env);
}

export async function submitRegistrationPaymentEvidence(
  session: RequestSession,
  input: SubmitRegistrationPaymentEvidenceInput,
  env: ServerEnv = loadServerEnv(),
) {
  const context = await resolveRegistrationContext(input.registrationId, env);
  const athleteProfileId = requireAthleteProfileId(session);
  if (athleteProfileId !== context.athleteProfileId) {
    throw forbidden("You can only submit payment evidence for your own registration");
  }
  if (context.status === "cancelled") {
    throw conflict("Payment evidence cannot be submitted for a cancelled registration");
  }

  const objectPath = cleanRequiredText(input.objectPath, "Object path");
  if (
    !objectPath.startsWith(`${input.registrationId}/`) ||
    objectPath.includes("..") ||
    objectPath.length > 500
  ) {
    throw badRequest("Invalid payment evidence object path");
  }

  const originalFileName = cleanRequiredText(input.originalFileName, "File name");
  if (originalFileName.length > 255) {
    throw badRequest("File name is too long");
  }
  if (!PAYMENT_EVIDENCE_CONTENT_TYPES.has(input.contentType)) {
    throw badRequest("Use a PDF, JPG, PNG, or WebP payment document");
  }

  const currency = input.currency?.trim().toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw badRequest("Currency must be a three-letter code");
  }
  if (input.amountCents != null && (!Number.isInteger(input.amountCents) || input.amountCents < 0)) {
    throw badRequest("Payment amount must be a positive whole number of cents");
  }

  const adminClient = createAdminSupabaseClient(env);
  const objectName = objectPath.slice(`${input.registrationId}/`.length);
  const { data: storedObjects, error: storageError } = await adminClient.storage
    .from(PAYMENT_EVIDENCE_BUCKET)
    .list(input.registrationId, { search: objectName, limit: 10 });

  if (storageError) throw storageError;
  if (!(storedObjects ?? []).some((item) => item.name === objectName)) {
    throw badRequest("Upload the payment document before submitting it for review");
  }

  const { error: insertError } = await adminClient
    .from("registration_payment_evidence")
    .insert({
      registration_id: input.registrationId,
      object_path: objectPath,
      original_file_name: originalFileName,
      content_type: input.contentType,
      amount_cents: input.amountCents ?? null,
      currency,
      submitted_by_user_id: session.account.userId,
      review_status: "submitted",
    });

  if (insertError) {
    if (insertError.code === "23505") throw conflict("This payment document was already submitted");
    throw insertError;
  }

  return loadRegistrationPaymentEvidence(input.registrationId, env);
}

export async function reviewRegistrationPaymentEvidence(
  session: RequestSession,
  evidenceId: string,
  input: { reviewStatus: "verified" | "rejected"; organizerNote?: string | null },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: evidence, error: evidenceError } = await adminClient
    .from("registration_payment_evidence")
    .select("id,registration_id")
    .eq("id", evidenceId)
    .maybeSingle<{ id: string; registration_id: string }>();

  if (evidenceError) throw evidenceError;
  if (!evidence) throw notFound("Payment evidence not found");

  await requireRegistrationAccess(
    session,
    evidence.registration_id,
    "finance.manage",
    env,
  );
  const { error: reviewError } = await adminClient.rpc(
    "review_registration_payment_evidence_atomically",
    {
      target_evidence_id: evidenceId,
      target_reviewer_user_id: session.account.userId,
      target_review_status: input.reviewStatus,
      target_organizer_note: cleanOptionalText(input.organizerNote),
    },
  );

  if (reviewError) {
    if (reviewError.message.includes("payment_evidence_not_found")) {
      throw notFound("Payment evidence not found");
    }
    if (reviewError.message.includes("invalid_payment_evidence_review_status")) {
      throw badRequest("Choose verified or rejected");
    }
    if (reviewError.message.includes("manual_payment_already_posted")) {
      throw conflict(
        "This evidence already posted a financial ledger charge. Use the refund or adjustment workflow.",
      );
    }
    if (
      reviewError.message.includes("manual_payment_amount_mismatch")
      || reviewError.message.includes("manual_payment_currency_mismatch")
      || reviewError.message.includes("manual_payment_quote_mismatch")
    ) {
      throw badRequest("Payment evidence does not match the locked registration quote");
    }
    if (reviewError.message.includes("capacity_reservation_expired")) {
      throw conflict("The reserved race place expired and capacity is no longer available");
    }
    throw reviewError;
  }

  return loadRegistrationPaymentEvidence(evidence.registration_id, env);
}

export async function createRegistration(
  session: RequestSession,
  input: CreateRegistrationInput,
  env: ServerEnv = loadServerEnv(),
) {
  const athleteProfileId = requireAthleteProfileId(session);
  await assertRaceProfileReady(athleteProfileId, env);
  const representedClubId = await resolveRepresentedClubId(athleteProfileId, input, env);
  const adminClient = createAdminSupabaseClient(env);
  await loadCategoryForPublicRegistration(adminClient, input.eventCategoryId);
  const normalizedRequest = {
    eventCategoryId: input.eventCategoryId,
    athleteProfileId,
    representedClubId,
    publicStartListOptIn: input.publicStartListOptIn ?? false,
    formVersionId: input.formVersionId,
    answers: input.answers,
    acceptedDocumentIds: [...input.acceptedDocumentIds].sort(),
  };
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const idempotencyRequestHash = sha256(JSON.stringify(normalizedRequest));

  const { data: created, error: createError } = await adminClient
    .rpc("service_create_registration_submission", {
      p_event_category_id: input.eventCategoryId,
      p_athlete_profile_id: athleteProfileId,
      p_represented_club_id: representedClubId,
      p_actor_user_id: session.account.userId,
      p_public_start_list_opt_in: normalizedRequest.publicStartListOptIn,
      p_idempotency_key_hash: idempotencyKeyHash,
      p_idempotency_request_hash: idempotencyRequestHash,
      p_form_version_id: input.formVersionId,
      p_answers: input.answers,
      p_accepted_document_ids: input.acceptedDocumentIds,
    })
    .single<AtomicRegistrationRow>();

  if (createError) throwAtomicRegistrationError(createError);
  if (!created) throw new Error("Registration transaction returned no record");

  const model = await getAthleteRegistrationsReadModel(session, env);
  const registration = [...model.upcoming, ...model.past].find((item) => item.id === created.registration_id);
  if (!registration) throw notFound("Created registration could not be loaded");
  return registration;
}

export async function createGuestRegistration(
  input: CreateGuestRegistrationInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await loadCategoryForPublicRegistration(adminClient, input.eventCategoryId);

  const firstName = cleanRequiredText(input.firstName, "First name");
  const lastName = cleanRequiredText(input.lastName, "Last name");
  const email = normalizeGuestEmail(input.email);
  const dateOfBirth = normalizeGuestDateOfBirth(input.dateOfBirth);
  const gender = normalizeGuestGender(input.gender);
  const phone = cleanRequiredText(input.phone, "Phone");
  const emergencyContactName = cleanRequiredText(input.emergencyContactName, "Emergency contact name");
  const emergencyContactPhone = cleanRequiredText(input.emergencyContactPhone, "Emergency contact phone");
  const city = cleanOptionalText(input.city);
  const countryCode = normalizeGuestCountryCode(input.countryCode);
  const shirtSize = cleanOptionalText(input.shirtSize)?.toUpperCase() ?? null;
  const displayName = `${firstName} ${lastName}`.trim();
  const normalizedRequest = {
    eventCategoryId: input.eventCategoryId,
    firstName,
    lastName,
    email,
    dateOfBirth,
    gender,
    city,
    countryCode,
    phone,
    emergencyContactName,
    emergencyContactPhone,
    shirtSize,
    publicStartListOptIn: input.publicStartListOptIn ?? false,
    formVersionId: input.formVersionId,
    answers: input.answers,
    acceptedDocumentIds: [...input.acceptedDocumentIds].sort(),
  };
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const idempotencyRequestHash = sha256(JSON.stringify(normalizedRequest));

  const { data: created, error: createError } = await adminClient
    .rpc("service_create_guest_registration_submission", {
      p_event_category_id: input.eventCategoryId,
      p_athlete_slug_base: slugify(displayName),
      p_first_name: firstName,
      p_last_name: lastName,
      p_display_name: displayName,
      p_email: email,
      p_date_of_birth: dateOfBirth,
      p_gender: gender,
      p_city: city,
      p_country_code: countryCode,
      p_phone: phone,
      p_emergency_contact_name: emergencyContactName,
      p_emergency_contact_phone: emergencyContactPhone,
      p_shirt_size: shirtSize,
      p_public_start_list_opt_in: normalizedRequest.publicStartListOptIn,
      p_idempotency_key_hash: idempotencyKeyHash,
      p_idempotency_request_hash: idempotencyRequestHash,
      p_form_version_id: input.formVersionId,
      p_answers: input.answers,
      p_accepted_document_ids: input.acceptedDocumentIds,
    })
    .single<AtomicGuestRegistrationRow>();

  if (createError) {
    if (createError.message.includes("guest_identity_exists")) {
      throw conflict(
        "This email already has a runner record. Create or sign in to your account to protect and reuse your saved details.",
      );
    }
    if (createError.message.includes("guest_registration_fields_required")) {
      throw badRequest("Complete all required guest athlete and emergency-contact fields");
    }
    throwAtomicRegistrationError(createError);
  }
  if (!created) throw new Error("Guest registration transaction returned no record");

  const guestAccessToken = createHmac("sha256", env.supabaseServiceRoleKey)
    .update(`guest-registration:${created.registration_id}:${idempotencyKeyHash}`)
    .digest("base64url");
  const { error: grantError } = await adminClient.rpc(
    "service_issue_guest_registration_access",
    {
      p_registration_id: created.registration_id,
      p_token_hash: sha256(guestAccessToken),
      p_guest_email: email,
    },
  );
  if (grantError) throw grantError;

  return {
    id: created.registration_id,
    status: created.registration_status,
    paymentStatus: created.payment_status,
    athleteProfileId: created.athlete_profile_id,
    guestAccessToken,
  };
}

export async function cancelRegistration(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const athleteProfileId = requireAthleteProfileId(session);
  const registration = await resolveRegistrationContext(registrationId, env);
  if (registration.athleteProfileId !== athleteProfileId) {
    throw forbidden("You can only cancel your own registrations");
  }

  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("start_at,event_editions(start_date,timezone)")
    .eq("id", registration.eventCategoryId)
    .maybeSingle<{
      start_at: string | null;
      event_editions:
        | { start_date: string; timezone: string | null }
        | Array<{ start_date: string; timezone: string | null }>;
    }>();
  if (categoryError) throw categoryError;
  if (!category) throw notFound("Registration category not found");

  const edition = Array.isArray(category.event_editions)
    ? category.event_editions[0]
    : category.event_editions;
  const categoryHasStarted = category.start_at
    ? new Date(category.start_at).getTime() <= Date.now()
    : edition
      ? new Intl.DateTimeFormat("en-CA", {
        timeZone: edition.timezone ?? "Europe/Zagreb",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()) >= edition.start_date
      : false;
  if (categoryHasStarted) {
    throw conflict("Online cancellation closes when the race starts. Contact the organizer for a status correction.");
  }

  const { error } = await adminClient.rpc("service_cancel_registration_atomically", {
    p_registration_id: registrationId,
    p_actor_user_id: session.account.userId,
    p_reason: "athlete_cancelled",
  });
  if (error) {
    if (error.message.includes("registration_not_found")) {
      throw notFound("Registration not found");
    }
    throw error;
  }

  return getAthleteRegistrationsReadModel(session, env);
}

export async function cancelOrganizerRegistration(
  session: RequestSession,
  registrationId: string,
  reason: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const context = await requireRegistrationAccess(
    session,
    registrationId,
    "entrants.manage",
    env,
  );
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw badRequest("A cancellation reason is required");
  }

  const { data, error } = await adminClient.rpc("service_cancel_registration_atomically", {
    p_registration_id: registrationId,
    p_actor_user_id: session.account.userId,
    p_reason: normalizedReason,
  });
  if (error) {
    if (error.message.includes("registration_not_found")) {
      throw notFound("Registration not found");
    }
    throw error;
  }

  return {
    cancellation: data as {
      registrationId: string;
      status: string;
      eventCategoryId?: string;
      paymentStatus?: string;
      refundRequired?: boolean;
      replayed?: boolean;
    },
    registrations: await loadRegistrationListForEdition(context.eventEditionId, env),
  };
}

export async function removeOrganizerRegistration(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const context = await requireRegistrationAccess(
    session,
    registrationId,
    "entrants.manage",
    env,
  );

  let cancellation: {
    registrationId: string;
    status: string;
    eventCategoryId?: string;
    paymentStatus?: string;
    refundRequired?: boolean;
    replayed?: boolean;
  } | null = null;

  if (!["cancelled", "expired", "transferred", "deferred"].includes(context.status)) {
    const { data, error: cancellationError } = await adminClient.rpc(
      "service_cancel_registration_atomically",
      {
        p_registration_id: registrationId,
        p_actor_user_id: session.account.userId,
        p_reason: "organizer_removed",
      },
    );
    if (cancellationError) {
      if (cancellationError.message.includes("registration_not_found")) {
        throw notFound("Registration not found");
      }
      throw cancellationError;
    }
    cancellation = data as typeof cancellation;
  }

  const { data: removed, error } = await adminClient
    .from("registrations")
    .update({
      organizer_removed_at: new Date().toISOString(),
      organizer_removed_by_user_id: session.account.userId,
    })
    .eq("id", registrationId)
    .is("organizer_removed_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) throw error;

  return {
    removed: true,
    replayed: !removed,
    registrationId,
    cancellation,
    registrations: await loadRegistrationListForEdition(context.eventEditionId, env),
  };
}

export async function removeAllOrganizerRegistrations(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "entrants.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "service_remove_all_event_registrations",
    {
      p_event_edition_id: eventEditionId,
      p_actor_user_id: session.account.userId,
    },
  );

  if (error) {
    if (error.message.includes("event_not_found")) {
      throw notFound("Race not found");
    }
    throw error;
  }

  const result = data as {
    eventEditionId: string;
    removedCount: number;
    cancelledCount: number;
  };

  return {
    ...result,
    registrations: await loadRegistrationListForEdition(eventEditionId, env),
  };
}

export const removeInactiveOrganizerRegistration = removeOrganizerRegistration;

export async function updateOrganizerRegistration(
  session: RequestSession,
  input: UpdateOrganizerRegistrationInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const context = await requireRegistrationAccess(
    session,
    input.registrationId,
    "entrants.manage",
    env,
  );

  if (input.bibNumber !== undefined) {
    await setRegistrationBibNumber(
      input.registrationId,
      context.eventEditionId,
      context.eventCategoryId,
      input.bibNumber,
      session.account.userId,
      env,
    );
  }

  const registrations = await loadRegistrationListForEdition(context.eventEditionId, env);
  const registration = registrations.find((item) => item.id === input.registrationId);
  if (!registration) throw notFound("Registration not found after update");
  return registration;
}

export async function checkInRegistration(
  session: RequestSession,
  registrationId: string,
  input: CheckInInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const context = await requireRegistrationAccess(
    session,
    registrationId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  if (context.status !== "confirmed") {
    throw conflict("Only confirmed runners can be checked in");
  }
  if (context.paymentStatus !== "paid" && context.paymentStatus !== "not_required") {
    throw conflict("Payment must be settled before check-in");
  }
  const { data: activeBib, error: activeBibError } = await adminClient
    .from("bib_assignments")
    .select("id")
    .eq("registration_id", registrationId)
    .is("revoked_at", null)
    .maybeSingle<{ id: string }>();

  if (activeBibError) throw activeBibError;
  if (!activeBib) {
    throw conflict("Assign a bib at pickup before check-in");
  }

  const { data: existing, error: existingError } = await adminClient
    .from("checkins")
    .select("id,checked_in_at")
    .eq("registration_id", registrationId)
    .maybeSingle<{ id: string; checked_in_at: string }>();

  if (existingError) throw existingError;
  if (!existing) {
    const { error } = await adminClient.from("checkins").insert({
      registration_id: registrationId,
      checked_in_by_user_id: session.account.userId,
      location_label: input.locationLabel ?? null,
      notes: input.notes ?? null,
    });

    if (error) throw error;
  }

  if (context.participationStatus === "not_started") {
    const { error } = await adminClient
      .from("registrations")
      .update({ participation_status: "checked_in" })
      .eq("id", registrationId);
    if (error) throw error;
  }

  const registrations = await loadRegistrationListForEdition(context.eventEditionId, env);
  const registration = registrations.find((item) => item.id === registrationId);
  if (!registration) throw notFound("Registration not found after check-in");
  return registration;
}

export async function undoRegistrationCheckIn(
  session: RequestSession,
  registrationId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const context = await requireRegistrationAccess(
    session,
    registrationId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.rpc("service_undo_registration_check_in", {
    p_registration_id: registrationId,
    p_actor_user_id: session.account.userId,
  });

  if (error) {
    if (error.message.includes("registration_not_found")) {
      throw notFound("Registration not found");
    }
    if (error.message.includes("registration_check_in_not_found")) {
      throw conflict("The runner does not have an active check-in to undo");
    }
    if (error.message.includes("registration_check_in_cannot_be_undone")) {
      throw conflict("Check-in can only be undone before the runner starts");
    }
    throw error;
  }

  const registrations = await loadRegistrationListForEdition(context.eventEditionId, env);
  const registration = registrations.find((item) => item.id === registrationId);
  if (!registration) throw notFound("Registration not found after undoing check-in");
  return registration;
}

export async function getRaceDayState(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<RaceDayState> {
  const adminClient = createAdminSupabaseClient(env);
  const editionContext = await requireEditionAccess(
    session,
    eventEditionId,
    [
      "entrants.manage",
      "race_day.manage",
      "checkpoint_timing.enter",
      "results.manage",
    ],
    env,
  );

  const [{ data: edition, error: editionError }, { data: categories, error: categoryError }, { data: sessions, error: sessionError }] =
    await Promise.all([
      adminClient
        .from("event_editions")
        .select("id,slug,name,start_date,location_name,status,is_practice")
        .eq("id", eventEditionId)
        .maybeSingle<{
          id: string;
          slug: string;
          name: string;
          start_date: string;
          location_name: string | null;
          status: string;
          is_practice: boolean;
        }>(),
      adminClient
        .from("event_categories")
        .select("id,name,status,results_mode,course_format,lap_count,distance_km,sport_code")
        .eq("event_edition_id", eventEditionId)
        .order("distance_km", { ascending: false })
        .returns<Array<{
          id: string;
          name: string;
          status: string;
          results_mode: string;
          course_format: string;
          lap_count: number;
          distance_km: number | null;
          sport_code: string;
        }>>(),
      adminClient
        .from("timing_sessions")
        .select("id,event_category_id,checkpoint_id,mode,status,started_at,closed_at")
        .eq("event_edition_id", eventEditionId)
        .order("started_at", { ascending: false })
        .returns<Array<{
          id: string;
          event_category_id: string | null;
          checkpoint_id: string | null;
          mode: string;
          status: string;
          started_at: string;
          closed_at: string | null;
        }>>(),
    ]);

  if (editionError) throw editionError;
  if (categoryError) throw categoryError;
  if (sessionError) throw sessionError;
  if (!edition) throw notFound("Edition not found");

  const raceCategories = (categories ?? []).filter((category) => mapCategoryType(category.results_mode) === "competitive");
  const categoryIds = raceCategories.map((category) => category.id);
  const [
    checkpoints,
    registrations,
    bibAssignments,
    checkins,
    publications,
    recentPunchRows,
    unresolvedPunchRows,
    startEvents,
  ] = await Promise.all([
    loadCheckpointsByCategoryIds(categoryIds, env),
    categoryIds.length
      ? adminClient
          .from("registrations")
          .select("id,event_category_id,athlete_profile_id,status,participation_status")
          .in("event_category_id", categoryIds)
          .returns<Array<{
            id: string;
            event_category_id: string;
            athlete_profile_id: string;
            status: string;
            participation_status: string;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          id: string;
          event_category_id: string;
          athlete_profile_id: string;
          status: string;
          participation_status: string;
        }>),
    categoryIds.length
      ? adminClient
          .from("bib_assignments")
          .select("registration_id,bib_number")
          .eq("event_edition_id", eventEditionId)
          .is("revoked_at", null)
          .returns<Array<{
            registration_id: string;
            bib_number: string;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          registration_id: string;
          bib_number: string;
        }>),
    adminClient
      .from("checkins")
      .select("registration_id")
      .returns<Array<{ registration_id: string }>>()
      .then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      }),
    categoryIds.length
      ? adminClient
          .from("result_publications")
          .select("event_category_id,publication_state,published_at")
          .in("event_category_id", categoryIds)
          .order("published_at", { ascending: false })
          .returns<Array<{ event_category_id: string; publication_state: string; published_at: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{ event_category_id: string; publication_state: string; published_at: string }>),
    categoryIds.length
      ? adminClient
          .from("punch_events")
          .select("id,event_category_id,checkpoint_id,registration_id,bib_number,effective_recorded_at")
          .in("event_category_id", categoryIds)
          .eq("is_voided", false)
          .order("effective_recorded_at", { ascending: false })
          .limit(25)
          .returns<Array<{
            id: string;
            event_category_id: string;
            checkpoint_id: string;
            registration_id: string | null;
            bib_number: string | null;
            effective_recorded_at: string;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          id: string;
          event_category_id: string;
          checkpoint_id: string;
          registration_id: string | null;
          bib_number: string | null;
          effective_recorded_at: string;
        }>),
    categoryIds.length
      ? adminClient
          .from("punch_events")
          .select("id,event_category_id,checkpoint_id,registration_id,bib_number,effective_recorded_at")
          .in("event_category_id", categoryIds)
          .eq("is_voided", false)
          .is("registration_id", null)
          .order("effective_recorded_at", { ascending: false })
          .returns<Array<{
            id: string;
            event_category_id: string;
            checkpoint_id: string;
            registration_id: null;
            bib_number: string | null;
            effective_recorded_at: string;
          }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<{
          id: string;
          event_category_id: string;
          checkpoint_id: string;
          registration_id: null;
          bib_number: string | null;
          effective_recorded_at: string;
        }>),
    categoryIds.length
      ? adminClient
          .from("race_start_events")
          .select("id,event_category_id,event_type,occurred_at,start_method,sequence_number")
          .in("event_category_id", categoryIds)
          .in("event_type", ["actual_start", "restart"])
          .order("sequence_number", { ascending: false })
          .returns<Array<ResultInputStartEvent & { event_category_id: string }>>()
          .then(({ data, error }) => {
            if (error) throw error;
            return data ?? [];
          })
      : Promise.resolve([] as Array<ResultInputStartEvent & { event_category_id: string }>),
  ]);
  const timingCheckpoints = checkpoints.filter((checkpoint) => checkpoint.is_mandatory);
  const timingCheckpointIds = new Set(timingCheckpoints.map((checkpoint) => checkpoint.id));

  const athleteIds = Array.from(new Set(registrations.map((row) => row.athlete_profile_id)));
  const { data: athleteRows, error: athleteError } = athleteIds.length
      ? await adminClient
          .from("athlete_profiles")
          .select("id,first_name,last_name,display_name")
          .in("id", athleteIds)
          .returns<Array<{
            id: string;
            first_name: string;
            last_name: string;
            display_name: string;
          }>>()
      : {
          data: [] as Array<{
            id: string;
            first_name: string;
            last_name: string;
            display_name: string;
          }>,
          error: null,
        };

  if (athleteError) throw athleteError;
  const athleteProfileById = new Map((athleteRows ?? []).map((row) => [row.id, row]));
  const athleteByRegistrationId = new Map(
    registrations.map((registration) => [
      registration.id,
      athleteProfileById.get(registration.athlete_profile_id)?.display_name ?? "Unknown athlete",
    ]),
  );
  const bibByRegistrationId = new Map(
    bibAssignments.map((assignment) => [assignment.registration_id, assignment.bib_number]),
  );

  const checkpointById = new Map(timingCheckpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const categoryById = new Map(raceCategories.map((category) => [category.id, category]));
  const publicationByCategory = new Map<string, string>();
  for (const publication of publications) {
    if (!publicationByCategory.has(publication.event_category_id)) {
      publicationByCategory.set(publication.event_category_id, publication.publication_state);
    }
  }

  const registrationCountByCategory = new Map<string, number>();
  const checkedInCountByCategory = new Map<string, number>();
  const registrationCategoryById = new Map(
    registrations
      .filter((registration) => REGISTERED_RACE_STATUSES.includes(registration.status as (typeof REGISTERED_RACE_STATUSES)[number]))
      .map((registration) => [registration.id, registration.event_category_id]),
  );
  for (const registration of registrations) {
    if (!REGISTERED_RACE_STATUSES.includes(registration.status as (typeof REGISTERED_RACE_STATUSES)[number])) {
      continue;
    }
    registrationCountByCategory.set(
      registration.event_category_id,
      (registrationCountByCategory.get(registration.event_category_id) ?? 0) + 1,
    );
  }
  for (const checkin of checkins) {
    const categoryId = registrationCategoryById.get(checkin.registration_id);
    if (!categoryId) continue;
    checkedInCountByCategory.set(categoryId, (checkedInCountByCategory.get(categoryId) ?? 0) + 1);
  }
  const operationalRegistrationIds = selectOperationalRaceDayRegistrationIds(
    registrations,
    new Set(checkins.map((checkin) => checkin.registration_id)),
  );
  const operationalRunnerCountByCategory = new Map<string, number>();
  for (const registration of registrations) {
    if (!operationalRegistrationIds.has(registration.id)) continue;
    operationalRunnerCountByCategory.set(
      registration.event_category_id,
      (operationalRunnerCountByCategory.get(registration.event_category_id) ?? 0) + 1,
    );
  }

  const punchCountBySession = new Map<string, number>();
  const passCountsByRegistrationCheckpoint = new Map<string, number>();
  const checkpointPassesByRegistration = new Map<string, Array<{
    checkpointId: string;
    recordedAt: string;
  }>>();
  const passageDetailsByPunchId = new Map<string, {
    passNumber: number;
    expectedPassCount: number;
    completesRace: boolean;
  }>();
  let sessionPunches: Array<{
    id: string;
    timing_session_id: string;
    event_category_id: string;
    checkpoint_id: string;
    registration_id: string | null;
    effective_recorded_at: string;
  }> = [];
  if (sessions?.length) {
    const { data, error } = await adminClient
      .from("punch_events")
      .select("id,timing_session_id,event_category_id,checkpoint_id,registration_id,effective_recorded_at")
      .in("timing_session_id", sessions.map((sessionRow) => sessionRow.id))
      .eq("is_voided", false)
      .returns<Array<{
        id: string;
        timing_session_id: string;
        event_category_id: string;
        checkpoint_id: string;
        registration_id: string | null;
        effective_recorded_at: string;
      }>>();
    if (error) throw error;
    sessionPunches = (data ?? []).filter((punch) => timingCheckpointIds.has(punch.checkpoint_id));
    for (const punch of sessionPunches) {
      punchCountBySession.set(punch.timing_session_id, (punchCountBySession.get(punch.timing_session_id) ?? 0) + 1);
      if (punch.registration_id) {
        const passCountKey = `${punch.registration_id}:${punch.checkpoint_id}`;
        passCountsByRegistrationCheckpoint.set(
          passCountKey,
          (passCountsByRegistrationCheckpoint.get(passCountKey) ?? 0) + 1,
        );
        const passes = checkpointPassesByRegistration.get(punch.registration_id) ?? [];
        passes.push({
          checkpointId: punch.checkpoint_id,
          recordedAt: punch.effective_recorded_at,
        });
        checkpointPassesByRegistration.set(punch.registration_id, passes);
      }
    }
    const priorPassCountByRegistrationCheckpoint = new Map<string, number>();
    for (const punch of [...sessionPunches].sort(
      (left, right) => left.effective_recorded_at.localeCompare(right.effective_recorded_at)
        || left.id.localeCompare(right.id),
    )) {
      if (!punch.registration_id) continue;
      const key = `${punch.registration_id}:${punch.checkpoint_id}`;
      const passNumber = (priorPassCountByRegistrationCheckpoint.get(key) ?? 0) + 1;
      priorPassCountByRegistrationCheckpoint.set(key, passNumber);
      const checkpoint = checkpointById.get(punch.checkpoint_id);
      const category = categoryById.get(punch.event_category_id);
      const courseFormat = normalizeCourseFormat(category?.course_format);
      const expectedPassCount = expectedCheckpointPasses(
        courseFormat,
        normalizeLapCount(courseFormat, category?.lap_count),
        checkpoint?.checkpoint_type ?? "timing",
      );
      passageDetailsByPunchId.set(punch.id, {
        passNumber,
        expectedPassCount,
        completesRace:
          checkpoint?.checkpoint_type === "finish"
          && passNumber === expectedPassCount,
      });
    }
  }

  const activeSessionByCategory = new Map<string, string>();
  for (const sessionRow of sessions ?? []) {
    if (
      sessionRow.event_category_id
      && sessionRow.status === "active"
      && (!sessionRow.checkpoint_id || timingCheckpointIds.has(sessionRow.checkpoint_id))
      && !activeSessionByCategory.has(sessionRow.event_category_id)
    ) {
      activeSessionByCategory.set(sessionRow.event_category_id, sessionRow.id);
    }
  }

  const startEventByCategory = new Map<string, ResultInputStartEvent>();
  for (const startEvent of startEvents) {
    if (!startEventByCategory.has(startEvent.event_category_id)) {
      startEventByCategory.set(startEvent.event_category_id, startEvent);
    }
  }

  const mapPunchRow = (punch: {
    id: string;
    event_category_id: string;
    checkpoint_id: string;
    registration_id: string | null;
    bib_number: string | null;
    effective_recorded_at: string;
  }): RaceDayPunchRecord => {
    const passageDetails = passageDetailsByPunchId.get(punch.id);
    return ({
    id: punch.id,
    eventCategoryId: punch.event_category_id,
    checkpointId: punch.checkpoint_id,
    registrationId: punch.registration_id,
    bibNumber: punch.bib_number,
    athleteName: punch.registration_id ? athleteByRegistrationId.get(punch.registration_id) ?? null : null,
    categoryName: categoryById.get(punch.event_category_id)?.name ?? null,
    checkpointName: checkpointById.get(punch.checkpoint_id)?.name ?? "Checkpoint",
    recordedAt: punch.effective_recorded_at,
    passNumber: passageDetails?.passNumber ?? null,
    expectedPassCount: passageDetails?.expectedPassCount ?? 1,
    completesRace: passageDetails?.completesRace ?? false,
    warnings: punch.registration_id
      ? []
      : [
          {
            code: "unresolved_bib" as const,
            message: "Bib could not be resolved to a registration",
          },
        ],
    });
  };
  const recentPunches = recentPunchRows
    .filter((punch) => timingCheckpointIds.has(punch.checkpoint_id))
    .map(mapPunchRow);
  const unresolvedPunches = unresolvedPunchRows
    .filter((punch) => timingCheckpointIds.has(punch.checkpoint_id))
    .map(mapPunchRow);

  const canManageRaceDay = hasEventPermission(
    session,
    eventEditionId,
    editionContext.organizationId,
    "race_day.manage",
  );
  const readAssignments = session.account.eventAccess.filter(
    (assignment) =>
      assignment.organizationId === editionContext.organizationId
      && assignment.eventEditionId === eventEditionId
      && (
        assignment.permissions.includes("entrants.manage")
        || assignment.permissions.includes("results.manage")
      ),
  );
  const timerAssignments = session.account.eventAccess.filter(
    (assignment) =>
      assignment.organizationId === editionContext.organizationId
      && assignment.eventEditionId === eventEditionId
      && assignment.permissions.includes("checkpoint_timing.enter"),
  );
  const timerCanSeeEveryCategory = timerAssignments.some(
    (assignment) =>
      assignment.eventCategoryId === null
      && assignment.checkpointId === null,
  );
  const readAccessCanSeeEveryCategory = hasOrganizationPermission(
    session,
    editionContext.organizationId,
    ["entrants.manage", "results.manage"],
  ) || readAssignments.some((assignment) => assignment.eventCategoryId === null);
  const visibleCategoryIds = canManageRaceDay
    || timerCanSeeEveryCategory
    || readAccessCanSeeEveryCategory
    ? new Set(categoryIds)
    : new Set(
        [...timerAssignments, ...readAssignments].flatMap((assignment) => {
          if (assignment.eventCategoryId) return [assignment.eventCategoryId];
          if (!assignment.checkpointId) return [];
          return timingCheckpoints
            .filter((checkpoint) => checkpoint.id === assignment.checkpointId)
            .map((checkpoint) => checkpoint.event_category_id);
        }),
      );
  const expectedAthletes = registrations
    .filter((registration) => {
      if (!visibleCategoryIds.has(registration.event_category_id)) return false;
      return operationalRegistrationIds.has(registration.id);
    })
    .map((registration) => {
      const athlete = athleteProfileById.get(registration.athlete_profile_id);
      return {
        registrationId: registration.id,
        eventCategoryId: registration.event_category_id,
        firstName: athlete?.first_name ?? "",
        lastName: athlete?.last_name ?? "",
        displayName: athlete?.display_name ?? "Unknown athlete",
        bibNumber: bibByRegistrationId.get(registration.id) ?? null,
        participationStatus: registration.participation_status,
        checkpointPasses: [...(checkpointPassesByRegistration.get(registration.id) ?? [])]
          .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)),
      };
    })
    .sort((left, right) =>
      left.lastName.localeCompare(right.lastName)
      || left.firstName.localeCompare(right.firstName)
      || (left.bibNumber ?? "").localeCompare(right.bibNumber ?? "", undefined, { numeric: true }),
    );

  return {
    edition: {
      id: edition.id,
      slug: edition.slug,
      name: edition.name,
      startDate: edition.start_date,
      locationName: edition.location_name,
      status: edition.status,
      isPractice: edition.is_practice,
    },
    categories: raceCategories.map((category) => {
      const startEvent = startEventByCategory.get(category.id) ?? null;
      const courseFormat = normalizeCourseFormat(category.course_format);
      const lapCount = normalizeLapCount(courseFormat, category.lap_count);
      return {
      id: category.id,
      name: category.name,
      status: category.status,
      courseFormat,
      lapCount,
      registrationCount: registrationCountByCategory.get(category.id) ?? 0,
      checkedInCount: checkedInCountByCategory.get(category.id) ?? 0,
      activeSessionId: activeSessionByCategory.get(category.id) ?? null,
      latestPublicationState: publicationByCategory.get(category.id) ?? null,
      effectiveStartAt: startEvent?.occurred_at ?? null,
      resultInputVersion: startEvent
        ? buildCategoryResultInputDigest({
            categoryId: category.id,
            categoryDistanceKm: category.distance_km == null ? null : Number(category.distance_km),
            courseFormat,
            lapCount,
            sportCode: category.sport_code,
            startEvent,
            checkpoints: timingCheckpoints.filter((checkpoint) => checkpoint.event_category_id === category.id),
            registrations: registrations.filter(
              (registration) => registration.event_category_id === category.id && registration.status === "confirmed",
            ),
            punches: sessionPunches.filter((punch) => punch.event_category_id === category.id),
          })
        : null,
      checkpoints: timingCheckpoints
        .filter((checkpoint) => checkpoint.event_category_id === category.id)
        .map((checkpoint) => {
          const expectedPassesPerAthlete = expectedCheckpointPasses(
            courseFormat,
            lapCount,
            checkpoint.checkpoint_type,
          );
          const expectedRunnerCount = operationalRunnerCountByCategory.get(category.id) ?? 0;
          const passedCount = registrations
            .filter(
              (registration) => registration.event_category_id === category.id
                && operationalRegistrationIds.has(registration.id),
            )
            .reduce(
              (total, registration) => total + Math.min(
                passCountsByRegistrationCheckpoint.get(`${registration.id}:${checkpoint.id}`) ?? 0,
                expectedPassesPerAthlete,
              ),
              0,
            );
          return {
            id: checkpoint.id,
            code: checkpoint.code,
            name: checkpoint.name,
            checkpointType: checkpoint.checkpoint_type,
            sequenceNumber: checkpoint.sequence_number,
            expectedPassesPerAthlete,
            expectedCount: expectedRunnerCount * expectedPassesPerAthlete,
            passedCount,
          };
        }),
      };
    }),
    sessions: (sessions ?? []).filter(
      (sessionRow) => !sessionRow.checkpoint_id || timingCheckpointIds.has(sessionRow.checkpoint_id),
    ).map((sessionRow) => ({
      id: sessionRow.id,
      eventCategoryId: sessionRow.event_category_id,
      categoryName: sessionRow.event_category_id ? categoryById.get(sessionRow.event_category_id)?.name ?? null : null,
      checkpointId: sessionRow.checkpoint_id,
      checkpointName: sessionRow.checkpoint_id ? checkpointById.get(sessionRow.checkpoint_id)?.name ?? null : null,
      mode: sessionRow.mode,
      status: sessionRow.status,
      startedAt: sessionRow.started_at,
      closedAt: sessionRow.closed_at,
      punchCount: punchCountBySession.get(sessionRow.id) ?? 0,
    })),
    expectedAthletes,
    recentPunches,
    unresolvedPunches,
  };
}

export async function getTimingSessionDetail(
  session: RequestSession,
  timingSessionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<TimingSessionDetail> {
  const adminClient = createAdminSupabaseClient(env);
  const context = await requireTimingSessionAccess(
    session,
    timingSessionId,
    ["race_day.manage", "checkpoint_timing.enter"],
    env,
  );

  const { data: sessionRow, error: sessionError } = await adminClient
    .from("timing_sessions")
    .select("id,event_category_id,checkpoint_id,mode,status,started_at,closed_at")
    .eq("id", timingSessionId)
    .maybeSingle<{
      id: string;
      event_category_id: string | null;
      checkpoint_id: string | null;
      mode: string;
      status: string;
      started_at: string;
      closed_at: string | null;
    }>();

  if (sessionError) throw sessionError;
  if (!sessionRow) throw notFound("Timing session not found");

  const raceDayState = await getRaceDayState(session, context.eventEditionId, env);
  const sessionState = raceDayState.sessions.find((item) => item.id === timingSessionId);
  if (!sessionState) throw notFound("Timing session not found");

  const { data: punches, error: punchError } = await adminClient
    .from("punch_events")
    .select("id,event_category_id,checkpoint_id,registration_id,bib_number,effective_recorded_at")
    .eq("timing_session_id", timingSessionId)
    .eq("is_voided", false)
    .order("effective_recorded_at", { ascending: false })
    .limit(25)
    .returns<Array<{
      id: string;
      event_category_id: string;
      checkpoint_id: string;
      registration_id: string | null;
      bib_number: string | null;
      effective_recorded_at: string;
    }>>();

  if (punchError) throw punchError;

  const registrationIds = Array.from(new Set((punches ?? []).map((punch) => punch.registration_id).filter((value): value is string => Boolean(value))));
  const athleteByRegistrationId = new Map<string, string>();
  if (registrationIds.length) {
    const { data: registrationRows, error } = await adminClient
      .from("registrations")
      .select("id,athlete_profile_id")
      .in("id", registrationIds)
      .returns<Array<{ id: string; athlete_profile_id: string }>>();
    if (error) throw error;
    const athleteIds = Array.from(new Set((registrationRows ?? []).map((row) => row.athlete_profile_id)));
    const { data: athleteRows, error: athleteError } = athleteIds.length
      ? await adminClient
          .from("athlete_profiles")
          .select("id,display_name")
          .in("id", athleteIds)
          .returns<Array<{ id: string; display_name: string }>>()
      : { data: [] as Array<{ id: string; display_name: string }>, error: null };
    if (athleteError) throw athleteError;
    const athleteNameById = new Map((athleteRows ?? []).map((row) => [row.id, row.display_name]));
    for (const registration of registrationRows ?? []) {
      athleteByRegistrationId.set(registration.id, athleteNameById.get(registration.athlete_profile_id) ?? "Unknown athlete");
    }
  }

  const checkpointById = new Map(raceDayState.categories.flatMap((category) => category.checkpoints).map((checkpoint) => [checkpoint.id, checkpoint]));

  return {
    session: sessionState,
    punches: (punches ?? []).map((punch) => ({
      id: punch.id,
      eventCategoryId: punch.event_category_id,
      checkpointId: punch.checkpoint_id,
      registrationId: punch.registration_id,
      bibNumber: punch.bib_number,
      athleteName: punch.registration_id ? athleteByRegistrationId.get(punch.registration_id) ?? null : null,
      categoryName: punch.event_category_id
        ? raceDayState.categories.find((category) => category.id === punch.event_category_id)?.name ?? null
        : null,
      checkpointName: checkpointById.get(punch.checkpoint_id)?.name ?? "Checkpoint",
      recordedAt: punch.effective_recorded_at,
      warnings: punch.registration_id
        ? []
        : [
            {
              code: "unresolved_bib" as const,
              message: "Bib could not be resolved to a registration",
            },
          ],
    })),
  };
}

async function ensureTimingSessionId(
  session: RequestSession,
  input: CreateTimingSessionInput,
  categoryId: string,
  env: ServerEnv,
) {
  await requireLiveRaceOperations(input.eventEditionId, categoryId, env);
  const adminClient = createAdminSupabaseClient(env);
  let existingSessionQuery = adminClient
    .from("timing_sessions")
    .select("id")
    .eq("event_edition_id", input.eventEditionId)
    .eq("event_category_id", categoryId)
    .neq("status", "closed");

  existingSessionQuery = input.checkpointId
    ? existingSessionQuery.eq("checkpoint_id", input.checkpointId)
    : existingSessionQuery.is("checkpoint_id", null);

  const { data: existing, error: existingError } = await existingSessionQuery
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingError) throw existingError;
  if (existing) {
    return existing.id;
  }

  const { data: created, error: createError } = await adminClient
    .from("timing_sessions")
    .insert({
      event_edition_id: input.eventEditionId,
      event_category_id: categoryId,
      checkpoint_id: input.checkpointId ?? null,
      started_by_user_id: session.account.userId,
      mode: input.mode ?? "online",
      status: "active",
    })
    .select("id")
    .single<{ id: string }>();

  if (createError?.message.includes("race_live_operations_closed")) {
    throw conflict("This race has finished or been closed. Use results review for corrections.");
  }
  if (createError?.message.includes("race_live_operations_busy")) {
    throw conflict("The race state is changing. Refresh before trying again.");
  }
  if (createError) throw createError;
  return created.id;
}

export async function createTimingSession(
  session: RequestSession,
  input: CreateTimingSessionInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireEditionAccess(
    session,
    input.eventEditionId,
    ["race_day.manage", "checkpoint_timing.enter"],
    env,
  );

  if (!input.eventCategoryId && !input.checkpointId) {
    throw badRequest("Timing session requires a category or checkpoint");
  }

  let checkpointCategoryId: string | null = input.eventCategoryId ?? null;
  if (input.checkpointId) {
    const { data: checkpoint, error: checkpointError } = await adminClient
      .from("checkpoints")
      .select("id,event_category_id,is_mandatory")
      .eq("id", input.checkpointId)
      .maybeSingle<{ id: string; event_category_id: string; is_mandatory: boolean }>();

    if (checkpointError) throw checkpointError;
    if (!checkpoint) throw notFound("Checkpoint not found");
    if (!checkpoint.is_mandatory) {
      throw conflict("Informative race points do not accept timing entries");
    }
    checkpointCategoryId = checkpoint.event_category_id;
  }

  if (input.eventCategoryId && checkpointCategoryId && input.eventCategoryId !== checkpointCategoryId) {
    throw conflict("Checkpoint does not belong to the selected category");
  }

  const categoryId = checkpointCategoryId ?? input.eventCategoryId ?? null;
  if (!categoryId) throw badRequest("Unable to resolve session category");
  const categoryContext = input.checkpointId
    ? await requireCheckpointAccess(
        session,
        input.checkpointId,
        ["race_day.manage", "checkpoint_timing.enter"],
        env,
      )
    : await requireCategoryAccess(
        session,
        categoryId,
        "race_day.manage",
        env,
      );
  if (categoryContext.eventEditionId !== input.eventEditionId) {
    throw conflict("Category does not belong to the selected edition");
  }

  const timingSessionId = await ensureTimingSessionId(
    session,
    input,
    categoryId,
    env,
  );
  return getTimingSessionDetail(session, timingSessionId, env);
}

export async function closeTimingSession(
  session: RequestSession,
  timingSessionId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const context = await requireTimingSessionAccess(
    session,
    timingSessionId,
    ["race_day.manage", "checkpoint_timing.enter"],
    env,
  );
  if (context.status !== "closed") {
    const { error } = await adminClient
      .from("timing_sessions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
      })
      .eq("id", timingSessionId);
    if (error) throw error;
  }
  return getTimingSessionDetail(session, timingSessionId, env);
}

export async function recordSharedPunch(
  session: RequestSession,
  input: RecordSharedPunchInput,
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(
    session,
    input.eventEditionId,
    ["race_day.manage", "checkpoint_timing.enter"],
    env,
  );
  const checkpointIds = Array.from(new Set(input.checkpointIds));
  if (!checkpointIds.length) {
    throw badRequest("Choose a timing point");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: checkpointRows, error: checkpointError } = await adminClient
    .from("checkpoints")
    .select("id,event_category_id,is_mandatory")
    .in("id", checkpointIds)
    .returns<Array<{ id: string; event_category_id: string; is_mandatory: boolean }>>();
  if (checkpointError) throw checkpointError;
  if ((checkpointRows ?? []).length !== checkpointIds.length) {
    throw conflict("Every shared timing point must exist");
  }
  if ((checkpointRows ?? []).some((checkpoint) => !checkpoint.is_mandatory)) {
    throw conflict("Informative race points do not accept timing entries");
  }

  const checkpointById = new Map(
    (checkpointRows ?? []).map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const orderedCheckpoints = checkpointIds
    .map((checkpointId) => checkpointById.get(checkpointId))
    .filter(
      (checkpoint): checkpoint is { id: string; event_category_id: string; is_mandatory: boolean } =>
        Boolean(checkpoint),
    );
  const categoryIds = Array.from(
    new Set(orderedCheckpoints.map((checkpoint) => checkpoint.event_category_id)),
  );
  const { data: categories, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,status")
    .eq("event_edition_id", input.eventEditionId)
    .in("id", categoryIds)
    .returns<Array<{ id: string; status: string }>>();
  if (categoryError) throw categoryError;
  if ((categories ?? []).length !== categoryIds.length) {
    throw conflict("Every shared timing point must belong to this race");
  }
  const categoryStatusById = new Map(
    (categories ?? []).map((category) => [category.id, category.status]),
  );

  const bibNumber = input.bibNumber.trim();
  if (!bibNumber) throw badRequest("Enter a bib number");
  const { data: assignment, error: assignmentError } = await adminClient
    .from("bib_assignments")
    .select("registration_id,event_category_id")
    .eq("event_edition_id", input.eventEditionId)
    .eq("bib_number", bibNumber)
    .is("revoked_at", null)
    .maybeSingle<{ registration_id: string; event_category_id: string }>();
  if (assignmentError) throw assignmentError;

  const checkpoint = assignment
    ? orderedCheckpoints.find(
        (candidate) => candidate.event_category_id === assignment.event_category_id,
      )
    : orderedCheckpoints.find(
        (candidate) => categoryStatusById.get(candidate.event_category_id) === "in_progress",
      ) ?? orderedCheckpoints[0];
  if (!checkpoint) {
    throw conflict("This bib belongs to a race that does not use the selected timing point");
  }
  if (categoryStatusById.get(checkpoint.event_category_id) !== "in_progress") {
    throw conflict("This runner's race is not currently live");
  }

  await requireCheckpointAccess(
    session,
    checkpoint.id,
    ["race_day.manage", "checkpoint_timing.enter"],
    env,
  );
  const timingSessionId = await ensureTimingSessionId(
    session,
    {
      eventEditionId: input.eventEditionId,
      eventCategoryId: checkpoint.event_category_id,
      checkpointId: checkpoint.id,
      mode: "online",
    },
    checkpoint.event_category_id,
    env,
  );

  return recordPunch(
    session,
    {
      timingSessionId,
      checkpointId: checkpoint.id,
      clientEventId: input.clientEventId,
      recordedAt: input.recordedAt,
      bibNumber,
    },
    env,
  );
}

export async function recordPunch(
  session: RequestSession,
  input: RecordPunchInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const timingContext = await requireTimingSessionAccess(
    session,
    input.timingSessionId,
    ["race_day.manage", "checkpoint_timing.enter"],
    env,
  );
  if (timingContext.status === "closed") {
    throw conflict("Timing session is closed");
  }

  if (!input.registrationId && !input.bibNumber?.trim()) {
    throw badRequest("Provide either a registration or a bib number");
  }

  const { data: existingPunch, error: existingError } = await adminClient
    .from("punch_events")
    .select("id")
    .eq("client_event_id", input.clientEventId)
    .maybeSingle<{ id: string }>();

  if (existingError) throw existingError;
  if (existingPunch) {
    const detail = await getTimingSessionDetail(session, input.timingSessionId, env);
    const punch = detail.punches.find((item) => item.id === existingPunch.id) ?? null;
    return {
      punch,
      warnings: punch?.warnings ?? [],
      idempotent: true,
      passNumber: null,
      expectedPassCount: 1,
      completesRace: false,
    };
  }

  const [{ data: checkpoint, error: checkpointError }, registrationContext] = await Promise.all([
    adminClient
      .from("checkpoints")
      .select("id,event_category_id,name,checkpoint_type,sequence_number,cutoff_at,is_mandatory")
      .eq("id", input.checkpointId)
      .maybeSingle<{
        id: string;
        event_category_id: string;
        name: string;
        checkpoint_type: string;
        sequence_number: number;
        cutoff_at: string | null;
        is_mandatory: boolean;
      }>(),
    input.registrationId
      ? requireRegistrationAccess(
          session,
          input.registrationId,
          "race_day.manage",
          env,
        )
      : Promise.resolve(null),
  ]);

  if (checkpointError) throw checkpointError;
  if (!checkpoint) throw notFound("Checkpoint not found");
  if (!checkpoint.is_mandatory) {
    throw conflict("Informative race points do not accept timing entries");
  }
  if (
    timingContext.checkpointId
    && timingContext.checkpointId !== input.checkpointId
  ) {
    throw conflict("Punch checkpoint does not match this timing session");
  }

  const resolvedCategoryId = timingContext.eventCategoryId ?? checkpoint.event_category_id;
  if (resolvedCategoryId !== checkpoint.event_category_id) {
    throw conflict("Checkpoint does not belong to this timing session");
  }
  await requireLiveRaceOperations(timingContext.eventEditionId, resolvedCategoryId, env);

  let resolvedRegistrationId = input.registrationId ?? null;
  let athleteProfileId = registrationContext?.athleteProfileId ?? null;
  let resolvedBibNumber = input.bibNumber?.trim() ?? null;

  if (!resolvedRegistrationId && resolvedBibNumber) {
    const { data: assignment, error: assignmentError } = await adminClient
      .from("bib_assignments")
      .select("registration_id,event_category_id")
      .eq("event_edition_id", timingContext.eventEditionId)
      .eq("bib_number", resolvedBibNumber)
      .is("revoked_at", null)
      .maybeSingle<{ registration_id: string; event_category_id: string }>();

    if (assignmentError) throw assignmentError;
    if (assignment && assignment.event_category_id === resolvedCategoryId) {
      resolvedRegistrationId = assignment.registration_id;
      const { data: registration, error: registrationError } = await adminClient
        .from("registrations")
        .select("athlete_profile_id")
        .eq("id", assignment.registration_id)
        .maybeSingle<{ athlete_profile_id: string }>();
      if (registrationError) throw registrationError;
      athleteProfileId = registration?.athlete_profile_id ?? null;
    }
  }

  if (registrationContext && registrationContext.eventCategoryId !== resolvedCategoryId) {
    throw conflict("Registration does not belong to this timing session category");
  }

  if (resolvedRegistrationId) {
    const { data: operationalControl, error: controlError } = await adminClient
      .from("edition_operational_controls")
      .select("current_manifest_id,start_list_state")
      .eq("event_edition_id", timingContext.eventEditionId)
      .maybeSingle<{ current_manifest_id: string | null; start_list_state: string }>();
    if (controlError) throw controlError;
    if (operationalControl?.start_list_state !== "frozen" || !operationalControl.current_manifest_id) {
      throw conflict("The start-list manifest is not frozen");
    }

    const { data: manifestEntry, error: manifestEntryError } = await adminClient
      .from("start_list_manifest_entries")
      .select("id")
      .eq("manifest_id", operationalControl.current_manifest_id)
      .eq("registration_id", resolvedRegistrationId)
      .maybeSingle<{ id: string }>();
    if (manifestEntryError) throw manifestEntryError;
    if (!manifestEntry) {
      throw conflict("Runner is not present in the current frozen start list");
    }
  }

  const recordedAt = new Date(input.recordedAt);
  if (Number.isNaN(recordedAt.getTime())) {
    throw badRequest("Invalid recordedAt timestamp");
  }

  const warnings: RaceDayPunchWarning[] = [];
  let passNumber: number | null = null;
  let expectedPassCount = 1;
  if (!resolvedRegistrationId) {
    warnings.push({
      code: "unresolved_bib",
      message: "Bib could not be resolved to a registration",
    });
  }

  if (resolvedRegistrationId) {
    const { data: categoryCourse, error: categoryCourseError } = await adminClient
      .from("event_categories")
      .select("course_format,lap_count")
      .eq("id", resolvedCategoryId)
      .maybeSingle<{ course_format: string; lap_count: number }>();
    if (categoryCourseError) throw categoryCourseError;
    if (!categoryCourse) throw notFound("Category not found");
    const courseFormat = normalizeCourseFormat(categoryCourse.course_format);
    const lapCount = normalizeLapCount(courseFormat, categoryCourse.lap_count);
    expectedPassCount = expectedCheckpointPasses(
      courseFormat,
      lapCount,
      checkpoint.checkpoint_type,
    );

    const { count: priorPassCount, error: duplicateError } = await adminClient
      .from("punch_events")
      .select("id", { count: "exact", head: true })
      .eq("event_category_id", resolvedCategoryId)
      .eq("checkpoint_id", input.checkpointId)
      .eq("registration_id", resolvedRegistrationId)
      .eq("is_voided", false);

    if (duplicateError) throw duplicateError;
    passNumber = (priorPassCount ?? 0) + 1;
    const requiredPriorPassCount = Math.min(passNumber, expectedPassCount);
    if (passNumber > expectedPassCount) {
      warnings.push({
        code: "duplicate_checkpoint",
        message: `${checkpoint.name} already has all ${expectedPassCount} expected passage${expectedPassCount === 1 ? "" : "s"} for this registration`,
      });
    }

    if (checkpoint.sequence_number > 1) {
      const allCheckpoints = await loadCheckpointsByCategoryIds([resolvedCategoryId], env);
      const priorCheckpointIds = allCheckpoints
        .filter(
          (item) =>
            item.is_mandatory
            && item.sequence_number < checkpoint.sequence_number
            && item.checkpoint_type !== "start",
        )
        .map((item) => item.id);
      if (priorCheckpointIds.length) {
        const { data: priorPunches, error: priorPunchError } = await adminClient
          .from("punch_events")
          .select("checkpoint_id")
          .eq("registration_id", resolvedRegistrationId)
          .in("checkpoint_id", priorCheckpointIds)
          .eq("is_voided", false)
          .returns<Array<{ checkpoint_id: string }>>();

        if (priorPunchError) throw priorPunchError;
        const priorPassCountByCheckpoint = new Map<string, number>();
        for (const priorPunch of priorPunches ?? []) {
          priorPassCountByCheckpoint.set(
            priorPunch.checkpoint_id,
            (priorPassCountByCheckpoint.get(priorPunch.checkpoint_id) ?? 0) + 1,
          );
        }
        if (!priorCheckpointIds.every(
          (id) => (priorPassCountByCheckpoint.get(id) ?? 0) >= requiredPriorPassCount,
        )) {
          warnings.push({
            code: "wrong_sequence",
            message: courseFormat === "laps"
              ? `Lap ${requiredPriorPassCount} arrived before one or more earlier route points`
              : "This punch arrived before one or more earlier checkpoints",
          });
        }
      }
    }
  }

  if (checkpoint.cutoff_at && recordedAt.getTime() > new Date(checkpoint.cutoff_at).getTime()) {
    warnings.push({
      code: "cutoff_exceeded",
      message: `${checkpoint.name} was recorded after the checkpoint cutoff`,
    });
  }

  const { data: created, error: createError } = await adminClient
    .from("punch_events")
    .insert({
      timing_session_id: input.timingSessionId,
      event_category_id: resolvedCategoryId,
      checkpoint_id: input.checkpointId,
      registration_id: resolvedRegistrationId,
      athlete_profile_id: athleteProfileId,
      bib_number: resolvedBibNumber,
      recorded_at: recordedAt.toISOString(),
      entered_by_user_id: session.account.userId,
      client_event_id: input.clientEventId,
    })
    .select("id")
    .single<{ id: string }>();

  if (createError) throw createError;

  // The database punch projection trigger applies resolved start/finish participant
  // status in the same transaction. Keep this append as the final write so a later
  // request cannot fail after the punch has already been durably recorded.

  const punch: RaceDayPunchRecord = {
    id: created.id,
    eventCategoryId: resolvedCategoryId,
    checkpointId: checkpoint.id,
    registrationId: resolvedRegistrationId,
    bibNumber: resolvedBibNumber,
    athleteName: null,
    categoryName: null,
    checkpointName: checkpoint.name,
    recordedAt: recordedAt.toISOString(),
    warnings,
    passNumber,
    expectedPassCount,
    completesRace:
      checkpoint.checkpoint_type === "finish"
      && passNumber !== null
      && passNumber === expectedPassCount,
  };
  return {
    punch,
    warnings,
    idempotent: false,
    passNumber,
    expectedPassCount,
    completesRace:
      checkpoint.checkpoint_type === "finish"
      && passNumber !== null
      && passNumber === expectedPassCount,
  };
}

export async function getCategoryResults(
  session: RequestSession,
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
  preferredRunId?: string | null,
) {
  await requireCategoryAccess(session, categoryId, "results.manage", env);
  return loadCategoryResultsSnapshot(categoryId, env, { preferredRunId });
}

export async function createResultComplaint(
  session: RequestSession,
  categoryId: string,
  input: CreateResultComplaintInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireCategoryAccess(session, categoryId, "results.manage", env);

  if (input.registrationId) {
    const { data: registration, error: registrationError } = await adminClient
      .from("registrations")
      .select("id")
      .eq("id", input.registrationId)
      .eq("event_category_id", categoryId)
      .maybeSingle<{ id: string }>();
    if (registrationError) throw registrationError;
    if (!registration) {
      throw badRequest("The selected registration does not belong to this race");
    }
  }

  const { error } = await adminClient
    .from("result_complaints")
    .insert({
      event_category_id: categoryId,
      registration_id: input.registrationId ?? null,
      bib_number: cleanOptionalText(input.bibNumber),
      complainant_name: cleanRequiredText(input.complainantName, "Complainant name"),
      complaint_text: cleanRequiredText(input.complaintText, "Complaint"),
      created_by_user_id: session.account.userId,
    });
  if (error) throw error;

  return loadCategoryResultsSnapshot(categoryId, env);
}

export async function resolveResultComplaint(
  session: RequestSession,
  complaintId: string,
  input: ResolveResultComplaintInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: complaint, error: complaintError } = await adminClient
    .from("result_complaints")
    .select("id,event_category_id,status")
    .eq("id", complaintId)
    .maybeSingle<{
      id: string;
      event_category_id: string;
      status: "open" | "resolved" | "dismissed";
    }>();
  if (complaintError) throw complaintError;
  if (!complaint) throw notFound("Complaint not found");

  await requireCategoryAccess(
    session,
    complaint.event_category_id,
    "results.manage",
    env,
  );
  if (complaint.status !== "open") {
    throw conflict("This complaint has already been closed");
  }

  const resolvedAt = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("result_complaints")
    .update({
      status: input.status,
      resolution_note: cleanRequiredText(input.resolutionNote, "Resolution note"),
      resolved_by_user_id: session.account.userId,
      resolved_at: resolvedAt,
      updated_at: resolvedAt,
    })
    .eq("id", complaint.id)
    .eq("status", "open");
  if (updateError) throw updateError;

  return loadCategoryResultsSnapshot(complaint.event_category_id, env);
}

async function computeCategoryResults(
  session: RequestSession | null,
  categoryId: string,
  env: ServerEnv,
  authorizeResultsManagement: boolean,
  workflowJobId: string | null = null,
) {
  const adminClient = createAdminSupabaseClient(env);
  if (authorizeResultsManagement) {
    if (!session) throw forbidden("Results management authorization is required");
    await requireCategoryAccess(session, categoryId, "results.manage", env);
  }

  if (await loadImportedResultSnapshot(adminClient, categoryId)) {
    // Also protects older clients whose automatic refresh still calls this
    // endpoint. This is a read-only replay, before inserting any run or job.
    return loadCategoryResultsSnapshot(categoryId, env);
  }

  const [{ data: category, error: categoryError }, loadedCheckpoints] = await Promise.all([
    adminClient
      .from("event_categories")
      .select("id,start_at,event_edition_id,distance_km,sport_code,course_format,lap_count,ranking_config_json")
      .eq("id", categoryId)
      .maybeSingle<{
        id: string;
        start_at: string | null;
        event_edition_id: string;
        distance_km: number | null;
        sport_code: string;
        course_format: string;
        lap_count: number;
        ranking_config_json: unknown;
      }>(),
    loadCheckpointsByCategoryIds([categoryId], env),
  ]);

  if (categoryError) throw categoryError;
  if (!category) throw notFound("Category not found");
  const checkpoints = loadedCheckpoints.filter((checkpoint) => checkpoint.is_mandatory);
  if (!checkpoints.length) throw badRequest("Cannot compute results without checkpoints");
  const courseFormat = normalizeCourseFormat(category.course_format);
  const lapCount = normalizeLapCount(courseFormat, category.lap_count);
  const rankingConfig = normalizeCompetitiveRankingConfig(category.ranking_config_json);

  const { data: effectiveStartEvent, error: startEventError } = await adminClient
    .from("race_start_events")
    .select("id,event_type,occurred_at,start_method,sequence_number")
    .eq("event_category_id", categoryId)
    .in("event_type", ["actual_start", "restart"])
    .order("sequence_number", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      event_type: "actual_start" | "restart";
      occurred_at: string;
      start_method: string;
      sequence_number: number;
    }>();
  if (startEventError) throw startEventError;
  if (!effectiveStartEvent) {
    throw conflict("Record the actual race start before computing results");
  }

  const { data: editionRow, error: editionError } = await adminClient
    .from("event_editions")
    .select("start_date")
    .eq("id", category.event_edition_id)
    .maybeSingle<{ start_date: string }>();

  if (editionError) throw editionError;
  const eventDate = editionRow?.start_date ?? null;

  const { data: previousResultRun, error: previousResultRunError } = await adminClient
    .from("result_runs")
    .select("id")
    .eq("event_category_id", categoryId)
    .eq("status", "succeeded")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (previousResultRunError) throw previousResultRunError;

  const { data: resultRun, error: resultRunError } = await adminClient
    .from("result_runs")
    .insert({
      event_category_id: categoryId,
      trigger_type: workflowJobId ? "workflow" : "manual",
      trigger_reference_id: workflowJobId,
      status: "running",
    })
    .select("id")
    .single<{ id: string }>();

  if (resultRunError) {
    if (resultRunError.code === "23505") {
      throw conflict("Results are already being recomputed for this category");
    }
    throw resultRunError;
  }

  try {
  const [{ data: registrations, error: registrationError }, { data: punches, error: punchError }] = await Promise.all([
    adminClient
      .from("registrations")
      .select("id,athlete_profile_id,represented_club_id,participation_status,status")
      .eq("event_category_id", categoryId)
      .eq("status", "confirmed")
      .returns<Array<{
        id: string;
        athlete_profile_id: string;
        represented_club_id: string | null;
        participation_status: string;
        status: string;
      }>>(),
    adminClient
      .from("punch_events")
      .select("id,registration_id,checkpoint_id,bib_number,effective_recorded_at,reconciliation_state")
      .eq("event_category_id", categoryId)
      .eq("is_voided", false)
      .order("effective_recorded_at", { ascending: true })
      .returns<Array<{
        id: string;
        registration_id: string | null;
        checkpoint_id: string;
        bib_number: string | null;
        effective_recorded_at: string;
        reconciliation_state: string;
      }>>(),
  ]);

  if (registrationError) throw registrationError;
  if (punchError) throw punchError;

  const registrationRows = registrations ?? [];
  const checkpointIds = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  const timingPunches = (punches ?? []).filter((punch) => checkpointIds.has(punch.checkpoint_id));
  const athleteIds = Array.from(new Set(registrationRows.map((registration) => registration.athlete_profile_id)));
  const { data: athleteRows, error: athleteError } = athleteIds.length
    ? await adminClient
        .from("athlete_profiles")
        .select("id,gender,date_of_birth")
        .in("id", athleteIds)
        .returns<Array<{ id: string; gender: string | null; date_of_birth: string | null }>>()
    : { data: [] as Array<{ id: string; gender: string | null; date_of_birth: string | null }>, error: null };

  if (athleteError) throw athleteError;
  const athleteById = new Map((athleteRows ?? []).map((row) => [row.id, row]));
  const startCheckpoint = checkpoints.find((checkpoint) => checkpoint.checkpoint_type === "start") ?? checkpoints[0];
  const finishCheckpoint = checkpoints.find((checkpoint) => checkpoint.checkpoint_type === "finish") ?? checkpoints[checkpoints.length - 1];
  const categoryStartAt = new Date(effectiveStartEvent.occurred_at).getTime();
  const usesIndividualStart = ["chip", "rolling", "individual_interval"].includes(
    effectiveStartEvent.start_method,
  );
  const punchMap = new Map<string, Map<string, string>>();
  const punchObservationsByRegistration = new Map<string, Map<string, Array<{
    punchEventId: string;
    recordedAt: string;
  }>>>();

  for (const punch of timingPunches) {
    if (!punch.registration_id) continue;
    const registrationPunches = punchMap.get(punch.registration_id) ?? new Map<string, string>();
    if (!registrationPunches.has(punch.checkpoint_id)) {
      registrationPunches.set(punch.checkpoint_id, punch.effective_recorded_at);
    }
    punchMap.set(punch.registration_id, registrationPunches);
    const registrationObservations = punchObservationsByRegistration.get(punch.registration_id)
      ?? new Map<string, Array<{ punchEventId: string; recordedAt: string }>>();
    const checkpointObservations = registrationObservations.get(punch.checkpoint_id) ?? [];
    checkpointObservations.push({
      punchEventId: punch.id,
      recordedAt: punch.effective_recorded_at,
    });
    registrationObservations.set(punch.checkpoint_id, checkpointObservations);
    punchObservationsByRegistration.set(punch.registration_id, registrationObservations);
  }

  const repeatedCoursePoints = checkpoints
    .filter((checkpoint) => checkpoint.checkpoint_type !== "start")
    .sort((left, right) => left.sequence_number - right.sequence_number || left.id.localeCompare(right.id));
  const resultLapCount = courseFormat === "laps" ? lapCount : 1;

  const provisionalRows = registrationRows.map((registration) => {
    const registrationPunches = punchMap.get(registration.id) ?? new Map<string, string>();
    const registrationObservations = punchObservationsByRegistration.get(registration.id)
      ?? new Map<string, Array<{ punchEventId: string; recordedAt: string }>>();
    const startTimestamp =
      usesIndividualStart && registrationPunches.get(startCheckpoint.id) != null
        ? new Date(registrationPunches.get(startCheckpoint.id) ?? "").getTime()
        : categoryStartAt;
    const finishObservation = registrationObservations.get(finishCheckpoint.id)?.[resultLapCount - 1] ?? null;
    const finishTimestamp = finishObservation
      ? new Date(finishObservation.recordedAt).getTime()
      : null;
    const calculatedFinishTimeMs =
      startTimestamp != null && finishTimestamp != null && finishTimestamp >= startTimestamp
        ? finishTimestamp - startTimestamp
        : null;
    const finishTimeMs = registration.participation_status === "finished"
      ? calculatedFinishTimeMs
      : null;

    const orderedSplits = Array.from({ length: resultLapCount }, (_, lapIndex) =>
      repeatedCoursePoints.flatMap((checkpoint, pointIndex) => {
        const observation = registrationObservations.get(checkpoint.id)?.[lapIndex] ?? null;
        if (!observation) return [];
        const currentMs = new Date(observation.recordedAt).getTime();
        return [{
          checkpointId: checkpoint.id,
          sequenceNumber: (lapIndex * repeatedCoursePoints.length) + pointIndex + 1,
          recordedAt: observation.recordedAt,
          recordedAtMs: currentMs,
          elapsedTimeMs: startTimestamp != null ? Math.max(0, currentMs - startTimestamp) : null,
        }];
      }),
    )
      .flat()
      .map((item, index, items) => ({
        checkpointId: item.checkpointId,
        sequenceNumber: item.sequenceNumber,
        recordedAt: item.recordedAt,
        elapsedTimeMs: item.elapsedTimeMs,
        splitTimeMs:
          index === 0
            ? item.elapsedTimeMs
            : item.recordedAtMs - items[index - 1].recordedAtMs,
      }));

    return {
      registrationId: registration.id,
      athleteProfileId: registration.athlete_profile_id,
      representedClubId: registration.represented_club_id,
      gender: normalizeRankingGender(athleteById.get(registration.athlete_profile_id)?.gender ?? null),
      ageBucketKey:
        findCompetitiveAgeBucket(
          rankingConfig,
          athleteById.get(registration.athlete_profile_id)?.date_of_birth ?? null,
          eventDate,
        )?.key ?? null,
      finishTimeMs,
      rankOverall: null as number | null,
      gapMs: null as number | null,
      resultStatus: finishTimeMs != null ? "provisional" : registration.participation_status === "dsq" ? "void" : "provisional",
      splits: orderedSplits,
    };
  });

  const finishers = assignCompetitionRanks(
    provisionalRows
      .filter((row) => row.finishTimeMs != null)
      .map((row) => ({
        registrationId: row.registrationId,
        finishTimeMs: row.finishTimeMs as number,
      }))
      .sort((left, right) => left.finishTimeMs - right.finishTimeMs),
  );
  const finisherRankByRegistrationId = new Map(
    finishers.map((row) => [row.registrationId, row.rank]),
  );
  const winnerTime = finishers[0]?.finishTimeMs ?? null;
  const genderRankByRegistrationId = new Map<string, number>();
  const ageRankByRegistrationId = new Map<string, number>();

  if (rankingConfig.sex.enabled) {
    for (const bucket of rankingConfig.sex.buckets) {
      const rankedRows = assignCompetitionRanks(
        provisionalRows
          .filter((row) => row.finishTimeMs != null && row.gender === bucket.gender)
          .map((row) => ({
            registrationId: row.registrationId,
            finishTimeMs: row.finishTimeMs as number,
          }))
          .sort((left, right) => left.finishTimeMs - right.finishTimeMs),
      );
      for (const rankedRow of rankedRows) {
        genderRankByRegistrationId.set(rankedRow.registrationId, rankedRow.rank);
      }
    }
  }

  if (rankingConfig.age.enabled) {
    for (const bucket of rankingConfig.age.buckets) {
      const rankedRows = assignCompetitionRanks(
        provisionalRows
          .filter((row) => row.finishTimeMs != null && row.ageBucketKey === bucket.key)
          .map((row) => ({
            registrationId: row.registrationId,
            finishTimeMs: row.finishTimeMs as number,
          }))
          .sort((left, right) => left.finishTimeMs - right.finishTimeMs),
      );
      for (const rankedRow of rankedRows) {
        ageRankByRegistrationId.set(rankedRow.registrationId, rankedRow.rank);
      }
    }
  }

  const rowsToInsert = provisionalRows.map((row) => ({
    result_run_id: resultRun.id,
    registration_id: row.registrationId,
    athlete_profile_id: row.athleteProfileId,
    event_category_id: categoryId,
    result_status: row.resultStatus,
    finish_time_ms: row.finishTimeMs,
    gap_ms: winnerTime != null && row.finishTimeMs != null ? row.finishTimeMs - winnerTime : null,
    rank_overall: finisherRankByRegistrationId.get(row.registrationId) ?? null,
    rank_gender: genderRankByRegistrationId.get(row.registrationId) ?? null,
    rank_age_category: ageRankByRegistrationId.get(row.registrationId) ?? null,
    club_points: null,
    represented_club_id: row.representedClubId,
  }));

  const { data: insertedRows, error: insertRowsError } = await adminClient
    .from("result_rows")
    .insert(rowsToInsert)
    .select("id,registration_id")
    .returns<Array<{ id: string; registration_id: string }>>();

  if (insertRowsError) throw insertRowsError;

  const resultRowIdByRegistrationId = new Map((insertedRows ?? []).map((row) => [row.registration_id, row.id]));
  const splitRows = provisionalRows.flatMap((row) =>
    row.splits.map((split) => ({
      result_row_id: resultRowIdByRegistrationId.get(row.registrationId),
      checkpoint_id: split.checkpointId,
      sequence_number: split.sequenceNumber,
      recorded_at: split.recordedAt,
      elapsed_time_ms: split.elapsedTimeMs,
      split_time_ms: split.splitTimeMs,
    })),
  ).filter((row): row is {
    result_row_id: string;
    checkpoint_id: string;
    sequence_number: number;
    recorded_at: string;
    elapsed_time_ms: number | null;
    split_time_ms: number | null;
  } => Boolean(row.result_row_id));

  if (splitRows.length) {
    const { error: splitError } = await adminClient.from("result_splits").insert(splitRows);
    if (splitError) throw splitError;
  }

  const anomalyRows: Array<{
    result_run_id: string;
    event_category_id: string;
    registration_id: string | null;
    punch_event_id: string | null;
    anomaly_code: string;
    severity: "warning" | "error" | "critical";
    message: string;
    evidence_json: Record<string, unknown>;
  }> = [];
  const punchObservationsByRegistrationCheckpoint = new Map<
    string,
    Array<{ punchEventId: string; effectiveRecordedAt: string }>
  >();
  const checkpointByIdForReview = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  for (const punch of timingPunches) {
    if (!punch.registration_id) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: null,
        punch_event_id: punch.id,
        anomaly_code: "unresolved_timing_event",
        severity: "error",
        message: `Unresolved bib ${punch.bib_number ?? "unknown"} has a timing observation.`,
        evidence_json: {
          bibNumber: punch.bib_number,
          checkpointId: punch.checkpoint_id,
          effectiveRecordedAt: punch.effective_recorded_at,
        },
      });
      continue;
    }
    const punchCheckpoint = checkpointByIdForReview.get(punch.checkpoint_id);
    if (
      punchCheckpoint?.cutoff_at
      && new Date(punch.effective_recorded_at).getTime() > new Date(punchCheckpoint.cutoff_at).getTime()
    ) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: punch.registration_id,
        punch_event_id: punch.id,
        anomaly_code: "checkpoint_cutoff_exceeded",
        severity: "warning",
        message: `${punchCheckpoint.name} was recorded after its cutoff.`,
        evidence_json: {
          checkpointId: punch.checkpoint_id,
          effectiveRecordedAt: punch.effective_recorded_at,
          cutoffAt: punchCheckpoint.cutoff_at,
        },
      });
    }
    const key = `${punch.registration_id}:${punch.checkpoint_id}`;
    const observations = punchObservationsByRegistrationCheckpoint.get(key) ?? [];
    observations.push({
      punchEventId: punch.id,
      effectiveRecordedAt: punch.effective_recorded_at,
    });
    punchObservationsByRegistrationCheckpoint.set(key, observations);
  }

  for (const [key, observations] of punchObservationsByRegistrationCheckpoint) {
    const [registrationId, checkpointId] = key.split(":");
    const checkpoint = checkpointByIdForReview.get(checkpointId);
    const expectedPassCount = expectedCheckpointPasses(
      courseFormat,
      lapCount,
      checkpoint?.checkpoint_type ?? "timing",
    );
    if (observations.length <= expectedPassCount) continue;
    const checkpointName = checkpoint?.name ?? "Checkpoint";
    anomalyRows.push({
      result_run_id: resultRun.id,
      event_category_id: categoryId,
      registration_id: registrationId,
      punch_event_id: null,
      anomaly_code: "duplicate_checkpoint_observation",
      severity: "warning",
      message: `${observations.length} timing entries were recorded at ${checkpointName}; ${expectedPassCount} ${expectedPassCount === 1 ? "is" : "are"} expected.`,
      evidence_json: {
        checkpointId,
        checkpointName,
        expectedPassCount,
        observationCount: observations.length,
        observations: observations.map((observation, index) => ({
          ...observation,
          usedForResult: index < expectedPassCount,
        })),
      },
    });
  }

  const mandatoryCheckpointIds = checkpoints
    .filter(
      (checkpoint) =>
        checkpoint.is_mandatory
        && (checkpoint.checkpoint_type !== "start" || usesIndividualStart),
    )
    .map((checkpoint) => checkpoint.id);
  const provisionalRowByRegistrationId = new Map(
    provisionalRows.map((row) => [row.registrationId, row]),
  );
  const categoryDistanceKm = category.distance_km == null
    ? null
    : Number(category.distance_km);
  const plausibleSpeedLimitKph = maximumPlausibleAverageSpeedKph(category.sport_code);
  for (const registration of registrationRows) {
    const registrationObservations = punchObservationsByRegistration.get(registration.id)
      ?? new Map<string, Array<{ punchEventId: string; recordedAt: string }>>();
    const expectedObservedPassages = Array.from({ length: resultLapCount }, (_, lapIndex) =>
      repeatedCoursePoints.flatMap((checkpoint, pointIndex) => {
        const observation = registrationObservations.get(checkpoint.id)?.[lapIndex] ?? null;
        if (!observation) return [];
        return [{
          checkpoint,
          observation,
          sequenceNumber: (lapIndex * repeatedCoursePoints.length) + pointIndex + 1,
        }];
      }),
    ).flat();
    for (let index = 1; index < expectedObservedPassages.length; index += 1) {
      const previousPassage = expectedObservedPassages[index - 1];
      const passage = expectedObservedPassages[index];
      const previousRecordedAt = previousPassage.observation.recordedAt;
      const recordedAt = passage.observation.recordedAt;
      if (new Date(recordedAt).getTime() >= new Date(previousRecordedAt).getTime()) continue;
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "checkpoint_time_out_of_sequence",
        severity: "error",
        message: `${passage.checkpoint.name} passage ${passage.sequenceNumber} is timed before the preceding route passage.`,
        evidence_json: {
          checkpointId: passage.checkpoint.id,
          previousCheckpointId: previousPassage.checkpoint.id,
          sequenceNumber: passage.sequenceNumber,
          previousSequenceNumber: previousPassage.sequenceNumber,
          effectiveRecordedAt: recordedAt,
          previousRecordedAt,
        },
      });
    }
    const recordedFinishAt = registrationObservations
      .get(finishCheckpoint.id)?.[resultLapCount - 1]?.recordedAt ?? null;
    if (
      registration.participation_status === "finished"
      && recordedFinishAt
      && new Date(recordedFinishAt).getTime() < categoryStartAt
    ) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "finish_time_before_race_start",
        severity: "error",
        message: "Finish time is earlier than the effective race start.",
        evidence_json: {
          checkpointId: finishCheckpoint.id,
          finishRecordedAt: recordedFinishAt,
          effectiveStartAt: effectiveStartEvent.occurred_at,
        },
      });
    }
    const missingCheckpointPassages = mandatoryCheckpointIds.flatMap((checkpointId) => {
      const checkpoint = checkpointByIdForReview.get(checkpointId);
      const expectedPassCount = expectedCheckpointPasses(
        courseFormat,
        lapCount,
        checkpoint?.checkpoint_type ?? "timing",
      );
      const observedPassCount = registrationObservations.get(checkpointId)?.length ?? 0;
      return observedPassCount < expectedPassCount
        ? [{ checkpointId, expectedPassCount, observedPassCount }]
        : [];
    });
    if (registration.participation_status === "finished" && missingCheckpointPassages.length) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "finished_missing_mandatory_checkpoint",
        severity: "error",
        message: "Finished participant is missing one or more mandatory timing passages.",
        evidence_json: {
          missingCheckpointIds: missingCheckpointPassages.map((passage) => passage.checkpointId),
          missingCheckpointPassages,
        },
      });
    }
    const provisionalRow = provisionalRowByRegistrationId.get(registration.id);
    const averageSpeedKph = categoryDistanceKm != null
      && categoryDistanceKm > 0
      && provisionalRow?.finishTimeMs != null
      && provisionalRow.finishTimeMs > 0
        ? categoryDistanceKm / (provisionalRow.finishTimeMs / 3_600_000)
        : null;
    if (averageSpeedKph != null && averageSpeedKph > plausibleSpeedLimitKph) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "implausible_average_speed",
        severity: "error",
        message: `Average speed ${averageSpeedKph.toFixed(2)} km/h is not plausible for this race. Check the race start, finish time, and distance.`,
        evidence_json: {
          checkpointId: finishCheckpoint.id,
          sportCode: category.sport_code,
          distanceKm: categoryDistanceKm,
          finishTimeMs: provisionalRow?.finishTimeMs ?? null,
          averageSpeedKph,
          plausibleSpeedLimitKph,
        },
      });
    }
    if (registration.participation_status === "missing") {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "participant_missing",
        severity: "critical",
        message: "Participant remains in missing status.",
        evidence_json: {},
      });
    } else if (["started", "stopped"].includes(registration.participation_status)) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "participant_unresolved_in_field",
        severity: "error",
        message: `Participant remains ${registration.participation_status.replaceAll("_", " ")}.`,
        evidence_json: { participationStatus: registration.participation_status },
      });
    } else if (["not_started", "checked_in"].includes(registration.participation_status)) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "participant_unresolved_before_publication",
        severity: "error",
        message: `Participant remains ${registration.participation_status.replaceAll("_", " ")}.`,
        evidence_json: { participationStatus: registration.participation_status },
      });
    } else if (["dnf", "dns", "dsq", "withdrawn", "evacuated"].includes(registration.participation_status)) {
      anomalyRows.push({
        result_run_id: resultRun.id,
        event_category_id: categoryId,
        registration_id: registration.id,
        punch_event_id: null,
        anomaly_code: "participant_non_finisher_status",
        severity: "warning",
        message: `Participant is marked ${registration.participation_status.toUpperCase()}.`,
        evidence_json: { participationStatus: registration.participation_status },
      });
    }
  }

  let previousClosedAnomalies: ClosedResultAnomaly[] = [];
  if (previousResultRun) {
    const { data, error } = await adminClient
      .from("result_anomalies")
      .select(
        "event_category_id,registration_id,punch_event_id,anomaly_code,severity,evidence_json,state,resolution_note,resolved_by_user_id,resolved_at",
      )
      .eq("result_run_id", previousResultRun.id)
      .in("state", ["resolved", "waived"])
      .not("resolved_at", "is", null)
      .returns<ClosedResultAnomaly[]>();
    if (error) throw error;
    previousClosedAnomalies = data ?? [];
  }
  const anomalyRowsToInsert = carryForwardResultAnomalyResolutions(
    anomalyRows,
    previousClosedAnomalies,
  );

  if (anomalyRowsToInsert.length) {
    const { error: anomalyError } = await adminClient
      .from("result_anomalies")
      .insert(anomalyRowsToInsert);
    if (anomalyError) throw anomalyError;
  }

  const inputDigest = buildCategoryResultInputDigest({
    categoryId,
    categoryDistanceKm,
    courseFormat,
    lapCount,
    sportCode: category.sport_code,
    startEvent: effectiveStartEvent,
    checkpoints,
    registrations: registrationRows,
    punches: timingPunches,
  });

  const summary = {
    registrations: registrationRows.length,
    finishers: finishers.length,
    punchCount: punches?.length ?? 0,
    sexRankingsEnabled: rankingConfig.sex.enabled,
    ageRankingsEnabled: rankingConfig.age.enabled,
    teamRankingsEnabled: rankingConfig.team.enabled,
    raceStartEventId: effectiveStartEvent.id,
    raceStartMethod: effectiveStartEvent.start_method,
    effectiveStartAt: effectiveStartEvent.occurred_at,
    anomalyCount: anomalyRowsToInsert.length,
    blockingAnomalyCount: anomalyRowsToInsert.filter((anomaly) =>
      anomaly.state === "open"
      && (anomaly.severity === "error" || anomaly.severity === "critical")
    ).length,
    inputDigest,
    engineVersion: RESULTS_ENGINE_VERSION,
  };
  const { error: finalizeError } = await adminClient
    .from("result_runs")
    .update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      summary_json: summary,
      engine_version: RESULTS_ENGINE_VERSION,
      input_digest: inputDigest,
      start_event_id: effectiveStartEvent.id,
    })
    .eq("id", resultRun.id);

  if (finalizeError) throw finalizeError;

  return await loadCategoryResultsSnapshot(categoryId, env, {
    preferredRunId: resultRun.id,
  });
  } catch (error) {
    await adminClient
      .from("result_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        summary_json: { errorCode: "result_compute_failed" },
      })
      .eq("id", resultRun.id)
      .eq("status", "running");
    throw error;
  }
}

export function recomputeCategoryResults(
  session: RequestSession,
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
) {
  return computeCategoryResults(session, categoryId, env, true);
}

export function computeFinishedCategoryResults(
  session: RequestSession,
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
) {
  return computeCategoryResults(session, categoryId, env, false);
}

export async function computeFinishedCategoryResultsForWorkflow(
  categoryId: string,
  workflowJobId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  if (await loadImportedResultSnapshot(adminClient, categoryId)) {
    return loadCategoryResultsSnapshot(categoryId, env);
  }
  const { data: reusableRun, error: reusableRunError } = await adminClient
    .from("result_runs")
    .select("id")
    .eq("trigger_reference_id", workflowJobId)
    .eq("status", "succeeded")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (reusableRunError) throw reusableRunError;
  if (reusableRun) {
    return loadCategoryResultsSnapshot(categoryId, env, {
      preferredRunId: reusableRun.id,
    });
  }

  const failedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { error: abandonedWorkflowRunError } = await adminClient
    .from("result_runs")
    .update({
      status: "failed",
      completed_at: failedAt,
      summary_json: { errorCode: "workflow_attempt_abandoned" },
    })
    .eq("trigger_reference_id", workflowJobId)
    .eq("status", "running");
  if (abandonedWorkflowRunError) throw abandonedWorkflowRunError;

  const { error: staleRunError } = await adminClient
    .from("result_runs")
    .update({
      status: "failed",
      completed_at: failedAt,
      summary_json: { errorCode: "stale_result_run_recovered" },
    })
    .eq("event_category_id", categoryId)
    .eq("status", "running")
    .lt("started_at", staleBefore);
  if (staleRunError) throw staleRunError;

  return computeCategoryResults(null, categoryId, env, false, workflowJobId);
}

export async function publishCategoryResults(
  session: RequestSession,
  categoryId: string,
  input: PublishResultsInput,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  await requireCategoryAccess(session, categoryId, "results.manage", env);
  const publicationState = input.publicationState ?? "official";
  let resultRunId = input.resultRunId ?? null;
  if (!resultRunId) {
    const { data: latestRun, error: latestRunError } = await adminClient
      .from("result_runs")
      .select("id")
      .eq("event_category_id", categoryId)
      .eq("status", "succeeded")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (latestRunError) throw latestRunError;
    resultRunId = latestRun?.id ?? null;
  }

  if (!resultRunId) {
    throw conflict("No successful result run is available to publish");
  }

  const { count: openComplaintCount, error: complaintCountError } = await adminClient
    .from("result_complaints")
    .select("id", { count: "exact", head: true })
    .eq("event_category_id", categoryId)
    .eq("status", "open");
  if (complaintCountError) throw complaintCountError;
  if ((openComplaintCount ?? 0) > 0) {
    throw conflict("Resolve or dismiss every result complaint before publication");
  }

  const { data: publicationData, error: publicationError } = await adminClient.rpc(
    "service_publish_result_run_with_workflows",
    {
      p_event_category_id: categoryId,
      p_result_run_id: resultRunId,
      p_publication_state: publicationState,
      p_published_by_user_id: session.account.userId,
      p_change_note: input.changeNote ?? null,
      p_client_event_id: input.clientEventId,
    },
  );

  if (publicationError) {
    if (publicationError.message.includes("successful_result_run_required")) {
      throw conflict("Only a successful result run can be published");
    }
    if (publicationError.message.includes("correction_requires_previous_publication")) {
      throw conflict("Publish official results before creating a correction");
    }
    if (publicationError.message.includes("blocking_result_anomalies_open")) {
      throw conflict("Resolve or explicitly waive every blocking result anomaly before publication");
    }
    if (publicationError.message.includes("unresolved_timing_events_open")) {
      throw conflict("Resolve or void every unknown timing race before publication");
    }
    if (publicationError.message.includes("result_run_start_lineage_stale")) {
      throw conflict("The race start changed after this result run. Recompute against the latest start before publication.");
    }
    if (publicationError.message.includes("field_accounting_incomplete")) {
      const { data: unfinishedRegistrations, error: unfinishedRegistrationsError } = await adminClient
        .from("registrations")
        .select("id,athlete_profile_id,participation_status")
        .eq("event_category_id", categoryId)
        .eq("status", "confirmed")
        .in("participation_status", ["not_started", "checked_in", "started", "missing"])
        .returns<Array<{
          id: string;
          athlete_profile_id: string;
          participation_status: string;
        }>>();

      if (!unfinishedRegistrationsError && unfinishedRegistrations?.length) {
        const registrationIds = unfinishedRegistrations.map((registration) => registration.id);
        const athleteIds = Array.from(new Set(
          unfinishedRegistrations.map((registration) => registration.athlete_profile_id),
        ));
        const [{ data: athleteRows }, { data: bibRows }] = await Promise.all([
          adminClient
            .from("athlete_profiles")
            .select("id,display_name")
            .in("id", athleteIds)
            .returns<Array<{ id: string; display_name: string | null }>>(),
          adminClient
            .from("bib_assignments")
            .select("registration_id,bib_number")
            .in("registration_id", registrationIds)
            .is("revoked_at", null)
            .returns<Array<{ registration_id: string; bib_number: string }>>(),
        ]);
        const athleteNameById = new Map(
          (athleteRows ?? []).map((athlete) => [athlete.id, athlete.display_name ?? "Unnamed participant"]),
        );
        const bibByRegistrationId = new Map(
          (bibRows ?? []).map((bib) => [bib.registration_id, bib.bib_number]),
        );
        const blockers = unfinishedRegistrations.map((registration) => ({
          registrationId: registration.id,
          bibNumber: bibByRegistrationId.get(registration.id) ?? null,
          athleteName: athleteNameById.get(registration.athlete_profile_id) ?? "Unnamed participant",
          participationStatus: registration.participation_status,
        }));
        const blockerPreview = blockers
          .slice(0, 5)
          .map((blocker) => (
            `${blocker.bibNumber ? `#${blocker.bibNumber} ` : ""}${blocker.athleteName} (${blocker.participationStatus.replaceAll("_", " ")})`
          ))
          .join(", ");
        const remainingCount = Math.max(0, blockers.length - 5);

        throw conflict(
          `Final publication is blocked by ${blockers.length} unfinished participant${blockers.length === 1 ? "" : "s"}: ${blockerPreview}${remainingCount ? `, and ${remainingCount} more` : ""}. Set each to Finished, DNS, DNF, or DSQ.`,
          {
            reason: "field_accounting_incomplete",
            participantCount: blockers.length,
            participants: blockers,
          },
        );
      }

      throw conflict(
        "Final publication is blocked by unfinished participant statuses. Set every participant to Finished, DNS, DNF, or DSQ.",
      );
    }
    throw publicationError;
  }

  type PublicationCommand = {
    publicationId: string;
    domainEventId: string;
    leagueJobId: string | null;
    leagueJobState: string | null;
    replayed: boolean;
  };
  type PropagationResult = {
    result: {
      affectedSeasonIds?: string[];
      standingsJobs?: Array<{
        jobId: string;
        leagueSeasonId: string;
        state: string;
      }>;
      leagueState?: string;
    };
  };
  type StandingsJobResult = {
    result: {
      state?: string;
      leagueSeasonId?: string;
      standingsVersionId?: string | null;
    };
  };

  const command = publicationData as PublicationCommand | null;
  if (!command?.publicationId || !command.domainEventId) {
    throw new Error("Result publication workflow did not return its command record");
  }

  let leagueState: "not_applicable" | "waiting_for_sources" | "ready" | "pending" =
    "not_applicable";
  let affectedSeasonIds: string[] = [];
  const standingsVersionIds: string[] = [];
  const pendingSeasonIds: string[] = [];

  if (command.leagueJobId) {
    try {
      const { data: propagationData, error: propagationError } = await adminClient.rpc(
        "service_process_result_publication_leagues",
        {
          p_workflow_job_id: command.leagueJobId,
          p_actor_user_id: session.account.userId,
        },
      );
      if (propagationError) throw propagationError;

      const propagation = propagationData as PropagationResult | null;
      affectedSeasonIds = propagation?.result.affectedSeasonIds ?? [];
      const standingsJobs = propagation?.result.standingsJobs ?? [];
      leagueState = affectedSeasonIds.length ? "ready" : "not_applicable";

      const standingsOutcomes = await Promise.all(standingsJobs.map(async (job) => {
        try {
          const { data: standingsData, error: standingsError } = await adminClient.rpc(
            "service_process_league_standings_job",
            {
              p_workflow_job_id: job.jobId,
              p_actor_user_id: session.account.userId,
            },
          );
          if (standingsError) throw standingsError;
          return {
            seasonId: job.leagueSeasonId,
            result: (standingsData as StandingsJobResult | null)?.result ?? {},
            pending: false,
          };
        } catch {
          await adminClient.rpc("service_record_workflow_job_failure", {
            p_workflow_job_id: job.jobId,
            p_handler_key: "league.standings.compute",
            p_error_code: "league_standings_compute_failed",
          });
          return { seasonId: job.leagueSeasonId, result: {}, pending: true };
        }
      }));

      for (const outcome of standingsOutcomes) {
        if (outcome.pending) {
          pendingSeasonIds.push(outcome.seasonId);
          leagueState = "pending";
        } else if (outcome.result.state === "waiting_for_sources") {
          if (leagueState !== "pending") leagueState = "waiting_for_sources";
        } else if (outcome.result.standingsVersionId) {
          standingsVersionIds.push(outcome.result.standingsVersionId);
        }
      }
    } catch {
      await adminClient.rpc("service_record_workflow_job_failure", {
        p_workflow_job_id: command.leagueJobId,
        p_handler_key: "league.publication.propagate",
        p_error_code: "league_publication_propagation_failed",
      });
      leagueState = "pending";
    }
  }

  const snapshot = await loadCategoryResultsSnapshot(categoryId, env);
  return {
    ...snapshot,
    publicationWorkflow: {
      publicationId: command.publicationId,
      workflowEventId: command.domainEventId,
      leagueState,
      affectedSeasonIds,
      standingsVersionIds,
      pendingSeasonIds,
      replayed: command.replayed,
    },
  } satisfies OrganizerCategoryResults;
}

export type OrganizerManagedRace = OrganizerManagedEvent;
export type OrganizerManagedRaceLocation = OrganizerManagedEventLocation;
export type OrganizerManagedRaceTimelineItem = OrganizerManagedEventTimelineItem;
export type CreateOrganizerRaceInput = CreateOrganizerEventInput;
export type UpdateOrganizerRaceInput = UpdateOrganizerEventInput;

export const getOrganizerRaces = getOrganizerEvents;
export const getOrganizerRaceById = getOrganizerEventById;
export const createOrganizerRace = createOrganizerEvent;
export const updateOrganizerRace = updateOrganizerEvent;
export const publishOrganizerRace = publishOrganizerEvent;
export const unpublishOrganizerRace = unpublishOrganizerEvent;
export const deleteOrganizerRace = deleteOrganizerEvent;
