import type { RewardAccountIdentity } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { createWorkflowRuntimeV3, type WorkflowRuntimeOptionsV3 } from "./workflow-v3-service.js";
import { WorkflowScheduleStoreV3, runWorkflowSchedulerPassV3, startWorkflowSchedulerV3 } from "./workflow-v3-scheduler.js";

const readMethods = new Set([
  "service_read_reward_programme_lifecycle_v3", "service_read_reward_programme_lifecycle_job_v3",
  "service_read_reward_athlete_payment_v3", "service_read_reward_club_payment_v3",
  "service_read_reward_claim_v3", "service_read_reward_club_claim_v3",
]);
const denied = (): never => { throw Error("reward_workflow_authority_required"); };

/** A connected status/inspection host is NOT a signing or execution grant.
 * Authenticated routes supply the actor; each allowlisted SQL read rechecks the
 * current account/session and exact organizer scope. No key loader, write RPC,
 * queue creation or broadcast dependency is accepted by this composition. */
export function createReadOnlyWorkflowHostV3(options: Pick<WorkflowRuntimeOptionsV3, "target" | "rpc" | "reader">
  & { store: WorkflowScheduleStoreV3; assertActive: () => void }) {
  const { target, rpc, reader, store, assertActive } = options;
  const runtime = createWorkflowRuntimeV3({ target, reader,
    rpc: (method, args) => {
      assertActive();
      requireReward(readMethods.has(method) && args.p_chain_id === target.chainId, "reward_workflow_authority_required");
      return rpc(method, args);
    },
    authorize: async (_actor, operation) => {
      assertActive();
      requireReward(["inspect", "inspect-approval", "status"].includes(operation), "reward_workflow_authority_required");
      return { expiresAtMs: Date.now() + 60_000, assertActive };
    },
    loadSigner: denied, loadApprovalSigner: denied, broadcast: denied,
  });
  return { runtime, store };
}

/** Private host lifecycle, not a credential/provisioning API. The required
 * authorize callback remains responsible for fresh source/target/spending and
 * live-session validation on EVERY operation, including worker delivery.
 * Only session references are retained in memory; never tokens/keys on disk.
 * Constructing a controller does not start a worker or touch chain/credentials. */
export function createWorkflowHostControllerV3(options: WorkflowRuntimeOptionsV3 & {
  directory: string; durationMs: number; signal: AbortSignal;
}) {
  const { durationMs, signal: callerSignal, directory, authorize, ...dependencies } = options;
  requireReward(Number.isSafeInteger(durationMs) && durationMs >= 1000 && durationMs <= 1_800_000
    && !callerSignal.aborted, "reward_workflow_authority_required");
  const expiresAtMs = Date.now() + durationMs;
  const controller = new AbortController();
  const signal = AbortSignal.any([callerSignal, controller.signal]);
  const sessions = new Map<string, { actor: RewardAccountIdentity; expiresAtMs: number }>();
  let stopWorker: (() => void) | undefined;
  let passRunning = false;
  const active = () => requireReward(!signal.aborted && Date.now() < expiresAtMs, "reward_workflow_authority_required");
  const runtime = createWorkflowRuntimeV3({ ...dependencies,
    rpc: (method, args) => { active(); return dependencies.rpc(method, args); },
    authorize: async (actor, operation, target, binding) => {
      active();
      const grant = await authorize(actor, operation, target, binding);
      active();
      requireReward(Number.isSafeInteger(grant.expiresAtMs) && grant.expiresAtMs > Date.now()
        && grant.expiresAtMs <= Date.now() + 1_800_000, "reward_workflow_authority_required");
      grant.assertActive();
      const deadline = Math.min(expiresAtMs, grant.expiresAtMs);
      // A verified request can reconnect a restarted worker. This reference is
      // only a lookup hint: delivery calls authorize again, never trusts a UUID.
      sessions.set(actor.userId, { actor: { ...actor }, expiresAtMs: deadline });
      return { expiresAtMs: deadline, assertActive: () => { active(); grant.assertActive(); } };
    },
  });
  const store = new WorkflowScheduleStoreV3(directory);
  const resolveActor = async (userId: string) => {
    active();
    const saved = sessions.get(userId);
    if (!saved || saved.expiresAtMs <= Date.now()) {
      sessions.delete(userId); throw Error("reward_account_session_required");
    }
    return { ...saved.actor };
  };
  const close = () => {
    controller.abort(); stopWorker?.(); stopWorker = undefined; sessions.clear();
    clearTimeout(expiry); callerSignal.removeEventListener("abort", close);
  };
  const expiry = setTimeout(close, durationMs); expiry.unref();
  callerSignal.addEventListener("abort", close, { once: true });
  // Defend against abort during synchronous host construction.
  if (callerSignal.aborted) close();
  return {
    host: { runtime, store },
    state: () => ({ configured: !signal.aborted && Date.now() < expiresAtMs,
      workerRunning: Boolean(stopWorker) && !signal.aborted, expiresAtMs }),
    start: (intervalMs = 5000) => {
      active(); requireReward(!passRunning, "reward_workflow_worker_busy");
      if (!stopWorker) stopWorker = startWorkflowSchedulerV3(store, runtime, resolveActor, { signal, intervalMs });
    },
    pass: async (maxJobs = 20) => {
      active(); requireReward(!stopWorker && !passRunning, "reward_workflow_worker_busy");
      passRunning = true;
      try { return await runWorkflowSchedulerPassV3(store, runtime, resolveActor, { signal, maxJobs }); }
      finally { passRunning = false; }
    },
    close,
  };
}
