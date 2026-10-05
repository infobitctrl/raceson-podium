import { createHash, randomUUID } from "node:crypto";
import {
  effectiveOrganizationPermissions,
  normalizeOrganizationPermissions,
  type OrganizationMembershipType,
  type OrganizationPermission,
  type RequestSession,
} from "@raceson/domain/auth";
import { findActiveAccountUsernameReservation } from "./account-login.js";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireOrganizationAccess } from "./permissions.js";
import { requirePlatformCapability } from "./platform-capabilities.js";
import {
  createAdminSupabaseClient,
  createServerAuthSupabaseClient,
} from "./supabase.js";

type OrganizationAccountTemplateKey =
  | "organization-admin"
  | "race-day-operator"
  | "checkpoint-timer";

export type OrganizationRoleDefinition = {
  id: string;
  key: string;
  title: string;
  description: string;
  permissions: OrganizationPermission[];
  version: number;
  isSystem: false;
};

export const TEMPORARY_ACCOUNT_PASSWORD_MODE = "temporary-short-v1";

export function deriveTemporaryOrganizationPassword(
  passwordSalt: string,
  password: string,
) {
  if (!passwordSalt.trim()) {
    throw badRequest("Temporary account password salt is required");
  }
  if (password.length < 8) {
    throw badRequest("Temporary account password must contain at least 8 characters");
  }
  return createHash("sha256")
    .update(`sitrail:${TEMPORARY_ACCOUNT_PASSWORD_MODE}:${passwordSalt}:${password}`)
    .digest("hex");
}

const ACCOUNT_TEMPLATES: Record<
  OrganizationAccountTemplateKey,
  {
    membershipTypes: readonly OrganizationMembershipType[];
    permissions: OrganizationPermission[];
  }
> = {
  "organization-admin": {
    membershipTypes: ["permanent"],
    permissions: [
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
    ],
  },
  "race-day-operator": {
    membershipTypes: ["permanent", "temporary"],
    permissions: [
      "entrants.manage",
      "race_day.manage",
      "results.manage",
      "safety.manage",
    ],
  },
  "checkpoint-timer": {
    membershipTypes: ["temporary"],
    permissions: ["checkpoint_timing.enter"],
  },
};

function accountRoleForTemplate(
  templateKey: OrganizationAccountTemplateKey,
  membershipType: OrganizationMembershipType,
) {
  if (templateKey === "organization-admin") return "admin" as const;
  return membershipType === "temporary" ? "timer" as const : "staff" as const;
}

export type OrganizationTeamMember = {
  membershipId: string;
  organizationId: string;
  userId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  role: string;
  membershipType: OrganizationMembershipType;
  templateKey: OrganizationAccountTemplateKey | null;
  customRoleId: string | null;
  loginUsername: string | null;
  permissions: OrganizationPermission[];
  status: "invited" | "active" | "suspended" | "removed";
  expiresAt: string | null;
  joinedAt: string | null;
  assignments: Array<{
    assignmentId: string;
    eventEditionId: string;
    eventName: string;
    roleTitle: string;
    assignmentState: string;
    startsAt: string;
    endsAt: string;
  }>;
};

type MembershipRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  membership_type: string;
  account_template_key: OrganizationAccountTemplateKey | null;
  custom_role_id: string | null;
  permission_keys: unknown;
  login_username: string | null;
  status: "invited" | "active" | "suspended" | "removed";
  expires_at: string | null;
  joined_at: string | null;
};

function cleanPermissions(input: readonly unknown[]) {
  const permissions = normalizeOrganizationPermissions(input);
  if (permissions.length !== new Set(input).size) {
    throw badRequest("One or more organization permissions are unsupported");
  }
  return permissions;
}

function cleanTemplateKey(
  input: unknown,
  membershipType: OrganizationMembershipType,
  permissions: readonly OrganizationPermission[],
) {
  if (
    typeof input !== "string"
    || !Object.prototype.hasOwnProperty.call(ACCOUNT_TEMPLATES, input)
  ) {
    throw badRequest("Choose a supported organization account role");
  }
  const templateKey = input as OrganizationAccountTemplateKey;
  const template = ACCOUNT_TEMPLATES[templateKey];
  if (!template.membershipTypes.includes(membershipType)) {
    throw badRequest(
      membershipType === "permanent"
        ? "Choose a permanent organization role"
        : "Choose a temporary organization or race-day role",
    );
  }
  if (
    template.permissions.length !== permissions.length
    || template.permissions.some((permission) => !permissions.includes(permission))
  ) {
    throw badRequest("The selected role and permission set do not match");
  }
  return templateKey;
}

type CustomRoleRow = {
  id: string;
  role_key: string;
};

type CustomRoleVersionRow = {
  id: string;
  organization_custom_role_id: string;
  version_number: number;
  title: string;
  description: string;
};

