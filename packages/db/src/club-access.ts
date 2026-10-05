import type { RequestSession } from "@raceson/domain/auth";
import { countryName } from "@raceson/domain/geography";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { createAdminSupabaseClient } from "./supabase.js";

export const CLUB_PERMISSION_KEYS = [
  "club.profile.manage",
  "club.settings.manage",
  "club.members.view",
  "club.members.manage",
  "club.roles.manage",
  "club.activities.manage",
  "club.content.manage",
  "club.analytics.view",
  "club.audit.view",
] as const;

export type ClubPermission = (typeof CLUB_PERMISSION_KEYS)[number];

export type ClubAccess = {
  clubId: string;
  clubSlug: string;
  clubName: string;
  membershipId: string | null;
  athleteProfileId: string | null;
  roleId: string | null;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  isPlatformAdministrator: boolean;
  permissions: ClubPermission[];
};

export type ClubManagementRole = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: ClubPermission[];
  isSystem: boolean;
  isOwner: boolean;
  sortOrder: number;
};

export type ClubManagementMember = {
  membershipId: string;
  athleteProfileId: string;
  athleteSlug: string;
  displayName: string;
  location: string | null;
  roleId: string;
  roleKey: string;
  roleName: string;
  isOwner: boolean;
  isPrimary: boolean;
  memberSince: string | null;
};

export type ClubManagementApplication = {
  membershipId: string;
  athleteProfileId: string;
  athleteSlug: string;
  displayName: string;
  location: string | null;
  requestedAt: string;
};

export type ClubManagementActivity = {
  id: string;
  type: "training" | "meetup" | "social" | "volunteer" | "other";
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  visibility: "public" | "members";
  status: "draft" | "published" | "cancelled";
};

export type ClubManagementAuditItem = {
  id: string;
  action: string;
  occurredAt: string;
};

export type ClubManagementDashboard = {
  club: {
    id: string;
    slug: string;
    name: string;
    location: string | null;
    logoUrl: string | null;
    publicPath: string;
    profileEditPath: string;
  };
  access: ClubAccess;
  summary: {
    activeMembers: number | null;
    pendingApplications: number | null;
    upcomingActivities: number | null;
  };
  roles: ClubManagementRole[];
  members: ClubManagementMember[];
  applications: ClubManagementApplication[];
  activities: ClubManagementActivity[];
  audit: ClubManagementAuditItem[];
};

type ClubRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  country_code: string | null;
  logo_image_url: string | null;
  status: string;
};

type MembershipRow = {
  id: string;
  athlete_profile_id: string;
  club_role_id: string;
  membership_role: string;
  status: string;
  is_primary: boolean;
  joined_at: string | null;
  created_at: string;
};

type RoleRow = {
  id: string;
  club_id: string;
  role_key: string;
  name: string;
  description: string | null;
  permission_keys: string[] | null;
  sort_order: number;
  is_system: boolean;
  is_owner: boolean;
  status: string;
};

type AthleteRow = {
  id: string;
  slug: string;
  display_name: string;
  city: string | null;
  country_code: string | null;
};

type ActivityRow = {
  id: string;
  activity_type: ClubManagementActivity["type"];
  title: string;
  description: string | null;
  location_label: string | null;
  starts_at: string;
  ends_at: string | null;
  visibility: ClubManagementActivity["visibility"];
  status: ClubManagementActivity["status"];
};

type AuditRow = {
  id: string;
  action: string;
  created_at: string;
};

const permissionSet = new Set<string>(CLUB_PERMISSION_KEYS);

function normalizePermissions(value: string[] | null | undefined): ClubPermission[] {
  return (value ?? []).filter((permission): permission is ClubPermission => permissionSet.has(permission));
}

function locationLabel(city: string | null, countryCode: string | null) {
  return [city?.trim(), countryName(countryCode)].filter(Boolean).join(", ") || null;
}

function mapRole(role: RoleRow): ClubManagementRole {
  return {
    id: role.id,
    key: role.role_key,
    name: role.name,
    description: role.description,
    permissions: normalizePermissions(role.permission_keys),
    isSystem: role.is_system,
    isOwner: role.is_owner,
    sortOrder: role.sort_order,
  };
}

