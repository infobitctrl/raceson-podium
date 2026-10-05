import type {
  OrganizationPermission,
  RequestSession,
} from "@raceson/domain/auth";
import { forbidden, notFound } from "./errors.js";
import { createAdminSupabaseClient } from "./supabase.js";
import { loadServerEnv, type ServerEnv } from "./env.js";

export type PermissionRequirement =
  | OrganizationPermission
  | readonly OrganizationPermission[]
  | "manage"
  | "timing";

type EditionContext = {
  editionId: string;
  editionName: string;
  editionSlug: string;
  organizationId: string;
};

type CategoryContext = {
  categoryId: string;
  categoryName: string;
  eventEditionId: string;
  organizationId: string;
};

type RegistrationContext = {
  registrationId: string;
  athleteProfileId: string;
  eventCategoryId: string;
  eventEditionId: string;
  organizationId: string;
  status: string;
  paymentStatus: string;
  participationStatus: string;
  representedClubId: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

type TimingSessionContext = {
  sessionId: string;
  organizationId: string;
  eventEditionId: string;
  eventCategoryId: string | null;
  checkpointId: string | null;
  status: string;
  mode: string;
  startedAt: string;
  closedAt: string | null;
};

function requestedPermissions(
  requirement: PermissionRequirement,
): readonly OrganizationPermission[] {
  if (requirement === "manage") return ["events.manage"];
  if (requirement === "timing") return ["race_day.manage"];
  return Array.isArray(requirement)
    ? requirement
    : [requirement as OrganizationPermission];
}

export function hasOrganizationPermission(
  session: RequestSession,
  organizationId: string,
  requirement: PermissionRequirement,
) {
  if (!session.account.hasOrganizerAccess) return false;
  if (session.account.isMasterAdmin) return true;
  const membership = session.account.organizations.find(
    (organization) => organization.organizationId === organizationId,
  );
  if (!membership) return false;
  if (membership.role === "owner") return true;
  if (membership.role !== "admin") return false;
  return requestedPermissions(requirement).some(
    (permission) => membership.permissions.includes(permission),
  );
}

export function hasEventPermission(
  session: RequestSession,
  eventEditionId: string,
  organizationId: string,
  requirement: PermissionRequirement,
) {
  if (!session.account.hasOrganizerAccess) return false;
  if (hasOrganizationPermission(session, organizationId, requirement)) return true;
  const permissions = requestedPermissions(requirement);
  return session.account.eventAccess.some(
    (assignment) =>
      assignment.organizationId === organizationId
      && assignment.eventEditionId === eventEditionId
      && permissions.some((permission) => assignment.permissions.includes(permission)),
  );
}

export function hasCheckpointPermission(
  session: RequestSession,
  eventEditionId: string,
  organizationId: string,
  eventCategoryId: string,
  checkpointId: string,
  requirement: PermissionRequirement,
) {
  if (!session.account.hasOrganizerAccess) return false;
  if (hasOrganizationPermission(session, organizationId, requirement)) return true;
  const permissions = requestedPermissions(requirement);
  return session.account.eventAccess.some(
    (assignment) =>
      assignment.organizationId === organizationId
      && assignment.eventEditionId === eventEditionId
      && (
        assignment.eventCategoryId === null
        || assignment.eventCategoryId === eventCategoryId
      )
      && (
        assignment.checkpointId === null
        || assignment.checkpointId === checkpointId
      )
      && permissions.some((permission) =>
        assignment.permissions.includes(permission)
      ),
  );
}

export function requireVerifiedEmail(session: RequestSession) {
  if (!session.account.emailVerified) {
    throw forbidden("Verified email is required");
  }
}

function requireOrganizationIdentity(
  session: RequestSession,
  organizationId: string,
) {
  if (session.account.emailVerified) return;

  const membership = session.account.organizations.find(
    (organization) => organization.organizationId === organizationId,
  );
  const isPermanentUsernameOnlyAccount =
    session.account.email === null
    && Boolean(session.account.loginUsername)
    && membership?.membershipType === "permanent";

  if (!isPermanentUsernameOnlyAccount) {
    throw forbidden("Verified email is required");
  }
}

export function requireAthleteProfileId(session: RequestSession) {
  const athleteProfileId = session.account.primaryAthleteProfileId;
  if (!athleteProfileId) {
    throw forbidden("Athlete profile is required");
  }
  return athleteProfileId;
}

export function requireOrganizationAccess(
  session: RequestSession,
  organizationId: string,
  requirement: PermissionRequirement = "manage",
) {
  requireOrganizationIdentity(session, organizationId);
  if (!hasOrganizationPermission(session, organizationId, requirement)) {
    throw forbidden("Required organization permission is missing");
  }
}

export async function resolveEditionContext(
  editionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<EditionContext> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: edition, error } = await adminClient
    .from("event_editions")
    .select("id,name,slug,event_series_id")
    .eq("id", editionId)
    .is("organizer_deleted_at", null)
    .maybeSingle<{ id: string; name: string; slug: string; event_series_id: string }>();

  if (error) throw error;
  if (!edition) throw notFound("Edition not found");

  const { data: series, error: seriesError } = await adminClient
    .from("event_series")
    .select("organization_id")
    .eq("id", edition.event_series_id)
    .maybeSingle<{ organization_id: string }>();

  if (seriesError) throw seriesError;
  if (!series) throw notFound("Edition organization not found");

  return {
    editionId: edition.id,
    editionName: edition.name,
    editionSlug: edition.slug,
    organizationId: series.organization_id,
  };
}

