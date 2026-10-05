import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { requireEditionAccess, requireOrganizationAccess } from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type TimingFleetState = {
  eventEditionId: string;
  organizationId: string;
  devices: Array<{
    id: string;
    label: string | null;
    fingerprint: string;
    deviceType: string;
    externalIdentity: string | null;
    status: "active" | "maintenance" | "retired";
    syncState: "unknown" | "synced" | "pending" | "degraded" | "offline" | "error";
    pendingEventCount: number;
    clockOffsetMs: number | null;
    clockCheckedAt: string | null;
    batteryPercent: number | null;
    firmwareVersion: string | null;
    softwareVersion: string | null;
    credentialState: "unprovisioned" | "active" | "rotating" | "revoked" | "expired";
    credentialExpiresAt: string | null;
    lastSeenAt: string | null;
    lastSyncAt: string | null;
    assignments: Array<{
      id: string;
      eventCategoryId: string | null;
      categoryName: string | null;
      checkpointId: string | null;
      checkpointName: string | null;
      assignmentState: "planned" | "active" | "suspended" | "revoked" | "expired";
      allowedEventTypes: string[];
      validFrom: string;
      validUntil: string;
      manifestVersion: number | null;
    }>;
    events: Array<{
      id: string;
      sequenceNumber: number;
      actionType: string;
      note: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
  providers: Array<{
    id: string;
    providerType: "chip_timing" | "gps_tracking" | "file_import" | "partner_api";
    providerKey: string;
    label: string;
    connectionState: "configured" | "active" | "degraded" | "disabled";
    config: Record<string, unknown>;
    credentialReference: string | null;
    secretVersion: number;
    webhookKeyId: string | null;
    lastHealthAt: string | null;
    healthState: "unknown" | "healthy" | "degraded" | "offline" | "error";
    lastError: string | null;
  }>;
  batches: Array<{
    id: string;
    providerConnectionId: string;
    providerLabel: string | null;
    sourceBatchId: string;
    batchState: "received" | "processing" | "reconciled" | "failed" | "quarantined";
    signatureState: "valid" | "invalid" | "not_applicable";
    rawEvidenceReference: string;
    declaredEventCount: number | null;
    receivedEventCount: number;
    acceptedEventCount: number;
    rejectedEventCount: number;
    conflictedEventCount: number;
    receivedAt: string;
    reconciledAt: string | null;
  }>;
  summary: {
    activeDevices: number;
    unhealthyDevices: number;
    activeAssignments: number;
    providerIssues: number;
    pendingBatches: number;
    quarantinedBatches: number;
  };
};

function mapTimingIntegrationError(error: { message?: string | null; details?: string | null }): never {
  const message = error.message ?? "timing_integration_operation_failed";
  if (message.includes("timing_fleet_device_input_invalid")) {
    throw badRequest("Fleet devices require a unique identity, supported type, valid health values, and credential state");
  }
  if (message.includes("timing_device_assignment_input_invalid")) {
    throw badRequest("Device assignments require a valid scope, race types, time window, and idempotency key");
  }
  if (message.includes("timing_device_assignment_scope_invalid")) {
    throw badRequest("The timing device, race, or checkpoint is outside this race and organization");
  }
  if (message.includes("timing_device_assignment_window_conflict")) {
    throw conflict("This device already has an overlapping active assignment");
  }
  if (message.includes("timing_device_assignment_transition_invalid")) {
    throw conflict("The requested device-assignment transition is not allowed");
  }
  if (message.includes("timing_device_event_input_invalid") || message.includes("timing_device_event_payload_invalid")) {
    throw badRequest("Device races require a supported action and valid sync, clock, battery, and credential values");
  }
  if (message.includes("timing_provider_connection_input_invalid")) {
    throw badRequest("Provider configuration is invalid or contains secret material; store only an external secret-manager reference");
  }
  if (message.includes("timing_device_owned_by_other_organization")) {
    throw conflict("This device identity already belongs to another organization");
  }
  if (message.includes("timing_device_assignment_not_found")) throw notFound("Timing device assignment not found");
  if (message.includes("timing_device_not_found")) throw notFound("Timing device not found");
  if (message.includes("edition_not_found")) throw notFound("Race edition not found");
  if (message.includes("idempotency_key_reused")) {
    throw conflict("This client race ID was already used for different timing integration data");
  }
  throw error;
}

export async function getTimingFleetState(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<TimingFleetState> {
  const editionContext = await requireEditionAccess(session, eventEditionId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const [devicesResponse, assignmentsResponse, providersResponse, batchesResponse, categoriesResponse, checkpointsResponse] =
    await Promise.all([
      adminClient
        .from("timing_devices")
        .select(
          "id,device_label,device_fingerprint,device_type,external_identity,status,sync_state,pending_event_count,clock_offset_ms,clock_checked_at,battery_percent,firmware_version,software_version,credential_state,credential_expires_at,last_seen_at,last_sync_at",
        )
        .eq("organization_id", editionContext.organizationId)
        .order("last_seen_at", { ascending: false }),
      adminClient
        .from("timing_device_assignments")
        .select(
          "id,timing_device_id,event_category_id,checkpoint_id,assignment_state,allowed_event_types,valid_from,valid_until,manifest_version",
        )
        .eq("event_edition_id", eventEditionId)
        .order("valid_from", { ascending: false }),
      adminClient
        .from("timing_provider_connections")
        .select(
          "id,provider_type,provider_key,label,connection_state,config_json,credential_reference,secret_version,webhook_key_id,last_health_at,health_state,last_error",
        )
        .eq("organization_id", editionContext.organizationId)
        .order("label", { ascending: true }),
      adminClient
        .from("timing_ingestion_batches")
        .select(
          "id,timing_provider_connection_id,source_batch_id,batch_state,signature_state,raw_evidence_reference,declared_event_count,received_event_count,accepted_event_count,rejected_event_count,conflicted_event_count,received_at,reconciled_at",
        )
        .eq("event_edition_id", eventEditionId)
        .order("received_at", { ascending: false })
        .limit(100),
      adminClient
        .from("event_categories")
        .select("id,name")
        .eq("event_edition_id", eventEditionId),
      adminClient
        .from("checkpoints")
        .select("id,name,event_category_id"),
    ]);
  if (devicesResponse.error) throw devicesResponse.error;
  if (assignmentsResponse.error) throw assignmentsResponse.error;
  if (providersResponse.error) throw providersResponse.error;
  if (batchesResponse.error) throw batchesResponse.error;
  if (categoriesResponse.error) throw categoriesResponse.error;
  if (checkpointsResponse.error) throw checkpointsResponse.error;

  const deviceRows = devicesResponse.data ?? [];
  const assignmentRows = assignmentsResponse.data ?? [];
  const providerRows = providersResponse.data ?? [];
  const deviceIds = deviceRows.map((device) => device.id);
  const eventsResponse = deviceIds.length
    ? await adminClient
        .from("timing_device_events")
        .select("id,timing_device_id,sequence_number,action_type,note,payload_json,created_at")
        .in("timing_device_id", deviceIds)
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [], error: null };
  if (eventsResponse.error) throw eventsResponse.error;

  const categoryNameById = new Map((categoriesResponse.data ?? []).map((category) => [category.id, category.name]));
  const checkpointNameById = new Map(
    (checkpointsResponse.data ?? [])
      .filter((checkpoint) => categoryNameById.has(checkpoint.event_category_id))
      .map((checkpoint) => [checkpoint.id, checkpoint.name]),
  );
  const providerLabelById = new Map(providerRows.map((provider) => [provider.id, provider.label]));
  type AssignmentRow = (typeof assignmentRows)[number];
  type EventRow = NonNullable<typeof eventsResponse.data>[number];
  const assignmentsByDevice = new Map<string, AssignmentRow[]>();
  for (const assignment of assignmentRows) {
    const current = assignmentsByDevice.get(assignment.timing_device_id) ?? [];
    current.push(assignment);
    assignmentsByDevice.set(assignment.timing_device_id, current);
  }
  const eventsByDevice = new Map<string, EventRow[]>();
  for (const event of eventsResponse.data ?? []) {
    const current = eventsByDevice.get(event.timing_device_id) ?? [];
    current.push(event);
    eventsByDevice.set(event.timing_device_id, current);
  }

  const devices = deviceRows.map((device) => ({
    id: device.id,
    label: device.device_label,
    fingerprint: device.device_fingerprint,
    deviceType: device.device_type,
    externalIdentity: device.external_identity,
    status: device.status as TimingFleetState["devices"][number]["status"],
    syncState: device.sync_state as TimingFleetState["devices"][number]["syncState"],
    pendingEventCount: device.pending_event_count,
    clockOffsetMs: device.clock_offset_ms,
    clockCheckedAt: device.clock_checked_at,
    batteryPercent: device.battery_percent,
    firmwareVersion: device.firmware_version,
    softwareVersion: device.software_version,
    credentialState: device.credential_state as TimingFleetState["devices"][number]["credentialState"],
    credentialExpiresAt: device.credential_expires_at,
    lastSeenAt: device.last_seen_at,
    lastSyncAt: device.last_sync_at,
    assignments: (assignmentsByDevice.get(device.id) ?? []).map((assignment) => ({
      id: assignment.id,
      eventCategoryId: assignment.event_category_id,
      categoryName: assignment.event_category_id
        ? categoryNameById.get(assignment.event_category_id) ?? null
        : null,
      checkpointId: assignment.checkpoint_id,
      checkpointName: assignment.checkpoint_id
        ? checkpointNameById.get(assignment.checkpoint_id) ?? null
        : null,
      assignmentState: assignment.assignment_state as TimingFleetState["devices"][number]["assignments"][number]["assignmentState"],
      allowedEventTypes: assignment.allowed_event_types,
      validFrom: assignment.valid_from,
      validUntil: assignment.valid_until,
      manifestVersion: assignment.manifest_version,
    })),
    events: (eventsByDevice.get(device.id) ?? []).map((event) => ({
      id: event.id,
      sequenceNumber: event.sequence_number,
      actionType: event.action_type,
      note: event.note,
      payload: event.payload_json as Record<string, unknown>,
      createdAt: event.created_at,
    })),
  }));
  const providers = providerRows.map((provider) => ({
    id: provider.id,
    providerType: provider.provider_type as TimingFleetState["providers"][number]["providerType"],
    providerKey: provider.provider_key,
    label: provider.label,
    connectionState: provider.connection_state as TimingFleetState["providers"][number]["connectionState"],
    config: provider.config_json as Record<string, unknown>,
    credentialReference: provider.credential_reference,
    secretVersion: provider.secret_version,
    webhookKeyId: provider.webhook_key_id,
    lastHealthAt: provider.last_health_at,
    healthState: provider.health_state as TimingFleetState["providers"][number]["healthState"],
    lastError: provider.last_error,
  }));
  const batches = (batchesResponse.data ?? []).map((batch) => ({
    id: batch.id,
    providerConnectionId: batch.timing_provider_connection_id,
    providerLabel: providerLabelById.get(batch.timing_provider_connection_id) ?? null,
    sourceBatchId: batch.source_batch_id,
    batchState: batch.batch_state as TimingFleetState["batches"][number]["batchState"],
    signatureState: batch.signature_state as TimingFleetState["batches"][number]["signatureState"],
    rawEvidenceReference: batch.raw_evidence_reference,
    declaredEventCount: batch.declared_event_count,
    receivedEventCount: batch.received_event_count,
    acceptedEventCount: batch.accepted_event_count,
    rejectedEventCount: batch.rejected_event_count,
    conflictedEventCount: batch.conflicted_event_count,
    receivedAt: batch.received_at,
    reconciledAt: batch.reconciled_at,
  }));
  const activeAssignments = devices.flatMap((device) => device.assignments)
    .filter((assignment) => assignment.assignmentState === "active");
  return {
    eventEditionId,
    organizationId: editionContext.organizationId,
    devices,
    providers,
    batches,
    summary: {
      activeDevices: devices.filter((device) => device.status === "active").length,
      unhealthyDevices: devices.filter(
        (device) =>
          device.status !== "active"
          || ["offline", "error"].includes(device.syncState)
          || ["revoked", "expired"].includes(device.credentialState),
      ).length,
      activeAssignments: activeAssignments.length,
      providerIssues: providers.filter(
        (provider) =>
          ["degraded", "disabled"].includes(provider.connectionState)
          || ["degraded", "offline", "error"].includes(provider.healthState),
      ).length,
      pendingBatches: batches.filter((batch) => ["received", "processing"].includes(batch.batchState)).length,
      quarantinedBatches: batches.filter((batch) => batch.batchState === "quarantined").length,
    },
  };
}

export async function registerTimingFleetDevice(
  session: RequestSession,
  organizationId: string,
  input: {
    fingerprint: string;
    label: string;
    deviceType: string;
    externalIdentity?: string | null;
    status?: "active" | "maintenance" | "retired";
    syncState?: "unknown" | "synced" | "pending" | "degraded" | "offline" | "error";
    clockOffsetMs?: number | null;
    batteryPercent?: number | null;
    firmwareVersion?: string | null;
    softwareVersion?: string | null;
    credentialState?: "unprovisioned" | "active" | "rotating" | "revoked" | "expired";
    credentialExpiresAt?: string | null;
    health?: Record<string, unknown>;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, organizationId, "race_day.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_register_timing_fleet_device", {
    p_organization_id: organizationId,
    p_actor_user_id: session.account.userId,
    p_device_fingerprint: input.fingerprint,
    p_device_label: input.label,
    p_device_type: input.deviceType,
    p_external_identity: input.externalIdentity ?? null,
    p_status: input.status ?? "active",
    p_sync_state: input.syncState ?? "unknown",
    p_clock_offset_ms: input.clockOffsetMs ?? null,
    p_battery_percent: input.batteryPercent ?? null,
    p_firmware_version: input.firmwareVersion ?? null,
    p_software_version: input.softwareVersion ?? null,
    p_credential_state: input.credentialState ?? "unprovisioned",
    p_credential_expires_at: input.credentialExpiresAt ?? null,
    p_health_json: input.health ?? {},
    p_client_event_id: input.clientEventId,
  });
  if (error) mapTimingIntegrationError(error);
  return data as Record<string, unknown>;
}

export async function createTimingDeviceAssignment(
  session: RequestSession,
  eventEditionId: string,
  input: {
    timingDeviceId: string;
    eventCategoryId?: string | null;
    checkpointId?: string | null;
    allowedEventTypes: string[];
    validFrom: string;
    validUntil: string;
    manifestVersion?: number | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_create_timing_device_assignment", {
    p_event_edition_id: eventEditionId,
    p_timing_device_id: input.timingDeviceId,
    p_event_category_id: input.eventCategoryId ?? null,
    p_checkpoint_id: input.checkpointId ?? null,
    p_allowed_event_types: input.allowedEventTypes,
    p_valid_from: input.validFrom,
    p_valid_until: input.validUntil,
    p_manifest_version: input.manifestVersion ?? null,
    p_actor_user_id: session.account.userId,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapTimingIntegrationError(error);
  return data as Record<string, unknown>;
}

async function requireAssignmentAccess(
  session: RequestSession,
  assignmentId: string,
  env: ServerEnv,
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient
    .from("timing_device_assignments")
    .select("event_edition_id")
    .eq("id", assignmentId)
    .maybeSingle<{ event_edition_id: string }>();
  if (error) throw error;
  if (!data) throw notFound("Timing device assignment not found");
  await requireEditionAccess(session, data.event_edition_id, "race_day.manage", env);
}

export async function updateTimingDeviceAssignment(
  session: RequestSession,
  assignmentId: string,
  input: {
    assignmentState: "active" | "suspended" | "revoked" | "expired";
    note: string;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireAssignmentAccess(session, assignmentId, env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_update_timing_device_assignment", {
    p_timing_device_assignment_id: assignmentId,
    p_actor_user_id: session.account.userId,
    p_assignment_state: input.assignmentState,
    p_note: input.note,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapTimingIntegrationError(error);
  return data as Record<string, unknown>;
}

export async function appendTimingDeviceEvent(
  session: RequestSession,
  timingDeviceId: string,
  input: {
    actionType: "health" | "heartbeat" | "sync" | "maintenance" | "activate" | "credential_rotated" | "credential_revoked" | "note";
    note: string;
    payload?: Record<string, unknown>;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: device, error: deviceError } = await adminClient
    .from("timing_devices")
    .select("organization_id")
    .eq("id", timingDeviceId)
    .maybeSingle<{ organization_id: string }>();
  if (deviceError) throw deviceError;
  if (!device) throw notFound("Timing device not found");
  requireOrganizationAccess(session, device.organization_id, "race_day.manage");
  const { data, error } = await adminClient.rpc("service_append_timing_device_event", {
    p_timing_device_id: timingDeviceId,
    p_actor_user_id: session.account.userId,
    p_action_type: input.actionType,
    p_note: input.note,
    p_payload_json: input.payload ?? {},
    p_client_event_id: input.clientEventId,
  });
  if (error) mapTimingIntegrationError(error);
  return data as Record<string, unknown>;
}

export async function saveTimingProviderConnection(
  session: RequestSession,
  organizationId: string,
  input: {
    providerType: "chip_timing" | "gps_tracking" | "file_import" | "partner_api";
    providerKey: string;
    label: string;
    connectionState: "configured" | "active" | "degraded" | "disabled";
    config?: Record<string, unknown>;
    credentialReference: string;
    secretVersion?: number;
    webhookKeyId?: string | null;
    note: string;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, organizationId, "race_day.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_save_timing_provider_connection", {
    p_organization_id: organizationId,
    p_actor_user_id: session.account.userId,
    p_provider_type: input.providerType,
    p_provider_key: input.providerKey,
    p_label: input.label,
    p_connection_state: input.connectionState,
    p_config_json: input.config ?? {},
    p_credential_reference: input.credentialReference,
    p_secret_version: input.secretVersion ?? 1,
    p_webhook_key_id: input.webhookKeyId ?? null,
    p_note: input.note,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapTimingIntegrationError(error);
  return data as Record<string, unknown>;
}
