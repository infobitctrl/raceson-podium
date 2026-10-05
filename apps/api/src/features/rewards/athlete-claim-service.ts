import { requireReward } from "@raceson/domain/rewards";
import { readRewardAthleteClaimContext,storeRewardAthleteClaimIntent,rewardDocumentUuid as uuid,
  type RewardAccountIdentity,type RewardAthleteClaimContext,type RewardLedgerRpc } from "@raceson/db/rewards";
import { normalizeRewardAthleteClaimExpectation,readVerifiedRewardAthleteClaim,rewardClaimMessages,rewardClaimDigests,
  verifyRewardWalletControl,rewardCampaignBuild,type RewardCampaignReader,type RewardClaim } from "@raceson/rewards-chain";
import type { RewardPortalConfig } from "./request-identity.js";

export function athleteRewardClaimExpectation(context:RewardAthleteClaimContext){
  const l=context.lifecycleContext;const d=l.deploymentContext;const c=l.checkpoint;
  requireReward(c && d.intent && d.intent.buildId===rewardCampaignBuild.id && d.intent.creationCodeHash===rewardCampaignBuild.creationCodeHash,
    "reward_claim_campaign_not_ready");
  return normalizeRewardAthleteClaimExpectation({deployment:{context:{environment:d.environment==="local_simulation"?"local-simulation":"monad-testnet",
    chainId:d.chainId,verifyingContract:c.deployment.contractAddress},operatorAddress:d.operatorAddress,treasuryAddress:d.treasuryAddress,
    programmeId:d.programmeOnChainId,campaignId:d.campaignOnChainId,programmeManifestHash:d.manifestHash,enabledPot:l.upload.body.enabledPot,
    deploymentTransactionHash:c.deployment.deploymentTransactionHash,deploymentNonce:c.deployment.deploymentNonce},
    upload:l.upload.body,entitlementId:context.entitlement.onChainId,recipient:context.reviewContext.destination.address});
}
export function preparedAthleteRewardClaim(context:RewardAthleteClaimContext){
  const e=athleteRewardClaimExpectation(context);const i=context.intent;requireReward(i,"reward_claim_intent_required");
  const claim:RewardClaim={entitlementId:e.entitlementId,recipient:e.recipient,amount:e.award.amount,pot:e.award.pot===0?"race":"league",
    nonce:i.nonce,issuedAt:i.issuedAt,expiresAt:i.expiresAt,allocationDigest:e.upload.allocationDigest};
  return{intentId:i.intentId,context:e.deployment.context,claim,messages:rewardClaimMessages(e.deployment.context,claim),digests:rewardClaimDigests(e.deployment.context,claim)};
}

/** Operator-private preparation. Uses stored exact award/review and fresh chain
 * evidence, then locked SQL revalidation. No signer, recipient consent, payment
 * job, RPC endpoint creation or HTTP route. Retry returns historical messages. */
export async function prepareAthleteRewardClaim(identity:RewardAccountIdentity,input:{reviewId:string;entitlementId:string;idempotencyKey:string},
  deps:RewardPortalConfig&{rpc?:RewardLedgerRpc;reader:RewardCampaignReader;creationCode:`0x${string}`}){
  const fixed={userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)};
  const request={reviewId:uuid(input.reviewId),entitlementId:uuid(input.entitlementId),idempotencyKey:input.idempotencyKey};
  requireReward(typeof request.idempotencyKey==="string"&&request.idempotencyKey.length>=8&&request.idempotencyKey.length<=128,"invalid_reward_claim_request");
  const {rpc,reader,creationCode,chainId,origin}=deps;let context=await readRewardAthleteClaimContext(fixed,request,rpc);
  const review=context.reviewContext;
  requireReward(review.chainId===chainId && review.challenge.origin===origin,"reward_wallet_context_mismatch");
  requireReward(review.challenge.proof,"reward_destination_proof_required");
  const proof=await verifyRewardWalletControl(review.challenge,review.challenge.proof.signature);
  requireReward(proof.messageHash===review.challenge.proof.messageHash,"invalid_reward_claim_document");
  if(context.intent)return preparedAthleteRewardClaim(context);
  requireReward(review.reviewState==="reviewed" && review.latestReview?.reviewId===request.reviewId,"reward_claim_readiness_required");
  const expected=athleteRewardClaimExpectation(context);
  const witness=await readVerifiedRewardAthleteClaim(reader,expected,creationCode);
  const observedAt=new Date().toISOString();
  context=await storeRewardAthleteClaimIntent(fixed,{...request,witness,observedAt},rpc);
  return preparedAthleteRewardClaim(context);
}
