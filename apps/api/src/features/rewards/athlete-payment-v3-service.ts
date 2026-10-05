import { paymentLedgerV3, decodePaymentFeesV3, copyRewardLedgerDocument as copy, rewardDocumentUuid as uuid,
  type PaymentScopeV3, type PaymentContextV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson, verifyRewardProgrammeAthletePaymentV3, verifySignedRewardProgrammeAthletePaymentV3,
  readRewardProgrammeAthletePaymentPreflightV3, encodeRewardProgrammeAthletePaymentV3,
  type RewardProgrammeAthletePaymentPlanV3 } from "@raceson/rewards-chain";
import type { RewardClaimReaderV3 } from "@raceson/rewards-chain/claim-reader-v3";
import type { Address, Hex, PublicClient } from "viem";
import { preparedClaimV3, compactClaimWitnessV3 } from "./athlete-claims-v3-service.js";
import { verifyReadinessWalletV3 } from "./athlete-readiness-v3-service.js";
export type PaymentReaderV3=RewardClaimReaderV3 & Pick<PublicClient,"getTransactionCount"|"call">;
export type PaymentDependenciesV3={rpc?:RewardLedgerRpc;reader:PaymentReaderV3;origin:string;chainId:31337|10143};
export function capturePaymentV3(actor:RewardAccountIdentity,s:PaymentScopeV3){
  requireReward([31337,10143].includes(s.chainId) && /^0x[0-9a-f]{64}$/.test(s.entitlementId),"invalid_reward_payment_v3");
  return{actor:{userId:uuid(actor.userId),sessionId:uuid(actor.sessionId)},scope:{chainId:s.chainId,uploadId:uuid(s.uploadId),destinationId:uuid(s.destinationId),
    entitlementId:s.entitlementId,claimId:uuid(s.claimId),paymentId:uuid(s.paymentId)}};
}
export function paymentReadyV3(v:PaymentContextV3){const c=v.claimContext,i=c.intent!,r=c.readiness;
  requireReward(r.state==="reviewed" && r.review?.id===i.reviewId && r.source.sourceGuardHash===i.sourceGuardHash && r.profileFingerprint===i.profileFingerprint,
    "reward_claim_readiness_required");}
export function paymentPlanV3(v:PaymentContextV3,relayer?:Address,nonce?:bigint):RewardProgrammeAthletePaymentPlanV3{
  const c=v.claimContext,p=preparedClaimV3(c,c.intent!.entitlementId),operator=c.proofs.find(p=>p.role==="operator"),recipient=c.proofs.find(p=>p.role==="recipient");
  requireReward(operator && recipient,"reward_payment_approvals_required");
  requireReward(v.payment || relayer && nonce!==undefined,"reward_payment_scope_required");
  return{protocolVersion:3,expectation:p.expectation,claim:p.claim,proofs:{operator:operator.proof.signature,recipient:recipient.proof.signature},
    relayerAddress:v.payment?.relayerAddress??relayer!,nonce:v.payment?.nonce??nonce!};
}
export function paymentAttemptBodyV3(a:Awaited<ReturnType<typeof verifySignedRewardProgrammeAthletePaymentV3>>){
  return{protocolVersion:3 as const,chainId:a.chainId,contractAddress:a.contractAddress,relayerAddress:a.relayerAddress,nonce:a.nonce,
    transactionHash:a.transactionHash,calldataHash:a.calldataHash,signedTransaction:a.signedTransaction,gasLimit:a.gasLimit,maxFeePerGas:a.maxFeePerGas,
    maxPriorityFeePerGas:a.maxPriorityFeePerGas,operatorDigest:a.operatorDigest,recipientDigest:a.recipientDigest};
}
export async function loadPaymentV3(actor:RewardAccountIdentity,s:PaymentScopeV3,rpc?:RewardLedgerRpc){
  const fixed=capturePaymentV3(actor,s),v=await paymentLedgerV3(fixed.actor,fixed.scope,undefined,rpc);requireReward(v,"reward_payment_scope_required");
  const plan=paymentPlanV3(v);await verifyRewardProgrammeAthletePaymentV3(plan);
  let attempt=null;
  if(v.attempt){attempt=await verifySignedRewardProgrammeAthletePaymentV3(plan,v.attempt.body.signedTransaction);
    requireReward(canonicalRewardJson(paymentAttemptBodyV3(attempt))===canonicalRewardJson(v.attempt.body),"invalid_reward_payment_v3");}
  return{...fixed,context:v,plan,attempt};
}
export const paymentMetadataV3=(v:PaymentContextV3)=>({schema:"raceson-athlete-payment-record-v3" as const,paymentId:v.payment!.id,
  claimId:v.payment!.claimId,chainId:v.payment!.chainId,amountWei:v.claimContext.intent!.witness.amountWei.toString(),
  recipientAddress:v.claimContext.intent!.recipientAddress,state:v.job?.state??(v.attempt?"signed":"prepared"),
  transactionHash:v.attempt?.body.transactionHash??null,jobId:v.job?.jobId??null,
  confirmed:v.receipt!==null,blockNumber:v.receipt?.payment.blockNumber??null});

