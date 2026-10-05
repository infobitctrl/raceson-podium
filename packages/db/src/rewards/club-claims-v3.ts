import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { decodeProgrammeFundingTermsV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as uint, rewardDocumentArray as array } from "./stored-documents.js";
import { decodeClubReadinessContextV3, type ClubReadinessScopeV3 } from "./club-readiness-v3.js";
import { decodeProgrammeLifecycleBodyV3 } from "./programme-lifecycle-v3.js";
import { decodeProgrammeLifecycleReceiptV3 } from "./programme-lifecycle-jobs-v3.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
export type ClubClaimScopeV3 = ClubReadinessScopeV3 & { entitlementId: string; claimId: string };
function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_club_claim_v3"); }
const hash = (v: unknown) => { if(typeof v!=="string" || !/^0x[0-9a-f]{64}$/.test(v) || BigInt(v)===0n)throw new RewardLedgerStoreError("invalid_reward_club_claim_v3");return v as `0x${string}`; };
const address = (v: unknown) => { if(typeof v!=="string" || !/^0x[0-9a-f]{40}$/.test(v) || BigInt(v)===0n)throw new RewardLedgerStoreError("invalid_reward_club_claim_v3");return v as `0x${string}`; };
const guard = (v: unknown) => { if(typeof v!=="string" || !/^[0-9a-f]{64}$/.test(v))throw new RewardLedgerStoreError("invalid_reward_club_claim_v3");return v; };
const timestamp = (v: unknown) => { parseRewardSourceTimestamp(v); return v as string; };
function args(identity: RewardAccountIdentity,s: ClubClaimScopeV3) {
  check([31337,10143].includes(s.chainId) && ["operator","recipient"].includes(s.role));
  return {p_actor_user_id:uuid(identity.userId),p_actor_session_id:uuid(identity.sessionId),p_chain_id:s.chainId,
    p_upload_id:uuid(s.uploadId),p_request_id:uuid(s.requestId),p_entitlement_id:hash(s.entitlementId),p_claim_id:uuid(s.claimId),p_role:s.role};
}
export function decodeClubClaimWitnessV3(raw: unknown) {
  const w=object(raw,["protocolVersion","chainId","campaignAddress","stageTransactionHash","allocationDigest","entitlementId","recipientAddress","amountWei","nonce","finalizedBlock","claimDeadline","treasury"]);
  check(w.protocolVersion===3 && (w.chainId===31337 || w.chainId===10143));
  const f=object(w.finalizedBlock,["number","hash","timestamp"]),finalizedBlock={number:uint(f.number),hash:hash(f.hash),timestamp:uint(f.timestamp)};
  const amountWei=uint(w.amountWei),nonce=uint(w.nonce),claimDeadline=uint(w.claimDeadline);
  check(amountWei>0n && nonce<(1n<<256n)-1n && finalizedBlock.number>0n && finalizedBlock.timestamp>0n
    && claimDeadline>finalizedBlock.timestamp && claimDeadline<=(1n<<63n)-1n-86400n);
  const t=object(w.treasury,["reviewedBlock","deploymentBlock","initializerHash","executionNonce"]);
  const block=(v:unknown)=>{const b=object(v,["number","hash","timestamp"]);const result={number:uint(b.number),hash:hash(b.hash),timestamp:uint(b.timestamp)};
    check(result.number>0n && result.timestamp>0n);return result;};
  const treasury={reviewedBlock:block(t.reviewedBlock),deploymentBlock:block(t.deploymentBlock),initializerHash:hash(t.initializerHash),executionNonce:uint(t.executionNonce)};
  check(treasury.deploymentBlock.number<=treasury.reviewedBlock.number && treasury.reviewedBlock.number<=finalizedBlock.number
    && treasury.deploymentBlock.timestamp<=treasury.reviewedBlock.timestamp && treasury.reviewedBlock.timestamp<=finalizedBlock.timestamp);
  for(const [a,b] of [[treasury.deploymentBlock,treasury.reviewedBlock],[treasury.reviewedBlock,finalizedBlock]])
    check(a.number!==b.number || a.hash===b.hash && a.timestamp===b.timestamp);
  return {treasury,protocolVersion:3 as const,chainId:w.chainId as 31337|10143,campaignAddress:address(w.campaignAddress),stageTransactionHash:hash(w.stageTransactionHash),
    allocationDigest:hash(w.allocationDigest),entitlementId:hash(w.entitlementId),recipientAddress:address(w.recipientAddress),amountWei,nonce,finalizedBlock,claimDeadline};
}
export function decodeClubClaimIntentV3(raw: unknown) {
  const i=object(raw,["id","uploadId","requestId","reviewId","entitlementId","chainId","campaignAddress","recipientUserId","recipientAddress",
    "sourceGuardHash","identityFingerprint","witness","nonce","issuedAt","expiresAt","preparedByUserId","preparedSessionId","preparedAt"]);
  const witness=decodeClubClaimWitnessV3(i.witness),nonce=uint(i.nonce),issuedAt=uint(i.issuedAt),expiresAt=uint(i.expiresAt);
  check(witness.chainId===i.chainId && witness.campaignAddress===i.campaignAddress && witness.recipientAddress===i.recipientAddress
    && witness.entitlementId===i.entitlementId && witness.nonce===nonce && issuedAt===witness.finalizedBlock.timestamp
    && expiresAt===(issuedAt+86400n<witness.claimDeadline?issuedAt+86400n:witness.claimDeadline));
  return {id:uuid(i.id),uploadId:uuid(i.uploadId),requestId:uuid(i.requestId),reviewId:uuid(i.reviewId),entitlementId:witness.entitlementId,
    chainId:witness.chainId,campaignAddress:witness.campaignAddress,recipientUserId:uuid(i.recipientUserId),recipientAddress:witness.recipientAddress,
    sourceGuardHash:guard(i.sourceGuardHash),identityFingerprint:guard(i.identityFingerprint),witness,nonce,issuedAt,expiresAt,
    preparedByUserId:uuid(i.preparedByUserId),preparedSessionId:uuid(i.preparedSessionId),preparedAt:timestamp(i.preparedAt)};
}
export function decodeClubClaimProofV3(raw: unknown) {
  const p=object(raw,["protocolVersion","role","signer","digest","signature","wrappedDigest"]);
  check(p.protocolVersion===3 && (p.role==="recipient" || p.role==="operator") && typeof p.signature==="string" && (p.role==="operator"
    ? /^0x[0-9a-f]{130}$/.test(p.signature) && p.wrappedDigest===null
    : /^0x([0-9a-f]{2}){1,8192}$/.test(p.signature) && typeof p.wrappedDigest==="string"));
  return {protocolVersion:3 as const,role:p.role as "recipient"|"operator",wrappedDigest:p.role==="operator"?null:hash(p.wrappedDigest),signer:address(p.signer),digest:hash(p.digest),signature:p.signature as `0x${string}`};
}
export function decodeClubClaimContextV3(raw: unknown,identity: RewardAccountIdentity,s: ClubClaimScopeV3) {
  const r=object(raw,["schema","readiness","package","deployment","stage","activation","intent","proofs"]);
  check(r.schema==="raceson-club-claim-private-v3");
  const intent=r.intent===null?null:decodeClubClaimIntentV3(r.intent);
  const readiness=decodeClubReadinessContextV3(r.readiness,identity,s,intent?.reviewId??null),d=object(r.deployment,["nonce","terms"]);
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
  if(intent)check(stage && activation && intent.id===s.claimId && intent.uploadId===s.uploadId && intent.requestId===s.requestId
    && intent.entitlementId===s.entitlementId && intent.chainId===s.chainId && intent.recipientAddress===readiness.nomination.candidate.safeAddress
    && intent.recipientUserId===readiness.nomination.userId && intent.preparedByUserId===readiness.source.operatorUserId
    && intent.campaignAddress===stage.receipt.campaignAddress && intent.witness.stageTransactionHash===stage.receipt.transactionHash
    && intent.witness.allocationDigest===stage.receipt.accountingAtReceiptBlock.allocationDigest);
  if(intent) {
    const review=readiness.retryReview;
    check(review && review.id===intent.reviewId && review.sourceGuardHash===intent.sourceGuardHash
      && review.identityFingerprint===intent.identityFingerprint);
    for(const field of ["deploymentBlock","reviewedBlock","initializerHash"] as const)
      check(JSON.stringify(copy(intent.witness.treasury[field]))===JSON.stringify(copy(
        field==="initializerHash"?review.evidence[field]:{number:BigInt(review.evidence[field].number),hash:review.evidence[field].hash,timestamp:BigInt(review.evidence[field].timestamp)})));
  }
  if(s.role==="recipient")check(intent);
  const proofs=array(r.proofs,2,raw=>{const v=object(raw,["role","proof","witness","recordedByUserId","recordedSessionId","recordedAt"]);
    const proof=decodeClubClaimProofV3(v.proof),witness=decodeClubClaimWitnessV3(v.witness);
    check(intent && v.role===proof.role && witness.entitlementId===intent.entitlementId && witness.nonce===intent.nonce
      && witness.campaignAddress===intent.campaignAddress && witness.recipientAddress===intent.recipientAddress && witness.chainId===intent.chainId
      && JSON.stringify(copy(witness.treasury))===JSON.stringify(copy(intent.witness.treasury))
      && witness.stageTransactionHash===intent.witness.stageTransactionHash
      && witness.finalizedBlock.number>=intent.witness.finalizedBlock.number
      && (witness.finalizedBlock.number!==intent.witness.finalizedBlock.number || witness.finalizedBlock.hash===intent.witness.finalizedBlock.hash)
      && witness.amountWei===intent.witness.amountWei && witness.allocationDigest===intent.witness.allocationDigest
      && witness.finalizedBlock.timestamp>=intent.issuedAt && witness.finalizedBlock.timestamp<intent.expiresAt
      && proof.signer===(proof.role==="operator"?readiness.source.operatorAddress:intent.recipientAddress)
      && v.recordedByUserId===(proof.role==="operator"?intent.preparedByUserId:intent.recipientUserId));
    return {role:proof.role,proof,witness,recordedByUserId:uuid(v.recordedByUserId),recordedSessionId:uuid(v.recordedSessionId),recordedAt:timestamp(v.recordedAt)};});
  check(new Set(proofs.map(p=>p.role)).size===proofs.length && (!proofs.some(p=>p.role==="operator") || proofs.some(p=>p.role==="recipient")));
  return {schema:"raceson-club-claim-private-v3" as const,readiness,deployment,package:copy(r.package),stage,activation,intent,proofs};
}
export type ClubClaimContextV3 = ReturnType<typeof decodeClubClaimContextV3>;
const safe=new Set(["reward_account_session_required","reward_club_readiness_scope_required","reward_claim_scope_required","invalid_reward_club_claim_v3",
  "reward_claim_campaign_not_ready","reward_claim_readiness_required","reward_claim_observation_stale","reward_claim_observation_regressed",
  "invalid_reward_claim_witness","reward_claim_already_prepared","reward_claim_window_unavailable","reward_recipient_consent_required",
  "invalid_reward_claim_proof","reward_ledger_idempotency_conflict"]);
