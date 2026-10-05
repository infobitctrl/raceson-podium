import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL, URL } from "node:url";
import { isAllowedProfileAvatarUrl } from "@raceson/domain/athletes";
import { EVENT_ACTIVITY_TYPES } from "@raceson/domain/activities";
import { SPORT_CODES } from "@raceson/domain/sports";
import { z } from "zod";
import {
  allocateCategoryBibs,
  appendOperationsTaskEvent,
  attachOrganizerLeagueRound,
  appendStaffAssignmentEvent,
  appendTimingDeviceEvent,
  assertUsernameAccountSignUpCredentialsAvailable,
  bootstrapCurrentUserAccount,
  cancelCommunicationCampaign,
  cancelPendingBrowserSignUp,
  cancelOrganizerRegistration,
  cancelRegistration,
  changeCurrentUserPassword,
  changeCurrentUserAccountUsername,
  claimImportedAthleteProfileByVerifiedEmail,
  claimGuestRegistration,
  claimGuestRegistrationIntent,
  checkInRegistration,
  closeTimingSession,
  commitRegistrationImport,
  commitDnsReview,
  completeStravaAuthorization,
  consumePublicAuthRateLimit,
  configurePublicLive,
  createCurrentUserSupportTicket,
  createClubActivity,
  createCustomClubRole,
  createSafetyIncident,
  createSafetyPlanVersion,
  createOrganizerLeagueSeason,
  createOrganizerOnsiteRegistration,
  createRecreationalLeagueSchedule,
  createPracticeRace,
  deletePracticeRaces,
  createPracticeRegistration,
  createOrganizerTrack,
  createCurrentUserOrganizerWorkspace,
  deactivateSiteAdministrator,
  decideAthleteProfileClaim,
  decideClubAdminRoleRequest,
  decideCurrentUserClubMembershipRequest,
  createOrganizationAccount,
  createCurrentUserClub,
  createGuestRegistration,
  createGuestRegistrationClaimIntent,
  createEventInventoryItem,
  addEventReviewComment,
  createDnsReview,
  createRegistration,
  createRegistrationImportPreview,
  createResultComplaint,
  createOperationsTask,
  createStaffAssignment,
  createStravaAuthorizationUrl,
  createTimingSession,
  createTimingDeviceAssignment,
  deleteCurrentUserAccount,
  deleteUnusedOrganizerWorkspace,
  detachAllOrganizerLeagueRounds,
  detachOrganizerLeagueRound,
  deleteOrganizerLeague,
  deleteOrganizerTrack,
  dispatchPendingWorkflowJobs,
  getAthleteDashboardReadModel,
  getCurrentAthleteFavoritesReadModel,
  getCurrentAthleteYearStatistics,
  getAthleteProfileClaimAvailability,
  findUnclaimedAthleteProfileMatches,
  findOrganizerOnsiteAthleteMatches,
  finalizeVerifiedBrowserSignUp,
  getCurrentClubAdminRequestStates,
  getClubManagementDashboard,
  getCurrentUserClubManagement,
  getCurrentAthleteClubMembershipStates,
  getAthleteRegistrationsReadModel,
  getCurrentAthleteTrackAttempts,
  getCategoryResults,
  getFieldAccountingState,
  generateRecreationalLeagueSchedule,
  getDnsReview,
  getGuestRegistrationCommerceStatus,
  getGuestRegistrationBankTransferInstructions,
  listCommunicationCampaigns,
  listCommunicationTemplates,
  listCurrentUserClubMembershipRequests,
  listCurrentUserSupportTickets,
  getRegistrationCommerceStatus,
  getRegistrationImport,
  getOrganizerDashboardReadModel,
  getOrganizerFinanceDashboard,
  getOrganizerLeagueSeasonById,
  getOrganizerLeagueSeasons,
  getLegacyImportReviewWorkspace,
  getRecreationalLeagueSchedules,
  getOrganizerWorkspaceProfile,
  getOrganizerRegistrationConfiguration,
  getOrganizerRegistrations,
  getOrganizerBankTransferContext,
  getOrganizerEventPaymentSetup,
  getRegistrationBankTransferInstructions,
  getRegistrationPaymentEvidence,
  getOrganizationPaymentOnboardingContext,
  getPreRaceReadiness,
  getPracticeRaceState,
  getPlatformTestingSummary,
  listIdentityGovernanceInbox,
  listIdentityGovernanceRequests,
  deletePlatformClub,
  getOrganizerTrackGpxDownload,
  getOrganizerTrackById,
  getOrganizerTrackCommunity,
  getOrganizerEventCommunitySummaries,
  getOrganizerTracks,
  getOrganizerTrackSummaries,
  getPublicTrackGpxDownload,
  getPublicRegistrationConfiguration,
  getRaceDayState,
  getRaceStartControlState,
  getSafetyCommandState,
  getStartListManifest,
  getStravaConnectionStatus,
  getTimingSessionDetail,
  getTimingFleetState,
  getWorkforceLogisticsState,
  finishRace,
  isApiHttpError,
  notFound,
  loadAccountContextForAccessToken,
  loadServerEnv,
  materializeRecreationalLeagueSchedule,
  joinCurrentAthleteClub,
  inviteSiteAdministrator,
  leaveCurrentAthleteClub,
  listPlatformAdministrators,
  listPlatformOrganizations,
  listPlatformSupportTickets,
  listOrganizationRoles,
  listTrackAttemptsForSuperAdmin,
  listOrganizationTeam,
  parseRequestedRoles,
  publishCategoryResults,
  publishOrganizerLeagueSeason,
  publishOrganizerLeagueSeasonRaces,
  publishOrganizerTrackVersion,
  promoteNextWaitlistRegistration,
  publishRegistrationConfiguration,
  freezeStartListManifest,
  publishTimingPlan,
  refreshBrowserSession,
  refreshTrackAttemptEvidenceAsSuperAdmin,
  registerTimingFleetDevice,
  recordPreRaceRehearsal,
  recordParticipantStatus,
  createManualResultTimingObservation,
  recordCheckpointOperation,
  recordCutoffAction,
  recordRaceStartEvent,
  recordSharedPunch,
  recordInventoryMovement,
  recordRegistrationBankPayment,
  recordRegistrationDeskPayment,
  unmarkRegistrationDeskPayment,
  appendSafetyIncidentEvent,
  resolveResultAnomaly,
  resolveResultComplaint,
  reopenStartList,
  unpublishOrganizerTrackVersion,
  readBearerToken,
  requestAthleteProfileClaimEmail,
  requestBrowserPasswordReset,
  requestCurrentUserPasswordReset,
  reportRegistrationBankTransfer,
  reportGuestRegistrationBankTransfer,
  reviewRegistrationPaymentEvidence,
  revisePunchEvent,
  recomputeCategoryResults,
  recordPunch,
  resetPracticeRace,
  resetOrganizationAccountPassword,
  removeEventFavorite,
  removeAllOrganizerRegistrations,
  removeOrganizerRegistration,
  removeClubMember,
  removeOwnEventReviewComment,
  removeOrganizerTrackReview,
  removeOrganizerTrackReviewComment,
  removeOwnTrackReviewComment,
  resendSignupVerificationEmail,
  replyToCurrentUserSupportTicket,
  replyToPlatformSupportTicket,
  resolveRequestSession,
  scopePlatformSupportSession,
  reviewTrackAttemptAsSuperAdmin,
  runPaymentReconciliation,
  saveTimingDevice,
  saveOrganizerBankTransferProfile,
  confirmOrganizerEventPaymentSetup,
  saveOrganizationRole,
  saveTimingProviderConnection,
  saveCommunicationTemplate,
  setCurrentAthletePrimaryClub,
  scheduleCommunicationCampaign,
  signInBrowserSession,
  signUpUsernameBrowserSession,
  signOutBrowserSession,
  signoffFieldAccounting,
  assignPracticeRaceBibs,
  submitRegistrationPaymentEvidence,
  submitEventPhotoSubmissions,
  submitCurrentUserClubAdminRequest,
  submitTrackConditionReport,
  submitTrackAttempt,
  transferOrganizationOwnership,
  updateCurrentUserClub,
  submitCurrentUserAthleteProfileClaim,
  addTrackReviewComment,
  setTrackReviewReaction,
  upsertEventReview,
  upsertTrackReview,
  updateCurrentUserAccountSettings,
  updateCurrentUserAccountType,
  updateClubMemberRole,
  updateCustomClubRole,
  updateOrganizerLeagueSeason,
  updateOrganizerRegistration,
  undoRegistrationCheckIn,
  updateOrganizerTrack,
  updateOrganizationAccount,
  updateOrganizerWorkspaceProfile,
  updatePlatformAthlete,
  updatePlatformClub,
  setPlatformIntegrityCheckState,
  setCurrentAthleteFavorite,
  updatePlatformSupportTicketStatus,
  updateTimingDeviceAssignment,
} from "@raceson/db";
import {
  assignOrganizerCategoryTrack,
  createOrganizerCategory,
  createOrganizerEvent,
  deleteOrganizerCategory,
  deleteOrganizerEvent,
  detachOrganizerCategoryTrack,
  getOrganizerEventById,
  getOrganizerEventEligibleClubOptions,
  getOrganizerEventPublishReadiness,
  getOrganizerEventSummaries,
  getOrganizerEvents,
  publishOrganizerEvent,
  syncOrganizerCategoryCheckpoints,
  unpublishOrganizerEvent,
  updateOrganizerCategory,
  updateOrganizerCheckpoint,
  updateOrganizerEvent,
} from "@raceson/db/organizer-events";
import {
  applyPrivateSessionHeaders,
  clearBrowserSessionCookies,
  readBrowserSessionCookies,
  requestUsesSecureCookies,
  writeBrowserSessionCookies,
} from "./browser-session.js";
import { readStravaBrowserState, resolveStravaCallbackOrigin, writeStravaBrowserState } from "./strava-browser-state.js";
import { resolveLocalTestAuthCredentials } from "./local-test-auth.js";
import { getPublicWeatherSnapshots } from "./weather-stations.js";
import { resolvePublicDiscoverRequest } from "./public-discover.js";
import { dispatchPlatformManagementRoutes } from "./routes/platform/management.js";
import { dispatchPlatformRecordRoutes } from "./routes/platform/records.js";
import { dispatchPlatformStatisticsRoutes } from "./routes/platform/statistics.js";
import { dispatchNotificationRoutes } from "./routes/notifications/index.js";
import { dispatchEventEmailSettingsRoutes } from "./routes/communications/settings.js";
import {
  isPublicRaceProjectionPath,
  resolvePublicRaceProjectionRequest,
} from "./public-races.js";
import {
  isPublicPlatformSummaryPath,
  resolvePublicPlatformSummaryRequest,
} from "./public-platform-summary.js";
import {
  isPublicAthleteProjectionPath,
  resolvePublicAthleteProjectionRequest,
} from "./public-athletes.js";
import {
  isPublicCurrentResultsPath,
  isPublicLeagueClubStandingsPath,
  resolvePublicCurrentResultsRequest,
  resolvePublicLeagueClubStandingsRequest,
} from "./public-result-projections.js";
import {
  applyVerifiedStripeWebhook,
  createStripeOrganizationOnboardingLink,
  createStripeGuestRegistrationCheckout,
  createStripeRegistrationCheckout,
  createStripeRegistrationRefund,
  refreshStripeOrganizationPaymentAccount,
  verifyStripeWebhook,
} from "./stripe-payments.js";
import { resolveBrowserCheckoutReturn } from "./checkout-return.js";
import {
  authorizeGitHubWorkflowDispatch,
  isStagingWorkflowHost,
} from "./routes/workflows/dispatch.js";

let env: ReturnType<typeof loadServerEnv>;

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;
type Request = IncomingMessage;
type Response = ServerResponse<IncomingMessage>;
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
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

const isoBirthDateSchema = z.string().refine(isValidPastIsoDate, "Enter a valid date of birth.");
const countryCodeSchema = z.string().trim().regex(/^[A-Za-z]{2}$/, "Choose a valid country.");
const publicHttpUrlSchema = z.string().trim().url().max(2048).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "Use a valid http or https URL.");
const publicImageReferenceSchema = z.string().trim().min(1).max(2048).refine((value) => (
  (value.startsWith("/") && !value.startsWith("//"))
  || publicHttpUrlSchema.safeParse(value).success
), "Use a public http(s) URL or a RacesOn asset path.");
const profileAvatarUrlSchema = z.string().trim().max(2048).refine(
  isAllowedProfileAvatarUrl,
  "Use a valid profile picture URL or RacesOn avatar.",
);
const idempotencyKeySchema = z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const workflowDispatchSchema = z.object({
  limit: z.number().int().min(1).max(25).default(20),
});
const organizerInteractionSchema = z.object({
  version: z.literal(1),
  name: z.enum(["event_open", "event_editor_open"]),
  source: z.enum(["dashboard", "events_list", "event_detail"]),
  target: z.enum(["event", "locations", "overview"]).optional(),
  cacheState: z.enum(["fresh", "stale", "fetching", "missing"]),
  device: z.enum(["mobile", "desktop"]),
  connection: z.enum(["slow-2g", "2g", "3g", "4g", "unknown"]),
  durationMs: z.number().int().min(0).max(120_000),
  apiMs: z.number().int().min(0).max(120_000).optional(),
  postApiRenderMs: z.number().int().min(0).max(120_000).optional(),
}).strict();

function parseIdempotencyKey(req: Request) {
  const rawIdempotencyKey = req.headers["idempotency-key"];
  return idempotencyKeySchema.parse(
    Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey,
  );
}

function parseOptionalIdempotencyKey(req: Request) {
  const rawIdempotencyKey = req.headers["idempotency-key"];
  if (rawIdempotencyKey === undefined) return undefined;
  return idempotencyKeySchema.parse(
    Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey,
  );
}

function parseOrganizerWorkspaceOrganizationId(url: URL) {
  const requestedOrganizationId = url.searchParams.get("organization");
  return requestedOrganizationId
    ? z.string().uuid().parse(requestedOrganizationId)
    : null;
}

function parseGuestRegistrationAccessToken(req: Request) {
  const rawToken = req.headers["x-guest-registration-token"];
  return z.string().trim().min(32).max(256).parse(
    Array.isArray(rawToken) ? rawToken[0] : rawToken,
  );
}

const bootstrapSchema = z.object({
  roles: z.array(z.enum(["athlete", "organizer", "timer"])).min(1).default(["athlete"]),
  displayName: z.string().trim().min(1),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  dateOfBirth: isoBirthDateSchema.nullable().optional(),
  gender: z.enum(["F", "M", "U"]).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  shirtSize: z.string().trim().max(12).nullable().optional(),
  locale: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional(),
  createAthleteProfile: z.boolean().optional(),
});

const accountDeletionSchema = z.object({
  confirmation: z.string().trim().min(1),
});

const platformAdministratorInviteSchema = z.object({
  email: z.string().trim().email().max(254),
});

const accountSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().max(80).nullable().optional(),
  lastName: z.string().trim().max(80).nullable().optional(),
  dateOfBirth: isoBirthDateSchema.nullable().optional(),
  gender: z.enum(["F", "M", "U"]).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  countryCode: countryCodeSchema.nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(1200).nullable().optional(),
  websiteUrl: publicHttpUrlSchema.nullable().optional(),
  instagramUrl: publicHttpUrlSchema.nullable().optional(),
  facebookUrl: publicHttpUrlSchema.nullable().optional(),
  linkedinUrl: publicHttpUrlSchema.nullable().optional(),
  youtubeUrl: publicHttpUrlSchema.nullable().optional(),
  tiktokUrl: publicHttpUrlSchema.nullable().optional(),
  xUrl: publicHttpUrlSchema.nullable().optional(),
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
  shirtSize: z.string().trim().max(12).nullable().optional(),
  mealPreference: z.string().trim().max(80).nullable().optional(),
  locale: z.string().trim().max(24).nullable().optional(),
  timezone: z.string().trim().max(80).nullable().optional(),
  avatarUrl: profileAvatarUrlSchema.nullable().optional(),
  coverImageUrl: profileAvatarUrlSchema.nullable().optional(),
  organizerSetupEnabled: z.boolean().optional(),
});

const accountTypeSchema = z.object({
  accountType: z.enum(["athlete", "athlete-organizer", "organizer"]),
});

const organizationPermissionSchema = z.enum([
  "organization.manage",
  "team.manage",
  "events.manage",
  "entrants.manage",
  "race_day.manage",
  "checkpoint_timing.enter",
  "results.manage",
  "communications.manage",
  "safety.manage",
  "logistics.manage",
  "finance.manage",
]);

const eventPermissionSchema = z.enum([
  "events.manage",
  "entrants.manage",
  "race_day.manage",
  "checkpoint_timing.enter",
  "results.manage",
  "communications.manage",
  "safety.manage",
  "logistics.manage",
]);

const organizationAccountTemplateSchema = z.enum([
  "organization-admin",
  "race-day-operator",
  "checkpoint-timer",
]);

const createOrganizationAccountSchema = z.object({
  accountMode: z.enum(["existing", "new"]).optional(),
  templateKey: organizationAccountTemplateSchema.nullable().optional(),
  customRoleId: z.string().uuid().nullable().optional(),
  membershipType: z.enum(["permanent", "temporary"]),
  displayName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320).nullable().optional(),
  username: z.string().trim().min(4).max(48).nullable().optional(),
  initialPassword: z.string().min(8).max(256).nullable().optional(),
  permissions: z.array(organizationPermissionSchema).min(1).max(11),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
}).refine(
  (input) => Boolean(input.templateKey) !== Boolean(input.customRoleId),
  "Choose either a system role or a custom role",
);

const saveOrganizationRoleSchema = z.object({
  roleKey: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,79}$/),
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(4).max(240),
  permissions: z.array(organizationPermissionSchema).min(1).max(11),
});

const organizationProfileVisibilitySchema = z.enum(["public", "members"]);

const organizationLogoImageSchema = z.string().trim().max(3_000_000).refine(
  (value) =>
    value.startsWith("data:image/png;base64,")
    || value.startsWith("data:image/jpeg;base64,")
    || value.startsWith("data:image/webp;base64,")
    || /^https?:\/\//i.test(value),
  "Choose a PNG, JPEG, or WebP image.",
);

const organizationProfileFields = {
  legalName: z.string().trim().max(200).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(1_500).nullable().optional(),
  contactEmail: z.string().trim().email().max(320).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  websiteUrl: publicHttpUrlSchema.nullable().optional(),
  instagramUrl: publicHttpUrlSchema.nullable().optional(),
  facebookUrl: publicHttpUrlSchema.nullable().optional(),
  linkedinUrl: publicHttpUrlSchema.nullable().optional(),
  youtubeUrl: publicHttpUrlSchema.nullable().optional(),
  tiktokUrl: publicHttpUrlSchema.nullable().optional(),
  xUrl: publicHttpUrlSchema.nullable().optional(),
  logoImageUrl: organizationLogoImageSchema.nullable().optional(),
  profileVisibility: organizationProfileVisibilitySchema.optional(),
  memberDirectoryVisibility: organizationProfileVisibilitySchema.optional(),
  contactDetailsVisibility: organizationProfileVisibilitySchema.optional(),
};

const createOrganizerWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  forceCreateNew: z.boolean().optional(),
  countryCode: countryCodeSchema.nullable().optional(),
  ...organizationProfileFields,
  contactEmail: z.string().trim().email().max(320),
  contactPhone: z.string().trim().min(1).max(40),
});

const updateOrganizerWorkspaceProfileSchema = z.object({
  name: z.string().trim().min(2).max(160),
  countryCode: countryCodeSchema.nullable().optional(),
  ...organizationProfileFields,
});

const deleteOrganizerWorkspaceSchema = z.object({
  confirmationName: z.string().trim().min(2).max(160),
});

const updateOrganizationAccountSchema = z.object({
  templateKey: organizationAccountTemplateSchema.nullable().optional(),
  customRoleId: z.string().uuid().nullable().optional(),
  displayName: z.string().trim().min(2).max(120),
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  username: z.string().trim().min(4).max(48).nullable().optional(),
  permissions: z.array(organizationPermissionSchema).min(1).max(11),
  status: z.enum(["active", "suspended", "removed"]),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).refine(
  (input) => Boolean(input.templateKey) !== Boolean(input.customRoleId),
  "Choose either a system role or a custom role",
);

const transferOrganizationOwnershipSchema = z.object({
  currentOwnerMembershipId: z.string().uuid(),
  newOwnerMembershipId: z.string().uuid(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

const usernameChangeSchema = z.object({
  username: z.string().trim().min(3).max(48),
  currentPassword: z.string().min(1).max(256),
});

const managedPasswordResetSchema = z.object({
  newPassword: z.string().min(8).max(256),
});

const createRegistrationSchema = z.object({
  eventCategoryId: z.string().uuid(),
  representedClubId: z.string().uuid().nullable().optional(),
  publicStartListOptIn: z.boolean().optional(),
  formVersionId: z.string().uuid(),
  answers: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/), z.unknown()),
  acceptedDocumentIds: z.array(z.string().uuid()).max(20),
});

const createGuestRegistrationSchema = z.object({
  eventCategoryId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
  dateOfBirth: isoBirthDateSchema,
  gender: z.enum(["F", "M", "U"]),
  city: z.string().trim().max(120).nullable().optional(),
  countryCode: countryCodeSchema.nullable().optional(),
  phone: z.string().trim().min(1).max(40),
  emergencyContactName: z.string().trim().min(1).max(120),
  emergencyContactPhone: z.string().trim().min(1).max(40),
  shirtSize: z.string().trim().max(12).nullable().optional(),
  publicStartListOptIn: z.boolean().optional(),
  formVersionId: z.string().uuid(),
  answers: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/), z.unknown()),
  acceptedDocumentIds: z.array(z.string().uuid()).max(20),
});

const organizerOnsiteAthleteMatchSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  dateOfBirth: isoBirthDateSchema.nullable().optional(),
});

const organizerOnsiteRegistrationSchema = z.object({
  eventCategoryId: z.string().uuid(),
  existingAthleteProfileId: z.string().uuid().nullable().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320).nullable().optional(),
  dateOfBirth: isoBirthDateSchema,
  gender: z.enum(["F", "M", "U"]),
  city: z.string().trim().max(120).nullable().optional(),
  countryCode: countryCodeSchema.nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
  bibNumber: z.string().trim().max(20).nullable().optional(),
  publicStartListOptIn: z.boolean().optional(),
  organizerAttested: z.literal(true),
});

const createPracticeRegistrationSchema = z.object({
  eventCategoryId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthYear: z.number().int().min(1900).max(new Date().getUTCFullYear()),
  gender: z.enum(["F", "M", "U"]),
  email: z.string().trim().email().max(320).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
});

const createPracticeRaceSchema = z.object({
  sourceEditionId: z.string().uuid().nullable().optional(),
});

// Legacy clients may send offerMinutes; it is ignored. Entries do not expire.
const promoteWaitlistSchema = z.object({});

const createRefundSchema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(1).max(200),
  organizerNote: z.string().trim().max(2_000).nullable().optional(),
});

const organizerBankTransferProfileSchema = z.object({
  accountHolderName: z.string().trim().min(2, "Enter the legal account-holder name").max(120),
  iban: z.string().trim().min(15, "Enter an IBAN").max(42, "IBAN is too long"),
  bic: z.string().trim().max(11).nullable().optional(),
  accountHolderAddress: z.string().trim().max(160).nullable().optional(),
  accountHolderPostalCode: z.string().trim().max(24).nullable().optional(),
  accountHolderCity: z.string().trim().max(120).nullable().optional(),
  accountHolderCountryCode: z.string().trim().length(2),
  paymentModel: z.enum(["HR00", "HR01"]),
  purposeCode: z.enum(["COST", "ADMG", "SCVE", "OTHR"]),
  active: z.boolean(),
});

