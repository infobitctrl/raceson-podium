import {
  effectiveOrganizationPermissions,
  type AthleteGender,
  normalizeOrganizationPermissions,
  normalizeRequestedRoles,
  parseAppRole,
  summarizeOrganizationAccess,
  type AccountContext,
  type AppRole,
  type BootstrapCurrentUserAccountInput,
  type EventAccess,
  type OrganizationAccess,
  type OrganizationMembershipType,
  type PlatformRole,
  type PlatformTestingRole,
  type RequestSession,
} from "@raceson/domain/auth";
import type { JwtPayload } from "@supabase/supabase-js";
import {
  accountUsernameChangeAvailableAt,
  loadAccountLoginIdentifierForUser,
} from "./account-login.js";
import { badRequest, conflict } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { automaticallyClaimAthleteProfileByVerifiedEmail } from "./identity-governance.js";
import { createAdminSupabaseClient, createUserSupabaseClient } from "./supabase.js";

type AuthenticatedUser = {
  id: string;
  authEmail: string | null;
  email: string | null;
  emailConfirmedAt: string | null;
  loginUsername: string | null;
  loginUsernameChangedAt: string | null;
  appMetadata: Record<string, unknown> | null;
  userMetadata: Record<string, unknown> | null;
};

type UserProfileRow = {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  city: string | null;
  country_code: string | null;
  phone: string | null;
  job_title: string | null;
  bio: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  tiktok_url: string | null;
  x_url: string | null;
  locale: string | null;
  timezone: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  primary_athlete_profile_id: string | null;
  email_verified_at: string | null;
  auth_providers_json: unknown;
  preferences_json: {
    default_role?: unknown;
    requested_roles?: unknown;
    workspace_roles?: unknown;
    meal_preference?: unknown;
  } | null;
};

type AthleteProfileRow = {
  slug: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  city: string | null;
  country_code: string | null;
};

type AthleteRegistrationProfileRow = {
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  shirt_size: string | null;
};

type MembershipRow = {
  id: string;
  organization_id: string;
  role: string;
  membership_type: string;
  permission_keys: unknown;
  login_username: string | null;
  expires_at: string | null;
  status: "active" | "invited";
};

type AccountContextLoadOptions = {
  attemptAutomaticAthleteClaim?: boolean;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  kind: string | null;
};

type ClubWorkspaceLinkRow = {
  id: string;
  slug: string;
  name: string;
  organization_id: string | null;
};

type PrivilegedMembershipRow = {
  organization_id: string;
  role: string;
};

type PlatformAdministratorRow = {
  user_id: string;
  platform_role: PlatformRole;
};

type PlatformTestAccountRow = {
  user_id: string;
  test_role: PlatformTestingRole;
};

type EventStaffAssignmentRow = {
  id: string;
  event_edition_id: string;
  event_category_id: string | null;
  checkpoint_id: string | null;
  role_title: string;
  permission_keys: unknown;
  starts_at: string;
  ends_at: string;
};

type RequestEventAccessRow = EventStaffAssignmentRow & {
  organization_id: string;
};

type RequestAuthUserRow = {
  email: string | null;
  email_confirmed_at: string | null;
  raw_app_meta_data: unknown;
  raw_user_meta_data: unknown;
};

type RequestAccountContextProjection = {
  auth_user: RequestAuthUserRow;
  user_profile: UserProfileRow | null;
  athlete_profile: AthleteProfileRow | null;
  registration_profile: AthleteRegistrationProfileRow | null;
  login_identifier: {
    username: string;
    email: string | null;
    username_changed_at: string | null;
  } | null;
  memberships: MembershipRow[];
  organizations: OrganizationRow[];
  linked_clubs: ClubWorkspaceLinkRow[];
  platform_administrator: PlatformAdministratorRow | null;
  test_account: PlatformTestAccountRow | null;
  event_access: RequestEventAccessRow[];
};

type AccountDeletionCleanupSummary = {
  released_athlete_profiles?: number;
  deleted_memberships?: number;
  deleted_identities?: number;
  deleted_claims?: number;
  deleted_security_events?: number;
  deleted_user_profiles?: number;
} | null;

export type DeleteCurrentUserAccountInput = {
  confirmation: string;
};

export type DeleteCurrentUserAccountResult = {
  deleted: true;
  cleanupSummary: AccountDeletionCleanupSummary;
};

export type UpdateCurrentUserAccountSettingsInput = {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: AthleteGender | null;
  city?: string | null;
  countryCode?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  linkedinUrl?: string | null;
  youtubeUrl?: string | null;
  tiktokUrl?: string | null;
  xUrl?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  shirtSize?: string | null;
  mealPreference?: string | null;
  locale?: string | null;
  timezone?: string | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  organizerSetupEnabled?: boolean;
};

export type CurrentUserAccountType = "athlete" | "athlete-organizer" | "organizer";

export type UpdateCurrentUserAccountTypeInput = {
  accountType: CurrentUserAccountType;
};

function normalizedText(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function storedAppRoles(value: unknown): AppRole[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((role) => parseAppRole(role))
      .filter((role): role is AppRole => role !== null),
  ));
}

export function rolesForCurrentUserAccountType(accountType: CurrentUserAccountType): AppRole[] {
  if (accountType === "organizer") return ["organizer"];
  if (accountType === "athlete-organizer") return ["athlete", "organizer"];
  return ["athlete"];
}

export function resolveAccountWorkspaceRoles(input: {
  workspaceRoles: unknown;
  requestedRoles: unknown;
  hasAthleteProfile: boolean;
  hasOrganizerMembership: boolean;
}): AppRole[] {
  const explicitWorkspaceRoles = storedAppRoles(input.workspaceRoles);
  if (explicitWorkspaceRoles.length) return explicitWorkspaceRoles;

  return normalizeRequestedRoles([
    ...(input.hasAthleteProfile ? ["athlete"] : []),
    ...storedAppRoles(input.requestedRoles),
    ...(input.hasOrganizerMembership ? ["organizer"] : []),
  ]);
}

