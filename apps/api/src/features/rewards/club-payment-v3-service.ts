import { clubPaymentLedgerV3, decodePaymentFeesV3, copyRewardLedgerDocument as copy, rewardDocumentUuid as uuid,
  type ClubPaymentScopeV3, type ClubPaymentContextV3, type RewardAccountIdentity, type RewardLedgerRpc } from "@raceson/db/rewards";
import { requireReward } from "@raceson/domain/rewards";
import { canonicalRewardJson, verifyRewardProgrammeClubPaymentV3, verifySignedRewardProgrammeClubPaymentV3,
  readRewardProgrammeClubPaymentPreflightV3, encodeRewardProgrammeClubPaymentV3,
  type RewardProgrammeClubPaymentPlanV3 } from "@raceson/rewards-chain";
import type { RewardProgrammeClubClaimReaderV3 } from "@raceson/rewards-chain";
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { preparedClubClaimV3, compactClubClaimWitnessV3 } from "./club-claims-v3-service.js";
const safeNonceAbi=parseAbi(["function nonce() view returns (uint256)"]);
export type ClubPaymentReaderV3=RewardProgrammeClubClaimReaderV3 & Pick<PublicClient,"getTransactionCount"|"call">;
export type ClubPaymentDependenciesV3={rpc?:RewardLedgerRpc;reader:ClubPaymentReaderV3;origin:string;chainId:31337|10143};
export function captureClubPaymentV3(actor:RewardAccountIdentity,s:ClubPaymentScopeV3){
  requireReward([31337,10143].includes(s.chainId) && /^0x[0-9a-f]{64}$/.test(s.entitlementId),"invalid_reward_payment_v3");
  return{actor:{userId:uuid(actor.userId),sessionId:uuid(actor.sessionId)},scope:{chainId:s.chainId,uploadId:uuid(s.uploadId),requestId:uuid(s.requestId),
    entitlementId:s.entitlementId,claimId:uuid(s.claimId),paymentId:uuid(s.paymentId)}};
}
export function clubPaymentReadyV3(v:ClubPaymentContextV3){const c=v.claimContext,i=c.intent!,r=c.readiness;
  requireReward(r.state==="reviewed" && r.review?.id===i.reviewId && r.source.sourceGuardHash===i.sourceGuardHash && r.identityFingerprint===i.identityFingerprint,
    "reward_claim_readiness_required");}
export function clubPaymentPlanV3(v:ClubPaymentContextV3,relayer?:Address,nonce?:bigint):RewardProgrammeClubPaymentPlanV3{
  const c=v.claimContext,p=preparedClubClaimV3(c,c.intent!.entitlementId),operator=c.proofs.find(p=>p.role==="operator"),recipient=c.proofs.find(p=>p.role==="recipient");
  requireReward(operator && recipient,"reward_payment_approvals_required");
  requireReward(v.payment || relayer && nonce!==undefined,"reward_payment_scope_required");
  return{protocolVersion:3,expectation:p.expectation,claim:p.claim,proofs:{operator:operator.proof.signature,recipient:recipient.proof.signature},
    consentCheckpoint:recipient.witness.finalizedBlock,
    relayerAddress:v.payment?.relayerAddress??relayer!,nonce:v.payment?.nonce??nonce!};
}
export function clubPaymentAttemptBodyV3(a:Awaited<ReturnType<typeof verifySignedRewardProgrammeClubPaymentV3>>){
  return{protocolVersion:3 as const,chainId:a.chainId,contractAddress:a.contractAddress,relayerAddress:a.relayerAddress,nonce:a.nonce,
    transactionHash:a.transactionHash,calldataHash:a.calldataHash,signedTransaction:a.signedTransaction,gasLimit:a.gasLimit,maxFeePerGas:a.maxFeePerGas,
    maxPriorityFeePerGas:a.maxPriorityFeePerGas,operatorDigest:a.operatorDigest,recipientDigest:a.recipientDigest,
    wrappedRecipientDigest:a.wrappedRecipientDigest,safeExecutionNonce:a.safeExecutionNonce,consentCheckpoint:a.consentCheckpoint};
}
export async function loadClubPaymentV3(actor:RewardAccountIdentity,s:ClubPaymentScopeV3,deps:ClubPaymentDependenciesV3){
  const fixed=captureClubPaymentV3(actor,s),v=await clubPaymentLedgerV3(fixed.actor,fixed.scope,undefined,deps.rpc);requireReward(v,"reward_payment_scope_required");
  const plan=clubPaymentPlanV3(v);await verifyRewardProgrammeClubPaymentV3(deps.reader,plan);
  let attempt=null;
  if(v.attempt){attempt=await verifySignedRewardProgrammeClubPaymentV3(deps.reader,plan,v.attempt.body.signedTransaction);
    requireReward(canonicalRewardJson(clubPaymentAttemptBodyV3(attempt))===canonicalRewardJson(v.attempt.body),"invalid_reward_payment_v3");}
  const fresh=await clubPaymentLedgerV3(fixed.actor,fixed.scope,undefined,deps.rpc);requireReward(fresh,"reward_payment_scope_required");
  requireReward(canonicalRewardJson(fresh.claimContext.intent)===canonicalRewardJson(v.claimContext.intent)
    && canonicalRewardJson(fresh.payment)===canonicalRewardJson(v.payment)
    && canonicalRewardJson(fresh.attempt)===canonicalRewardJson(v.attempt),"reward_payment_conflict");
  return{...fixed,context:fresh,plan,attempt};
}
export const clubPaymentMetadataV3=(v:ClubPaymentContextV3)=>({schema:"raceson-club-payment-record-v3" as const,paymentId:v.payment!.id,
  claimId:v.payment!.claimId,chainId:v.payment!.chainId,amountWei:v.claimContext.intent!.witness.amountWei.toString(),
  recipientAddress:v.claimContext.intent!.recipientAddress,state:v.job?.state??(v.attempt?"signed":"prepared"),
  transactionHash:v.attempt?.body.transactionHash??null,jobId:v.job?.jobId??null,
  confirmed:v.receipt!==null,blockNumber:v.receipt?.payment.blockNumber??null});

