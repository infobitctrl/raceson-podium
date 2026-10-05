import { createHash } from "node:crypto";
import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, notFound } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  requireCategoryAccess,
  requireEditionAccess,
  requireOrganizationAccess,
} from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";

export type PreRaceReadiness = {
  eventEditionId: string;
  startList: {
    state: "open" | "frozen" | "reopened";
    currentManifest: {
      id: string;
      versionNumber: number;
      entryCount: number;
      digest: string;
      frozenAt: string;
      freezeNote: string | null;
    } | null;
  };
  timing: {
    state: "draft" | "planned" | "ready" | "failed";
    currentPlan: {
      id: string;
      versionNumber: number;
      name: string;
      digest: string;
      pointCount: number;
      clockToleranceMs: number;
      approvedAt: string;
    } | null;
    latestRehearsal: {
      id: string;
      status: "passed" | "failed";
      completedAt: string;
      notes: string | null;
      issues: unknown[];
    } | null;
    devices: Array<{
      id: string;
      label: string | null;
      fingerprint: string;
      status: string;
      clockOffsetMs: number | null;
      clockCheckedAt: string | null;
      batteryPercent: number | null;
      firmwareVersion: string | null;
      lastSeenAt: string | null;
    }>;
  };
  counts: {
    eligible: number;
    bibAssigned: number;
    checkedIn: number;
  };
  categories: Array<{
    id: string;
    name: string;
    eligibleCount: number;
    bibAssignedCount: number;
    missingBibCount: number;
    hasStartTime: boolean;
    hasStartCheckpoint: boolean;
    hasFinishCheckpoint: boolean;
  }>;
  blockers: string[];
  warnings: string[];
  canFreeze: boolean;
};

type CategoryRow = {
  id: string;
  name: string;
  start_at: string | null;
  results_mode: string;
  status: string;
};