export async function requireEditionAccess(
  session: RequestSession,
  editionId: string,
  requirement: PermissionRequirement = "manage",
  env: ServerEnv = loadServerEnv(),
) {
  const context = await resolveEditionContext(editionId, env);
  requireOrganizationIdentity(session, context.organizationId);
  if (!hasEventPermission(
    session,
    context.editionId,
    context.organizationId,
    requirement,
  )) {
    throw forbidden("Required race permission is missing");
  }
  return context;
}

export async function resolveCategoryContext(
  categoryId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<CategoryContext> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: category, error } = await adminClient
    .from("event_categories")
    .select("id,name,event_edition_id")
    .eq("id", categoryId)
    .is("organizer_deleted_at", null)
    .maybeSingle<{ id: string; name: string; event_edition_id: string }>();

  if (error) throw error;
  if (!category) throw notFound("Category not found");

  const edition = await resolveEditionContext(category.event_edition_id, env);
  return {
    categoryId: category.id,
    categoryName: category.name,
    eventEditionId: category.event_edition_id,
    organizationId: edition.organizationId,
  };
}

export async function requireCategoryAccess(
  session: RequestSession,
  categoryId: string,
  requirement: PermissionRequirement = "manage",
  env: ServerEnv = loadServerEnv(),
) {
  const context = await resolveCategoryContext(categoryId, env);
  requireOrganizationIdentity(session, context.organizationId);
  if (!hasEventPermission(
    session,
    context.eventEditionId,
    context.organizationId,
    requirement,
  )) {
    throw forbidden("Required race permission is missing");
  }
  return context;
}

export async function requireCheckpointAccess(
  session: RequestSession,
  checkpointId: string,
  requirement: PermissionRequirement = "timing",
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: checkpoint, error } = await adminClient
    .from("checkpoints")
    .select("id,event_category_id")
    .eq("id", checkpointId)
    .maybeSingle<{ id: string; event_category_id: string }>();
  if (error) throw error;
  if (!checkpoint) throw notFound("Checkpoint not found");

  const category = await resolveCategoryContext(checkpoint.event_category_id, env);
  requireOrganizationIdentity(session, category.organizationId);
  if (!hasCheckpointPermission(
    session,
    category.eventEditionId,
    category.organizationId,
    category.categoryId,
    checkpoint.id,
    requirement,
  )) {
    throw forbidden("This account is not assigned to the requested checkpoint");
  }
  return {
    checkpointId: checkpoint.id,
    ...category,
  };
}

