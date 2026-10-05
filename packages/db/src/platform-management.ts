import type { User } from "@supabase/supabase-js";
import type { AthleteGender, RequestSession } from "@raceson/domain/auth";
import {
  findAccountLoginIdentifier,
  findActiveAccountUsernameReservation,
  normalizeAccountUsername,
} from "./account-login.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requirePlatformCapability } from "./platform-capabilities.js";
import { createAdminSupabaseClient } from "./supabase.js";

type UserProfileRow = {
  user_id: string;
  email: string | null;
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
  preferences_json: {
    default_role?: unknown;
    requested_roles?: unknown;
  } | null;
  primary_athlete_profile_id: string | null;
};

type AccountIdentifierRow = {
  user_id: string;
  username: string;
  email: string | null;
  username_changed_at?: string | null;
};

type AthleteAccountRow = {
  id: string;
  slug: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  city: string | null;
  country_code: string | null;
};

type AthleteRegistrationAccountRow = {
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  shirt_size: string | null;
};

type PlatformAdministratorRow = {
  user_id: string;
  platform_role: "super_admin" | "site_admin";
  is_active: boolean;
};

type OrganizationMembershipRow = {
  user_id: string;
  organization_id: string;
  role: string;
  status: string;
};

export type PlatformAccountSummary = {
  userId: string;
  email: string | null;
  displayName: string;
  username: string | null;
  credentialMode: "email" | "username";
  status: "active" | "suspended";
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  platformRole: "super_admin" | "site_admin" | null;
  athleteName: string | null;
  athleteSlug: string | null;
  organizations: Array<{
    organizationId: string;
    name: string;
    role: string;
    status: string;
  }>;
  deletionBlockers: string[];
  deletionConfirmation: string;
};

export type PlatformAccountPage = {
  items: PlatformAccountSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PlatformAccountDetail = {
  userId: string;
  email: string | null;
  username: string | null;
  credentialMode: "email" | "username";
  emailConfirmedAt: string | null;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  gender: AthleteGender | null;
  city: string | null;
  countryCode: string | null;
  phone: string | null;
  jobTitle: string | null;
  bio: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  tiktokUrl: string | null;
  xUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  shirtSize: string | null;
  locale: string;
  timezone: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  organizerSetupEnabled: boolean;
  primaryAthleteProfileId: string | null;
  primaryAthleteSlug: string | null;
};

export type PlatformAccountDeletionHistoryItem = {
  id: string;
  userId: string;
  accountLabel: string;
  reason: string;
  actorUserId: string | null;
  deletedAt: string;
};

export type PlatformAccountDeletionHistoryPage = {
  items: PlatformAccountDeletionHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type UpdatePlatformAccountInput = {
  displayName: string;
  email: string | null;
  expectedEmail: string | null;
  username: string | null;
  expectedUsername: string | null;
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
  locale?: string | null;
  timezone?: string | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  organizerSetupEnabled?: boolean;
  reason: string;
};

export type UpdatePlatformOrganizationInput = {
  expectedSlug: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  contactEmail: string | null;
  countryCode: string | null;
  city: string | null;
  reason: string;
};

export type PlatformOrganizationDeletionResult = {
  organizationId: string;
  organizationName: string;
  deleted: true;
  cleanup: {
    memberships: number;
    temporaryAccounts: number;
    customRoles: number;
    accessEvents: number;
    auditEntriesDetached: number;
    disposedTemporaryAccounts: number;
    retainedTemporaryAccounts: number;
    failedTemporaryAccounts: number;
  };
};

function normalizedReason(value: string) {
  const reason = value.trim();
  if (reason.length < 8 || reason.length > 1000) {
    throw badRequest("Enter a reason between 8 and 1,000 characters.");
  }
  return reason;
}

function normalizedDisplayName(value: string) {
  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 200) {
    throw badRequest("Display name must be between 2 and 200 characters.");
  }
  return displayName;
}

function normalizedText(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function normalizedCountryCode(value: unknown) {
  const countryCode = normalizedText(value)?.toUpperCase() ?? null;
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw badRequest("Country code must use two letters.");
  }
  return countryCode;
}

function normalizedGender(value: unknown): AthleteGender | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === "F" || value === "M" || value === "U") return value;
  throw badRequest("Choose a valid gender value.");
}

function metadataText(metadata: Record<string, unknown>, key: string) {
  return normalizedText(metadata[key]);
}

function normalizedEmail(value: string | null) {
  if (value === null || !value.trim()) return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("Enter a valid account email address.");
  }
  return email;
}

function accountActionLabel(email: string | null, username: string | null, displayName: string) {
  return email ?? username ?? displayName;
}

export function paginateVisiblePlatformAuthUsers<T extends { deleted_at?: string | null }>(
  users: T[],
  page: number,
  pageSize: number,
) {
  const visibleUsers = users.filter((user) => !user.deleted_at);
  return {
    users: visibleUsers.slice((page - 1) * pageSize, page * pageSize),
    total: visibleUsers.length,
  };
}