/** Full finalized eligibility plus explicit latest-chain simulation/nonce/gas
 * checks. This never signs or sends. The DB arm must follow these reads. */
export async function paymentExecutionV3(v:PaymentContextV3,plan:RewardProgrammeAthletePaymentPlanV3,deps:PaymentDependenciesV3){
  requireReward(deps.chainId===plan.expectation.programme.context.chainId,"reward_observed_chain_mismatch");
  paymentReadyV3(v);await verifyReadinessWalletV3(v.claimContext.readiness,deps);
  const witness=await readRewardProgrammeAthletePaymentPreflightV3(deps.reader,plan),c=deps.reader,p=await verifyRewardProgrammeAthletePaymentV3(plan),fees=v.payment?.fees;
  const head=await c.getBlock({blockTag:"latest"});requireReward(head.number!==null && head.hash!==null && head.timestamp>=witness.observation.finalizedBlock.timestamp
    && head.timestamp>=p.claim.issuedAt && head.timestamp<p.claim.expiresAt,"reward_claim_window_unavailable");
  const [latestNonce,pendingNonce,balance,relayerCode,operatorCode,recipientCode]=await Promise.all([
    c.getTransactionCount({address:p.relayerAddress,blockTag:"latest"}),c.getTransactionCount({address:p.relayerAddress,blockTag:"pending"}),
    c.getBalance({address:p.relayerAddress,blockNumber:head.number}),c.getCode({address:p.relayerAddress,blockNumber:head.number}),
    c.getCode({address:p.expectation.programme.operatorAddress,blockNumber:head.number}),c.getCode({address:p.claim.recipient,blockNumber:head.number})]);
  requireReward([latestNonce,pendingNonce].every(n=>Number.isSafeInteger(n)&&n>=0) && latestNonce<=pendingNonce,"reward_payment_execution_unavailable");
  requireReward([relayerCode,operatorCode,recipientCode].every(code=>code===undefined||code==="0x"),"reward_payment_eoa_required");
  if(fees){
    requireReward(BigInt(latestNonce)===p.nonce && BigInt(pendingNonce)===p.nonce && balance>=fees.maxGasCostWei,"reward_payment_execution_unavailable");
    await c.call({...encodeRewardProgrammeAthletePaymentV3(p),account:p.relayerAddress,gas:fees.gasLimit,blockNumber:head.number});
  }
  const [chainAfter,anchor]=await Promise.all([c.getChainId(),c.getBlock({blockNumber:head.number})]);
  requireReward(chainAfter===deps.chainId && anchor.hash===head.hash && anchor.timestamp===head.timestamp,"reward_chain_changed_during_observation");
  return{witness:compactClaimWitnessV3(witness),latestNonce:BigInt(latestNonce),pendingNonce:BigInt(pendingNonce),relayerBalanceWei:balance};
}
export async function preparePaymentV3(actor:RewardAccountIdentity,input:PaymentScopeV3&{relayerAddress:Address;fees:unknown},deps:PaymentDependenciesV3){
  const f=capturePaymentV3(actor,input),relayer=input.relayerAddress.toLowerCase() as Address,fees=decodePaymentFeesV3(copy(input.fees));
  const v=await paymentLedgerV3(f.actor,f.scope,undefined,deps.rpc);requireReward(v,"reward_payment_scope_required");
  if(v.payment){requireReward(v.payment.relayerAddress===relayer && canonicalRewardJson(v.payment.fees)===canonicalRewardJson(fees),"reward_payment_conflict");
    await loadPaymentV3(f.actor,f.scope,deps.rpc);return paymentMetadataV3(v);}
  const plan=paymentPlanV3(v,relayer,0n),execution=await paymentExecutionV3(v,plan,deps);
  requireReward(execution.relayerBalanceWei>=fees.maxGasCostWei,"reward_payment_execution_unavailable");
  const saved=await paymentLedgerV3(f.actor,f.scope,{action:"prepare",payload:{relayerAddress:relayer,fees,pendingNonce:execution.pendingNonce,
    witness:execution.witness,observedAt:new Date().toISOString()}},deps.rpc);requireReward(saved,"reward_payment_scope_required");
  await verifyRewardProgrammeAthletePaymentV3(paymentPlanV3(saved));return paymentMetadataV3(saved);
}
export async function recordPaymentAttemptV3(actor:RewardAccountIdentity,input:PaymentScopeV3&{attemptId:string;signedTransaction:Hex},deps:PaymentDependenciesV3){
  const f=capturePaymentV3(actor,input),attemptId=uuid(input.attemptId),bytes=input.signedTransaction;
  const loaded=await loadPaymentV3(f.actor,f.scope,deps.rpc),a=await verifySignedRewardProgrammeAthletePaymentV3(loaded.plan,bytes),body=paymentAttemptBodyV3(a),v=loaded.context;
  requireReward(canonicalRewardJson({gasLimit:a.gasLimit,maxFeePerGas:a.maxFeePerGas,maxPriorityFeePerGas:a.maxPriorityFeePerGas,maxGasCostWei:v.payment!.fees.maxGasCostWei})
    ===canonicalRewardJson(v.payment!.fees),"invalid_reward_payment_v3");
  if(v.attempt){requireReward(v.attempt.id===attemptId && canonicalRewardJson(v.attempt.body)===canonicalRewardJson(body),"reward_payment_conflict");return paymentMetadataV3(v);}
  const execution=await paymentExecutionV3(v,loaded.plan,deps),saved=await paymentLedgerV3(f.actor,f.scope,{action:"attempt",payload:{attemptId,body,
    witness:execution.witness,observedAt:new Date().toISOString()}},deps.rpc);requireReward(saved,"reward_payment_scope_required");return paymentMetadataV3(saved);
}
export async function queuePaymentV3(actor:RewardAccountIdentity,input:PaymentScopeV3&{jobId:string;attemptId:string},deps:PaymentDependenciesV3){
  const f=capturePaymentV3(actor,input),jobId=uuid(input.jobId),attemptId=uuid(input.attemptId),loaded=await loadPaymentV3(f.actor,f.scope,deps.rpc),v=loaded.context;
  requireReward(v.attempt?.id===attemptId,"reward_payment_attempt_required");
  if(v.job){requireReward(v.job.jobId===jobId && v.job.attemptId===attemptId,"reward_payment_conflict");return paymentMetadataV3(v);}
  const execution=await paymentExecutionV3(v,loaded.plan,deps),saved=await paymentLedgerV3(f.actor,f.scope,{action:"queue",payload:{jobId,attemptId,
    witness:execution.witness,observedAt:new Date().toISOString()}},deps.rpc);requireReward(saved,"reward_payment_job_required");return paymentMetadataV3(saved);
}