async function loadCustomRoleDefinition(
  organizationId: string,
  customRoleId: string,
  env: ServerEnv,
): Promise<OrganizationRoleDefinition> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: role, error: roleError } = await adminClient
    .from("organization_custom_roles")
    .select("id,role_key")
    .eq("id", customRoleId)
    .eq("organization_id", organizationId)
    .eq("role_state", "active")
    .maybeSingle<CustomRoleRow>();
  if (roleError) throw roleError;
  if (!role) throw badRequest("Choose an active role from this organization");

  const { data: version, error: versionError } = await adminClient
    .from("organization_custom_role_versions")
    .select("id,organization_custom_role_id,version_number,title,description")
    .eq("organization_custom_role_id", role.id)
    .eq("version_state", "active")
    .maybeSingle<CustomRoleVersionRow>();
  if (versionError) throw versionError;
  if (!version) throw badRequest("This custom role does not have an active definition");

  const { data: permissionRows, error: permissionsError } = await adminClient
    .from("organization_custom_role_permissions")
    .select("permission_code")
    .eq("organization_custom_role_version_id", version.id)
    .returns<Array<{ permission_code: string }>>();
  if (permissionsError) throw permissionsError;
  const permissions = cleanPermissions(
    (permissionRows ?? []).map((row) => row.permission_code),
  );
  if (!permissions.length) throw badRequest("This custom role has no active permissions");

  return {
    id: role.id,
    key: role.role_key,
    title: version.title,
    description: version.description,
    permissions,
    version: version.version_number,
    isSystem: false,
  };
}

export async function listOrganizationRoles(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizationRoleDefinition[]> {
  requireOrganizationAccess(session, organizationId, "team.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data: roles, error: rolesError } = await adminClient
    .from("organization_custom_roles")
    .select("id,role_key")
    .eq("organization_id", organizationId)
    .eq("role_state", "active")
    .order("created_at", { ascending: true })
    .returns<CustomRoleRow[]>();
  if (rolesError) throw rolesError;

  return Promise.all(
    (roles ?? []).map((role) =>
      loadCustomRoleDefinition(organizationId, role.id, env)),
  );
}

export async function saveOrganizationRole(
  session: RequestSession,
  organizationId: string,
  input: {
    roleKey: string;
    title: string;
    description: string;
    permissions: readonly unknown[];
  },
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizationRoleDefinition> {
  requireOrganizationAccess(session, organizationId, "team.manage");
  const permissions = cleanPermissions(input.permissions);
  if (!permissions.length) throw badRequest("Choose at least one permission");
  requireDelegablePermissions(session, organizationId, permissions);
  const roleKey = input.roleKey.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,79}$/.test(roleKey)) {
    throw badRequest("Role key must use lowercase letters, numbers, and hyphens");
  }
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 2 || description.length < 4) {
    throw badRequest("Enter a role name and a short description");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "service_save_organization_custom_role",
    {
      p_organization_id: organizationId,
      p_actor_user_id: session.account.userId,
      p_role_key: roleKey,
      p_title: title,
      p_description: description,
      p_permission_codes: permissions,
      p_client_event_id: randomUUID(),
    },
  );
  if (error) throw error;
  const saved = data as { id?: unknown } | null;
  if (!saved || typeof saved.id !== "string") {
    throw conflict("The organization role was not saved");
  }
  const { error: membershipsError } = await adminClient
    .from("organization_memberships")
    .update({
      permission_keys: permissions,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("custom_role_id", saved.id)
    .neq("status", "removed");
  if (membershipsError) throw membershipsError;
  return loadCustomRoleDefinition(organizationId, saved.id, env);
}

async function resolveAccountRole(
  organizationId: string,
  membershipType: OrganizationMembershipType,
  templateInput: unknown,
  customRoleId: string | null | undefined,
  permissions: readonly OrganizationPermission[],
  env: ServerEnv,
) {
  if (customRoleId) {
    if (membershipType !== "permanent") {
      throw badRequest("Custom roles are available only to permanent members");
    }
    if (templateInput !== null && templateInput !== undefined) {
      throw badRequest("Choose either a system role or a custom role");
    }
    const customRole = await loadCustomRoleDefinition(
      organizationId,
      customRoleId,
      env,
    );
    if (
      customRole.permissions.length !== permissions.length
      || customRole.permissions.some((permission) => !permissions.includes(permission))
    ) {
      throw badRequest("The selected custom role and permission set do not match");
    }
    return {
      accountRole: "admin" as const,
      customRole,
      templateKey: null,
    };
  }

  const templateKey = cleanTemplateKey(
    templateInput,
    membershipType,
    permissions,
  );
  return {
    accountRole: accountRoleForTemplate(templateKey, membershipType),
    customRole: null,
    templateKey,
  };
}

function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,47}$/.test(username)) {
    throw badRequest(
      "Username must be 3–48 characters and use letters, numbers, dots, underscores, or hyphens",
    );
  }
  return username;
}

export type OrganizationAccountCredentialPlan = {
  credentialMode: "existing-email" | "permanent-username" | "temporary-username";
  email: string | null;
  username: string | null;
};