export function mapAccountOrganizationMemberships(input: {
  memberships: readonly MembershipRow[];
  organizationRows: readonly OrganizationRow[];
  linkedClubRows: readonly ClubWorkspaceLinkRow[];
}): OrganizationAccess[] {
  const organizationsById = new Map(
    input.organizationRows.map((organization) => [organization.id, organization]),
  );
  const linkedClubByOrganizationId = new Map(
    input.linkedClubRows
      .filter(
        (row): row is ClubWorkspaceLinkRow & { organization_id: string } =>
          Boolean(row.organization_id),
      )
      .map((row) => [row.organization_id, row]),
  );

  return input.memberships
    .map((membership) => {
      const organization = organizationsById.get(membership.organization_id);
      if (!organization) return null;
      const linkedClub = linkedClubByOrganizationId.get(membership.organization_id) ?? null;

      return {
        organizationId: organization.id,
        organizationSlug: organization.slug,
        organizationName: organization.name,
        organizationKind: organization.kind === "club" ? "club" : "organizer",
        linkedClubId: linkedClub?.id ?? null,
        linkedClubSlug: linkedClub?.slug ?? null,
        linkedClubName: linkedClub?.name ?? null,
        role: membership.role,
        membershipType:
          membership.membership_type === "temporary"
            ? "temporary"
            : "permanent" as OrganizationMembershipType,
        loginUsername: normalizedText(membership.login_username),
        permissions: effectiveOrganizationPermissions(
          membership.role,
          Array.isArray(membership.permission_keys) ? membership.permission_keys : [],
        ),
        expiresAt: membership.expires_at,
      } satisfies OrganizationAccess;
    })
    .filter((organization): organization is OrganizationAccess => organization !== null);
}

function authMetadataDisplayName(userMetadata: Record<string, unknown> | null | undefined) {
  if (!userMetadata) return null;

  const displayName = typeof userMetadata.display_name === "string"
    ? userMetadata.display_name.trim()
    : "";
  if (displayName) return displayName;

  const firstName = typeof userMetadata.first_name === "string"
    ? userMetadata.first_name.trim()
    : "";
  const lastName = typeof userMetadata.last_name === "string"
    ? userMetadata.last_name.trim()
    : "";
  const combined = [firstName, lastName].filter(Boolean).join(" ").trim();
  return combined || null;
}

function authMetadataValue(
  userMetadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  if (!userMetadata) return null;
  return normalizedText(userMetadata[key]);
}

function authMetadataAvatarUrl(userMetadata: Record<string, unknown> | null | undefined) {
  return (
    authMetadataValue(userMetadata, "avatar_url") ??
    authMetadataValue(userMetadata, "picture")
  );
}

export function isUsernameCredentialMode(
  appMetadata: Record<string, unknown> | null | undefined,
) {
  return appMetadata?.trail_credential_mode === "username";
}

function isInternalUsernameAuthEmail(email: string | null | undefined) {
  return Boolean(email?.trim().toLowerCase().endsWith("@accounts.sitrail.invalid"));
}

export function resolveAccountAvatarUrl(input: {
  hasUserProfile: boolean;
  userProfileAvatarUrl: unknown;
  userMetadata: Record<string, unknown> | null | undefined;
}) {
  return input.hasUserProfile
    ? normalizedText(input.userProfileAvatarUrl)
    : authMetadataAvatarUrl(input.userMetadata);
}

function normalizeGender(value: unknown): AthleteGender | null {
  return value === "F" || value === "M" || value === "U" ? value : null;
}

function normalizeCountryCode(value: unknown) {
  const normalized = normalizedText(value)?.toUpperCase() ?? null;
  return normalized && normalized.length === 2 ? normalized : null;
}

function normalizeShirtSize(value: unknown) {
  const normalized = normalizedText(value)?.toUpperCase() ?? null;
  return normalized ?? null;
}

function normalizeAuthProviders(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item): item is string => item.length > 0),
    ),
  );
}