async function call(name: Parameters<RewardLedgerRpc>[0],body: Record<string,unknown>,rpc?: RewardLedgerRpc) {
  let r;try{r=await (rpc??((method,input)=>createAdminSupabaseClient().rpc(method,input)))(name,body);}catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const message=(r.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof message==="string"&&safe.has(message)?message:"reward_ledger_store_failed");}return copy(r.data);
}
export async function readClubClaimV3(identity: RewardAccountIdentity,s: ClubClaimScopeV3,rpc?: RewardLedgerRpc) {
  const a=args(identity,s);return decodeClubClaimContextV3(await call("service_read_reward_club_claim_v3",a,rpc),{userId:a.p_actor_user_id,sessionId:a.p_actor_session_id},
    {...s,uploadId:a.p_upload_id,requestId:a.p_request_id,entitlementId:a.p_entitlement_id,claimId:a.p_claim_id,role:a.p_role,chainId:a.p_chain_id});
}
export async function storeClubClaimV3(identity: RewardAccountIdentity,s: ClubClaimScopeV3,input:{reviewId:string;sourceGuardHash:string;identityFingerprint:string;witness:unknown;observedAt:string},rpc?: RewardLedgerRpc) {
  const fixed={...s,role:"operator" as const}, {p_role:_,...a}=args(identity,fixed),witness=copy(input.witness);decodeClubClaimWitnessV3(witness);
  const body={...a,p_review_id:uuid(input.reviewId),p_source_guard_hash:guard(input.sourceGuardHash),p_identity_fingerprint:guard(input.identityFingerprint),p_witness:witness,p_observed_at:timestamp(input.observedAt)};
  const r=decodeClubClaimContextV3(await call("service_prepare_reward_club_claim_v3",body,rpc),{userId:a.p_actor_user_id,sessionId:a.p_actor_session_id},fixed);
  check(r.intent && r.intent.reviewId===body.p_review_id && r.intent.sourceGuardHash===body.p_source_guard_hash && r.intent.identityFingerprint===body.p_identity_fingerprint
    && JSON.stringify(copy(r.intent.witness))===JSON.stringify(copy(decodeClubClaimWitnessV3(witness))));return r;
}
export async function storeClubClaimProofV3(identity: RewardAccountIdentity,s: ClubClaimScopeV3,input:{proof:unknown;witness:unknown;observedAt:string},rpc?: RewardLedgerRpc) {
  const fixed={...s},a=args(identity,fixed),proof=decodeClubClaimProofV3(copy(input.proof)),witness=copy(input.witness);decodeClubClaimWitnessV3(witness);
  check(proof.role===s.role);
  const r=decodeClubClaimContextV3(await call("service_record_reward_club_claim_proof_v3",{...a,p_proof:proof,p_witness:witness,p_observed_at:timestamp(input.observedAt)},rpc),
    {userId:a.p_actor_user_id,sessionId:a.p_actor_session_id},fixed);
  check(r.proofs.some(p=>p.role===fixed.role && JSON.stringify(copy(p.proof))===JSON.stringify(copy(proof))));return r;
}
