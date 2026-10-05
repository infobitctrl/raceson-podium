import { clubPaymentLedgerV3,rewardDocumentUuid as uuid,type ClubPaymentScopeV3,type RewardAccountIdentity,type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { captureClubPaymentV3,loadClubPaymentV3,clubPaymentReadyV3,prepareClubPaymentV3,queueClubPaymentV3,type ClubPaymentDependenciesV3 } from "./club-payment-v3-service.js";
import { paymentActionRequestV3 } from "./athlete-payment-actions-v3.js";
export async function clubPaymentActionsV3(actor:RewardAccountIdentity,input:ClubPaymentScopeV3,change:unknown,
  deps:{rpc?:RewardLedgerRpc;reader?:ClubPaymentDependenciesV3["reader"];chainId:31337|10143;origin:string}){
  const fixed=captureClubPaymentV3(actor,input),request=change===undefined?null:paymentActionRequestV3.parse(change),{rpc,reader,origin,chainId}=deps;
  requireReward(chainId===fixed.scope.chainId,"invalid_reward_payment_request");
  const read=()=>clubPaymentLedgerV3(fixed.actor,fixed.scope,undefined,rpc);
  const first=await read();requireReward(first,"reward_payment_scope_required");
  if(request){
    requireReward(reader,"reward_payment_reader_required");
    if(request.kind==="prepare"){
      requireReward(request.recipientAddress===first.claimContext.intent!.recipientAddress
        && request.amountWei===first.claimContext.intent!.witness.amountWei.toString(),"reward_payment_conflict");
      await prepareClubPaymentV3(fixed.actor,{...fixed.scope,...request,relayerAddress:request.relayerAddress as `0x${string}`},{rpc,reader,origin,chainId});
    }else{
      const saved=await loadClubPaymentV3(fixed.actor,fixed.scope,{rpc,reader:reader!,chainId,origin});
      requireReward(saved.context.attempt?.id===request.attemptId && saved.attempt?.transactionHash===request.transactionHash,"reward_payment_conflict");
      await queueClubPaymentV3(fixed.actor,{...fixed.scope,jobId:uuid(request.jobId),attemptId:uuid(request.attemptId)},{rpc,reader,origin,chainId});
    }
  }
  let v=await read();requireReward(v,"reward_payment_scope_required");
  // Inspection reports persisted history without requiring a healthy RPC.
  // New prepare/queue actions verify the original signatures and live chain.
  let readinessHeld=false;try{clubPaymentReadyV3(v);}catch{readinessHeld=true;}
  const i=v.claimContext.intent!,p=v.payment,a=v.attempt,j=v.job;
  return{schema:"raceson-club-payment-actions-v3" as const,chainId,uploadId:fixed.scope.uploadId,requestId:fixed.scope.requestId,
    claimId:i.id,entitlementId:i.entitlementId,paymentId:fixed.scope.paymentId,recipientAddress:i.recipientAddress,amountWei:i.witness.amountWei.toString(),
    issuedAt:i.issuedAt.toString(),expiresAt:i.expiresAt.toString(),readinessHeld,
    recipientConsented:v.claimContext.proofs.some(x=>x.role==="recipient"),operatorApproved:v.claimContext.proofs.some(x=>x.role==="operator"),
    state:j?.state??(a?"signed":p?"prepared":"not_prepared"),confirmed:v.receipt!==null,
    relayerAddress:p?.relayerAddress??null,nonce:p?.nonce.toString()??null,
    fees:p?{gasLimit:p.fees.gasLimit.toString(),maxFeePerGas:p.fees.maxFeePerGas.toString(),maxPriorityFeePerGas:p.fees.maxPriorityFeePerGas.toString(),maxGasCostWei:p.fees.maxGasCostWei.toString()}:null,
    attemptId:a?.id??null,jobId:j?.jobId??null,transactionHash:a?.body.transactionHash??null,
    ack:request?{kind:request.kind,requestId:request.kind==="prepare"?fixed.scope.paymentId:request.jobId}:null};
}
