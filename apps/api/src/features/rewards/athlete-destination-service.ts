import { requireReward } from "@raceson/domain/rewards";
import { readRewardWalletChallenge,requestRewardAthleteDestination,readRewardAthleteDestination,withdrawRewardAthleteDestination,listRewardAthleteDestinations,
  rewardDocumentUuid as uuid,type RewardAccountIdentity,type RewardLedgerRpc } from "@raceson/db/rewards";
import { verifyRewardWalletControl } from "@raceson/rewards-chain";
import type { RewardPortalConfig } from "./request-identity.js";

function publicRequest(d:Awaited<ReturnType<typeof readRewardAthleteDestination>>){
  return{requestId:d.requestId,athleteProfileId:d.athleteProfileId,address:d.address,chainId:d.chainId,
    requestedAt:d.requestedAt,withdrawnAt:d.withdrawnAt,status:d.status};
}
/** Choice only. Does not clear identity/age/MFA/recovery review, assign a claim
 * nonce, or authorize a transfer. SQL checks ownership and proof freshness again. */
export async function submitAthleteRewardDestination(identity:RewardAccountIdentity,
  input:{challengeId:string;athleteProfileId:string;idempotencyKey:string},deps:RewardPortalConfig & {rpc?:RewardLedgerRpc}){
  const fixed={userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)};
  const {challengeId,athleteProfileId,idempotencyKey}={...input};const {chainId,origin,rpc}=deps;
  const c=await readRewardWalletChallenge(fixed,uuid(challengeId),rpc);
  requireReward(c.chainId===chainId && c.origin===origin,"reward_wallet_context_mismatch");
  requireReward(c.proof!==null,"reward_destination_proof_required");
  const verified=await verifyRewardWalletControl(c,c.proof.signature);
  requireReward(verified.messageHash===c.proof.messageHash,"invalid_reward_destination_document");
  const result=await requestRewardAthleteDestination(fixed,{athleteProfileId:uuid(athleteProfileId),proofId:c.proof.proofId,idempotencyKey},rpc);
  requireReward(result.chainId===chainId && result.address===c.address,"invalid_reward_destination_document");
  return publicRequest(result);
}
export async function getAthleteRewardDestination(identity:RewardAccountIdentity,requestId:string,rpc?:RewardLedgerRpc){
  return publicRequest(await readRewardAthleteDestination(identity,requestId,rpc));
}
export async function getAthleteRewardDestinations(identity:RewardAccountIdentity,afterId:string|null=null,rpc?:RewardLedgerRpc){
  const result=await listRewardAthleteDestinations(identity,afterId,rpc);
  return{items:result.items.map(publicRequest),nextCursor:result.nextCursor};
}
export async function withdrawAthleteRewardDestination(identity:RewardAccountIdentity,requestId:string,rpc?:RewardLedgerRpc){
  return publicRequest(await withdrawRewardAthleteDestination(identity,requestId,rpc));
}
