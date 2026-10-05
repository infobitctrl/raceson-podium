import type { RequestSession } from "@raceson/domain/auth";
import { badRequest, conflict, notFound, serviceUnavailable } from "./errors.js";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  requireCategoryAccess,
  requireEditionAccess,
  requireRegistrationAccess,
} from "./permissions.js";
import { createAdminSupabaseClient } from "./supabase.js";
import { computeFinishedCategoryResultsForWorkflow } from "./race-ops.js";

export type ParticipationState =
  | "not_started"
  | "checked_in"
  | "dns"
  | "started"
  | "finished"
  | "dnf"
  | "dsq"
  | "withdrawn"
  | "stopped"
  | "evacuated"
  | "missing";

export function participantStatusAccessRequirement(
  status: ParticipationState,
  isCorrection = false,
) {
  if (isCorrection) return "results.manage" as const;
  return status === "dnf"
    ? (["race_day.manage", "checkpoint_timing.enter"] as const)
    : "race_day.manage";
}

export const punchRevisionAccessRequirement = [
  "race_day.manage",
  "results.manage",
] as const;

export type RaceStartEvent = {
  id: string;
  eventCategoryId: string;
  eventType: "actual_start" | "restart" | "delay" | "cancelled" | "abandoned";
  plannedAt: string | null;
  occurredAt: string;
  startMethod: string | null;
  reason: string | null;
  sequenceNumber: number;
  startedParticipantCount?: number;
  replayed?: boolean;
};

export type RaceStartControlState = {
  eventEditionId: string;
  editionStatus: string;
  categories: Array<{
    id: string;
    name: string;
    plannedStartAt: string | null;
    currentStatus: string;
    latestEvent: RaceStartEvent | null;
    effectiveStartAt: string | null;
    counts: {
      confirmed: number;
      checkedIn: number;
      started: number;
      finished: number;
      dnf: number;
      unresolved: number;
    };
  }>;
};

export type FinishRaceResult = {
  eventEditionId: string;
  finishedCategoryIds: string[];
  closedTimingSessionCount: number;
  editionCompleted: boolean;
  resultRunIds: string[];
  pendingResultCategoryIds: string[];
  workflowEventId: string;
  replayed: boolean;
  unfinishedParticipantCount: number;
  markedDnfCount: number;
  skippedResultCategoryIds: string[];
};

type FinishRaceWorkflowJob = {
  jobId: string;
  categoryId: string;
  state: "queued" | "running" | "retry_wait" | "succeeded" | "dead_letter" | "cancelled";
  resultRunId: string | null;
};

type FinishRaceCommandResult = {
  eventEditionId: string;
  finishedCategoryIds: string[];
  closedTimingSessionCount: number;
  editionCompleted: boolean;
  domainEventId: string;
  resultJobs: FinishRaceWorkflowJob[];
  replayed: boolean;
  unfinishedParticipantCount?: number;
  markedDnfCount?: number;
  skippedResultCategoryIds?: string[];
};

export type CutoffActionType =
  | "warning"
  | "grace"
  | "stopped"
  | "acknowledged"
  | "transport_arranged";

export type FieldAccountingState = {
  eventCategoryId: string;
  categoryName: string;
  checkpoints: Array<{
    id: string;
    code: string;
    name: string;
    checkpointType: string;
    sequenceNumber: number;
    cutoffAt: string | null;
    operationState: string | null;
    timingSessionState: string | null;
    counts: {
      expected: number;
      passed: number;
      approaching: number;
      due: number;
      overdue: number;
      stopped: number;
      unresolved: number;
    };
    queue: Array<{
      registrationId: string;
      athleteName: string;
      bibNumber: string | null;
      participationStatus: string;
      passageState: "passed" | "approaching" | "due" | "overdue" | "stopped" | "resolved";
      observedAt: string | null;
      latestAction: {
        id: string;
        actionType: CutoffActionType;
        effectiveAt: string;
        graceUntil: string | null;
        participantAcknowledged: boolean;
        note: string | null;
        transportPlan: string | null;
      } | null;
    }>;
  }>;
  latestSignoff: {
    id: string;
    signoffState: "ready_for_results" | "closed_with_open_missing";
    signedAt: string;
    note: string | null;
    snapshot: Record<string, unknown>;
  } | null;
  publicLive: {
    isEnabled: boolean;
    delaySeconds: number;
    isSuppressed: boolean;
    suppressionMessage: string | null;
    showCheckpointAggregates: boolean;
  };
};

export type DnsReview = {
  id: string;
  eventCategoryId: string;
  raceStartEventId: string;
  reviewState: "open" | "committed" | "superseded";
  candidateCount: number;
  note: string | null;
  createdAt: string;
  committedAt: string | null;
  candidates: Array<{
    registrationId: string;
    athleteName: string;
    bibNumber: string | null;
    capturedParticipationStatus: "not_started" | "checked_in";
  }>;
};