async function recordManagementAction(
  session: RequestSession,
  input: {
    targetKind: "account" | "organization";
    targetId: string;
    targetLabel: string;
    action: string;
    reason: string;
    detail?: Record<string, unknown>;
  },
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { error } = await adminClient.from("platform_management_actions").insert({
    actor_user_id: session.account.userId,
    target_kind: input.targetKind,
    target_id: input.targetId,
    target_label: input.targetLabel,
    action: input.action,
    reason: input.reason,
    detail_json: input.detail ?? {},
  });
  if (error) throw error;
}

export async function listPlatformAccounts(
  session: RequestSession,
  input: { page?: number; pageSize?: number; search?: string },
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformAccountPage> {
  requirePlatformCapability(session, "platform.accounts.manage");
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 25));
  const adminClient = createAdminSupabaseClient(env);
  const authPageSize = 1000;
  const authUsers = [];
  for (let authPage = 1; ; authPage += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page: authPage,
      perPage: authPageSize,
    });
    if (error) throw error;
    authUsers.push(...data.users);
    if (data.users.length < authPageSize) break;
  }

  const visibleUsers = authUsers.filter((user) => !user.deleted_at);
  const term = normalizePlatformAccountSearch(input.search ?? "");
  let total = visibleUsers.length;
  let items: PlatformAccountSummary[];
  if (!term) {
    items = await loadPlatformAccountSummaries(
      session, visibleUsers.slice((page - 1) * pageSize, page * pageSize), adminClient,
    );
  } else {
    // Auth has no joined account search. Hydrate bounded batches before filtering,
    // retaining only the requested page while counting every matching account.
    items = [];
    total = 0;
    for (let offset = 0; offset < visibleUsers.length; offset += 50) {
      const batch = await loadPlatformAccountSummaries(session, visibleUsers.slice(offset, offset + 50), adminClient);
      for (const account of batch) {
        if (!matchesPlatformAccountSearch(account, term)) continue;
        if (total >= (page - 1) * pageSize && items.length < pageSize) items.push(account);
        total += 1;
      }
    }
  }
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