function buildAccountContext(input: {
  user: AuthenticatedUser;
  userProfile: UserProfileRow | null;
  athleteProfile: AthleteProfileRow | null;
  registrationProfile: AthleteRegistrationProfileRow | null;
  organizations: OrganizationAccess[];
  eventAccess: EventAccess[];
  platformRole: PlatformRole | null;
  testingRole: PlatformTestingRole | null;
}): AccountContext {
  const defaultRole = parseAppRole(input.userProfile?.preferences_json?.default_role);
  const summary = summarizeOrganizationAccess(input.organizations);
  const requestedRolesSource =
    (input.userProfile?.preferences_json?.requested_roles as readonly unknown[] | null | undefined) ??
    (input.user.userMetadata?.requested_roles as readonly unknown[] | null | undefined);
  const requestedRoles = resolveAccountWorkspaceRoles({
    workspaceRoles: input.userProfile?.preferences_json?.workspace_roles,
    requestedRoles: requestedRolesSource,
    hasAthleteProfile: Boolean(input.userProfile?.primary_athlete_profile_id),
    hasOrganizerMembership: summary.hasOrganizerAccess,
  });
  const preferredDisplayName = authMetadataDisplayName(input.user.userMetadata);
  const firstName = normalizedText(input.userProfile?.first_name) ?? authMetadataValue(input.user.userMetadata, "first_name");
  const lastName = normalizedText(input.userProfile?.last_name) ?? authMetadataValue(input.user.userMetadata, "last_name");
  const dateOfBirth =
    normalizedText(input.athleteProfile?.date_of_birth)
    ?? normalizedText(input.userProfile?.date_of_birth);
  const gender = normalizeGender(input.athleteProfile?.gender);
  const city =
    normalizedText(input.athleteProfile?.city)
    ?? normalizedText(input.userProfile?.city);
  const countryCode = normalizeCountryCode(
    input.athleteProfile?.country_code ?? input.userProfile?.country_code,
  );
  const phone =
    normalizedText(input.userProfile?.phone)
    ?? normalizedText(input.registrationProfile?.phone);
  const jobTitle = normalizedText(input.userProfile?.job_title);
  const bio = normalizedText(input.userProfile?.bio);
  const websiteUrl = normalizedText(input.userProfile?.website_url);
  const instagramUrl = normalizedText(input.userProfile?.instagram_url);
  const facebookUrl = normalizedText(input.userProfile?.facebook_url);
  const linkedinUrl = normalizedText(input.userProfile?.linkedin_url);
  const youtubeUrl = normalizedText(input.userProfile?.youtube_url);
  const tiktokUrl = normalizedText(input.userProfile?.tiktok_url);
  const xUrl = normalizedText(input.userProfile?.x_url);
  const emergencyContactName = normalizedText(input.registrationProfile?.emergency_contact_name);
  const emergencyContactPhone = normalizedText(input.registrationProfile?.emergency_contact_phone);
  const shirtSize = normalizeShirtSize(input.registrationProfile?.shirt_size);
  const locale = normalizedText(input.userProfile?.locale) ?? authMetadataValue(input.user.userMetadata, "locale") ?? "en";
  const timezone = normalizedText(input.userProfile?.timezone) ?? authMetadataValue(input.user.userMetadata, "timezone") ?? "Europe/Zagreb";
  const avatarUrl = resolveAccountAvatarUrl({
    hasUserProfile: input.userProfile !== null,
    userProfileAvatarUrl: input.userProfile?.avatar_url,
    userMetadata: input.user.userMetadata,
  });
  const coverImageUrl = normalizedText(input.userProfile?.cover_image_url);
  const emailVerifiedAt = input.userProfile?.email_verified_at ?? input.user.emailConfirmedAt ?? null;
  const authProviders = normalizeAuthProviders(
    input.userProfile?.auth_providers_json ??
    input.user.appMetadata?.providers ??
    (typeof input.user.appMetadata?.provider === "string" ? [input.user.appMetadata.provider] : []),
  );
  const hasOwnerAccess = input.organizations.some(
    (organization) => organization.role === "owner",
  );
  const hasPermanentAccess = input.organizations.some(
    (organization) => organization.membershipType === "permanent",
  );
  const hasTemporaryAccess = input.organizations.some(
    (organization) => organization.membershipType === "temporary",
  );
  const isMasterAdmin = input.platformRole !== null;
  const hasTestingAccess = isMasterAdmin || input.testingRole !== null;
  const accountType = isMasterAdmin
    ? "master_admin"
    : input.testingRole
      ? "testing"
      : hasOwnerAccess
        ? "owner"
        : hasPermanentAccess
          ? "permanent"
          : hasTemporaryAccess
            ? "temporary"
            : "athlete";
  const loginUsername = input.organizations.find(
    (organization) => organization.loginUsername,
  )?.loginUsername ?? input.user.loginUsername;
  const usernameChangeAvailableAt = accountUsernameChangeAvailableAt(
    input.user.loginUsernameChangedAt,
  );
  const hasSelectedAthleteRole = requestedRoles.includes("athlete");
  const hasSelectedOrganizerRole =
    requestedRoles.includes("organizer") || requestedRoles.includes("timer");

  return {
    userId: input.user.id,
    email: accountType === "temporary" ? null : input.user.email,
    emailVerified: Boolean(emailVerifiedAt),
    emailVerifiedAt,
    authProviders,
    requestedRoles,
    organizerSetupEnabled: requestedRoles.includes("organizer"),
    displayName:
      normalizedText(input.userProfile?.display_name) ??
      preferredDisplayName ??
      input.athleteProfile?.display_name ??
      input.user.email?.split("@")[0] ??
      "RacesOn User",
    firstName,
    lastName,
    dateOfBirth,
    gender,
    city,
    countryCode,
    phone,
    jobTitle,
    bio,
    websiteUrl,
    instagramUrl,
    facebookUrl,
    linkedinUrl,
    youtubeUrl,
    tiktokUrl,
    xUrl,
    emergencyContactName,
    emergencyContactPhone,
    shirtSize,
    mealPreference: normalizedText(input.userProfile?.preferences_json?.meal_preference),
    locale,
    timezone,
    avatarUrl,
    coverImageUrl,
    defaultRole,
    primaryAthleteProfileId: hasSelectedAthleteRole
      ? input.userProfile?.primary_athlete_profile_id ?? null
      : null,
    primaryAthleteSlug: hasSelectedAthleteRole ? input.athleteProfile?.slug ?? null : null,
    organizationIds: summary.organizationIds,
    organizationSlugs: summary.organizationSlugs,
    organizationNames: summary.organizationNames,
    organizationRoles: summary.organizationRoles,
    organizations: input.organizations,
    eventAccess: input.eventAccess,
    isMasterAdmin,
    platformRole: input.platformRole,
    canManagePlatformAdmins: input.platformRole === "super_admin",
    testingRole: input.testingRole,
    hasTestingAccess,
    accountType,
    loginUsername,
    usernameChangeAvailableAt,
    hasAthleteAccess:
      hasSelectedAthleteRole
      && Boolean(input.userProfile?.primary_athlete_profile_id),
    hasOrganizerAccess:
      isMasterAdmin
      || (
        summary.hasOrganizerAccess
        && hasSelectedOrganizerRole
      ),
  };
}

export async function authenticateAccessToken(
  accessToken: string,
  env: ServerEnv = loadServerEnv(),
): Promise<AuthenticatedUser> {
  const adminClient = createAdminSupabaseClient(env);
  const {
    data: { user },
    error,
  } = await adminClient.auth.getUser(accessToken);

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  const loginIdentifier = await loadAccountLoginIdentifierForUser(user.id, env);
  const appMetadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? (user.app_metadata as Record<string, unknown>)
      : null;
  const isUsernameAccount = isUsernameCredentialMode(appMetadata)
    && isInternalUsernameAuthEmail(user.email);

  if (
    isUsernameCredentialMode(appMetadata)
    && !isInternalUsernameAuthEmail(user.email)
    && user.email
    && user.email_confirmed_at
  ) {
    const verifiedEmail = user.email.trim().toLowerCase();
    if (loginIdentifier?.email !== verifiedEmail) {
      const { error: identifierError } = await adminClient
        .from("account_login_identifiers")
        .update({ email: verifiedEmail })
        .eq("user_id", user.id);
      if (identifierError) throw identifierError;
    }
    const { error: profileError } = await adminClient
      .from("user_profiles")
      .update({
        email: verifiedEmail,
        email_verified_at: user.email_confirmed_at,
      })
      .eq("user_id", user.id);
    if (profileError) throw profileError;
  }

  return {
    id: user.id,
    authEmail: user.email ?? null,
    email: isUsernameAccount ? loginIdentifier?.email ?? null : user.email ?? null,
    emailConfirmedAt: isUsernameAccount ? null : user.email_confirmed_at ?? null,
    loginUsername: loginIdentifier?.username ?? null,
    loginUsernameChangedAt: loginIdentifier?.usernameChangedAt ?? null,
    appMetadata,
    userMetadata:
      user.user_metadata && typeof user.user_metadata === "object"
        ? (user.user_metadata as Record<string, unknown>)
        : null,
  };
}

