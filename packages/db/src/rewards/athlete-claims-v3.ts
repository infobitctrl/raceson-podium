import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { decodeProgrammeFundingTermsV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as uint, rewardDocumentArray as array } from "./stored-documents.js";
import { decodeReadinessContextV3, type ReadinessScopeV3 } from "./athlete-readiness-v3.js";
import { decodeProgrammeLifecycleBodyV3 } from "./programme-lifecycle-v3.js";
import { decodeProgrammeLifecycleReceiptV3 } from "./programme-lifecycle-jobs-v3.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
export type ClaimScopeV3 = ReadinessScopeV3 & { entitlementId: string; claimId: string };
function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_claim_v3"); }
const hash = (v: unknown) => { if(typeof v!=="string" || !/^0x[0-9a-f]{64}$/.test(v) || BigInt(v)===0n)throw new RewardLedgerStoreError("invalid_reward_claim_v3");return v as `0x${string}`; };
const address = (v: unknown) => { if(typeof v!=="string" || !/^0x[0-9a-f]{40}$/.test(v) || BigInt(v)===0n)throw new RewardLedgerStoreError("invalid_reward_claim_v3");return v as `0x${string}`; };
const guard = (v: unknown) => { if(typeof v!=="string" || !/^[0-9a-f]{64}$/.test(v))throw new RewardLedgerStoreError("invalid_reward_claim_v3");return v; };
const timestamp = (v: unknown) => { parseRewardSourceTimestamp(v); return v as string; };
function args(identity: RewardAccountIdentity,s: ClaimScopeV3) {
  check([31337,10143].includes(s.chainId) && ["operator","recipient"].includes(s.role));
  return {p_actor_user_id:uuid(identity.userId),p_actor_session_id:uuid(identity.sessionId),p_chain_id:s.chainId,
    p_upload_id:uuid(s.uploadId),p_destination_id:uuid(s.destinationId),p_entitlement_id:hash(s.entitlementId),p_claim_id:uuid(s.claimId),p_role:s.role};
}
export function decodeClaimWitnessV3(raw: unknown) {
  const w=object(raw,["protocolVersion","chainId","campaignAddress","stageTransactionHash","allocationDigest","entitlementId","recipientAddress","amountWei","nonce","finalizedBlock","claimDeadline"]);
  check(w.protocolVersion===3 && (w.chainId===31337 || w.chainId===10143));
  const f=object(w.finalizedBlock,["number","hash","timestamp"]),finalizedBlock={number:uint(f.number),hash:hash(f.hash),timestamp:uint(f.timestamp)};
  const amountWei=uint(w.amountWei),nonce=uint(w.nonce),claimDeadline=uint(w.claimDeadline);
  check(amountWei>0n && nonce<(1n<<256n)-1n && finalizedBlock.number>0n && finalizedBlock.timestamp>0n
    && claimDeadline>finalizedBlock.timestamp && claimDeadline<=(1n<<63n)-1n-86400n);
  return {protocolVersion:3 as const,chainId:w.chainId as 31337|10143,campaignAddress:address(w.campaignAddress),stageTransactionHash:hash(w.stageTransactionHash),
    allocationDigest:hash(w.allocationDigest),entitlementId:hash(w.entitlementId),recipientAddress:address(w.recipientAddress),amountWei,nonce,finalizedBlock,claimDeadline};
}
export function decodeClaimIntentV3(raw: unknown) {
  const i=object(raw,["id","uploadId","destinationId","reviewId","entitlementId","chainId","campaignAddress","recipientUserId","recipientAddress",
    "sourceGuardHash","profileFingerprint","witness","nonce","issuedAt","expiresAt","preparedByUserId","preparedSessionId","preparedAt"]);
  const witness=decodeClaimWitnessV3(i.witness),nonce=uint(i.nonce),issuedAt=uint(i.issuedAt),expiresAt=uint(i.expiresAt);
  check(witness.chainId===i.chainId && witness.campaignAddress===i.campaignAddress && witness.recipientAddress===i.recipientAddress
    && witness.entitlementId===i.entitlementId && witness.nonce===nonce && issuedAt===witness.finalizedBlock.timestamp
    && expiresAt===(issuedAt+86400n<witness.claimDeadline?issuedAt+86400n:witness.claimDeadline));
  return {id:uuid(i.id),uploadId:uuid(i.uploadId),destinationId:uuid(i.destinationId),reviewId:uuid(i.reviewId),entitlementId:witness.entitlementId,
    chainId:witness.chainId,campaignAddress:witness.campaignAddress,recipientUserId:uuid(i.recipientUserId),recipientAddress:witness.recipientAddress,
    sourceGuardHash:guard(i.sourceGuardHash),profileFingerprint:guard(i.profileFingerprint),witness,nonce,issuedAt,expiresAt,
    preparedByUserId:uuid(i.preparedByUserId),preparedSessionId:uuid(i.preparedSessionId),preparedAt:timestamp(i.preparedAt)};
}
export function decodeClaimProofV3(raw: unknown) {
  const p=object(raw,["protocolVersion","role","signer","digest","signature"]);
  check(p.protocolVersion===3 && (p.role==="recipient" || p.role==="operator") && typeof p.signature==="string" && /^0x[0-9a-f]{130}$/.test(p.signature));
  return {protocolVersion:3 as const,role:p.role as "recipient"|"operator",signer:address(p.signer),digest:hash(p.digest),signature:p.signature as `0x${string}`};
}
export function decodeClaimContextV3(raw: unknown,identity: RewardAccountIdentity,s: ClaimScopeV3) {
  const r=object(raw,["schema","readiness","package","deployment","stage","activation","intent","proofs"]);
  check(r.schema==="raceson-athlete-claim-private-v3");
  const readiness=decodeReadinessContextV3(r.readiness,identity,s),d=object(r.deployment,["nonce","terms"]);
  const deployment={nonce:uint(d.nonce),terms:decodeProgrammeFundingTermsV3(d.terms)};
  check(deployment.terms.operatorAddress===readiness.source.operatorAddress);
  const stage=r.stage===null?null:(()=>{const v=object(r.stage,["id","body","receipt"]),body=decodeProgrammeLifecycleBodyV3(v.body),receipt=decodeProgrammeLifecycleReceiptV3(v.receipt);
    check(body.action==="stage_allocation" && receipt.action==="stage_allocation" && receipt.provenance.slot===readiness.source.slot-1);
    return{id:uuid(v.id),body,receipt};})();
  const activation=r.activation===null?null:(()=>{const v=object(r.activation,["id","receipt"]),receipt=decodeProgrammeLifecycleReceiptV3(v.receipt);
    check(stage && receipt.action==="activate" && receipt.provenance.slot===stage.receipt.provenance.slot
      && receipt.campaignAddress===stage.receipt.campaignAddress && receipt.blockNumber>=stage.receipt.blockNumber
      && receipt.accountingAtReceiptBlock.allocationDigest===stage.receipt.accountingAtReceiptBlock.allocationDigest);
    return{id:uuid(v.id),receipt};})();
  const intent=r.intent===null?null:decodeClaimIntentV3(r.intent);
  if(intent)check(stage && activation && intent.id===s.claimId && intent.uploadId===s.uploadId && intent.destinationId===s.destinationId
    && intent.entitlementId===s.entitlementId && intent.chainId===s.chainId && intent.recipientAddress===readiness.destination.address
    && intent.recipientUserId===readiness.destination.userId && intent.preparedByUserId===readiness.source.operatorUserId
    && intent.campaignAddress===stage.receipt.campaignAddress && intent.witness.stageTransactionHash===stage.receipt.transactionHash
    && intent.witness.allocationDigest===stage.receipt.accountingAtReceiptBlock.allocationDigest);
  if(s.role==="recipient")check(intent);
  const proofs=array(r.proofs,2,raw=>{const v=object(raw,["role","proof","witness","recordedByUserId","recordedSessionId","recordedAt"]);
    const proof=decodeClaimProofV3(v.proof),witness=decodeClaimWitnessV3(v.witness);
    check(intent && v.role===proof.role && witness.entitlementId===intent.entitlementId && witness.nonce===intent.nonce
      && witness.campaignAddress===intent.campaignAddress && witness.recipientAddress===intent.recipientAddress && witness.chainId===intent.chainId
      && witness.amountWei===intent.witness.amountWei && witness.allocationDigest===intent.witness.allocationDigest
      && witness.finalizedBlock.timestamp>=intent.issuedAt && witness.finalizedBlock.timestamp<intent.expiresAt
      && proof.signer===(proof.role==="operator"?readiness.source.operatorAddress:intent.recipientAddress)
      && v.recordedByUserId===(proof.role==="operator"?intent.preparedByUserId:intent.recipientUserId));
    return {role:proof.role,proof,witness,recordedByUserId:uuid(v.recordedByUserId),recordedSessionId:uuid(v.recordedSessionId),recordedAt:timestamp(v.recordedAt)};});
  check(new Set(proofs.map(p=>p.role)).size===proofs.length && (!proofs.some(p=>p.role==="operator") || proofs.some(p=>p.role==="recipient")));
  return {schema:"raceson-athlete-claim-private-v3" as const,readiness,deployment,package:copy(r.package),stage,activation,intent,proofs};
}
export type ClaimContextV3 = ReturnType<typeof decodeClaimContextV3>;
const safe=new Set(["reward_account_session_required","reward_readiness_scope_required","reward_claim_scope_required","invalid_reward_claim_v3",
  "reward_claim_campaign_not_ready","reward_claim_readiness_required","reward_claim_observation_stale","reward_claim_observation_regressed",
  "invalid_reward_claim_witness","reward_claim_already_prepared","reward_claim_window_unavailable","reward_recipient_consent_required",
  "invalid_reward_claim_proof","reward_ledger_idempotency_conflict"]);
