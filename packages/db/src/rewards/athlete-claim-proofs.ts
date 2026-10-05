import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentArray as array, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardAthleteClaimIntent, decodeRewardClaimWitness } from "./athlete-claims.js";
import { decodeRewardAthleteReviewSubject } from "./athlete-readiness.js";
import { decodeRewardLifecycleUpload } from "./lifecycle-intents.js";
import { decodeRewardCampaignDeployment, decodeRewardCampaignObservation } from "./campaign-checkpoints.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(value:unknown):asserts value {if(!value)throw new RewardLedgerStoreError("invalid_reward_claim_proof_document");}
function role(value:unknown):"recipient"|"operator" {demand(value==="recipient"||value==="operator");return value;}
function key(value:unknown):string {demand(typeof value==="string"&&value.length>=8&&value.length<=128);return value;}
function hash(value:unknown):`0x${string}` {demand(typeof value==="string"&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n);return value as `0x${string}`;}
function address(value:unknown):`0x${string}` {demand(typeof value==="string"&&/^0x[0-9a-f]{40}$/.test(value)&&BigInt(value)>0n);return value as `0x${string}`;}
function signature(value:unknown):`0x${string}` {demand(typeof value==="string"&&/^0x[0-9a-f]{130}$/.test(value));return value as `0x${string}`;}
function timestamp(value:unknown):string {parseRewardSourceTimestamp(value);return value as string;}
const same=(a:unknown,b:unknown)=>JSON.stringify(copy(a))===JSON.stringify(copy(b));
type Input={intentId:string;role:"recipient"|"operator"};
const scope=(identity:RewardAccountIdentity,input:Input)=>({userId:uuid(identity.userId),sessionId:uuid(identity.sessionId),intentId:uuid(input.intentId),role:role(input.role)});
function decodeProof(value:unknown){
  const p=object(value,["proofId","intentId","role","signer","digest","signature","recordedByUserId","recordedSessionId","recordedAt","idempotencyKey","chainWitness"]);
  return {proofId:uuid(p.proofId),intentId:uuid(p.intentId),role:role(p.role),signer:address(p.signer),digest:hash(p.digest),signature:signature(p.signature),
    recordedByUserId:uuid(p.recordedByUserId),recordedSessionId:uuid(p.recordedSessionId),recordedAt:timestamp(p.recordedAt),
    idempotencyKey:key(p.idempotencyKey),chainWitness:decodeRewardClaimWitness(p.chainWitness)};
}
function decode(value:unknown,s:ReturnType<typeof scope>){
  const c=object(value,["actorUserId","role","programmeId","operatorUserId","intent","reviewContext","upload","entitlement","checkpoint","proofs"]);
  demand(c.actorUserId===s.userId&&c.role===s.role);
  const programmeId=uuid(c.programmeId);const operatorUserId=uuid(c.operatorUserId);const intent=decodeRewardAthleteClaimIntent(c.intent);
  demand(intent.intentId===s.intentId&&intent.preparedByUserId===operatorUserId
    &&s.userId===(s.role==="operator"?operatorUserId:intent.recipientUserId));
  const raw=c.reviewContext as Record<string,unknown>;demand(raw&&typeof raw==="object");
  const dest=raw.destination as Record<string,unknown>;demand(dest&&typeof dest==="object");
  const reviewContext=decodeRewardAthleteReviewSubject(raw,operatorUserId,programmeId,uuid(dest.requestId));
  demand(reviewContext.destination.userId===intent.recipientUserId&&reviewContext.destination.address===intent.recipientAddress);
  const u=object(c.upload,["id","allocationId","body"]);const body=decodeRewardLifecycleUpload(u.body);
  const upload={id:uuid(u.id),allocationId:uuid(u.allocationId),body};demand(upload.id===intent.uploadId&&body.chainId===reviewContext.chainId);
  const e=object(c.entitlement,["id","onChainId","beneficiaryId","athleteProfileId","amountWei"]);
  const entitlement={id:uuid(e.id),onChainId:hash(e.onChainId),beneficiaryId:hash(e.beneficiaryId),athleteProfileId:uuid(e.athleteProfileId),amountWei:integer(e.amountWei)};
  demand(entitlement.id===intent.entitlementId&&entitlement.athleteProfileId===reviewContext.destination.athleteProfileId);
  const cp=object(c.checkpoint,["deployment","observation"]);
  const checkpoint={deployment:decodeRewardCampaignDeployment(cp.deployment),observation:decodeRewardCampaignObservation(cp.observation)};
  demand(checkpoint.deployment.chainId===body.chainId&&same(checkpoint.deployment,intent.chainWitness.deployment));
  const award=body.awards.find(a=>a.entitlementId===entitlement.onChainId);
  demand(award&&award.beneficiaryKind===0&&award.beneficiaryId===entitlement.beneficiaryId&&award.amount===entitlement.amountWei);
  const validateWitness=(w:ReturnType<typeof decodeRewardClaimWitness>)=>{
    const accounting=w.observation.accounting;const stamp=w.observation.finalizedBlock.timestamp;
    demand(same(w.deployment,checkpoint.deployment)&&w.recipient===intent.recipientAddress&&w.award.nonce===intent.nonce
      &&w.award.entitlementId===award.entitlementId&&w.award.beneficiaryId===award.beneficiaryId&&w.award.amount===award.amount
      &&w.award.pot===award.pot&&w.award.explanationHash===award.explanationHash
      &&w.observation.accounting.allocationDigest===body.allocationDigest&&w.observation.accounting.state===3&&!w.observation.accounting.paused
      &&w.observation.finalizedBlock.timestamp>=intent.issuedAt&&w.observation.finalizedBlock.timestamp<intent.expiresAt);
    demand(same(accounting.budgets,body.budgets)&&same(accounting.allocated,body.allocated)
      &&accounting.accountedFunding===body.budgets[body.enabledPot]&&accounting.entitlementCount===body.entitlementCount
      &&accounting.snapshotDigest===body.snapshotDigest&&accounting.uploadDigest===body.uploadDigest
      &&accounting.activationNotBefore>=body.sourceReviewEndsAt&&stamp>=accounting.activationNotBefore&&stamp<accounting.claimDeadline);
    const original=intent.chainWitness.observation.finalizedBlock;const block=w.observation.finalizedBlock;
    demand(block.number>=original.number&&block.timestamp>=original.timestamp&&(block.number!==original.number||same(block,original)));
  };
  validateWitness(intent.chainWitness);
  const proofs=array(c.proofs,2,decodeProof);const roles=new Set<string>();
  for(const p of proofs){
    demand(p.intentId===intent.intentId&&!roles.has(p.role)&&p.recordedByUserId===(p.role==="operator"?operatorUserId:intent.recipientUserId)
      &&p.signer===(p.role==="operator"?body.operatorAddress:intent.recipientAddress));
    roles.add(p.role);validateWitness(p.chainWitness);
  }
  demand(!roles.has("operator")||roles.has("recipient"));
  if(proofs.length===2){
    const operator=proofs.find(p=>p.role==="operator")!;const recipient=proofs.find(p=>p.role==="recipient")!;
    const a=operator.chainWitness.observation.finalizedBlock;const b=recipient.chainWitness.observation.finalizedBlock;
    demand(a.number>=b.number&&a.timestamp>=b.timestamp&&(a.number!==b.number||same(a,b)));
  }
  return{actorUserId:s.userId,role:s.role,programmeId,operatorUserId,intent,reviewContext,upload,entitlement,checkpoint,proofs};
}
export type RewardAthleteClaimProofContext=ReturnType<typeof decode>;
/** Strict private composite decoding for atomic payment-context RPCs. */
export function decodeRewardAthleteClaimProofContext(value:unknown,identity:RewardAccountIdentity,input:Input){
  return decode(value,scope(identity,input));
}
const safeErrors=new Set(["reward_account_session_required","reward_operator_permission_required","reward_claim_proof_scope_required",
  "reward_claim_readiness_required","reward_claim_recipient_consent_required","reward_claim_not_live","reward_claim_observation_stale",
  "reward_claim_observation_regressed","invalid_reward_claim_proof","invalid_reward_claim_witness","reward_ledger_idempotency_conflict",
  "reward_review_superseded","reward_review_source_changed","reward_record_approval_withdrawn","reward_record_approval_superseded",
  "reward_record_source_changed","reward_record_source_not_ready"]);
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let r:{data:unknown;error:unknown};try{r=await(rpc??((method,params)=>createAdminSupabaseClient().rpc(method,params)))(name,args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const message=typeof r.error==="object"?(r.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof message==="string"&&safeErrors.has(message)?message:"reward_ledger_store_failed");}return r.data;
}
const args=(s:ReturnType<typeof scope>)=>({p_actor_user_id:s.userId,p_actor_session_id:s.sessionId,p_intent_id:s.intentId,p_role:s.role});
/** Private signatures and DOB: never serialize this context to a browser. */
export async function readRewardAthleteClaimProofs(identity:RewardAccountIdentity,input:Input,rpc?:RewardLedgerRpc){
  const s=scope(identity,input);return decode(await call("service_read_reward_athlete_claim_proofs",args(s),rpc),s);
}
/** Recipient-only pre-signing context with current source/readiness checks.
 * Still contains private signatures/DOB; use an explicit API projection. */