export function resolveOrganizationAccountCredentialPlan(input: {
  accountMode?: "existing" | "new";
  membershipType: OrganizationMembershipType;
  email?: string | null;
  username?: string | null;
  initialPassword?: string | null;
}): OrganizationAccountCredentialPlan {
  const email = input.email?.trim().toLowerCase() ?? "";

  if (input.membershipType === "temporary") {
    if ((input.initialPassword?.length ?? 0) < 8) {
      throw badRequest("Initial password must contain at least 8 characters");
    }
    const username = input.username ? normalizeUsername(input.username) : null;
    if (!username || username.length < 4) {
      throw badRequest("Temporary accounts require a username of at least 4 characters");
    }
    return {
      credentialMode: "temporary-username",
      email: null,
      username,
    };
  }

  if (input.accountMode === "existing") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw badRequest("Existing permanent accounts require a valid email address");
    }
    return {
      credentialMode: "existing-email",
      email,
      username: null,
    };
  }

  if (input.accountMode !== "new") {
    throw badRequest("Choose whether to add an existing account or create a new member");
  }
  if ((input.initialPassword?.length ?? 0) < 8) {
    throw badRequest("Initial password must contain at least 8 characters");
  }
  const username = input.username ? normalizeUsername(input.username) : null;
  if (!username || username.length < 4) {
    throw badRequest("New permanent accounts require a username of at least 4 characters");
  }
  if (email) {
    throw badRequest("Create the member without email; they can add it later from My Account");
  }
  return {
    credentialMode: "permanent-username",
    email: null,
    username,
  };
}

async function findAuthUserByEmail(email: string, env: ServerEnv) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: loginIdentifier, error: loginIdentifierError } = await adminClient
    .from("account_login_identifiers")
    .select("user_id")
    .eq("email", email)
    .maybeSingle<{ user_id: string }>();
  if (loginIdentifierError) throw loginIdentifierError;
  if (loginIdentifier) {
    const { data, error } = await adminClient.auth.admin.getUserById(loginIdentifier.user_id);
    if (error) throw error;
    if (data.user) return data.user;
  }

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email,
    );
    if (user) return user;
    if (data.users.length < 100) return null;
  }
  throw conflict("Unable to resolve this account from the current Auth user set");
}

function requireDelegablePermissions(
  session: RequestSession,
  organizationId: string,
  permissions: readonly OrganizationPermission[],
) {
  if (session.account.isMasterAdmin) return;
  const access = session.account.organizations.find(
    (organization) =>
      organization.organizationId === organizationId,
  );
  if (access?.role === "owner") return;
  if (
    !access
    || permissions.some((permission) => !access.permissions.includes(permission))
  ) {
    throw forbidden("You cannot grant an organization permission you do not hold");
  }
}

function requirePermanentAccountManager(
  session: RequestSession,
  organizationId: string,
) {
  if (session.account.isMasterAdmin) return;
  const access = session.account.organizations.find(
    (organization) => organization.organizationId === organizationId,
  );
  if (access?.membershipType !== "temporary") return;
  throw forbidden("Temporary race accounts cannot manage organization accounts");
}