function mapPhase3Error(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): never {
  const message = error.message ?? "race_control_operation_failed";
  if (message.includes("race_live_operations_closed")) {
    throw conflict("This race has finished or been closed. Use results review for corrections.");
  }
  if (message.includes("race_live_operations_busy")) {
    throw conflict("The race state is changing. Refresh before trying again.");
  }
  if (
    error.code === "PGRST202"
    && (message.includes("service_complete_terminal_race_edition")
      || message.includes("service_finish_race_categories_with_override"))
  ) {
    throw serviceUnavailable(
      "Race completion is temporarily unavailable while the database update completes",
    );
  }
  if (message.includes("race_start_event_input_invalid")) {
    throw badRequest("Start action, timestamp, method, and required reason are invalid");
  }
  if (message.includes("race_start_event_future_time_invalid")) {
    throw badRequest("Operational timestamps cannot be more than ten minutes in the future");
  }
  if (message.includes("race_start_readiness_blocked")) {
    throw conflict("Use Finish registrations in Check-in before starting the race");
  }
  if (message.includes("timing_fleet_race_start_blocked")) {
    throw conflict("The active timing plan requires a healthy primary device with current race authority before the race can start");
  }
  if (message.includes("critical_safety_incident_blocks_start")) {
    throw conflict("A critical safety incident must be resolved before the race can start");
  }
  if (message.includes("race_already_started")) {
    throw conflict("This race already has an actual start. Use a restart with a reason to correct it.");
  }
  if (message.includes("race_restart_requires_start")) {
    throw conflict("A restart requires an existing actual start");
  }
  if (message.includes("started_race_cannot_cancel")) {
    throw conflict("A started race must be abandoned, not cancelled");
  }
  if (message.includes("race_abandon_requires_start")) {
    throw conflict("Only a started race can be abandoned");
  }
  if (message.includes("race_finish_input_invalid")) {
    throw badRequest("Choose between one and one hundred races to finish");
  }
  if (message.includes("race_finish_override_reason_required")) {
    throw badRequest("Enter an override reason between 3 and 2000 characters");
  }
  if (message.includes("race_finish_category_mismatch")) {
    throw conflict("Every selected race must belong to this race");
  }
  if (message.includes("race_finish_transition_invalid")) {
    throw conflict("Only a started race can be finished");
  }
  if (message.includes("race_finish_unfinished_acknowledgement_required")) {
    throw conflict(
      `${error.details ?? "Some"} participant(s) have not finished. Confirm that they should be marked DNF before finishing the race.`,
    );
  }
  if (message.includes("race_finish_acknowledgement_invalid")) {
    throw badRequest("The unfinished-participant acknowledgement is required");
  }
  if (message.includes("terminal_race_completion_input_invalid")) {
    throw badRequest("Choose a valid race to complete");
  }
  if (message.includes("terminal_race_completion_invalid")) {
    throw conflict("Every race must be finished, cancelled, or abandoned before completing race day");
  }
  if (message.includes("edition_not_found")) throw notFound("Race edition not found");
  if (message.includes("participant_status_input_invalid")) {
    throw badRequest("Participant status, effective time, and the required reason are invalid");
  }
  if (message.includes("participant_registration_not_confirmed")) {
    throw conflict("Only confirmed registrations can enter race-day participant states");
  }
  if (message.includes("participant_status_transition_invalid")) {
    throw conflict(`Participant status transition is not allowed${error.details ? ` (${error.details})` : ""}`);
  }
  if (message.includes("cutoff_action_input_invalid")) {
    throw badRequest("The cutoff action, timestamp, grace window, or required reason is invalid");
  }
  if (message.includes("checkpoint_has_no_cutoff")) {
    throw conflict("Configure a cutoff time on this checkpoint before recording cutoff decisions");
  }
  if (message.includes("cutoff_stop_status_invalid")) {
    throw conflict("Only an athlete currently on route or missing may be stopped at a cutoff");
  }
  if (message.includes("checkpoint_operation_input_invalid")) {
    throw badRequest("Checkpoint state, timestamp, or required reason is invalid");
  }
  if (message.includes("checkpoint_timing_sessions_open")) {
    throw conflict("Close every timing session at this checkpoint before reconciliation");
  }
  if (message.includes("checkpoint_unresolved_punches_open")) {
    throw conflict("Resolve or void every unknown timing race at this checkpoint before reconciliation");
  }
  if (message.includes("field_signoff_start_required")) {
    throw conflict("The race must have an actual start before field accounting can be signed");
  }
  if (message.includes("field_accounting_unresolved_participants")) {
    throw conflict(`Resolve every participant still checked in or on route before sign-off${error.details ? ` (${error.details} open)` : ""}`);
  }
  if (message.includes("field_accounting_missing_requires_acknowledgement")) {
    throw conflict("Open missing cases require an explicit signed acknowledgement and note");
  }
  if (message.includes("field_accounting_timing_sessions_open")) {
    throw conflict("Close every timing session before field-accounting sign-off");
  }
  if (message.includes("field_accounting_unresolved_punches")) {
    throw conflict("Resolve or void every unknown timing race before field-accounting sign-off");
  }
  if (message.includes("field_accounting_checkpoints_not_reconciled")) {
    throw conflict("Reconcile every used checkpoint before field-accounting sign-off");
  }
  if (message.includes("open_safety_incident_blocks_field_signoff")) {
    throw conflict("Close or formally transfer every major or critical safety incident before field sign-off");
  }
  if (message.includes("public_live_settings_invalid")) {
    throw badRequest("Live delay must be 0–3600 seconds and suppression requires a public message");
  }
  if (message.includes("dns_review_start_required")) {
    throw conflict("Record the actual start before reviewing DNS candidates");
  }
  if (message.includes("dns_review_unresolved_start_events")) {
    throw conflict("Resolve or void unknown start observations before reviewing DNS candidates");
  }
  if (message.includes("dns_review_start_changed")) {
    throw conflict("The race start changed after this review. Create a fresh DNS preview.");
  }
  if (message.includes("dns_review_stale")) {
    throw conflict("A candidate state changed after preview. Create and review a fresh DNS preview.");
  }
  if (message.includes("dns_review_not_open")) {
    throw conflict("This DNS review is no longer open");
  }
  if (message.includes("dns_review_not_found")) throw notFound("DNS review not found");
  if (message.includes("idempotency_key_reused")) {
    throw conflict("This client race ID was already used for different data");
  }
  if (error.code === "23505") {
    throw conflict("This command was already recorded with conflicting data");
  }
  if (message.includes("category_not_found")) throw notFound("Race not found");
  if (message.includes("registration_not_found")) throw notFound("Registration not found");
  if (message.includes("checkpoint_not_found") || message.includes("cutoff_checkpoint_not_found")) {
    throw notFound("Checkpoint not found");
  }
  if (message.includes("cutoff_registration_not_found")) throw notFound("Participant not found");
  throw error;
}