const organizerEventPaymentSetupSchema = z.object({
  bankTransferEnabled: z.boolean(),
  onsitePaymentEnabled: z.boolean(),
}).refine(
  (value) => value.bankTransferEnabled || value.onsitePaymentEnabled,
  { message: "Enable at least one payment method" },
);

const reportBankTransferSchema = z.object({
  note: z.string().trim().max(1_000).nullable().optional(),
});

const recordBankPaymentSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000),
  currency: z.string().trim().length(3),
  paidAt: z.string().datetime({ offset: true }),
  bankReference: z.string().trim().max(200).nullable().optional(),
  reason: z.string().trim().min(3).max(1_000),
});

const registrationFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  label: z.string().trim().min(1).max(160),
  type: z.enum([
    "text",
    "textarea",
    "number",
    "boolean",
    "select",
    "multiselect",
    "date",
    "email",
    "phone",
  ]),
  helpText: z.string().trim().max(500).nullable().optional(),
  placeholder: z.string().trim().max(160).nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(1).max(40),
  options: z.array(z.union([z.string(), z.number(), z.boolean()])).max(100).optional(),
  validation: z.record(z.string(), z.unknown()).optional(),
});

const registrationLegalDocumentSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  title: z.string().trim().min(1).max(200),
  bodyMarkdown: z.string().trim().min(1).max(100_000),
  locale: z.string().trim().min(2).max(24).nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(1).max(20),
});

const publishRegistrationConfigurationSchema = z.object({
  versionLabel: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  locale: z.string().trim().min(2).max(24),
  fields: z.array(registrationFieldSchema).max(40),
  documents: z.array(registrationLegalDocumentSchema).min(1).max(20),
});

const cancelOrganizerRegistrationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const sportCodeSchema = z.enum(SPORT_CODES);
const eventActivityTypeSchema = z.enum(EVENT_ACTIVITY_TYPES);

const createClubSchema = z.object({
  clubName: z.string().trim().min(1).max(120),
  clubHandle: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  clubCity: z.string().trim().min(1).max(120),
  clubRegion: z.string().trim().max(120).optional().default(""),
  clubCountry: z.string().trim().length(2),
  clubPresident: z.string().trim().max(120),
  clubDescription: z.string().trim().min(1).max(2000),
  clubFoundedYear: z.number().int().min(1800).max(2100).nullable().optional(),
  mainSport: z.string().trim().max(120).nullable().optional(),
  sportCodes: z.array(sportCodeSchema).min(1).max(SPORT_CODES.length).optional(),
  primarySportCode: sportCodeSchema.optional(),
  clubType: z.string().trim().max(120).nullable().optional(),
  officiallyRegistered: z.boolean().optional(),
  websiteUrl: z.string().trim().max(2048).nullable().optional(),
  instagramUrl: z.string().trim().max(2048).nullable().optional(),
  facebookUrl: z.string().trim().max(2048).nullable().optional(),
  contactEmail: z.string().trim().email().max(320).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  clubTrainingDays: z.array(z.string().trim().min(1).max(12)).max(7).optional(),
  clubHasRegularTraining: z.boolean().optional(),
  clubTrainingLocation: z.string().trim().max(160).nullable().optional(),
  clubTrainingNote: z.string().trim().max(240).nullable().optional(),
  clubPrivacy: z.enum(["public", "private", "invite_only"]).optional(),
  requiresApproval: z.boolean().optional(),
  clubIconKey: z.string().trim().max(40).nullable().optional(),
  clubColorKey: z.string().trim().max(40).nullable().optional(),
  clubLogoUrl: z.string().trim().max(2048).url("Enter a valid club logo URL.").nullable().optional(),
  clubCoverUrl: z.string().trim().max(2048).url("Enter a valid club cover URL.").nullable().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const updateClubSchema = createClubSchema.omit({
  clubHandle: true,
  idempotencyKey: true,
}).extend({
  clubCity: z.string().trim().max(120),
  clubPresident: z.string().trim().max(120),
  clubDescription: z.string().trim().max(2000),
});

const clubMembershipDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

const trackSlugSchema = z.string().trim().min(1).max(160).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Invalid route identifier",
);

const eventSlugSchema = z.string().trim().min(1).max(180).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Invalid race identifier",
);

const athleteFavoriteSchema = z.object({
  kind: z.enum(["athlete", "club"]),
  slug: eventSlugSchema,
  following: z.boolean(),
});

const submitTrackConditionReportSchema = z
  .object({
    status: z.enum(["good", "caution", "warning", "closed"]),
    title: z.string().trim().max(120).nullable().optional(),
    note: z.string().trim().min(1).max(2_000),
    cautionType: z.string().trim().max(80).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    distKm: z.number().min(0).max(2_000).nullable().optional(),
    elev: z.number().min(-500).max(10_000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.lat == null) !== (value.lng == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Route coordinates must include both latitude and longitude",
      });
    }
  });

const submitTrackReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(1).max(3_000),
  difficulty: z.string().trim().max(80).nullable().optional(),
  terrainLabels: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  navigationQuality: z.string().trim().max(80).nullable().optional(),
  bestForTags: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
});

const submitEventReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(2).max(3_000),
});

const submitTrackAttemptSchema = z.object({
  gpxFileName: z.string().trim().min(1).max(160),
  gpxXml: z.string().min(1).max(4 * 1024 * 1024),
});

const stravaAuthorizeSchema = z.object({
  returnPath: z.string().trim().max(500).nullable().optional(),
});

const trackAttemptStatusSchema = z.enum(["draft", "submitted", "verified", "rejected"]);

const reviewTrackAttemptSchema = z.object({
  decision: z.enum(["verified", "rejected"]),
  reviewNote: z.string().trim().max(2_000).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  elapsedTimeMs: z.number().int().positive().max(30 * 24 * 60 * 60 * 1_000).nullable().optional(),
  activityName: z.string().trim().max(200).nullable().optional(),
  distanceKm: z.number().positive().max(2_000).nullable().optional(),
  elevationGainM: z.number().nonnegative().max(100_000).nullable().optional(),
}).superRefine((value, context) => {
  if (value.decision === "verified" && (!value.startedAt || !value.elapsedTimeMs)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Verified attempts require a start time and elapsed time.",
    });
  }
  if (value.decision === "rejected" && !value.reviewNote?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Rejected attempts require a reason.",
    });
  }
});

const trackReviewReactionSchema = z.object({
  reaction: z.enum(["helpful", "not_helpful"]).nullable(),
});

const trackReviewCommentSchema = z.object({
  body: z.string().trim().min(2).max(2_000),
});

const organizerEventCommunitySummariesSchema = z.object({
  eventEditionIds: z.array(z.string().uuid()).max(100),
});

const organizerEventLocationSchema = z
  .object({
    type: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().nullable().optional(),
    place: z.string().trim().nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.lat == null) !== (value.lng == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Location coordinates must include both latitude and longitude",
      });
    }
  });

const organizerEventTimelineItemSchema = z.object({
  time: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

const organizerEventSchema = z
  .object({
    name: z.string().trim().min(1),
    editionLabel: z.string().trim().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    sportCodes: z.array(sportCodeSchema).min(1).max(SPORT_CODES.length).optional(),
    primarySportCode: sportCodeSchema.optional(),
    activityType: eventActivityTypeSchema.optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    startDate: z.string().trim().min(1),
    endDate: z.string().trim().nullable().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    registrationOpenAt: z.string().datetime({ offset: true }).nullable().optional(),
    registrationCloseAt: z.string().datetime({ offset: true }).nullable().optional(),
    locationName: z.string().trim().nullable().optional(),
    description: z.string().trim().nullable().optional(),
    aboutText: z.string().trim().nullable().optional(),
    organizerRules: z.string().trim().max(20_000).nullable().optional(),
    publicVisibility: z.enum(["private", "public", "club_members"]).optional(),
    registrationAccess: z.enum(["open", "club_members"]).optional(),
    eligibleClubIds: z.array(z.string().uuid()).max(100).optional(),
    coverImageUrl: publicImageReferenceSchema.nullable().optional(),
    websiteUrl: z.string().trim().nullable().optional(),
    instagramUrl: z.string().trim().nullable().optional(),
    facebookUrl: z.string().trim().nullable().optional(),
    generalTimeline: z.array(organizerEventTimelineItemSchema).optional(),
    locations: z.array(organizerEventLocationSchema).optional(),
    status: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Race end date cannot be before the start date",
      });
    }
    if (
      value.registrationOpenAt
      && value.registrationCloseAt
      && value.registrationOpenAt >= value.registrationCloseAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registration must close after it opens",
      });
    }
    if (
      value.primarySportCode
      && value.sportCodes
      && !value.sportCodes.includes(value.primarySportCode)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primarySportCode"],
        message: "Primary sport must be included in the race sports",
      });
    }
    if (value.registrationAccess === "club_members" && !value.eligibleClubIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eligibleClubIds"],
        message: "Select at least one eligible club",
      });
    }
    if (value.publicVisibility === "club_members" && value.registrationAccess !== "club_members") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationAccess"],
        message: "Club-members discovery requires club-members registration access",
      });
    }
  });

const organizerEventUpdateSchema = z
  .object({
    seriesId: z.string().uuid(),
    sportCodes: z.array(sportCodeSchema).min(1).max(SPORT_CODES.length).optional(),
    primarySportCode: sportCodeSchema.optional(),
    activityType: eventActivityTypeSchema.optional(),
    name: z.string().trim().min(1).optional(),
    editionLabel: z.string().trim().nullable().optional(),
    countryCode: countryCodeSchema.nullable().optional(),
    startDate: z.string().trim().min(1).optional(),
    endDate: z.string().trim().nullable().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    registrationOpenAt: z.string().datetime({ offset: true }).nullable().optional(),
    registrationCloseAt: z.string().datetime({ offset: true }).nullable().optional(),
    locationName: z.string().trim().nullable().optional(),
    description: z.string().trim().nullable().optional(),
    aboutText: z.string().trim().nullable().optional(),
    organizerRules: z.string().trim().max(20_000).nullable().optional(),
    publicVisibility: z.enum(["private", "public", "club_members"]).optional(),
    registrationAccess: z.enum(["open", "club_members"]).optional(),
    eligibleClubIds: z.array(z.string().uuid()).max(100).optional(),
    coverImageUrl: publicImageReferenceSchema.nullable().optional(),
    websiteUrl: z.string().trim().nullable().optional(),
    instagramUrl: z.string().trim().nullable().optional(),
    facebookUrl: z.string().trim().nullable().optional(),
    generalTimeline: z.array(organizerEventTimelineItemSchema).optional(),
    locations: z.array(organizerEventLocationSchema).optional(),
    status: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Race end date cannot be before the start date",
      });
    }
    if (
      value.registrationOpenAt
      && value.registrationCloseAt
      && value.registrationOpenAt >= value.registrationCloseAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registration must close after it opens",
      });
    }
    if (
      value.primarySportCode
      && value.sportCodes
      && !value.sportCodes.includes(value.primarySportCode)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primarySportCode"],
        message: "Primary sport must be included in the race sports",
      });
    }
    if (value.registrationAccess === "club_members" && !value.eligibleClubIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eligibleClubIds"],
        message: "Select at least one eligible club",
      });
    }
    if (value.publicVisibility === "club_members" && value.registrationAccess !== "club_members") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registrationAccess"],
        message: "Club-members discovery requires club-members registration access",
      });
    }
  });

const publishOrganizerEventSchema = z.object({
  acknowledgedBlockerKeys: z
    .array(z.string().trim().min(3).max(120))
    .max(100)
    .optional(),
});

const rankingSexBucketSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  gender: z.enum(["F", "M"]),
});

const rankingAgeBucketSchema = z
  .object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    minAge: z.number().min(0),
    maxAge: z.number().min(0).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.maxAge != null && value.maxAge < value.minAge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Age bucket maxAge must be greater than or equal to minAge",
      });
    }
  });

const rankingClassificationSchema = z
  .object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    gender: z.enum(["F", "M"]).nullable(),
    minimumAge: z.number().min(0).max(120).nullable(),
    maximumAge: z.number().min(0).max(120).nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.minimumAge != null
      && value.maximumAge != null
      && value.maximumAge < value.minimumAge
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Race category maximumAge must be greater than or equal to minimumAge",
      });
    }
  });

const rankingConfigSchema = z.object({
  overall: z.object({
    enabled: z.literal(true),
  }),
  sex: z.object({
    enabled: z.boolean(),
    buckets: z.array(rankingSexBucketSchema).min(2),
  }),
  age: z.object({
    enabled: z.boolean(),
    buckets: z.array(rankingAgeBucketSchema),
  }),
  classifications: z.array(rankingClassificationSchema).max(50).optional(),
  team: z.object({
    enabled: z.boolean(),
    mode: z.literal("club"),
    label: z.string().trim().min(1),
    scoringMethod: z.literal("best_three_by_place"),
    scoringCount: z.number().int().min(1).max(10),
  }),
});

const organizerCategoryFields = {
  name: z.string().trim().min(1),
  sportCode: sportCodeSchema.optional(),
  categoryType: z.enum(["competitive", "informative"]).optional(),
  courseFormat: z.enum(["standard", "laps"]).optional(),
  lapCount: z.number().int().min(1).max(100).optional(),
  rankingConfig: rankingConfigSchema.nullable().optional(),
  coverImageUrl: publicHttpUrlSchema.nullable().optional(),
  distanceKm: z.number().nullable().optional(),
  elevationGainM: z.number().int().nullable().optional(),
  capacity: z.number().int().nullable().optional(),
  feeCents: z.number().int().min(0).max(2147483647).nullable().optional(),
  feePeriods: z.array(z.object({ until: z.string().datetime({ offset: true }).nullable(), amountCents: z.number().int().min(0).max(2147483647) })).max(20).optional(),
  currency: z.string().trim().min(1).nullable().optional(),
  minimumAge: z.number().int().min(0).max(120).nullable().optional(),
  maximumAge: z.number().int().min(0).max(120).nullable().optional(),
  allowedGenders: z.array(z.enum(["F", "M", "U"])).min(1).max(3).optional(),
  eligibilityNote: z.string().trim().max(2_000).nullable().optional(),
  startAt: z.string().trim().min(1).nullable().optional(),
  parkingLabel: z.string().trim().nullable().optional(),
  organizerNotes: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  status: z.string().trim().min(1).optional(),
};

function validateOrganizerCategoryCourse(
  value: { courseFormat?: "standard" | "laps"; lapCount?: number },
  ctx: z.RefinementCtx,
) {
  const courseFormat = value.courseFormat ?? "standard";
  const lapCount = value.lapCount ?? 1;
  if (courseFormat === "standard" && lapCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lapCount"],
      message: "A standard route must use one lap",
    });
  }
  if (courseFormat === "laps" && lapCount < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lapCount"],
      message: "A lap route must use at least two laps",
    });
  }
}

const organizerCategorySchema = z
  .object(organizerCategoryFields)
  .superRefine(validateOrganizerCategoryCourse);

const organizerCategoryUpdateSchema = z
  .object({
    ...organizerCategoryFields,
    name: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.courseFormat === undefined) {
      return;
    }
    validateOrganizerCategoryCourse(value, ctx);
  });

const organizerCategoryTrackSchema = z.object({
  trackTemplateId: z.string().uuid(),
  trackVersionId: z.string().uuid().nullable().optional(),
});

const organizerCheckpointSettingsSchema = z.object({
  kind: z
    .enum([
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
    ])
    .optional(),
  typeTags: z
    .array(
      z.enum([
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
      ]),
    )
    .min(1)
    .optional(),
  visibleOnPublicPage: z.boolean().optional(),
  isTimingSplit: z.boolean().optional(),
  isWaterPoint: z.boolean().optional(),
  medicalAccess: z.boolean().optional(),
  volunteerNote: z.string().trim().nullable().optional(),
  athleteNote: z.string().trim().nullable().optional(),
});

const organizerCheckpointUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  cutoffAt: z.string().trim().min(1).nullable().optional(),
  isMandatory: z.boolean().optional(),
  settings: organizerCheckpointSettingsSchema.optional(),
});

const organizerCheckpointSyncItemSchema = z.object({
  checkpointId: z.string().uuid().nullable(),
  name: z.string().trim().min(1),
  distanceFromStartKm: z.number().min(0),
  cutoffAt: z.string().trim().min(1).nullable().optional(),
  isMandatory: z.boolean().optional(),
  settings: organizerCheckpointSettingsSchema.optional(),
});

const organizerCheckpointSyncSchema = z.object({
  checkpoints: z.array(organizerCheckpointSyncItemSchema),
});

const organizerTrackGalleryItemSchema = z.object({
  id: z.string().trim().min(1),
  imageUrl: z.string().trim().min(1),
  storagePath: z.string().trim().min(1).max(1024).nullable().optional(),
  caption: z.string().trim().nullable().optional().transform((value) => value ?? null),
  isDefault: z.boolean().optional().transform((value) => value ?? false),
});

const organizerTrackSegmentSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.enum(["climb", "descent", "flat"]),
  startKm: z.number(),
  endKm: z.number(),
  startElev: z.number(),
  endElev: z.number(),
  avgGrade: z.number(),
  difficulty: z.enum(["easy", "moderate", "hard", "extreme"]),
});

const organizerTrackCheckpointTypeValues = [
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
] as const;

const organizerTrackCheckpointTypeSchema = z.enum(organizerTrackCheckpointTypeValues);

const organizerTrackCheckpointSchema = z.object({
  name: z.string().trim().min(1),
  km: z.number(),
  elev: z.number(),
  lat: z.number(),
  lng: z.number(),
  type: organizerTrackCheckpointTypeSchema,
  typeTags: z.array(organizerTrackCheckpointTypeSchema).min(1).optional(),
});

const organizerTrackSchema = z.object({
  organizationId: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  sportCode: sportCodeSchema.optional(),
  terrainType: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  publicOverview: z.string().trim().nullable().optional(),
  locationLabel: z.string().trim().nullable().optional(),
  seasonLabel: z.string().trim().nullable().optional(),
  parkingLabel: z.string().trim().nullable().optional(),
  weatherLocationLabel: z.string().trim().nullable().optional(),
  bestTimeLabel: z.string().trim().nullable().optional(),
  surfaceSummary: z.string().trim().nullable().optional(),
  safetyNotes: z.string().trim().nullable().optional(),
  waterPointCount: z.number().int().min(0).nullable().optional(),
  segments: z.array(organizerTrackSegmentSchema).optional(),
  galleryItems: z.array(organizerTrackGalleryItemSchema).optional(),
  sourceFileName: z.string().trim().nullable().optional(),
  gpxXml: z.string().trim().min(1).nullable().optional(),
  gpxStoragePath: z.string().trim().min(1).max(1024).nullable().optional(),
  routePoints: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .min(2)
    .optional(),
  elevationPoints: z.array(
    z.object({
      distKm: z.number(),
      elev: z.number(),
      grade: z.number().nullable().optional(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
    }),
  ).optional(),
  checkpoints: z.array(organizerTrackCheckpointSchema),
  distanceKm: z.number().nullable().optional(),
  elevationGainM: z.number().int().nullable().optional(),
  elevationLossM: z.number().int().nullable().optional(),
  difficultyLevel: z.number().int().min(1).max(5).nullable().optional(),
}).superRefine((value, context) => {
  if (!value.gpxStoragePath && (!value.routePoints || value.routePoints.length < 2)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["gpxStoragePath"],
      message: "GPX upload or at least two route points are required",
    });
  }
});

const organizerTrackUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  sportCode: sportCodeSchema.optional(),
  terrainType: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  publicOverview: z.string().trim().nullable().optional(),
  locationLabel: z.string().trim().nullable().optional(),
  seasonLabel: z.string().trim().nullable().optional(),
  parkingLabel: z.string().trim().nullable().optional(),
  weatherLocationLabel: z.string().trim().nullable().optional(),
  bestTimeLabel: z.string().trim().nullable().optional(),
  surfaceSummary: z.string().trim().nullable().optional(),
  safetyNotes: z.string().trim().nullable().optional(),
  waterPointCount: z.number().int().min(0).nullable().optional(),
  segments: z.array(organizerTrackSegmentSchema).optional(),
  galleryItems: z.array(organizerTrackGalleryItemSchema).optional(),
  sourceFileName: z.string().trim().nullable().optional(),
  gpxXml: z.string().trim().min(1).nullable().optional(),
  gpxStoragePath: z.string().trim().min(1).max(1024).nullable().optional(),
  routePoints: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .min(2)
    .optional(),
  elevationPoints: z.array(
    z.object({
      distKm: z.number(),
      elev: z.number(),
      grade: z.number().nullable().optional(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
    }),
  ).optional(),
  checkpoints: z.array(organizerTrackCheckpointSchema).optional(),
  distanceKm: z.number().nullable().optional(),
  elevationGainM: z.number().int().nullable().optional(),
  elevationLossM: z.number().int().nullable().optional(),
  difficultyLevel: z.number().int().min(1).max(5).nullable().optional(),
});

const organizerLeagueScoringRulesSchema = z.object({
  name: z.string().trim().nullable().optional(),
  pointsTable: z.array(z.number().min(0).max(10_000)).min(1).max(500).optional(),
  fieldSizeProfile: z.enum(["small_up_to_50", "medium_50_200", "large_200_plus", "custom"]).nullable().optional(),
  participationPoints: z.number().min(0).max(10_000).nullable().optional(),
  scoringMethod: z.enum(["geometric", "hybrid", "custom"]).nullable().optional(),
  scoringParameters: z.object({
    maximumPoints: z.number().int().min(2).max(10_000),
    expectedFinishers: z.number().int().min(2).max(500),
    hybridEmphasis: z.enum(["inclusive", "balanced", "competitive"]).optional(),
  }).nullable().optional(),
  bestN: z.number().int().min(1).nullable().optional(),
  minimumRounds: z.number().int().min(1).nullable().optional(),
  tieBreakMethod: z.string().trim().nullable().optional(),
  clubScoringMode: z.string().trim().nullable().optional(),
}).superRefine((rules, context) => {
  if (
    (rules.scoringMethod === "geometric" || rules.scoringMethod === "hybrid")
    && !rules.scoringParameters
  ) {
    context.addIssue({
      code: "custom",
      path: ["scoringParameters"],
      message: "Generated scoring methods require curve parameters",
    });
  }
  if (
    rules.scoringParameters
    && rules.pointsTable
    && rules.pointsTable.length !== rules.scoringParameters.expectedFinishers
  ) {
    context.addIssue({
      code: "custom",
      path: ["pointsTable"],
      message: "The points table must match the expected number of finishers",
    });
  }
  if (
    rules.scoringParameters
    && rules.pointsTable?.[0] !== undefined
    && rules.pointsTable[0] !== rules.scoringParameters.maximumPoints
  ) {
    context.addIssue({
      code: "custom",
      path: ["pointsTable"],
      message: "First-place points must match the configured winner points",
    });
  }
  const expectedProfile = rules.fieldSizeProfile === "small_up_to_50"
    ? { places: 20, floor: 10 }
    : rules.fieldSizeProfile === "medium_50_200"
      ? { places: 50, floor: 5 }
      : rules.fieldSizeProfile === "large_200_plus"
        ? { places: 100, floor: 2 }
        : null;
  if (expectedProfile && rules.pointsTable && rules.pointsTable.length !== expectedProfile.places) {
    context.addIssue({
      code: "custom",
      path: ["pointsTable"],
      message: `The selected field profile requires ${expectedProfile.places} graded places`,
    });
  }
  if (expectedProfile && rules.participationPoints != null && rules.participationPoints !== expectedProfile.floor) {
    context.addIssue({
      code: "custom",
      path: ["participationPoints"],
      message: `The selected field profile requires a ${expectedProfile.floor}-point finisher floor`,
    });
  }
  const lastGradedScore = rules.pointsTable?.at(-1);
  if (lastGradedScore != null && (rules.participationPoints ?? 0) > lastGradedScore) {
    context.addIssue({
      code: "custom",
      path: ["participationPoints"],
      message: "Participation points cannot exceed the final graded-place score",
    });
  }
});

const organizerLeagueCompetitionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  isDefault: z.boolean().optional(),
  description: z.string().trim().nullable().optional(),
  scoringTarget: z.enum(["individual", "club"]).optional(),
  resultBasis: z.enum(["finish_place", "elapsed_time", "age_grade", "custom_points"]).optional(),
  standingsMode: z.enum(["points", "best_time", "participation", "none"]).optional(),
  scoringRules: organizerLeagueScoringRulesSchema.nullable().optional(),
  classifications: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    eligibility: z.record(z.string(), z.unknown()).optional(),
    awardDepth: z.number().int().min(1).nullable().optional(),
    isDefault: z.boolean().optional(),
  })).optional(),
});

const organizerLeagueSchema = z.object({
  organizationId: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  sportCodes: z.array(sportCodeSchema).min(1).max(SPORT_CODES.length).optional(),
  primarySportCode: sportCodeSchema.optional(),
  description: z.string().trim().nullable().optional(),
  organizerNotes: z.string().trim().max(10_000).nullable().optional(),
  organizerRules: z.string().trim().max(20_000).nullable().optional(),
  year: z.number().int().optional(),
  startsOn: z.string().date().nullable().optional(),
  endsOn: z.string().date().nullable().optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  clubScoringScope: z.enum(["combined", "per_competition"]).optional(),
  status: z.string().trim().min(1).optional(),
  scoringRules: organizerLeagueScoringRulesSchema.nullable().optional(),
  competitions: z.array(organizerLeagueCompetitionSchema).min(1).max(12).optional(),
});

const organizerLeagueUpdateSchema = organizerLeagueSchema.extend({
  leagueId: z.string().uuid(),
  seasonId: z.string().uuid().optional(),
  name: z.string().trim().min(1).optional(),
});

const organizerLeagueRoundSchema = z.object({
  eventEditionId: z.string().uuid().optional(),
  eventCategoryId: z.string().uuid().optional(),
  raceCountMismatchAcknowledged: z.boolean().optional(),
  excludedCourseIds: z.array(z.string().uuid()).max(200).optional(),
  mappings: z.array(z.object({
    competitionId: z.string().uuid(),
    eventCategoryId: z.string().uuid(),
  })).min(1).max(12).optional(),
  roundNumber: z.number().int().min(1).optional(),
  status: z.enum(["draft", "scheduled", "registration_open", "completed", "cancelled"]).optional(),
}).refine((value) => Boolean(value.eventCategoryId || value.mappings?.length), {
  message: "At least one competition race mapping is required",
});

const recreationalLeagueScheduleSchema = z.object({
  generateNow: z.boolean().optional(),
  sourceEventEditionId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  validFrom: z.string().date(),
  validUntil: z.string().date(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  localStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().trim().min(1).max(80).optional(),
  registrationOpenDaysBefore: z.number().int().min(0).max(365).nullable().optional(),
  registrationCloseMinutesBefore: z.number().int().min(0).max(10_080).optional(),
  locationName: z.string().trim().max(160).nullable().optional(),
  mappings: z.array(z.object({
    competitionId: z.string().uuid(),
    sourceEventCategoryId: z.string().uuid(),
  })).min(1).max(24),
  overrides: z.array(z.object({
    sourceDate: z.string().date(),
    action: z.enum(["skip", "cancel", "reschedule"]),
    replacementDate: z.string().date().nullable().optional(),
    replacementLocalStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })).max(100).optional(),
});

const updateRegistrationSchema = z.object({
  bibNumber: z.string().trim().nullable().optional(),
});

const assignBibSchema = z.object({
  bibNumber: z.string().trim().nullable().optional(),
});

const allocateBibsSchema = z.object({
  startNumber: z.number().int().min(1).max(9_999_999),
  prefix: z.string().trim().max(12).optional(),
  padding: z.number().int().min(0).max(8).optional(),
});

const freezeStartListSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
});

const reopenStartListSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

const timingDeviceSchema = z.object({
  fingerprint: z.string().trim().min(1).max(200),
  label: z.string().trim().max(120).nullable().optional(),
  status: z.enum(["active", "maintenance", "retired"]).optional(),
  clockOffsetMs: z.number().int().min(-3_600_000).max(3_600_000).nullable().optional(),
  batteryPercent: z.number().int().min(0).max(100).nullable().optional(),
  firmwareVersion: z.string().trim().max(120).nullable().optional(),
  health: z.record(z.unknown()).optional(),
});

const timingFleetDeviceSchema = z.object({
  fingerprint: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(120),
  deviceType: z.enum([
    "browser_workstation",
    "phone",
    "tablet",
    "chip_reader",
    "rfid_mat",
    "barcode_scanner",
    "gps_gateway",
    "import_source",
    "partner_system",
  ]),
  externalIdentity: z.string().trim().max(200).nullable().optional(),
  status: z.enum(["active", "maintenance", "retired"]).optional(),
  syncState: z.enum(["unknown", "synced", "pending", "degraded", "offline", "error"]).optional(),
  clockOffsetMs: z.number().int().min(-3_600_000).max(3_600_000).nullable().optional(),
  batteryPercent: z.number().int().min(0).max(100).nullable().optional(),
  firmwareVersion: z.string().trim().max(120).nullable().optional(),
  softwareVersion: z.string().trim().max(120).nullable().optional(),
  credentialState: z.enum(["unprovisioned", "active", "rotating", "revoked", "expired"]).optional(),
  credentialExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  health: z.record(z.unknown()).optional(),
  clientEventId: z.string().uuid(),
});

const timingDeviceAssignmentSchema = z.object({
  timingDeviceId: z.string().uuid(),
  eventCategoryId: z.string().uuid().nullable().optional(),
  checkpointId: z.string().uuid().nullable().optional(),
  allowedEventTypes: z.array(
    z.enum([
      "chip_read",
      "checkpoint_read",
      "finish_read",
      "gps_position",
      "device_status",
      "heartbeat",
      "file_row",
    ]),
  ).min(1).max(7),
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
  manifestVersion: z.number().int().positive().nullable().optional(),
  clientEventId: z.string().uuid(),
}).superRefine((value, ctx) => {
  if (value.validUntil <= value.validFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Assignment end time must be after its start time",
      path: ["validUntil"],
    });
  }
});

const timingDeviceAssignmentUpdateSchema = z.object({
  assignmentState: z.enum(["active", "suspended", "revoked", "expired"]),
  note: z.string().trim().min(1).max(2_000),
  clientEventId: z.string().uuid(),
});

const timingFleetDeviceEventSchema = z.object({
  actionType: z.enum([
    "health",
    "heartbeat",
    "sync",
    "maintenance",
    "activate",
    "credential_rotated",
    "credential_revoked",
    "note",
  ]),
  note: z.string().trim().min(1).max(2_000),
  payload: z.record(z.unknown()).optional(),
  clientEventId: z.string().uuid(),
});

const timingProviderConnectionSchema = z.object({
  providerType: z.enum(["chip_timing", "gps_tracking", "file_import", "partner_api"]),
  providerKey: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/),
  label: z.string().trim().min(2).max(160),
  connectionState: z.enum(["configured", "active", "degraded", "disabled"]),
  config: z.record(z.unknown()).optional(),
  credentialReference: z.string().trim().min(3).max(500),
  secretVersion: z.number().int().positive().max(1_000_000).optional(),
  webhookKeyId: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().min(1).max(2_000),
  clientEventId: z.string().uuid(),
});

const timingPlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  clockToleranceMs: z.number().int().min(100).max(60_000),
  points: z.array(z.object({
    categoryId: z.string().uuid(),
    checkpointId: z.string().uuid(),
    captureMode: z.enum(["manual", "device", "import"]),
    primaryDeviceId: z.string().uuid().nullable().optional(),
    backupMethod: z.string().trim().min(1).max(200),
    operatorLabel: z.string().trim().max(200).nullable().optional(),
  })).min(1).max(500),
});

const rehearsalSchema = z.object({
  passed: z.boolean(),
  checklist: z.object({
    manifestVerified: z.boolean(),
    clockSyncVerified: z.boolean(),
    backupCaptureVerified: z.boolean(),
    operatorBriefingComplete: z.boolean(),
    testPunchReconciled: z.boolean(),
  }),
  issues: z.array(z.unknown()).max(100).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const registrationImportPreviewSchema = z.object({
  sourceFileName: z.string().trim().max(255).nullable().optional(),
  mapping: z.record(z.string().max(120)).optional(),
  rows: z.array(z.object({
    rowNumber: z.number().int().min(1),
    firstName: z.string().max(120).optional(),
    lastName: z.string().max(120).optional(),
    email: z.string().max(320).optional(),
    dateOfBirth: z.string().max(40).optional(),
    gender: z.string().max(40).optional(),
    category: z.string().max(200).optional(),
    categoryId: z.string().max(200).optional(),
    club: z.string().max(200).optional(),
    clubId: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    countryCode: z.string().max(10).optional(),
    phone: z.string().max(80).optional(),
    emergencyContactName: z.string().max(160).optional(),
    emergencyContactPhone: z.string().max(80).optional(),
  })).min(1).max(2_000),
});

const communicationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  communicationType: z.enum(["transactional", "operational"]),
  subjectTemplate: z.string().trim().min(1).max(200),
  bodyMarkdown: z.string().trim().min(1).max(20_000),
});

const communicationCampaignSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  registrationStatuses: z.array(
    z.enum(["pending", "confirmed", "waitlisted", "offered", "cancelled"]),
  ).min(1).max(5),
  eventCategoryIds: z.array(z.string().uuid()).max(100).optional(),
  scheduledAt: z.string().datetime({ offset: true }),
});

const communicationCampaignCancelSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

const raceStartEventSchema = z.object({
  eventType: z.enum(["actual_start", "restart", "delay", "cancelled", "abandoned"]),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  plannedAt: z.string().datetime({ offset: true }).nullable().optional(),
  startMethod: z.enum([
    "mass_gun",
    "chip",
    "rolling",
    "individual_interval",
    "manual_import",
    "neutralized",
  ]).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  clientEventId: z.string().uuid(),
}).superRefine((input, context) => {
  if (input.eventType !== "actual_start" && !input.occurredAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Action time is required for corrections and status changes.",
      path: ["occurredAt"],
    });
  }
});

const finishRaceSchema = z.object({
  categoryIds: z.array(z.string().uuid()).min(1).max(100),
  clientEventId: z.string().uuid(),
  acknowledgeUnfinishedAsDnf: z.boolean(),
  overrideReason: z.string().trim().min(3).max(2000).optional(),
});

const participantStatusSchema = z.object({
  status: z.enum([
    "not_started",
    "checked_in",
    "dns",
    "started",
    "finished",
    "dnf",
    "dsq",
    "withdrawn",
    "stopped",
    "evacuated",
    "missing",
  ]),
  effectiveAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(2000).nullable().optional(),
  clientEventId: z.string().uuid(),
  isCorrection: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const punchRevisionSchema = z.object({
  revisionType: z.enum(["resolve_registration", "correct_time", "void", "restore"]),
  reason: z.string().trim().min(1).max(2000),
  registrationId: z.string().uuid().nullable().optional(),
  effectiveRecordedAt: z.string().datetime({ offset: true }).nullable().optional(),
  clientEventId: z.string().uuid(),
});

const manualResultTimingObservationSchema = z.object({
  checkpointId: z.string().uuid(),
  recordedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(2000),
  clientEventId: z.string().uuid(),
});

const resultAnomalyResolutionSchema = z.object({
  resolutionState: z.enum(["resolved", "waived"]),
  resolutionNote: z.string().trim().min(1).max(2000),
});

const cutoffActionSchema = z.object({
  checkpointId: z.string().uuid(),
  registrationId: z.string().uuid(),
  actionType: z.enum(["warning", "grace", "stopped", "acknowledged", "transport_arranged"]),
  effectiveAt: z.string().datetime({ offset: true }),
  graceUntil: z.string().datetime({ offset: true }).nullable().optional(),
  reasonCode: z.string().trim().max(100).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  participantAcknowledged: z.boolean().optional(),
  transportPlan: z.string().trim().max(2000).nullable().optional(),
  clientEventId: z.string().uuid(),
});

const checkpointOperationSchema = z.object({
  operationState: z.enum(["open", "ready", "degraded", "closing", "closed", "reconciled"]),
  effectiveAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(2000).nullable().optional(),
  unresolvedPackage: z.record(z.unknown()).optional(),
  clientEventId: z.string().uuid(),
});

const fieldAccountingSignoffSchema = z.object({
  allowOpenMissing: z.boolean().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  clientEventId: z.string().uuid(),
});

const publicLiveSettingsSchema = z.object({
  isEnabled: z.boolean(),
  delaySeconds: z.number().int().min(0).max(3600),
  isSuppressed: z.boolean(),
  suppressionMessage: z.string().trim().max(500).nullable().optional(),
  showCheckpointAggregates: z.boolean(),
});

const createDnsReviewSchema = z.object({
  note: z.string().trim().max(2000).nullable().optional(),
  clientEventId: z.string().uuid(),
});

const safetyPlanVersionSchema = z.object({
  plan: z.record(z.unknown()),
  publicExcerpt: z.record(z.unknown()).optional(),
  activate: z.boolean().optional(),
});

const safetyIncidentTypeSchema = z.enum([
  "overdue_participant",
  "missing_participant",
  "medical",
  "injury",
  "evacuation",
  "weather",
  "course_hazard",
  "infrastructure",
  "communications",
  "security",
  "environmental",
  "other",
]);

const safetyIncidentSchema = z.object({
  eventCategoryId: z.string().uuid().nullable().optional(),
  checkpointId: z.string().uuid().nullable().optional(),
  registrationId: z.string().uuid().nullable().optional(),
  incidentType: safetyIncidentTypeSchema,
  severity: z.enum(["info", "minor", "major", "critical"]),
  title: z.string().trim().min(3).max(240),
  restrictedSummary: z.string().trim().max(4000).nullable().optional(),
  privacyClassification: z.enum(["operational", "restricted", "medical"]),
  locationLabel: z.string().trim().max(500).nullable().optional(),
  effectiveAt: z.string().datetime({ offset: true }),
  ownerUserId: z.string().uuid().nullable().optional(),
  suppressPublicLive: z.boolean().optional(),
  clientEventId: z.string().uuid(),
});

const safetyIncidentEventSchema = z.object({
  actionType: z.enum([
    "acknowledge",
    "classify",
    "action",
    "communication",
    "handoff",
    "status_reconciliation",
    "result_review",
    "resolve",
    "review",
    "close",
    "reopen",
  ]),
  toState: z.enum([
    "reported",
    "acknowledged",
    "investigating",
    "action_in_progress",
    "monitoring",
    "resolved",
    "reviewed",
    "closed",
  ]).nullable().optional(),
  note: z.string().trim().min(1).max(4000),
  payload: z.record(z.unknown()).optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  suppressPublicLive: z.boolean().nullable().optional(),
  participantStatusReconciled: z.boolean().nullable().optional(),
  resultImpactReviewed: z.boolean().nullable().optional(),
  clientEventId: z.string().uuid(),
});

const staffAssignmentStateSchema = z.enum([
  "planned",
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "replaced",
  "cancelled",
]);

const staffAssignmentSchema = z.object({
  eventCategoryId: z.string().uuid().nullable().optional(),
  checkpointId: z.string().uuid().nullable().optional(),
  staffUserId: z.string().uuid().nullable().optional(),
  displayName: z.string().trim().min(2).max(200),
  workerType: z.enum(["staff", "volunteer", "contractor"]),
  roleCode: z.string().trim().min(2).max(100),
  roleTitle: z.string().trim().min(2).max(200),
  accessScope: z.enum(["operations", "registration", "timing", "safety", "logistics", "communications"]),
  permissionKeys: z.array(eventPermissionSchema).min(1).max(8),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  leadUserId: z.string().uuid().nullable().optional(),
  briefingRequired: z.boolean().optional(),
  instructions: z.string().trim().max(4000).nullable().optional(),
  replacementForAssignmentId: z.string().uuid().nullable().optional(),
  clientEventId: z.string().uuid(),
});

const staffAssignmentEventSchema = z.object({
  actionType: z.enum(["confirm", "briefing_acknowledgement", "check_in", "complete", "no_show", "replace", "cancel", "note"]),
  toState: staffAssignmentStateSchema.nullable().optional(),
  note: z.string().trim().min(1).max(4000),
  payload: z.record(z.unknown()).optional(),
  clientEventId: z.string().uuid(),
});

const operationsTaskStateSchema = z.enum(["planned", "ready", "in_progress", "blocked", "done", "waived"]);

const operationsTaskSchema = z.object({
  eventCategoryId: z.string().uuid().nullable().optional(),
  checkpointId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(3).max(240),
  taskType: z.string().trim().min(2).max(100),
  criticality: z.enum(["routine", "important", "critical"]),
  ownerAssignmentId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  evidenceRequired: z.boolean().optional(),
  dependencyTaskIds: z.array(z.string().uuid()).max(50).optional(),
  clientEventId: z.string().uuid(),
});

const operationsTaskEventSchema = z.object({
  actionType: z.enum(["ready", "start", "block", "complete", "waive", "reopen", "note"]),
  toState: operationsTaskStateSchema.nullable().optional(),
  note: z.string().trim().min(1).max(4000),
  evidence: z.record(z.unknown()).optional(),
  clientEventId: z.string().uuid(),
});

const eventInventoryItemSchema = z.object({
  itemName: z.string().trim().min(2).max(200),
  itemCategory: z.string().trim().min(2).max(100),
  unitLabel: z.string().trim().min(1).max(50),
  isCritical: z.boolean().optional(),
  reorderThreshold: z.number().nonnegative().max(1_000_000).optional(),
  initialQuantity: z.number().nonnegative().max(1_000_000),
  clientEventId: z.string().uuid(),
});

const inventoryMovementSchema = z.object({
  movementType: z.enum(["allocate", "release", "dispatch", "return", "consume", "damage", "restock", "adjust_loss"]),
  quantity: z.number().positive().max(1_000_000),
  checkpointId: z.string().uuid().nullable().optional(),
  locationLabel: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().min(1).max(2000),
  clientEventId: z.string().uuid(),
});

const checkInSchema = z.object({
  locationLabel: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
});

const submitPaymentEvidenceSchema = z.object({
  objectPath: z.string().trim().min(1).max(500),
  originalFileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  amountCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
});

const submitEventPhotosSchema = z.object({
  eventCategoryId: z.string().uuid(),
  photos: z.array(z.object({
    objectPath: z.string().trim().min(1).max(500),
    originalFileName: z.string().trim().min(1).max(255),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  })).min(1).max(6),
});

const reviewPaymentEvidenceSchema = z.object({
  reviewStatus: z.enum(["verified", "rejected"]),
  organizerNote: z.string().trim().max(1000).nullable().optional(),
});

const createTimingSessionSchema = z.object({
  eventEditionId: z.string().uuid(),
  eventCategoryId: z.string().uuid().nullable().optional(),
  checkpointId: z.string().uuid().nullable().optional(),
  mode: z.enum(["online", "offline_buffered"]).optional(),
});

const recordPunchSchema = z
  .object({
    timingSessionId: z.string().uuid(),
    checkpointId: z.string().uuid(),
    clientEventId: z.string().uuid(),
    recordedAt: z.string().datetime({ offset: true }),
    registrationId: z.string().uuid().nullable().optional(),
    bibNumber: z.string().trim().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.registrationId && !value.bibNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either registrationId or bibNumber",
      });
    }
  });

const recordSharedPunchSchema = z.object({
  eventEditionId: z.string().uuid(),
  checkpointIds: z.array(z.string().uuid()).min(1).max(100),
  clientEventId: z.string().uuid(),
  recordedAt: z.string().datetime({ offset: true }),
  bibNumber: z.string().trim().min(1).max(40),
});

const publishResultsSchema = z.object({
  resultRunId: z.string().uuid().nullable().optional(),
  publicationState: z.enum(["provisional", "official", "corrected"]).optional(),
  changeNote: z.string().trim().nullable().optional(),
  clientEventId: z.string().uuid(),
});

const createResultComplaintSchema = z.object({
  registrationId: z.string().uuid().nullable().optional(),
  bibNumber: z.string().trim().min(1).max(40).nullable().optional(),
  complainantName: z.string().trim().min(2).max(160),
  complaintText: z.string().trim().min(3).max(2000),
});

const resolveResultComplaintSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
  resolutionNote: z.string().trim().min(3).max(2000),
});

const publicWeatherSnapshotsSchema = z.object({
  locations: z.array(
    z.object({
      id: z.string().trim().min(1),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
  ).min(1).max(8),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const publicAuthEmailSchema = z.object({
  email: z.string().trim().email().max(320),
});

const publicAuthRecoverySchema = z.object({
  identifier: z.string().trim().min(3).max(320),
});

const usernameAccountAvailabilitySchema = z.object({
  username: z.string().trim().min(3).max(48),
  email: z.string().trim().email().max(320).nullable().optional(),
});

const pendingBrowserSignUpSchema = z.object({
  userId: z.string().uuid(),
  cancelToken: z.string().uuid(),
});

const passwordSignInSchema = z.object({
  identifier: z.string().trim().min(3).max(320).optional(),
  email: z.string().trim().min(3).max(320).optional(),
  password: z.string().min(4).max(256),
}).refine((value) => Boolean(value.identifier || value.email), {
  message: "Email or username is required",
});

export const usernameAccountSignUpSchema = z.object({
  username: z.string().trim().min(3).max(48),
  email: z.string().trim().email().max(320).nullable().optional(),
  password: z.string().min(8).max(256),
  displayName: z.string().trim().min(2).max(120),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  roles: z.array(z.enum(["athlete", "organizer", "timer"])).min(1).max(3),
  dateOfBirth: isoBirthDateSchema.nullable().optional(),
  gender: z.enum(["F", "M", "U"]).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  shirtSize: z.string().trim().max(12).nullable().optional(),
  locale: z.string().trim().max(24).optional(),
  timezone: z.string().trim().max(80).optional(),
  claimAthleteProfileId: z.string().uuid().nullable().optional(),
  nextPath: z.string().trim().max(2_048).nullable().optional(),
});

export const sponsorAccountSignUpSchema = usernameAccountSignUpSchema.extend({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(72),
  roles: z.tuple([z.literal("sponsor")]),
  claimAthleteProfileId: z.never().optional(),
  dateOfBirth: z.never().optional(),
  gender: z.never().optional(),
  shirtSize: z.never().optional(),
}).transform(body => ({
  ...body,
  nextPath: body.nextPath && /^\/rewards(?:[/?#]|$)/.test(body.nextPath)
    && !body.nextPath.includes("\\") ? body.nextPath : "/rewards",
}));

const athleteProfileMatchSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: isoBirthDateSchema,
  email: z.string().trim().email().max(320).nullable().optional(),
});

const athleteProfileClaimSlugSchema = z.string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a valid athlete profile slug.");

const athleteProfileEmailClaimSchema = z.object({
  athleteSlug: athleteProfileClaimSlugSchema,
});

const clubAdminRoleRequestSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
  requestedRoleKey: z.enum(["administrator", "owner"]).default("administrator"),
});

const clubPermissionSchema = z.enum([
  "club.profile.manage",
  "club.settings.manage",
  "club.members.view",
  "club.members.manage",
  "club.roles.manage",
  "club.activities.manage",
  "club.content.manage",
  "club.analytics.view",
  "club.audit.view",
]);

const clubMemberRoleSchema = z.object({
  roleId: z.string().uuid(),
});

const customClubRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.array(clubPermissionSchema).min(1).max(9),
});

