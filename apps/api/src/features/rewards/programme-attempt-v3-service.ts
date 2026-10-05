import { readProgrammeAttemptV3, storeProgrammeAttemptV3, rewardDocumentUuid as uuid,
  type ProgrammeAttemptScopeV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson, verifySignedProgrammeDeploymentV3 } from "@raceson/rewards-chain";
import type { Hex } from "viem";
import { programmeDeploymentPlanV3 } from "./programme-deployment-v3-service.js";

function capture(identity: RewardAccountIdentity, input: ProgrammeAttemptScopeV3) {
  return { actor: { userId: uuid(identity.userId), sessionId: uuid(identity.sessionId) },
    scope: { chainId: input.chainId, draftId: uuid(input.draftId), intentId: uuid(input.intentId) } };
}
function storageBody(body: Awaited<ReturnType<typeof verifySignedProgrammeDeploymentV3>>) {
  return { ...body, operatorAddress: body.operatorAddress.toLowerCase(), contractAddress: body.contractAddress.toLowerCase() };
}

/** Private operator entry, not an HTTP route or send authorization. New writes
 * need the exact current approval; uncertain retries preserve the original bytes. */
export async function recordSignedProgrammeDeploymentV3(identity: RewardAccountIdentity,
  input: ProgrammeAttemptScopeV3 & { attemptId: string; signedTransaction: Hex }, rpc?: RewardLedgerRpc) {
  const { actor, scope } = capture(identity, input), attemptId = uuid(input.attemptId), signedTransaction = input.signedTransaction;
  const stored = await readProgrammeAttemptV3(actor, scope, rpc), intent = stored.context.intent;
  requireReward(intent, "reward_programme_deployment_required");
  requireReward(stored.attempt !== null || intent.current, "reward_programme_approval_required");
  const verified = await verifySignedProgrammeDeploymentV3(programmeDeploymentPlanV3(stored.context), signedTransaction, intent.maximumGasCostWei);
  const body = storageBody(verified);
  if (stored.attempt) requireReward(stored.attempt.id === attemptId
    && canonicalRewardJson(stored.attempt.body) === canonicalRewardJson(body), "reward_programme_attempt_conflict");
  // SQL locks the shared signer and draft, rechecks current source/Auth and
  // rolls back a new attempt if either changes while waiting or inserting.
  return storeProgrammeAttemptV3(actor, { ...scope, attemptId, body }, rpc);
}

/** Private recovery only. Recompute signature, constructor and EVERY witness
 * field from the exact stored bytes. A historical attempt is not a send lease. */
export async function loadVerifiedProgrammeAttemptV3(identity: RewardAccountIdentity,
  input: ProgrammeAttemptScopeV3 & { attemptId: string }, rpc?: RewardLedgerRpc) {
  const { actor, scope } = capture(identity, input), attemptId = uuid(input.attemptId);
  const stored = await readProgrammeAttemptV3(actor, scope, rpc), intent = stored.context.intent;
  requireReward(intent && stored.attempt?.id === attemptId, "reward_programme_attempt_required");
  const plan = programmeDeploymentPlanV3(stored.context);
  const verified = await verifySignedProgrammeDeploymentV3(plan, stored.attempt.body.signedTransaction, intent.maximumGasCostWei);
  requireReward(canonicalRewardJson(storageBody(verified)) === canonicalRewardJson(stored.attempt.body), "reward_programme_attempt_mismatch");
  // Signature recovery is async: recheck live access and approval after it,
  // including on the historical path. An execution worker must still arm fresh.
  const fresh = await readProgrammeAttemptV3(actor, scope, rpc);
  requireReward(fresh.attempt?.id === attemptId && canonicalRewardJson(fresh.attempt.body) === canonicalRewardJson(stored.attempt.body)
    && canonicalRewardJson(programmeDeploymentPlanV3(fresh.context)) === canonicalRewardJson(plan), "reward_programme_attempt_mismatch");
  return { status: fresh.context.intent!.current ? "current" as const : "held" as const,
    intentId: scope.intentId, attemptId, plan, verified };
}
