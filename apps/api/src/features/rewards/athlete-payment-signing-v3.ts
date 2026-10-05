import { keccak256,toHex,type Address,type Hex } from "viem";
import { canonicalRewardJson,encodeRewardProgrammeAthletePaymentV3 } from "@raceson/rewards-chain";
import { requireReward } from "@raceson/domain/rewards";
import { rewardDocumentUuid as uuid,type PaymentScopeV3,type RewardAccountIdentity } from "@raceson/db/rewards";
import { capturePaymentV3,loadPaymentV3,paymentExecutionV3,paymentMetadataV3,paymentReadyV3,recordPaymentAttemptV3,type PaymentDependenciesV3 } from "./athlete-payment-v3-service.js";
type Loaded=Awaited<ReturnType<typeof loadPaymentV3>>;
export function paymentSigningPlanV3(v:Loaded,attemptId:string){
  const p=v.plan,i=v.context.payment!;
  const body={schema:"raceson-payment-signing-plan-v3" as const,...v.scope,attemptId:uuid(attemptId),
    draftId:v.context.claimContext.readiness.source.draftId,programmeAddress:p.expectation.programme.context.verifyingContract.toLowerCase(),
    contractAddress:encodeRewardProgrammeAthletePaymentV3(p).to.toLowerCase(),operatorAddress:p.expectation.programme.operatorAddress.toLowerCase(),relayerAddress:i.relayerAddress,
    recipientAddress:p.claim.recipient.toLowerCase(),amountWei:p.claim.amount.toString(),nonce:i.nonce.toString(),
    issuedAt:p.claim.issuedAt.toString(),expiresAt:p.claim.expiresAt.toString(),
    gasLimit:i.fees.gasLimit.toString(),maxFeePerGas:i.fees.maxFeePerGas.toString(),maxPriorityFeePerGas:i.fees.maxPriorityFeePerGas.toString(),maxGasCostWei:i.fees.maxGasCostWei.toString(),
    calldataHash:keccak256(encodeRewardProgrammeAthletePaymentV3(p).data)};
  return{...body,planHash:keccak256(toHex(canonicalRewardJson(body)))};
}
export async function inspectPaymentSigningV3(actor:RewardAccountIdentity,input:PaymentScopeV3&{attemptId:string},deps:PaymentDependenciesV3){
  const fixed=capturePaymentV3(actor,input),attemptId=uuid(input.attemptId),v=await loadPaymentV3(fixed.actor,fixed.scope,deps.rpc);
  const plan=paymentSigningPlanV3(v,attemptId);
  if(v.attempt){requireReward(v.context.attempt!.id===attemptId,"reward_payment_conflict");return{plan,recorded:true,transactionHash:v.attempt.transactionHash};}
  await paymentExecutionV3(v.context,v.plan,deps);
  return{plan,recorded:false,transactionHash:null};
}
export type PaymentSignerV3={address:Address;signTransaction:(tx:{chainId:number;to:Address;nonce:number;value:bigint;data:Hex;
  type:"eip1559";gas:bigint;maxFeePerGas:bigint;maxPriorityFeePerGas:bigint})=>Promise<Hex>};
/** Private injected signer, never registered in HTTP. It receives only a fixed
 * claim transaction after explicit plan approval. No account/key generation or
 * broadcast callback exists here. Signed bytes go only to private persistence. */
export async function signPaymentV3(actor:RewardAccountIdentity,input:PaymentScopeV3&{attemptId:string;planHash:Hex},
  deps:PaymentDependenciesV3&{loadSigner:()=>Promise<PaymentSignerV3>;signal:AbortSignal}){
  const fixed=capturePaymentV3(actor,input),attemptId=uuid(input.attemptId),planHash=input.planHash;
  requireReward(/^0x[0-9a-f]{64}$/.test(planHash),"invalid_reward_payment_signing_plan");
  const {loadSigner,signal,reader,rpc,origin,chainId}=deps,options={reader,rpc,origin,chainId};
  const stopped=()=>requireReward(!signal.aborted,"reward_payment_signing_stopped");stopped();
  const reviewed=await inspectPaymentSigningV3(fixed.actor,{...fixed.scope,attemptId},options);
  requireReward(reviewed.plan.planHash===planHash,"reward_payment_signing_plan_changed");
  if(reviewed.recorded)return paymentMetadataV3((await loadPaymentV3(fixed.actor,fixed.scope,rpc)).context);
  stopped();let signer:PaymentSignerV3;
  try{signer=await loadSigner();}catch{throw Error("reward_payment_signer_unavailable");}stopped();
  requireReward(signer.address.toLowerCase()===reviewed.plan.relayerAddress,"reward_payment_signer_mismatch");
  // Key retrieval may have waited for an OS prompt: recheck state/session/chain.
  const fresh=await loadPaymentV3(fixed.actor,fixed.scope,rpc);
  requireReward(paymentSigningPlanV3(fresh,attemptId).planHash===planHash,"reward_payment_signing_plan_changed");
  if(fresh.attempt){requireReward(fresh.context.attempt!.id===attemptId,"reward_payment_conflict");return paymentMetadataV3(fresh.context);}
  await paymentExecutionV3(fresh.context,fresh.plan,options);stopped();
  const final=await loadPaymentV3(fixed.actor,fixed.scope,rpc);
  requireReward(paymentSigningPlanV3(final,attemptId).planHash===planHash,"reward_payment_signing_plan_changed");
  if(final.attempt){requireReward(final.context.attempt!.id===attemptId,"reward_payment_conflict");return paymentMetadataV3(final.context);}
  // Fresh off-chain holds must also survive the last network observation.
  paymentReadyV3(final.context);stopped();
  const fees=final.context.payment!.fees;let signedTransaction:Hex;
  try{signedTransaction=await signer.signTransaction({...encodeRewardProgrammeAthletePaymentV3(final.plan),type:"eip1559",gas:fees.gasLimit,
    maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});}catch{throw Error("reward_payment_signer_unavailable");}
  stopped();return recordPaymentAttemptV3(fixed.actor,{...fixed.scope,attemptId,signedTransaction},options);
}