const clubActivitySchema = z.object({
  type: z.enum(["training", "meetup", "social", "volunteer", "other"]),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  location: z.string().trim().max(240).nullable().optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  visibility: z.enum(["public", "members"]),
  status: z.enum(["draft", "published"]).optional(),
});

const governanceDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(3).max(2000),
});

const supportTicketCategorySchema = z.enum([
  "general",
  "account",
  "athlete_profile",
  "club",
  "event",
  "technical",
  "other",
]);

const supportTicketStatusSchema = z.enum(["open", "in_progress", "resolved", "closed"]);

const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  category: supportTicketCategorySchema,
  message: z.string().trim().min(1).max(5000),
});

const supportTicketMessageSchema = z.object({
  message: z.string().trim().min(1).max(5000),
});

const supportTicketStatusUpdateSchema = z.object({
  status: supportTicketStatusSchema,
});

const platformAthleteUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(160),
  dateOfBirth: isoBirthDateSchema.nullable(),
  primaryEmail: z.string().trim().email().max(320).nullable(),
  city: z.string().trim().max(120).nullable(),
  countryCode: countryCodeSchema.nullable(),
  status: z.enum(["active", "inactive"]),
});

const platformClubUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  city: z.string().trim().max(120).nullable(),
  region: z.string().trim().max(120).nullable().optional().default(null),
  countryCode: countryCodeSchema.nullable(),
  status: z.enum(["active", "inactive"]),
  verificationStatus: z.enum(["unverified", "verified", "flagged"]),
});

const platformIntegrityCheckTypeSchema = z.enum(["duplicate", "membership", "result"]);
const platformIntegrityCheckStateSchema = z.object({
  state: z.enum(["open", "acknowledged", "dismissed"]),
});

function normalizedOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function allowedBrowserOrigins() {
  return new Set(
    [
      normalizedOrigin(env.apiCorsOrigin),
      normalizedOrigin(env.appBaseUrl),
      "http://127.0.0.1:8080",
      "http://localhost:8080",
      "http://127.0.0.1:4173",
      "http://localhost:4173",
      "http://127.0.0.1:4174",
      "http://localhost:4174",
      "http://127.0.0.1:4175",
      "http://localhost:4175",
      "http://127.0.0.1:4176",
      "http://localhost:4176",
    ].filter((value): value is string => Boolean(value)),
  );
}

function assertTrustedBrowserRequest(req: Request) {
  const origin = Array.isArray(req.headers.origin)
    ? req.headers.origin[0]
    : req.headers.origin;
  if (origin && !allowedBrowserOrigins().has(normalizedOrigin(origin) ?? "")) {
    throw new Error("Untrusted browser origin");
  }
  const fetchSite = req.headers["sec-fetch-site"];
  const fetchSiteValue = Array.isArray(fetchSite) ? fetchSite[0] : fetchSite;
  if (fetchSiteValue?.toLowerCase() === "cross-site") {
    throw new Error("Untrusted browser origin");
  }
}

function checkoutReturnOptions(req: Request) {
  return resolveBrowserCheckoutReturn(req.headers, allowedBrowserOrigins());
}

function applyCors(req: Request, res: Response) {
  const origin = req.headers.origin;
  const allowedOrigins = allowedBrowserOrigins();

  if (origin && allowedOrigins.has(normalizedOrigin(origin) ?? "")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, idempotency-key, x-guest-registration-token, x-raceson-support-organization, x-trail-client",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

async function readRawBody(req: Request) {
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new RequestBodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(req: Request) {
  const rawBody = await readRawBody(req);
  if (!rawBody.byteLength) return null;
  return JSON.parse(rawBody.toString("utf8")) as JsonValue;
}

function sendJson(res: Response, statusCode: number, payload: JsonValue) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendSuccess(res: Response, payload: JsonValue, statusCode = 200) {
  sendJson(res, statusCode, { data: payload });
}

function sendRedirect(res: Response, location: string) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function sendFile(res: Response, payload: { content: string; mimeType: string; fileName: string }) {
  res.statusCode = 200;
  res.setHeader("Content-Type", `${payload.mimeType}; charset=utf-8`);
  res.setHeader("Content-Disposition", `attachment; filename="${payload.fileName.replace(/"/g, "")}"`);
  res.end(payload.content);
}

function sendError(res: Response, statusCode: number, code: string, message: string) {
  sendJson(res, statusCode, {
    error: {
      code,
      message,
    },
  });
}

function parseRoute(pathname: string, pattern: string) {
  const pathnameParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);

  if (pathnameParts.length !== patternParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const routePart = patternParts[index];
    const pathPart = pathnameParts[index];
    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = pathPart;
      continue;
    }
    if (routePart !== pathPart) return null;
  }

  return params;
}

function matchRoute(method: string, pathname: string, patternMethod: string, patternPath: string) {
  if (method !== patternMethod) return null;
  return parseRoute(pathname, patternPath);
}

async function requireAccessToken(req: Request) {
  const bearerToken = readBearerToken(req.headers);
  if (bearerToken) return bearerToken;
  const accessToken = readBrowserSessionCookies(req).accessToken;
  if (!accessToken) {
    throw new Error("Missing bearer token");
  }
  assertTrustedBrowserRequest(req);
  return accessToken;
}

async function requireSession(req: Request) {
  const accessToken = await requireAccessToken(req);
  const session = await resolveRequestSession(accessToken, env);
  const supportHeader = req.headers["x-raceson-support-organization"];
  const supportOrganizationId = Array.isArray(supportHeader)
    ? supportHeader[0]
    : supportHeader;
  if (!supportOrganizationId || !req.url?.startsWith("/api/v1/organizer/")) {
    return session;
  }
  return scopePlatformSupportSession(
    session,
    z.string().uuid().parse(supportOrganizationId),
    env,
  );
}

function requestIpAddress(req: Request) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (forwardedValue) {
    const [firstAddress] = forwardedValue.split(",");
    return firstAddress?.trim() || null;
  }

  const socketAddress = req.socket.remoteAddress?.trim();
  return socketAddress || null;
}

function requestUserAgent(req: Request) {
  const value = req.headers["user-agent"];
  const userAgent = Array.isArray(value) ? value[0] : value;
  return userAgent?.trim() || null;
}

type RateLimitBucket = { count: number; resetAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();
let lastRateLimitSweepAt = 0;

function enforceRateLimit(
  req: Request,
  res: Response,
  scope: string,
  options: { limit: number; windowMs: number },
) {
  const now = Date.now();
  if (now - lastRateLimitSweepAt >= 60_000 || rateLimitBuckets.size >= 10_000) {
    for (const [key, candidate] of rateLimitBuckets) {
      if (candidate.resetAt <= now) rateLimitBuckets.delete(key);
    }
    lastRateLimitSweepAt = now;
  }

  const localTestClient = process.env.LOCAL_TEST_AUTH_ENABLED === "true"
    ? (Array.isArray(req.headers["x-trail-client"])
        ? req.headers["x-trail-client"][0]
        : req.headers["x-trail-client"])
    : null;
  const clientKey = localTestClient?.trim() || requestIpAddress(req) || "unknown";
  const bucketKey = `${scope}:${clientKey}`;
  const current = rateLimitBuckets.get(bucketKey);
  if (!current && rateLimitBuckets.size >= 10_000) {
    res.setHeader("Retry-After", "60");
    sendError(res, 429, "rate_limited", "Too many requests. Try again later.");
    return false;
  }
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + options.windowMs }
    : current;

  bucket.count += 1;
  rateLimitBuckets.set(bucketKey, bucket);

  if (bucket.count <= options.limit) return true;

  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  res.setHeader("Retry-After", String(retryAfterSeconds));
  sendError(res, 429, "rate_limited", "Too many requests. Try again later.");
  return false;
}

async function enforceDurablePublicAuthRateLimit(
  req: Request,
  res: Response,
  action: string,
  subject: string,
  options: { limit: number; windowMs: number },
  env: ReturnType<typeof loadServerEnv>,
) {
  const result = await consumePublicAuthRateLimit({
    action,
    email: subject.trim().toLowerCase(),
    ipAddress: requestIpAddress(req),
    limit: options.limit,
    windowMs: options.windowMs,
  }, env);
  if (result.allowed) return true;

  if (result.retryAfterSeconds) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
  }
  sendError(res, 429, "rate_limited", "Too many requests. Try again later.");
  return false;
}

export type ApiRouteExtension = (req: Request, res: Response, url: URL, boundary: {
  env: ReturnType<typeof loadServerEnv>;
  requireAccessToken: typeof requireAccessToken;
  readJsonBody: typeof readJsonBody;
  sendSuccess: typeof sendSuccess;
  sendError: typeof sendError;
  applyPrivateSessionHeaders: typeof applyPrivateSessionHeaders;
}) => Promise<boolean>;