type RegistrationRow = {
  id: string;
  event_category_id: string;
  status: string;
  payment_status: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function mapPreRaceRpcError(error: { message?: string | null; details?: string | null }): never {
  const message = error.message ?? "pre_race_operation_failed";
  if (message.includes("category_not_found")) throw notFound("Race not found");
  if (message.includes("edition_not_found")) throw notFound("Race edition not found");
  if (message.includes("idempotency_key_reused")) {
    throw conflict("This request key was already used for different bib settings");
  }
  if (message.includes("start_list_is_frozen")) {
    throw conflict("Reopen the start list before changing bib assignments");
  }
  if (message.includes("bib_allocation_input_invalid")) {
    throw badRequest("Bib allocation settings are invalid");
  }
  if (message.includes("start_list_has_no_confirmed_entries")) {
    throw conflict("Confirm at least one settled entry before freezing the start list");
  }
  if (message.includes("start_list_missing_bibs")) {
    throw conflict(`Assign bibs to every eligible runner before freezing${error.details ? ` (${error.details} missing)` : ""}`);
  }
  if (message.includes("start_list_missing_start_times")) {
    throw conflict("Every competitive race needs a start time before freezing");
  }
  if (message.includes("start_list_missing_start_finish_checkpoints")) {
    throw conflict("Every competitive race needs start and finish checkpoints before freezing");
  }
  if (message.includes("start_list_reopen_reason_required")) {
    throw badRequest("A reason is required to reopen a frozen start list");
  }
  if (message.includes("start_list_reopen_after_timing_forbidden")) {
    throw conflict("The start list cannot be reopened after timing has begun");
  }
  if (message.includes("timing_device_input_invalid")) {
    throw badRequest("Timing-device health details are invalid");
  }
  if (message.includes("timing_device_owned_by_other_organization")) {
    throw conflict("This device identity already belongs to another organization");
  }
  if (message.includes("timing_plan_input_invalid")) {
    throw badRequest("Timing plan name, clock tolerance, and points are required");
  }
  if (message.includes("timing_plan_point_invalid")) {
    throw badRequest("One or more timing points, devices, or backup methods are invalid");
  }
  if (message.includes("timing_plan_mandatory_point_missing")) {
    throw conflict("The timing plan must cover every mandatory checkpoint");
  }
  if (message.includes("rehearsal_requires_frozen_manifest")) {
    throw conflict("Freeze the start-list manifest before recording a rehearsal");
  }
  if (message.includes("rehearsal_requires_timing_plan")) {
    throw conflict("Approve a timing plan before recording a rehearsal");
  }
  if (
    message.includes("rehearsal_input_invalid")
    || message.includes("rehearsal_checklist_incomplete")
  ) {
    throw badRequest("Every rehearsal check must pass before marking the rehearsal successful");
  }
  throw error;
}

export async function getPreRaceReadiness(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<PreRaceReadiness> {
  const editionContext = await requireEditionAccess(
    session,
    eventEditionId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);

  const { data: categories, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,name,start_at,results_mode,status")
    .eq("event_edition_id", eventEditionId)
    .neq("results_mode", "informative_age")
    .order("display_order", { ascending: true })
    .returns<CategoryRow[]>();
  if (categoryError) throw categoryError;
  const categoryIds = (categories ?? []).map((category) => category.id);

  const [
    { data: registrations, error: registrationError },
    { data: assignments, error: assignmentError },
    { data: checkins, error: checkinError },
    { data: checkpoints, error: checkpointError },
    { data: control, error: controlError },
  ] = await Promise.all([
    categoryIds.length
      ? adminClient
          .from("registrations")
          .select("id,event_category_id,status,payment_status")
          .in("event_category_id", categoryIds)
          .returns<RegistrationRow[]>()
      : Promise.resolve({ data: [] as RegistrationRow[], error: null }),
    adminClient
      .from("bib_assignments")
      .select("registration_id,event_category_id")
      .eq("event_edition_id", eventEditionId)
      .is("revoked_at", null)
      .returns<Array<{ registration_id: string; event_category_id: string }>>(),
    adminClient
      .from("checkins")
      .select("registration_id,registrations!inner(event_categories!inner(event_edition_id))")
      .eq("registrations.event_categories.event_edition_id", eventEditionId)
      .returns<Array<{ registration_id: string }>>(),
    adminClient
      .from("checkpoints")
      .select("event_category_id,checkpoint_type,event_categories!inner(event_edition_id)")
      .eq("event_categories.event_edition_id", eventEditionId)
      .returns<Array<{ event_category_id: string; checkpoint_type: string }>>(),
    adminClient
      .from("edition_operational_controls")
      .select(
        "start_list_state,current_manifest_id,current_timing_plan_id,latest_rehearsal_id,timing_readiness_state,start_list_manifests(id,version_number,entry_count,digest,frozen_at,freeze_note)",
      )
      .eq("event_edition_id", eventEditionId)
      .maybeSingle<{
        start_list_state: "open" | "frozen" | "reopened";
        current_manifest_id: string | null;
        current_timing_plan_id: string | null;
        latest_rehearsal_id: string | null;
        timing_readiness_state: "draft" | "planned" | "ready" | "failed";
        start_list_manifests:
          | {
            id: string;
            version_number: number;
            entry_count: number;
            digest: string;
            frozen_at: string;
            freeze_note: string | null;
          }
          | Array<{
            id: string;
            version_number: number;
            entry_count: number;
            digest: string;
            frozen_at: string;
            freeze_note: string | null;
          }>
          | null;
      }>(),
  ]);

  if (registrationError) throw registrationError;
  if (assignmentError) throw assignmentError;
  if (checkinError) throw checkinError;
  if (checkpointError) throw checkpointError;
  if (controlError) throw controlError;

  const [
    { data: timingPlan, error: timingPlanError },
    { data: rehearsal, error: rehearsalError },
    { data: devices, error: devicesError },
  ] = await Promise.all([
    control?.current_timing_plan_id
      ? adminClient
          .from("timing_plan_versions")
          .select("id,version_number,name,digest,clock_tolerance_ms,approved_at")
          .eq("id", control.current_timing_plan_id)
          .maybeSingle<{
            id: string;
            version_number: number;
            name: string;
            digest: string;
            clock_tolerance_ms: number;
            approved_at: string;
          }>()
      : Promise.resolve({ data: null, error: null }),
    control?.latest_rehearsal_id
      ? adminClient
          .from("pre_race_rehearsals")
          .select("id,status,completed_at,notes,issues_json")
          .eq("id", control.latest_rehearsal_id)
          .maybeSingle<{
            id: string;
            status: "passed" | "failed";
            completed_at: string;
            notes: string | null;
            issues_json: unknown[];
          }>()
      : Promise.resolve({ data: null, error: null }),
    adminClient
      .from("timing_devices")
      .select(
        "id,device_label,device_fingerprint,status,clock_offset_ms,clock_checked_at,battery_percent,firmware_version,last_seen_at",
      )
      .eq("organization_id", editionContext.organizationId)
      .order("last_seen_at", { ascending: false })
      .returns<Array<{
        id: string;
        device_label: string | null;
        device_fingerprint: string;
        status: string;
        clock_offset_ms: number | null;
        clock_checked_at: string | null;
        battery_percent: number | null;
        firmware_version: string | null;
        last_seen_at: string | null;
      }>>(),
  ]);
  if (timingPlanError) throw timingPlanError;
  if (rehearsalError) throw rehearsalError;
  if (devicesError) throw devicesError;

  const { count: timingPointCount, error: timingPointCountError } = timingPlan
    ? await adminClient
        .from("timing_plan_points")
        .select("id", { count: "exact", head: true })
        .eq("timing_plan_id", timingPlan.id)
    : { count: 0, error: null };
  if (timingPointCountError) throw timingPointCountError;

  const eligibleRegistrations = (registrations ?? []).filter(
    (registration) =>
      registration.status === "confirmed"
      && (registration.payment_status === "paid" || registration.payment_status === "not_required"),
  );
  const activeBibByRegistration = new Set((assignments ?? []).map((assignment) => assignment.registration_id));
  const checkpointTypesByCategory = new Map<string, Set<string>>();
  for (const checkpoint of checkpoints ?? []) {
    const types = checkpointTypesByCategory.get(checkpoint.event_category_id) ?? new Set<string>();
    types.add(checkpoint.checkpoint_type);
    checkpointTypesByCategory.set(checkpoint.event_category_id, types);
  }

  const categoryReadiness = (categories ?? []).map((category) => {
    const eligible = eligibleRegistrations.filter(
      (registration) => registration.event_category_id === category.id,
    );
    const assignedCount = eligible.filter((registration) => activeBibByRegistration.has(registration.id)).length;
    const checkpointTypes = checkpointTypesByCategory.get(category.id) ?? new Set<string>();
    return {
      id: category.id,
      name: category.name,
      eligibleCount: eligible.length,
      bibAssignedCount: assignedCount,
      missingBibCount: eligible.length - assignedCount,
      hasStartTime: Boolean(category.start_at),
      hasStartCheckpoint: checkpointTypes.has("start"),
      hasFinishCheckpoint: checkpointTypes.has("finish"),
    };
  });

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!categoryReadiness.length) blockers.push("Add at least one competitive race.");
  if (!eligibleRegistrations.length) blockers.push("Confirm at least one settled registration.");
  const missingBibCount = categoryReadiness.reduce((sum, category) => sum + category.missingBibCount, 0);
  if (missingBibCount) blockers.push(`Assign ${missingBibCount} missing bib${missingBibCount === 1 ? "" : "s"}.`);
  const missingStartTimes = categoryReadiness.filter((category) => !category.hasStartTime);
  if (missingStartTimes.length) blockers.push("Set a start time for every competitive race.");
  const missingCourseEndpoints = categoryReadiness.filter(
    (category) => !category.hasStartCheckpoint || !category.hasFinishCheckpoint,
  );
  if (missingCourseEndpoints.length) blockers.push("Add start and finish checkpoints to every competitive race.");
  if ((checkins ?? []).length) warnings.push(`${checkins!.length} runner${checkins!.length === 1 ? " is" : "s are"} already checked in.`);
  if (!timingPlan) warnings.push("Approve a timing plan before the race-day rehearsal.");
  if (control?.timing_readiness_state !== "ready") {
    warnings.push("A passing rehearsal is required before timing sessions can open.");
  }

  const manifestRelation = control?.start_list_manifests;
  const manifest = Array.isArray(manifestRelation) ? manifestRelation[0] ?? null : manifestRelation ?? null;

  return {
    eventEditionId,
    startList: {
      state: control?.start_list_state ?? "open",
      currentManifest: manifest
        ? {
          id: manifest.id,
          versionNumber: manifest.version_number,
          entryCount: manifest.entry_count,
          digest: manifest.digest,
          frozenAt: manifest.frozen_at,
          freezeNote: manifest.freeze_note,
        }
        : null,
    },
    timing: {
      state: control?.timing_readiness_state ?? "draft",
      currentPlan: timingPlan
        ? {
          id: timingPlan.id,
          versionNumber: timingPlan.version_number,
          name: timingPlan.name,
          digest: timingPlan.digest,
          pointCount: timingPointCount ?? 0,
          clockToleranceMs: timingPlan.clock_tolerance_ms,
          approvedAt: timingPlan.approved_at,
        }
        : null,
      latestRehearsal: rehearsal
        ? {
          id: rehearsal.id,
          status: rehearsal.status,
          completedAt: rehearsal.completed_at,
          notes: rehearsal.notes,
          issues: rehearsal.issues_json,
        }
        : null,
      devices: (devices ?? []).map((device) => ({
        id: device.id,
        label: device.device_label,
        fingerprint: device.device_fingerprint,
        status: device.status,
        clockOffsetMs: device.clock_offset_ms,
        clockCheckedAt: device.clock_checked_at,
        batteryPercent: device.battery_percent,
        firmwareVersion: device.firmware_version,
        lastSeenAt: device.last_seen_at,
      })),
    },
    counts: {
      eligible: eligibleRegistrations.length,
      bibAssigned: eligibleRegistrations.filter((registration) => activeBibByRegistration.has(registration.id)).length,
      checkedIn: checkins?.length ?? 0,
    },
    categories: categoryReadiness,
    blockers,
    warnings,
    canFreeze: blockers.length === 0 && control?.start_list_state !== "frozen",
  };
}

export async function allocateCategoryBibs(
  session: RequestSession,
  eventCategoryId: string,
  input: {
    startNumber: number;
    prefix?: string;
    padding?: number;
    idempotencyKey: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(session, eventCategoryId, "entrants.manage", env);
  const prefix = input.prefix?.trim() ?? "";
  const padding = input.padding ?? 0;
  const requestHash = sha256(
    JSON.stringify({
      eventCategoryId,
      startNumber: input.startNumber,
      prefix,
      padding,
    }),
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_allocate_category_bibs", {
    p_event_category_id: eventCategoryId,
    p_actor_user_id: session.account.userId,
    p_start_number: input.startNumber,
    p_prefix: prefix,
    p_padding: padding,
    p_idempotency_key_hash: sha256(input.idempotencyKey),
    p_request_hash: requestHash,
  });
  if (error) mapPreRaceRpcError(error);
  return data as {
    runId: string;
    assignedCount: number;
    firstBib: string | null;
    lastBib: string | null;
    replayed: boolean;
  };
}

export async function freezeStartListManifest(
  session: RequestSession,
  eventEditionId: string,
  note: string | null,
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(
    session,
    eventEditionId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_freeze_start_list_manifest", {
    p_event_edition_id: eventEditionId,
    p_actor_user_id: session.account.userId,
    p_note: note,
  });
  if (error) mapPreRaceRpcError(error);
  return data as {
    manifestId: string;
    versionNumber: number;
    entryCount: number;
    digest: string;
    frozenAt: string;
  };
}

export async function reopenStartList(
  session: RequestSession,
  eventEditionId: string,
  reason: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(
    session,
    eventEditionId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_reopen_start_list", {
    p_event_edition_id: eventEditionId,
    p_actor_user_id: session.account.userId,
    p_reason: reason,
  });
  if (error) mapPreRaceRpcError(error);
  return data as {
    eventEditionId: string;
    state: "open" | "reopened";
    previousManifestId?: string | null;
    replayed: boolean;
  };
}

