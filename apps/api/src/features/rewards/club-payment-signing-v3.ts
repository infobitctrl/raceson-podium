import { keccak256,toHex,type Address,type Hex } from "viem";
import { canonicalRewardJson,encodeRewardProgrammeClubPaymentV3 } from "@raceson/rewards-chain";
import { requireReward } from "@raceson/domain/rewards";
import { rewardDocumentUuid as uuid,type ClubPaymentScopeV3,type RewardAccountIdentity } from "@raceson/db/rewards";
import { captureClubPaymentV3,loadClubPaymentV3,clubPaymentExecutionV3,clubPaymentMetadataV3,clubPaymentReadyV3,recordClubPaymentAttemptV3,type ClubPaymentDependenciesV3 } from "./club-payment-v3-service.js";
type Loaded=Awaited<ReturnType<typeof loadClubPaymentV3>>;
export function clubPaymentSigningPlanV3(v:Loaded,attemptId:string){
  const p=v.plan,i=v.context.payment!,claim=v.context.claimContext.intent!;
  const consent=v.context.claimContext.proofs.find(proof=>proof.role==="recipient")!;
  const body={schema:"raceson-club-payment-signing-plan-v3" as const,...v.scope,attemptId:uuid(attemptId),
    draftId:v.context.claimContext.readiness.source.draftId,programmeAddress:p.expectation.programme.context.verifyingContract.toLowerCase(),
    contractAddress:encodeRewardProgrammeClubPaymentV3(p).to.toLowerCase(),operatorAddress:p.expectation.programme.operatorAddress.toLowerCase(),relayerAddress:i.relayerAddress,
    recipientAddress:p.claim.recipient.toLowerCase(),amountWei:p.claim.amount.toString(),nonce:i.nonce.toString(),
    issuedAt:p.claim.issuedAt.toString(),expiresAt:p.claim.expiresAt.toString(),
    treasuryReviewId:claim.reviewId,safeExecutionNonce:claim.witness.treasury.executionNonce.toString(),
    wrappedRecipientDigest:consent.proof.wrappedDigest,consentCheckpoint:{number:p.consentCheckpoint.number.toString(),
      hash:p.consentCheckpoint.hash,timestamp:p.consentCheckpoint.timestamp.toString()},
    gasLimit:i.fees.gasLimit.toString(),maxFeePerGas:i.fees.maxFeePerGas.toString(),maxPriorityFeePerGas:i.fees.maxPriorityFeePerGas.toString(),maxGasCostWei:i.fees.maxGasCostWei.toString(),
    calldataHash:keccak256(encodeRewardProgrammeClubPaymentV3(p).data)};
  return{...body,planHash:keccak256(toHex(canonicalRewardJson(body)))};
}
export async function inspectClubPaymentSigningV3(actor:RewardAccountIdentity,input:ClubPaymentScopeV3&{attemptId:string},deps:ClubPaymentDependenciesV3){
  const fixed=captureClubPaymentV3(actor,input),attemptId=uuid(input.attemptId),v=await loadClubPaymentV3(fixed.actor,fixed.scope,deps);
  const plan=clubPaymentSigningPlanV3(v,attemptId);
  if(v.attempt){requireReward(v.context.attempt!.id===attemptId,"reward_payment_conflict");return{plan,recorded:true,transactionHash:v.attempt.transactionHash};}
  await clubPaymentExecutionV3(v.context,v.plan,deps);
  const fresh=await loadClubPaymentV3(fixed.actor,fixed.scope,deps);
  requireReward(clubPaymentSigningPlanV3(fresh,attemptId).planHash===plan.planHash,"reward_payment_signing_plan_changed");
  if(fresh.attempt){requireReward(fresh.context.attempt!.id===attemptId,"reward_payment_conflict");return{plan,recorded:true,transactionHash:fresh.attempt.transactionHash};}
  clubPaymentReadyV3(fresh.context);return{plan,recorded:false,transactionHash:null};
}
export type ClubPaymentSignerV3={address:Address;signTransaction:(tx:{chainId:number;to:Address;nonce:number;value:bigint;data:Hex;
  type:"eip1559";gas:bigint;maxFeePerGas:bigint;maxPriorityFeePerGas:bigint})=>Promise<Hex>};
/** Private injected signer, never registered in HTTP. It receives only a fixed
 * claim transaction after explicit plan approval. No account/key generation or
 * broadcast callback exists here. Signed bytes go only to private persistence. */
export async function signClubPaymentV3(actor:RewardAccountIdentity,input:ClubPaymentScopeV3&{attemptId:string;planHash:Hex},
  deps:ClubPaymentDependenciesV3&{loadSigner:()=>Promise<ClubPaymentSignerV3>;signal:AbortSignal}){
  const fixed=captureClubPaymentV3(actor,input),attemptId=uuid(input.attemptId),planHash=input.planHash;
  requireReward(/^0x[0-9a-f]{64}$/.test(planHash),"invalid_reward_payment_signing_plan");
  const {loadSigner,signal,reader,rpc,origin,chainId}=deps,options={reader,rpc,origin,chainId};
  const stopped=()=>requireReward(!signal.aborted,"reward_payment_signing_stopped");stopped();
  const reviewed=await inspectClubPaymentSigningV3(fixed.actor,{...fixed.scope,attemptId},options);
  requireReward(reviewed.plan.planHash===planHash,"reward_payment_signing_plan_changed");
  if(reviewed.recorded)return clubPaymentMetadataV3((await loadClubPaymentV3(fixed.actor,fixed.scope,options)).context);
  stopped();let signer:ClubPaymentSignerV3;
  try{signer=await loadSigner();}catch{throw Error("reward_payment_signer_unavailable");}stopped();
  requireReward(signer.address.toLowerCase()===reviewed.plan.relayerAddress,"reward_payment_signer_mismatch");
  // Key retrieval may have waited for an OS prompt: recheck state/session/chain.
  const fresh=await loadClubPaymentV3(fixed.actor,fixed.scope,options);
  requireReward(clubPaymentSigningPlanV3(fresh,attemptId).planHash===planHash,"reward_payment_signing_plan_changed");
  if(fresh.attempt){requireReward(fresh.context.attempt!.id===attemptId,"reward_payment_conflict");return clubPaymentMetadataV3(fresh.context);}
  await clubPaymentExecutionV3(fresh.context,fresh.plan,options);stopped();
  const final=await loadClubPaymentV3(fixed.actor,fixed.scope,options);
  requireReward(clubPaymentSigningPlanV3(final,attemptId).planHash===planHash,"reward_payment_signing_plan_changed");
  if(final.attempt){requireReward(final.context.attempt!.id===attemptId,"reward_payment_conflict");return clubPaymentMetadataV3(final.context);}
  // Fresh off-chain holds must also survive the last network observation.
  clubPaymentReadyV3(final.context);stopped();
  const fees=final.context.payment!.fees;let signedTransaction:Hex;
  try{signedTransaction=await signer.signTransaction({...encodeRewardProgrammeClubPaymentV3(final.plan),type:"eip1559",gas:fees.gasLimit,
    maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});}catch{throw Error("reward_payment_signer_unavailable");}
  stopped();return recordClubPaymentAttemptV3(fixed.actor,{...fixed.scope,attemptId,signedTransaction},options);
}