function isPlatformAdministrator(session: RequestSession) {
  return Boolean(session.account.isMasterAdmin || session.account.platformRole);
}

async function loadActiveClub(clubSlug: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: club, error } = await adminClient
    .from("clubs")
    .select("id,slug,name,city,country_code,logo_image_url,status")
    .eq("slug", clubSlug)
    .eq("status", "active")
    .maybeSingle<ClubRow>();

  if (error) throw error;
  if (!club) throw notFound("Club not found.");
  return { adminClient, club };
}

export async function getCurrentUserClubAccess(
  session: RequestSession,
  clubSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<ClubAccess> {
  const { adminClient, club } = await loadActiveClub(clubSlug, env);

  if (isPlatformAdministrator(session)) {
    return {
      clubId: club.id,
      clubSlug: club.slug,
      clubName: club.name,
      membershipId: null,
      athleteProfileId: session.account.primaryAthleteProfileId,
      roleId: null,
      roleKey: "platform-administrator",
      roleName: "Platform administrator",
      isOwner: false,
      isPlatformAdministrator: true,
      permissions: [...CLUB_PERMISSION_KEYS],
    };
  }

  const athleteProfileId = session.account.primaryAthleteProfileId;
  if (!athleteProfileId) throw forbidden("An athlete profile is required for club management.");

  const { data: membership, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id,athlete_profile_id,club_role_id,membership_role,status,is_primary,joined_at,created_at")
    .eq("club_id", club.id)
    .eq("athlete_profile_id", athleteProfileId)
    .eq("status", "active")
    .maybeSingle<MembershipRow>();
  if (membershipError) throw membershipError;
  if (!membership) throw forbidden("Active club membership is required for club management.");

  const { data: role, error: roleError } = await adminClient
    .from("club_roles")
    .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
    .eq("id", membership.club_role_id)
    .eq("club_id", club.id)
    .eq("status", "active")
    .maybeSingle<RoleRow>();
  if (roleError) throw roleError;
  if (!role) throw forbidden("An active club role is required for club management.");

  return {
    clubId: club.id,
    clubSlug: club.slug,
    clubName: club.name,
    membershipId: membership.id,
    athleteProfileId,
    roleId: role.id,
    roleKey: role.role_key,
    roleName: role.name,
    isOwner: role.is_owner,
    isPlatformAdministrator: false,
    permissions: normalizePermissions(role.permission_keys),
  };
}

export async function requireClubPermission(
  session: RequestSession,
  clubSlug: string,
  permission: ClubPermission,
  env: ServerEnv = loadServerEnv(),
) {
  const access = await getCurrentUserClubAccess(session, clubSlug, env);
  if (!access.permissions.includes(permission)) {
    throw forbidden(`The ${permission} club permission is required.`);
  }
  return access;
}

async function recordClubAudit(
  adminClient: ReturnType<typeof createAdminSupabaseClient>,
  session: RequestSession,
  entityType: string,
  entityId: string,
  action: string,
  clubId: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await adminClient.from("audit_log").insert({
    actor_user_id: session.account.userId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    metadata_json: { club_id: clubId, ...metadata },
  });
  if (error) throw error;
}

export async function getClubManagementDashboard(
  session: RequestSession,
  clubSlug: string,
  env: ServerEnv = loadServerEnv(),
): Promise<ClubManagementDashboard> {
  // Active membership grants the club workspace shell; permissions below keep
  // every management dataset and action scoped to the member's assigned role.
  const access = await getCurrentUserClubAccess(session, clubSlug, env);

  const { adminClient, club } = await loadActiveClub(clubSlug, env);
  const now = new Date().toISOString();
  const canViewRoster = access.permissions.includes("club.members.view");
  const canManageMembers = access.permissions.includes("club.members.manage");
  const canManageRoles = access.permissions.includes("club.roles.manage");
  const canManageActivities = access.permissions.includes("club.activities.manage");
  const canViewAnalytics = access.permissions.includes("club.analytics.view");
  const canViewAudit = access.permissions.includes("club.audit.view");
  const needsRoles = canViewRoster || canManageRoles;
  const needsMemberships = canViewRoster || canManageMembers || canViewAnalytics;
  const needsActivities = canManageActivities || canViewAnalytics;
  const [rolesResult, membershipsResult, activitiesResult, auditResult] = await Promise.all([
    needsRoles
      ? adminClient
          .from("club_roles")
          .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
          .eq("club_id", club.id)
          .eq("status", "active")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
      : Promise.resolve({ data: [] as RoleRow[], error: null }),
    needsMemberships
      ? adminClient
          .from("club_memberships")
          .select("id,athlete_profile_id,club_role_id,membership_role,status,is_primary,joined_at,created_at")
          .eq("club_id", club.id)
          .in("status", ["active", "pending"])
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as MembershipRow[], error: null }),
    needsActivities
      ? adminClient
          .from("club_activities")
          .select("id,activity_type,title,description,location_label,starts_at,ends_at,visibility,status")
          .eq("club_id", club.id)
          .order("starts_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] as ActivityRow[], error: null }),
    canViewAudit
      ? adminClient
          .from("audit_log")
          .select("id,action,created_at")
          .contains("metadata_json", { club_id: club.id })
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as AuditRow[], error: null }),
  ]);
  if (rolesResult.error) throw rolesResult.error;
  if (membershipsResult.error) throw membershipsResult.error;
  if (activitiesResult.error) throw activitiesResult.error;
  if (auditResult.error) throw auditResult.error;

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const athleteIds = Array.from(new Set(memberships.map((membership) => membership.athlete_profile_id)));
  const athleteResult = athleteIds.length && (canViewRoster || canManageMembers)
    ? await adminClient
        .from("athlete_profiles")
        .select("id,slug,display_name,city,country_code")
        .in("id", athleteIds)
    : { data: [] as AthleteRow[], error: null };
  if (athleteResult.error) throw athleteResult.error;

  const roles = ((rolesResult.data ?? []) as RoleRow[]).map(mapRole);
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const athleteById = new Map(((athleteResult.data ?? []) as AthleteRow[]).map((athlete) => [athlete.id, athlete]));
  const activeMemberships = memberships.filter((membership) => membership.status === "active");
  const pendingMemberships = memberships.filter((membership) => membership.status === "pending");

  const members = canViewRoster ? activeMemberships.flatMap((membership): ClubManagementMember[] => {
    const athlete = athleteById.get(membership.athlete_profile_id);
    const role = roleById.get(membership.club_role_id);
    if (!athlete || !role) return [];
    return [{
      membershipId: membership.id,
      athleteProfileId: athlete.id,
      athleteSlug: athlete.slug,
      displayName: athlete.display_name,
      location: locationLabel(athlete.city, athlete.country_code),
      roleId: role.id,
      roleKey: role.key,
      roleName: role.name,
      isOwner: role.isOwner,
      isPrimary: membership.is_primary,
      memberSince: membership.joined_at,
    }];
  }) : [];

  const applications = canManageMembers ? pendingMemberships.flatMap((membership): ClubManagementApplication[] => {
    const athlete = athleteById.get(membership.athlete_profile_id);
    if (!athlete) return [];
    return [{
      membershipId: membership.id,
      athleteProfileId: athlete.id,
      athleteSlug: athlete.slug,
      displayName: athlete.display_name,
      location: locationLabel(athlete.city, athlete.country_code),
      requestedAt: membership.created_at,
    }];
  }) : [];

  const loadedActivities = ((activitiesResult.data ?? []) as ActivityRow[]).map((activity) => ({
    id: activity.id,
    type: activity.activity_type,
    title: activity.title,
    description: activity.description,
    location: activity.location_label,
    startsAt: activity.starts_at,
    endsAt: activity.ends_at,
    visibility: activity.visibility,
    status: activity.status,
  }));
  const activities = canManageActivities ? loadedActivities : [];

  return {
    club: {
      id: club.id,
      slug: club.slug,
      name: club.name,
      location: locationLabel(club.city, club.country_code),
      logoUrl: club.logo_image_url,
      publicPath: `/clubs/${club.slug}`,
      profileEditPath: `/clubs/${club.slug}/edit`,
    },
    access,
    summary: {
      activeMembers: canViewRoster || canViewAnalytics ? activeMemberships.length : null,
      pendingApplications: canManageMembers || canViewAnalytics ? pendingMemberships.length : null,
      upcomingActivities: canManageActivities || canViewAnalytics
        ? loadedActivities.filter((activity) => activity.status === "published" && activity.startsAt >= now).length
        : null,
    },
    roles: canManageRoles ? roles : [],
    members,
    applications,
    activities,
    audit: ((auditResult.data ?? []) as AuditRow[]).map((item) => ({
      id: item.id,
      action: item.action,
      occurredAt: item.created_at,
    })),
  };
}