export async function getStartListManifest(
  session: RequestSession,
  eventEditionId: string,
  manifestId: string,
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(
    session,
    eventEditionId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const [{ data: manifest, error: manifestError }, { data: entries, error: entryError }] =
    await Promise.all([
      adminClient
        .from("start_list_manifests")
        .select("id,event_edition_id,version_number,digest,entry_count,freeze_note,frozen_at")
        .eq("id", manifestId)
        .eq("event_edition_id", eventEditionId)
        .maybeSingle<{
          id: string;
          event_edition_id: string;
          version_number: number;
          digest: string;
          entry_count: number;
          freeze_note: string | null;
          frozen_at: string;
        }>(),
      adminClient
        .from("start_list_manifest_entries")
        .select(
          "registration_id,event_category_id,athlete_profile_id,bib_number,athlete_name,category_name,gender,date_of_birth,represented_club_name,phone,emergency_contact_name,emergency_contact_phone,captured_registration_status,captured_payment_status,captured_participation_status",
        )
        .eq("manifest_id", manifestId)
        .order("category_name", { ascending: true })
        .order("bib_number", { ascending: true }),
    ]);
  if (manifestError) throw manifestError;
  if (entryError) throw entryError;
  if (!manifest) throw notFound("Start-list manifest not found");

  return {
    id: manifest.id,
    eventEditionId: manifest.event_edition_id,
    versionNumber: manifest.version_number,
    digest: manifest.digest,
    entryCount: manifest.entry_count,
    freezeNote: manifest.freeze_note,
    frozenAt: manifest.frozen_at,
    entries: (entries ?? []).map((entry) => ({
      registrationId: entry.registration_id,
      eventCategoryId: entry.event_category_id,
      athleteProfileId: entry.athlete_profile_id,
      bibNumber: entry.bib_number,
      athleteName: entry.athlete_name,
      categoryName: entry.category_name,
      gender: entry.gender,
      dateOfBirth: entry.date_of_birth,
      representedClubName: entry.represented_club_name,
      phone: entry.phone,
      emergencyContactName: entry.emergency_contact_name,
      emergencyContactPhone: entry.emergency_contact_phone,
      registrationStatus: entry.captured_registration_status,
      paymentStatus: entry.captured_payment_status,
      participationStatus: entry.captured_participation_status,
    })),
  };
}

export async function saveTimingDevice(
  session: RequestSession,
  organizationId: string,
  input: {
    fingerprint: string;
    label?: string | null;
    status?: "active" | "maintenance" | "retired";
    clockOffsetMs?: number | null;
    batteryPercent?: number | null;
    firmwareVersion?: string | null;
    health?: Record<string, unknown>;
  },
  env: ServerEnv = loadServerEnv(),
) {
  requireOrganizationAccess(session, organizationId, "race_day.manage");
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_save_timing_device", {
    p_organization_id: organizationId,
    p_actor_user_id: session.account.userId,
    p_device_fingerprint: input.fingerprint,
    p_device_label: input.label ?? null,
    p_status: input.status ?? "active",
    p_clock_offset_ms: input.clockOffsetMs ?? null,
    p_battery_percent: input.batteryPercent ?? null,
    p_firmware_version: input.firmwareVersion ?? null,
    p_health_json: input.health ?? {},
  });
  if (error) mapPreRaceRpcError(error);
  return data as {
    id: string;
    label: string | null;
    fingerprint: string;
    status: string;
    clockOffsetMs: number | null;
    clockCheckedAt: string | null;
    batteryPercent: number | null;
    firmwareVersion: string | null;
    lastSeenAt: string;
  };
}

