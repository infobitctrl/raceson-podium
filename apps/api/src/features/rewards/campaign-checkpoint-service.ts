import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { readRewardCampaignCheckpoint, storeRewardCampaignCheckpoint, rewardDocumentUuid as uuid,
  type RewardLedgerRpc, type RewardStoredCampaignCheckpoint } from "@raceson/db/rewards";
import { readVerifiedRewardCampaign, rewardCampaignBuild, rewardCampaignFundingSummary, type RewardCampaignReader } from "@raceson/rewards-chain";
import { loadVerifiedRewardDeploymentAttempt } from "./deployment-service.js";

/** Private worker orchestration. No signing/broadcast/client creation/HTTP route.
 * An exact key replay returns historical evidence, not a new current-state lease. */
export async function observeVerifiedRewardCampaign(session: RewardOperatorAccount, input: { campaignId: string; intentId: string; attemptId: string; idempotencyKey: string },
  dependencies: { rpc?: RewardLedgerRpc; reader: RewardCampaignReader; creationCode: `0x${string}` }) {
  const actorUserId = uuid(session.account.userId); const campaignId = uuid(input.campaignId); const intentId = uuid(input.intentId); const attemptId = uuid(input.attemptId);
  const idempotencyKey = input.idempotencyKey;
  requireReward(typeof idempotencyKey === "string" && idempotencyKey.length >= 8 && idempotencyKey.length <= 128, "invalid_reward_campaign_checkpoint");
  const { rpc, reader, creationCode } = dependencies;
  // Copy the authenticated actor before any I/O, even if the caller later mutates its session.
  const fixedSession = { ...session, account: { ...session.account, userId: actorUserId } };
  const attempt = await loadVerifiedRewardDeploymentAttempt(fixedSession,{campaignId,intentId,attemptId},rpc);
  const checkStored = (stored: RewardStoredCampaignCheckpoint) => {
    const d = stored.deployment;
    requireReward(stored.intentId === intentId && stored.attemptId === attemptId && d.chainId === attempt.deployment.context.chainId
      && d.contractAddress === attempt.verified.contractAddress && d.deploymentNonce === attempt.nonce
      && d.deploymentTransactionHash === attempt.verified.transactionHash && d.buildId === rewardCampaignBuild.id
      && d.creationCodeHash === rewardCampaignBuild.creationCodeHash, "reward_stored_campaign_checkpoint_mismatch");
    return rewardCampaignFundingSummary(stored.observation.accounting,attempt.deployment.enabledPot,attempt.budgetWei);
  };
  const historical = await readRewardCampaignCheckpoint({campaignId,actorUserId,idempotencyKey},rpc);
  if (historical) return { checkpoint: historical, funding: checkStored(historical), reused: true };
  const observed = await readVerifiedRewardCampaign(reader,{...attempt.deployment,deploymentNonce:attempt.nonce,
    deploymentTransactionHash:attempt.verified.transactionHash},creationCode);
  const saved = await storeRewardCampaignCheckpoint({campaignId,actorUserId,intentId,attemptId,idempotencyKey,...observed},rpc);
  return { checkpoint: saved, funding: checkStored(saved), reused: false };
}
