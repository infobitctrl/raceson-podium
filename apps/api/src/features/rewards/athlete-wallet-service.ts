import { getAddress,type Hex } from "viem";
import { requireReward } from "@raceson/domain/rewards";
import { isRewardWalletOrigin } from "@raceson/domain/rewards/environment";
import { createRewardWalletChallenge,readRewardWalletChallenge,confirmRewardWalletProof,readOwnRewardAwards,
  rewardDocumentUuid as uuid,type RewardAccountIdentity,type RewardLedgerRpc } from "@raceson/db/rewards";
import { rewardWalletControlMessage,verifyRewardWalletControl } from "@raceson/rewards-chain";

const fixedIdentity=(identity:RewardAccountIdentity)=>({userId:uuid(identity.userId),sessionId:uuid(identity.sessionId)});
/** Private service. Caller must verify login claims/issuer/session first; never
 * construct identity from request JSON. Origin/network come from server config. */
export async function prepareAthleteWalletProof(identity:RewardAccountIdentity,input:{address:string;idempotencyKey:string},
  dependencies:{chainId:10143|31337;origin:string;rpc?:RewardLedgerRpc}){
  const fixed=fixedIdentity(identity);const idempotencyKey=input.idempotencyKey;
  requireReward(typeof input.address==="string" && /^0x[0-9a-fA-F]{40}$/.test(input.address) && BigInt(input.address)!==0n,"invalid_reward_wallet_request");
  const address=getAddress(input.address).toLowerCase();const {chainId,origin,rpc}=dependencies;
  requireReward(isRewardWalletOrigin(origin,chainId),"invalid_reward_wallet_origin");
  const challenge=await createRewardWalletChallenge(fixed,{address,chainId,origin,idempotencyKey},rpc);
  const message=rewardWalletControlMessage(challenge);
  // Deliberately omit user/session IDs, private proof/signature and stored nonce
  // metadata outside the message. No wallet secret or payment is involved.
  return{challengeId:challenge.challengeId,address:challenge.address,chainId:challenge.chainId,message,
    expiresAt:challenge.expiresAt,alreadyVerified:challenge.proof!==null};
}
export async function verifyAthleteWalletProof(identity:RewardAccountIdentity,input:{challengeId:string;signature:Hex},
  dependencies:{chainId:10143|31337;origin:string;rpc?:RewardLedgerRpc}){
  const fixed=fixedIdentity(identity);const challengeId=uuid(input.challengeId);const signature=input.signature;
  const {chainId,origin,rpc}=dependencies;
  const challenge=await readRewardWalletChallenge(fixed,challengeId,rpc);
  requireReward(challenge.chainId===chainId && challenge.origin===origin,"reward_wallet_context_mismatch");
  if(!challenge.proof)requireReward(Date.parse(challenge.checkedAt)>=Date.parse(challenge.issuedAt) && Date.parse(challenge.checkedAt)<Date.parse(challenge.expiresAt),"reward_wallet_challenge_expired");
  const verified=await verifyRewardWalletControl(challenge,signature);
  const saved=await confirmRewardWalletProof(fixed,{challengeId,...verified},rpc);
  requireReward(saved.proof && saved.address===challenge.address && saved.chainId===challenge.chainId,"invalid_reward_wallet_document");
  return{proofId:saved.proof.proofId,address:saved.address,chainId:saved.chainId,verifiedAt:saved.proof.verifiedAt,
    proofKind:"eip191_address_control" as const};
}
/** Own allocations, not balances/payability. Existing profile ownership is
 * resolved fresh in SQL; readiness never rewrites sporting shares. */
export async function getAthleteRewardAllocations(identity:RewardAccountIdentity,afterId:string|null=null,rpc?:RewardLedgerRpc){
  return readOwnRewardAwards(fixedIdentity(identity),afterId,rpc);
}
