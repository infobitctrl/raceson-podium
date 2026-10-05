import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as uint } from "./stored-documents.js";
import { decodeClubClaimContextV3, decodeClubClaimWitnessV3, type ClubClaimScopeV3 } from "./club-claims-v3.js";
import { decodePaymentFeesV3 } from "./athlete-payments-v3.js";
import { decodeRewardOperatorJobV3 } from "./programme-jobs-v3.js";
import { decodeRewardCampaignObservation } from "./campaign-checkpoints.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
export type ClubPaymentScopeV3 = Omit<ClubClaimScopeV3,"role"> & { paymentId: string };
function check(v:unknown):asserts v {if(!v)throw new RewardLedgerStoreError("invalid_reward_payment_v3");}
const hash=(v:unknown)=>{check(typeof v==="string" && /^0x[0-9a-f]{64}$/.test(v) && BigInt(v)!==0n);return v as `0x${string}`;};
const address=(v:unknown)=>{check(typeof v==="string" && /^0x[0-9a-f]{40}$/.test(v) && BigInt(v)!==0n);return v as `0x${string}`;};
const time=(v:unknown)=>{parseRewardSourceTimestamp(v);return v as string;};
export function decodeClubPaymentAttemptV3(raw:unknown){const v=object(raw,["protocolVersion","chainId","contractAddress","relayerAddress","nonce","transactionHash","calldataHash","signedTransaction",
  "gasLimit","maxFeePerGas","maxPriorityFeePerGas","operatorDigest","recipientDigest","wrappedRecipientDigest","safeExecutionNonce","consentCheckpoint"]);
  check(v.protocolVersion===3 && (v.chainId===31337 || v.chainId===10143) && typeof v.signedTransaction==="string"
    && /^0x02([0-9a-f]{2})+$/.test(v.signedTransaction) && v.signedTransaction.length<=24578);
  const gasLimit=uint(v.gasLimit),maxFeePerGas=uint(v.maxFeePerGas),maxPriorityFeePerGas=uint(v.maxPriorityFeePerGas),nonce=uint(v.nonce);
  check(gasLimit>0n && gasLimit<=30000000n && maxFeePerGas>0n && maxPriorityFeePerGas<=maxFeePerGas && nonce<=BigInt(Number.MAX_SAFE_INTEGER));
  const b=object(v.consentCheckpoint,["number","hash","timestamp"]),consentCheckpoint={number:uint(b.number),hash:hash(b.hash),timestamp:uint(b.timestamp)};
  check(consentCheckpoint.number>0n && consentCheckpoint.timestamp>0n);
  return {wrappedRecipientDigest:hash(v.wrappedRecipientDigest),safeExecutionNonce:uint(v.safeExecutionNonce),consentCheckpoint,protocolVersion:3 as const,chainId:v.chainId as 31337|10143,contractAddress:address(v.contractAddress),relayerAddress:address(v.relayerAddress),nonce,
    transactionHash:hash(v.transactionHash),calldataHash:hash(v.calldataHash),signedTransaction:v.signedTransaction as `0x${string}`,
    gasLimit,maxFeePerGas,maxPriorityFeePerGas,operatorDigest:hash(v.operatorDigest),recipientDigest:hash(v.recipientDigest)};}