/** Full finalized eligibility plus explicit latest-chain simulation/nonce/gas
 * checks. This never signs or sends. The DB arm must follow these reads. */
export async function clubPaymentExecutionV3(v:ClubPaymentContextV3,plan:RewardProgrammeClubPaymentPlanV3,deps:ClubPaymentDependenciesV3){
  requireReward(deps.chainId===plan.expectation.programme.context.chainId,"reward_observed_chain_mismatch");
  clubPaymentReadyV3(v);
  const witness=await readRewardProgrammeClubPaymentPreflightV3(deps.reader,plan),c=deps.reader,{plan:p}=await verifyRewardProgrammeClubPaymentV3(deps.reader,plan),fees=v.payment?.fees;
  const head=await c.getBlock({blockTag:"latest"});requireReward(head.number!==null && head.hash!==null && head.timestamp>=witness.observation.finalizedBlock.timestamp
    && head.timestamp>=p.claim.issuedAt && head.timestamp<p.claim.expiresAt,"reward_claim_window_unavailable");
  const [latestNonce,pendingNonce,balance,relayerCode,operatorCode,safeNonce]=await Promise.all([
    c.getTransactionCount({address:p.relayerAddress,blockTag:"latest"}),c.getTransactionCount({address:p.relayerAddress,blockTag:"pending"}),
    c.getBalance({address:p.relayerAddress,blockNumber:head.number}),c.getCode({address:p.relayerAddress,blockNumber:head.number}),
    c.getCode({address:p.expectation.programme.operatorAddress,blockNumber:head.number}),c.readContract({address:p.claim.recipient,abi:safeNonceAbi,functionName:"nonce",blockNumber:head.number})]);
  requireReward([latestNonce,pendingNonce].every(n=>Number.isSafeInteger(n)&&n>=0) && latestNonce<=pendingNonce,"reward_payment_execution_unavailable");
  requireReward([relayerCode,operatorCode].every(code=>code===undefined||code==="0x"),"reward_payment_eoa_required");
  requireReward(safeNonce===witness.treasury.executionNonce,"reward_club_execution_changed_since_review");
  if(fees){
    requireReward(BigInt(latestNonce)===p.nonce && BigInt(pendingNonce)===p.nonce && balance>=fees.maxGasCostWei,"reward_payment_execution_unavailable");
    await c.call({...encodeRewardProgrammeClubPaymentV3(p),account:p.relayerAddress,gas:fees.gasLimit,blockNumber:head.number});
  }
  const [chainAfter,anchor]=await Promise.all([c.getChainId(),c.getBlock({blockNumber:head.number})]);
  requireReward(chainAfter===deps.chainId && anchor.hash===head.hash && anchor.timestamp===head.timestamp,"reward_chain_changed_during_observation");
  return{witness:compactClubClaimWitnessV3(witness),latestNonce:BigInt(latestNonce),pendingNonce:BigInt(pendingNonce),relayerBalanceWei:balance};
}
export async function prepareClubPaymentV3(actor:RewardAccountIdentity,input:ClubPaymentScopeV3&{relayerAddress:Address;fees:unknown},deps:ClubPaymentDependenciesV3){
  const f=captureClubPaymentV3(actor,input),relayer=input.relayerAddress.toLowerCase() as Address,fees=decodePaymentFeesV3(copy(input.fees));
  const v=await clubPaymentLedgerV3(f.actor,f.scope,undefined,deps.rpc);requireReward(v,"reward_payment_scope_required");
  if(v.payment){requireReward(v.payment.relayerAddress===relayer && canonicalRewardJson(v.payment.fees)===canonicalRewardJson(fees),"reward_payment_conflict");
    return clubPaymentMetadataV3((await loadClubPaymentV3(f.actor,f.scope,deps)).context);}
  const plan=clubPaymentPlanV3(v,relayer,0n),execution=await clubPaymentExecutionV3(v,plan,deps);
  requireReward(execution.relayerBalanceWei>=fees.maxGasCostWei,"reward_payment_execution_unavailable");
  const saved=await clubPaymentLedgerV3(f.actor,f.scope,{action:"prepare",payload:{relayerAddress:relayer,fees,pendingNonce:execution.pendingNonce,
    witness:execution.witness,observedAt:new Date().toISOString()}},deps.rpc);requireReward(saved,"reward_payment_scope_required");
  return clubPaymentMetadataV3((await loadClubPaymentV3(f.actor,f.scope,deps)).context);
}
export async function recordClubPaymentAttemptV3(actor:RewardAccountIdentity,input:ClubPaymentScopeV3&{attemptId:string;signedTransaction:Hex},deps:ClubPaymentDependenciesV3){
  const f=captureClubPaymentV3(actor,input),attemptId=uuid(input.attemptId),bytes=input.signedTransaction;
  const loaded=await loadClubPaymentV3(f.actor,f.scope,deps),a=await verifySignedRewardProgrammeClubPaymentV3(deps.reader,loaded.plan,bytes),body=clubPaymentAttemptBodyV3(a),v=loaded.context;
  requireReward(canonicalRewardJson({gasLimit:a.gasLimit,maxFeePerGas:a.maxFeePerGas,maxPriorityFeePerGas:a.maxPriorityFeePerGas,maxGasCostWei:v.payment!.fees.maxGasCostWei})
    ===canonicalRewardJson(v.payment!.fees),"invalid_reward_payment_v3");
  if(v.attempt){requireReward(v.attempt.id===attemptId && canonicalRewardJson(v.attempt.body)===canonicalRewardJson(body),"reward_payment_conflict");return clubPaymentMetadataV3((await loadClubPaymentV3(f.actor,f.scope,deps)).context);}
  const execution=await clubPaymentExecutionV3(v,loaded.plan,deps),saved=await clubPaymentLedgerV3(f.actor,f.scope,{action:"attempt",payload:{attemptId,body,
    witness:execution.witness,observedAt:new Date().toISOString()}},deps.rpc);requireReward(saved,"reward_payment_scope_required");return clubPaymentMetadataV3(saved);
}
export async function queueClubPaymentV3(actor:RewardAccountIdentity,input:ClubPaymentScopeV3&{jobId:string;attemptId:string},deps:ClubPaymentDependenciesV3){
  const f=captureClubPaymentV3(actor,input),jobId=uuid(input.jobId),attemptId=uuid(input.attemptId),loaded=await loadClubPaymentV3(f.actor,f.scope,deps),v=loaded.context;
  requireReward(v.attempt?.id===attemptId,"reward_payment_attempt_required");
  if(v.job){requireReward(v.job.jobId===jobId && v.job.attemptId===attemptId,"reward_payment_conflict");return clubPaymentMetadataV3(v);}
  const execution=await clubPaymentExecutionV3(v,loaded.plan,deps),saved=await clubPaymentLedgerV3(f.actor,f.scope,{action:"queue",payload:{jobId,attemptId,
    witness:execution.witness,observedAt:new Date().toISOString()}},deps.rpc);requireReward(saved,"reward_payment_job_required");return clubPaymentMetadataV3(saved);
}