// Extra routes are an application-entry-point decision, never request data.
// The normal portal does not supply an extension or import demo route modules.
export async function handleApiRequest(req: Request, res: Response, extension?: ApiRouteExtension, registrationPolicy?: "sponsor") {
  if (!req.url || !req.method) {
    sendError(res, 400, "bad_request", "Invalid request");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendSuccess(res, {
      service: "trail-api",
      status: "ok",
    });
    return;
  }

  try {
    env ??= loadServerEnv();
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (env.readOnly && req.method !== "GET" && req.method !== "HEAD") {
      sendError(
        res,
        403,
        "read_only_deployment",
        "This deployment is read-only.",
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/internal/workflows/dispatch") {
      if (!isStagingWorkflowHost(url.hostname)) {
        sendError(res, 404, "not_found", "Not found");
        return;
      }
      if (!enforceRateLimit(
        req,
        res,
        "workflow-dispatch-auth",
        { limit: 12, windowMs: 60_000 },
      )) {
        return;
      }
      const token = readBearerToken(req.headers);
      if (!await authorizeGitHubWorkflowDispatch(token)) {
        sendError(res, 401, "unauthorized", "Workflow dispatch authorization failed");
        return;
      }
      const body = workflowDispatchSchema.parse(await readJsonBody(req) ?? {});
      const result = await dispatchPendingWorkflowJobs(body, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/integrations/strava/callback") {
      const browserState = readStravaBrowserState(req);
      writeStravaBrowserState(res, null, requestUsesSecureCookies(req, env.appBaseUrl));
      if (url.searchParams.get("error")) {
        const appBaseUrl = env.appBaseUrl?.replace(/\/$/, "") ?? "";
        sendRedirect(res, `${appBaseUrl}/athlete?strava=denied`);
        return;
      }
      const result = await completeStravaAuthorization({
        code: z.string().min(1).parse(url.searchParams.get("code")),
        state: z.string().min(1).parse(url.searchParams.get("state")),
        browserState,
        acceptedScope: url.searchParams.get("scope"),
      }, env);
      sendRedirect(res, result.redirectUrl);
      return;
    }

    const publicDiscoverResponse = resolvePublicDiscoverRequest(req.method, url);
    if (publicDiscoverResponse) {
      if (
        req.method === "GET"
        && !enforceRateLimit(
          req,
          res,
          "public-discover",
          { limit: 120, windowMs: 60_000 },
        )
      ) {
        return;
      }
      Object.entries(publicDiscoverResponse.headers).forEach(([name, value]) => {
        res.setHeader(name, value);
      });
      sendJson(
        res,
        publicDiscoverResponse.statusCode,
        publicDiscoverResponse.payload,
      );
      return;
    }

    if (isPublicRaceProjectionPath(url)) {
      if (
        req.method === "GET"
        && !enforceRateLimit(
          req,
          res,
          "public-races",
          { limit: 120, windowMs: 60_000 },
        )
      ) {
        return;
      }
      const publicRaceResponse = await resolvePublicRaceProjectionRequest(
        req.method,
        url,
        env,
      );
      if (publicRaceResponse) {
        Object.entries(publicRaceResponse.headers).forEach(([name, value]) => {
          res.setHeader(name, value);
        });
        if (publicRaceResponse.binaryBody) {
          res.statusCode = publicRaceResponse.statusCode;
          // NextApiResponse wraps ServerResponse and rejects a bare Uint8Array
          // even though the standalone Node server accepts it.
          res.end(Buffer.from(publicRaceResponse.binaryBody));
        } else if (publicRaceResponse.payload) {
          sendJson(
            res,
            publicRaceResponse.statusCode,
            publicRaceResponse.payload,
          );
        }
        return;
      }
    }

    if (isPublicPlatformSummaryPath(url)) {
      if (
        req.method === "GET"
        && !enforceRateLimit(
          req,
          res,
          "public-platform-summary",
          { limit: 120, windowMs: 60_000 },
        )
      ) {
        return;
      }
      const publicPlatformSummaryResponse = await resolvePublicPlatformSummaryRequest(
        req.method,
        url,
        env,
      );
      if (publicPlatformSummaryResponse) {
        Object.entries(publicPlatformSummaryResponse.headers).forEach(([name, value]) => {
          res.setHeader(name, value);
        });
        sendJson(
          res,
          publicPlatformSummaryResponse.statusCode,
          publicPlatformSummaryResponse.payload,
        );
        return;
      }
    }

    if (isPublicAthleteProjectionPath(url)) {
      if (
        req.method === "GET"
        && !enforceRateLimit(
          req,
          res,
          "public-athletes",
          { limit: 120, windowMs: 60_000 },
        )
      ) {
        return;
      }
      const publicAthleteResponse = await resolvePublicAthleteProjectionRequest(
        req.method ?? "GET",
        url,
        env,
      );
      if (publicAthleteResponse) {
        Object.entries(publicAthleteResponse.headers).forEach(([name, value]) => {
          res.setHeader(name, value);
        });
        sendJson(
          res,
          publicAthleteResponse.statusCode,
          publicAthleteResponse.payload,
        );
        return;
      }
    }

    if (isPublicCurrentResultsPath(url)) {
      // Public catalog pages request bounded result batches. A directory browse
      // can legitimately issue several batches per page, especially for users
      // sharing one NAT address, so retain abuse protection without throttling
      // the supported cross-surface read workflow.
      if (!enforceRateLimit(req, res, "public-current-results", { limit: 600, windowMs: 60_000 })) {
        return;
      }
      const publicResultResponse = await resolvePublicCurrentResultsRequest(
        req.method ?? "GET",
        url,
        await readJsonBody(req),
        env,
      );
      if (publicResultResponse) {
        Object.entries(publicResultResponse.headers).forEach(([name, value]) => {
          res.setHeader(name, value);
        });
        sendJson(
          res,
          publicResultResponse.statusCode,
          publicResultResponse.payload,
        );
        return;
      }
    }

    if (isPublicLeagueClubStandingsPath(url)) {
      if (!enforceRateLimit(req, res, "public-league-club-standings", { limit: 120, windowMs: 60_000 })) {
        return;
      }
      const publicClubStandingResponse = await resolvePublicLeagueClubStandingsRequest(
        req.method ?? "GET",
        url,
        await readJsonBody(req),
        env,
      );
      if (publicClubStandingResponse) {
        Object.entries(publicClubStandingResponse.headers).forEach(([name, value]) => {
          res.setHeader(name, value);
        });
        sendJson(
          res,
          publicClubStandingResponse.statusCode,
          publicClubStandingResponse.payload,
        );
        return;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/v1/payments/stripe/webhook") {
      const rawSignature = req.headers["stripe-signature"];
      const signature = Array.isArray(rawSignature) ? rawSignature[0] : rawSignature;
      if (!signature) {
        sendError(res, 400, "missing_webhook_signature", "Stripe-Signature header is required");
        return;
      }
      const rawBody = await readRawBody(req);
      const event = verifyStripeWebhook(rawBody, signature, env);
      const result = await applyVerifiedStripeWebhook(event, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/weather-snapshots") {
      // An event page loads the current conditions plus a seven-day forecast,
      // and normal navigation across several public events should fit in one
      // client burst without degrading to 429 responses.
      if (!enforceRateLimit(req, res, "weather", { limit: 120, windowMs: 60_000 })) return;
      const body = publicWeatherSnapshotsSchema.parse(await readJsonBody(req) ?? {});
      const snapshots = await getPublicWeatherSnapshots(body.locations, body.date);
      sendSuccess(res, snapshots);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/sign-in") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "password-sign-in", { limit: 10, windowMs: 15 * 60_000 })) return;
      const body = passwordSignInSchema.parse(await readJsonBody(req) ?? {});
      if (!await enforceDurablePublicAuthRateLimit(
        req,
        res,
        "password-sign-in",
        body.identifier ?? body.email ?? "unknown",
        { limit: 10, windowMs: 15 * 60_000 },
        env,
      )) return;
      const result = await signInBrowserSession({
        identifier: body.identifier ?? body.email,
        password: body.password,
        ipAddress: requestIpAddress(req),
        userAgent: requestUserAgent(req),
      }, env);
      writeBrowserSessionCookies(
        res,
        result.session,
        requestUsesSecureCookies(req, env.appBaseUrl),
      );
      sendSuccess(res, {
        account: result.account,
        session: {
          accessToken: result.session.accessToken,
          refreshToken: result.session.refreshToken,
          expiresAt: result.session.expiresAt,
        },
        expiresAt: result.session.expiresAt,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/athlete-profile-matches") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "athlete-profile-match", { limit: 10, windowMs: 15 * 60_000 })) return;
      const body = athleteProfileMatchSchema.parse(await readJsonBody(req) ?? {});
      if (!await enforceDurablePublicAuthRateLimit(
        req,
        res,
        "athlete-profile-match",
        `${body.dateOfBirth}:${body.email ?? `${body.firstName}:${body.lastName}`}`,
        { limit: 10, windowMs: 15 * 60_000 },
        env,
      )) return;
      const matches = await findUnclaimedAthleteProfileMatches(body, env);
      sendSuccess(res, matches);
      return;
    }

    const athleteProfileClaimAvailabilityParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/public/athlete-profile-claim/:athleteSlug",
    );
    if (athleteProfileClaimAvailabilityParams) {
      const result = await getAthleteProfileClaimAvailability(
        athleteProfileClaimSlugSchema.parse(athleteProfileClaimAvailabilityParams.athleteSlug),
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const athleteProfileClaimEmailParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/public/athlete-profile-claim/:athleteSlug/email",
    );
    if (athleteProfileClaimEmailParams) {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "athlete-profile-claim-email", { limit: 3, windowMs: 60 * 60_000 })) return;
      const result = await requestAthleteProfileClaimEmail(
        athleteProfileClaimSlugSchema.parse(athleteProfileClaimEmailParams.athleteSlug),
        {
          ipAddress: requestIpAddress(req),
          userAgent: requestUserAgent(req),
        },
        env,
      );
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/sign-up") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "account-sign-up", { limit: 5, windowMs: 15 * 60_000 })) return;
      const body = (registrationPolicy === "sponsor" ? sponsorAccountSignUpSchema : usernameAccountSignUpSchema).parse(await readJsonBody(req) ?? {});
      if (!await enforceDurablePublicAuthRateLimit(
        req,
        res,
        "account-sign-up",
        `${body.username}:${body.email ?? "no-email"}`,
        { limit: 5, windowMs: 15 * 60_000 },
        env,
      )) return;
      const result = await signUpUsernameBrowserSession({
        ...body,
        registrationPurpose: registrationPolicy,
        ipAddress: requestIpAddress(req),
        userAgent: requestUserAgent(req),
      }, env);
      if (result.needsEmailVerification) {
        sendSuccess(res, {
          account: null,
          session: null,
          needsEmailVerification: true,
          pendingSignUp: result.pendingSignUp,
        });
        return;
      }
      writeBrowserSessionCookies(
        res,
        result.session,
        requestUsesSecureCookies(req, env.appBaseUrl),
      );
      sendSuccess(res, {
        account: result.account,
        session: {
          accessToken: result.session.accessToken,
          refreshToken: result.session.refreshToken,
          expiresAt: result.session.expiresAt,
        },
        needsEmailVerification: false,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/sign-up-availability") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "account-sign-up-availability", { limit: 10, windowMs: 15 * 60_000 })) return;
      const body = usernameAccountAvailabilitySchema.parse(await readJsonBody(req) ?? {});
      if (!await enforceDurablePublicAuthRateLimit(
        req,
        res,
        "account-sign-up-availability",
        `${body.username}:${body.email ?? "no-email"}`,
        { limit: 10, windowMs: 15 * 60_000 },
        env,
      )) return;
      await assertUsernameAccountSignUpCredentialsAvailable(body, env);
      sendSuccess(res, { available: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/cancel-pending-sign-up") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "cancel-pending-sign-up", { limit: 5, windowMs: 15 * 60_000 })) return;
      const body = pendingBrowserSignUpSchema.parse(await readJsonBody(req) ?? {});
      if (!await enforceDurablePublicAuthRateLimit(
        req,
        res,
        "cancel-pending-sign-up",
        body.userId,
        { limit: 5, windowMs: 15 * 60_000 },
        env,
      )) return;
      const result = await cancelPendingBrowserSignUp(body, env);
      sendSuccess(res, result);
      return;
    }

    if (
      req.method === "POST"
      && url.pathname === "/api/v1/public/auth/local-test-account"
    ) {
      const requestOrigin = Array.isArray(req.headers.origin)
        ? req.headers.origin[0]
        : req.headers.origin;
      const credentials = resolveLocalTestAuthCredentials(
        process.env,
        env.apiHost,
        requestOrigin,
      );
      if (!credentials) {
        sendError(res, 404, "not_found", "Route not found");
        return;
      }
      assertTrustedBrowserRequest(req);
      if (
        !enforceRateLimit(
          req,
          res,
          "local-test-sign-in",
          { limit: 30, windowMs: 15 * 60_000 },
        )
      ) {
        return;
      }
      const result = await signInBrowserSession({
        ...credentials,
        ipAddress: requestIpAddress(req),
        userAgent: requestUserAgent(req),
      }, env);
      writeBrowserSessionCookies(
        res,
        result.session,
        requestUsesSecureCookies(req, env.appBaseUrl),
      );
      sendSuccess(res, {
        account: result.account,
        expiresAt: result.session.expiresAt,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/refresh") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "session-refresh", { limit: 60, windowMs: 10 * 60_000 })) return;
      const secureCookies = requestUsesSecureCookies(req, env.appBaseUrl);
      const refreshToken = readBrowserSessionCookies(req).refreshToken;
      if (!refreshToken) {
        clearBrowserSessionCookies(res, secureCookies);
        throw new Error("Unauthorized");
      }
      try {
        const result = await refreshBrowserSession(refreshToken, env);
        writeBrowserSessionCookies(res, result.session, secureCookies);
        sendSuccess(res, {
          account: result.account,
          expiresAt: result.session.expiresAt,
        });
      } catch (error) {
        clearBrowserSessionCookies(res, secureCookies);
        throw error;
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/session") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "session-restore", { limit: 120, windowMs: 10 * 60_000 })) return;
      const secureCookies = requestUsesSecureCookies(req, env.appBaseUrl);
      const sessionCookies = readBrowserSessionCookies(req);
      if (sessionCookies.accessToken) {
        try {
          const account = await loadAccountContextForAccessToken(
            sessionCookies.accessToken,
            env,
          );
          applyPrivateSessionHeaders(res);
          sendSuccess(res, { account, expiresAt: null });
          return;
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "Unauthorized") {
            throw error;
          }
        }
      }
      if (!sessionCookies.refreshToken) {
        clearBrowserSessionCookies(res, secureCookies);
        throw new Error("Unauthorized");
      }
      try {
        const result = await refreshBrowserSession(sessionCookies.refreshToken, env);
        writeBrowserSessionCookies(res, result.session, secureCookies);
        sendSuccess(res, {
          account: result.account,
          expiresAt: result.session.expiresAt,
        });
      } catch (error) {
        clearBrowserSessionCookies(res, secureCookies);
        throw error;
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/sign-out") {
      assertTrustedBrowserRequest(req);
      const secureCookies = requestUsesSecureCookies(req, env.appBaseUrl);
      const sessionCookies = readBrowserSessionCookies(req);
      try {
        await signOutBrowserSession(sessionCookies, env);
      } finally {
        clearBrowserSessionCookies(res, secureCookies);
      }
      sendSuccess(res, { signedOut: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/password-reset") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "password-reset", { limit: 5, windowMs: 60 * 60_000 })) return;
      const body = publicAuthRecoverySchema.parse(await readJsonBody(req) ?? {});
      const result = await requestBrowserPasswordReset({
        identifier: body.identifier,
        ipAddress: requestIpAddress(req),
        userAgent: requestUserAgent(req),
      }, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/public/auth/resend-verification") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "resend-verification", { limit: 5, windowMs: 60 * 60_000 })) return;
      const body = publicAuthEmailSchema.parse(await readJsonBody(req) ?? {});
      const result = await resendSignupVerificationEmail({
        email: body.email,
        ipAddress: requestIpAddress(req),
        userAgent: requestUserAgent(req),
      }, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/account/context") {
      const accessToken = await requireAccessToken(req);
      const account = await loadAccountContextForAccessToken(accessToken, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, account);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/time") {
      await requireSession(req);
      sendSuccess(res, {
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (extension && await extension(req, res, url, {
      env, requireAccessToken, readJsonBody, sendSuccess, sendError, applyPrivateSessionHeaders,
    })) return;

    if (await dispatchNotificationRoutes(req, res, url, {
      env, requireSession, readJsonBody, sendSuccess, applyPrivateSessionHeaders,
    })) return;

    if (await dispatchEventEmailSettingsRoutes(req, res, url, {
      env, requireSession, readJsonBody, sendSuccess, applyPrivateSessionHeaders,
    })) return;

    if (await dispatchPlatformStatisticsRoutes(req, res, url, {
      env, requireSession, sendSuccess, applyPrivateSessionHeaders,
    })) return;

    if (await dispatchPlatformRecordRoutes(req, res, url, {
      env,
      requireSession,
      readJsonBody,
      sendSuccess,
      applyPrivateSessionHeaders,
    })) return;

    if (await dispatchPlatformManagementRoutes(req, res, url, {
      env,
      requireSession,
      readJsonBody,
      sendSuccess,
      applyPrivateSessionHeaders,
    })) return;

    if (req.method === "GET" && url.pathname === "/api/v1/platform/administrators") {
      const session = await requireSession(req);
      const administrators = await listPlatformAdministrators(session, env);
      sendSuccess(res, administrators);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/platform/organizations") {
      const session = await requireSession(req);
      const organizations = await listPlatformOrganizations(session, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, organizations);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/platform/identity-governance") {
      const session = await requireSession(req);
      const inbox = await listIdentityGovernanceInbox(session, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, inbox);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/platform/identity-requests") {
      const session = await requireSession(req);
      const requests = await listIdentityGovernanceRequests(session, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, requests);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/platform/support-tickets") {
      const session = await requireSession(req);
      const requestedStatus = url.searchParams.get("status") ?? "open";
      const status = requestedStatus === "all" ? null : supportTicketStatusSchema.parse(requestedStatus);
      const tickets = await listPlatformSupportTickets(session, status, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, tickets);
      return;
    }

    const platformSupportTicketMessageParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/platform/support-tickets/:ticketId/messages",
    );
    if (platformSupportTicketMessageParams) {
      const session = await requireSession(req);
      const body = supportTicketMessageSchema.parse(await readJsonBody(req) ?? {});
      const result = await replyToPlatformSupportTicket(
        session,
        z.string().uuid().parse(platformSupportTicketMessageParams.ticketId),
        body.message,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const platformSupportTicketStatusParams = matchRoute(
      req.method,
      url.pathname,
      "PATCH",
      "/api/v1/platform/support-tickets/:ticketId/status",
    );
    if (platformSupportTicketStatusParams) {
      const session = await requireSession(req);
      const body = supportTicketStatusUpdateSchema.parse(await readJsonBody(req) ?? {});
      const result = await updatePlatformSupportTicketStatus(
        session,
        z.string().uuid().parse(platformSupportTicketStatusParams.ticketId),
        body.status,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const platformAthleteUpdateParams = matchRoute(
      req.method,
      url.pathname,
      "PATCH",
      "/api/v1/platform/athletes/:athleteId",
    );
    if (platformAthleteUpdateParams) {
      const session = await requireSession(req);
      const body = platformAthleteUpdateSchema.parse(await readJsonBody(req) ?? {});
      const result = await updatePlatformAthlete(
        session,
        z.string().uuid().parse(platformAthleteUpdateParams.athleteId),
        body,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const platformClubUpdateParams = matchRoute(
      req.method,
      url.pathname,
      "PATCH",
      "/api/v1/platform/clubs/:clubId",
    );
    if (platformClubUpdateParams) {
      const session = await requireSession(req);
      const body = platformClubUpdateSchema.parse(await readJsonBody(req) ?? {});
      const result = await updatePlatformClub(
        session,
        z.string().uuid().parse(platformClubUpdateParams.clubId),
        body,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const platformClubDeleteParams = matchRoute(
      req.method,
      url.pathname,
      "DELETE",
      "/api/v1/platform/clubs/:clubId",
    );
    if (platformClubDeleteParams) {
      const session = await requireSession(req);
      const result = await deletePlatformClub(
        session,
        z.string().uuid().parse(platformClubDeleteParams.clubId),
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const platformIntegrityActionParams = matchRoute(
      req.method,
      url.pathname,
      "PATCH",
      "/api/v1/platform/integrity-checks/:checkType/:checkKey",
    );
    if (platformIntegrityActionParams) {
      const session = await requireSession(req);
      const body = platformIntegrityCheckStateSchema.parse(await readJsonBody(req) ?? {});
      const result = await setPlatformIntegrityCheckState(
        session,
        platformIntegrityCheckTypeSchema.parse(platformIntegrityActionParams.checkType),
        decodeURIComponent(platformIntegrityActionParams.checkKey),
        body.state,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const athleteClaimDecisionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/platform/athlete-claims/:claimId/decision",
    );
    if (athleteClaimDecisionParams) {
      const session = await requireSession(req);
      const body = governanceDecisionSchema.parse(await readJsonBody(req) ?? {});
      const result = await decideAthleteProfileClaim(
        session,
        z.string().uuid().parse(athleteClaimDecisionParams.claimId),
        body.decision,
        body.note,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const clubAdminDecisionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/platform/club-admin-requests/:requestId/decision",
    );
    if (clubAdminDecisionParams) {
      const session = await requireSession(req);
      const body = governanceDecisionSchema.parse(await readJsonBody(req) ?? {});
      const result = await decideClubAdminRoleRequest(
        session,
        z.string().uuid().parse(clubAdminDecisionParams.requestId),
        body.decision,
        body.note,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/platform/track-attempts") {
      const session = await requireSession(req);
      const requestedStatus = url.searchParams.get("status") ?? "submitted";
      const status = requestedStatus === "all" ? null : trackAttemptStatusSchema.parse(requestedStatus);
      const attempts = await listTrackAttemptsForSuperAdmin(session, status, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, attempts);
      return;
    }

    const refreshTrackAttemptParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/platform/track-attempts/:attemptId/refresh",
    );
    if (refreshTrackAttemptParams) {
      const session = await requireSession(req);
      const attemptId = z.string().uuid().parse(refreshTrackAttemptParams.attemptId);
      const attempt = await refreshTrackAttemptEvidenceAsSuperAdmin(session, attemptId, env);
      sendSuccess(res, attempt);
      return;
    }

    const reviewTrackAttemptParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/platform/track-attempts/:attemptId/review",
    );
    if (reviewTrackAttemptParams) {
      const session = await requireSession(req);
      const attemptId = z.string().uuid().parse(reviewTrackAttemptParams.attemptId);
      const body = reviewTrackAttemptSchema.parse(await readJsonBody(req) ?? {});
      const attempt = await reviewTrackAttemptAsSuperAdmin(session, { attemptId, ...body }, env);
      sendSuccess(res, attempt);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/platform/administrators/invite") {
      if (!enforceRateLimit(req, res, "platform-admin-invite", { limit: 5, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = platformAdministratorInviteSchema.parse(await readJsonBody(req) ?? {});
      const administrator = await inviteSiteAdministrator(session, body.email, env);
      sendSuccess(res, administrator);
      return;
    }

    const deactivatePlatformAdministratorParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/platform/administrators/:userId/deactivate",
    );
    if (deactivatePlatformAdministratorParams) {
      const session = await requireSession(req);
      const result = await deactivateSiteAdministrator(
        session,
        z.string().uuid().parse(deactivatePlatformAdministratorParams.userId),
        env,
      );
      sendSuccess(res, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/testing/legacy-assignment-pool") {
      const session = await requireSession(req);
      const summary = await getPlatformTestingSummary(session, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, summary);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/bootstrap") {
      const accessToken = await requireAccessToken(req);
      const body = bootstrapSchema.parse(await readJsonBody(req) ?? {});
      const account = await bootstrapCurrentUserAccount(accessToken, {
        ...body,
        roles: parseRequestedRoles(body.roles),
      }, env);
      sendSuccess(res, account);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/finalize-sign-up") {
      const accessToken = await requireAccessToken(req);
      const result = await finalizeVerifiedBrowserSignUp(accessToken, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/delete") {
      const accessToken = await requireAccessToken(req);
      const body = accountDeletionSchema.parse(await readJsonBody(req) ?? {});
      const result = await deleteCurrentUserAccount(accessToken, body, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/settings") {
      const accessToken = await requireAccessToken(req);
      const body = accountSettingsSchema.parse(await readJsonBody(req) ?? {});
      const account = await updateCurrentUserAccountSettings(accessToken, body, env);
      sendSuccess(res, account);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/type") {
      const accessToken = await requireAccessToken(req);
      const body = accountTypeSchema.parse(await readJsonBody(req) ?? {});
      const account = await updateCurrentUserAccountType(accessToken, body, env);
      sendSuccess(res, account);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/password") {
      const session = await requireSession(req);
      const body = passwordChangeSchema.parse(await readJsonBody(req) ?? {});
      const result = await changeCurrentUserPassword(
        session,
        body.currentPassword,
        body.newPassword,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/password-reset") {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "account-password-reset", { limit: 5, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const result = await requestCurrentUserPasswordReset(session, {
        ipAddress: requestIpAddress(req),
        userAgent: requestUserAgent(req),
      }, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/account/username") {
      if (!enforceRateLimit(req, res, "username-change", { limit: 5, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = usernameChangeSchema.parse(await readJsonBody(req) ?? {});
      await changeCurrentUserAccountUsername(session, body, env);
      const account = await loadAccountContextForAccessToken(session.accessToken, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, account);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/clubs") {
      const session = await requireSession(req);
      const body = createClubSchema.parse(await readJsonBody(req) ?? {});
      const result = await createCurrentUserClub(session, body, env);
      sendSuccess(res, result);
      return;
    }

    const clubDashboardParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/clubs/:clubSlug/admin",
    );
    if (clubDashboardParams) {
      const session = await requireSession(req);
      const result = await getClubManagementDashboard(session, clubDashboardParams.clubSlug, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, result);
      return;
    }

    const clubMemberRoleParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/clubs/:clubSlug/members/:membershipId/role",
    );
    if (clubMemberRoleParams) {
      const session = await requireSession(req);
      const body = clubMemberRoleSchema.parse(await readJsonBody(req) ?? {});
      const result = await updateClubMemberRole(
        session,
        clubMemberRoleParams.clubSlug,
        z.string().uuid().parse(clubMemberRoleParams.membershipId),
        body.roleId,
        env,
      );
      applyPrivateSessionHeaders(res);
      sendSuccess(res, result);
      return;
    }

    const clubMemberRemoveParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/clubs/:clubSlug/members/:membershipId/remove",
    );
    if (clubMemberRemoveParams) {
      const session = await requireSession(req);
      const result = await removeClubMember(
        session,
        clubMemberRemoveParams.clubSlug,
        z.string().uuid().parse(clubMemberRemoveParams.membershipId),
        env,
      );
      applyPrivateSessionHeaders(res);
      sendSuccess(res, result);
      return;
    }

    const clubRoleCreateParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/clubs/:clubSlug/roles",
    );
    if (clubRoleCreateParams) {
      const session = await requireSession(req);
      const body = customClubRoleSchema.parse(await readJsonBody(req) ?? {});
      const result = await createCustomClubRole(session, clubRoleCreateParams.clubSlug, body, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, result, 201);
      return;
    }

    const clubRoleUpdateParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/clubs/:clubSlug/roles/:roleId",
    );
    if (clubRoleUpdateParams) {
      const session = await requireSession(req);
      const body = customClubRoleSchema.parse(await readJsonBody(req) ?? {});
      const result = await updateCustomClubRole(
        session,
        clubRoleUpdateParams.clubSlug,
        z.string().uuid().parse(clubRoleUpdateParams.roleId),
        body,
        env,
      );
      applyPrivateSessionHeaders(res);
      sendSuccess(res, result);
      return;
    }

    const clubActivityCreateParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/clubs/:clubSlug/activities",
    );
    if (clubActivityCreateParams) {
      const session = await requireSession(req);
      const body = clubActivitySchema.parse(await readJsonBody(req) ?? {});
      const result = await createClubActivity(
        session,
        clubActivityCreateParams.clubSlug,
        body,
        env,
      );
      applyPrivateSessionHeaders(res);
      sendSuccess(res, result, 201);
      return;
    }

    const clubManagementParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/clubs/:clubSlug/manage",
    );
    if (clubManagementParams) {
      const session = await requireSession(req);
      const result = await getCurrentUserClubManagement(session, clubManagementParams.clubSlug, env);
      sendSuccess(res, result);
      return;
    }

    const clubMembershipRequestsParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/clubs/:clubSlug/membership-requests",
    );
    if (clubMembershipRequestsParams) {
      const session = await requireSession(req);
      const requests = await listCurrentUserClubMembershipRequests(
        session,
        clubMembershipRequestsParams.clubSlug,
        env,
      );
      applyPrivateSessionHeaders(res);
      sendSuccess(res, requests);
      return;
    }

    const clubMembershipDecisionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/clubs/:clubSlug/membership-requests/:membershipId/decision",
    );
    if (clubMembershipDecisionParams) {
      const session = await requireSession(req);
      const body = clubMembershipDecisionSchema.parse(await readJsonBody(req) ?? {});
      const result = await decideCurrentUserClubMembershipRequest(
        session,
        clubMembershipDecisionParams.clubSlug,
        z.string().uuid().parse(clubMembershipDecisionParams.membershipId),
        body.decision,
        env,
      );
      applyPrivateSessionHeaders(res);
      sendSuccess(res, result);
      return;
    }

    const updateClubParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/clubs/:clubSlug/manage",
    );
    if (updateClubParams) {
      const session = await requireSession(req);
      const body = updateClubSchema.parse(await readJsonBody(req) ?? {});
      const result = await updateCurrentUserClub(session, updateClubParams.clubSlug, body, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/organizer/organizations") {
      if (!enforceRateLimit(req, res, "organizer-workspace-create", {
        limit: 5,
        windowMs: 60 * 60_000,
      })) return;
      const session = await requireSession(req);
      const body = createOrganizerWorkspaceSchema.parse(await readJsonBody(req) ?? {});
      const result = await createCurrentUserOrganizerWorkspace(session, body, env);
      sendSuccess(res, result);
      return;
    }

    const deleteOrganizerWorkspaceParams = matchRoute(
      req.method,
      url.pathname,
      "DELETE",
      "/api/v1/organizer/organizations/:organizationId",
    );
    if (deleteOrganizerWorkspaceParams) {
      if (!enforceRateLimit(req, res, "organizer-workspace-delete", {
        limit: 5,
        windowMs: 60 * 60_000,
      })) return;
      const session = await requireSession(req);
      const body = deleteOrganizerWorkspaceSchema.parse(
        await readJsonBody(req) ?? {},
      );
      const result = await deleteUnusedOrganizerWorkspace(
        session,
        z.string().uuid().parse(deleteOrganizerWorkspaceParams.organizationId),
        body.confirmationName,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/clubs") {
      const session = await requireSession(req);
      const memberships = await getCurrentAthleteClubMembershipStates(session, env);
      sendSuccess(res, memberships);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/support-tickets") {
      const session = await requireSession(req);
      const tickets = await listCurrentUserSupportTickets(session, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, tickets);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/me/support-tickets") {
      if (!enforceRateLimit(req, res, "support-ticket-create", { limit: 5, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = createSupportTicketSchema.parse(await readJsonBody(req) ?? {});
      const ticket = await createCurrentUserSupportTicket(session, body, env);
      sendSuccess(res, ticket);
      return;
    }

    const currentUserSupportTicketMessageParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/me/support-tickets/:ticketId/messages",
    );
    if (currentUserSupportTicketMessageParams) {
      if (!enforceRateLimit(req, res, "support-ticket-message", { limit: 30, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = supportTicketMessageSchema.parse(await readJsonBody(req) ?? {});
      const message = await replyToCurrentUserSupportTicket(
        session,
        z.string().uuid().parse(currentUserSupportTicketMessageParams.ticketId),
        body.message,
        env,
      );
      sendSuccess(res, message);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/club-admin-requests") {
      const session = await requireSession(req);
      const requestedRoleKey = z.enum(["administrator", "owner"])
        .default("administrator")
        .parse(url.searchParams.get("requestedRoleKey") ?? undefined);
      const requests = await getCurrentClubAdminRequestStates(session, requestedRoleKey, env);
      sendSuccess(res, requests);
      return;
    }

    const clubAdminRequestParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/me/clubs/:clubId/admin-request",
    );
    if (clubAdminRequestParams) {
      if (!enforceRateLimit(req, res, "club-admin-role-request", { limit: 5, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = clubAdminRoleRequestSchema.parse(await readJsonBody(req) ?? {});
      const request = await submitCurrentUserClubAdminRequest(
        session,
        z.string().uuid().parse(clubAdminRequestParams.clubId),
        body.note ?? null,
        body.requestedRoleKey,
        env,
      );
      sendSuccess(res, request);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/me/athlete-profile-claims") {
      if (!enforceRateLimit(req, res, "athlete-profile-claim", { limit: 5, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = z.object({ athleteProfileId: z.string().uuid() }).parse(await readJsonBody(req) ?? {});
      const request = await submitCurrentUserAthleteProfileClaim(session, body.athleteProfileId, env);
      sendSuccess(res, request);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/me/athlete-profile-email-claim") {
      if (!enforceRateLimit(req, res, "athlete-profile-email-claim", { limit: 5, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = athleteProfileEmailClaimSchema.parse(await readJsonBody(req) ?? {});
      const claim = await claimImportedAthleteProfileByVerifiedEmail(session, body.athleteSlug, env);
      const account = await loadAccountContextForAccessToken(session.accessToken, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, { claim, account });
      return;
    }

    const joinClubParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/me/clubs/:clubId/join");
    if (joinClubParams) {
      const session = await requireSession(req);
      const clubId = z.string().uuid().parse(joinClubParams.clubId);
      const membership = await joinCurrentAthleteClub(session, clubId, env);
      sendSuccess(res, membership);
      return;
    }

    const leaveClubParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/me/clubs/:clubId/leave");
    if (leaveClubParams) {
      const session = await requireSession(req);
      const clubId = z.string().uuid().parse(leaveClubParams.clubId);
      const membership = await leaveCurrentAthleteClub(session, clubId, env);
      sendSuccess(res, membership);
      return;
    }

    const defaultClubParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/me/clubs/:clubId/default");
    if (defaultClubParams) {
      const session = await requireSession(req);
      const clubId = z.string().uuid().parse(defaultClubParams.clubId);
      const membership = await setCurrentAthletePrimaryClub(session, clubId, env);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, membership);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/registrations") {
      const session = await requireSession(req);
      const model = await getAthleteRegistrationsReadModel(session, env);
      sendSuccess(res, model);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/track-attempts") {
      const session = await requireSession(req);
      const trackSlug = url.searchParams.get("track");
      const attempts = await getCurrentAthleteTrackAttempts(
        session,
        trackSlug ? trackSlugSchema.parse(trackSlug) : null,
        env,
      );
      applyPrivateSessionHeaders(res);
      sendSuccess(res, attempts);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/integrations/strava") {
      const session = await requireSession(req);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, await getStravaConnectionStatus(session, env));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/me/integrations/strava/authorize") {
      if (!enforceRateLimit(req, res, "strava-authorize", { limit: 10, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = stravaAuthorizeSchema.parse(await readJsonBody(req) ?? {});
      const callbackOrigin = resolveStravaCallbackOrigin(req, env);
      const result = await createStravaAuthorizationUrl(session, body.returnPath ?? null, {
        ...env, appBaseUrl: callbackOrigin,
      });
      writeStravaBrowserState(res, result.browserState, requestUsesSecureCookies(req, env.appBaseUrl));
      sendSuccess(res, { authorizationUrl: result.authorizationUrl });
      return;
    }

    const submitConditionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/tracks/:trackSlug/condition-reports",
    );
    if (submitConditionParams) {
      const session = await requireSession(req);
      const trackSlug = trackSlugSchema.parse(submitConditionParams.trackSlug);
      const body = submitTrackConditionReportSchema.parse(await readJsonBody(req) ?? {});
      const report = await submitTrackConditionReport(session, { trackSlug, ...body }, env);
      sendSuccess(res, report);
      return;
    }

    const submitReviewParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/tracks/:trackSlug/reviews",
    );
    if (submitReviewParams) {
      const session = await requireSession(req);
      const trackSlug = trackSlugSchema.parse(submitReviewParams.trackSlug);
      const body = submitTrackReviewSchema.parse(await readJsonBody(req) ?? {});
      const review = await upsertTrackReview(session, { trackSlug, ...body }, env);
      sendSuccess(res, review);
      return;
    }

    const submitEventReviewParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/events/:eventSlug/reviews",
    );
    if (submitEventReviewParams) {
      const session = await requireSession(req);
      const eventSlug = eventSlugSchema.parse(submitEventReviewParams.eventSlug);
      const body = submitEventReviewSchema.parse(await readJsonBody(req) ?? {});
      sendSuccess(res, await upsertEventReview(session, { eventSlug, ...body }, env));
      return;
    }

    const submitTrackAttemptParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/tracks/:trackSlug/attempts",
    );
    if (submitTrackAttemptParams) {
      if (!enforceRateLimit(req, res, "track-attempt-submit", { limit: 10, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const trackSlug = trackSlugSchema.parse(submitTrackAttemptParams.trackSlug);
      const body = submitTrackAttemptSchema.parse(await readJsonBody(req) ?? {});
      const attempt = await submitTrackAttempt(session, {
        trackSlug,
        gpxFileName: body.gpxFileName,
        gpxXml: body.gpxXml,
      }, env);
      sendSuccess(res, attempt, 201);
      return;
    }

    const trackReviewReactionParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/track-reviews/:reviewId/reaction");
    if (trackReviewReactionParams) {
      const session = await requireSession(req);
      const reviewId = z.string().uuid().parse(trackReviewReactionParams.reviewId);
      const body = trackReviewReactionSchema.parse(await readJsonBody(req) ?? {});
      sendSuccess(res, await setTrackReviewReaction(session, reviewId, body.reaction, env));
      return;
    }

    const trackReviewCommentParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/track-reviews/:reviewId/comments");
    if (trackReviewCommentParams) {
      const session = await requireSession(req);
      const reviewId = z.string().uuid().parse(trackReviewCommentParams.reviewId);
      const body = trackReviewCommentSchema.parse(await readJsonBody(req) ?? {});
      sendSuccess(res, await addTrackReviewComment(session, reviewId, body.body, env));
      return;
    }

    const removeOwnTrackReviewCommentParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/track-review-comments/:commentId/remove");
    if (removeOwnTrackReviewCommentParams) {
      const session = await requireSession(req);
      const commentId = z.string().uuid().parse(removeOwnTrackReviewCommentParams.commentId);
      sendSuccess(res, await removeOwnTrackReviewComment(session, commentId, env));
      return;
    }

    const eventReviewCommentParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/event-reviews/:reviewId/comments");
    if (eventReviewCommentParams) {
      const session = await requireSession(req);
      const reviewId = z.string().uuid().parse(eventReviewCommentParams.reviewId);
      const body = trackReviewCommentSchema.parse(await readJsonBody(req) ?? {});
      sendSuccess(res, await addEventReviewComment(session, reviewId, body.body, env));
      return;
    }

    const removeOwnEventReviewCommentParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/event-review-comments/:commentId/remove");
    if (removeOwnEventReviewCommentParams) {
      const session = await requireSession(req);
      const commentId = z.string().uuid().parse(removeOwnEventReviewCommentParams.commentId);
      sendSuccess(res, await removeOwnEventReviewComment(session, commentId, env));
      return;
    }

    const removeFavoriteParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/me/favorites/events/:eventSlug/remove",
    );
    if (removeFavoriteParams) {
      const session = await requireSession(req);
      const eventSlug = eventSlugSchema.parse(removeFavoriteParams.eventSlug);
      const result = await removeEventFavorite(session, eventSlug, env);
      sendSuccess(res, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/me/favorites") {
      const session = await requireSession(req);
      const body = athleteFavoriteSchema.parse(await readJsonBody(req) ?? {});
      sendSuccess(
        res,
        await setCurrentAthleteFavorite(session, body.kind, body.slug, body.following, env),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/favorites") {
      const session = await requireSession(req);
      sendSuccess(res, await getCurrentAthleteFavoritesReadModel(session, env));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/statistics") {
      const session = await requireSession(req);
      const yearParam = url.searchParams.get("year");
      const year = yearParam === null
        ? undefined
        : z.coerce.number().int().min(2000).max(2200).parse(yearParam);
      applyPrivateSessionHeaders(res);
      sendSuccess(res, await getCurrentAthleteYearStatistics(session, year, env));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/me/dashboard") {
      const session = await requireSession(req);
      const model = await getAthleteDashboardReadModel(session, env);
      sendSuccess(res, model);
      return;
    }

    const publicRegistrationConfigurationParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/public/categories/:categoryId/registration-configuration",
    );
    if (publicRegistrationConfigurationParams) {
      if (!enforceRateLimit(req, res, "public-registration-configuration", { limit: 120, windowMs: 60_000 })) return;
      applyPrivateSessionHeaders(res);
      const session = readBearerToken(req.headers) || readBrowserSessionCookies(req).accessToken
        ? await requireSession(req)
        : null;
      const configuration = await getPublicRegistrationConfiguration(
        z.string().uuid().parse(publicRegistrationConfigurationParams.categoryId),
        env,
        session,
      );
      sendSuccess(res, configuration);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/registrations") {
      const session = await requireSession(req);
      const body = createRegistrationSchema.parse(await readJsonBody(req) ?? {});
      const registration = await createRegistration(
        session,
        { ...body, idempotencyKey: parseIdempotencyKey(req) },
        env,
      );
      sendSuccess(res, registration);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/guest-registrations") {
      if (!enforceRateLimit(req, res, "guest-registration", { limit: 5, windowMs: 10 * 60_000 })) return;
      const body = createGuestRegistrationSchema.parse(await readJsonBody(req) ?? {});
      const registration = await createGuestRegistration(
        { ...body, idempotencyKey: parseIdempotencyKey(req) },
        env,
      );
      sendSuccess(res, registration);
      return;
    }

    const guestCommerceParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/guest-registrations/:registrationId/commerce",
    );
    if (guestCommerceParams) {
      if (!enforceRateLimit(req, res, "guest-registration-commerce", { limit: 60, windowMs: 10 * 60_000 })) return;
      const commerce = await getGuestRegistrationCommerceStatus(
        z.string().uuid().parse(guestCommerceParams.registrationId),
        parseGuestRegistrationAccessToken(req),
        env,
      );
      sendSuccess(res, commerce);
      return;
    }

    const guestBankTransferParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/guest-registrations/:registrationId/bank-transfer",
    );
    if (guestBankTransferParams) {
      if (!enforceRateLimit(req, res, "guest-registration-bank-transfer", { limit: 60, windowMs: 10 * 60_000 })) return;
      const instructions = await getGuestRegistrationBankTransferInstructions(
        z.string().uuid().parse(guestBankTransferParams.registrationId),
        parseGuestRegistrationAccessToken(req),
        env,
      );
      sendSuccess(res, instructions);
      return;
    }

    const reportGuestBankTransferParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/guest-registrations/:registrationId/bank-transfer/report",
    );
    if (reportGuestBankTransferParams) {
      if (!enforceRateLimit(req, res, "guest-registration-bank-transfer-report", { limit: 12, windowMs: 10 * 60_000 })) return;
      const body = reportBankTransferSchema.parse(await readJsonBody(req) ?? {});
      const instructions = await reportGuestRegistrationBankTransfer(
        z.string().uuid().parse(reportGuestBankTransferParams.registrationId),
        parseGuestRegistrationAccessToken(req),
        body.note ?? null,
        env,
      );
      sendSuccess(res, instructions);
      return;
    }

    const guestCheckoutParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/guest-registrations/:registrationId/checkout",
    );
    if (guestCheckoutParams) {
      if (!enforceRateLimit(req, res, "guest-registration-checkout", { limit: 12, windowMs: 10 * 60_000 })) return;
      const checkout = await createStripeGuestRegistrationCheckout(
        z.string().uuid().parse(guestCheckoutParams.registrationId),
        parseGuestRegistrationAccessToken(req),
        parseIdempotencyKey(req),
        env,
        checkoutReturnOptions(req),
      );
      sendSuccess(res, checkout);
      return;
    }

    const guestClaimParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/guest-registrations/:registrationId/claim",
    );
    if (guestClaimParams) {
      if (!enforceRateLimit(req, res, "guest-registration-claim", { limit: 10, windowMs: 10 * 60_000 })) return;
      const session = await requireSession(req);
      const claim = await claimGuestRegistration(
        session,
        z.string().uuid().parse(guestClaimParams.registrationId),
        parseGuestRegistrationAccessToken(req),
        env,
      );
      sendSuccess(res, claim);
      return;
    }

    const guestClaimIntentCreateParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/guest-registrations/:registrationId/claim-intent",
    );
    if (guestClaimIntentCreateParams) {
      assertTrustedBrowserRequest(req);
      if (!enforceRateLimit(req, res, "guest-registration-claim-intent", { limit: 10, windowMs: 10 * 60_000 })) return;
      const registrationId = z.string().uuid().parse(
        guestClaimIntentCreateParams.registrationId,
      );
      if (!await enforceDurablePublicAuthRateLimit(
        req,
        res,
        "guest-registration-claim-intent",
        registrationId,
        { limit: 10, windowMs: 10 * 60_000 },
        env,
      )) return;
      const intent = await createGuestRegistrationClaimIntent(
        registrationId,
        parseGuestRegistrationAccessToken(req),
        env,
      );
      sendSuccess(res, intent);
      return;
    }

    const guestClaimIntentConsumeParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/guest-registration-claim-intents/:intentId/claim",
    );
    if (guestClaimIntentConsumeParams) {
      if (!enforceRateLimit(req, res, "guest-registration-claim-intent-consume", { limit: 10, windowMs: 10 * 60_000 })) return;
      const session = await requireSession(req);
      const claim = await claimGuestRegistrationIntent(
        session,
        z.string().uuid().parse(guestClaimIntentConsumeParams.intentId),
        env,
      );
      sendSuccess(res, claim);
      return;
    }

    const registrationCommerceParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/registrations/:registrationId/commerce",
    );
    if (registrationCommerceParams) {
      const session = await requireSession(req);
      const commerce = await getRegistrationCommerceStatus(
        session,
        z.string().uuid().parse(registrationCommerceParams.registrationId),
        env,
      );
      sendSuccess(res, commerce);
      return;
    }

    const registrationBankTransferParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/registrations/:registrationId/bank-transfer",
    );
    if (registrationBankTransferParams) {
      const session = await requireSession(req);
      const instructions = await getRegistrationBankTransferInstructions(
        session,
        z.string().uuid().parse(registrationBankTransferParams.registrationId),
        env,
      );
      sendSuccess(res, instructions);
      return;
    }

    const reportBankTransferParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/registrations/:registrationId/bank-transfer/report",
    );
    if (reportBankTransferParams) {
      if (!enforceRateLimit(req, res, "registration-bank-transfer-report", { limit: 12, windowMs: 10 * 60_000 })) return;
      const session = await requireSession(req);
      const body = reportBankTransferSchema.parse(await readJsonBody(req) ?? {});
      const instructions = await reportRegistrationBankTransfer(
        session,
        z.string().uuid().parse(reportBankTransferParams.registrationId),
        body.note ?? null,
        env,
      );
      sendSuccess(res, instructions);
      return;
    }

    const checkoutParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/registrations/:registrationId/checkout",
    );
    if (checkoutParams) {
      if (!enforceRateLimit(req, res, "registration-checkout", { limit: 12, windowMs: 10 * 60_000 })) return;
      const session = await requireSession(req);
      const checkout = await createStripeRegistrationCheckout(
        session,
        z.string().uuid().parse(checkoutParams.registrationId),
        parseIdempotencyKey(req),
        env,
        checkoutReturnOptions(req),
      );
      sendSuccess(res, checkout);
      return;
    }

    const registrationEvidenceParams = matchRoute(
      req.method,
      url.pathname,
      req.method === "GET" ? "GET" : "POST",
      "/api/v1/registrations/:registrationId/payment-evidence",
    );
    if (registrationEvidenceParams && (req.method === "GET" || req.method === "POST")) {
      const session = await requireSession(req);
      if (req.method === "GET") {
        const evidence = await getRegistrationPaymentEvidence(
          session,
          registrationEvidenceParams.registrationId,
          env,
        );
        sendSuccess(res, evidence);
      } else {
        const body = submitPaymentEvidenceSchema.parse(await readJsonBody(req) ?? {});
        const evidence = await submitRegistrationPaymentEvidence(session, {
          registrationId: registrationEvidenceParams.registrationId,
          ...body,
        }, env);
        sendSuccess(res, evidence);
      }
      return;
    }

    const eventPhotoSubmissionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/event-editions/:eventEditionId/photo-submissions",
    );
    if (eventPhotoSubmissionParams) {
      if (!enforceRateLimit(req, res, "event-photo-submissions", { limit: 12, windowMs: 60 * 60_000 })) return;
      const session = await requireSession(req);
      const body = submitEventPhotosSchema.parse(await readJsonBody(req) ?? {});
      const submission = await submitEventPhotoSubmissions(session, {
        eventEditionId: z.string().uuid().parse(eventPhotoSubmissionParams.eventEditionId),
        eventCategoryId: body.eventCategoryId,
        photos: body.photos,
      }, env);
      sendSuccess(res, submission, 201);
      return;
    }

    const cancelRegistrationParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/registrations/:registrationId/cancel");
    if (cancelRegistrationParams) {
      const session = await requireSession(req);
      const model = await cancelRegistration(session, cancelRegistrationParams.registrationId, env);
      sendSuccess(res, model);
      return;
    }

    const promoteWaitlistParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/waitlist/promote",
    );
    if (promoteWaitlistParams) {
      const session = await requireSession(req);
      promoteWaitlistSchema.parse(await readJsonBody(req) ?? {});
      const promotion = await promoteNextWaitlistRegistration(
        session,
        z.string().uuid().parse(promoteWaitlistParams.categoryId),
        env,
      );
      sendSuccess(res, promotion);
      return;
    }

    const organizerCancelRegistrationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/cancel",
    );
    if (organizerCancelRegistrationParams) {
      const session = await requireSession(req);
      const body = cancelOrganizerRegistrationSchema.parse(await readJsonBody(req) ?? {});
      const result = await cancelOrganizerRegistration(
        session,
        z.string().uuid().parse(organizerCancelRegistrationParams.registrationId),
        body.reason,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const organizerRemoveRegistrationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/remove",
    );
    if (organizerRemoveRegistrationParams) {
      const session = await requireSession(req);
      const result = await removeOrganizerRegistration(
        session,
        z.string().uuid().parse(organizerRemoveRegistrationParams.registrationId),
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const organizerRemoveAllRegistrationsParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/registrations/remove-all",
    );
    if (organizerRemoveAllRegistrationsParams) {
      if (!enforceRateLimit(req, res, "organizer-registration-remove-all", {
        limit: 5,
        windowMs: 60 * 60_000,
      })) return;
      const session = await requireSession(req);
      const result = await removeAllOrganizerRegistrations(
        session,
        z.string().uuid().parse(organizerRemoveAllRegistrationsParams.editionId),
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const recordBankPaymentParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/bank-payment",
    );
    if (recordBankPaymentParams) {
      if (!enforceRateLimit(req, res, "organizer-bank-payment", { limit: 60, windowMs: 10 * 60_000 })) return;
      const session = await requireSession(req);
      const body = recordBankPaymentSchema.parse(await readJsonBody(req) ?? {});
      const instructions = await recordRegistrationBankPayment(
        session,
        {
          registrationId: z.string().uuid().parse(recordBankPaymentParams.registrationId),
          amountCents: body.amountCents,
          currency: body.currency,
          paidAt: body.paidAt,
          bankReference: body.bankReference,
          reason: body.reason,
          idempotencyKey: parseIdempotencyKey(req),
        },
        env,
      );
      sendSuccess(res, instructions);
      return;
    }

    const recordDeskPaymentParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/desk-payment",
    );
    if (recordDeskPaymentParams) {
      if (!enforceRateLimit(req, res, "organizer-desk-payment", { limit: 120, windowMs: 10 * 60_000 })) return;
      const session = await requireSession(req);
      const payment = await recordRegistrationDeskPayment(
        session,
        {
          registrationId: z.string().uuid().parse(recordDeskPaymentParams.registrationId),
          idempotencyKey: parseIdempotencyKey(req),
        },
        env,
      );
      const registration = (
        await getOrganizerRegistrations(session, payment.eventEditionId, env)
      ).find((item) => item.id === payment.registrationId);
      if (!registration) throw notFound("Registration not found after recording desk payment");
      sendSuccess(res, registration);
      return;
    }

    const unmarkDeskPaymentParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/desk-payment/unmark",
    );
    if (unmarkDeskPaymentParams) {
      if (!enforceRateLimit(req, res, "organizer-desk-payment-unmark", { limit: 120, windowMs: 10 * 60_000 })) return;
      const session = await requireSession(req);
      const payment = await unmarkRegistrationDeskPayment(
        session,
        {
          registrationId: z.string().uuid().parse(unmarkDeskPaymentParams.registrationId),
          idempotencyKey: parseIdempotencyKey(req),
        },
        env,
      );
      const registration = (
        await getOrganizerRegistrations(session, payment.eventEditionId, env)
      ).find((item) => item.id === payment.registrationId);
      if (!registration) throw notFound("Registration not found after unmarking desk payment");
      sendSuccess(res, registration);
      return;
    }

    const refundParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/refunds",
    );
    if (refundParams) {
      const session = await requireSession(req);
      const body = createRefundSchema.parse(await readJsonBody(req) ?? {});
      const refund = await createStripeRegistrationRefund(
        session,
        {
          registrationId: z.string().uuid().parse(refundParams.registrationId),
          amountCents: body.amountCents,
          reason: body.reason,
          organizerNote: body.organizerNote,
          idempotencyKey: parseIdempotencyKey(req),
        },
        env,
      );
      sendSuccess(res, refund);
      return;
    }

    const reconciliationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/reconciliation",
    );
    if (reconciliationParams) {
      const session = await requireSession(req);
      const reconciliation = await runPaymentReconciliation(
        session,
        z.string().uuid().parse(reconciliationParams.organizationId),
        env,
      );
      sendSuccess(res, reconciliation);
      return;
    }

    const paymentAccountParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/organizations/:organizationId/payment-account",
    );
    if (paymentAccountParams) {
      const session = await requireSession(req);
      const context = await getOrganizationPaymentOnboardingContext(
        session,
        z.string().uuid().parse(paymentAccountParams.organizationId),
        env,
      );
      sendSuccess(res, context);
      return;
    }

    const bankTransferProfileGetParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/organizations/:organizationId/bank-transfer-profile",
    );
    if (bankTransferProfileGetParams) {
      const session = await requireSession(req);
      const context = await getOrganizerBankTransferContext(
        session,
        z.string().uuid().parse(bankTransferProfileGetParams.organizationId),
        env,
      );
      sendSuccess(res, context);
      return;
    }

    const bankTransferProfilePutParams = matchRoute(
      req.method,
      url.pathname,
      "PATCH",
      "/api/v1/organizer/organizations/:organizationId/bank-transfer-profile",
    );
    if (bankTransferProfilePutParams) {
      const session = await requireSession(req);
      const body = organizerBankTransferProfileSchema.parse(await readJsonBody(req) ?? {});
      const context = await saveOrganizerBankTransferProfile(
        session,
        {
          organizationId: z.string().uuid().parse(bankTransferProfilePutParams.organizationId),
          ...body,
        },
        env,
      );
      sendSuccess(res, context);
      return;
    }

    const eventPaymentSetupGetParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/events/:eventId/payment-setup",
    );
    if (eventPaymentSetupGetParams) {
      const session = await requireSession(req);
      const context = await getOrganizerEventPaymentSetup(
        session,
        z.string().uuid().parse(eventPaymentSetupGetParams.eventId),
        env,
      );
      sendSuccess(res, context);
      return;
    }

    const eventPaymentSetupConfirmParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/events/:eventId/payment-setup/confirm",
    );
    if (eventPaymentSetupConfirmParams) {
      const session = await requireSession(req);
      const body = organizerEventPaymentSetupSchema.parse(await readJsonBody(req) ?? {});
      const context = await confirmOrganizerEventPaymentSetup(
        session,
        z.string().uuid().parse(eventPaymentSetupConfirmParams.eventId),
        body,
        env,
      );
      sendSuccess(res, context);
      return;
    }

    const paymentOnboardingParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/payment-account/onboarding",
    );
    if (paymentOnboardingParams) {
      const session = await requireSession(req);
      const onboarding = await createStripeOrganizationOnboardingLink(
        session,
        z.string().uuid().parse(paymentOnboardingParams.organizationId),
        parseIdempotencyKey(req),
        env,
      );
      sendSuccess(res, onboarding);
      return;
    }

    const paymentAccountRefreshParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/payment-account/refresh",
    );
    if (paymentAccountRefreshParams) {
      const session = await requireSession(req);
      const context = await refreshStripeOrganizationPaymentAccount(
        session,
        z.string().uuid().parse(paymentAccountRefreshParams.organizationId),
        env,
      );
      sendSuccess(res, context);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/observability/organizer-interactions") {
      if (!enforceRateLimit(
        req,
        res,
        "organizer-interaction-observability",
        { limit: 60, windowMs: 60_000 },
      )) {
        return;
      }
      await requireSession(req);
      const interaction = organizerInteractionSchema.parse(await readJsonBody(req) ?? {});
      console.info(`[organizer-interaction] ${JSON.stringify(interaction)}`);
      sendSuccess(res, { recorded: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/organizer/dashboard") {
      const session = await requireSession(req);
      const model = await getOrganizerDashboardReadModel(
        session,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, model);
      return;
    }

    const organizationTeamParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/organizations/:organizationId/team",
    );
    if (organizationTeamParams) {
      const session = await requireSession(req);
      const team = await listOrganizationTeam(
        session,
        organizationTeamParams.organizationId,
        env,
      );
      sendSuccess(res, team);
      return;
    }

    const organizationRolesParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/organizations/:organizationId/roles",
    );
    if (organizationRolesParams) {
      const session = await requireSession(req);
      const roles = await listOrganizationRoles(
        session,
        z.string().uuid().parse(organizationRolesParams.organizationId),
        env,
      );
      sendSuccess(res, roles);
      return;
    }

    const saveOrganizationRoleParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/roles",
    );
    if (saveOrganizationRoleParams) {
      const session = await requireSession(req);
      const body = saveOrganizationRoleSchema.parse(await readJsonBody(req) ?? {});
      const role = await saveOrganizationRole(
        session,
        z.string().uuid().parse(saveOrganizationRoleParams.organizationId),
        body,
        env,
      );
      sendSuccess(res, role);
      return;
    }

    const organizationProfileParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/organizations/:organizationId/profile",
    );
    if (organizationProfileParams) {
      const session = await requireSession(req);
      const profile = await getOrganizerWorkspaceProfile(
        session,
        z.string().uuid().parse(organizationProfileParams.organizationId),
        env,
      );
      sendSuccess(res, profile);
      return;
    }

    const updateOrganizationProfileParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/profile",
    );
    if (updateOrganizationProfileParams) {
      const session = await requireSession(req);
      const body = updateOrganizerWorkspaceProfileSchema.parse(
        await readJsonBody(req) ?? {},
      );
      const profile = await updateOrganizerWorkspaceProfile(
        session,
        z.string().uuid().parse(updateOrganizationProfileParams.organizationId),
        body,
        env,
      );
      sendSuccess(res, profile);
      return;
    }

    const deletePracticeRacesParams = matchRoute(
      req.method, url.pathname, "POST",
      "/api/v1/organizer/organizations/:organizationId/practice-races/delete",
    );
    if (deletePracticeRacesParams) {
      const session = await requireSession(req);
      const body = z.object({ editionIds: z.array(z.string().uuid()).min(1).max(100) })
        .parse(await readJsonBody(req));
      sendSuccess(res, await deletePracticeRaces(session,
        z.string().uuid().parse(deletePracticeRacesParams.organizationId), body.editionIds, env));
      return;
    }

    const createPracticeRaceParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/practice-race",
    );
    if (createPracticeRaceParams) {
      const session = await requireSession(req);
      const body = createPracticeRaceSchema.parse(await readJsonBody(req) ?? {});
      const practiceRace = await createPracticeRace(
        session,
        z.string().uuid().parse(createPracticeRaceParams.organizationId),
        body,
        env,
      );
      sendSuccess(res, practiceRace);
      return;
    }

    const createOrganizationAccountParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/accounts",
    );
    if (createOrganizationAccountParams) {
      const session = await requireSession(req);
      const body = createOrganizationAccountSchema.parse(
        await readJsonBody(req) ?? {},
      );
      const account = await createOrganizationAccount(
        session,
        createOrganizationAccountParams.organizationId,
        body,
        env,
      );
      sendSuccess(res, account);
      return;
    }

    const transferOrganizationOwnershipParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/ownership-transfer",
    );
    if (transferOrganizationOwnershipParams) {
      const session = await requireSession(req);
      const body = transferOrganizationOwnershipSchema.parse(
        await readJsonBody(req) ?? {},
      );
      const result = await transferOrganizationOwnership(
        session,
        z.string().uuid().parse(transferOrganizationOwnershipParams.organizationId),
        body.currentOwnerMembershipId,
        body.newOwnerMembershipId,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const updateOrganizationAccountParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/accounts/:membershipId",
    );
    if (updateOrganizationAccountParams) {
      const session = await requireSession(req);
      const body = updateOrganizationAccountSchema.parse(
        await readJsonBody(req) ?? {},
      );
      const result = await updateOrganizationAccount(
        session,
        updateOrganizationAccountParams.organizationId,
        updateOrganizationAccountParams.membershipId,
        body,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const resetOrganizationPasswordParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/accounts/:membershipId/password",
    );
    if (resetOrganizationPasswordParams) {
      const session = await requireSession(req);
      const body = managedPasswordResetSchema.parse(
        await readJsonBody(req) ?? {},
      );
      const result = await resetOrganizationAccountPassword(
        session,
        resetOrganizationPasswordParams.organizationId,
        resetOrganizationPasswordParams.membershipId,
        body.newPassword,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const practiceRaceStateParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/practice-race",
    );
    if (practiceRaceStateParams) {
      const session = await requireSession(req);
      const practiceRace = await getPracticeRaceState(
        session,
        z.string().uuid().parse(practiceRaceStateParams.editionId),
        env,
      );
      sendSuccess(res, practiceRace);
      return;
    }

    const createPracticeRegistrationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/practice-race/registrations",
    );
    if (createPracticeRegistrationParams) {
      const session = await requireSession(req);
      const body = createPracticeRegistrationSchema.parse(
        await readJsonBody(req) ?? {},
      );
      const practiceRace = await createPracticeRegistration(
        session,
        z.string().uuid().parse(createPracticeRegistrationParams.editionId),
        body,
        env,
      );
      sendSuccess(res, practiceRace);
      return;
    }

    const assignPracticeBibsParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/practice-race/assign-bibs",
    );
    if (assignPracticeBibsParams) {
      const session = await requireSession(req);
      const practiceRace = await assignPracticeRaceBibs(
        session,
        z.string().uuid().parse(assignPracticeBibsParams.editionId),
        env,
      );
      sendSuccess(res, practiceRace);
      return;
    }

    const resetPracticeRaceParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/practice-race/reset",
    );
    if (resetPracticeRaceParams) {
      const session = await requireSession(req);
      const practiceRace = await resetPracticeRace(
        session,
        z.string().uuid().parse(resetPracticeRaceParams.editionId),
        env,
      );
      sendSuccess(res, practiceRace);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/organizer/events/community-summaries") {
      const session = await requireSession(req);
      const body = organizerEventCommunitySummariesSchema.parse(await readJsonBody(req) ?? {});
      sendSuccess(res, await getOrganizerEventCommunitySummaries(session, body.eventEditionIds, env));
      return;
    }

    if (req.method === "GET" && (url.pathname === "/api/v1/organizer/events" || url.pathname === "/api/v1/organizer/races")) {
      const session = await requireSession(req);
      const events = await getOrganizerEvents(
        session,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, events);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/organizer/event-summaries") {
      const session = await requireSession(req);
      const events = await getOrganizerEventSummaries(
        session,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, events);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/organizer/event-eligible-clubs") {
      const session = await requireSession(req);
      const clubs = await getOrganizerEventEligibleClubOptions(session, env);
      sendSuccess(res, clubs);
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/v1/organizer/events" || url.pathname === "/api/v1/organizer/races")) {
      const session = await requireSession(req);
      const body = organizerEventSchema.parse(await readJsonBody(req) ?? {});
      const event = await createOrganizerEvent(session, body, env);
      sendSuccess(res, event);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/organizer/tracks") {
      const session = await requireSession(req);
      const tracks = await getOrganizerTracks(
        session,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, tracks);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/organizer/track-summaries") {
      const session = await requireSession(req);
      const tracks = await getOrganizerTrackSummaries(
        session,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, tracks);
      return;
    }

    const organizerTrackDetailParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/tracks/:trackId",
    );
    if (organizerTrackDetailParams) {
      const session = await requireSession(req);
      const track = await getOrganizerTrackById(
        session,
        decodeURIComponent(organizerTrackDetailParams.trackId),
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, track);
      return;
    }

    const organizerTrackCommunityParams = matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/tracks/:trackId/community");
    if (organizerTrackCommunityParams) {
      const session = await requireSession(req);
      const trackId = z.string().uuid().parse(organizerTrackCommunityParams.trackId);
      sendSuccess(res, await getOrganizerTrackCommunity(session, trackId, env));
      return;
    }

    const removeOrganizerTrackReviewParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/tracks/:trackId/reviews/:reviewId/remove");
    if (removeOrganizerTrackReviewParams) {
      const session = await requireSession(req);
      const trackId = z.string().uuid().parse(removeOrganizerTrackReviewParams.trackId);
      const reviewId = z.string().uuid().parse(removeOrganizerTrackReviewParams.reviewId);
      sendSuccess(res, await removeOrganizerTrackReview(session, trackId, reviewId, env));
      return;
    }

    const removeOrganizerTrackCommentParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/tracks/:trackId/comments/:commentId/remove");
    if (removeOrganizerTrackCommentParams) {
      const session = await requireSession(req);
      const trackId = z.string().uuid().parse(removeOrganizerTrackCommentParams.trackId);
      const commentId = z.string().uuid().parse(removeOrganizerTrackCommentParams.commentId);
      sendSuccess(res, await removeOrganizerTrackReviewComment(session, trackId, commentId, env));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/organizer/tracks") {
      const session = await requireSession(req);
      const body = organizerTrackSchema.parse(await readJsonBody(req) ?? {});
      const track = await createOrganizerTrack(session, body, env);
      sendSuccess(res, track);
      return;
    }

    const updateOrganizerTrackParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/tracks/:trackId/update",
    );
    if (updateOrganizerTrackParams) {
      const session = await requireSession(req);
      const body = organizerTrackUpdateSchema.parse(await readJsonBody(req) ?? {});
      const track = await updateOrganizerTrack(
        session,
        {
          trackTemplateId: updateOrganizerTrackParams.trackId,
          ...body,
        },
        env,
      );
      sendSuccess(res, track);
      return;
    }

    const deleteOrganizerTrackParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/tracks/:trackId/delete",
    );
    if (deleteOrganizerTrackParams) {
      const session = await requireSession(req);
      const result = await deleteOrganizerTrack(session, deleteOrganizerTrackParams.trackId, env);
      sendSuccess(res, result);
      return;
    }

    const organizerTrackGpxParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/tracks/:trackId/versions/:versionId/gpx",
    );
    if (organizerTrackGpxParams) {
      const session = await requireSession(req);
      const file = await getOrganizerTrackGpxDownload(
        session,
        organizerTrackGpxParams.trackId,
        organizerTrackGpxParams.versionId,
        env,
      );
      sendFile(res, file);
      return;
    }

    const publicTrackGpxParams = matchRoute(req.method, url.pathname, "GET", "/api/v1/tracks/:trackSlug/gpx");
    if (publicTrackGpxParams) {
      const file = await getPublicTrackGpxDownload(publicTrackGpxParams.trackSlug, env);
      sendFile(res, file);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/organizer/league-seasons") {
      const session = await requireSession(req);
      const seasons = await getOrganizerLeagueSeasons(
        session,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, seasons);
      return;
    }

    const organizerLeagueSeasonParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/league-seasons/:seasonId",
    );
    if (organizerLeagueSeasonParams) {
      const session = await requireSession(req);
      const season = await getOrganizerLeagueSeasonById(
        session,
        organizerLeagueSeasonParams.seasonId,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, season);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/organizer/league-seasons") {
      const session = await requireSession(req);
      const body = organizerLeagueSchema.parse(await readJsonBody(req) ?? {});
      const season = await createOrganizerLeagueSeason(session, body, env);
      sendSuccess(res, season);
      return;
    }

    const leagueScheduleListParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/league-seasons/:seasonId/recurrence-rules",
    );
    if (leagueScheduleListParams) {
      const session = await requireSession(req);
      const schedules = await getRecreationalLeagueSchedules(
        session,
        leagueScheduleListParams.seasonId,
        env,
      );
      sendSuccess(res, schedules);
      return;
    }

    const leagueScheduleCreateParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/recurrence-rules",
    );
    if (leagueScheduleCreateParams) {
      const session = await requireSession(req);
      const body = recreationalLeagueScheduleSchema.parse(await readJsonBody(req) ?? {});
      const { generateNow, ...scheduleDefinition } = body;
      const schedule = generateNow
        ? await generateRecreationalLeagueSchedule(
            session,
            { ...scheduleDefinition, seasonId: leagueScheduleCreateParams.seasonId },
            env,
          )
        : await createRecreationalLeagueSchedule(
            session,
            { ...scheduleDefinition, seasonId: leagueScheduleCreateParams.seasonId },
            env,
          );
      sendSuccess(res, schedule);
      return;
    }

    const leagueScheduleMaterializeParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/recurrence-rules/:ruleId/materialize",
    );
    if (leagueScheduleMaterializeParams) {
      const session = await requireSession(req);
      const schedule = await materializeRecreationalLeagueSchedule(
        session,
        leagueScheduleMaterializeParams.seasonId,
        leagueScheduleMaterializeParams.ruleId,
        env,
      );
      sendSuccess(res, schedule);
      return;
    }

    const leagueImportReviewParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/league-seasons/:seasonId/import-review",
    );
    if (leagueImportReviewParams) {
      const session = await requireSession(req);
      const workspace = await getLegacyImportReviewWorkspace(
        session,
        leagueImportReviewParams.seasonId,
        env,
      );
      sendSuccess(res, workspace);
      return;
    }

    const organizerEventParams =
      matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/races/:eventId")
      ?? matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/events/:eventId");
    if (organizerEventParams) {
      const session = await requireSession(req);
      const event = await getOrganizerEventById(
        session,
        organizerEventParams.eventId,
        env,
        parseOrganizerWorkspaceOrganizationId(url),
      );
      sendSuccess(res, event);
      return;
    }

    const organizerEventReadinessParams =
      matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/races/:eventId/readiness")
      ?? matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/events/:eventId/readiness");
    if (organizerEventReadinessParams) {
      const session = await requireSession(req);
      const readiness = await getOrganizerEventPublishReadiness(
        session,
        organizerEventReadinessParams.eventId,
        env,
      );
      sendSuccess(res, readiness);
      return;
    }

    const updateOrganizerEventParams =
      matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/races/:eventId/update")
      ?? matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/events/:eventId/update");
    if (updateOrganizerEventParams) {
      const session = await requireSession(req);
      const body = organizerEventUpdateSchema.parse(await readJsonBody(req) ?? {});
      const event = await updateOrganizerEvent(
        session,
        {
          id: updateOrganizerEventParams.eventId,
          ...body,
        },
        env,
      );
      sendSuccess(res, event);
      return;
    }

    const publishOrganizerEventParams =
      matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/races/:eventId/publish")
      ?? matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/events/:eventId/publish");
    if (publishOrganizerEventParams) {
      const session = await requireSession(req);
      const body = publishOrganizerEventSchema.parse(await readJsonBody(req) ?? {});
      const event = await publishOrganizerEvent(
        session,
        publishOrganizerEventParams.eventId,
        body,
        env,
      );
      sendSuccess(res, event);
      return;
    }

    const unpublishOrganizerEventParams =
      matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/races/:eventId/unpublish")
      ?? matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/events/:eventId/unpublish");
    if (unpublishOrganizerEventParams) {
      const session = await requireSession(req);
      const event = await unpublishOrganizerEvent(session, unpublishOrganizerEventParams.eventId, env);
      sendSuccess(res, event);
      return;
    }

    const deleteOrganizerEventParams =
      matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/races/:eventId/delete")
      ?? matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/events/:eventId/delete");
    if (deleteOrganizerEventParams) {
      const session = await requireSession(req);
      const result = await deleteOrganizerEvent(session, deleteOrganizerEventParams.eventId, env);
      sendSuccess(res, result);
      return;
    }

    const createOrganizerCategoryParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/editions/:editionId/categories");
    if (createOrganizerCategoryParams) {
      const session = await requireSession(req);
      const body = organizerCategorySchema.parse(await readJsonBody(req) ?? {});
      const category = await createOrganizerCategory(
        session,
        createOrganizerCategoryParams.editionId,
        {
          ...body,
          idempotencyKey: parseOptionalIdempotencyKey(req),
        },
        env,
      );
      sendSuccess(res, category);
      return;
    }

    const updateOrganizerCategoryParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/categories/:categoryId/update");
    if (updateOrganizerCategoryParams) {
      const session = await requireSession(req);
      const body = organizerCategoryUpdateSchema.parse(await readJsonBody(req) ?? {});
      const category = await updateOrganizerCategory(
        session,
        {
          id: updateOrganizerCategoryParams.categoryId,
          ...body,
        },
        env,
      );
      sendSuccess(res, category);
      return;
    }

    const organizerRegistrationConfigurationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/registration-configuration/publish",
    );
    if (organizerRegistrationConfigurationParams) {
      const session = await requireSession(req);
      const body = publishRegistrationConfigurationSchema.parse(await readJsonBody(req) ?? {});
      const configuration = await publishRegistrationConfiguration(
        session,
        z.string().uuid().parse(organizerRegistrationConfigurationParams.categoryId),
        body,
        env,
      );
      sendSuccess(res, configuration);
      return;
    }

    const getOrganizerRegistrationConfigurationParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/categories/:categoryId/registration-configuration",
    );
    if (getOrganizerRegistrationConfigurationParams) {
      const session = await requireSession(req);
      const configuration = await getOrganizerRegistrationConfiguration(
        session,
        z.string().uuid().parse(getOrganizerRegistrationConfigurationParams.categoryId),
        env,
      );
      sendSuccess(res, configuration);
      return;
    }

    const updateOrganizerCheckpointParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/checkpoints/:checkpointId/update",
    );
    if (updateOrganizerCheckpointParams) {
      const session = await requireSession(req);
      const body = organizerCheckpointUpdateSchema.parse(await readJsonBody(req) ?? {});
      const checkpoint = await updateOrganizerCheckpoint(
        session,
        {
          checkpointId: updateOrganizerCheckpointParams.checkpointId,
          ...body,
        },
        env,
      );
      sendSuccess(res, checkpoint);
      return;
    }

    const syncOrganizerCategoryCheckpointsParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/checkpoints/sync",
    );
    if (syncOrganizerCategoryCheckpointsParams) {
      const session = await requireSession(req);
      const body = organizerCheckpointSyncSchema.parse(await readJsonBody(req) ?? {});
      const category = await syncOrganizerCategoryCheckpoints(
        session,
        {
          categoryId: syncOrganizerCategoryCheckpointsParams.categoryId,
          ...body,
        },
        env,
      );
      sendSuccess(res, category);
      return;
    }

    const deleteOrganizerCategoryParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/categories/:categoryId/delete");
    if (deleteOrganizerCategoryParams) {
      const session = await requireSession(req);
      const result = await deleteOrganizerCategory(session, deleteOrganizerCategoryParams.categoryId, env);
      sendSuccess(res, result);
      return;
    }

    const assignOrganizerCategoryTrackParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/track",
    );
    if (assignOrganizerCategoryTrackParams) {
      const session = await requireSession(req);
      const body = organizerCategoryTrackSchema.parse(await readJsonBody(req) ?? {});
      const category = await assignOrganizerCategoryTrack(
        session,
        assignOrganizerCategoryTrackParams.categoryId,
        body,
        env,
      );
      sendSuccess(res, category);
      return;
    }

    const detachOrganizerCategoryTrackParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/track/detach",
    );
    if (detachOrganizerCategoryTrackParams) {
      const session = await requireSession(req);
      const category = await detachOrganizerCategoryTrack(
        session,
        detachOrganizerCategoryTrackParams.categoryId,
        env,
      );
      sendSuccess(res, category);
      return;
    }

    const publishTrackParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/tracks/:trackId/versions/:versionId/publish",
    );
    if (publishTrackParams) {
      const session = await requireSession(req);
      const track = await publishOrganizerTrackVersion(
        session,
        publishTrackParams.trackId,
        publishTrackParams.versionId,
        env,
      );
      sendSuccess(res, track);
      return;
    }

    const unpublishTrackParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/tracks/:trackId/versions/:versionId/unpublish",
    );
    if (unpublishTrackParams) {
      const session = await requireSession(req);
      const track = await unpublishOrganizerTrackVersion(
        session,
        unpublishTrackParams.trackId,
        unpublishTrackParams.versionId,
        env,
      );
      sendSuccess(res, track);
      return;
    }

    const updateLeagueSeasonParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/update",
    );
    if (updateLeagueSeasonParams) {
      const session = await requireSession(req);
      const body = organizerLeagueUpdateSchema.parse(await readJsonBody(req) ?? {});
      const season = await updateOrganizerLeagueSeason(
        session,
        {
          ...body,
          seasonId: updateLeagueSeasonParams.seasonId,
        },
        env,
      );
      sendSuccess(res, season);
      return;
    }

    const attachLeagueRoundParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/rounds",
    );
    if (attachLeagueRoundParams) {
      const session = await requireSession(req);
      const body = organizerLeagueRoundSchema.parse(await readJsonBody(req) ?? {});
      const season = await attachOrganizerLeagueRound(session, attachLeagueRoundParams.seasonId, body, env);
      sendSuccess(res, season);
      return;
    }

    const detachLeagueRoundParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/rounds/:roundId/delete",
    );
    if (detachLeagueRoundParams) {
      const session = await requireSession(req);
      const season = await detachOrganizerLeagueRound(
        session,
        detachLeagueRoundParams.seasonId,
        detachLeagueRoundParams.roundId,
        env,
      );
      sendSuccess(res, season);
      return;
    }

    const detachAllLeagueRoundsParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/rounds/delete-all",
    );
    if (detachAllLeagueRoundsParams) {
      const session = await requireSession(req);
      const season = await detachAllOrganizerLeagueRounds(
        session,
        detachAllLeagueRoundsParams.seasonId,
        env,
      );
      sendSuccess(res, season);
      return;
    }

    const publishLeagueSeasonRacesParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/races/publish-all",
    );
    if (publishLeagueSeasonRacesParams) {
      const session = await requireSession(req);
      const result = await publishOrganizerLeagueSeasonRaces(
        session,
        publishLeagueSeasonRacesParams.seasonId,
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const publishLeagueSeasonParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/league-seasons/:seasonId/publish",
    );
    if (publishLeagueSeasonParams) {
      const session = await requireSession(req);
      const season = await publishOrganizerLeagueSeason(session, publishLeagueSeasonParams.seasonId, env);
      sendSuccess(res, season);
      return;
    }

    const deleteLeagueParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/leagues/:leagueId/delete");
    if (deleteLeagueParams) {
      const session = await requireSession(req);
      const result = await deleteOrganizerLeague(session, deleteLeagueParams.leagueId, env);
      sendSuccess(res, result);
      return;
    }

    const organizerRegistrationsParams = matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/editions/:editionId/registrations");
    if (organizerRegistrationsParams) {
      const session = await requireSession(req);
      const registrations = await getOrganizerRegistrations(session, organizerRegistrationsParams.editionId, env);
      sendSuccess(res, registrations);
      return;
    }

    const organizerFinanceParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/finance-dashboard",
    );
    if (organizerFinanceParams) {
      const session = await requireSession(req);
      const dashboard = await getOrganizerFinanceDashboard(
        session,
        z.string().uuid().parse(organizerFinanceParams.editionId),
        env,
      );
      sendSuccess(res, dashboard);
      return;
    }

    const organizerOnsiteAthleteMatchesParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/onsite-athlete-matches",
    );
    if (organizerOnsiteAthleteMatchesParams) {
      const session = await requireSession(req);
      const body = organizerOnsiteAthleteMatchSchema.parse(await readJsonBody(req) ?? {});
      const matches = await findOrganizerOnsiteAthleteMatches(
        session,
        z.string().uuid().parse(organizerOnsiteAthleteMatchesParams.editionId),
        body,
        env,
      );
      sendSuccess(res, matches);
      return;
    }

    const organizerOnsiteRegistrationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/onsite-registrations",
    );
    if (organizerOnsiteRegistrationParams) {
      const session = await requireSession(req);
      const body = organizerOnsiteRegistrationSchema.parse(await readJsonBody(req) ?? {});
      const result = await createOrganizerOnsiteRegistration(
        session,
        z.string().uuid().parse(organizerOnsiteRegistrationParams.editionId),
        {
          ...body,
          idempotencyKey: parseIdempotencyKey(req),
        },
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const registrationImportPreviewParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/registration-imports/preview",
    );
    if (registrationImportPreviewParams) {
      const session = await requireSession(req);
      const body = registrationImportPreviewSchema.parse(await readJsonBody(req) ?? {});
      const preview = await createRegistrationImportPreview(
        session,
        z.string().uuid().parse(registrationImportPreviewParams.editionId),
        {
          ...body,
          idempotencyKey: parseIdempotencyKey(req),
        },
        env,
      );
      sendSuccess(res, preview);
      return;
    }

    const registrationImportParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/registration-imports/:jobId",
    );
    if (registrationImportParams) {
      const session = await requireSession(req);
      const preview = await getRegistrationImport(
        session,
        z.string().uuid().parse(registrationImportParams.jobId),
        env,
      );
      sendSuccess(res, preview);
      return;
    }

    const registrationImportCommitParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registration-imports/:jobId/commit",
    );
    if (registrationImportCommitParams) {
      const session = await requireSession(req);
      const result = await commitRegistrationImport(
        session,
        z.string().uuid().parse(registrationImportCommitParams.jobId),
        env,
      );
      sendSuccess(res, result);
      return;
    }

    const communicationTemplatesParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/organizations/:organizationId/communication-templates",
    );
    if (communicationTemplatesParams) {
      const session = await requireSession(req);
      const templates = await listCommunicationTemplates(
        session,
        z.string().uuid().parse(communicationTemplatesParams.organizationId),
        env,
      );
      sendSuccess(res, templates);
      return;
    }

    const saveCommunicationTemplateParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/communication-templates",
    );
    if (saveCommunicationTemplateParams) {
      const session = await requireSession(req);
      const body = communicationTemplateSchema.parse(await readJsonBody(req) ?? {});
      const template = await saveCommunicationTemplate(
        session,
        z.string().uuid().parse(saveCommunicationTemplateParams.organizationId),
        body,
        env,
      );
      sendSuccess(res, template);
      return;
    }

    const communicationCampaignsParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/communication-campaigns",
    );
    if (communicationCampaignsParams) {
      const session = await requireSession(req);
      const campaigns = await listCommunicationCampaigns(
        session,
        z.string().uuid().parse(communicationCampaignsParams.editionId),
        env,
      );
      sendSuccess(res, campaigns);
      return;
    }

    const scheduleCommunicationCampaignParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/communication-campaigns",
    );
    if (scheduleCommunicationCampaignParams) {
      const session = await requireSession(req);
      const body = communicationCampaignSchema.parse(await readJsonBody(req) ?? {});
      const campaign = await scheduleCommunicationCampaign(
        session,
        z.string().uuid().parse(scheduleCommunicationCampaignParams.editionId),
        body,
        env,
      );
      sendSuccess(res, campaign);
      return;
    }

    const cancelCommunicationCampaignParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/communication-campaigns/:campaignId/cancel",
    );
    if (cancelCommunicationCampaignParams) {
      const session = await requireSession(req);
      const body = communicationCampaignCancelSchema.parse(await readJsonBody(req) ?? {});
      const campaign = await cancelCommunicationCampaign(
        session,
        z.string().uuid().parse(cancelCommunicationCampaignParams.campaignId),
        body.reason,
        env,
      );
      sendSuccess(res, campaign);
      return;
    }

    const preRaceReadinessParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/pre-race-readiness",
    );
    if (preRaceReadinessParams) {
      const session = await requireSession(req);
      const readiness = await getPreRaceReadiness(
        session,
        z.string().uuid().parse(preRaceReadinessParams.editionId),
        env,
      );
      sendSuccess(res, readiness);
      return;
    }

    const raceStartControlParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/race-start-control",
    );
    if (raceStartControlParams) {
      const session = await requireSession(req);
      const state = await getRaceStartControlState(
        session,
        z.string().uuid().parse(raceStartControlParams.editionId),
        env,
      );
      sendSuccess(res, state);
      return;
    }

    const finishRaceParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/finish-race",
    );
    if (finishRaceParams) {
      const session = await requireSession(req);
      const body = finishRaceSchema.parse(await readJsonBody(req) ?? {});
      const result = await finishRace(
        session,
        z.string().uuid().parse(finishRaceParams.editionId),
        body.categoryIds,
        body.clientEventId,
        body.acknowledgeUnfinishedAsDnf,
        env,
        body.overrideReason,
      );
      sendSuccess(res, result);
      return;
    }

    const raceStartEventParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/start-events",
    );
    if (raceStartEventParams) {
      const session = await requireSession(req);
      const body = raceStartEventSchema.parse(await readJsonBody(req) ?? {});
      const event = await recordRaceStartEvent(
        session,
        z.string().uuid().parse(raceStartEventParams.categoryId),
        {
          ...body,
          occurredAt:
            body.eventType === "actual_start"
              ? new Date().toISOString()
              : body.occurredAt ?? new Date().toISOString(),
          startMethod: body.eventType === "actual_start" ? "mass_gun" : body.startMethod,
        },
        env,
      );
      sendSuccess(res, event);
      return;
    }

    const participantStatusParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/participant-status",
    );
    if (participantStatusParams) {
      const session = await requireSession(req);
      const body = participantStatusSchema.parse(await readJsonBody(req) ?? {});
      const status = await recordParticipantStatus(
        session,
        z.string().uuid().parse(participantStatusParams.registrationId),
        body,
        env,
      );
      sendSuccess(res, status);
      return;
    }

    const manualResultTimingObservationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/registrations/:registrationId/result-timing-observations",
    );
    if (manualResultTimingObservationParams) {
      const session = await requireSession(req);
      const body = manualResultTimingObservationSchema.parse(await readJsonBody(req) ?? {});
      const observation = await createManualResultTimingObservation(
        session,
        z.string().uuid().parse(manualResultTimingObservationParams.registrationId),
        body,
        env,
      );
      sendSuccess(res, observation);
      return;
    }

    const punchRevisionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/timing-events/:punchEventId/revisions",
    );
    if (punchRevisionParams) {
      const session = await requireSession(req);
      const body = punchRevisionSchema.parse(await readJsonBody(req) ?? {});
      const revision = await revisePunchEvent(
        session,
        z.string().uuid().parse(punchRevisionParams.punchEventId),
        body,
        env,
      );
      sendSuccess(res, revision);
      return;
    }

    const resultAnomalyResolutionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/result-anomalies/:anomalyId/resolve",
    );
    if (resultAnomalyResolutionParams) {
      const session = await requireSession(req);
      const body = resultAnomalyResolutionSchema.parse(await readJsonBody(req) ?? {});
      const anomaly = await resolveResultAnomaly(
        session,
        z.string().uuid().parse(resultAnomalyResolutionParams.anomalyId),
        body,
        env,
      );
      sendSuccess(res, anomaly);
      return;
    }

    const timingDeviceParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/timing-devices",
    );
    if (timingDeviceParams) {
      const session = await requireSession(req);
      const body = timingDeviceSchema.parse(await readJsonBody(req) ?? {});
      const device = await saveTimingDevice(
        session,
        z.string().uuid().parse(timingDeviceParams.organizationId),
        body,
        env,
      );
      sendSuccess(res, device);
      return;
    }

    const timingIntegrationsParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/timing-integrations",
    );
    if (timingIntegrationsParams) {
      const session = await requireSession(req);
      const state = await getTimingFleetState(
        session,
        z.string().uuid().parse(timingIntegrationsParams.editionId),
        env,
      );
      sendSuccess(res, state);
      return;
    }

    const timingFleetDeviceParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/timing-fleet/devices",
    );
    if (timingFleetDeviceParams) {
      const session = await requireSession(req);
      const body = timingFleetDeviceSchema.parse(await readJsonBody(req) ?? {});
      const device = await registerTimingFleetDevice(
        session,
        z.string().uuid().parse(timingFleetDeviceParams.organizationId),
        body,
        env,
      );
      sendSuccess(res, device);
      return;
    }

    const timingDeviceAssignmentParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/timing-device-assignments",
    );
    if (timingDeviceAssignmentParams) {
      const session = await requireSession(req);
      const body = timingDeviceAssignmentSchema.parse(await readJsonBody(req) ?? {});
      const assignment = await createTimingDeviceAssignment(
        session,
        z.string().uuid().parse(timingDeviceAssignmentParams.editionId),
        body,
        env,
      );
      sendSuccess(res, assignment);
      return;
    }

    const timingDeviceAssignmentStatusParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/timing-device-assignments/:assignmentId/status",
    );
    if (timingDeviceAssignmentStatusParams) {
      const session = await requireSession(req);
      const body = timingDeviceAssignmentUpdateSchema.parse(await readJsonBody(req) ?? {});
      const assignment = await updateTimingDeviceAssignment(
        session,
        z.string().uuid().parse(timingDeviceAssignmentStatusParams.assignmentId),
        body,
        env,
      );
      sendSuccess(res, assignment);
      return;
    }

    const timingFleetDeviceEventParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/timing-devices/:timingDeviceId/events",
    );
    if (timingFleetDeviceEventParams) {
      const session = await requireSession(req);
      const body = timingFleetDeviceEventSchema.parse(await readJsonBody(req) ?? {});
      const event = await appendTimingDeviceEvent(
        session,
        z.string().uuid().parse(timingFleetDeviceEventParams.timingDeviceId),
        body,
        env,
      );
      sendSuccess(res, event);
      return;
    }

    const timingProviderConnectionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/organizations/:organizationId/timing-providers",
    );
    if (timingProviderConnectionParams) {
      const session = await requireSession(req);
      const body = timingProviderConnectionSchema.parse(await readJsonBody(req) ?? {});
      const connection = await saveTimingProviderConnection(
        session,
        z.string().uuid().parse(timingProviderConnectionParams.organizationId),
        body,
        env,
      );
      sendSuccess(res, connection);
      return;
    }

    const timingPlanParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/timing-plan",
    );
    if (timingPlanParams) {
      const session = await requireSession(req);
      const body = timingPlanSchema.parse(await readJsonBody(req) ?? {});
      const timingPlan = await publishTimingPlan(
        session,
        z.string().uuid().parse(timingPlanParams.editionId),
        body,
        env,
      );
      sendSuccess(res, timingPlan);
      return;
    }

    const rehearsalParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/rehearsals",
    );
    if (rehearsalParams) {
      const session = await requireSession(req);
      const body = rehearsalSchema.parse(await readJsonBody(req) ?? {});
      const rehearsal = await recordPreRaceRehearsal(
        session,
        z.string().uuid().parse(rehearsalParams.editionId),
        body,
        env,
      );
      sendSuccess(res, rehearsal);
      return;
    }

    const allocateBibsParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/bibs/allocate",
    );
    if (allocateBibsParams) {
      const session = await requireSession(req);
      const body = allocateBibsSchema.parse(await readJsonBody(req) ?? {});
      const allocation = await allocateCategoryBibs(
        session,
        z.string().uuid().parse(allocateBibsParams.categoryId),
        {
          ...body,
          idempotencyKey: parseIdempotencyKey(req),
        },
        env,
      );
      sendSuccess(res, allocation);
      return;
    }

    const freezeStartListParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/start-list/freeze",
    );
    if (freezeStartListParams) {
      const session = await requireSession(req);
      const body = freezeStartListSchema.parse(await readJsonBody(req) ?? {});
      const manifest = await freezeStartListManifest(
        session,
        z.string().uuid().parse(freezeStartListParams.editionId),
        body.note ?? null,
        env,
      );
      sendSuccess(res, manifest);
      return;
    }

    const reopenStartListParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/start-list/reopen",
    );
    if (reopenStartListParams) {
      const session = await requireSession(req);
      const body = reopenStartListSchema.parse(await readJsonBody(req) ?? {});
      const state = await reopenStartList(
        session,
        z.string().uuid().parse(reopenStartListParams.editionId),
        body.reason,
        env,
      );
      sendSuccess(res, state);
      return;
    }

    const startListManifestParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/start-list/manifests/:manifestId",
    );
    if (startListManifestParams) {
      const session = await requireSession(req);
      const manifest = await getStartListManifest(
        session,
        z.string().uuid().parse(startListManifestParams.editionId),
        z.string().uuid().parse(startListManifestParams.manifestId),
        env,
      );
      sendSuccess(res, manifest);
      return;
    }

    const raceDayParams = matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/editions/:editionId/race-day");
    if (raceDayParams) {
      const session = await requireSession(req);
      const state = await getRaceDayState(session, raceDayParams.editionId, env);
      sendSuccess(res, state);
      return;
    }

    const timingSessionParams = matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/timing-sessions/:sessionId");
    if (timingSessionParams) {
      const session = await requireSession(req);
      const detail = await getTimingSessionDetail(session, timingSessionParams.sessionId, env);
      sendSuccess(res, detail);
      return;
    }

    const categoryResultsParams = matchRoute(req.method, url.pathname, "GET", "/api/v1/organizer/categories/:categoryId/results");
    if (categoryResultsParams) {
      const session = await requireSession(req);
      const preferredRunId = z.string().uuid().optional().parse(
        url.searchParams.get("resultRunId") ?? undefined,
      );
      const results = await getCategoryResults(
        session,
        categoryResultsParams.categoryId,
        env,
        preferredRunId,
      );
      sendSuccess(res, results);
      return;
    }

    const fieldAccountingParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/categories/:categoryId/field-accounting",
    );
    if (fieldAccountingParams) {
      const session = await requireSession(req);
      const state = await getFieldAccountingState(session, fieldAccountingParams.categoryId, env);
      sendSuccess(res, state);
      return;
    }

    const dnsReviewParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/categories/:categoryId/dns-review",
    );
    if (dnsReviewParams) {
      const session = await requireSession(req);
      const review = await getDnsReview(session, dnsReviewParams.categoryId, url.searchParams.get("review"), env);
      sendSuccess(res, review);
      return;
    }

    const safetyCommandParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/safety",
    );
    if (safetyCommandParams) {
      const session = await requireSession(req);
      const state = await getSafetyCommandState(
        session,
        safetyCommandParams.editionId,
        { accessPurpose: url.searchParams.get("purpose") ?? undefined },
        env,
      );
      sendSuccess(res, state);
      return;
    }

    const operationsPlanParams = matchRoute(
      req.method,
      url.pathname,
      "GET",
      "/api/v1/organizer/editions/:editionId/operations-plan",
    );
    if (operationsPlanParams) {
      const session = await requireSession(req);
      const state = await getWorkforceLogisticsState(session, operationsPlanParams.editionId, env);
      sendSuccess(res, state);
      return;
    }

    const updateOrganizerRegistrationParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/registrations/:registrationId/update");
    if (updateOrganizerRegistrationParams) {
      const session = await requireSession(req);
      const body = updateRegistrationSchema.parse(await readJsonBody(req) ?? {});
      const registration = await updateOrganizerRegistration(session, {
        registrationId: updateOrganizerRegistrationParams.registrationId,
        ...body,
      }, env);
      sendSuccess(res, registration);
      return;
    }

    const reviewPaymentEvidenceParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/payment-evidence/:evidenceId/review",
    );
    if (reviewPaymentEvidenceParams) {
      const session = await requireSession(req);
      const body = reviewPaymentEvidenceSchema.parse(await readJsonBody(req) ?? {});
      const evidence = await reviewRegistrationPaymentEvidence(
        session,
        reviewPaymentEvidenceParams.evidenceId,
        body,
        env,
      );
      sendSuccess(res, evidence);
      return;
    }

    const assignBibParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/registrations/:registrationId/bib");
    if (assignBibParams) {
      const session = await requireSession(req);
      const body = assignBibSchema.parse(await readJsonBody(req) ?? {});
      const registration = await updateOrganizerRegistration(session, {
        registrationId: assignBibParams.registrationId,
        bibNumber: body.bibNumber ?? null,
      }, env);
      sendSuccess(res, registration);
      return;
    }

    const checkInParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/registrations/:registrationId/check-in");
    if (checkInParams) {
      const session = await requireSession(req);
      const body = checkInSchema.parse(await readJsonBody(req) ?? {});
      const registration = await checkInRegistration(session, checkInParams.registrationId, body, env);
      sendSuccess(res, registration);
      return;
    }

    const undoCheckInParams = matchRoute(req.method, url.pathname, "DELETE", "/api/v1/organizer/registrations/:registrationId/check-in");
    if (undoCheckInParams) {
      const session = await requireSession(req);
      const registration = await undoRegistrationCheckIn(session, undoCheckInParams.registrationId, env);
      sendSuccess(res, registration);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/organizer/timing-sessions") {
      const session = await requireSession(req);
      const body = createTimingSessionSchema.parse(await readJsonBody(req) ?? {});
      const timingSession = await createTimingSession(session, body, env);
      sendSuccess(res, timingSession);
      return;
    }

    const closeSessionParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/timing-sessions/:sessionId/close");
    if (closeSessionParams) {
      const session = await requireSession(req);
      const timingSession = await closeTimingSession(session, closeSessionParams.sessionId, env);
      sendSuccess(res, timingSession);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/organizer/punches") {
      const session = await requireSession(req);
      const body = recordPunchSchema.parse(await readJsonBody(req) ?? {});
      const punch = await recordPunch(session, body, env);
      sendSuccess(res, punch);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/organizer/shared-punches") {
      const session = await requireSession(req);
      const body = recordSharedPunchSchema.parse(await readJsonBody(req) ?? {});
      const punch = await recordSharedPunch(session, body, env);
      sendSuccess(res, punch);
      return;
    }

    const cutoffActionParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/cutoff-actions",
    );
    if (cutoffActionParams) {
      const session = await requireSession(req);
      const body = cutoffActionSchema.parse(await readJsonBody(req) ?? {});
      const action = await recordCutoffAction(session, cutoffActionParams.categoryId, body, env);
      sendSuccess(res, action);
      return;
    }

    const checkpointOperationParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/checkpoints/:checkpointId/operations",
    );
    if (checkpointOperationParams) {
      const session = await requireSession(req);
      const body = checkpointOperationSchema.parse(await readJsonBody(req) ?? {});
      const operation = await recordCheckpointOperation(
        session,
        checkpointOperationParams.checkpointId,
        body,
        env,
      );
      sendSuccess(res, operation);
      return;
    }

    const fieldSignoffParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/field-accounting/signoff",
    );
    if (fieldSignoffParams) {
      const session = await requireSession(req);
      const body = fieldAccountingSignoffSchema.parse(await readJsonBody(req) ?? {});
      const signoff = await signoffFieldAccounting(session, fieldSignoffParams.categoryId, body, env);
      sendSuccess(res, signoff);
      return;
    }

    const publicLiveSettingsParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/public-live",
    );
    if (publicLiveSettingsParams) {
      const session = await requireSession(req);
      const body = publicLiveSettingsSchema.parse(await readJsonBody(req) ?? {});
      const settings = await configurePublicLive(session, publicLiveSettingsParams.categoryId, body, env);
      sendSuccess(res, settings);
      return;
    }

    const createDnsReviewParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/dns-review",
    );
    if (createDnsReviewParams) {
      const session = await requireSession(req);
      const body = createDnsReviewSchema.parse(await readJsonBody(req) ?? {});
      const review = await createDnsReview(session, createDnsReviewParams.categoryId, body, env);
      sendSuccess(res, review);
      return;
    }

    const commitDnsReviewParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/dns-reviews/:reviewId/commit",
    );
    if (commitDnsReviewParams) {
      const session = await requireSession(req);
      const review = await commitDnsReview(session, commitDnsReviewParams.reviewId, env);
      sendSuccess(res, review);
      return;
    }

    const safetyPlanParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/safety-plan-versions",
    );
    if (safetyPlanParams) {
      const session = await requireSession(req);
      const body = safetyPlanVersionSchema.parse(await readJsonBody(req) ?? {});
      const plan = await createSafetyPlanVersion(session, safetyPlanParams.editionId, body, env);
      sendSuccess(res, plan);
      return;
    }

    const safetyIncidentParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/safety-incidents",
    );
    if (safetyIncidentParams) {
      const session = await requireSession(req);
      const body = safetyIncidentSchema.parse(await readJsonBody(req) ?? {});
      const incident = await createSafetyIncident(session, safetyIncidentParams.editionId, body, env);
      sendSuccess(res, incident);
      return;
    }

    const safetyIncidentEventParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/safety-incidents/:incidentId/events",
    );
    if (safetyIncidentEventParams) {
      const session = await requireSession(req);
      const body = safetyIncidentEventSchema.parse(await readJsonBody(req) ?? {});
      const incidentEvent = await appendSafetyIncidentEvent(
        session,
        safetyIncidentEventParams.incidentId,
        body,
        env,
      );
      sendSuccess(res, incidentEvent);
      return;
    }

    const staffAssignmentParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/staff-assignments",
    );
    if (staffAssignmentParams) {
      const session = await requireSession(req);
      const body = staffAssignmentSchema.parse(await readJsonBody(req) ?? {});
      const assignment = await createStaffAssignment(session, staffAssignmentParams.editionId, body, env);
      sendSuccess(res, assignment);
      return;
    }

    const staffAssignmentEventParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/staff-assignments/:assignmentId/events",
    );
    if (staffAssignmentEventParams) {
      const session = await requireSession(req);
      const body = staffAssignmentEventSchema.parse(await readJsonBody(req) ?? {});
      const assignmentEvent = await appendStaffAssignmentEvent(
        session,
        staffAssignmentEventParams.assignmentId,
        body,
        env,
      );
      sendSuccess(res, assignmentEvent);
      return;
    }

    const operationsTaskParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/operations-tasks",
    );
    if (operationsTaskParams) {
      const session = await requireSession(req);
      const body = operationsTaskSchema.parse(await readJsonBody(req) ?? {});
      const task = await createOperationsTask(session, operationsTaskParams.editionId, body, env);
      sendSuccess(res, task);
      return;
    }

    const operationsTaskEventParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/operations-tasks/:taskId/events",
    );
    if (operationsTaskEventParams) {
      const session = await requireSession(req);
      const body = operationsTaskEventSchema.parse(await readJsonBody(req) ?? {});
      const taskEvent = await appendOperationsTaskEvent(
        session,
        operationsTaskEventParams.taskId,
        body,
        env,
      );
      sendSuccess(res, taskEvent);
      return;
    }

    const inventoryItemParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/editions/:editionId/inventory-items",
    );
    if (inventoryItemParams) {
      const session = await requireSession(req);
      const body = eventInventoryItemSchema.parse(await readJsonBody(req) ?? {});
      const item = await createEventInventoryItem(session, inventoryItemParams.editionId, body, env);
      sendSuccess(res, item);
      return;
    }

    const inventoryMovementParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/inventory-items/:inventoryItemId/movements",
    );
    if (inventoryMovementParams) {
      const session = await requireSession(req);
      const body = inventoryMovementSchema.parse(await readJsonBody(req) ?? {});
      const movement = await recordInventoryMovement(
        session,
        inventoryMovementParams.inventoryItemId,
        body,
        env,
      );
      sendSuccess(res, movement);
      return;
    }

    const recomputeResultsParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/categories/:categoryId/results/recompute");
    if (recomputeResultsParams) {
      const session = await requireSession(req);
      const results = await recomputeCategoryResults(session, recomputeResultsParams.categoryId, env);
      sendSuccess(res, results);
      return;
    }

    const createResultComplaintParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/categories/:categoryId/result-complaints",
    );
    if (createResultComplaintParams) {
      const session = await requireSession(req);
      const body = createResultComplaintSchema.parse(await readJsonBody(req) ?? {});
      const results = await createResultComplaint(
        session,
        createResultComplaintParams.categoryId,
        body,
        env,
      );
      sendSuccess(res, results);
      return;
    }

    const resolveResultComplaintParams = matchRoute(
      req.method,
      url.pathname,
      "POST",
      "/api/v1/organizer/result-complaints/:complaintId",
    );
    if (resolveResultComplaintParams) {
      const session = await requireSession(req);
      const body = resolveResultComplaintSchema.parse(await readJsonBody(req) ?? {});
      const results = await resolveResultComplaint(
        session,
        resolveResultComplaintParams.complaintId,
        body,
        env,
      );
      sendSuccess(res, results);
      return;
    }

    const publishResultsParams = matchRoute(req.method, url.pathname, "POST", "/api/v1/organizer/categories/:categoryId/results/publish");
    if (publishResultsParams) {
      const session = await requireSession(req);
      const body = publishResultsSchema.parse(await readJsonBody(req) ?? {});
      const results = await publishCategoryResults(session, publishResultsParams.categoryId, body, env);
      sendSuccess(res, results);
      return;
    }

    sendError(res, 404, "not_found", "Route not found");
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendError(res, 413, "payload_too_large", "Request body must be 1 MB or smaller");
      return;
    }

    if (error instanceof SyntaxError) {
      sendError(res, 400, "invalid_json", "Request body must contain valid JSON");
      return;
    }

    if (error instanceof z.ZodError) {
      sendError(res, 400, "validation_error", error.issues[0]?.message ?? "Invalid request");
      return;
    }

    if (error instanceof Error && error.message === "Missing bearer token") {
      sendError(res, 401, "unauthorized", "Authentication required");
      return;
    }

    if (error instanceof Error && error.message === "Unauthorized") {
      sendError(res, 401, "unauthorized", "Invalid or expired session");
      return;
    }

    if (error instanceof Error && error.message === "Untrusted browser origin") {
      sendError(res, 403, "forbidden", "Browser origin is not allowed");
      return;
    }

    if (isApiHttpError(error)) {
      const code =
        error.status === 401
          ? "unauthorized"
          : error.status === 403
          ? "forbidden"
          : error.status === 404
          ? "not_found"
          : error.status === 409
          ? "conflict"
          : "bad_request";
      sendError(res, error.status, error.code ?? code, error.message);
      return;
    }

    console.error(error);
    sendError(res, 500, "internal_error", "Unexpected server error");
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  env = loadServerEnv();
  const server = createServer(handleApiRequest);
  server.listen(env.apiPort, env.apiHost, () => {
    console.log(`Trail API listening on http://${env.apiHost}:${env.apiPort}`);
  });
}
