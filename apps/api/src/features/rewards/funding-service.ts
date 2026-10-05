import { randomUUID } from "node:crypto";
import type { RewardOperatorAccount } from "./operator-account.js";
import { requireReward } from "@raceson/domain/rewards";
import { readRewardFundingContext, reserveRewardFundingIntent, readRewardFundingAttempt, storeRewardFundingAttempt, rewardDocumentUuid as uuid,
  type RewardFundingContext, type RewardLedgerRpc } from "@raceson/db/rewards";
import { canonicalRewardJson, normalizeRewardFundingPlan, readRewardPendingNonce, rewardCampaignBuild, verifySignedRewardFunding,
  type RewardCampaignReader, type RewardNonceReader } from "@raceson/rewards-chain";
import { observeVerifiedRewardCampaign } from "./campaign-checkpoint-service.js";

const key = (value:unknown) => { requireReward(typeof value === "string" && value.length >= 8 && value.length <= 128,"invalid_reward_funding_request"); return value; };
function plan(context:RewardFundingContext) {
  const d=context.deploymentContext; const c=context.checkpoint; const i=context.intent;
  requireReward(c && i && d.intent && d.intent.buildId === rewardCampaignBuild.id && d.intent.creationCodeHash === rewardCampaignBuild.creationCodeHash,
    "reward_funding_deployment_not_verified");
  return normalizeRewardFundingPlan({deployment:{context:{environment:d.environment === "local_simulation" ? "local-simulation" : "monad-testnet",
    chainId:d.chainId,verifyingContract:c.deployment.contractAddress},operatorAddress:d.operatorAddress,treasuryAddress:d.treasuryAddress,
    programmeId:d.programmeOnChainId,campaignId:d.campaignOnChainId,programmeManifestHash:d.manifestHash,enabledPot:d.pot === "race" ? 0 : 1,
    deploymentTransactionHash:c.deployment.deploymentTransactionHash,deploymentNonce:c.deployment.deploymentNonce},
    nonce:i.nonce,expectedAccountedFunding:i.expectedAccountedFunding,expectedBudget:i.expectedBudget});
}

/** Private preparation, not authenticated HTTP or permission to spend. A new
 * intent gets a fresh verified checkpoint, then an atomic global nonce reservation.
 * Exact replay returns the original plan without pretending its pre-state is fresh. */
export async function prepareRewardFunding(session:RewardOperatorAccount,input:{campaignId:string;idempotencyKey:string},
  dependencies:{rpc?:RewardLedgerRpc;reader:RewardCampaignReader & RewardNonceReader;creationCode:`0x${string}`}) {
  const actorUserId=uuid(session.account.userId); const campaignId=uuid(input.campaignId); const idempotencyKey=key(input.idempotencyKey);
  const {rpc,reader,creationCode}=dependencies; const fixedSession={...session,account:{...session.account,userId:actorUserId}};
  let context=await readRewardFundingContext({campaignId,actorUserId},rpc);
  let reused=context.intent!==null;
  if(context.intent) requireReward(context.intent.idempotencyKey===idempotencyKey,"reward_funding_already_planned");
  else {
    requireReward(context.checkpoint && context.deploymentContext.intent,"reward_funding_deployment_not_verified");
    const fresh=await observeVerifiedRewardCampaign(fixedSession,{campaignId,intentId:context.checkpoint.intentId,attemptId:context.checkpoint.attemptId,
      idempotencyKey:`funding-prepare:${randomUUID()}`},{rpc,reader,creationCode});
    requireReward(fresh.checkpoint.observation.accounting.state===0 && fresh.funding.excess===0n,"reward_campaign_not_fundable");
    const d=context.deploymentContext;
    const pendingNonce=await readRewardPendingNonce(reader,{environment:d.environment === "local_simulation" ? "local-simulation" : "monad-testnet",chainId:d.chainId},d.operatorAddress);
    context=await reserveRewardFundingIntent({campaignId,actorUserId,idempotencyKey,observationId:fresh.checkpoint.observationId,observedChainId:d.chainId,pendingNonce},rpc);
    reused=context.intent?.observationId!==fresh.checkpoint.observationId;
  }
  requireReward(context.intent,"reward_funding_intent_mismatch");
  return {campaignId,intentId:context.intent.id,observationId:context.intent.observationId,plan:plan(context),reused};
}

export async function recordSignedRewardFunding(session:RewardOperatorAccount,input:{campaignId:string;intentId:string;idempotencyKey:string;signedTransaction:`0x${string}`},rpc?:RewardLedgerRpc) {
  const actorUserId=uuid(session.account.userId); const campaignId=uuid(input.campaignId); const intentId=uuid(input.intentId);
  const idempotencyKey=key(input.idempotencyKey); const signedTransaction=input.signedTransaction;
  const context=await readRewardFundingContext({campaignId,actorUserId,intentId},rpc);
  const verified=await verifySignedRewardFunding(plan(context),signedTransaction);
  return storeRewardFundingAttempt({campaignId,actorUserId,intentId,idempotencyKey,attempt:verified},rpc);
}

/** Private worker read revalidates the complete stored signed witness. It does
 * not check current pre-state or lease authority and must never imply safe send. */
export async function loadVerifiedRewardFundingAttempt(session:RewardOperatorAccount,input:{campaignId:string;intentId:string;attemptId:string},rpc?:RewardLedgerRpc) {
  const actorUserId=uuid(session.account.userId); const campaignId=uuid(input.campaignId); const intentId=uuid(input.intentId); const attemptId=uuid(input.attemptId);
  const loaded=await readRewardFundingAttempt({campaignId,actorUserId,intentId,attemptId},rpc); const checkedPlan=plan(loaded.context);
  const verified=await verifySignedRewardFunding(checkedPlan,loaded.attempt.body.signedTransaction);
  requireReward(canonicalRewardJson(verified)===canonicalRewardJson(loaded.attempt.body),"reward_stored_funding_attempt_mismatch");
  return {campaignId,intentId,attemptId,plan:checkedPlan,verified};
}
