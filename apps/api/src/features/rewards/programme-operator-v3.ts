import { keccak256, type Hex } from "viem";
import { createProgrammeOperatorClientV3, readProgrammeLifecycleJobV3, rewardDocumentObject as object, rewardDocumentUuid as uuid,
  type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { rewardDemoTarget, type RewardDemoTarget } from "@raceson/domain/rewards/environment";
import { loadVerifiedProgrammeLifecycleV3 } from "./programme-lifecycle-v3-service.js";
import { runProgrammeLifecycleJobV3 } from "./programme-lifecycle-worker-v3.js";

type Job = { slot: number; approvalId: string; uploadId: string; intentId: string; attemptId: string; jobId: string; transactionHash: Hex };
type WorkerDependencies = Parameters<typeof runProgrammeLifecycleJobV3>[2];
type Outcome = Awaited<ReturnType<typeof runProgrammeLifecycleJobV3>>["outcome"];
type Entry = { jobId: string; transactionHash: Hex; outcome: Outcome };
type Stop = "jobs_confirmed" | "deferred" | "attention_required" | "unavailable" | "stopped";
export type ProgrammeOperatorInputV3 = {
  target: RewardDemoTarget; draftId: string; programmeAddress: string; operatorAddress: string;
  operatorUserId: string; workerId: string; durationMs: number; maxGasCostWei: bigint; jobs: unknown;
  accessToken: string; publishableKey: string; serverKey: string;
};
const address = (v: unknown) => {
  requireReward(typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v) !== 0n, "invalid_reward_programme_operator");
  return v;
};
function captureJobs(value: unknown): Job[] {
  requireReward(Array.isArray(value) && value.length >= 1 && value.length <= 100
    && Object.getOwnPropertySymbols(value).length === 0 && Object.getOwnPropertyNames(value).length === value.length + 1,
  "invalid_reward_programme_operator");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const jobs = Array.from({ length: value.length }, (_, index) => {
    const item = descriptors[String(index)];
    requireReward(item && "value" in item, "invalid_reward_programme_operator");
    const raw: unknown = item.value;
    const j = object(raw, ["slot", "approvalId", "uploadId", "intentId", "attemptId", "jobId", "transactionHash"]);
    requireReward(typeof j.slot === "number" && Number.isInteger(j.slot) && j.slot >= 1 && j.slot <= 6
      && typeof j.transactionHash === "string" && /^0x[0-9a-f]{64}$/.test(j.transactionHash) && BigInt(j.transactionHash) !== 0n,
    "invalid_reward_programme_operator");
    return { slot: j.slot, approvalId: uuid(j.approvalId), uploadId: uuid(j.uploadId), intentId: uuid(j.intentId),
      attemptId: uuid(j.attemptId), jobId: uuid(j.jobId), transactionHash: j.transactionHash as Hex };
  });
  for (const key of ["jobId", "intentId", "attemptId", "transactionHash"] as const)
    requireReward(new Set(jobs.map(j => j[key])).size === jobs.length, "invalid_reward_programme_operator");
  return jobs;
}

/** Explicit, bounded V3 delivery session. No V1 ledger, selector, reservation,
 * signer, queue creation, publication-clock inference or recipient payment.
 * The CLI supplies approved source/target and bounded transport. The complete
 * immutable list is checked before any lease; uncertain work stops the pass. */
