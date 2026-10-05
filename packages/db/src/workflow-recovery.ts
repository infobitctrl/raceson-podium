import { randomUUID } from "node:crypto";
import { loadServerEnv, type ServerEnv } from "./env.js";
import { computeFinishedCategoryResultsForWorkflow } from "./race-ops.js";
import { createAdminSupabaseClient } from "./supabase.js";

export const RECOVERABLE_WORKFLOW_HANDLERS = [
  "result.run.compute",
  "league.publication.propagate",
  "league.standings.compute",
] as const;

export type RecoverableWorkflowHandler = typeof RECOVERABLE_WORKFLOW_HANDLERS[number];

export type ClaimedWorkflowJob = {
  jobId: string;
  handlerKey: RecoverableWorkflowHandler;
  handlerVersion: number;
  domainEventId: string;
  organizationId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorUserId: string | null;
  eventOccurredAt: string;
  attemptCount: number;
  maxAttempts: number;
  result: Record<string, unknown>;
};

export type WorkflowRecoverySummary = {
  workerId: string;
  claimed: number;
  succeeded: number;
  retryScheduled: number;
  deadLettered: number;
  terminalSkipped: number;
  limitReached: boolean;
};

type WorkflowFailureState = "retry_wait" | "dead_letter" | string;

export type WorkflowRecoveryDependencies = {
  claim: (workerId: string, limit: number) => Promise<ClaimedWorkflowJob[]>;
  process: (job: ClaimedWorkflowJob) => Promise<void>;
  fail: (
    job: ClaimedWorkflowJob,
    workerId: string,
    errorCode: string,
  ) => Promise<WorkflowFailureState>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecoverableHandler(value: unknown): value is RecoverableWorkflowHandler {
  return typeof value === "string"
    && RECOVERABLE_WORKFLOW_HANDLERS.some((handler) => handler === value);
}

function parseClaimedWorkflowJob(value: unknown): ClaimedWorkflowJob {
  if (!isRecord(value)
      || typeof value.jobId !== "string"
      || !isRecoverableHandler(value.handlerKey)
      || typeof value.handlerVersion !== "number"
      || typeof value.domainEventId !== "string"
      || !(typeof value.organizationId === "string" || value.organizationId === null)
      || typeof value.eventType !== "string"
      || typeof value.aggregateType !== "string"
      || typeof value.aggregateId !== "string"
      || !(typeof value.actorUserId === "string" || value.actorUserId === null)
      || typeof value.eventOccurredAt !== "string"
      || typeof value.attemptCount !== "number"
      || typeof value.maxAttempts !== "number"
      || !isRecord(value.result)) {
    throw new Error("workflow_claim_response_invalid");
  }

  return value as ClaimedWorkflowJob;
}

function errorCodeForHandler(handlerKey: RecoverableWorkflowHandler) {
  switch (handlerKey) {
    case "result.run.compute":
      return "result_compute_failed";
    case "league.publication.propagate":
      return "league_publication_propagation_failed";
    case "league.standings.compute":
      return "league_standings_compute_failed";
  }
}

export async function runWorkflowRecovery(
  input: { limit: number; workerId?: string },
  dependencies: WorkflowRecoveryDependencies,
): Promise<WorkflowRecoverySummary> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25) {
    throw new Error("workflow_recovery_limit_invalid");
  }

  const workerId = input.workerId ?? randomUUID();
  const summary: WorkflowRecoverySummary = {
    workerId,
    claimed: 0,
    succeeded: 0,
    retryScheduled: 0,
    deadLettered: 0,
    terminalSkipped: 0,
    limitReached: false,
  };

  while (summary.claimed < input.limit) {
    const batchLimit = Math.min(5, input.limit - summary.claimed);
    const jobs = await dependencies.claim(workerId, batchLimit);
    if (!jobs.length) break;

    for (const job of jobs) {
      summary.claimed += 1;
      try {
        await dependencies.process(job);
        summary.succeeded += 1;
      } catch {
        const failureState = await dependencies.fail(
          job,
          workerId,
          errorCodeForHandler(job.handlerKey),
        );
        if (failureState === "succeeded") summary.succeeded += 1;
        else if (failureState === "dead_letter") summary.deadLettered += 1;
        else if (failureState === "cancelled") summary.terminalSkipped += 1;
        else if (failureState === "queued" || failureState === "retry_wait") {
          summary.retryScheduled += 1;
        } else {
          throw new Error("workflow_failure_state_invalid");
        }
      }
    }
  }

  summary.limitReached = summary.claimed === input.limit;
  return summary;
}