async function call(name: Parameters<RewardLedgerRpc>[0],body: Record<string,unknown>,rpc?: RewardLedgerRpc) {
  let r;try{r=await (rpc??((method,input)=>createAdminSupabaseClient().rpc(method,input)))(name,body);}catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const message=(r.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof message==="string"&&safe.has(message)?message:"reward_ledger_store_failed");}return copy(r.data);
}
export async function readClaimV3(identity: RewardAccountIdentity,s: ClaimScopeV3,rpc?: RewardLedgerRpc) {
  const a=args(identity,s);return decodeClaimContextV3(await call("service_read_reward_claim_v3",a,rpc),{userId:a.p_actor_user_id,sessionId:a.p_actor_session_id},
    {...s,uploadId:a.p_upload_id,destinationId:a.p_destination_id,entitlementId:a.p_entitlement_id,claimId:a.p_claim_id,role:a.p_role,chainId:a.p_chain_id});
}
export async function storeClaimV3(identity: RewardAccountIdentity,s: ClaimScopeV3,input:{reviewId:string;sourceGuardHash:string;profileFingerprint:string;witness:unknown;observedAt:string},rpc?: RewardLedgerRpc) {
  const fixed={...s,role:"operator" as const}, {p_role:_,...a}=args(identity,fixed),witness=copy(input.witness);decodeClaimWitnessV3(witness);
  const body={...a,p_review_id:uuid(input.reviewId),p_source_guard_hash:guard(input.sourceGuardHash),p_profile_fingerprint:guard(input.profileFingerprint),p_witness:witness,p_observed_at:timestamp(input.observedAt)};
  const r=decodeClaimContextV3(await call("service_prepare_reward_claim_v3",body,rpc),{userId:a.p_actor_user_id,sessionId:a.p_actor_session_id},fixed);
  check(r.intent && r.intent.reviewId===body.p_review_id && r.intent.sourceGuardHash===body.p_source_guard_hash && r.intent.profileFingerprint===body.p_profile_fingerprint
    && JSON.stringify(copy(r.intent.witness))===JSON.stringify(copy(decodeClaimWitnessV3(witness))));return r;
}
export async function storeClaimProofV3(identity: RewardAccountIdentity,s: ClaimScopeV3,input:{proof:unknown;witness:unknown;observedAt:string},rpc?: RewardLedgerRpc) {
  const fixed={...s},a=args(identity,fixed),proof=decodeClaimProofV3(copy(input.proof)),witness=copy(input.witness);decodeClaimWitnessV3(witness);
  check(proof.role===s.role);
  const r=decodeClaimContextV3(await call("service_record_reward_claim_proof_v3",{...a,p_proof:proof,p_witness:witness,p_observed_at:timestamp(input.observedAt)},rpc),
    {userId:a.p_actor_user_id,sessionId:a.p_actor_session_id},fixed);
  check(r.proofs.some(p=>p.role===fixed.role && JSON.stringify(copy(p.proof))===JSON.stringify(copy(proof))));return r;
}
/** Recorded history only: never a live claimability, ownership or paid-state lease. */
export async function listOwnClaimsV3(identity:RewardAccountIdentity,chainId:31337|10143,after:string|null=null,rpc?:RewardLedgerRpc) {
  check([31337,10143].includes(chainId));const cursor=after===null?null:uuid(after);
  const r=object(await call("service_list_own_reward_claims_v3",{p_actor_user_id:uuid(identity.userId),p_actor_session_id:uuid(identity.sessionId),
    p_chain_id:chainId,p_after_id:cursor},rpc),["schema","chainId","items","nextCursor"]);
  check(r.schema==="raceson-own-claims-v3" && r.chainId===chainId);let previous=cursor;
  const items=array(r.items,50,raw=>{const v=object(raw,["schema","claimId","uploadId","destinationId","entitlementId","chainId","recipientAddress","amountWei","issuedAt","expiresAt","recipientConsented","operatorApproved"]);
    const claimId=uuid(v.claimId),amountWei=uint(v.amountWei),issuedAt=uint(v.issuedAt),expiresAt=uint(v.expiresAt);
    check(v.schema==="raceson-athlete-claim-record-v3" && v.chainId===chainId && (previous===null || claimId>previous)
      && amountWei>0n && issuedAt>0n && expiresAt>issuedAt && expiresAt<=issuedAt+86400n
      && typeof v.recipientConsented==="boolean" && typeof v.operatorApproved==="boolean" && (!v.operatorApproved || v.recipientConsented));previous=claimId;
    return {schema:"raceson-athlete-claim-record-v3" as const,claimId,uploadId:uuid(v.uploadId),destinationId:uuid(v.destinationId),entitlementId:hash(v.entitlementId),
      chainId,recipientAddress:address(v.recipientAddress),amountWei:amountWei.toString(),issuedAt:issuedAt.toString(),expiresAt:expiresAt.toString(),
      recipientConsented:v.recipientConsented,operatorApproved:v.operatorApproved};});
  const nextCursor=r.nextCursor===null?null:uuid(r.nextCursor);check(nextCursor===null || items.length===50 && nextCursor===previous);
  return {schema:"raceson-own-claims-v3" as const,chainId,items,nextCursor};
}