export function decodeClubPaymentContextV3(raw:unknown,actor:RewardAccountIdentity,s:ClubPaymentScopeV3){
  const r=object(raw,["schema","claimContext","payment","attempt","job","receipt"]);check(r.schema==="raceson-club-payment-private-v3");
  const claimContext=decodeClubClaimContextV3(r.claimContext,actor,{...s,role:"operator"}),claim=claimContext.intent;check(claim);
  const payment=r.payment===null?null:(()=>{const v=object(r.payment,["id","claimId","chainId","relayerAddress","nonce","fees","witness","createdByUserId","createdSessionId","createdAt"]);
    const witness=decodeClubClaimWitnessV3(v.witness),nonce=uint(v.nonce);
    check(v.id===s.paymentId && v.claimId===s.claimId && v.chainId===s.chainId && v.createdByUserId===actor.userId && nonce<=BigInt(Number.MAX_SAFE_INTEGER)
      && witness.entitlementId===claim.entitlementId && witness.nonce===claim.nonce && witness.chainId===s.chainId && witness.campaignAddress===claim.campaignAddress
      && witness.recipientAddress===claim.recipientAddress && witness.amountWei===claim.witness.amountWei && witness.allocationDigest===claim.witness.allocationDigest
      && JSON.stringify(copy(witness.treasury))===JSON.stringify(copy(claim.witness.treasury))
      && witness.finalizedBlock.timestamp>=claim.issuedAt && witness.finalizedBlock.timestamp<claim.expiresAt);
    return {id:uuid(v.id),claimId:uuid(v.claimId),chainId:s.chainId,relayerAddress:address(v.relayerAddress),nonce,fees:decodePaymentFeesV3(v.fees),witness,
      createdByUserId:actor.userId,createdSessionId:uuid(v.createdSessionId),createdAt:time(v.createdAt)};})();
  const attempt=r.attempt===null?null:(()=>{const v=object(r.attempt,["id","paymentId","body","createdByUserId","createdAt"]),body=decodeClubPaymentAttemptV3(v.body);
    check(payment && v.paymentId===payment.id && v.createdByUserId===actor.userId && body.chainId===s.chainId && body.contractAddress===claim.campaignAddress
      && body.relayerAddress===payment.relayerAddress && body.nonce===payment.nonce && body.gasLimit===payment.fees.gasLimit && body.maxFeePerGas===payment.fees.maxFeePerGas
      && body.maxPriorityFeePerGas===payment.fees.maxPriorityFeePerGas
      && body.safeExecutionNonce===claim.witness.treasury.executionNonce
      && body.wrappedRecipientDigest===claimContext.proofs.find(p=>p.role==="recipient")?.proof.wrappedDigest
      && JSON.stringify(copy(body.consentCheckpoint))===JSON.stringify(copy(claimContext.proofs.find(p=>p.role==="recipient")?.witness.finalizedBlock))
      && body.operatorDigest===claimContext.proofs.find(p=>p.role==="operator")?.proof.digest && body.recipientDigest===claimContext.proofs.find(p=>p.role==="recipient")?.proof.digest);
    return {id:uuid(v.id),paymentId:payment.id,body,createdByUserId:actor.userId,createdAt:time(v.createdAt)};})();
  const job=r.job===null?null:decodeRewardOperatorJobV3(r.job,actor.userId,s.paymentId);
  if(job)check(attempt && job.attemptId===attempt.id && job.transactionHash===attempt.body.transactionHash);
  let receipt:null|{payment:Record<string,unknown>;accounting:ReturnType<typeof decodeRewardCampaignObservation>["accounting"]}=null;
  if(r.receipt!==null){const v=object(r.receipt,["payment","accounting"]),p=object(v.payment,["schemaVersion","protocolVersion","action","chainId","contractAddress","relayerAddress","provenance",
    "transactionHash","nonce","blockNumber","blockHash","blockTimestamp","logIndex","safeReceivedLogIndex","entitlementId","recipient","amount","pot","authorizationNonce","allocationDigest",
    "gasLimit","gasUsed","effectiveGasPrice","monadGasLimitFee","runtimeCodeHash","finalizedBlock"]);
    const f=object(p.finalizedBlock,["number","hash","timestamp"]),provenance=object(p.provenance,["kind","programmeAddress","deploymentTransactionHash","slot"]);
    const observation=decodeRewardCampaignObservation({schemaVersion:1,finalizedBlock:f,accounting:v.accounting});
    check(payment && attempt && job?.state==="confirmed" && p.schemaVersion===3 && p.protocolVersion===3 && p.action==="pay_club" && p.chainId===s.chainId
      && p.transactionHash===job.transactionHash && p.contractAddress===claim.campaignAddress && p.relayerAddress===payment.relayerAddress
      && uint(p.nonce)===payment.nonce && p.entitlementId===claim.entitlementId && p.recipient===claim.recipientAddress && uint(p.amount)===claim.witness.amountWei
      && uint(p.authorizationNonce)===claim.nonce && p.allocationDigest===claim.witness.allocationDigest && p.pot===(claimContext.stage!.receipt.provenance.slot===5?"league":"race")
      && provenance.kind==="programme-child" && provenance.programmeAddress===claimContext.stage!.receipt.provenance.programmeAddress
      && provenance.deploymentTransactionHash===claimContext.stage!.receipt.provenance.deploymentTransactionHash && provenance.slot===claimContext.stage!.receipt.provenance.slot
      && uint(p.blockNumber)>payment.witness.finalizedBlock.number && uint(p.blockNumber)<=observation.finalizedBlock.number
      && uint(p.blockTimestamp)>=claim.issuedAt && uint(p.blockTimestamp)<claim.expiresAt && uint(p.blockTimestamp)<=observation.finalizedBlock.timestamp
      && (uint(p.blockNumber)!==observation.finalizedBlock.number || p.blockHash===f.hash && p.blockTimestamp===f.timestamp)
      && uint(p.gasLimit)===attempt.body.gasLimit && uint(p.gasUsed)>0n && uint(p.gasUsed)<=attempt.body.gasLimit && uint(p.effectiveGasPrice)<=attempt.body.maxFeePerGas
      && uint(p.monadGasLimitFee)===attempt.body.gasLimit*uint(p.effectiveGasPrice) && typeof p.logIndex==="number" && Number.isSafeInteger(p.logIndex) && p.logIndex>=0 && Number.isSafeInteger(p.safeReceivedLogIndex) && p.safeReceivedLogIndex===(p.logIndex as number)+1);
    hash(p.blockHash);hash(p.runtimeCodeHash);receipt={payment:copy(p) as Record<string,unknown>,accounting:observation.accounting};
  }
  check((job?.state==="confirmed")===(receipt!==null));return{schema:"raceson-club-payment-private-v3" as const,claimContext,payment,attempt,job,receipt};
}
export type ClubPaymentContextV3=ReturnType<typeof decodeClubPaymentContextV3>;
const safe=new Set(["reward_account_session_required","reward_club_readiness_scope_required","invalid_reward_club_claim_v3","invalid_reward_club_payment_v3","invalid_reward_club_payment_receipt","reward_claim_scope_required","reward_payment_scope_required","invalid_reward_payment_v3",
  "reward_payment_conflict","reward_separate_relayer_required","reward_payment_approvals_required","reward_claim_readiness_required","reward_claim_window_unavailable",
  "reward_claim_observation_stale","reward_claim_observation_regressed","invalid_reward_claim_witness","reward_payment_attempt_required","reward_payment_job_required",
  "reward_payment_lease_lost","reward_payment_execution_unavailable","invalid_reward_payment_receipt","reward_payment_receipt_required"]);