export async function getRaceStartControlState(
  session: RequestSession,
  eventEditionId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<RaceStartControlState> {
  await requireEditionAccess(session, eventEditionId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const [
    { data: edition, error: editionError },
    { data: categories, error: categoryError },
    { data: events, error: eventError },
  ] =
    await Promise.all([
      adminClient
        .from("event_editions")
        .select("status")
        .eq("id", eventEditionId)
        .maybeSingle<{ status: string }>(),
      adminClient
        .from("event_categories")
        .select("id,name,start_at,status,results_mode,display_order")
        .eq("event_edition_id", eventEditionId)
        .is("organizer_deleted_at", null)
        .neq("results_mode", "informative_age")
        .order("start_at", { ascending: true, nullsFirst: false })
        .order("display_order", { ascending: true }),
      adminClient
        .from("race_start_events")
        .select("id,event_category_id,event_type,planned_at,occurred_at,start_method,reason,sequence_number")
        .eq("event_edition_id", eventEditionId)
        .order("sequence_number", { ascending: false }),
    ]);
  if (editionError) throw editionError;
  if (!edition) throw notFound("Race edition not found");
  if (categoryError) throw categoryError;
  if (eventError) throw eventError;
  const categoryIds = (categories ?? []).map((category) => category.id);

  const { data: registrations, error: registrationError } = categoryIds.length
    ? await adminClient
        .from("registrations")
        .select("id,event_category_id,status,participation_status")
        .in("event_category_id", categoryIds)
        .eq("status", "confirmed")
    : { data: [], error: null };
  if (registrationError) throw registrationError;

  const latestEventByCategory = new Map<string, RaceStartEvent>();
  const effectiveStartByCategory = new Map<string, string>();
  for (const event of events ?? []) {
    if (!latestEventByCategory.has(event.event_category_id)) {
      latestEventByCategory.set(event.event_category_id, {
        id: event.id,
        eventCategoryId: event.event_category_id,
        eventType: event.event_type as RaceStartEvent["eventType"],
        plannedAt: event.planned_at,
        occurredAt: event.occurred_at,
        startMethod: event.start_method,
        reason: event.reason,
        sequenceNumber: event.sequence_number,
      });
    }
    if (
      !effectiveStartByCategory.has(event.event_category_id)
      && ["actual_start", "restart"].includes(event.event_type)
    ) {
      effectiveStartByCategory.set(event.event_category_id, event.occurred_at);
    }
  }

  return {
    eventEditionId,
    editionStatus: edition.status,
    categories: (categories ?? []).map((category) => {
      const raceRegistrations = (registrations ?? []).filter(
        (registration) => registration.event_category_id === category.id,
      );
      const count = (status: string) =>
        raceRegistrations.filter((registration) => registration.participation_status === status).length;
      const started = raceRegistrations.filter((registration) =>
        ["started", "finished", "dnf", "dsq", "stopped", "evacuated", "missing"].includes(
          registration.participation_status,
        ),
      ).length;
      const resolved = raceRegistrations.filter((registration) =>
        ["finished", "dnf", "dsq", "dns", "withdrawn", "stopped", "evacuated"].includes(
          registration.participation_status,
        ),
      ).length;
      return {
        id: category.id,
        name: category.name,
        plannedStartAt: category.start_at,
        currentStatus: category.status,
        latestEvent: latestEventByCategory.get(category.id) ?? null,
        effectiveStartAt: effectiveStartByCategory.get(category.id) ?? null,
        counts: {
          confirmed: raceRegistrations.length,
          checkedIn: count("checked_in"),
          started,
          finished: count("finished"),
          dnf: count("dnf"),
          unresolved: Math.max(0, raceRegistrations.length - resolved),
        },
      };
    }),
  };
}

export async function recordRaceStartEvent(
  session: RequestSession,
  eventCategoryId: string,
  input: {
    eventType: RaceStartEvent["eventType"];
    occurredAt: string;
    plannedAt?: string | null;
    startMethod?: "mass_gun" | "chip" | "rolling" | "individual_interval" | "manual_import" | "neutralized" | null;
    reason?: string | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(session, eventCategoryId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_record_race_start_event", {
    p_event_category_id: eventCategoryId,
    p_actor_user_id: session.account.userId,
    p_event_type: input.eventType,
    p_occurred_at: input.occurredAt,
    p_planned_at: input.plannedAt ?? null,
    p_start_method: input.startMethod ?? null,
    p_reason: input.reason ?? null,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapPhase3Error(error);
  return data as RaceStartEvent;
}

export async function finishRace(
  session: RequestSession,
  eventEditionId: string,
  categoryIds: string[],
  clientEventId: string,
  acknowledgeUnfinishedAsDnf: boolean,
  env: ServerEnv = loadServerEnv(),
  overrideReason?: string,
): Promise<FinishRaceResult> {
  await requireEditionAccess(
    session,
    eventEditionId,
    "race_day.manage",
    env,
  );
  const uniqueCategoryIds = Array.from(new Set(categoryIds));
  if (!uniqueCategoryIds.length) {
    throw badRequest("Choose at least one started race to finish");
  }

  const adminClient = createAdminSupabaseClient(env);
  const { data: categoryStates, error: categoryStateError } = await adminClient
    .from("event_categories")
    .select("id,status")
    .eq("event_edition_id", eventEditionId)
    .in("id", uniqueCategoryIds)
    .returns<Array<{ id: string; status: string }>>();
  if (categoryStateError) throw categoryStateError;
  const completesAlreadyTerminalRaces = categoryStates?.length === uniqueCategoryIds.length
    && categoryStates.every((category) => ["completed", "closed"].includes(category.status));
  const { data, error } = overrideReason !== undefined
    ? await adminClient.rpc("service_finish_race_categories_with_override", {
        p_event_edition_id: eventEditionId,
        p_event_category_ids: uniqueCategoryIds,
        p_actor_user_id: session.account.userId,
        p_client_event_id: clientEventId,
        p_acknowledge_unfinished_as_dnf: acknowledgeUnfinishedAsDnf,
        p_override_reason: overrideReason,
      })
    : completesAlreadyTerminalRaces
    ? await adminClient.rpc("service_complete_terminal_race_edition", {
        p_event_edition_id: eventEditionId,
        p_actor_user_id: session.account.userId,
        p_client_event_id: clientEventId,
      })
    : await adminClient.rpc("service_finish_race_categories", {
        p_event_edition_id: eventEditionId,
        p_event_category_ids: uniqueCategoryIds,
        p_actor_user_id: session.account.userId,
        p_client_event_id: clientEventId,
        p_acknowledge_unfinished_as_dnf: acknowledgeUnfinishedAsDnf,
      });
  if (error) mapPhase3Error(error);

  const command = data as FinishRaceCommandResult;
  const resultOutcomes = await Promise.all(
    command.resultJobs.map(async (job) => {
      if (job.state === "succeeded" && job.resultRunId) {
        return { categoryId: job.categoryId, resultRunId: job.resultRunId, pending: false };
      }
      if (job.state === "dead_letter" || job.state === "cancelled") {
        return { categoryId: job.categoryId, resultRunId: null, pending: true };
      }

      try {
        const snapshot = await computeFinishedCategoryResultsForWorkflow(
          job.categoryId,
          job.jobId,
          env,
        );
        const resultRunId = snapshot.selectedRun?.id ?? null;
        if (!resultRunId) {
          throw new Error("result_run_not_created");
        }

        const { error: completionError } = await adminClient.rpc(
          "service_complete_workflow_job",
          {
            p_workflow_job_id: job.jobId,
            p_handler_key: "result.run.compute",
            p_result_json: { resultRunId },
          },
        );

        return {
          categoryId: job.categoryId,
          resultRunId,
          pending: Boolean(completionError),
        };
      } catch {
        await adminClient.rpc("service_record_workflow_job_failure", {
          p_workflow_job_id: job.jobId,
          p_handler_key: "result.run.compute",
          p_error_code: "result_compute_failed",
        });
        return { categoryId: job.categoryId, resultRunId: null, pending: true };
      }
    }),
  );

  return {
    eventEditionId: command.eventEditionId,
    finishedCategoryIds: command.finishedCategoryIds,
    closedTimingSessionCount: command.closedTimingSessionCount,
    editionCompleted: command.editionCompleted,
    resultRunIds: Array.from(new Set(resultOutcomes.flatMap((outcome) =>
      outcome.resultRunId ? [outcome.resultRunId] : []
    ))),
    pendingResultCategoryIds: Array.from(new Set(resultOutcomes
      .filter((outcome) => outcome.pending)
      .map((outcome) => outcome.categoryId))),
    workflowEventId: command.domainEventId,
    replayed: command.replayed,
    unfinishedParticipantCount: command.unfinishedParticipantCount ?? 0,
    markedDnfCount: command.markedDnfCount ?? 0,
    skippedResultCategoryIds: command.skippedResultCategoryIds ?? [],
  };
}

export async function recordParticipantStatus(
  session: RequestSession,
  registrationId: string,
  input: {
    status: ParticipationState;
    effectiveAt: string;
    reason?: string | null;
    clientEventId: string;
    isCorrection?: boolean;
    metadata?: Record<string, unknown>;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireRegistrationAccess(
    session,
    registrationId,
    participantStatusAccessRequirement(input.status, input.isCorrection),
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_record_participant_status", {
    p_registration_id: registrationId,
    p_actor_user_id: session.account.userId,
    p_status: input.status,
    p_effective_at: input.effectiveAt,
    p_reason: input.reason ?? null,
    p_client_event_id: input.clientEventId,
    p_is_correction: input.isCorrection ?? false,
    p_metadata: input.metadata ?? {},
  });
  if (error) mapPhase3Error(error);
  return data as {
    id: string;
    registrationId: string;
    status: ParticipationState;
    effectiveAt: string;
    reason: string | null;
    isCorrection: boolean;
    replayed: boolean;
  };
}

export async function createManualResultTimingObservation(
  session: RequestSession,
  registrationId: string,
  input: {
    checkpointId: string;
    recordedAt: string;
    reason: string;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireRegistrationAccess(
    session,
    registrationId,
    "results.manage",
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data: checkpoint, error: checkpointError } = await adminClient
    .from("checkpoints")
    .select("is_mandatory")
    .eq("id", input.checkpointId)
    .maybeSingle<{ is_mandatory: boolean }>();
  if (checkpointError) throw checkpointError;
  if (checkpoint && !checkpoint.is_mandatory) {
    throw badRequest("Choose a required checkpoint or finish for this timing observation");
  }
  const { data, error } = await adminClient.rpc(
    "service_create_manual_result_timing_observation",
    {
      p_registration_id: registrationId,
      p_checkpoint_id: input.checkpointId,
      p_recorded_at: input.recordedAt,
      p_reason: input.reason,
      p_actor_user_id: session.account.userId,
      p_client_event_id: input.clientEventId,
    },
  );
  if (error) {
    const message = error.message ?? "manual_result_timing_observation_failed";
    if (message.includes("manual_result_timing_observation_input_invalid")) {
      throw badRequest("Checkpoint, time, reason, and client race ID are required");
    }
    if (message.includes("manual_result_registration_not_found")) {
      throw notFound("Confirmed registration not found");
    }
    if (message.includes("manual_result_checkpoint_invalid")) {
      throw badRequest("Choose a checkpoint or finish that belongs to this runner's race");
    }
    if (message.includes("manual_result_timing_observation_exists")) {
      throw conflict("This runner already has a time at this checkpoint. Refresh and edit the existing time.");
    }
    if (message.includes("idempotency_key_reused")) {
      throw conflict("This client race ID was already used for a different timing observation");
    }
    throw error;
  }
  return data as {
    punchEventId: string;
    registrationId: string;
    checkpointId: string;
    recordedAt: string;
    reconciliationState: string;
    replayed: boolean;
  };
}

export async function revisePunchEvent(
  session: RequestSession,
  punchEventId: string,
  input: {
    revisionType: "resolve_registration" | "correct_time" | "void" | "restore";
    reason: string;
    registrationId?: string | null;
    effectiveRecordedAt?: string | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: punch, error: punchError } = await adminClient
    .from("punch_events")
    .select("event_category_id,checkpoint_id")
    .eq("id", punchEventId)
    .maybeSingle<{ event_category_id: string; checkpoint_id: string }>();
  if (punchError) throw punchError;
  if (!punch) throw notFound("Timing race not found");
  await requireCategoryAccess(
    session,
    punch.event_category_id,
    punchRevisionAccessRequirement,
    env,
  );

  if (input.revisionType === "resolve_registration" && input.registrationId) {
    const { data: existingCheckpointPunch, error: existingCheckpointPunchError } = await adminClient
      .from("punch_events")
      .select("id")
      .eq("event_category_id", punch.event_category_id)
      .eq("checkpoint_id", punch.checkpoint_id)
      .eq("registration_id", input.registrationId)
      .eq("is_voided", false)
      .neq("id", punchEventId)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (existingCheckpointPunchError) throw existingCheckpointPunchError;
    if (existingCheckpointPunch) {
      throw conflict("The selected runner already has a time at this checkpoint");
    }
  }

  const { data, error } = await adminClient.rpc("service_revise_punch_event", {
    p_punch_event_id: punchEventId,
    p_actor_user_id: session.account.userId,
    p_revision_type: input.revisionType,
    p_reason: input.reason,
    p_registration_id: input.registrationId ?? null,
    p_effective_recorded_at: input.effectiveRecordedAt ?? null,
    p_client_event_id: input.clientEventId,
  });
  if (error) {
    const message = error.message ?? "punch_revision_failed";
    if (message.includes("punch_revision_input_invalid")) {
      throw badRequest("Revision type, reason, and required correction value are invalid");
    }
    if (message.includes("punch_registration_invalid")) {
      throw conflict("The selected confirmed registration does not belong to this race");
    }
    if (message.includes("punch_registration_not_in_manifest")) {
      throw conflict("The selected registration is not in the current frozen manifest");
    }
    if (message.includes("idempotency_key_reused")) {
      throw conflict("This client race ID was already used for a different revision");
    }
    throw error;
  }
  return data as {
    revisionId: string;
    punchEventId: string;
    revisionType: string;
    registrationId: string | null;
    bibNumber: string | null;
    effectiveRecordedAt: string;
    isVoided: boolean;
    reconciliationState: string;
    replayed: boolean;
  };
}

export async function resolveResultAnomaly(
  session: RequestSession,
  anomalyId: string,
  input: {
    resolutionState: "resolved" | "waived";
    resolutionNote: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: anomaly, error: anomalyError } = await adminClient
    .from("result_anomalies")
    .select("event_category_id")
    .eq("id", anomalyId)
    .maybeSingle<{ event_category_id: string }>();
  if (anomalyError) throw anomalyError;
  if (!anomaly) throw notFound("Result anomaly not found");
  await requireCategoryAccess(session, anomaly.event_category_id, "results.manage", env);

  const { data, error } = await adminClient.rpc("service_resolve_result_anomaly", {
    p_anomaly_id: anomalyId,
    p_actor_user_id: session.account.userId,
    p_resolution_state: input.resolutionState,
    p_resolution_note: input.resolutionNote,
  });
  if (error) {
    if (error.message.includes("result_anomaly_resolution_invalid")) {
      throw badRequest("Choose resolved or waived and include an adjudication note");
    }
    throw error;
  }
  return data as {
    id: string;
    state: "resolved" | "waived";
    resolutionNote: string;
    resolvedAt: string;
  };
}

export async function getFieldAccountingState(
  session: RequestSession,
  eventCategoryId: string,
  env: ServerEnv = loadServerEnv(),
): Promise<FieldAccountingState> {
  await requireCategoryAccess(
    session,
    eventCategoryId,
    ["race_day.manage", "results.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data: category, error: categoryError } = await adminClient
    .from("event_categories")
    .select("id,name")
    .eq("id", eventCategoryId)
    .maybeSingle<{ id: string; name: string }>();
  if (categoryError) throw categoryError;
  if (!category) throw notFound("Race not found");

  const [
    checkpointsResponse,
    registrationsResponse,
    punchesResponse,
    actionsResponse,
    operationsResponse,
    sessionsResponse,
    signoffResponse,
    liveResponse,
  ] = await Promise.all([
    adminClient
      .from("checkpoints")
      .select("id,code,name,checkpoint_type,sequence_number,cutoff_at")
      .eq("event_category_id", eventCategoryId)
      .order("sequence_number", { ascending: true }),
    adminClient
      .from("registrations")
      .select("id,athlete_profile_id,participation_status")
      .eq("event_category_id", eventCategoryId)
      .eq("status", "confirmed"),
    adminClient
      .from("punch_events")
      .select("id,checkpoint_id,registration_id,effective_recorded_at,reconciliation_state,is_voided")
      .eq("event_category_id", eventCategoryId)
      .eq("is_voided", false)
      .order("effective_recorded_at", { ascending: false }),
    adminClient
      .from("cutoff_actions")
      .select("id,checkpoint_id,registration_id,action_type,effective_at,grace_until,participant_acknowledged,note,transport_plan")
      .eq("event_category_id", eventCategoryId)
      .order("effective_at", { ascending: false }),
    adminClient
      .from("checkpoint_operation_events")
      .select("id,checkpoint_id,operation_state,effective_at,sequence_number")
      .eq("event_category_id", eventCategoryId)
      .order("sequence_number", { ascending: false }),
    adminClient
      .from("timing_sessions")
      .select("id,checkpoint_id,status,started_at")
      .eq("event_category_id", eventCategoryId)
      .order("started_at", { ascending: false }),
    adminClient
      .from("field_accounting_signoffs")
      .select("id,signoff_state,signed_at,note,snapshot_json")
      .eq("event_category_id", eventCategoryId)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        signoff_state: "ready_for_results" | "closed_with_open_missing";
        signed_at: string;
        note: string | null;
        snapshot_json: Record<string, unknown>;
      }>(),
    adminClient
      .from("public_live_settings")
      .select("is_enabled,delay_seconds,is_suppressed,suppression_message,show_checkpoint_aggregates")
      .eq("event_category_id", eventCategoryId)
      .maybeSingle<{
        is_enabled: boolean;
        delay_seconds: number;
        is_suppressed: boolean;
        suppression_message: string | null;
        show_checkpoint_aggregates: boolean;
      }>(),
  ]);

  for (const response of [
    checkpointsResponse,
    registrationsResponse,
    punchesResponse,
    actionsResponse,
    operationsResponse,
    sessionsResponse,
    signoffResponse,
    liveResponse,
  ]) {
    if (response.error) throw response.error;
  }

  const registrations = (registrationsResponse.data ?? []) as Array<{
    id: string;
    athlete_profile_id: string;
    participation_status: string;
  }>;
  const athleteIds = [...new Set(registrations.map((registration) => registration.athlete_profile_id))];
  const registrationIds = registrations.map((registration) => registration.id);
  const [{ data: athletes, error: athleteError }, { data: bibs, error: bibError }] = await Promise.all([
    athleteIds.length
      ? adminClient
          .from("athlete_profiles")
          .select("id,first_name,last_name")
          .in("id", athleteIds)
      : Promise.resolve({ data: [], error: null }),
    registrationIds.length
      ? adminClient
          .from("bib_assignments")
          .select("registration_id,bib_number,assigned_at")
          .in("registration_id", registrationIds)
          .is("revoked_at", null)
          .order("assigned_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (athleteError) throw athleteError;
  if (bibError) throw bibError;

  const athleteNameById = new Map(
    (athletes ?? []).map((athlete) => [
      athlete.id,
      `${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`.trim() || "Participant",
    ]),
  );
  const bibByRegistrationId = new Map<string, string>();
  for (const bib of bibs ?? []) {
    if (!bibByRegistrationId.has(bib.registration_id)) {
      bibByRegistrationId.set(bib.registration_id, bib.bib_number);
    }
  }

  const latestPunchByCheckpointRegistration = new Map<string, {
    effective_recorded_at: string;
    reconciliation_state: string;
  }>();
  const unresolvedByCheckpoint = new Map<string, number>();
  for (const punch of punchesResponse.data ?? []) {
    if (!punch.registration_id) {
      unresolvedByCheckpoint.set(
        punch.checkpoint_id,
        (unresolvedByCheckpoint.get(punch.checkpoint_id) ?? 0) + 1,
      );
      continue;
    }
    const key = `${punch.checkpoint_id}:${punch.registration_id}`;
    if (!latestPunchByCheckpointRegistration.has(key)) {
      latestPunchByCheckpointRegistration.set(key, {
        effective_recorded_at: punch.effective_recorded_at,
        reconciliation_state: punch.reconciliation_state,
      });
    }
  }

  const latestActionByCheckpointRegistration = new Map<string, {
    id: string;
    action_type: CutoffActionType;
    effective_at: string;
    grace_until: string | null;
    participant_acknowledged: boolean;
    note: string | null;
    transport_plan: string | null;
  }>();
  for (const action of actionsResponse.data ?? []) {
    const key = `${action.checkpoint_id}:${action.registration_id}`;
    if (!latestActionByCheckpointRegistration.has(key)) {
      latestActionByCheckpointRegistration.set(key, action as never);
    }
  }
  const latestOperationByCheckpoint = new Map<string, string>();
  for (const operation of operationsResponse.data ?? []) {
    if (!latestOperationByCheckpoint.has(operation.checkpoint_id)) {
      latestOperationByCheckpoint.set(operation.checkpoint_id, operation.operation_state);
    }
  }
  const latestSessionByCheckpoint = new Map<string, string>();
  for (const timingSession of sessionsResponse.data ?? []) {
    if (timingSession.checkpoint_id && !latestSessionByCheckpoint.has(timingSession.checkpoint_id)) {
      latestSessionByCheckpoint.set(timingSession.checkpoint_id, timingSession.status);
    }
  }

  const nowMs = Date.now();
  const terminalStatuses = new Set(["finished", "dnf", "dsq", "dns", "withdrawn", "stopped", "evacuated"]);
  const checkpoints = (checkpointsResponse.data ?? []).map((checkpoint) => {
    const cutoffMs = checkpoint.cutoff_at ? new Date(checkpoint.cutoff_at).getTime() : null;
    const queue = registrations.map((registration) => {
      const key = `${checkpoint.id}:${registration.id}`;
      const punch = latestPunchByCheckpointRegistration.get(key) ?? null;
      const latestAction = latestActionByCheckpointRegistration.get(key) ?? null;
      let passageState: FieldAccountingState["checkpoints"][number]["queue"][number]["passageState"];
      if (punch) {
        passageState = "passed";
      } else if (registration.participation_status === "stopped" || latestAction?.action_type === "stopped") {
        passageState = "stopped";
      } else if (terminalStatuses.has(registration.participation_status)) {
        passageState = "resolved";
      } else if (latestAction?.grace_until && new Date(latestAction.grace_until).getTime() > nowMs) {
        passageState = "due";
      } else if (cutoffMs != null && nowMs > cutoffMs) {
        passageState = "overdue";
      } else if (cutoffMs != null && cutoffMs - nowMs <= 30 * 60 * 1000) {
        passageState = "due";
      } else {
        passageState = "approaching";
      }
      return {
        registrationId: registration.id,
        athleteName: athleteNameById.get(registration.athlete_profile_id) ?? "Participant",
        bibNumber: bibByRegistrationId.get(registration.id) ?? null,
        participationStatus: registration.participation_status,
        passageState,
        observedAt: punch?.effective_recorded_at ?? null,
        latestAction: latestAction
          ? {
              id: latestAction.id,
              actionType: latestAction.action_type,
              effectiveAt: latestAction.effective_at,
              graceUntil: latestAction.grace_until,
              participantAcknowledged: latestAction.participant_acknowledged,
              note: latestAction.note,
              transportPlan: latestAction.transport_plan,
            }
          : null,
      };
    });
    const count = (state: typeof queue[number]["passageState"]) =>
      queue.filter((participant) => participant.passageState === state).length;
    return {
      id: checkpoint.id,
      code: checkpoint.code,
      name: checkpoint.name,
      checkpointType: checkpoint.checkpoint_type,
      sequenceNumber: checkpoint.sequence_number,
      cutoffAt: checkpoint.cutoff_at,
      operationState: latestOperationByCheckpoint.get(checkpoint.id) ?? null,
      timingSessionState: latestSessionByCheckpoint.get(checkpoint.id) ?? null,
      counts: {
        expected: queue.length,
        passed: count("passed"),
        approaching: count("approaching"),
        due: count("due"),
        overdue: count("overdue"),
        stopped: count("stopped"),
        unresolved: unresolvedByCheckpoint.get(checkpoint.id) ?? 0,
      },
      queue,
    };
  });

  const signoff = signoffResponse.data;
  const live = liveResponse.data;
  return {
    eventCategoryId,
    categoryName: category.name,
    checkpoints,
    latestSignoff: signoff
      ? {
          id: signoff.id,
          signoffState: signoff.signoff_state,
          signedAt: signoff.signed_at,
          note: signoff.note,
          snapshot: signoff.snapshot_json,
        }
      : null,
    publicLive: {
      isEnabled: live?.is_enabled ?? false,
      delaySeconds: live?.delay_seconds ?? 60,
      isSuppressed: live?.is_suppressed ?? false,
      suppressionMessage: live?.suppression_message ?? null,
      showCheckpointAggregates: live?.show_checkpoint_aggregates ?? true,
    },
  };
}

export async function recordCutoffAction(
  session: RequestSession,
  eventCategoryId: string,
  input: {
    checkpointId: string;
    registrationId: string;
    actionType: CutoffActionType;
    effectiveAt: string;
    graceUntil?: string | null;
    reasonCode?: string | null;
    note?: string | null;
    participantAcknowledged?: boolean;
    transportPlan?: string | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(session, eventCategoryId, "race_day.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_record_cutoff_action", {
    p_event_category_id: eventCategoryId,
    p_checkpoint_id: input.checkpointId,
    p_registration_id: input.registrationId,
    p_actor_user_id: session.account.userId,
    p_action_type: input.actionType,
    p_effective_at: input.effectiveAt,
    p_grace_until: input.graceUntil ?? null,
    p_reason_code: input.reasonCode ?? null,
    p_note: input.note ?? null,
    p_participant_acknowledged: input.participantAcknowledged ?? false,
    p_transport_plan: input.transportPlan ?? null,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapPhase3Error(error);
  return data as Record<string, unknown>;
}

export async function recordCheckpointOperation(
  session: RequestSession,
  checkpointId: string,
  input: {
    operationState: "open" | "ready" | "degraded" | "closing" | "closed" | "reconciled";
    effectiveAt: string;
    reason?: string | null;
    unresolvedPackage?: Record<string, unknown>;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: checkpoint, error: checkpointError } = await adminClient
    .from("checkpoints")
    .select("event_category_id")
    .eq("id", checkpointId)
    .maybeSingle<{ event_category_id: string }>();
  if (checkpointError) throw checkpointError;
  if (!checkpoint) throw notFound("Checkpoint not found");
  await requireCategoryAccess(
    session,
    checkpoint.event_category_id,
    "race_day.manage",
    env,
  );
  const { data, error } = await adminClient.rpc("service_record_checkpoint_operation", {
    p_checkpoint_id: checkpointId,
    p_actor_user_id: session.account.userId,
    p_operation_state: input.operationState,
    p_effective_at: input.effectiveAt,
    p_reason: input.reason ?? null,
    p_unresolved_package_json: input.unresolvedPackage ?? {},
    p_client_event_id: input.clientEventId,
  });
  if (error) mapPhase3Error(error);
  return data as Record<string, unknown>;
}

export async function signoffFieldAccounting(
  session: RequestSession,
  eventCategoryId: string,
  input: {
    allowOpenMissing?: boolean;
    note?: string | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(
    session,
    eventCategoryId,
    ["race_day.manage", "results.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_signoff_field_accounting", {
    p_event_category_id: eventCategoryId,
    p_actor_user_id: session.account.userId,
    p_allow_open_missing: input.allowOpenMissing ?? false,
    p_note: input.note ?? null,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapPhase3Error(error);
  return data as Record<string, unknown>;
}

export async function configurePublicLive(
  session: RequestSession,
  eventCategoryId: string,
  input: {
    isEnabled: boolean;
    delaySeconds: number;
    isSuppressed: boolean;
    suppressionMessage?: string | null;
    showCheckpointAggregates: boolean;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(session, eventCategoryId, "results.manage", env);
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_configure_public_live", {
    p_event_category_id: eventCategoryId,
    p_actor_user_id: session.account.userId,
    p_is_enabled: input.isEnabled,
    p_delay_seconds: input.delaySeconds,
    p_is_suppressed: input.isSuppressed,
    p_suppression_message: input.suppressionMessage ?? null,
    p_show_checkpoint_aggregates: input.showCheckpointAggregates,
  });
  if (error) mapPhase3Error(error);
  return data as Record<string, unknown>;
}

export async function getDnsReview(
  session: RequestSession,
  eventCategoryId: string,
  dnsReviewId?: string | null,
  env: ServerEnv = loadServerEnv(),
): Promise<DnsReview | null> {
  await requireCategoryAccess(
    session,
    eventCategoryId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  let batchQuery = adminClient
    .from("dns_review_batches")
    .select("id,event_category_id,race_start_event_id,review_state,candidate_count,note,created_at,committed_at")
    .eq("event_category_id", eventCategoryId);
  batchQuery = dnsReviewId
    ? batchQuery.eq("id", dnsReviewId)
    : batchQuery.order("created_at", { ascending: false }).limit(1);
  const { data: batches, error: batchError } = await batchQuery;
  if (batchError) throw batchError;
  const batch = batches?.[0] as {
    id: string;
    event_category_id: string;
    race_start_event_id: string;
    review_state: "open" | "committed" | "superseded";
    candidate_count: number;
    note: string | null;
    created_at: string;
    committed_at: string | null;
  } | undefined;
  if (!batch) return null;

  const { data: entries, error: entryError } = await adminClient
    .from("dns_review_entries")
    .select("registration_id,captured_participation_status,captured_bib_number")
    .eq("dns_review_batch_id", batch.id);
  if (entryError) throw entryError;
  const registrationIds = (entries ?? []).map((entry) => entry.registration_id);
  const { data: registrations, error: registrationError } = registrationIds.length
    ? await adminClient
        .from("registrations")
        .select("id,athlete_profile_id")
        .in("id", registrationIds)
    : { data: [], error: null };
  if (registrationError) throw registrationError;
  const athleteIds = [...new Set((registrations ?? []).map((registration) => registration.athlete_profile_id))];
  const { data: athletes, error: athleteError } = athleteIds.length
    ? await adminClient
        .from("athlete_profiles")
        .select("id,first_name,last_name")
        .in("id", athleteIds)
    : { data: [], error: null };
  if (athleteError) throw athleteError;

  const athleteIdByRegistration = new Map(
    (registrations ?? []).map((registration) => [registration.id, registration.athlete_profile_id]),
  );
  const athleteNameById = new Map(
    (athletes ?? []).map((athlete) => [
      athlete.id,
      `${athlete.first_name ?? ""} ${athlete.last_name ?? ""}`.trim() || "Participant",
    ]),
  );
  return {
    id: batch.id,
    eventCategoryId: batch.event_category_id,
    raceStartEventId: batch.race_start_event_id,
    reviewState: batch.review_state,
    candidateCount: batch.candidate_count,
    note: batch.note,
    createdAt: batch.created_at,
    committedAt: batch.committed_at,
    candidates: (entries ?? []).map((entry) => ({
      registrationId: entry.registration_id,
      athleteName: athleteNameById.get(athleteIdByRegistration.get(entry.registration_id) ?? "")
        ?? "Participant",
      bibNumber: entry.captured_bib_number,
      capturedParticipationStatus: entry.captured_participation_status as "not_started" | "checked_in",
    })),
  };
}

export async function createDnsReview(
  session: RequestSession,
  eventCategoryId: string,
  input: {
    note?: string | null;
    clientEventId: string;
  },
  env: ServerEnv = loadServerEnv(),
) {
  await requireCategoryAccess(
    session,
    eventCategoryId,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const adminClient = createAdminSupabaseClient(env);
  const { data, error } = await adminClient.rpc("service_create_dns_review", {
    p_event_category_id: eventCategoryId,
    p_actor_user_id: session.account.userId,
    p_note: input.note ?? null,
    p_client_event_id: input.clientEventId,
  });
  if (error) mapPhase3Error(error);
  const created = data as { id: string };
  const review = await getDnsReview(session, eventCategoryId, created.id, env);
  if (!review) throw notFound("DNS review not found");
  return review;
}

export async function commitDnsReview(
  session: RequestSession,
  dnsReviewId: string,
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);
  const { data: batch, error: batchError } = await adminClient
    .from("dns_review_batches")
    .select("event_category_id")
    .eq("id", dnsReviewId)
    .maybeSingle<{ event_category_id: string }>();
  if (batchError) throw batchError;
  if (!batch) throw notFound("DNS review not found");
  await requireCategoryAccess(
    session,
    batch.event_category_id,
    ["entrants.manage", "race_day.manage"],
    env,
  );
  const { error } = await adminClient.rpc("service_commit_dns_review", {
    p_dns_review_batch_id: dnsReviewId,
    p_actor_user_id: session.account.userId,
  });
  if (error) mapPhase3Error(error);
  const review = await getDnsReview(session, batch.event_category_id, dnsReviewId, env);
  if (!review) throw notFound("DNS review not found");
  return review;
}