export async function readRewardAthleteConsentContext(identity:RewardAccountIdentity,intentId:string,rpc?:RewardLedgerRpc){
  const s=scope(identity,{intentId,role:"recipient"});
  return decode(await call("service_read_reward_athlete_consent_context",{
    p_actor_user_id:s.userId,p_actor_session_id:s.sessionId,p_intent_id:s.intentId,
  },rpc),s);
}
/** Only an application-verified signature and finalized witness may enter here. */
export async function storeRewardAthleteClaimProof(identity:RewardAccountIdentity,input:Input&{idempotencyKey:string;proof:unknown;witness:unknown;observedAt:string},rpc?:RewardLedgerRpc){
  const s=scope(identity,input);const idempotencyKey=key(input.idempotencyKey);const raw=object(input.proof,["role","signer","digest","signature"]);
  const proof={role:role(raw.role),signer:address(raw.signer),digest:hash(raw.digest),signature:signature(raw.signature)};demand(proof.role===s.role);
  const witness=copy(input.witness);decodeRewardClaimWitness(witness);const observedAt=timestamp(input.observedAt);
  const result=decode(await call("service_record_reward_athlete_claim_proof",{...args(s),p_idempotency_key:idempotencyKey,p_proof:proof,
    p_witness:witness,p_observed_at:observedAt},rpc),s);
  const saved=result.proofs.find(p=>p.role===s.role);
  demand(saved&&saved.idempotencyKey===idempotencyKey&&saved.signature===proof.signature&&saved.digest===proof.digest&&saved.signer===proof.signer);
  return result;
}