export async function clubPaymentLedgerV3(actor:RewardAccountIdentity,input:ClubPaymentScopeV3,change?:{action:"prepare"|"attempt"|"queue"|"lease"|"arm"|"submitted"|"confirm";payload:unknown},rpc?:RewardLedgerRpc){
  const identity={userId:uuid(actor.userId),sessionId:uuid(actor.sessionId)},s={chainId:input.chainId,uploadId:uuid(input.uploadId),requestId:uuid(input.requestId),
    entitlementId:hash(input.entitlementId),claimId:uuid(input.claimId),paymentId:uuid(input.paymentId)};check(s.chainId===31337 || s.chainId===10143);
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:s.chainId,p_upload_id:s.uploadId,p_request_id:s.requestId,
    p_entitlement_id:s.entitlementId,p_claim_id:s.claimId,p_payment_id:s.paymentId,...(change?{p_action:change.action,p_payload:copy(change.payload)}:{})};
  let r;try{r=await(rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))(change?"service_change_reward_club_payment_v3":"service_read_reward_club_payment_v3",args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const m=(r.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof m==="string"&&safe.has(m)?m:"reward_ledger_unavailable");}
  if(r.data===null){check(change?.action==="lease");return null;}return decodeClubPaymentContextV3(copy(r.data),identity,s);
}
