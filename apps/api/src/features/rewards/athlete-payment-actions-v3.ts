import { z } from "zod";
import { paymentLedgerV3,rewardDocumentUuid as uuid,type PaymentScopeV3,type RewardAccountIdentity,type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { capturePaymentV3,loadPaymentV3,paymentReadyV3,preparePaymentV3,queuePaymentV3,type PaymentDependenciesV3 } from "./athlete-payment-v3-service.js";
const hexAddress=z.string().regex(/^0x[0-9a-f]{40}$/),amount=z.string().regex(/^[1-9][0-9]{0,77}$/),integer=z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
export const paymentActionRequestV3=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("prepare"),recipientAddress:hexAddress,amountWei:amount,relayerAddress:hexAddress,
    fees:z.object({gasLimit:amount,maxFeePerGas:amount,maxPriorityFeePerGas:integer,maxGasCostWei:amount}).strict()}).strict(),
  z.object({kind:z.literal("queue"),jobId:z.string().uuid(),attemptId:z.string().uuid(),transactionHash:z.string().regex(/^0x[0-9a-f]{64}$/)}).strict(),
]);
export async function paymentActionsV3(actor:RewardAccountIdentity,input:PaymentScopeV3,change:unknown,
  deps:{rpc?:RewardLedgerRpc;reader?:PaymentDependenciesV3["reader"];chainId:31337|10143;origin:string}){
  const fixed=capturePaymentV3(actor,input),request=change===undefined?null:paymentActionRequestV3.parse(change),{rpc,reader,origin,chainId}=deps;
  requireReward(chainId===fixed.scope.chainId,"invalid_reward_payment_request");
  const read=()=>paymentLedgerV3(fixed.actor,fixed.scope,undefined,rpc);
  if(request){
    const first=await read();requireReward(first,"reward_payment_scope_required");
    requireReward(reader,"reward_payment_reader_required");
    if(request.kind==="prepare"){
      requireReward(request.recipientAddress===first.claimContext.intent!.recipientAddress
        && request.amountWei===first.claimContext.intent!.witness.amountWei.toString(),"reward_payment_conflict");
      await preparePaymentV3(fixed.actor,{...fixed.scope,...request,relayerAddress:request.relayerAddress as `0x${string}`},{rpc,reader,origin,chainId});
    }else{
      const saved=await loadPaymentV3(fixed.actor,fixed.scope,rpc);
      requireReward(saved.context.attempt?.id===request.attemptId && saved.attempt?.transactionHash===request.transactionHash,"reward_payment_conflict");
      await queuePaymentV3(fixed.actor,{...fixed.scope,jobId:uuid(request.jobId),attemptId:uuid(request.attemptId)},{rpc,reader,origin,chainId});
    }
  }
  let v=await read();requireReward(v,"reward_payment_scope_required");
  if(v.payment)v=(await loadPaymentV3(fixed.actor,fixed.scope,rpc)).context;
  let readinessHeld=false;try{paymentReadyV3(v);}catch{readinessHeld=true;}
  const i=v.claimContext.intent!,p=v.payment,a=v.attempt,j=v.job;
  return{schema:"raceson-athlete-payment-actions-v3" as const,chainId,uploadId:fixed.scope.uploadId,destinationId:fixed.scope.destinationId,
    claimId:i.id,entitlementId:i.entitlementId,paymentId:fixed.scope.paymentId,recipientAddress:i.recipientAddress,amountWei:i.witness.amountWei.toString(),
    issuedAt:i.issuedAt.toString(),expiresAt:i.expiresAt.toString(),readinessHeld,
    recipientConsented:v.claimContext.proofs.some(x=>x.role==="recipient"),operatorApproved:v.claimContext.proofs.some(x=>x.role==="operator"),
    state:j?.state??(a?"signed":p?"prepared":"not_prepared"),confirmed:v.receipt!==null,
    relayerAddress:p?.relayerAddress??null,nonce:p?.nonce.toString()??null,
    fees:p?{gasLimit:p.fees.gasLimit.toString(),maxFeePerGas:p.fees.maxFeePerGas.toString(),maxPriorityFeePerGas:p.fees.maxPriorityFeePerGas.toString(),maxGasCostWei:p.fees.maxGasCostWei.toString()}:null,
    attemptId:a?.id??null,jobId:j?.jobId??null,transactionHash:a?.body.transactionHash??null,
    ack:request?{kind:request.kind,requestId:request.kind==="prepare"?fixed.scope.paymentId:request.jobId}:null};
}