function normalizePlatformAccountSearch(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function matchesPlatformAccountSearch(account: PlatformAccountSummary, term: string) {
  return [
    account.displayName, account.email, account.username, account.athleteName,
    account.platformRole, ...account.organizations.map((organization) => organization.name),
  ].some((value) => normalizePlatformAccountSearch(value ?? "").includes(term));
}

async function loadPlatformAccountSummaries(
  session: RequestSession,
  users: User[],
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
): Promise<PlatformAccountSummary[]> {
  const userIds = users.map((user) => user.id);
  if (!userIds.length) return [];

  const [profilesResult, identifiersResult, administratorsResult, membershipsResult] = await Promise.all([
    adminClient
      .from("user_profiles")
      .select("user_id,email,display_name,primary_athlete_profile_id")
      .in("user_id", userIds)
      .returns<UserProfileRow[]>(),
    adminClient
      .from("account_login_identifiers")
      .select("user_id,username,email")
      .in("user_id", userIds)
      .returns<AccountIdentifierRow[]>(),
    adminClient
      .from("platform_administrators")
      .select("user_id,platform_role,is_active")
      .in("user_id", userIds)
      .returns<PlatformAdministratorRow[]>(),
    adminClient
      .from("organization_memberships")
      .select("user_id,organization_id,role,status")
      .in("user_id", userIds)
      .neq("status", "removed")
      .returns<OrganizationMembershipRow[]>(),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (identifiersResult.error) throw identifiersResult.error;
  if (administratorsResult.error) throw administratorsResult.error;
  if (membershipsResult.error) throw membershipsResult.error;

  const profiles = new Map((profilesResult.data ?? []).map((row) => [row.user_id, row]));
  const identifiers = new Map((identifiersResult.data ?? []).map((row) => [row.user_id, row]));
  const administrators = new Map((administratorsResult.data ?? []).map((row) => [row.user_id, row]));
  const memberships = membershipsResult.data ?? [];
  const organizationIds = Array.from(new Set(memberships.map((row) => row.organization_id)));
  const athleteIds = Array.from(new Set(
    (profilesResult.data ?? [])
      .map((profile) => profile.primary_athlete_profile_id)
      .filter((value): value is string => Boolean(value)),
  ));

  const [organizationsResult, athletesResult] = await Promise.all([
    organizationIds.length
      ? adminClient
          .from("organizations")
          .select("id,name")
          .in("id", organizationIds)
          .returns<Array<{ id: string; name: string }>>()
      : Promise.resolve({ data: [], error: null }),
    athleteIds.length
      ? adminClient
          .from("athlete_profiles")
          .select("id,display_name,slug")
          .in("id", athleteIds)
          .returns<Array<{ id: string; display_name: string; slug: string }>>()
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (organizationsResult.error) throw organizationsResult.error;
  if (athletesResult.error) throw athletesResult.error;
  const organizations = new Map((organizationsResult.data ?? []).map((row) => [row.id, row.name]));
  const athletes = new Map((athletesResult.data ?? []).map((row) => [row.id, row]));

  const items = users.map((user): PlatformAccountSummary => {
    const profile = profiles.get(user.id);
    const identifier = identifiers.get(user.id);
    const administrator = administrators.get(user.id);
    const credentialMode = user.app_metadata?.trail_credential_mode === "username"
      ? "username"
      : "email";
    const email = credentialMode === "username"
      ? identifier?.email ?? profile?.email ?? null
      : user.email ?? profile?.email ?? null;
    const metadataDisplayName = typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
    const displayName = profile?.display_name?.trim()
      || metadataDisplayName
      || email?.split("@")[0]
      || identifier?.username
      || "Account";
    const accountMemberships = memberships
      .filter((membership) => membership.user_id === user.id)
      .map((membership) => ({
        organizationId: membership.organization_id,
        name: organizations.get(membership.organization_id) ?? "Organization",
        role: membership.role,
        status: membership.status,
      }));
    const deletionBlockers = [
      user.id === session.account.userId ? "You cannot delete your own account." : null,
      administrator?.platform_role === "super_admin" ? "Super-administrator accounts are protected." : null,
      administrator?.platform_role === "site_admin" && administrator.is_active
        ? "Remove active site-administrator access first."
        : null,
      ...accountMemberships
        .filter((membership) => ["owner", "admin"].includes(membership.role))
        .map((membership) => `Transfer or remove ${membership.role} access for ${membership.name}.`),
    ].filter((value): value is string => Boolean(value));
    const status = user.banned_until && new Date(user.banned_until).getTime() > Date.now()
      ? "suspended"
      : "active";

    return {
      userId: user.id,
      email,
      displayName,
      username: identifier?.username ?? null,
      credentialMode,
      status,
      emailConfirmedAt: user.email_confirmed_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      createdAt: user.created_at,
      platformRole: administrator?.is_active ? administrator.platform_role : null,
      athleteName: profile?.primary_athlete_profile_id
        ? athletes.get(profile.primary_athlete_profile_id)?.display_name ?? null
        : null,
      athleteSlug: profile?.primary_athlete_profile_id
        ? athletes.get(profile.primary_athlete_profile_id)?.slug ?? null
        : null,
      organizations: accountMemberships,
      deletionBlockers,
      deletionConfirmation: accountActionLabel(email, identifier?.username ?? null, displayName),
    };
  });
  return items;
}

export async function listPlatformAccountDeletionHistory(
  session: RequestSession,
  input: { page?: number; pageSize?: number },
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformAccountDeletionHistoryPage> {
  requirePlatformCapability(session, "platform.accounts.manage");
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 25));
  const start = (page - 1) * pageSize;
  const adminClient = createAdminSupabaseClient(env);
  const { data, error, count } = await adminClient
    .from("platform_management_actions")
    .select("id,target_id,target_label,reason,actor_user_id,created_at", { count: "exact" })
    .eq("target_kind", "account")
    .eq("action", "account_deleted")
    .order("created_at", { ascending: false })
    .range(start, start + pageSize - 1)
    .returns<Array<{
      id: string;
      target_id: string;
      target_label: string;
      reason: string;
      actor_user_id: string | null;
      created_at: string;
    }>>();
  if (error) throw error;

  const total = count ?? 0;
  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      userId: row.target_id,
      accountLabel: row.target_label,
      reason: row.reason,
      actorUserId: row.actor_user_id,
      deletedAt: row.created_at,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getPlatformAccount(
  session: RequestSession,
  targetUserId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformAccountDetail> {
  requirePlatformCapability(session, "platform.accounts.manage");
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: authData, error: authError }, { data: profile, error: profileError }, { data: identifier, error: identifierError }] = await Promise.all([
    adminClient.auth.admin.getUserById(targetUserId),
    adminClient
      .from("user_profiles")
      .select("user_id,email,display_name,first_name,last_name,date_of_birth,city,country_code,phone,job_title,bio,website_url,instagram_url,facebook_url,linkedin_url,youtube_url,tiktok_url,x_url,locale,timezone,avatar_url,cover_image_url,preferences_json,primary_athlete_profile_id")
      .eq("user_id", targetUserId)
      .maybeSingle<UserProfileRow>(),
    adminClient
      .from("account_login_identifiers")
      .select("user_id,username,email,username_changed_at")
      .eq("user_id", targetUserId)
      .maybeSingle<AccountIdentifierRow>(),
  ]);
  if (authError || !authData.user) throw authError ?? notFound("Platform account not found.");
  if (profileError) throw profileError;
  if (identifierError) throw identifierError;
  if (authData.user.deleted_at) throw conflict("Deleted accounts cannot be edited.");

  const primaryAthleteProfileId = profile?.primary_athlete_profile_id ?? null;
  const [athleteResult, registrationResult] = await Promise.all([
    primaryAthleteProfileId
      ? adminClient
          .from("athlete_profiles")
          .select("id,slug,display_name,first_name,last_name,gender,date_of_birth,city,country_code")
          .eq("id", primaryAthleteProfileId)
          .maybeSingle<AthleteAccountRow>()
      : Promise.resolve({ data: null, error: null }),
    primaryAthleteProfileId
      ? adminClient
          .from("athlete_registration_profiles")
          .select("phone,emergency_contact_name,emergency_contact_phone,shirt_size")
          .eq("athlete_profile_id", primaryAthleteProfileId)
          .maybeSingle<AthleteRegistrationAccountRow>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (athleteResult.error) throw athleteResult.error;
  if (registrationResult.error) throw registrationResult.error;

  const userMetadata = authData.user.user_metadata ?? {};
  const credentialMode = authData.user.app_metadata?.trail_credential_mode === "username"
    ? "username"
    : "email";
  const email = credentialMode === "username"
    ? identifier?.email ?? profile?.email ?? null
    : authData.user.email ?? profile?.email ?? null;
  const requestedRolesSource = profile?.preferences_json?.requested_roles
    ?? userMetadata.requested_roles;
  const requestedRoles = Array.isArray(requestedRolesSource)
    ? requestedRolesSource.filter((value): value is string => typeof value === "string")
    : [];
  const avatarUrl = profile
    ? normalizedText(profile.avatar_url)
    : metadataText(userMetadata, "avatar_url") ?? metadataText(userMetadata, "picture");
  const displayName = normalizedText(profile?.display_name)
    ?? metadataText(userMetadata, "display_name")
    ?? normalizedText(athleteResult.data?.display_name)
    ?? email?.split("@")[0]
    ?? identifier?.username
    ?? "RacesOn User";

  return {
    userId: targetUserId,
    email,
    username: identifier?.username ?? null,
    credentialMode,
    emailConfirmedAt: credentialMode === "email" ? authData.user.email_confirmed_at ?? null : null,
    displayName,
    firstName: normalizedText(profile?.first_name) ?? metadataText(userMetadata, "first_name"),
    lastName: normalizedText(profile?.last_name) ?? metadataText(userMetadata, "last_name"),
    dateOfBirth: normalizedText(athleteResult.data?.date_of_birth) ?? normalizedText(profile?.date_of_birth),
    gender: normalizedGender(athleteResult.data?.gender),
    city: normalizedText(athleteResult.data?.city) ?? normalizedText(profile?.city),
    countryCode: normalizedCountryCode(athleteResult.data?.country_code ?? profile?.country_code),
    phone: normalizedText(profile?.phone) ?? normalizedText(registrationResult.data?.phone),
    jobTitle: normalizedText(profile?.job_title),
    bio: normalizedText(profile?.bio),
    websiteUrl: normalizedText(profile?.website_url),
    instagramUrl: normalizedText(profile?.instagram_url),
    facebookUrl: normalizedText(profile?.facebook_url),
    linkedinUrl: normalizedText(profile?.linkedin_url),
    youtubeUrl: normalizedText(profile?.youtube_url),
    tiktokUrl: normalizedText(profile?.tiktok_url),
    xUrl: normalizedText(profile?.x_url),
    emergencyContactName: normalizedText(registrationResult.data?.emergency_contact_name),
    emergencyContactPhone: normalizedText(registrationResult.data?.emergency_contact_phone),
    shirtSize: normalizedText(registrationResult.data?.shirt_size)?.toUpperCase() ?? null,
    locale: normalizedText(profile?.locale) ?? metadataText(userMetadata, "locale") ?? "en",
    timezone: normalizedText(profile?.timezone) ?? metadataText(userMetadata, "timezone") ?? "Europe/Zagreb",
    avatarUrl,
    coverImageUrl: normalizedText(profile?.cover_image_url),
    organizerSetupEnabled: requestedRoles.includes("organizer"),
    primaryAthleteProfileId,
    primaryAthleteSlug: normalizedText(athleteResult.data?.slug),
  };
}

export async function updatePlatformAccount(
  session: RequestSession,
  targetUserId: string,
  input: UpdatePlatformAccountInput,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.accounts.manage");
  const displayName = normalizedDisplayName(input.displayName);
  const email = normalizedEmail(input.email);
  const expectedEmail = normalizedEmail(input.expectedEmail);
  const username = input.username ? normalizeAccountUsername(input.username) : null;
  const expectedUsername = input.expectedUsername
    ? normalizeAccountUsername(input.expectedUsername)
    : null;
  const reason = normalizedReason(input.reason);
  const adminClient = createAdminSupabaseClient(env);
  if (session.account.platformRole !== "super_admin") {
    const { data: targetAdministrator, error } = await adminClient
      .from("platform_administrators")
      .select("user_id")
      .eq("user_id", targetUserId)
      .maybeSingle<{ user_id: string }>();
    if (error) throw error;
    if (targetAdministrator) {
      throw forbidden("Only super administrators can edit platform administrator accounts.");
    }
  }
  const [{ data: authData, error: authError }, { data: identifier, error: identifierError }, { data: profile, error: profileError }] = await Promise.all([
    adminClient.auth.admin.getUserById(targetUserId),
    adminClient
      .from("account_login_identifiers")
      .select("user_id,username,email,username_changed_at")
      .eq("user_id", targetUserId)
      .maybeSingle<AccountIdentifierRow>(),
    adminClient
      .from("user_profiles")
      .select("user_id,email,display_name,first_name,last_name,date_of_birth,city,country_code,phone,job_title,bio,website_url,instagram_url,facebook_url,linkedin_url,youtube_url,tiktok_url,x_url,locale,timezone,avatar_url,cover_image_url,preferences_json,primary_athlete_profile_id")
      .eq("user_id", targetUserId)
      .maybeSingle<UserProfileRow>(),
  ]);
  if (authError || !authData.user) throw authError ?? notFound("Platform account not found.");
  if (identifierError) throw identifierError;
  if (profileError) throw profileError;
  if (authData.user.deleted_at) throw conflict("Deleted accounts cannot be edited.");

  const credentialMode = authData.user.app_metadata?.trail_credential_mode === "username"
    ? "username"
    : "email";
  const currentEmail = credentialMode === "username"
    ? identifier?.email ?? null
    : authData.user.email ?? null;
  if ((currentEmail ?? null) !== expectedEmail) {
    throw conflict("The account email changed in another session. Reload and try again.");
  }
  if ((identifier?.username ?? null) !== expectedUsername) {
    throw conflict("The account username changed in another session. Reload and try again.");
  }
  if (credentialMode === "email" && !email) {
    throw badRequest("Email-based accounts must keep a valid sign-in email.");
  }
  if (credentialMode === "username" && !identifier) {
    throw conflict("This username account is missing its login identifier and must be repaired first.");
  }
  if (identifier && !username) {
    throw badRequest("Accounts with a username must keep a valid username.");
  }

  if (username && username !== identifier?.username) {
    const [existingIdentifier, existingOrganizationUsername, activeReservation] = await Promise.all([
      findAccountLoginIdentifier(username, env),
      adminClient
        .from("organization_memberships")
        .select("id")
        .eq("login_username", username)
        .neq("status", "removed")
        .maybeSingle<{ id: string }>(),
      findActiveAccountUsernameReservation(username, env),
    ]);
    if (existingOrganizationUsername.error) throw existingOrganizationUsername.error;
    if (
      (existingIdentifier && existingIdentifier.userId !== targetUserId)
      || existingOrganizationUsername.data
      || (activeReservation && activeReservation.userId !== targetUserId)
    ) {
      throw conflict("This username is already in use.");
    }
  }

  const profileInput = {
    displayName,
    email,
    // Auth's trigger synchronizes user_profiles before the profile RPC runs.
    // Retain the original sign-in address in the audit payload separately.
    previousSignInEmail: currentEmail,
    username,
    firstName: normalizedText(input.firstName),
    lastName: normalizedText(input.lastName),
    dateOfBirth: normalizedText(input.dateOfBirth),
    gender: normalizedGender(input.gender),
    city: normalizedText(input.city),
    countryCode: normalizedCountryCode(input.countryCode),
    phone: normalizedText(input.phone),
    jobTitle: normalizedText(input.jobTitle),
    bio: normalizedText(input.bio),
    websiteUrl: normalizedText(input.websiteUrl),
    instagramUrl: normalizedText(input.instagramUrl),
    facebookUrl: normalizedText(input.facebookUrl),
    linkedinUrl: normalizedText(input.linkedinUrl),
    youtubeUrl: normalizedText(input.youtubeUrl),
    tiktokUrl: normalizedText(input.tiktokUrl),
    xUrl: normalizedText(input.xUrl),
    emergencyContactName: normalizedText(input.emergencyContactName),
    emergencyContactPhone: normalizedText(input.emergencyContactPhone),
    shirtSize: normalizedText(input.shirtSize)?.toUpperCase() ?? null,
    locale: normalizedText(input.locale) ?? "en",
    timezone: normalizedText(input.timezone) ?? "Europe/Zagreb",
    avatarUrl: normalizedText(input.avatarUrl),
    coverImageUrl: normalizedText(input.coverImageUrl),
    organizerSetupEnabled: input.organizerSetupEnabled ?? false,
  };

  const previousMetadata = authData.user.user_metadata ?? {};
  const requestedRolesSource = profile?.preferences_json?.requested_roles
    ?? previousMetadata.requested_roles;
  const currentRequestedRoles = Array.isArray(requestedRolesSource)
    ? requestedRolesSource.filter((value): value is string => typeof value === "string")
    : [];
  const requestedRoles = Array.from(new Set(
    profileInput.organizerSetupEnabled
      ? [...currentRequestedRoles, "organizer"]
      : currentRequestedRoles.filter((role) => role !== "organizer"),
  ));
  const currentDefaultRole = typeof profile?.preferences_json?.default_role === "string"
    ? profile.preferences_json.default_role
    : typeof previousMetadata.default_role === "string"
      ? previousMetadata.default_role
      : null;
  const defaultRole = profileInput.organizerSetupEnabled
    ? currentDefaultRole === "timer" ? "timer" : "organizer"
    : currentDefaultRole === "timer" ? "timer" : "athlete";
  const nextAuthAttributes = {
    ...(credentialMode === "email" && email !== currentEmail
      ? { email: email!, email_confirm: true }
      : {}),
    user_metadata: {
      ...previousMetadata,
      display_name: displayName,
      first_name: profileInput.firstName,
      last_name: profileInput.lastName,
      locale: profileInput.locale,
      timezone: profileInput.timezone,
      avatar_url: profileInput.avatarUrl,
      picture: profileInput.avatarUrl,
      requested_roles: requestedRoles,
      default_role: defaultRole,
    },
  };
  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
    targetUserId,
    nextAuthAttributes,
  );
  if (authUpdateError) {
    if (authUpdateError.message.toLowerCase().includes("already")) {
      throw conflict("Another account already uses this email address.");
    }
    throw authUpdateError;
  }

  const { error: databaseError } = await adminClient.rpc(
    "service_update_platform_account_details",
    {
      p_target_user_id: targetUserId,
      p_actor_user_id: session.account.userId,
      p_expected_email: credentialMode === "email" ? email : expectedEmail,
      p_expected_username: expectedUsername,
      p_credential_mode: credentialMode,
      p_profile: profileInput,
      p_reason: reason,
    },
  );
  if (databaseError) {
    await adminClient.auth.admin.updateUserById(targetUserId, {
      ...(credentialMode === "email" && currentEmail
        ? { email: currentEmail, email_confirm: Boolean(authData.user.email_confirmed_at) }
        : {}),
      user_metadata: previousMetadata,
    }).catch(() => undefined);
    if (databaseError.code === "23505" || databaseError.message.includes("account_email_conflict")) {
      throw conflict("Another account already uses this email address.");
    }
    if (databaseError.message.includes("account_username_conflict")) {
      throw conflict("This username is already in use.");
    }
    if (databaseError.message.includes("account_update_conflict")) {
      throw conflict("The account changed in another session. Reload and try again.");
    }
    throw databaseError;
  }

  return { userId: targetUserId, displayName, email, username, updated: true as const };
}

export async function deletePlatformAccount(
  session: RequestSession,
  targetUserId: string,
  input: { confirmation: string; reason: string },
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.accounts.manage");
  const reason = normalizedReason(input.reason);
  if (targetUserId === session.account.userId) {
    throw forbidden("You cannot delete your own account.");
  }
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: authData, error: authError }, { data: profile, error: profileError }, { data: identifier, error: identifierError }] = await Promise.all([
    adminClient.auth.admin.getUserById(targetUserId),
    adminClient
      .from("user_profiles")
      .select("user_id,email,display_name,primary_athlete_profile_id")
      .eq("user_id", targetUserId)
      .maybeSingle<UserProfileRow>(),
    adminClient
      .from("account_login_identifiers")
      .select("user_id,username,email")
      .eq("user_id", targetUserId)
      .maybeSingle<AccountIdentifierRow>(),
  ]);
  if (authError || !authData.user) throw authError ?? notFound("Platform account not found.");
  if (profileError) throw profileError;
  if (identifierError) throw identifierError;
  const credentialMode = authData.user.app_metadata?.trail_credential_mode === "username"
    ? "username"
    : "email";
  const email = credentialMode === "username"
    ? identifier?.email ?? profile?.email ?? null
    : authData.user.email ?? profile?.email ?? null;
  const displayName = profile?.display_name?.trim()
    || (typeof authData.user.user_metadata?.display_name === "string"
      ? authData.user.user_metadata.display_name.trim()
      : "")
    || "Account";
  const expectedConfirmation = accountActionLabel(email, identifier?.username ?? null, displayName);
  if (input.confirmation.trim().toLowerCase() !== expectedConfirmation.toLowerCase()) {
    throw badRequest(`Type ${expectedConfirmation} exactly to confirm account deletion.`);
  }

  const { error: preflightError } = await adminClient.rpc(
    "service_assert_platform_account_deletable",
    { p_target_user_id: targetUserId, p_actor_user_id: session.account.userId },
  );
  if (preflightError) {
    if (preflightError.message.includes("super_admin_account_deletion_forbidden")) {
      throw forbidden("Super-administrator accounts cannot be deleted.");
    }
    if (preflightError.message.includes("deactivate_site_admin_before_account_deletion")) {
      throw conflict("Remove active site-administrator access before deleting this account.");
    }
    if (preflightError.message.includes("account_has_privileged_organization_access")) {
      throw conflict(`Transfer or remove organization owner/admin access first${preflightError.details ? `: ${preflightError.details}` : "."}`);
    }
    if (preflightError.message.includes("account_owns_storage_objects")) {
      throw conflict("Reassign or remove this account's uploaded Storage objects before deletion.");
    }
    throw preflightError;
  }

  const { data: linkedAthletes, error: linkedAthletesError } = await adminClient
    .from("athlete_profiles")
    .select("id,display_name")
    .or([
      profile?.primary_athlete_profile_id
        ? `id.eq.${profile.primary_athlete_profile_id}`
        : null,
      `claimed_by_user_id.eq.${targetUserId}`,
    ].filter((value): value is string => Boolean(value)).join(","))
    .returns<Array<{ id: string; display_name: string }>>();
  if (linkedAthletesError) throw linkedAthletesError;
  const uniqueLinkedAthletes = Array.from(
    new Map((linkedAthletes ?? []).map((athlete) => [athlete.id, athlete])).values(),
  );
  if (profile?.primary_athlete_profile_id && uniqueLinkedAthletes.length === 0) {
    throw conflict("The account's linked athlete profile is missing. Repair the identity link before deleting the account.");
  }
  if (uniqueLinkedAthletes.length > 1) {
    throw conflict("This account is linked to multiple athlete profiles. Merge or reassign them before deleting the account.");
  }
  const linkedAthlete = uniqueLinkedAthletes[0] ?? null;
  if (linkedAthlete) {
    const { error: athletePreflightError } = await adminClient.rpc(
      "service_retire_platform_athlete_for_deletion",
      {
        p_actor_user_id: session.account.userId,
        p_athlete_profile_id: linkedAthlete.id,
        p_confirmation_name: linkedAthlete.display_name,
        p_reason: reason,
        p_claimed_user_id: targetUserId,
        p_dry_run: true,
      },
    );
    if (athletePreflightError) {
      if (athletePreflightError.message.includes("athlete_profile_owns_club")) {
        throw conflict("Transfer club ownership before deleting this athlete account.");
      }
      if (athletePreflightError.message.includes("account_athlete_profile_mismatch")) {
        throw conflict("The athlete profile is no longer linked to this account. Reload and try again.");
      }
      throw athletePreflightError;
    }
  }

  const targetLabel = expectedConfirmation;
  await recordManagementAction(session, {
    targetKind: "account",
    targetId: targetUserId,
    targetLabel,
    action: "account_deletion_requested",
    reason,
    detail: { credentialMode },
  }, env);

  const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(targetUserId, true);
  if (deleteAuthError) {
    await recordManagementAction(session, {
      targetKind: "account",
      targetId: targetUserId,
      targetLabel,
      action: "account_deletion_failed",
      reason,
      detail: { stage: "auth" },
    }, env).catch(() => undefined);
    throw deleteAuthError;
  }

  let athleteCleanup: unknown = null;
  if (linkedAthlete) {
    const { data, error: athleteCleanupError } = await adminClient.rpc(
      "service_retire_platform_athlete_for_deletion",
      {
        p_actor_user_id: session.account.userId,
        p_athlete_profile_id: linkedAthlete.id,
        p_confirmation_name: linkedAthlete.display_name,
        p_reason: reason,
        p_claimed_user_id: targetUserId,
        p_dry_run: false,
      },
    );
    if (athleteCleanupError) {
      await recordManagementAction(session, {
        targetKind: "account",
        targetId: targetUserId,
        targetLabel,
        action: "account_deletion_failed",
        reason,
        detail: { stage: "athlete_profile_cleanup", athleteProfileId: linkedAthlete.id },
      }, env).catch(() => undefined);
      throw athleteCleanupError;
    }
    athleteCleanup = data ?? null;
  }

  const { data: cleanupSummary, error: cleanupError } = await adminClient.rpc(
    "delete_user_account_data",
    { target_user_id: targetUserId, target_email: email },
  );
  if (cleanupError) {
    await recordManagementAction(session, {
      targetKind: "account",
      targetId: targetUserId,
      targetLabel,
      action: "account_deletion_failed",
      reason,
      detail: { stage: "application_cleanup" },
    }, env).catch(() => undefined);
    throw cleanupError;
  }

  const { error: identifierCleanupError } = await adminClient
    .from("account_login_identifiers")
    .delete()
    .eq("user_id", targetUserId);
  if (identifierCleanupError) throw identifierCleanupError;
  await recordManagementAction(session, {
    targetKind: "account",
    targetId: targetUserId,
    targetLabel,
    action: "account_deleted",
    reason,
    detail: { cleanupSummary: cleanupSummary ?? null, athleteCleanup },
  }, env);
  return {
    userId: targetUserId,
    deleted: true as const,
    cleanupSummary: cleanupSummary ?? null,
    athleteCleanup,
  };
}

export async function updatePlatformOrganization(
  session: RequestSession,
  organizationId: string,
  input: UpdatePlatformOrganizationInput,
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.organizations.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_update_platform_organization", {
    p_organization_id: organizationId,
    p_actor_user_id: session.account.userId,
    p_expected_slug: input.expectedSlug,
    p_name: input.name,
    p_slug: input.slug,
    p_status: input.status,
    p_contact_email: normalizedEmail(input.contactEmail),
    p_country_code: input.countryCode?.trim().toUpperCase() || null,
    p_city: input.city?.trim() || null,
    p_reason: normalizedReason(input.reason),
  });
  if (error) {
    if (error.message.includes("organization_slug_conflict")) {
      throw conflict("Another organization already uses this slug.");
    }
    if (error.message.includes("organization_update_conflict")) {
      throw conflict("The organization changed in another session. Reload and try again.");
    }
    if (error.message.includes("organization_not_found")) throw notFound("Organization not found.");
    throw error;
  }
  return data as {
    organizationId: string;
    name: string;
    slug: string;
    status: string;
    updated: true;
  };
}

export async function deletePlatformOrganization(
  session: RequestSession,
  organizationId: string,
  input: { confirmationName: string; reason: string },
  env: ServerEnv = loadServerEnv(),
) {
  requirePlatformCapability(session, "platform.organizations.manage");
  const adminClient = createAdminSupabaseClient(env);

  const { data: temporaryMemberships, error: temporaryMembershipError } = await adminClient
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("membership_type", "temporary")
    .returns<Array<{ user_id: string }>>();
  if (temporaryMembershipError) throw temporaryMembershipError;

  const temporaryUserIds = Array.from(new Set(
    (temporaryMemberships ?? [])
      .map((membership) => membership.user_id)
      .filter((userId) => userId !== session.account.userId),
  ));
  const [otherMembershipsResult, profilesResult, athleteProfilesResult, administratorsResult] = temporaryUserIds.length
    ? await Promise.all([
        adminClient
          .from("organization_memberships")
          .select("user_id")
          .in("user_id", temporaryUserIds)
          .neq("organization_id", organizationId)
          .neq("status", "removed")
          .returns<Array<{ user_id: string }>>(),
        adminClient
          .from("user_profiles")
          .select("user_id,primary_athlete_profile_id")
          .in("user_id", temporaryUserIds)
          .returns<Array<{ user_id: string; primary_athlete_profile_id: string | null }>>(),
        adminClient
          .from("athlete_profiles")
          .select("claimed_by_user_id")
          .in("claimed_by_user_id", temporaryUserIds)
          .returns<Array<{ claimed_by_user_id: string | null }>>(),
        adminClient
          .from("platform_administrators")
          .select("user_id")
          .in("user_id", temporaryUserIds)
          .returns<Array<{ user_id: string }>>(),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  const temporaryAccountPreflightError = otherMembershipsResult.error
    ?? profilesResult.error
    ?? athleteProfilesResult.error
    ?? administratorsResult.error;
  if (temporaryAccountPreflightError) throw temporaryAccountPreflightError;

  const retainedTemporaryUserIds = new Set([
    ...(otherMembershipsResult.data ?? []).map((membership) => membership.user_id),
    ...(profilesResult.data ?? [])
      .filter((profile) => profile.primary_athlete_profile_id)
      .map((profile) => profile.user_id),
    ...(athleteProfilesResult.data ?? [])
      .flatMap((profile) => profile.claimed_by_user_id ? [profile.claimed_by_user_id] : []),
    ...(administratorsResult.data ?? []).map((administrator) => administrator.user_id),
  ]);
  const disposableTemporaryUserIds = temporaryUserIds.filter(
    (userId) => !retainedTemporaryUserIds.has(userId),
  );

  const { data, error } = await adminClient.rpc("service_delete_platform_organization", {
    p_organization_id: organizationId,
    p_actor_user_id: session.account.userId,
    p_confirmation_name: input.confirmationName,
    p_reason: normalizedReason(input.reason),
  });
  if (error) {
    if (error.message.includes("organization_deletion_confirmation_mismatch")) {
      throw badRequest("Type the organization name exactly to confirm deletion.");
    }
    if (error.message.includes("organization_not_empty")) {
      const blockingTable = error.details
        ?.replace(/^public\./, "")
        .replaceAll("_", " ");
      throw conflict(
        blockingTable
          ? `Transfer or remove the protected ${blockingTable} data before deleting this organization.`
          : "Transfer or remove all owned records and operational data before deleting this organization.",
      );
    }
    if (error.message.includes("organization_not_found")) throw notFound("Organization not found.");
    throw error;
  }

  const databaseResult = data as Omit<PlatformOrganizationDeletionResult, "cleanup"> & {
    cleanup?: Partial<PlatformOrganizationDeletionResult["cleanup"]>;
  };
  const cleanupResults = await Promise.allSettled(
    disposableTemporaryUserIds.map(async (userId) => {
      const { data: authUser, error: authLookupError } = await adminClient.auth.admin.getUserById(userId);
      if (authLookupError) throw authLookupError;
      if (!authUser.user) return;

      const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId, true);
      if (deleteAuthError) throw deleteAuthError;

      const { error: cleanupError } = await adminClient.rpc("delete_user_account_data", {
        target_user_id: userId,
        target_email: authUser.user.email ?? null,
      });
      if (cleanupError) throw cleanupError;

      const { error: identifierCleanupError } = await adminClient
        .from("account_login_identifiers")
        .delete()
        .eq("user_id", userId);
      if (identifierCleanupError) throw identifierCleanupError;
    }),
  );
  const failedTemporaryAccountIds = cleanupResults.flatMap((result, index) => (
    result.status === "rejected" ? [disposableTemporaryUserIds[index]!] : []
  ));
  const disposedTemporaryAccounts = cleanupResults.length - failedTemporaryAccountIds.length;
  const cleanup = {
    memberships: databaseResult.cleanup?.memberships ?? 0,
    temporaryAccounts: databaseResult.cleanup?.temporaryAccounts ?? temporaryUserIds.length,
    customRoles: databaseResult.cleanup?.customRoles ?? 0,
    accessEvents: databaseResult.cleanup?.accessEvents ?? 0,
    auditEntriesDetached: databaseResult.cleanup?.auditEntriesDetached ?? 0,
    disposedTemporaryAccounts,
    retainedTemporaryAccounts: retainedTemporaryUserIds.size,
    failedTemporaryAccounts: failedTemporaryAccountIds.length,
  };

  await recordManagementAction(session, {
    targetKind: "organization",
    targetId: organizationId,
    targetLabel: databaseResult.organizationName,
    action: failedTemporaryAccountIds.length
      ? "organization_temporary_account_cleanup_incomplete"
      : "organization_temporary_accounts_disposed",
    reason: normalizedReason(input.reason),
    detail: {
      disposedTemporaryAccounts,
      retainedTemporaryAccounts: retainedTemporaryUserIds.size,
      failedTemporaryAccountIds,
    },
  }, env).catch(() => undefined);

  return {
    organizationId: databaseResult.organizationId,
    organizationName: databaseResult.organizationName,
    deleted: true,
    cleanup,
  } satisfies PlatformOrganizationDeletionResult;
}