export async function publishTimingPlan(
  session: RequestSession,
  eventEditionId: string,
  input: {
    name: string;
    clockToleranceMs: number;
    points: Array<{
      categoryId: string;
      checkpointId: string;
      captureMode: "manual" | "device" | "import";
      primaryDeviceId?: string | null;
      backupMethod: string;
      operatorLabel?: string | null;
    }>;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_publish_timing_plan", {
    p_event_edition_id: eventEditionId,
    p_actor_user_id: session.account.userId,
    p_name: input.name,
    p_clock_tolerance_ms: input.clockToleranceMs,
    p_points: input.points.map((point) => ({
      category_id: point.categoryId,
      checkpoint_id: point.checkpointId,
      capture_mode: point.captureMode,
      primary_device_id: point.primaryDeviceId ?? null,
      backup_method: point.backupMethod,
      operator_label: point.operatorLabel ?? null,
    })),
  });
  if (error) mapPreRaceRpcError(error);
  return data as {
    timingPlanId: string;
    versionNumber: number;
    digest: string;
    pointCount: number;
    replayed: boolean;
  };
}

export async function recordPreRaceRehearsal(
  session: RequestSession,
  eventEditionId: string,
  input: {
    passed: boolean;
    checklist: {
      manifestVerified: boolean;
      clockSyncVerified: boolean;
      backupCaptureVerified: boolean;
      operatorBriefingComplete: boolean;
      testPunchReconciled: boolean;
    };
    issues?: unknown[];
    notes?: string | null;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireEditionAccess(session, eventEditionId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_record_pre_race_rehearsal", {
    p_event_edition_id: eventEditionId,
    p_actor_user_id: session.account.userId,
    p_passed: input.passed,
    p_checklist: input.checklist,
    p_issues: input.issues ?? [],
    p_notes: input.notes ?? null,
  });
  if (error) mapPreRaceRpcError(error);
  return data as {
    rehearsalId: string;
    status: "passed" | "failed";
    completedAt: string;
    timingReadinessState: "ready" | "failed";
  };
}
