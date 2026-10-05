import { TransactionNotFoundError, keccak256, type Hex } from "viem";
import { paymentLedgerV3,rewardDocumentUuid as uuid,type PaymentScopeV3,type RewardAccountIdentity,type PaymentContextV3 } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { readVerifiedRewardProgrammeAthletePaymentV3 } from "@raceson/rewards-chain";
import { capturePaymentV3,loadPaymentV3,paymentExecutionV3,paymentReadyV3,type PaymentDependenciesV3 } from "./athlete-payment-v3-service.js";
import { rewardLeaseCanStartSend } from "./worker-send-fence.js";

/** Private one-step worker only. Never signs, changes fees/nonces, discovers a
 * provider or schedules itself. Retries reconcile its exact stored bytes first. */
export async function runPaymentJobV3(actor:RewardAccountIdentity,input:PaymentScopeV3&{jobId:string;workerId:string},
  deps:PaymentDependenciesV3&{broadcast:(signed:Hex)=>Promise<Hex>;signal?:AbortSignal}){
  const f=capturePaymentV3(actor,input),jobId=uuid(input.jobId),workerId=uuid(input.workerId),reader=deps.reader;
  const result=(outcome:"confirmed"|"busy"|"held"|"pending"|"submitted"|"unavailable"|"broadcast_unknown"|"requires_attention"|"cancelled")=>({jobId,outcome});
  if(deps.signal?.aborted)return result("cancelled");
  const initial=await paymentLedgerV3(f.actor,f.scope,undefined,deps.rpc);requireReward(initial?.job?.jobId===jobId,"reward_payment_job_required");
  if(initial.job.state==="confirmed"){await loadPaymentV3(f.actor,f.scope,deps.rpc);return result("confirmed");}
  const payload=(leaseToken:string|null,execution:unknown=null,receipt:unknown=null)=>({jobId,workerId,leaseToken,execution,receipt,
    observedAt:execution===null?null:new Date().toISOString()});
  const leased=await paymentLedgerV3(f.actor,f.scope,{action:"lease",payload:payload(null)},deps.rpc);if(!leased)return result("busy");
  requireReward(leased.job?.jobId===jobId && leased.job.attemptId===initial.job.attemptId && leased.job.transactionHash===initial.job.transactionHash,"reward_payment_conflict");
  if(leased.job.state==="confirmed")return result("confirmed");const token=leased.job.leaseToken;
  requireReward(leased.job.leaseOwner===workerId && token,"reward_payment_lease_lost");
  const step=async(action:"arm"|"submitted"|"confirm",execution:unknown=null,receipt:unknown=null)=>{
    const v=await paymentLedgerV3(f.actor,f.scope,{action,payload:payload(token,execution,receipt)},deps.rpc);
    requireReward(v?.job?.jobId===jobId && v.job.attemptId===leased.job!.attemptId && v.job.transactionHash===leased.job!.transactionHash
      && (v.job.state==="confirmed" || v.job.leaseToken===token && v.job.leaseOwner===workerId),"reward_payment_lease_lost");return v;
  };
  const loaded=await loadPaymentV3(f.actor,f.scope,deps.rpc),a=loaded.attempt;requireReward(a && a.transactionHash===leased.job.transactionHash,"reward_payment_attempt_required");
  let missing=false,tx;
  try{
    requireReward(await reader.getChainId()===f.scope.chainId,"reward_observed_chain_mismatch");
    try{tx=await reader.getTransaction({hash:a.transactionHash});}catch(error){if(!(error instanceof TransactionNotFoundError))throw error;missing=true;}
  }catch{return result("unavailable");}
  if(!missing){
    try{
      if(!tx || tx.hash!==a.transactionHash || tx.chainId!==f.scope.chainId || tx.type!=="eip1559" || (tx.accessList?.length??0)!==0
        || tx.from.toLowerCase()!==a.relayerAddress || tx.to?.toLowerCase()!==a.contractAddress || tx.value!==0n || BigInt(tx.nonce)!==a.nonce
        || tx.gas!==a.gasLimit || tx.maxFeePerGas!==a.maxFeePerGas || (tx.maxPriorityFeePerGas??0n)!==a.maxPriorityFeePerGas
        || keccak256(tx.input)!==a.calldataHash || (tx.blockNumber===null)!==(tx.blockHash===null))return result("requires_attention");
      if(tx.blockNumber===null){
        requireReward(await reader.getChainId()===f.scope.chainId,"reward_chain_changed_during_observation");
        await step("submitted");return result("pending");
      }
      const proof=await readVerifiedRewardProgrammeAthletePaymentV3(reader,loaded.plan,a.signedTransaction);
      const v=await step("confirm",null,{payment:proof.payment,accounting:proof.checkpoint.observation.accounting});
      requireReward(v.job!.state==="confirmed","reward_payment_receipt_required");return result("confirmed");
    }catch{return result("unavailable");}
  }
  try{paymentReadyV3(loaded.context);}catch{return result("held");}
  let execution;
  try{execution=await paymentExecutionV3(loaded.context,loaded.plan,deps);}catch{return result("unavailable");}
  let armed:PaymentContextV3;
  try{armed=await step("arm",execution);}catch{return result("held");}
  if(armed.job!.state==="confirmed")return result("confirmed");
  if(deps.signal?.aborted)return result("cancelled");
  if(!rewardLeaseCanStartSend(armed.job!))return result("busy");
  try{if(await deps.broadcast(a.signedTransaction)!==a.transactionHash)return result("broadcast_unknown");await step("submitted");return result("submitted");}
  catch{return result("broadcast_unknown");}
}