export async function updateClubMemberRole(
  session: RequestSession,
  clubSlug: string,
  membershipId: string,
  roleId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const access = await requireClubPermission(session, clubSlug, "club.roles.manage", env);
  const { adminClient } = await loadActiveClub(clubSlug, env);
  const [membershipResult, roleResult] = await Promise.all([
    adminClient
      .from("club_memberships")
      .select("id,athlete_profile_id,club_role_id,membership_role,status,is_primary,joined_at,created_at")
      .eq("id", membershipId)
      .eq("club_id", access.clubId)
      .eq("status", "active")
      .maybeSingle<MembershipRow>(),
    adminClient
      .from("club_roles")
      .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
      .eq("id", roleId)
      .eq("club_id", access.clubId)
      .eq("status", "active")
      .maybeSingle<RoleRow>(),
  ]);
  if (membershipResult.error) throw membershipResult.error;
  if (roleResult.error) throw roleResult.error;
  if (!membershipResult.data) throw notFound("Active club member not found.");
  if (!roleResult.data) throw notFound("Club role not found.");

  const targetMembership = membershipResult.data;
  const targetRole = mapRole(roleResult.data);
  const { data: currentRoleRow, error: currentRoleError } = await adminClient
    .from("club_roles")
    .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
    .eq("id", targetMembership.club_role_id)
    .eq("club_id", access.clubId)
    .eq("status", "active")
    .maybeSingle<RoleRow>();
  if (currentRoleError) throw currentRoleError;
  if (!currentRoleRow) throw conflict("The member's current club role is no longer active.");
  const currentRole = mapRole(currentRoleRow);
  if (currentRole.isOwner || targetRole.isOwner) {
    throw conflict("Club ownership must be changed through an ownership transfer.");
  }
  if (
    (currentRole.key === "administrator" || targetRole.key === "administrator")
    && !access.isOwner
    && !access.isPlatformAdministrator
  ) {
    throw forbidden("Only the club owner can appoint, demote, or remove an administrator.");
  }
  const actorPermissions = new Set(access.permissions);
  if (
    !access.isPlatformAdministrator
    && [...currentRole.permissions, ...targetRole.permissions].some((permission) => !actorPermissions.has(permission))
  ) {
    throw forbidden("You cannot manage a club role with permissions that you do not have.");
  }

  const { data, error } = await adminClient
    .from("club_memberships")
    .update({
      club_role_id: targetRole.id,
      membership_role: targetRole.key,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetMembership.id)
    .eq("club_id", access.clubId)
    .eq("club_role_id", targetMembership.club_role_id)
    .eq("status", "active")
    .select("id,membership_role,club_role_id")
    .maybeSingle<{ id: string; membership_role: string; club_role_id: string }>();
  if (error) throw error;
  if (!data) throw conflict("The member role changed before this update could be saved.");

  await recordClubAudit(adminClient, session, "club_membership", data.id, "club.member.role_changed", access.clubId, {
    athlete_profile_id: targetMembership.athlete_profile_id,
    role_key: targetRole.key,
  });
  return { membershipId: data.id, roleId: data.club_role_id, roleKey: data.membership_role };
}

export async function removeClubMember(
  session: RequestSession,
  clubSlug: string,
  membershipId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const access = await requireClubPermission(session, clubSlug, "club.members.manage", env);
  const { adminClient } = await loadActiveClub(clubSlug, env);
  const { data: membership, error: membershipError } = await adminClient
    .from("club_memberships")
    .select("id,athlete_profile_id,club_role_id,membership_role,status,is_primary,joined_at,created_at")
    .eq("id", membershipId)
    .eq("club_id", access.clubId)
    .eq("status", "active")
    .maybeSingle<MembershipRow>();
  if (membershipError) throw membershipError;
  if (!membership) throw notFound("Active club member not found.");
  const { data: memberRoleRow, error: memberRoleError } = await adminClient
    .from("club_roles")
    .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
    .eq("id", membership.club_role_id)
    .eq("club_id", access.clubId)
    .eq("status", "active")
    .maybeSingle<RoleRow>();
  if (memberRoleError) throw memberRoleError;
  if (!memberRoleRow) throw conflict("The member's current club role is no longer active.");
  const memberRole = mapRole(memberRoleRow);
  if (memberRole.isOwner) {
    throw conflict("Transfer club ownership before removing the owner.");
  }
  if (memberRole.key === "administrator" && !access.isOwner && !access.isPlatformAdministrator) {
    throw forbidden("Only the club owner can remove an administrator.");
  }
  const actorPermissions = new Set(access.permissions);
  if (
    !access.isPlatformAdministrator
    && memberRole.permissions.some((permission) => !actorPermissions.has(permission))
  ) {
    throw forbidden("You cannot remove a member whose club role has permissions that you do not have.");
  }
  if (membership.athlete_profile_id === access.athleteProfileId) {
    throw conflict("Use the leave-club action to remove your own membership.");
  }

  const { data, error } = await adminClient
    .from("club_memberships")
    .update({ status: "removed", is_primary: false, updated_at: new Date().toISOString() })
    .eq("id", membership.id)
    .eq("club_role_id", membership.club_role_id)
    .eq("status", "active")
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw error;
  if (!data) throw conflict("The member's role or status changed before removal could be saved.");

  await recordClubAudit(adminClient, session, "club_membership", data.id, "club.member.removed", access.clubId, {
    athlete_profile_id: membership.athlete_profile_id,
  });
  return { membershipId: data.id, status: "removed" as const };
}

export type SaveCustomClubRoleInput = {
  name: string;
  description?: string | null;
  permissions: ClubPermission[];
};

function roleKeyBase(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "custom-role";
}

function assertGrantablePermissions(access: ClubAccess, permissions: ClubPermission[]) {
  const uniquePermissions = Array.from(new Set(permissions));
  if (!uniquePermissions.every((permission) => permissionSet.has(permission))) {
    throw badRequest("One or more club permissions are invalid.");
  }
  if (!access.isPlatformAdministrator) {
    const actorPermissions = new Set(access.permissions);
    if (uniquePermissions.some((permission) => !actorPermissions.has(permission))) {
      throw forbidden("You cannot grant club permissions that you do not have.");
    }
  }
  const dependencies: Array<[ClubPermission, ClubPermission]> = [
    ["club.members.manage", "club.members.view"],
    ["club.roles.manage", "club.members.view"],
    ["club.content.manage", "club.profile.manage"],
  ];
  const missingDependency = dependencies.find(([permission, dependency]) => (
    uniquePermissions.includes(permission) && !uniquePermissions.includes(dependency)
  ));
  if (missingDependency) {
    throw badRequest(`${missingDependency[0]} also requires ${missingDependency[1]}.`);
  }
  return uniquePermissions;
}

export async function createCustomClubRole(
  session: RequestSession,
  clubSlug: string,
  input: SaveCustomClubRoleInput,
  env: ServerEnv = loadServerEnv(),
) {
  const access = await requireClubPermission(session, clubSlug, "club.roles.manage", env);
  const { adminClient } = await loadActiveClub(clubSlug, env);
  const permissions = assertGrantablePermissions(access, input.permissions);
  if (!permissions.length) throw badRequest("Choose at least one permission for a custom club role.");
  const baseKey = roleKeyBase(input.name);
  let roleKey = baseKey;
  let suffix = 1;
  while (true) {
    const { data: existing, error } = await adminClient
      .from("club_roles")
      .select("id")
      .eq("club_id", access.clubId)
      .eq("role_key", roleKey)
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!existing) break;
    suffix += 1;
    roleKey = `${baseKey.slice(0, 44)}-${suffix}`;
  }

  const { data, error } = await adminClient
    .from("club_roles")
    .insert({
      club_id: access.clubId,
      role_key: roleKey,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      permission_keys: permissions,
      sort_order: 50,
      is_system: false,
      is_owner: false,
    })
    .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
    .single<RoleRow>();
  if (error) throw error;
  await recordClubAudit(adminClient, session, "club_role", data.id, "club.role.created", access.clubId, {
    role_key: data.role_key,
  });
  return mapRole(data);
}