export async function resolveRegistrationContext(
  registrationId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<RegistrationContext> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: registration, error } = await adminClient
    .from("registrations")
    .select(
      "id,athlete_profile_id,event_category_id,represented_club_id,status,payment_status,participation_status,created_at,confirmed_at",
    )
    .eq("id", registrationId)
    .maybeSingle<{
      id: string;
      athlete_profile_id: string;
      event_category_id: string;
      represented_club_id: string | null;
      status: string;
      payment_status: string;
      participation_status: string;
      created_at: string;
      confirmed_at: string | null;
    }>();

  if (error) throw error;
  if (!registration) throw notFound("Registration not found");

  const category = await resolveCategoryContext(registration.event_category_id, env);
  return {
    registrationId: registration.id,
    athleteProfileId: registration.athlete_profile_id,
    eventCategoryId: registration.event_category_id,
    eventEditionId: category.eventEditionId,
    organizationId: category.organizationId,
    status: registration.status,
    paymentStatus: registration.payment_status,
    participationStatus: registration.participation_status,
    representedClubId: registration.represented_club_id,
    createdAt: registration.created_at,
    confirmedAt: registration.confirmed_at,
  };
}

export async function requireRegistrationAccess(
  session: RequestSession,
  registrationId: string,
  requirement: PermissionRequirement = "manage",
  env: ServerEnv = loadServerEnv(),
) {
  const context = await resolveRegistrationContext(registrationId, env);
  requireOrganizationIdentity(session, context.organizationId);
  if (!hasEventPermission(
    session,
    context.eventEditionId,
    context.organizationId,
    requirement,
  )) {
    throw forbidden("Required race permission is missing");
  }
  return context;
}

export async function resolveTimingSessionContext(
  timingSessionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<TimingSessionContext> {
  const adminClient = createAdminSupabaseClient(env);
  const { data: timingSession, error } = await adminClient
    .from("timing_sessions")
    .select("id,event_edition_id,event_category_id,checkpoint_id,status,mode,started_at,closed_at")
    .eq("id", timingSessionId)
    .maybeSingle<{
      id: string;
      event_edition_id: string;
      event_category_id: string | null;
      checkpoint_id: string | null;
      status: string;
      mode: string;
      started_at: string;
      closed_at: string | null;
    }>();

  if (error) throw error;
  if (!timingSession) throw notFound("Timing session not found");

  const edition = await resolveEditionContext(timingSession.event_edition_id, env);
  return {
    sessionId: timingSession.id,
    organizationId: edition.organizationId,
    eventEditionId: timingSession.event_edition_id,
    eventCategoryId: timingSession.event_category_id,
    checkpointId: timingSession.checkpoint_id,
    status: timingSession.status,
    mode: timingSession.mode,
    startedAt: timingSession.started_at,
    closedAt: timingSession.closed_at,
  };
}

export async function requireTimingSessionAccess(
  session: RequestSession,
  timingSessionId: string,
  requirement: PermissionRequirement = "timing",
  env: ServerEnv = loadServerEnv(),
) {
  const context = await resolveTimingSessionContext(timingSessionId, env);
  requireOrganizationIdentity(session, context.organizationId);
  const hasAccess = context.eventCategoryId && context.checkpointId
    ? hasCheckpointPermission(
        session,
        context.eventEditionId,
        context.organizationId,
        context.eventCategoryId,
        context.checkpointId,
        requirement,
      )
    : hasEventPermission(
        session,
        context.eventEditionId,
        context.organizationId,
        requirement,
      );
  if (!hasAccess) {
    throw forbidden("Required race permission is missing");
  }
  return context;
}
