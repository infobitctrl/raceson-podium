import { apiRequest } from "@/lib/api";

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

export function getRaceStartControlState(eventEditionId: string) {
  return apiRequest<RaceStartControlState>({
    path:
      `/v1/organizer/editions/${encodeURIComponent(eventEditionId)}`
      + "/race-start-control",
  });
}

export function recordRaceStartEvent(
  eventCategoryId: string,
  input: {
    eventType: RaceStartEvent["eventType"];
    occurredAt?: string;
    plannedAt?: string | null;
    startMethod?: "mass_gun" | "chip" | "rolling" | "individual_interval" | "manual_import" | "neutralized" | null;
    reason?: string | null;
    clientEventId: string;
  },
) {
  return apiRequest<RaceStartEvent>({
    path:
      `/v1/organizer/categories/${encodeURIComponent(eventCategoryId)}`
      + "/start-events",
    method: "POST",
    body: input,
  });
}

export function finishRace(
  eventEditionId: string,
  categoryIds: string[],
  clientEventId: string,
  acknowledgeUnfinishedAsDnf: boolean,
  overrideReason?: string,
) {
  return apiRequest<{
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
  }>({
    path:
      `/v1/organizer/editions/${encodeURIComponent(eventEditionId)}`
      + "/finish-race",
    method: "POST",
    body: { categoryIds, clientEventId, acknowledgeUnfinishedAsDnf, overrideReason },
  });
}

export function recordParticipantStatus(
  registrationId: string,
  input: {
    status: ParticipationState;
    effectiveAt: string;
    reason?: string | null;
    clientEventId: string;
    isCorrection?: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  return apiRequest<{
    id: string;
    registrationId: string;
    status: ParticipationState;
    effectiveAt: string;
    reason: string | null;
    isCorrection: boolean;
    replayed: boolean;
  }>({
    path:
      `/v1/organizer/registrations/${encodeURIComponent(registrationId)}`
      + "/participant-status",
    method: "POST",
    body: input,
  });
}

export function createManualResultTimingObservation(
  registrationId: string,
  input: {
    checkpointId: string;
    recordedAt: string;
    reason: string;
    clientEventId: string;
  },
) {
  return apiRequest<{
    punchEventId: string;
    registrationId: string;
    checkpointId: string;
    recordedAt: string;
    reconciliationState: string;
    replayed: boolean;
  }>({
    path:
      `/v1/organizer/registrations/${encodeURIComponent(registrationId)}`
      + "/result-timing-observations",
    method: "POST",
    body: input,
  });
}

export function revisePunchEvent(
  punchEventId: string,
  input: {
    revisionType: "resolve_registration" | "correct_time" | "void" | "restore";
    reason: string;
    registrationId?: string | null;
    effectiveRecordedAt?: string | null;
    clientEventId: string;
  },
) {
  return apiRequest<{
    revisionId: string;
    punchEventId: string;
    revisionType: string;
    registrationId: string | null;
    bibNumber: string | null;
    effectiveRecordedAt: string;
    isVoided: boolean;
    reconciliationState: string;
    replayed: boolean;
  }>({
    path:
      `/v1/organizer/timing-events/${encodeURIComponent(punchEventId)}`
      + "/revisions",
    method: "POST",
    body: input,
  });
}

export function resolveResultAnomaly(
  anomalyId: string,
  input: {
    resolutionState: "resolved" | "waived";
    resolutionNote: string;
  },
) {
  return apiRequest<{
    id: string;
    state: "resolved" | "waived";
    resolutionNote: string;
    resolvedAt: string;
  }>({
    path:
      `/v1/organizer/result-anomalies/${encodeURIComponent(anomalyId)}`
      + "/resolve",
    method: "POST",
    body: input,
  });
}

export function getFieldAccountingState(eventCategoryId: string) {
  return apiRequest<FieldAccountingState>({
    path:
      `/v1/organizer/categories/${encodeURIComponent(eventCategoryId)}`
      + "/field-accounting",
  });
}

export function recordCutoffAction(
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
) {
  return apiRequest<Record<string, unknown>>({
    path:
      `/v1/organizer/categories/${encodeURIComponent(eventCategoryId)}`
      + "/cutoff-actions",
    method: "POST",
    body: input,
  });
}

export function recordCheckpointOperation(
  checkpointId: string,
  input: {
    operationState: "open" | "ready" | "degraded" | "closing" | "closed" | "reconciled";
    effectiveAt: string;
    reason?: string | null;
    unresolvedPackage?: Record<string, unknown>;
    clientEventId: string;
  },
) {
  return apiRequest<Record<string, unknown>>({
    path:
      `/v1/organizer/checkpoints/${encodeURIComponent(checkpointId)}`
      + "/operations",
    method: "POST",
    body: input,
  });
}

export function signoffFieldAccounting(
  eventCategoryId: string,
  input: {
    allowOpenMissing?: boolean;
    note?: string | null;
    clientEventId: string;
  },
) {
  return apiRequest<Record<string, unknown>>({
    path:
      `/v1/organizer/categories/${encodeURIComponent(eventCategoryId)}`
      + "/field-accounting/signoff",
    method: "POST",
    body: input,
  });
}

export function configurePublicLive(
  eventCategoryId: string,
  input: {
    isEnabled: boolean;
    delaySeconds: number;
    isSuppressed: boolean;
    suppressionMessage?: string | null;
    showCheckpointAggregates: boolean;
  },
) {
  return apiRequest<Record<string, unknown>>({
    path:
      `/v1/organizer/categories/${encodeURIComponent(eventCategoryId)}`
      + "/public-live",
    method: "POST",
    body: input,
  });
}

export function getDnsReview(eventCategoryId: string, reviewId?: string | null) {
  const query = reviewId ? `?review=${encodeURIComponent(reviewId)}` : "";
  return apiRequest<DnsReview | null>({
    path:
      `/v1/organizer/categories/${encodeURIComponent(eventCategoryId)}`
      + `/dns-review${query}`,
  });
}

export function createDnsReview(
  eventCategoryId: string,
  input: {
    note?: string | null;
    clientEventId: string;
  },
) {
  return apiRequest<DnsReview>({
    path:
      `/v1/organizer/categories/${encodeURIComponent(eventCategoryId)}`
      + "/dns-review",
    method: "POST",
    body: input,
  });
}

export function commitDnsReview(reviewId: string) {
  return apiRequest<DnsReview>({
    path:
      `/v1/organizer/dns-reviews/${encodeURIComponent(reviewId)}`
      + "/commit",
    method: "POST",
  });
}
