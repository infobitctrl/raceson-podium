import { createRewardOperatorClient, rewardDocumentUuid as uuid, type RewardAccountIdentity } from "@raceson/db/rewards";
import { rewardDemoTarget, type RewardDemoTarget } from "@raceson/domain/rewards/environment";
import { requireReward } from "@raceson/domain/rewards";
import { drainRewardOperatorQueue, type RewardOperatorRunnerDependencies } from "./operator-runner.js";
import { copyRewardPaymentGasPolicy } from "./athlete-payment-worker.js";

/** Command coordinator, not an HTTP handler. The separate Node entry point
 * supplies explicitly approved demo credentials and bounded chain transport.
 * No account bootstrap, invited-membership activation, signing or new jobs. */
export async function runAuthenticatedRewardOperator(input: {
  target: RewardDemoTarget; programmeId: string; operatorUserId: string; workerId: string;
  maxJobs: number; durationMs: number; accessToken: string; publishableKey: string; serverKey: string;
}, dependencies: Omit<RewardOperatorRunnerDependencies, "rpc" | "chainId" | "origin">,
  clientFactory: typeof createRewardOperatorClient = createRewardOperatorClient) {
  const target = rewardDemoTarget(input.target);
  const programmeId = uuid(input.programmeId); const operatorUserId = uuid(input.operatorUserId); const workerId = uuid(input.workerId);
  const { maxJobs, durationMs, accessToken, publishableKey, serverKey } = input;
  requireReward(target && target.chainId === input.target.chainId && Number.isInteger(maxJobs) && maxJobs >= 1 && maxJobs <= 100
    && Number.isSafeInteger(durationMs) && durationMs >= 1000 && durationMs <= 30 * 60_000, "invalid_reward_operator_command");
  const { reader, creationCode, broadcast, signal: callerSignal } = dependencies;
  const gasPolicy = copyRewardPaymentGasPolicy(dependencies.gasPolicy);
  const controller = new AbortController();
  const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
  let deadlineMs = Date.now() + durationMs;
  let timer = setTimeout(() => controller.abort(), durationMs);
  const startedAt = new Date().toISOString();
  try {
    const client = clientFactory({ target, publishableKey, serverKey, signal });
    const authenticated = await client.authenticate(accessToken, operatorUserId);
    const identity: RewardAccountIdentity = { userId: uuid(authenticated.identity.userId), sessionId: uuid(authenticated.identity.sessionId) };
    requireReward(identity.userId === operatorUserId && Number.isSafeInteger(authenticated.expiresAtMs), "reward_operator_auth_required");
    deadlineMs = Math.min(deadlineMs, authenticated.expiresAtMs - 5000);
    clearTimeout(timer);
    requireReward(!signal.aborted && deadlineMs > Date.now(), "reward_operator_auth_required");
    timer = setTimeout(() => controller.abort(), deadlineMs - Date.now());
    const result = await drainRewardOperatorQueue({ account: { userId: identity.userId } }, identity,
      { programmeId, workerId, maxJobs, deadlineMs }, { reader, creationCode, broadcast, gasPolicy,
        rpc: client.rpc, chainId: target.chainId, origin: target.origin, signal });
    return { schemaVersion: 1, kind: "raceson-reward-operator-session", chainId: target.chainId, startedAt,
      finishedAt: new Date().toISOString(), ...result };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