export async function runAuthenticatedProgrammeOperatorV3(input: ProgrammeOperatorInputV3,
  dependencies: Omit<WorkerDependencies, "rpc"> & { signal?: AbortSignal },
  clientFactory: typeof createProgrammeOperatorClientV3 = createProgrammeOperatorClientV3) {
  const target = rewardDemoTarget(input.target), draftId = uuid(input.draftId), operatorUserId = uuid(input.operatorUserId), workerId = uuid(input.workerId);
  const programmeAddress = address(input.programmeAddress), operatorAddress = address(input.operatorAddress), jobs = captureJobs(input.jobs);
  const { durationMs, maxGasCostWei, accessToken, publishableKey, serverKey } = input;
  requireReward(target && target.chainId === input.target.chainId && Number.isSafeInteger(durationMs) && durationMs >= 1000 && durationMs <= 1800000
    && typeof maxGasCostWei === "bigint" && maxGasCostWei > 0n && maxGasCostWei < 1n << 256n, "invalid_reward_programme_operator");
  const { reader, broadcast, signal: callerSignal } = dependencies;
  const controller = new AbortController(), signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
  let deadlineMs = Date.now() + durationMs, timer = setTimeout(() => controller.abort(), durationMs);
  const startedAt = new Date().toISOString(), entries: Entry[] = [];
  let verifiedGasCeilingWei = 0n;
  const stopped = () => signal.aborted || Date.now() >= deadlineMs;
  const result = (stop: Stop) => ({ schemaVersion: 3, kind: "raceson-programme-operator-session-v3", chainId: target.chainId,
    draftId, programmeAddress, operatorAddress, workerId, startedAt, finishedAt: new Date().toISOString(),
    maxGasCostWei: maxGasCostWei.toString(), verifiedGasCeilingWei: verifiedGasCeilingWei.toString(),
    requestedJobs: jobs.length, stop, entries });
  try {
    requireReward(!stopped(), "reward_operator_auth_required");
    const client = clientFactory({ target, publishableKey, serverKey, signal });
    const authenticated = await client.authenticate(accessToken, operatorUserId);
    const identity: RewardAccountIdentity = { userId: uuid(authenticated.identity.userId), sessionId: uuid(authenticated.identity.sessionId) };
    requireReward(identity.userId === operatorUserId && Number.isSafeInteger(authenticated.expiresAtMs), "reward_operator_auth_required");
    deadlineMs = Math.min(deadlineMs, authenticated.expiresAtMs - 5000);
    clearTimeout(timer);
    requireReward(!stopped(), "reward_operator_auth_required");
    timer = setTimeout(() => controller.abort(), deadlineMs - Date.now());
    const rpc: RewardLedgerRpc = (method, args) => {
      requireReward(!stopped(), "reward_runner_stopped");
      requireReward(args.p_actor_user_id === identity.userId && args.p_actor_session_id === identity.sessionId
        && args.p_chain_id === target.chainId && args.p_draft_id === draftId, "reward_job_attempt_mismatch");
      return client.rpc(method, args);
    };
    const scoped = (job: Job) => ({ ...job, chainId: target.chainId, draftId, workerId });
    let previousNonce = -1n;
    try {
      for (const job of jobs) {
        if (stopped()) return result("stopped");
        const stored = (await readProgrammeLifecycleJobV3(identity, scoped(job), rpc)).job;
        requireReward(stored?.jobId === job.jobId && stored.attemptId === job.attemptId && stored.transactionHash === job.transactionHash,
          "reward_job_attempt_mismatch");
        const attempt = await loadVerifiedProgrammeLifecycleV3(identity, scoped(job), rpc), a = attempt.verified;
        requireReward(a.transactionHash === job.transactionHash && a.operatorAddress.toLowerCase() === operatorAddress
          && attempt.plan.programme.context.verifyingContract.toLowerCase() === programmeAddress && a.nonce > previousNonce,
        "reward_job_attempt_mismatch");
        previousNonce = a.nonce;
        // Worst-case cost of all selected exact attempts, including historical
        // confirmations. This is a conservative authorization cap, not fees paid.
        verifiedGasCeilingWei += a.gasLimit * a.maxFeePerGas;
        requireReward(verifiedGasCeilingWei <= maxGasCostWei, "reward_operator_gas_limit");
      }
    } catch (error) {
      if (stopped()) return result("stopped");
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      return result(code === "reward_job_attempt_mismatch" || code === "reward_operator_gas_limit" ? "attention_required" : "unavailable");
    }
    for (const job of jobs) {
      if (stopped()) return result("stopped");
      let outcome: Outcome;
      try {
        const observed = await runProgrammeLifecycleJobV3(identity, scoped(job), { rpc, reader, broadcast: bytes => {
          // Synchronous final fence: no await between authorization and handoff.
          requireReward(!stopped(), "reward_runner_stopped");
          requireReward(keccak256(bytes) === job.transactionHash, "reward_job_attempt_mismatch");
          return broadcast(bytes);
        } });
        requireReward(observed.jobId === job.jobId, "reward_job_attempt_mismatch");
        outcome = observed.outcome;
      } catch { outcome = "unavailable"; }
      entries.push({ jobId: job.jobId, transactionHash: job.transactionHash, outcome });
      if (stopped()) return result("stopped");
      if (outcome !== "confirmed") return result(outcome === "unavailable" ? "unavailable"
        : outcome === "nonce_conflict" || outcome === "requires_attention" ? "attention_required" : "deferred");
    }
    return result("jobs_confirmed");
  } finally { clearTimeout(timer); controller.abort(); }
}