async function activateInvitedMemberships(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  membershipRows: readonly MembershipRow[],
) {
  const invitedMembershipIds = membershipRows
    .filter((membership) => membership.status === "invited")
    .map((membership) => membership.id);
  if (!invitedMembershipIds.length) return;

  const activatedAt = new Date().toISOString();
  const { error } = await adminClient
    .from("organization_memberships")
    .update({
      status: "active",
      joined_at: activatedAt,
      updated_at: activatedAt,
    })
    .in("id", invitedMembershipIds)
    .eq("user_id", userId)
    .eq("status", "invited");
  if (error) throw error;
}

export async function loadAccountContextForUser(
  user: AuthenticatedUser,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);

  const { data: userProfile, error: userProfileError } = await adminClient
    .from("user_profiles")
    .select("display_name,first_name,last_name,date_of_birth,city,country_code,phone,job_title,bio,website_url,instagram_url,facebook_url,linkedin_url,youtube_url,tiktok_url,x_url,locale,timezone,avatar_url,cover_image_url,primary_athlete_profile_id,email_verified_at,auth_providers_json,preferences_json")
    .eq("user_id", user.id)
    .maybeSingle<UserProfileRow>();

  if (userProfileError) {
    throw userProfileError;
  }

  const primaryAthleteProfileId = userProfile?.primary_athlete_profile_id ?? null;

  const [athleteProfileResult, membershipsResult, platformAdministratorResult, testAccountResult, assignmentsResult] = await Promise.all([
    primaryAthleteProfileId
      ? adminClient
          .from("athlete_profiles")
          .select("slug,display_name,first_name,last_name,gender,date_of_birth,city,country_code")
          .eq("id", primaryAthleteProfileId)
          .maybeSingle<AthleteProfileRow>()
      : Promise.resolve({ data: null, error: null }),
    adminClient
      .from("organization_memberships")
      .select("id,organization_id,role,membership_type,permission_keys,login_username,expires_at,status")
      .eq("user_id", user.id)
      .in("status", ["active", "invited"])
      .returns<MembershipRow[]>(),
    adminClient
      .from("platform_administrators")
      .select("user_id,platform_role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle<PlatformAdministratorRow>(),
    adminClient
      .from("platform_test_accounts")
      .select("user_id,test_role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle<PlatformTestAccountRow>(),
    adminClient
      .from("event_staff_assignments")
      .select("id,event_edition_id,event_category_id,checkpoint_id,role_title,permission_keys,starts_at,ends_at")
      .eq("staff_user_id", user.id)
      .in("assignment_state", ["planned", "confirmed", "checked_in"])
      .returns<EventStaffAssignmentRow[]>(),
  ]);

  const registrationProfileResult = primaryAthleteProfileId
    ? await adminClient
        .from("athlete_registration_profiles")
        .select("phone,emergency_contact_name,emergency_contact_phone,shirt_size")
        .eq("athlete_profile_id", primaryAthleteProfileId)
        .maybeSingle<AthleteRegistrationProfileRow>()
    : { data: null, error: null };

  if (athleteProfileResult.error) {
    throw athleteProfileResult.error;
  }

  if (registrationProfileResult.error) {
    throw registrationProfileResult.error;
  }

  if (membershipsResult.error) {
    throw membershipsResult.error;
  }
  if (platformAdministratorResult.error) {
    throw platformAdministratorResult.error;
  }
  if (testAccountResult.error) {
    throw testAccountResult.error;
  }
  if (assignmentsResult.error) {
    throw assignmentsResult.error;
  }

  const membershipRows = membershipsResult.data ?? [];
  await activateInvitedMemberships(adminClient, user.id, membershipRows);

  const now = Date.now();
  const memberships = membershipRows.filter((membership) => (
    !membership.expires_at
    || Date.parse(membership.expires_at) > now
  ));
  const platformRole = platformAdministratorResult.data?.platform_role ?? null;
  const testingRole = testAccountResult.data?.test_role ?? null;
  const organizationIds = Array.from(new Set(memberships.map((membership) => membership.organization_id)));

  const [organizationRowsResult, linkedClubsResult] = organizationIds.length
    ? await Promise.all([
        adminClient
          .from("organizations")
          .select("id,slug,name,kind")
          .in("id", organizationIds)
          .returns<OrganizationRow[]>(),
        adminClient
          .from("clubs")
          .select("id,slug,name,organization_id")
          .in("organization_id", organizationIds)
          .returns<ClubWorkspaceLinkRow[]>(),
      ])
    : [
        { data: [] as OrganizationRow[], error: null },
        { data: [] as ClubWorkspaceLinkRow[], error: null },
      ];

  if (organizationRowsResult.error) {
    throw organizationRowsResult.error;
  }

  if (linkedClubsResult.error) {
    throw linkedClubsResult.error;
  }

  const organizationRows = organizationRowsResult.data ?? [];
  const organizations = mapAccountOrganizationMemberships({
    memberships,
    organizationRows,
    linkedClubRows: linkedClubsResult.data ?? [],
  });

  const assignmentRows = assignmentsResult.data ?? [];
  const assignedEventIds = Array.from(new Set(
    assignmentRows.map((assignment) => assignment.event_edition_id),
  ));
  const assignedEditionsResult = assignedEventIds.length
    ? await adminClient
        .from("event_editions")
        .select("id,event_series_id")
        .in("id", assignedEventIds)
        .returns<Array<{ id: string; event_series_id: string }>>()
    : { data: [] as Array<{ id: string; event_series_id: string }>, error: null };
  if (assignedEditionsResult.error) throw assignedEditionsResult.error;

  const assignedSeriesIds = Array.from(new Set(
    (assignedEditionsResult.data ?? []).map((edition) => edition.event_series_id),
  ));
  const assignedSeriesResult = assignedSeriesIds.length
    ? await adminClient
        .from("event_series")
        .select("id,organization_id")
        .in("id", assignedSeriesIds)
        .returns<Array<{ id: string; organization_id: string }>>()
    : { data: [] as Array<{ id: string; organization_id: string }>, error: null };
  if (assignedSeriesResult.error) throw assignedSeriesResult.error;

  const organizationIdBySeries = new Map(
    (assignedSeriesResult.data ?? []).map((series) => [series.id, series.organization_id]),
  );
  const organizationIdByEdition = new Map(
    (assignedEditionsResult.data ?? []).flatMap((edition) => {
      const organizationId = organizationIdBySeries.get(edition.event_series_id);
      return organizationId ? [[edition.id, organizationId] as const] : [];
    }),
  );
  const activeOrganizationIds = new Set(organizations.map(
    (organization) => organization.organizationId,
  ));
  const eventAccess: EventAccess[] = assignmentRows.flatMap((assignment) => {
    const organizationId = organizationIdByEdition.get(assignment.event_edition_id);
    if (!organizationId || !activeOrganizationIds.has(organizationId)) return [];
    return [{
      assignmentId: assignment.id,
      eventEditionId: assignment.event_edition_id,
      organizationId,
      eventCategoryId: assignment.event_category_id,
      checkpointId: assignment.checkpoint_id,
      roleTitle: assignment.role_title,
      permissions: normalizeOrganizationPermissions(
        Array.isArray(assignment.permission_keys) ? assignment.permission_keys : [],
      ),
      startsAt: assignment.starts_at,
      endsAt: assignment.ends_at,
    }];
  });

  return buildAccountContext({
    user,
    userProfile: userProfile ?? null,
    athleteProfile: athleteProfileResult.data ?? null,
    registrationProfile: registrationProfileResult.data ?? null,
    organizations,
    eventAccess,
    platformRole,
    testingRole,
  });
}

function isMissingRequestAccountContextProjection(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return code === "PGRST202"
    || code === "42883"
    || (
      message.includes("service_request_account_context")
      && (
        message.includes("Could not find the function")
        || message.includes("does not exist")
      )
    );
}

export type VerifiedRequestIdentity = {
  userId: string;
  sessionId: string;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function verifiedRequestIdentityFromClaims(
  claims: JwtPayload,
  env: ServerEnv = loadServerEnv(),
): VerifiedRequestIdentity | null {
  const expectedIssuer = `${env.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== expectedIssuer
    || claims.role !== "authenticated"
    || !audiences.includes("authenticated")
    || !isUuid(claims.sub)
    || !isUuid(claims.session_id)
  ) {
    return null;
  }

  return {
    userId: claims.sub,
    sessionId: claims.session_id,
  };
}

async function authenticateRequestAccessToken(
  accessToken: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.auth.getClaims(accessToken);
  const identity = data
    ? verifiedRequestIdentityFromClaims(data.claims, env)
    : null;
  if (error || !identity) throw new Error("Unauthorized");
  return identity;
}

async function loadRequestAccountContextForAccessToken(
  accessToken: string,
  env: ServerEnv,
): Promise<AccountContext> {
  const identity = await authenticateRequestAccessToken(accessToken, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = env.rewardHostedCopyPreview ? await adminClient.rpc("service_reward_demo_copy_account_context", {
    target_user_id: identity.userId,
    target_session_id: identity.sessionId,
  }) : await adminClient.rpc("service_request_account_context", {
    target_user_id: identity.userId,
    target_session_id: identity.sessionId,
  });

  if (error) {
    if (!env.rewardHostedCopyPreview && isMissingRequestAccountContextProjection(error)) {
      return loadAccountContextForAccessToken(accessToken, env, {
        attemptAutomaticAthleteClaim: false,
      });
    }
    throw error;
  }

  const projection = data as RequestAccountContextProjection | null;
  if (!projection) throw new Error("Unauthorized");
  if (
    !projection.auth_user
    || !Array.isArray(projection.memberships)
    || !Array.isArray(projection.organizations)
    || !Array.isArray(projection.linked_clubs)
    || !Array.isArray(projection.event_access)
  ) {
    throw new Error("Unable to load the request account context");
  }

  await activateInvitedMemberships(
    adminClient,
    identity.userId,
    projection.memberships,
  );

  const now = Date.now();
  const memberships = projection.memberships.filter((membership) => (
    !membership.expires_at
    || Date.parse(membership.expires_at) > now
  ));
  const organizations = mapAccountOrganizationMemberships({
    memberships,
    organizationRows: projection.organizations,
    linkedClubRows: projection.linked_clubs,
  });
  const activeOrganizationIds = new Set(
    organizations.map((organization) => organization.organizationId),
  );
  const eventAccess: EventAccess[] = projection.event_access.flatMap((assignment) => {
    if (!activeOrganizationIds.has(assignment.organization_id)) return [];
    return [{
      assignmentId: assignment.id,
      eventEditionId: assignment.event_edition_id,
      organizationId: assignment.organization_id,
      eventCategoryId: assignment.event_category_id,
      checkpointId: assignment.checkpoint_id,
      roleTitle: assignment.role_title,
      permissions: normalizeOrganizationPermissions(
        Array.isArray(assignment.permission_keys) ? assignment.permission_keys : [],
      ),
      startsAt: assignment.starts_at,
      endsAt: assignment.ends_at,
    }];
  });
  const loginIdentifier = projection.login_identifier;
  const appMetadata = metadataRecord(projection.auth_user.raw_app_meta_data);
  const isUsernameAccount = isUsernameCredentialMode(appMetadata)
    && isInternalUsernameAuthEmail(projection.auth_user.email);
  if (
    isUsernameCredentialMode(appMetadata)
    && !isInternalUsernameAuthEmail(projection.auth_user.email)
    && projection.auth_user.email
    && projection.auth_user.email_confirmed_at
  ) {
    const verifiedEmail = projection.auth_user.email.trim().toLowerCase();
    if (loginIdentifier?.email !== verifiedEmail) {
      const { error: identifierError } = await adminClient
        .from("account_login_identifiers")
        .update({ email: verifiedEmail })
        .eq("user_id", identity.userId);
      if (identifierError) throw identifierError;
    }
    if (projection.user_profile?.email_verified_at !== projection.auth_user.email_confirmed_at) {
      const { error: profileError } = await adminClient
        .from("user_profiles")
        .update({
          email: verifiedEmail,
          email_verified_at: projection.auth_user.email_confirmed_at,
        })
        .eq("user_id", identity.userId);
      if (profileError) throw profileError;
    }
  }
  const requestUser: AuthenticatedUser = {
    id: identity.userId,
    authEmail: projection.auth_user.email,
    email: isUsernameAccount
      ? loginIdentifier?.email ?? null
      : projection.auth_user.email,
    emailConfirmedAt: isUsernameAccount
      ? null
      : projection.auth_user.email_confirmed_at,
    loginUsername: loginIdentifier?.username ?? null,
    loginUsernameChangedAt: loginIdentifier?.username_changed_at ?? null,
    appMetadata,
    userMetadata: metadataRecord(projection.auth_user.raw_user_meta_data),
  };

  return buildAccountContext({
    user: requestUser,
    userProfile: projection.user_profile,
    athleteProfile: projection.athlete_profile,
    registrationProfile: projection.registration_profile,
    organizations,
    eventAccess,
    platformRole: projection.platform_administrator?.platform_role ?? null,
    testingRole: projection.test_account?.test_role ?? null,
  });
}

export async function loadAccountContextForAccessToken(
  accessToken: string,
  env: ServerEnv = loadServerEnv(),
  options: AccountContextLoadOptions = {},
): Promise<AccountContext> {
  if (env.rewardHostedCopyPreview) return loadRequestAccountContextForAccessToken(accessToken, env);
  const user = await authenticateAccessToken(accessToken, env);
  const account = await loadAccountContextForUser(user, env);
  if (options.attemptAutomaticAthleteClaim === false || user.appMetadata?.podium_registration_purpose === "sponsor") {
    return account;
  }
  const automaticClaim = await automaticallyClaimAthleteProfileByVerifiedEmail({
    accessToken,
    account,
  }, env);

  if (automaticClaim.status === "claimed") {
    return loadAccountContextForUser(user, env);
  }
  return account;
}

export function resolveBootstrapPersonalProfile(
  input: Pick<BootstrapCurrentUserAccountInput, "roles" | "createAthleteProfile">,
) {
  const requestedRoles = normalizeRequestedRoles(input.roles);
  const createAthleteProfile =
    input.createAthleteProfile ?? requestedRoles.includes("athlete");

  return {
    roles: createAthleteProfile
      ? (["athlete"] satisfies AppRole[])
      : requestedRoles,
    createAthleteProfile,
  };
}

export async function bootstrapCurrentUserAccount(
  accessToken: string,
  input: BootstrapCurrentUserAccountInput,
  env: ServerEnv = loadServerEnv(),
) {
  const user = await authenticateAccessToken(accessToken, env);
  const userClient = createUserSupabaseClient(accessToken, env);
  const { roles, createAthleteProfile } = resolveBootstrapPersonalProfile(input);

  const { error } = await userClient.rpc("bootstrap_current_user_account", {
    requested_roles: roles,
    preferred_display_name: input.displayName,
    preferred_first_name: input.firstName ?? null,
    preferred_last_name: input.lastName ?? null,
    preferred_locale: input.locale ?? null,
    preferred_timezone: input.timezone ?? null,
    create_athlete_profile: createAthleteProfile,
  });

  if (error) {
    throw error;
  }

  if (
    user.appMetadata?.trail_credential_mode === "username"
    && isInternalUsernameAuthEmail(user.authEmail)
  ) {
    const adminClient = createAdminSupabaseClient(env);
    const { error: profileEmailError } = await adminClient
      .from("user_profiles")
      .update({
        email: user.email,
        email_verified_at: null,
      })
      .eq("user_id", user.id);
    if (profileEmailError) throw profileEmailError;

    if (user.authEmail) {
      const { error: athleteEmailError } = await adminClient
        .from("athlete_profiles")
        .update({ primary_email: user.email })
        .eq("claimed_by_user_id", user.id)
        .eq("primary_email", user.authEmail);
      if (athleteEmailError) throw athleteEmailError;

      const { error: securityEventEmailError } = await adminClient
        .from("auth_security_events")
        .update({ email: user.email })
        .eq("user_id", user.id)
        .eq("email", user.authEmail);
      if (securityEventEmailError) throw securityEventEmailError;
    }
  }

  const account = await loadAccountContextForAccessToken(accessToken, env);
  const athleteProfileId = account.primaryAthleteProfileId;
  const shouldPersistSignupEssentials =
    input.dateOfBirth !== undefined ||
    input.gender !== undefined ||
    input.phone !== undefined ||
    input.shirtSize !== undefined;

  if (!shouldPersistSignupEssentials || !athleteProfileId) {
    return account;
  }

  const adminClient = createAdminSupabaseClient(env);
  const athleteUpdates: {
    date_of_birth?: string | null;
    gender?: AthleteGender | null;
  } = {};
  const registrationProfileUpdates: {
    athlete_profile_id: string;
    phone?: string | null;
    shirt_size?: string | null;
  } = {
    athlete_profile_id: athleteProfileId,
  };

  if (input.dateOfBirth !== undefined) {
    athleteUpdates.date_of_birth = normalizedText(input.dateOfBirth);
  }
  if (input.gender !== undefined) {
    athleteUpdates.gender = normalizeGender(input.gender);
  }
  if (input.phone !== undefined) {
    registrationProfileUpdates.phone = normalizedText(input.phone);
  }
  if (input.shirtSize !== undefined) {
    registrationProfileUpdates.shirt_size = normalizeShirtSize(input.shirtSize);
  }

  if (Object.keys(athleteUpdates).length) {
    const { error: athleteProfileError } = await adminClient
      .from("athlete_profiles")
      .update(athleteUpdates)
      .eq("id", athleteProfileId);

    if (athleteProfileError) {
      throw athleteProfileError;
    }
  }

  if (Object.keys(registrationProfileUpdates).length > 1) {
    const { error: registrationProfileError } = await adminClient
      .from("athlete_registration_profiles")
      .upsert(registrationProfileUpdates, {
        onConflict: "athlete_profile_id",
      });

    if (registrationProfileError) {
      throw registrationProfileError;
    }
  }

  return loadAccountContextForAccessToken(accessToken, env);
}

export async function updateCurrentUserAccountType(
  accessToken: string,
  input: UpdateCurrentUserAccountTypeInput,
  env: ServerEnv = loadServerEnv(),
) {
  const user = await authenticateAccessToken(accessToken, env);
  const adminClient = createAdminSupabaseClient(env);
  const roles = rolesForCurrentUserAccountType(input.accountType);
  const shouldEnableAthlete = roles.includes("athlete");

  async function loadCurrentProfile() {
    return adminClient
      .from("user_profiles")
      .select("id,display_name,first_name,last_name,locale,timezone,primary_athlete_profile_id,preferences_json")
      .eq("user_id", user.id)
      .maybeSingle<{
        id: string;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
        locale: string | null;
        timezone: string | null;
        primary_athlete_profile_id: string | null;
        preferences_json: Record<string, unknown> | null;
      }>();
  }

  let profileResult = await loadCurrentProfile();
  if (profileResult.error) throw profileResult.error;

  if (!profileResult.data || (shouldEnableAthlete && !profileResult.data.primary_athlete_profile_id)) {
    const currentProfile = profileResult.data;
    const userClient = createUserSupabaseClient(accessToken, env);
    const { error: bootstrapError } = await userClient.rpc("bootstrap_current_user_account", {
      requested_roles: roles,
      preferred_display_name:
        normalizedText(currentProfile?.display_name)
        ?? authMetadataDisplayName(user.userMetadata)
        ?? user.email?.split("@")[0]
        ?? "RacesOn User",
      preferred_first_name: normalizedText(currentProfile?.first_name),
      preferred_last_name: normalizedText(currentProfile?.last_name),
      preferred_locale: normalizedText(currentProfile?.locale),
      preferred_timezone: normalizedText(currentProfile?.timezone),
      create_athlete_profile: shouldEnableAthlete,
    });
    if (bootstrapError) throw bootstrapError;

    profileResult = await loadCurrentProfile();
    if (profileResult.error) throw profileResult.error;
  }

  const currentProfile = profileResult.data;
  if (!currentProfile) {
    throw badRequest("Complete account setup before changing the account type.");
  }

  const defaultRole: AppRole = roles.includes("organizer") ? "organizer" : "athlete";
  const nextPreferences = {
    ...(currentProfile.preferences_json ?? {}),
    requested_roles: roles,
    workspace_roles: roles,
    default_role: defaultRole,
  };
  const { error: profileUpdateError } = await adminClient
    .from("user_profiles")
    .update({ preferences_json: nextPreferences })
    .eq("user_id", user.id);
  if (profileUpdateError) throw profileUpdateError;

  const { error: metadataUpdateError } = await adminClient.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.userMetadata ?? {}),
      requested_roles: roles,
      workspace_roles: roles,
      default_role: defaultRole,
    },
  });
  if (metadataUpdateError) throw metadataUpdateError;

  return loadAccountContextForAccessToken(accessToken, env);
}

export async function updateCurrentUserAccountSettings(
  accessToken: string,
  input: UpdateCurrentUserAccountSettingsInput,
  env: ServerEnv = loadServerEnv(),
) {
  const user = await authenticateAccessToken(accessToken, env);
  const adminClient = createAdminSupabaseClient(env);
  const displayName = input.displayName.trim();

  if (!displayName) {
    throw badRequest("Display name is required.");
  }

  const firstName = normalizedText(input.firstName);
  const lastName = normalizedText(input.lastName);
  const dateOfBirth = normalizedText(input.dateOfBirth);
  const gender = normalizeGender(input.gender);
  const city = normalizedText(input.city);
  const countryCode = normalizeCountryCode(input.countryCode);
  const phone = normalizedText(input.phone);
  const jobTitle = normalizedText(input.jobTitle);
  const bio = normalizedText(input.bio);
  const websiteUrl = normalizedText(input.websiteUrl);
  const instagramUrl = normalizedText(input.instagramUrl);
  const facebookUrl = normalizedText(input.facebookUrl);
  const linkedinUrl = normalizedText(input.linkedinUrl);
  const youtubeUrl = normalizedText(input.youtubeUrl);
  const tiktokUrl = normalizedText(input.tiktokUrl);
  const xUrl = normalizedText(input.xUrl);
  const emergencyContactName = normalizedText(input.emergencyContactName);
  const emergencyContactPhone = normalizedText(input.emergencyContactPhone);
  const shirtSize = normalizeShirtSize(input.shirtSize);
  const locale = normalizedText(input.locale) ?? "en";
  const timezone = normalizedText(input.timezone) ?? "Europe/Zagreb";
  const avatarUrl = normalizedText(input.avatarUrl);
  const coverImageUrl = normalizedText(input.coverImageUrl);
  const organizerSetupEnabled = input.organizerSetupEnabled;

  const { data: currentProfile, error: currentProfileError } = await adminClient
    .from("user_profiles")
    .select("id,primary_athlete_profile_id,preferences_json")
    .eq("user_id", user.id)
    .maybeSingle<{
      id: string;
      primary_athlete_profile_id: string | null;
      preferences_json: {
        default_role?: unknown;
        requested_roles?: unknown;
        workspace_roles?: unknown;
        meal_preference?: unknown;
      } | null;
    }>();

  if (currentProfileError) {
    throw currentProfileError;
  }

  const currentRequestedRolesSource =
    (currentProfile?.preferences_json?.requested_roles as readonly unknown[] | null | undefined) ??
    (user.userMetadata?.requested_roles as readonly unknown[] | null | undefined);
  const currentRequestedRoles = resolveAccountWorkspaceRoles({
    workspaceRoles: currentProfile?.preferences_json?.workspace_roles,
    requestedRoles: currentRequestedRolesSource,
    hasAthleteProfile: Boolean(currentProfile?.primary_athlete_profile_id),
    hasOrganizerMembership: false,
  });
  const currentDefaultRole =
    parseAppRole(currentProfile?.preferences_json?.default_role) ??
    parseAppRole(user.userMetadata?.default_role);
  const baseRequestedRoles = currentRequestedRoles.filter((role) => role !== "organizer");
  const nextRequestedRoles = normalizeRequestedRoles(
    organizerSetupEnabled === undefined
      ? currentRequestedRoles
      : organizerSetupEnabled
        ? [...baseRequestedRoles, "organizer"]
        : baseRequestedRoles,
  );
  const nextDefaultRole = organizerSetupEnabled === undefined
    ? currentDefaultRole ?? (nextRequestedRoles.includes("organizer") ? "organizer" : "athlete")
    : organizerSetupEnabled
      ? currentDefaultRole === "timer"
        ? "timer"
        : "organizer"
      : currentDefaultRole === "timer"
        ? "timer"
        : "athlete";
  const nextPreferences = {
    ...(currentProfile?.preferences_json ?? {}),
    ...(input.mealPreference !== undefined ? { meal_preference: normalizedText(input.mealPreference) } : {}),
    requested_roles: nextRequestedRoles,
    default_role: nextDefaultRole,
  };

  if (currentProfile?.id) {
    const { error: profileUpdateError } = await adminClient
      .from("user_profiles")
      .update({
        display_name: displayName,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth,
        city,
        country_code: countryCode,
        phone,
        job_title: jobTitle,
        bio,
        website_url: websiteUrl,
        instagram_url: instagramUrl,
        facebook_url: facebookUrl,
        linkedin_url: linkedinUrl,
        youtube_url: youtubeUrl,
        tiktok_url: tiktokUrl,
        x_url: xUrl,
        locale,
        timezone,
        avatar_url: avatarUrl,
        cover_image_url: coverImageUrl,
        preferences_json: nextPreferences,
      })
      .eq("user_id", user.id);

    if (profileUpdateError) {
      throw profileUpdateError;
    }
  } else {
    const { error: profileInsertError } = await adminClient
      .from("user_profiles")
      .insert({
        user_id: user.id,
        email: user.email ?? null,
        display_name: displayName,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dateOfBirth,
        city,
        country_code: countryCode,
        phone,
        job_title: jobTitle,
        bio,
        website_url: websiteUrl,
        instagram_url: instagramUrl,
        facebook_url: facebookUrl,
        linkedin_url: linkedinUrl,
        youtube_url: youtubeUrl,
        tiktok_url: tiktokUrl,
        x_url: xUrl,
        locale,
        timezone,
        avatar_url: avatarUrl,
        cover_image_url: coverImageUrl,
        preferences_json: nextPreferences,
      });

    if (profileInsertError) {
      throw profileInsertError;
    }
  }

  if (currentProfile?.primary_athlete_profile_id) {
    const athleteProfileId = currentProfile.primary_athlete_profile_id;
    const { data: currentAthleteProfile, error: currentAthleteProfileError } = await adminClient
      .from("athlete_profiles")
      .select("first_name,last_name")
      .eq("id", athleteProfileId)
      .maybeSingle<{ first_name: string | null; last_name: string | null }>();

    if (currentAthleteProfileError) {
      throw currentAthleteProfileError;
    }

    const { error: athleteProfileUpdateError } = await adminClient
      .from("athlete_profiles")
      .update({
        display_name: displayName,
        first_name: firstName ?? currentAthleteProfile?.first_name ?? displayName,
        last_name: lastName ?? currentAthleteProfile?.last_name ?? displayName,
        date_of_birth: dateOfBirth,
        gender,
        city,
        country_code: countryCode,
        primary_email: user.email ?? null,
      })
      .eq("id", athleteProfileId);

    if (athleteProfileUpdateError) {
      throw athleteProfileUpdateError;
    }

    const { error: registrationProfileUpsertError } = await adminClient
      .from("athlete_registration_profiles")
      .upsert({
        athlete_profile_id: athleteProfileId,
        phone,
        emergency_contact_name: emergencyContactName,
        emergency_contact_phone: emergencyContactPhone,
        shirt_size: shirtSize,
      }, {
        onConflict: "athlete_profile_id",
      });

    if (registrationProfileUpsertError) {
      throw registrationProfileUpsertError;
    }
  }

  const nextUserMetadata: Record<string, unknown> = {
    ...(user.userMetadata ?? {}),
    display_name: displayName,
    first_name: firstName,
    last_name: lastName,
    locale,
    timezone,
    avatar_url: avatarUrl,
    picture: avatarUrl,
    requested_roles: nextRequestedRoles,
    default_role: nextDefaultRole,
  };

  const authUpdateResponse = await fetch(`${env.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: nextUserMetadata,
    }),
  });

  if (!authUpdateResponse.ok) {
    const payload = await authUpdateResponse
      .json()
      .catch(() => null) as
      | {
          msg?: string;
          message?: string;
          error_description?: string;
        }
      | null;
    throw new Error(
      payload?.msg ??
      payload?.message ??
      payload?.error_description ??
      "Unable to update the auth profile metadata.",
    );
  }

  return loadAccountContextForAccessToken(accessToken, env);
}