async function loadMembershipForManagement(
  session: RequestSession,
  organizationId: string,
  membershipId: string,
  env: ServerEnv,
) {
  requireOrganizationAccess(session, organizationId, "team.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("organization_memberships")
    .select(
      "id,organization_id,user_id,role,membership_type,account_template_key,custom_role_id,permission_keys,login_username,status,expires_at,joined_at",
    )
    .eq("id", membershipId)
    .eq("organization_id", organizationId)
    .maybeSingle<MembershipRow>();
  if (error) throw error;
  if (!data) throw notFound("Organization account not found");
  if (session.account.platformRole === "site_admin") {
    const { data: targetAdministrator, error: administratorError } = await adminClient
      .from("platform_administrators")
      .select("user_id")
      .eq("user_id", data.user_id)
      .maybeSingle<{ user_id: string }>();
    if (administratorError) throw administratorError;
    if (targetAdministrator) {
      throw forbidden("Only super administrators can edit platform administrator accounts.");
    }
  }

  if (data.role === "owner") {
    throw conflict(
      "Organization ownership must be changed through the ownership transfer flow",
    );
  }
  const actorAccess = session.account.organizations.find(
    (organization) => organization.organizationId === organizationId,
  );
  if (
    !session.account.isMasterAdmin
    && actorAccess?.membershipType === "temporary"
  ) {
    throw forbidden("Temporary race accounts cannot manage organization accounts");
  }
  requireDelegablePermissions(
    session,
    organizationId,
    effectiveOrganizationPermissions(
      data.role,
      Array.isArray(data.permission_keys) ? data.permission_keys : [],
    ),
  );
  return data;
}

export async function listOrganizationTeam(
  session: RequestSession,
  organizationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizationTeamMember[]> {
  requireOrganizationAccess(session, organizationId, "team.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data: memberships, error: membershipsError } = await adminClient
    .from("organization_memberships")
    .select(
      "id,organization_id,user_id,role,membership_type,account_template_key,custom_role_id,permission_keys,login_username,status,expires_at,joined_at",
    )
    .eq("organization_id", organizationId)
    .neq("status", "removed")
    .order("created_at", { ascending: true })
    .returns<MembershipRow[]>();
  if (membershipsError) throw membershipsError;

  const rows = memberships ?? [];
  const userIds = rows.map((membership) => membership.user_id);
  const [profilesResult, loginIdentifiersResult, seriesResult] = await Promise.all([
    userIds.length
      ? adminClient
          .from("user_profiles")
          .select("user_id,email,display_name,first_name,last_name,phone,job_title")
          .in("user_id", userIds)
          .returns<Array<{
            user_id: string;
            email: string | null;
            display_name: string | null;
            first_name: string | null;
            last_name: string | null;
            phone: string | null;
            job_title: string | null;
          }>>()
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? adminClient
          .from("account_login_identifiers")
          .select("user_id,username")
          .in("user_id", userIds)
          .returns<Array<{ user_id: string; username: string }>>()
      : Promise.resolve({ data: [], error: null }),
    adminClient
      .from("event_series")
      .select("id")
      .eq("organization_id", organizationId)
      .returns<Array<{ id: string }>>(),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (loginIdentifiersResult.error) throw loginIdentifiersResult.error;
  if (seriesResult.error) throw seriesResult.error;

  const seriesIds = (seriesResult.data ?? []).map((series) => series.id);
  const editionsResult = seriesIds.length
    ? await adminClient
        .from("event_editions")
        .select("id,name")
        .in("event_series_id", seriesIds)
        .returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  if (editionsResult.error) throw editionsResult.error;

  const editionIds = (editionsResult.data ?? []).map((edition) => edition.id);
  const assignmentsResult = editionIds.length && userIds.length
    ? await adminClient
        .from("event_staff_assignments")
        .select(
          "id,event_edition_id,staff_user_id,role_title,assignment_state,starts_at,ends_at",
        )
        .in("event_edition_id", editionIds)
        .in("staff_user_id", userIds)
        .neq("assignment_state", "cancelled")
        .returns<Array<{
          id: string;
          event_edition_id: string;
          staff_user_id: string;
          role_title: string;
          assignment_state: string;
          starts_at: string;
          ends_at: string;
        }>>()
    : { data: [], error: null };
  if (assignmentsResult.error) throw assignmentsResult.error;

  const profileByUserId = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.user_id, profile]),
  );
  const loginUsernameByUserId = new Map(
    (loginIdentifiersResult.data ?? []).map((identifier) => [
      identifier.user_id,
      identifier.username,
    ]),
  );
  const editionNameById = new Map(
    (editionsResult.data ?? []).map((edition) => [edition.id, edition.name]),
  );
  const assignmentsByUserId = new Map<string, OrganizationTeamMember["assignments"]>();
  for (const assignment of assignmentsResult.data ?? []) {
    const current = assignmentsByUserId.get(assignment.staff_user_id) ?? [];
    current.push({
      assignmentId: assignment.id,
      eventEditionId: assignment.event_edition_id,
      eventName: editionNameById.get(assignment.event_edition_id) ?? "Race",
      roleTitle: assignment.role_title,
      assignmentState: assignment.assignment_state,
      startsAt: assignment.starts_at,
      endsAt: assignment.ends_at,
    });
    assignmentsByUserId.set(assignment.staff_user_id, current);
  }

  return rows.map((membership) => {
    const profile = profileByUserId.get(membership.user_id);
    const membershipType =
      membership.membership_type === "temporary" ? "temporary" : "permanent";
    const loginUsername = membershipType === "temporary"
      ? membership.login_username
      : loginUsernameByUserId.get(membership.user_id) ?? null;
    return {
      membershipId: membership.id,
      organizationId: membership.organization_id,
      userId: membership.user_id,
      displayName:
        profile?.display_name?.trim()
        || loginUsername
        || profile?.email?.split("@")[0]
        || "Organization member",
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      email: membershipType === "temporary" ? null : profile?.email ?? null,
      phone: membershipType === "temporary" ? null : profile?.phone ?? null,
      jobTitle: profile?.job_title ?? null,
      role: membership.role,
      membershipType,
      templateKey: membership.account_template_key,
      customRoleId: membership.custom_role_id,
      loginUsername,
      permissions: effectiveOrganizationPermissions(
        membership.role,
        Array.isArray(membership.permission_keys) ? membership.permission_keys : [],
      ),
      status: membership.status,
      expiresAt: membership.expires_at,
      joinedAt: membership.joined_at,
      assignments: assignmentsByUserId.get(membership.user_id) ?? [],
    };
  });
}

export type OrganizationOwnershipTransferResult = {
  organizationId: string;
  previousOwnerMembershipId: string;
  newOwnerMembershipId: string;
  previousOwnerRetired: true;
};

export async function transferOrganizationOwnership(
  session: RequestSession,
  organizationId: string,
  currentOwnerMembershipId: string,
  newOwnerMembershipId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<OrganizationOwnershipTransferResult> {
  requirePlatformCapability(session, "platform.records.transfer");
  if (currentOwnerMembershipId === newOwnerMembershipId) {
    throw badRequest("Choose a different member as the new organization owner");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc(
    "service_transfer_organization_ownership",
    {
      p_organization_id: organizationId,
      p_current_owner_membership_id: currentOwnerMembershipId,
      p_new_owner_membership_id: newOwnerMembershipId,
      p_actor_user_id: session.account.userId,
    },
  );

  if (error) {
    if (
      error.message.includes("organization_not_found")
      || error.message.includes("organization_owner_not_found")
      || error.message.includes("organization_new_owner_not_found")
    ) {
      throw notFound("The organization owner or selected administrator no longer exists");
    }
    if (error.message.includes("organization_new_owner_must_be_an_active_permanent_admin")) {
      throw badRequest("Choose an active permanent Organization Admin as the new owner");
    }
    if (
      error.message.includes("organization_current_owner_is_not_active")
      || error.message.includes("organization_owner_transfer_conflict")
    ) {
      throw conflict("Organization ownership changed while this transfer was being prepared");
    }
    throw error;
  }

  return data as OrganizationOwnershipTransferResult;
}

export async function createOrganizationAccount(
  session: RequestSession,
  organizationId: string,
  input: {
    accountMode?: "existing" | "new";
    templateKey?: OrganizationAccountTemplateKey | null;
    customRoleId?: string | null;
    membershipType: OrganizationMembershipType;
    displayName: string;
    email?: string | null;
    username?: string | null;
    initialPassword?: string | null;
    permissions: readonly unknown[];
    expiresAt?: string | null;
    jobTitle?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, organizationId, "team.manage");
  const adminClient = createAdminSupabaseClient(env);
  const displayName = input.displayName.trim();
  if (displayName.length < 2) throw badRequest("Display name is required");
  const permissions = cleanPermissions(input.permissions);
  if (!permissions.length) {
    throw badRequest("Grant at least one permission");
  }
  requireDelegablePermissions(session, organizationId, permissions);

  const membershipType = input.membershipType;
  const resolvedRole = await resolveAccountRole(
    organizationId,
    membershipType,
    input.templateKey,
    input.customRoleId,
    permissions,
    env,
  );
  const { accountRole, customRole, templateKey } = resolvedRole;
  const credentialPlan = resolveOrganizationAccountCredentialPlan(input);
  const username = credentialPlan.username;
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (
    membershipType === "temporary"
    && (!username || !expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
  ) {
    throw badRequest("Temporary accounts require a unique username and future expiry");
  }
  requirePermanentAccountManager(session, organizationId);
  if (username) {
    const [
      organizationUsernameResult,
      accountUsernameResult,
      usernameReservation,
    ] = await Promise.all([
      adminClient
        .from("organization_memberships")
        .select("id")
        .eq("login_username", username)
        .neq("status", "removed")
        .maybeSingle<{ id: string }>(),
      adminClient
        .from("account_login_identifiers")
        .select("user_id")
        .eq("username", username)
        .maybeSingle<{ user_id: string }>(),
      findActiveAccountUsernameReservation(username, env),
    ]);
    const { data: existingUsername, error: usernameError } = organizationUsernameResult;
    if (usernameError) throw usernameError;
    if (accountUsernameResult.error) throw accountUsernameResult.error;
    if (existingUsername || accountUsernameResult.data || usernameReservation) {
      throw conflict("This login username is already in use");
    }
  }

  const authEmail = credentialPlan.credentialMode === "existing-email"
    ? credentialPlan.email!
    : credentialPlan.credentialMode === "temporary-username"
      ? `temp.${randomUUID()}@accounts.sitrail.invalid`
      : `user-${randomUUID()}@accounts.sitrail.invalid`;
  let userId = "";
  let invitationSent = false;
  let createdAuthUser = false;

  if (membershipType === "permanent") {
    if (credentialPlan.credentialMode === "existing-email") {
      const existingUser = await findAuthUserByEmail(authEmail, env);
      if (!existingUser) {
        throw badRequest("No RacesOn account was found for this email. Choose Create new member instead");
      }
      userId = existingUser.id;
    } else {
      const { data: createdAuth, error: authError } = await adminClient.auth.admin.createUser({
        email: authEmail,
        password: input.initialPassword!,
        email_confirm: true,
        app_metadata: {
          trail_credential_mode: "username",
        },
        user_metadata: {
          display_name: displayName,
          requested_roles: ["organizer"],
        },
      });
      if (authError || !createdAuth.user) {
        throw authError ?? new Error("Organization account was not created");
      }
      userId = createdAuth.user.id;
      createdAuthUser = true;
    }
  } else {
    const passwordSalt = randomUUID();
    const { data: createdAuth, error: authError } = await adminClient.auth.admin.createUser({
      email: authEmail,
      password: deriveTemporaryOrganizationPassword(passwordSalt, input.initialPassword!),
      email_confirm: true,
      app_metadata: {
        trail_account_type: membershipType,
        trail_password_mode: TEMPORARY_ACCOUNT_PASSWORD_MODE,
        trail_password_salt: passwordSalt,
      },
      user_metadata: {
        display_name: displayName,
      },
    });
    if (authError || !createdAuth.user) {
      throw authError ?? new Error("Organization account was not created");
    }
    userId = createdAuth.user.id;
    createdAuthUser = true;
  }

  try {
    const { data: existingMembership, error: existingMembershipError } = await adminClient
      .from("organization_memberships")
      .select("id,status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle<{ id: string; status: string }>();
    if (existingMembershipError) throw existingMembershipError;
    if (existingMembership && existingMembership.status !== "removed") {
      throw conflict("This account already belongs to the organization");
    }

    if (credentialPlan.credentialMode === "permanent-username") {
      const { error: identifierError } = await adminClient
        .from("account_login_identifiers")
        .insert({
          user_id: userId,
          username: username!,
          email: null,
          username_changed_at: new Date().toISOString(),
        });
      if (identifierError) {
        if (identifierError.code === "23505") {
          throw conflict("This login username is already in use");
        }
        throw identifierError;
      }
    }

    if (createdAuthUser) {
      const { error: profileError } = await adminClient
        .from("user_profiles")
        .upsert({
          user_id: userId,
          email: credentialPlan.credentialMode === "permanent-username" ? null : authEmail,
          display_name: displayName,
          job_title: input.jobTitle?.trim() || null,
        }, {
          onConflict: "user_id",
        });
      if (profileError) throw profileError;
    }

    const membershipStatus = invitationSent ? "invited" : "active";
    const membershipPayload = {
        organization_id: organizationId,
        user_id: userId,
        role: accountRole,
        status: membershipStatus,
        membership_type: membershipType,
        account_template_key: templateKey,
        custom_role_id: customRole?.id ?? null,
        permission_keys: permissions,
        login_username: membershipType === "temporary" ? username : null,
        expires_at: membershipType === "temporary" ? expiresAt!.toISOString() : null,
        invited_by_user_id: session.account.userId,
        created_by_user_id: session.account.userId,
        joined_at: invitationSent ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    const membershipQuery = existingMembership
      ? adminClient
          .from("organization_memberships")
          .update(membershipPayload)
          .eq("id", existingMembership.id)
      : adminClient.from("organization_memberships").insert(membershipPayload);
    const { data: membership, error: membershipError } = await membershipQuery
      .select("id")
      .single<{ id: string }>();
    if (membershipError) throw membershipError;

    const { error: auditError } = await adminClient.from("audit_log").insert({
      organization_id: organizationId,
      actor_user_id: session.account.userId,
      entity_type: "organization_membership",
      entity_id: membership.id,
      action: invitationSent
        ? "organization.account_invited"
        : "organization.account_created",
      metadata_json: {
        membershipType,
        templateKey,
        customRoleId: customRole?.id ?? null,
        permissions,
        invitationSent,
        expiresAt: membershipType === "temporary" ? expiresAt!.toISOString() : null,
      },
    });
    if (auditError) throw auditError;

    return {
      membershipId: membership.id,
      userId,
      username,
      email: credentialPlan.email,
      membershipType,
      invitationSent,
    };
  } catch (error) {
    if (createdAuthUser) {
      await adminClient.auth.admin.deleteUser(userId, true).catch(() => undefined);
    }
    throw error;
  }
}

export async function updateOrganizationAccount(
  session: RequestSession,
  organizationId: string,
  membershipId: string,
  input: {
    templateKey?: OrganizationAccountTemplateKey | null;
    customRoleId?: string | null;
    displayName: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    jobTitle?: string | null;
    username?: string | null;
    permissions: readonly unknown[];
    status: "active" | "suspended" | "removed";
    expiresAt?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const membership = await loadMembershipForManagement(
    session,
    organizationId,
    membershipId,
    env,
  );
  const permissions = cleanPermissions(input.permissions);
  if (!permissions.length && input.status === "active") {
    throw badRequest("Active accounts require at least one permission");
  }
  requireDelegablePermissions(session, organizationId, permissions);
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (
    membership.membership_type === "temporary"
    && input.status === "active"
    && (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
  ) {
    throw badRequest("Active temporary accounts require a future expiry");
  }

  const adminClient = createAdminSupabaseClient(env);
  const displayName = input.displayName.trim();
  if (displayName.length < 2) throw badRequest("Display name is required");

  const membershipType =
    membership.membership_type === "temporary" ? "temporary" : "permanent";
  // Temporary event accounts never manage organization memberships.
  if (input.status === "active") {
    requirePermanentAccountManager(session, organizationId);
  }
  const resolvedRole = await resolveAccountRole(
    organizationId,
    membershipType,
    input.templateKey,
    input.customRoleId,
    permissions,
    env,
  );
  const { accountRole, customRole, templateKey } = resolvedRole;
  const username =
    membershipType === "temporary" && input.username
      ? normalizeUsername(input.username)
      : null;
  if (membershipType === "temporary") {
    if (!username) {
      throw badRequest("Temporary accounts require a login username");
    }
    if (username.length < 4) {
      throw badRequest("Temporary account username must contain at least 4 characters");
    }
  }
  if (username) {
    const [
      organizationUsernameResult,
      accountUsernameResult,
      usernameReservation,
    ] = await Promise.all([
      adminClient
        .from("organization_memberships")
        .select("id")
        .eq("login_username", username)
        .neq("id", membership.id)
        .neq("status", "removed")
        .maybeSingle<{ id: string }>(),
      adminClient
        .from("account_login_identifiers")
        .select("user_id")
        .eq("username", username)
        .neq("user_id", membership.user_id)
        .maybeSingle<{ user_id: string }>(),
      findActiveAccountUsernameReservation(username, env),
    ]);
    const { data: existingUsername, error: usernameError } = organizationUsernameResult;
    if (usernameError) throw usernameError;
    if (accountUsernameResult.error) throw accountUsernameResult.error;
    if (
      existingUsername
      || accountUsernameResult.data
      || (usernameReservation && usernameReservation.userId !== membership.user_id)
    ) {
      throw conflict("This login username is already in use");
    }
  }

  const [currentProfileResult, accountIdentifierResult] = await Promise.all([
    adminClient
      .from("user_profiles")
      .select("email")
      .eq("user_id", membership.user_id)
      .maybeSingle<{ email: string | null }>(),
    adminClient
      .from("account_login_identifiers")
      .select("username,email")
      .eq("user_id", membership.user_id)
      .maybeSingle<{ username: string; email: string | null }>(),
  ]);
  const { data: currentProfile, error: currentProfileError } = currentProfileResult;
  if (currentProfileError) throw currentProfileError;
  if (accountIdentifierResult.error) throw accountIdentifierResult.error;
  const isPermanentUsernameOnly =
    membershipType === "permanent"
    && Boolean(accountIdentifierResult.data?.username)
    && !accountIdentifierResult.data?.email;
  const permanentEmail = input.email?.trim().toLowerCase() ?? "";
  if (
    membershipType === "permanent"
    && !isPermanentUsernameOnly
    && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(permanentEmail)
  ) {
    throw badRequest("Permanent email accounts require a valid email address");
  }

  const { data: authUser, error: authUserError } =
    await adminClient.auth.admin.getUserById(membership.user_id);
  if (authUserError || !authUser.user) {
    throw authUserError ?? notFound("Organization user was not found");
  }

  const nextAuthEmail =
    membershipType === "permanent"
      ? isPermanentUsernameOnly
        ? authUser.user.email ?? ""
        : permanentEmail
      : authUser.user.email ?? currentProfile?.email ?? "";
  const authUpdate = {
    ...(nextAuthEmail && nextAuthEmail !== authUser.user.email
      ? { email: nextAuthEmail, email_confirm: true }
      : {}),
    user_metadata: {
      ...authUser.user.user_metadata,
      display_name: displayName,
    },
  };
  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
    membership.user_id,
    authUpdate,
  );
  if (authUpdateError) {
    if (authUpdateError.message.toLowerCase().includes("already")) {
      throw conflict("An account already exists for this email");
    }
    throw authUpdateError;
  }

  const { error: membershipError } = await adminClient
    .from("organization_memberships")
    .update({
      permission_keys: permissions,
      account_template_key: templateKey,
      custom_role_id: customRole?.id ?? null,
      role: accountRole,
      status: input.status,
      login_username:
        membershipType === "temporary" ? username : membership.login_username,
      expires_at:
        membershipType === "temporary"
          ? expiresAt?.toISOString() ?? membership.expires_at
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membership.id);
  if (membershipError) {
    if (nextAuthEmail !== authUser.user.email && authUser.user.email) {
      await adminClient.auth.admin.updateUserById(
        membership.user_id,
        { email: authUser.user.email, email_confirm: true },
      ).catch(() => undefined);
    }
    throw membershipError;
  }

  const { error: profileError } = await adminClient
    .from("user_profiles")
    .upsert({
      user_id: membership.user_id,
      email: isPermanentUsernameOnly
        ? null
        : nextAuthEmail || currentProfile?.email || null,
      display_name: displayName,
      first_name: membershipType === "permanent" ? input.firstName?.trim() || null : null,
      last_name: membershipType === "permanent" ? input.lastName?.trim() || null : null,
      phone: membershipType === "permanent" ? input.phone?.trim() || null : null,
      job_title: input.jobTitle?.trim() || null,
    }, {
      onConflict: "user_id",
    });
  if (profileError) throw profileError;

  await adminClient.from("audit_log").insert({
    organization_id: organizationId,
    actor_user_id: session.account.userId,
    entity_type: "organization_membership",
    entity_id: membership.id,
    action: "organization.account_updated",
    metadata_json: {
      permissions,
      templateKey,
      customRoleId: customRole?.id ?? null,
      status: input.status,
      displayNameChanged: displayName !== (authUser.user.user_metadata?.display_name ?? ""),
      emailChanged: membershipType === "permanent" && nextAuthEmail !== authUser.user.email,
      usernameChanged:
        membershipType === "temporary" && username !== membership.login_username,
      expiresAt: expiresAt?.toISOString() ?? membership.expires_at,
    },
  });
  return { updated: true };
}

export async function resetOrganizationAccountPassword(
  session: RequestSession,
  organizationId: string,
  membershipId: string,
  newPassword: string,
  env: ServerEnv = loadServerEnv(),
) {
  const membership = await loadMembershipForManagement(
    session,
    organizationId,
    membershipId,
    env,
  );
  const membershipType =
    membership.membership_type === "temporary" ? "temporary" : "permanent";
  const minimumLength = 8;
  if (newPassword.length < minimumLength) {
    throw badRequest(`New password must contain at least ${minimumLength} characters`);
  }
  const adminClient = createAdminSupabaseClient(env);
  let password = newPassword;
  let appMetadata: Record<string, unknown> | undefined;
  if (membershipType === "temporary") {
    if (!membership.login_username) {
      throw badRequest("Temporary accounts require a login username");
    }
    const { data: currentAuth, error: currentAuthError } =
      await adminClient.auth.admin.getUserById(membership.user_id);
    if (currentAuthError || !currentAuth.user) {
      throw currentAuthError ?? notFound("Organization user was not found");
    }
    const passwordSalt = randomUUID();
    password = deriveTemporaryOrganizationPassword(passwordSalt, newPassword);
    appMetadata = {
      ...currentAuth.user.app_metadata,
      trail_password_mode: TEMPORARY_ACCOUNT_PASSWORD_MODE,
      trail_password_salt: passwordSalt,
    };
  }
  const { error } = await adminClient.auth.admin.updateUserById(
    membership.user_id,
    {
      password,
      ...(appMetadata ? { app_metadata: appMetadata } : {}),
    },
  );
  if (error) throw error;
  await adminClient.from("audit_log").insert({
    organization_id: organizationId,
    actor_user_id: session.account.userId,
    entity_type: "organization_membership",
    entity_id: membership.id,
    action: "organization.account_password_reset",
    metadata_json: {},
  });
  return { reset: true };
}

export async function changeCurrentUserPassword(
  session: RequestSession,
  currentPassword: string,
  newPassword: string,
  env: ServerEnv = loadServerEnv(),
) {
  if (!currentPassword || newPassword.length < 8) {
    throw badRequest("Enter the current password and a new password of at least 8 characters");
  }
  const adminClient = createAdminSupabaseClient(env);
  const { data: authUser, error: authUserError } = await adminClient.auth.admin.getUserById(
    session.account.userId,
  );
  if (authUserError || !authUser.user?.email) {
    throw forbidden("Password sign-in is unavailable for this account");
  }
  const authClient = createServerAuthSupabaseClient(env);
  const { error: verifyError } = await authClient.auth.signInWithPassword({
    email: authUser.user.email,
    password: currentPassword,
  });
  if (verifyError) throw forbidden("Current password is incorrect");

  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    session.account.userId,
    { password: newPassword },
  );
  if (updateError) throw updateError;
  return { changed: true };
}

export async function resolveOrganizationLoginCredential(
  identifier: string,
  env: ServerEnv = loadServerEnv(),
) {
  const normalized = identifier.trim().toLowerCase();
  if (normalized.includes("@")) {
    return {
      email: normalized,
      username: null,
      passwordSalt: null,
      passwordMode: null,
    };
  }
  const username = normalizeUsername(normalized);
  const adminClient = createAdminSupabaseClient(env);
  const { data: membership, error } = await adminClient
    .from("organization_memberships")
    .select("user_id,expires_at,membership_type")
    .eq("login_username", username)
    .eq("status", "active")
    .maybeSingle<{
      user_id: string;
      expires_at: string | null;
      membership_type: string;
    }>();
  if (error) throw error;
  if (
    !membership
    || (membership.expires_at && Date.parse(membership.expires_at) <= Date.now())
  ) {
    throw forbidden("Invalid username or password");
  }
  const { data: user, error: userError } = await adminClient.auth.admin.getUserById(
    membership.user_id,
  );
  if (userError || !user.user?.email) {
    throw forbidden("Invalid username or password");
  }
  return {
    email: user.user.email,
    username,
    passwordSalt:
      typeof user.user.app_metadata?.trail_password_salt === "string"
        ? user.user.app_metadata.trail_password_salt
        : null,
    passwordMode:
      membership.membership_type === "temporary"
      && user.user.app_metadata?.trail_password_mode === TEMPORARY_ACCOUNT_PASSWORD_MODE
      && typeof user.user.app_metadata?.trail_password_salt === "string"
        ? TEMPORARY_ACCOUNT_PASSWORD_MODE
        : null,
  };
}

export async function resolveOrganizationLoginEmail(
  identifier: string,
  env: ServerEnv = loadServerEnv(),
) {
  return (await resolveOrganizationLoginCredential(identifier, env)).email;
}