export async function updateCustomClubRole(
  session: RequestSession,
  clubSlug: string,
  roleId: string,
  input: SaveCustomClubRoleInput,
  env: ServerEnv = loadServerEnv(),
) {
  const access = await requireClubPermission(session, clubSlug, "club.roles.manage", env);
  const { adminClient } = await loadActiveClub(clubSlug, env);
  const permissions = assertGrantablePermissions(access, input.permissions);
  if (!permissions.length) throw badRequest("Choose at least one permission for a custom club role.");
  const { data: existing, error: existingError } = await adminClient
    .from("club_roles")
    .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
    .eq("id", roleId)
    .eq("club_id", access.clubId)
    .eq("status", "active")
    .maybeSingle<RoleRow>();
  if (existingError) throw existingError;
  if (!existing) throw notFound("Club role not found.");
  if (existing.is_system || existing.is_owner) throw conflict("Built-in club roles cannot be edited.");
  if (
    !access.isPlatformAdministrator
    && mapRole(existing).permissions.some((permission) => !access.permissions.includes(permission))
  ) {
    throw forbidden("You cannot edit a club role with permissions that you do not have.");
  }

  const { data, error } = await adminClient
    .from("club_roles")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      permission_keys: permissions,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("id,club_id,role_key,name,description,permission_keys,sort_order,is_system,is_owner,status")
    .single<RoleRow>();
  if (error) throw error;
  await recordClubAudit(adminClient, session, "club_role", data.id, "club.role.updated", access.clubId, {
    role_key: data.role_key,
  });
  return mapRole(data);
}

