import type {
  PlatformRole,
  PlatformTestingRole,
  RequestSession,
} from "@raceson/domain/auth";
import { ORGANIZATION_PERMISSIONS } from "@raceson/domain/auth";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requirePlatformCapability } from "./platform-capabilities.js";
import { createAdminSupabaseClient } from "./supabase.js";

type PlatformAdministratorRow = {
  user_id: string;
  platform_role: PlatformRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type LegacyCategoryAssignmentRow = {
  source_race_id: string;
  legacy_event_name: string;
  legacy_category_name: string;
  legacy_start_date: string | null;
  expected_registration_count: number;
  expected_result_count: number;
  assignment_state: "unassigned" | "mapped" | "imported" | "verified" | "ignored";
  canonical_event_category_id: string | null;
};

export type PlatformAdministratorSummary = {
  userId: string;
  email: string | null;
  displayName: string;
  role: PlatformRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PlatformTestingSummary = {
  viewerRole: PlatformRole | PlatformTestingRole;
  assignmentPool: {
    totalCategories: number;
    unassignedCategories: number;
    mappedCategories: number;
    importedCategories: number;
    verifiedCategories: number;
    ignoredCategories: number;
    expectedRegistrations: number;
    expectedResults: number;
  };
  categories: Array<{
    sourceRaceId: string;
    eventName: string;
    categoryName: string;
    startDate: string | null;
    expectedRegistrations: number;
    expectedResults: number;
    assignmentState: LegacyCategoryAssignmentRow["assignment_state"];
    canonicalEventCategoryId: string | null;
  }>;
};

export type PlatformOrganizationSummary = {
  organizationId: string;
  slug: string;
  name: string;
  kind: "organizer";
  status: string;
  contactEmail: string | null;
  countryCode: string | null;
  city: string | null;
  administrators: Array<{
    userId: string;
    displayName: string;
    email: string | null;
    role: string;
  }>;
  memberCount: number;
  eventCount: number;
  upcomingEventCount: number;
  lastActivityAt: string;
  createdAt: string;
};

export type PlatformOrganizationSupportContext = {
  organizationId: string;
  slug: string;
  name: string;
  kind: "organizer";
  status: string;
};

function requireSuperAdministrator(session: RequestSession) {
  if (session.account.platformRole !== "super_admin") {
    throw forbidden("Only the super administrator can manage site-wide administrators.");
  }
}

function requirePlatformAdministrator(session: RequestSession) {
  if (!session.account.platformRole) {
    throw forbidden("Only site-wide administrators can view platform administration.");
  }
}

export async function getPlatformOrganizationSupportContext(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformOrganizationSupportContext> {
  requirePlatformCapability(session, "platform.organizations.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("organizations")
    .select("id,slug,name,kind,status")
    .eq("id", organizationId)
    .eq("kind", "organizer")
    .maybeSingle<{
      id: string;
      slug: string;
      name: string;
      kind: "organizer";
      status: string;
    }>();
  if (error) throw error;
  if (!data) throw notFound("Organization not found");
  return {
    organizationId: data.id,
    slug: data.slug,
    name: data.name,
    kind: data.kind,
    status: data.status,
  };
}

export function applyPlatformOrganizationSupportScope(
  session: RequestSession,
  organization: PlatformOrganizationSupportContext,
): RequestSession {
  requirePlatformCapability(session, "platform.organizations.manage");
  return {
    ...session,
    account: {
      ...session.account,
      organizationIds: [organization.organizationId],
      organizationSlugs: [organization.slug],
      organizationNames: [organization.name],
      organizationRoles: ["platform_support"],
      organizations: [{
        organizationId: organization.organizationId,
        organizationSlug: organization.slug,
        organizationName: organization.name,
        organizationKind: organization.kind,
        linkedClubId: null,
        linkedClubSlug: null,
        linkedClubName: null,
        role: "platform_support",
        membershipType: "permanent",
        loginUsername: null,
        permissions: [...ORGANIZATION_PERMISSIONS],
        expiresAt: null,
      }],
      eventAccess: [],
      accountType: "master_admin",
      hasOrganizerAccess: true,
    },
  };
}

export async function scopePlatformSupportSession(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const organization = await getPlatformOrganizationSupportContext(
    session,
    organizationId,
    env,
  );
  return applyPlatformOrganizationSupportScope(session, organization);
}

function requireTestingAccess(session: RequestSession) {
  if (!session.account.hasTestingAccess) {
    throw forbidden("This account cannot access the testing workspace.");
  }
}

function normalizeAdministratorEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw badRequest("Enter a valid administrator email address.");
  }
  return email;
}

async function findAuthUserByEmail(
  email: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;
    const user = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email,
    );
    if (user) return user;
    if (data.users.length < 100) return null;
  }
  throw conflict("Unable to resolve this account from the current Auth user set.");
}