export async function dispatchPendingWorkflowJobs(
  input: { limit: number },
  env: ServerEnv = loadServerEnv(),
) {
  const adminClient = createAdminSupabaseClient(env);

  const summary = await runWorkflowRecovery(input, {
    async claim(workerId, limit) {
      const { data, error } = await adminClient.rpc("service_claim_workflow_jobs", {
        p_handler_keys: [...RECOVERABLE_WORKFLOW_HANDLERS],
        p_limit: limit,
        p_lease_owner: workerId,
        p_lease_seconds: 600,
      });
      if (error) throw error;
      if (!isRecord(data) || !Array.isArray(data.jobs)) {
        throw new Error("workflow_claim_response_invalid");
      }
      return data.jobs.map(parseClaimedWorkflowJob);
    },

    async process(job) {
      if (job.handlerKey === "result.run.compute") {
        if (job.handlerVersion !== 1
            || job.eventType !== "race.category.completed"
            || job.aggregateType !== "event_category") {
          throw new Error("result_compute_job_invalid");
        }

        const snapshot = await computeFinishedCategoryResultsForWorkflow(
          job.aggregateId,
          job.jobId,
          env,
        );
        const resultRunId = snapshot.selectedRun?.id ?? null;
        if (!resultRunId) throw new Error("result_run_not_created");

        const { error } = await adminClient.rpc("service_complete_workflow_job", {
          p_workflow_job_id: job.jobId,
          p_handler_key: job.handlerKey,
          p_result_json: { resultRunId },
        });
        if (error) throw error;
        return;
      }

      if (!job.actorUserId) throw new Error("workflow_actor_missing");

      if (job.handlerKey === "league.publication.propagate") {
        if (job.handlerVersion !== 1
            || job.eventType !== "result.publication.committed"
            || job.aggregateType !== "result_publication") {
          throw new Error("league_publication_job_invalid");
        }
        const { error } = await adminClient.rpc(
          "service_process_result_publication_leagues",
          {
            p_workflow_job_id: job.jobId,
            p_actor_user_id: job.actorUserId,
          },
        );
        if (error) throw error;
        return;
      }

      if (job.handlerVersion !== 1
          || job.eventType !== "league.standings.compute.requested"
          || job.aggregateType !== "league_season") {
        throw new Error("league_standings_job_invalid");
      }
      const { error } = await adminClient.rpc("service_process_league_standings_job", {
        p_workflow_job_id: job.jobId,
        p_actor_user_id: job.actorUserId,
      });
      if (error) throw error;
    },

    async fail(job, workerId, errorCode) {
      const { data, error } = await adminClient.rpc(
        "service_record_claimed_workflow_job_failure",
        {
          p_workflow_job_id: job.jobId,
          p_lease_owner: workerId,
          p_error_code: errorCode,
        },
      );
      if (error) throw error;
      if (!isRecord(data) || typeof data.state !== "string") {
        throw new Error("workflow_failure_response_invalid");
      }
      return data.state;
    },
  });

  const { data: queueHealth, error: queueHealthError } = await adminClient.rpc(
    "service_workflow_queue_health",
  );
  if (queueHealthError) throw queueHealthError;
  if (!isRecord(queueHealth)) throw new Error("workflow_queue_health_response_invalid");

  return {
    ...summary,
    queueHealth,
  };
}
