import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireEditionAccess } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type SafetyIncidentState =
  | "reported"
  | "acknowledged"
  | "investigating"
  | "action_in_progress"
  | "monitoring"
  | "resolved"
  | "reviewed"
  | "closed";

export type SafetyCommandState = {
  eventEditionId: string;
  plan: {
    id: string;
    versionNumber: number;
    planState: "draft" | "active" | "superseded";
    plan: Record<string, unknown>;
    publicExcerpt: Record<string, unknown>;
    contentDigest: string;
    createdAt: string;
    activatedAt: string | null;
  } | null;
  incidents: Array<{
    id: string;
    incidentCode: string;
    eventCategoryId: string | null;
    categoryName: string | null;
    checkpointId: string | null;
    checkpointName: string | null;
    registrationId: string | null;
    participantName: string | null;
    incidentType: string;
    severity: "info" | "minor" | "major" | "critical";
    incidentState: SafetyIncidentState;
    title: string;
    restrictedSummary: string | null;
    privacyClassification: "operational" | "restricted" | "medical";
    locationLabel: string | null;
    effectiveAt: string;
    reportedAt: string;
    acknowledgedAt: string | null;
    resolvedAt: string | null;
    ownerUserId: string | null;
    suppressPublicLive: boolean;
    participantStatusReconciled: boolean;
    resultImpactReviewed: boolean;
    events: Array<{
      id: string;
      sequenceNumber: number;
      actionType: string;
      fromState: string | null;
      toState: string | null;
      note: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
  summary: {
    open: number;
    critical: number;
    unacknowledged: number;
    closureBlocked: number;
  };
};

function mapSafetyError(error: { message?: string | null; details?: string | null }): never {
  const message = error.message ?? "safety_operation_failed";
  if (message.includes("safety_plan_input_invalid")) {
    throw badRequest("Safety plans require command roles, emergency contacts, escalation instructions, and a missing-person protocol");
  }
  if (message.includes("safety_incident_input_invalid")) {
    throw badRequest("Incident type, severity, title, effective time, privacy, and critical owner are required");
  }
  if (message.includes("safety_incident_scope_invalid")) {
    throw badRequest("The selected race, checkpoint, or participant does not belong to this race");
  }
  if (message.includes("safety_incident_event_input_invalid")) {
    throw badRequest("Incident action, note, payload, and client race ID are required");
  }
  if (message.includes("safety_incident_transition_invalid")) {
    throw conflict(`Incident transition is not allowed${error.details ? ` (${error.details})` : ""}`);
  }
  if (message.includes("critical_incident_owner_required")) {
    throw conflict("A critical incident must always have an assigned owner");
  }
  if (message.includes("incident_closure_reconciliation_required")) {
    throw conflict("Reconcile participant status and result impact before closing the incident");
  }
  if (message.includes("safety_incident_not_found")) throw notFound("Safety incident not found");
  if (message.includes("edition_not_found")) throw notFound("Race edition not found");
  if (message.includes("idempotency_key_reused")) {
    throw conflict("This client race ID was already used for different safety data");
  }
  throw error;
}

export async function getSafetyCommandState(
  session: RequestSession,
  eventEditionId: string,
  input: { accessPurpose?: string } = {},
  env: ServerEnv = loadServerEnv(),
): Promise<SafetyCommandState> {
  await requireEditionAccess(session, eventEditionId, "safety.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const [planResponse, incidentsResponse, categoriesResponse, checkpointsResponse] = await Promise.all([
    adminClient
      .from("safety_plan_versions")
      .select("id,version_number,plan_state,plan_json,public_excerpt_json,content_digest,created_at,activated_at")
      .eq("event_edition_id", eventEditionId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        version_number: number;
        plan_state: "draft" | "active" | "superseded";
        plan_json: Record<string, unknown>;
        public_excerpt_json: Record<string, unknown>;
        content_digest: string;
        created_at: string;
        activated_at: string | null;
      }>(),
    adminClient
      .from("safety_incidents")
      .select(
        "id,incident_code,event_category_id,checkpoint_id,registration_id,incident_type,severity,incident_state,title,restricted_summary,privacy_classification,location_label,effective_at,reported_at,acknowledged_at,resolved_at,owner_user_id,suppress_public_live,participant_status_reconciled,result_impact_reviewed",
      )
      .eq("event_edition_id", eventEditionId)
      .order("reported_at", { ascending: false }),
    adminClient
      .from("event_categories")
      .select("id,name")
      .eq("event_edition_id", eventEditionId),
    adminClient
      .from("checkpoints")
      .select("id,name,event_category_id"),
  ]);
  if (planResponse.error) throw planResponse.error;
  if (incidentsResponse.error) throw incidentsResponse.error;
  if (categoriesResponse.error) throw categoriesResponse.error;
  if (checkpointsResponse.error) throw checkpointsResponse.error;

  const incidentRows = (incidentsResponse.data ?? []) as Array<{
    id: string;
    incident_code: string;
    event_category_id: string | null;
    checkpoint_id: string | null;
    registration_id: string | null;
    incident_type: string;
    severity: "info" | "minor" | "major" | "critical";
    incident_state: SafetyIncidentState;
    title: string;
    restricted_summary: string | null;
    privacy_classification: "operational" | "restricted" | "medical";
    location_label: string | null;
    effective_at: string;
    reported_at: string;
    acknowledged_at: string | null;
    resolved_at: string | null;
    owner_user_id: string | null;
    suppress_public_live: boolean;
    participant_status_reconciled: boolean;
    result_impact_reviewed: boolean;
  }>;
  const incidentIds = incidentRows.map((incident) => incident.id);
  const registrationIds = incidentRows
    .map((incident) => incident.registration_id)
    .filter((id): id is string => Boolean(id));
  const [{ data: events, error: eventError }, { data: registrations, error: registrationError }] =
    await Promise.all([
      incidentIds.length
        ? adminClient
            .from("safety_incident_events")
            .select("id,safety_incident_id,sequence_number,action_type,from_state,to_state,note,payload_json,created_at")
            .in("safety_incident_id", incidentIds)
            .order("sequence_number", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      registrationIds.length
        ? adminClient
            .from("registrations")
            .select("id,athlete_profile_id")
            .in("id", registrationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (eventError) throw eventError;
  if (registrationError) throw registrationError;

  const athleteIds = [...new Set((registrations ?? []).map((registration) => registration.athlete_profile_id))];
  const { data: athletes, error: athleteError } = athleteIds.length
    ? await adminClient
        .from("athlete_profiles")
        .select("id,first_name,last_name")
        .in("id", athleteIds)
    : { data: [], error: null };
  if (athleteError) throw athleteError;

  if (incidentRows.length) {
    const { error: accessError } = await adminClient.rpc("service_log_safety_record_access", {
      p_event_edition_id: eventEditionId,
      p_safety_incident_id: null,
      p_actor_user_id: session.account.userId,
      p_access_purpose: input.accessPurpose?.trim() || "race_control_safety_command",
      p_fields_classification: incidentRows.some((incident) => incident.privacy_classification === "medical")
        ? "medical"
        : "restricted",
    });
    if (accessError) mapSafetyError(accessError);
  }

  const categoryNameById = new Map((categoriesResponse.data ?? []).map((category) => [category.id, category.name]));
  const checkpointNameById = new Map(
    (checkpointsResponse.data ?? [])
      .filter((checkpoint) => categoryNameById.has(checkpoint.event_category_id))
      .map((checkpoint) => [checkpoint.id, checkpoint.name]),
  );
  const athleteIdByRegistration = new Map(
    (registrations ?? []).map((registration) => [registration.id, registration.athlete_profile_id]),
  );
  const athleteNameById = new Map(
    (athletes ?? []).map((athlete) => [
      athlete.id,
      `${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`.trim() || "Participant",
    ]),
  );
  const eventsByIncident = new Map<string, typeof events>();
  for (const incidentEvent of events ?? []) {
    const existing = eventsByIncident.get(incidentEvent.safety_incident_id) ?? [];
    existing.push(incidentEvent);
    eventsByIncident.set(incidentEvent.safety_incident_id, existing);
  }
  const incidents = incidentRows.map((incident) => ({
    id: incident.id,
    incidentCode: incident.incident_code,
    eventCategoryId: incident.event_category_id,
    categoryName: incident.event_category_id
      ? categoryNameById.get(incident.event_category_id) ?? null
      : null,
    checkpointId: incident.checkpoint_id,
    checkpointName: incident.checkpoint_id
      ? checkpointNameById.get(incident.checkpoint_id) ?? null
      : null,
    registrationId: incident.registration_id,
    participantName: incident.registration_id
      ? athleteNameById.get(athleteIdByRegistration.get(incident.registration_id) ?? "") ?? null
      : null,
    incidentType: incident.incident_type,
    severity: incident.severity,
    incidentState: incident.incident_state,
    title: incident.title,
    restrictedSummary: incident.restricted_summary,
    privacyClassification: incident.privacy_classification,
    locationLabel: incident.location_label,
    effectiveAt: incident.effective_at,
    reportedAt: incident.reported_at,
    acknowledgedAt: incident.acknowledged_at,
    resolvedAt: incident.resolved_at,
    ownerUserId: incident.owner_user_id,
    suppressPublicLive: incident.suppress_public_live,
    participantStatusReconciled: incident.participant_status_reconciled,
    resultImpactReviewed: incident.result_impact_reviewed,
    events: (eventsByIncident.get(incident.id) ?? []).map((incidentEvent) => ({
      id: incidentEvent.id,
      sequenceNumber: incidentEvent.sequence_number,
      actionType: incidentEvent.action_type,
      fromState: incidentEvent.from_state,
      toState: incidentEvent.to_state,
      note: incidentEvent.note,
      payload: incidentEvent.payload_json as Record<string, unknown>,
      createdAt: incidentEvent.created_at,
    })),
  }));
  const openIncidents = incidents.filter((incident) => incident.incidentState !== "closed");
  const plan = planResponse.data;
  return {
    eventEditionId,
    plan: plan
      ? {
          id: plan.id,
          versionNumber: plan.version_number,
          planState: plan.plan_state,
          plan: plan.plan_json,
          publicExcerpt: plan.public_excerpt_json,
          contentDigest: plan.content_digest,
          createdAt: plan.created_at,
          activatedAt: plan.activated_at,
        }
      : null,
    incidents,
    summary: {
      open: openIncidents.length,
      critical: openIncidents.filter((incident) => incident.severity === "critical").length,
      unacknowledged: openIncidents.filter((incident) => !incident.acknowledgedAt).length,
      closureBlocked: openIncidents.filter(
        (incident) => !incident.participantStatusReconciled || !incident.resultImpactReviewed,
      ).length,
    },
  };
}

export async function createSafetyPlanVersion(
  session: RequestSession,
  eventEditionId: string,
  input: {
    plan: Record<string, unknown>;
    publicExcerpt?: Record<string, unknown>;
    activate?: boolean;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "safety.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_create_safety_plan_version", {
    p_event_edition_id: eventEditionId,
    p_actor_user_id: session.account.userId,
    p_plan_json: input.plan,
    p_public_excerpt_json: input.publicExcerpt ?? {},
    p_activate: input.activate ?? false,
  });
  if (error) mapSafetyError(error);
  return data as Record<string, unknown>;
}

export async function createSafetyIncident(
  session: RequestSession,
  eventEditionId: string,
  input: {
    eventCategoryId?: string | null;
    checkpointId?: string | null;
    registrationId?: string | null;
    incidentType: string;
    severity: "info" | "minor" | "major" | "critical";
    title: string;
    restrictedSummary?: string | null;
    privacyClassification: "operational" | "restricted" | "medical";
    locationLabel?: string | null;
    effectiveAt: string;
    ownerUserId?: string | null;
    suppressPublicLive?: boolean;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "safety.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_create_safety_incident", {
    p_event_edition_id: eventEditionId,
    p_event_category_id: input.eventCategoryId ?? null,
    p_checkpoint_id: input.checkpointId ?? null,
    p_registration_id: input.registrationId ?? null,
    p_actor_user_id: session.account.userId,
    p_incident_type: input.incidentType,
    p_severity: input.severity,
    p_title: input.title,
    p_restricted_summary: input.restrictedSummary ?? null,
    p_privacy_classification: input.privacyClassification,
    p_location_label: input.locationLabel ?? null,
    p_effective_at: input.effectiveAt,
    p_owner_user_id: input.ownerUserId ?? (input.severity === "critical" ? session.account.userId : null),
    p_suppress_public_live: input.suppressPublicLive ?? false,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapSafetyError(error);
  return data as Record<string, unknown>;
}

export async function appendSafetyIncidentEvent(
  session: RequestSession,
  safetyIncidentId: string,
  input: {
    actionType:
      | "acknowledge"
      | "classify"
      | "action"
      | "communication"
      | "handoff"
      | "status_reconciliation"
      | "result_review"
      | "resolve"
      | "review"
      | "close"
      | "reopen";
    toState?: SafetyIncidentState | null;
    note: string;
    payload?: Record<string, unknown>;
    ownerUserId?: string | null;
    suppressPublicLive?: boolean | null;
    participantStatusReconciled?: boolean | null;
    resultImpactReviewed?: boolean | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: incident, error: incidentError } = await adminClient
    .from("safety_incidents")
    .select("event_edition_id")
    .eq("id", safetyIncidentId)
    .maybeSingle<{ event_edition_id: string }>();
  if (incidentError) throw incidentError;
  if (!incident) throw notFound("Safety incident not found");
  await requireEditionAccess(session, incident.event_edition_id, "safety.manage", env);
  const { data, error } = await adminClient.rpc("service_append_safety_incident_event", {
    p_safety_incident_id: safetyIncidentId,
    p_actor_user_id: session.account.userId,
    p_action_type: input.actionType,
    p_to_state: input.toState ?? null,
    p_note: input.note,
    p_payload_json: input.payload ?? {},
    p_owner_user_id: input.ownerUserId ?? null,
    p_suppress_public_live: input.suppressPublicLive ?? null,
    p_participant_status_reconciled: input.participantStatusReconciled ?? null,
    p_result_impact_reviewed: input.resultImpactReviewed ?? null,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapSafetyError(error);
  return data as Record<string, unknown>;
}