export type CreateClubActivityInput = {
  type: ClubManagementActivity["type"];
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  visibility: ClubManagementActivity["visibility"];
  status?: "draft" | "published";
};

export async function createClubActivity(
  session: RequestSession,
  clubSlug: string,
  input: CreateClubActivityInput,
  env: ServerEnv = loadServerEnv(),
) {
  const access = await requireClubPermission(session, clubSlug, "club.activities.manage", env);
  if (!access.athleteProfileId) throw forbidden("An athlete profile is required to create club activities.");
  const { adminClient } = await loadActiveClub(clubSlug, env);
  const startsAt = new Date(input.startsAt);
  const endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
    throw badRequest("Use valid dates for the club activity.");
  }
  if (endsAt && endsAt < startsAt) throw badRequest("The activity end must be after its start.");

  const { data, error } = await adminClient
    .from("club_activities")
    .insert({
      club_id: access.clubId,
      activity_type: input.type,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      location_label: input.location?.trim() || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() ?? null,
      visibility: input.visibility,
      status: input.status ?? "published",
      created_by_athlete_profile_id: access.athleteProfileId,
      updated_by_athlete_profile_id: access.athleteProfileId,
    })
    .select("id,activity_type,title,description,location_label,starts_at,ends_at,visibility,status")
    .single<ActivityRow>();
  if (error) throw error;
  await recordClubAudit(adminClient, session, "club_activity", data.id, "club.activity.created", access.clubId, {
    activity_type: data.activity_type,
  });
  return {
    id: data.id,
    type: data.activity_type,
    title: data.title,
    description: data.description,
    location: data.location_label,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    visibility: data.visibility,
    status: data.status,
  } satisfies ClubManagementActivity;
}
