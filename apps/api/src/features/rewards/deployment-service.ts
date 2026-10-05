import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { readRewardDeploymentContext, readRewardDeploymentAttempt, reserveRewardDeploymentIntent, storeRewardDeploymentAttempt,
  rewardDocumentUuid as uuid, type RewardDeploymentContext, type RewardLedgerRpc } from "@raceson/db/rewards";
import { canonicalRewardJson, readRewardPendingNonce, rewardCampaignBuild, rewardDeploymentSpecFromPlan, verifySignedRewardDeployment,
  type RewardDeploymentPlan, type RewardNonceReader } from "@raceson/rewards-chain";

function plan(context: RewardDeploymentContext): RewardDeploymentPlan {
  requireReward(context.intent && context.intent.buildId === rewardCampaignBuild.id
    && context.intent.creationCodeHash === rewardCampaignBuild.creationCodeHash, "reward_deployment_build_mismatch");
  return { network: { environment: context.environment === "local_simulation" ? "local-simulation" : "monad-testnet", chainId: context.chainId },
    nonce: context.intent.nonce, operatorAddress: context.operatorAddress, treasuryAddress: context.treasuryAddress,
    programmeId: context.programmeOnChainId, campaignId: context.campaignOnChainId, programmeManifestHash: context.manifestHash, enabledPot: context.pot === "race" ? 0 : 1 };
}
function key(value: unknown): string { requireReward(typeof value === "string" && value.length >= 8 && value.length <= 128, "invalid_reward_deployment_request"); return value; }

/** Private operator service, not an authenticated HTTP route. Reserves only a
 * deployment nonce/plan; signing, broadcasting, funding and finality are separate. */
export async function prepareRewardDeployment(session: RewardOperatorAccount, input: { campaignId: string; idempotencyKey: string },
  dependencies: { rpc?: RewardLedgerRpc; reader: RewardNonceReader }) {
  const actorUserId = uuid(session.account.userId); const campaignId = uuid(input.campaignId); const idempotencyKey = key(input.idempotencyKey);
  const { rpc, reader } = dependencies;
  let context = await readRewardDeploymentContext({ campaignId, actorUserId }, rpc);
  if (context.intent) requireReward(context.intent.idempotencyKey === idempotencyKey, "reward_deployment_already_planned");
  else {
    const network = { environment: context.environment === "local_simulation" ? "local-simulation" as const : "monad-testnet" as const, chainId: context.chainId };
    const pendingNonce = await readRewardPendingNonce(reader, network, context.operatorAddress);
    const reserved = await reserveRewardDeploymentIntent({ campaignId, actorUserId, idempotencyKey, observedChainId: context.chainId, pendingNonce }, rpc);
    requireReward(canonicalRewardJson({ ...reserved, intent: null }) === canonicalRewardJson({ ...context, intent: null }), "reward_deployment_context_changed");
    context = reserved;
  }
  const fixedPlan = plan(context); requireReward(context.intent, "reward_deployment_intent_mismatch");
  return { programmeId: context.programmeId, campaignId, intentId: context.intent.id, createdAt: context.intent.createdAt,
    buildId: rewardCampaignBuild.id, creationCodeHash: rewardCampaignBuild.creationCodeHash, nonce: fixedPlan.nonce,
    deployment: rewardDeploymentSpecFromPlan(fixedPlan) };
}

export async function recordSignedRewardDeployment(session: RewardOperatorAccount, input: { campaignId: string; intentId: string;
  idempotencyKey: string; signedTransaction: `0x${string}` }, rpc?: RewardLedgerRpc) {
  const actorUserId = uuid(session.account.userId); const campaignId = uuid(input.campaignId); const intentId = uuid(input.intentId);
  const idempotencyKey = key(input.idempotencyKey); const signedTransaction = input.signedTransaction;
  const context = await readRewardDeploymentContext({ campaignId, actorUserId, intentId }, rpc);
  const attempt = await verifySignedRewardDeployment(plan(context), signedTransaction);
  // SQL rechecks current operator authority after acquiring its programme lock.
  // Only the exact signed attempt may later broadcast. This call never sends it.
  return storeRewardDeploymentAttempt({ campaignId, actorUserId, intentId, idempotencyKey, attempt }, rpc);
}

/** Private worker read: cryptographically re-derive the stored witness, not trust
 * signed bytes or hashes solely because they came from a database row. */
export async function loadVerifiedRewardDeploymentAttempt(session: RewardOperatorAccount, input: { campaignId: string; intentId: string; attemptId: string }, rpc?: RewardLedgerRpc) {
  const actorUserId = uuid(session.account.userId); const campaignId = uuid(input.campaignId); const intentId = uuid(input.intentId); const attemptId = uuid(input.attemptId);
  const stored = await readRewardDeploymentAttempt({ actorUserId, campaignId, intentId, attemptId }, rpc);
  const fixedPlan = plan(stored.context);
  const verified = await verifySignedRewardDeployment(fixedPlan, stored.attempt.body.signedTransaction);
  requireReward(canonicalRewardJson(verified) === canonicalRewardJson(stored.attempt.body), "reward_stored_deployment_attempt_mismatch");
  return { campaignId, intentId, attemptId, deployment: rewardDeploymentSpecFromPlan(fixedPlan), nonce: fixedPlan.nonce,
    budgetWei: stored.context.budgetWei, verified };
}