export async function deleteCurrentUserAccount(
  accessToken: string,
  input: DeleteCurrentUserAccountInput,
  env: ServerEnv = loadServerEnv(),
): Promise<DeleteCurrentUserAccountResult> {
  const user = await authenticateAccessToken(accessToken, env);
  const confirmation = input.confirmation.trim();
  const expectedConfirmation = user.email?.trim().toLowerCase() ?? "delete";

  if (!confirmation) {
    throw badRequest(
      user.email
        ? "Type your email address to confirm account deletion."
        : "Type DELETE to confirm account deletion.",
    );
  }

  if (confirmation.toLowerCase() !== expectedConfirmation) {
    throw badRequest(
      user.email
        ? "Type your email address exactly to confirm account deletion."
        : "Type DELETE to confirm account deletion.",
    );
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: privilegedMemberships, error: membershipError } = await adminClient
    .from("organization_memberships")
    .select("organization_id,role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .in("role", ["owner", "admin"])
    .returns<PrivilegedMembershipRow[]>();

  if (membershipError) {
    throw membershipError;
  }

  const blockingMemberships = privilegedMemberships ?? [];
  if (blockingMemberships.length) {
    const organizationIds = Array.from(
      new Set(blockingMemberships.map((membership) => membership.organization_id)),
    );

    const { data: organizations, error: organizationsError } = organizationIds.length
      ? await adminClient
          .from("organizations")
          .select("id,name")
          .in("id", organizationIds)
          .returns<Array<{ id: string; name: string }>>()
      : { data: [] as Array<{ id: string; name: string }>, error: null };

    if (organizationsError) {
      throw organizationsError;
    }

    const blockedLabel = (organizations ?? []).map((organization) => organization.name).join(", ")
      || "your organization workspace";
    throw conflict(
      `Transfer owner/admin access for ${blockedLabel} before deleting this account.`,
    );
  }

  const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(user.id, true);
  if (deleteAuthError) {
    throw deleteAuthError;
  }

  const { data: cleanupSummary, error: cleanupError } = await adminClient.rpc(
    "delete_user_account_data",
    {
      target_user_id: user.id,
      target_email: user.email ?? null,
    },
  );

  if (cleanupError) {
    throw cleanupError;
  }

  const { error: loginIdentifierCleanupError } = await adminClient
    .from("account_login_identifiers")
    .delete()
    .eq("user_id", user.id);
  if (loginIdentifierCleanupError) {
    throw loginIdentifierCleanupError;
  }

  return {
    deleted: true,
    cleanupSummary: (cleanupSummary as AccountDeletionCleanupSummary) ?? null,
  };
}

export async function resolveRequestSession(
  accessToken: string,
  env: ServerEnv = loadServerEnv(),
): Promise<RequestSession> {
  const account = await loadRequestAccountContextForAccessToken(accessToken, env);

  return {
    accessToken,
    account,
  };
}

export function parseRequestedRoles(input: readonly unknown[] | null | undefined): AppRole[] {
  return normalizeRequestedRoles(input);
}