export async function listPlatformAdministrators(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformAdministratorSummary[]> {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("platform_administrators")
    .select("user_id,platform_role,is_active,created_at,updated_at")
    .order("created_at", { ascending: true })
    .returns<PlatformAdministratorRow[]>();
  if (error) throw error;

  return Promise.all((data ?? []).map(async (row) => {
    const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(row.user_id);
    if (authError) throw authError;
    const user = authData.user;
    const displayName = typeof user?.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
    return {
      userId: row.user_id,
      email: user?.email ?? null,
      displayName: displayName || user?.email?.split("@")[0] || "Administrator",
      role: row.platform_role,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }));
}

export async function listPlatformOrganizations(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformOrganizationSummary[]> {
  requirePlatformAdministrator(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data: organizations, error: organizationsError } = await adminClient
    .from("organizations")
    .select("id,slug,name,kind,status,contact_email,country_code,city,created_at,updated_at")
    .eq("kind", "organizer")
    .order("name", { ascending: true })
    .returns<Array<{
      id: string;
      slug: string;
      name: string;
      kind: "organizer";
      status: string;
      contact_email: string | null;
      country_code: string | null;
      city: string | null;
      created_at: string;
      updated_at: string;
    }>>();
  if (organizationsError) throw organizationsError;

  const rows = organizations ?? [];
  const organizationIds = rows.map((organization) => organization.id);
  if (!organizationIds.length) return [];

  const [membershipsResult, seriesResult] = await Promise.all([
    adminClient
      .from("organization_memberships")
      .select("organization_id,user_id,role,status,updated_at")
      .in("organization_id", organizationIds)
      .neq("status", "removed")
      .returns<Array<{
        organization_id: string;
        user_id: string;
        role: string;
        status: string;
        updated_at: string;
      }>>(),
    adminClient
      .from("event_series")
      .select("id,organization_id,updated_at")
      .in("organization_id", organizationIds)
      .returns<Array<{ id: string; organization_id: string; updated_at: string }>>(),
  ]);
  if (membershipsResult.error) throw membershipsResult.error;
  if (seriesResult.error) throw seriesResult.error;

  const memberships = membershipsResult.data ?? [];
  const series = seriesResult.data ?? [];
  const userIds = Array.from(new Set(memberships.map((membership) => membership.user_id)));
  const seriesIds = series.map((eventSeries) => eventSeries.id);
  const [profilesResult, editionsResult] = await Promise.all([
    userIds.length
      ? adminClient
          .from("user_profiles")
          .select("user_id,email,display_name")
          .in("user_id", userIds)
          .returns<Array<{
            user_id: string;
            email: string | null;
            display_name: string | null;
          }>>()
      : Promise.resolve({ data: [], error: null }),
    seriesIds.length
      ? adminClient
          .from("event_editions")
          .select("id,event_series_id,start_date,updated_at,organizer_deleted_at,is_practice")
          .in("event_series_id", seriesIds)
          .returns<Array<{
            id: string;
            event_series_id: string;
            start_date: string;
            updated_at: string;
            organizer_deleted_at: string | null;
            is_practice: boolean;
          }>>()
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (editionsResult.error) throw editionsResult.error;

  const profiles = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.user_id, profile]),
  );
  const seriesOrganization = new Map(
    series.map((eventSeries) => [eventSeries.id, eventSeries.organization_id]),
  );
  const today = new Date().toISOString().slice(0, 10);

  return rows.map((organization) => {
    const organizationMemberships = memberships.filter(
      (membership) => membership.organization_id === organization.id,
    );
    const organizationSeries = series.filter(
      (eventSeries) => eventSeries.organization_id === organization.id,
    );
    const editions = (editionsResult.data ?? []).filter(
      (edition) => seriesOrganization.get(edition.event_series_id) === organization.id,
    );
    const currentBusinessEditions = editions.filter(
      (edition) => !edition.organizer_deleted_at && !edition.is_practice,
    );
    const activityDates = [
      organization.updated_at,
      ...organizationMemberships.map((membership) => membership.updated_at),
      ...organizationSeries.map((eventSeries) => eventSeries.updated_at),
      ...editions.map((edition) => edition.updated_at),
    ];

    return {
      organizationId: organization.id,
      slug: organization.slug,
      name: organization.name,
      kind: organization.kind,
      status: organization.status,
      contactEmail: organization.contact_email,
      countryCode: organization.country_code,
      city: organization.city,
      administrators: organizationMemberships
        .filter((membership) => ["owner", "admin"].includes(membership.role))
        .map((membership) => {
          const profile = profiles.get(membership.user_id);
          return {
            userId: membership.user_id,
            displayName:
              profile?.display_name?.trim()
              || profile?.email?.split("@")[0]
              || "Organization administrator",
            email: profile?.email ?? null,
            role: membership.role,
          };
        }),
      memberCount: organizationMemberships.length,
      eventCount: currentBusinessEditions.length,
      upcomingEventCount: currentBusinessEditions.filter((edition) => edition.start_date >= today).length,
      lastActivityAt: activityDates.sort().at(-1) ?? organization.updated_at,
      createdAt: organization.created_at,
    };
  });
}

export async function inviteSiteAdministrator(
  session: RequestSession,
  emailInput: string,
  env: ServerEnv = loadServerEnv(),
) {
  requireSuperAdministrator(session);
  const email = normalizeAdministratorEmail(emailInput);
  const adminClient = createAdminSupabaseClient(env);
  let user = await findAuthUserByEmail(email, env);
  let invited = false;

  if (!user) {
    const redirectBase = env.appBaseUrl?.replace(/\/$/, "");
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectBase ? `${redirectBase}/auth/reset` : undefined,
      data: {
        display_name: email.split("@")[0],
        requested_roles: ["organizer"],
      },
    });
    if (error || !data.user) throw error ?? new Error("Administrator invitation failed.");
    user = data.user;
    invited = true;
  }

  if (user.id === session.account.userId) {
    throw conflict("The super administrator account cannot change its own platform role here.");
  }

  const { data: previous, error: previousError } = await adminClient
    .from("platform_administrators")
    .select("user_id,platform_role,is_active,created_at,updated_at")
    .eq("user_id", user.id)
    .maybeSingle<PlatformAdministratorRow>();
  if (previousError) throw previousError;
  if (previous?.platform_role === "super_admin") {
    throw conflict("Super administrator accounts cannot be managed from this page.");
  }

  const { error: upsertError } = await adminClient
    .from("platform_administrators")
    .upsert({
      user_id: user.id,
      platform_role: "site_admin",
      is_active: true,
      created_by_user_id: session.account.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  if (upsertError) throw upsertError;

  const { error: eventError } = await adminClient
    .from("platform_administrator_events")
    .insert({
      target_user_id: user.id,
      actor_user_id: session.account.userId,
      action: invited ? "invited" : previous?.is_active ? "role_changed" : "activated",
      previous_role: previous?.platform_role ?? null,
      next_role: "site_admin",
      detail_json: { email },
    });
  if (eventError) throw eventError;

  return { userId: user.id, email, role: "site_admin" as const, invited };
}

export async function deactivateSiteAdministrator(
  session: RequestSession,
  targetUserId: string,
  env: ServerEnv = loadServerEnv(),
) {
  requireSuperAdministrator(session);
  if (targetUserId === session.account.userId) {
    throw conflict("The super administrator cannot remove their own access.");
  }
  const adminClient = createAdminSupabaseClient(env);
  const { data: current, error: currentError } = await adminClient
    .from("platform_administrators")
    .select("user_id,platform_role,is_active,created_at,updated_at")
    .eq("user_id", targetUserId)
    .maybeSingle<PlatformAdministratorRow>();
  if (currentError) throw currentError;
  if (!current) throw notFound("Site administrator not found.");
  if (current.platform_role === "super_admin") {
    throw forbidden("Super administrator access cannot be removed from the site-admin page.");
  }

  const { error: updateError } = await adminClient
    .from("platform_administrators")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("user_id", targetUserId)
    .eq("platform_role", "site_admin");
  if (updateError) throw updateError;

  const { error: eventError } = await adminClient
    .from("platform_administrator_events")
    .insert({
      target_user_id: targetUserId,
      actor_user_id: session.account.userId,
      action: "deactivated",
      previous_role: "site_admin",
      next_role: null,
    });
  if (eventError) throw eventError;
  return { userId: targetUserId, deactivated: true as const };
}

export async function getPlatformTestingSummary(
  session: RequestSession,
  env: ServerEnv = loadServerEnv(),
): Promise<PlatformTestingSummary> {
  requireTestingAccess(session);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("legacy_category_assignment_pool")
    .select("source_race_id,legacy_event_name,legacy_category_name,legacy_start_date,expected_registration_count,expected_result_count,assignment_state,canonical_event_category_id")
    .order("legacy_start_date", { ascending: true, nullsFirst: false })
    .order("legacy_category_name", { ascending: true })
    .returns<LegacyCategoryAssignmentRow[]>();
  if (error) throw error;
  const rows = data ?? [];
  const countState = (state: LegacyCategoryAssignmentRow["assignment_state"]) =>
    rows.filter((row) => row.assignment_state === state).length;

  return {
    viewerRole: session.account.platformRole ?? session.account.testingRole!,
    assignmentPool: {
      totalCategories: rows.length,
      unassignedCategories: countState("unassigned"),
      mappedCategories: countState("mapped"),
      importedCategories: countState("imported"),
      verifiedCategories: countState("verified"),
      ignoredCategories: countState("ignored"),
      expectedRegistrations: rows.reduce((total, row) => total + row.expected_registration_count, 0),
      expectedResults: rows.reduce((total, row) => total + row.expected_result_count, 0),
    },
    categories: rows.map((row) => ({
      sourceRaceId: row.source_race_id,
      eventName: row.legacy_event_name,
      categoryName: row.legacy_category_name,
      startDate: row.legacy_start_date,
      expectedRegistrations: row.expected_registration_count,
      expectedResults: row.expected_result_count,
      assignmentState: row.assignment_state,
      canonicalEventCategoryId: row.canonical_event_category_id,
    })),
  };
}
