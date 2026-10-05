import { parseRewardSourceTimestamp } from "@raceson/domain/rewards";
import { createAdminSupabaseClient } from "../supabase.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";
import { decodeRewardAthleteReviewContext } from "./athlete-readiness.js";
import { decodeRewardLifecycleContext } from "./lifecycle-intents.js";
import { decodeRewardCampaignDeployment, decodeRewardCampaignObservation } from "./campaign-checkpoints.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";

function demand(value: unknown): asserts value { if(!value)throw new RewardLedgerStoreError("invalid_reward_claim_document"); }
function key(value: unknown): string { demand(typeof value==="string" && value.length>=8 && value.length<=128); return value; }
function hash(value: unknown): `0x${string}` { demand(typeof value==="string" && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value)>0n);return value as `0x${string}`; }
function address(value: unknown): `0x${string}` { demand(typeof value==="string" && /^0x[0-9a-f]{40}$/.test(value) && BigInt(value)>0n);return value as `0x${string}`; }
function timestamp(value: unknown): string { parseRewardSourceTimestamp(value);return value as string; }
type Input={reviewId:string;entitlementId:string;idempotencyKey?:string};
function scope(identity:RewardAccountIdentity,input:Input){return{userId:uuid(identity.userId),sessionId:uuid(identity.sessionId),
  reviewId:uuid(input.reviewId),entitlementId:uuid(input.entitlementId),idempotencyKey:input.idempotencyKey===undefined?null:key(input.idempotencyKey)};}
export function decodeRewardClaimWitness(value: unknown) {
  const w=object(value,["deployment","observation","award","recipient"]);
  const deployment=decodeRewardCampaignDeployment(w.deployment);const observation=decodeRewardCampaignObservation(w.observation);
  const a=object(w.award,["entitlementId","beneficiaryId","pot","amount","explanationHash","beneficiaryKind","nonce","paid"]);
  demand((a.pot===0||a.pot===1) && a.beneficiaryKind===0 && a.paid===false);
  const amount=integer(a.amount);const nonce=integer(a.nonce);demand(amount>0n && nonce<(1n<<256n)-1n);
  return{deployment,observation,award:{entitlementId:hash(a.entitlementId),beneficiaryId:hash(a.beneficiaryId),pot:a.pot as 0|1,
    amount,explanationHash:hash(a.explanationHash),beneficiaryKind:0 as const,nonce,paid:false as const},recipient:address(w.recipient)};
}
/** Format and historical witness validation only; callers must bind its scope. */
export function decodeRewardAthleteClaimIntent(value: unknown) {
  const i=object(value,["intentId","campaignId","entitlementId","readinessReviewId","uploadId","recipientUserId","recipientAddress",
    "nonce","issuedAt","expiresAt","preparedByUserId","preparedSessionId","preparedAt","idempotencyKey","chainWitness"]);
  const chainWitness=decodeRewardClaimWitness(i.chainWitness);const nonce=integer(i.nonce);
  const issuedAt=integer(i.issuedAt);const expiresAt=integer(i.expiresAt);const recipientAddress=address(i.recipientAddress);
  demand(chainWitness.recipient===recipientAddress && chainWitness.award.nonce===nonce
    && chainWitness.observation.accounting.state===3 && !chainWitness.observation.accounting.paused
    && issuedAt===chainWitness.observation.finalizedBlock.timestamp && expiresAt>issuedAt && expiresAt<(1n<<64n)
    && expiresAt===(issuedAt+86400n<chainWitness.observation.accounting.claimDeadline?issuedAt+86400n:chainWitness.observation.accounting.claimDeadline));
  return {intentId:uuid(i.intentId),campaignId:uuid(i.campaignId),entitlementId:uuid(i.entitlementId),readinessReviewId:uuid(i.readinessReviewId),
    uploadId:uuid(i.uploadId),recipientUserId:uuid(i.recipientUserId),recipientAddress,nonce,issuedAt,expiresAt,
    preparedByUserId:uuid(i.preparedByUserId),preparedSessionId:uuid(i.preparedSessionId),preparedAt:timestamp(i.preparedAt),
    idempotencyKey:key(i.idempotencyKey),chainWitness};
}
function decode(value:unknown,s:ReturnType<typeof scope>){
  const raw=object(value,["reviewContext","lifecycleContext","entitlement","intent"]);
  const rc=raw.reviewContext as Record<string,unknown>;demand(rc && typeof rc==="object");
  const destination=rc.destination as Record<string,unknown>;demand(destination && typeof destination==="object");
  const reviewContext=decodeRewardAthleteReviewContext(rc,s,uuid(rc.programmeId),uuid(destination.requestId));
  const lc=raw.lifecycleContext as Record<string,unknown>;demand(lc && typeof lc==="object");
  const d=lc.deploymentContext as Record<string,unknown>;const u=lc.upload as Record<string,unknown>;demand(d&&u);
  const lifecycleContext=decodeRewardLifecycleContext(lc,{campaignId:uuid(d.campaignId),actorUserId:s.userId,uploadId:uuid(u.id),intentId:null,idempotencyKey:null});
  demand(lifecycleContext.deploymentContext.programmeId===reviewContext.programmeId && lifecycleContext.deploymentContext.chainId===reviewContext.chainId);
  const e=object(raw.entitlement,["id","onChainId","beneficiaryId","athleteProfileId","amountWei"]);
  demand(e.id===s.entitlementId && e.athleteProfileId===reviewContext.destination.athleteProfileId);
  const entitlement={id:s.entitlementId,onChainId:hash(e.onChainId),beneficiaryId:hash(e.beneficiaryId),athleteProfileId:uuid(e.athleteProfileId),amountWei:integer(e.amountWei)};
  const award=lifecycleContext.upload.body.awards.find(a=>a.entitlementId===entitlement.onChainId);
  demand(award && award.beneficiaryKind===0 && award.amount===entitlement.amountWei && award.beneficiaryId===entitlement.beneficiaryId);
  let intent=null;
  if(raw.intent!==null){
    const i=decodeRewardAthleteClaimIntent(raw.intent);
    demand(i.campaignId===d.campaignId && i.entitlementId===s.entitlementId && i.readinessReviewId===s.reviewId && i.uploadId===u.id
      && i.recipientUserId===reviewContext.destination.userId && i.recipientAddress===reviewContext.destination.address
      && i.preparedByUserId===s.userId && (s.idempotencyKey===null||i.idempotencyKey===s.idempotencyKey));
    const w=i.chainWitness;const {issuedAt,expiresAt,nonce}=i;
    const checkpoint=lifecycleContext.checkpoint;
    demand(checkpoint && JSON.stringify(copy(w.deployment))===JSON.stringify(copy(checkpoint.deployment))
      && w.award.entitlementId===entitlement.onChainId && w.award.beneficiaryId===entitlement.beneficiaryId
      && w.award.amount===entitlement.amountWei && w.award.explanationHash===award.explanationHash && w.award.pot===award.pot
      && w.recipient===i.recipientAddress && w.award.nonce===nonce && w.observation.accounting.allocationDigest===lifecycleContext.upload.body.allocationDigest
      && w.observation.accounting.state===3 && !w.observation.accounting.paused
      && issuedAt===w.observation.finalizedBlock.timestamp && expiresAt>issuedAt && expiresAt-issuedAt<=86400n
      && expiresAt<(1n<<64n) && expiresAt===(issuedAt+86400n<w.observation.accounting.claimDeadline
        ?issuedAt+86400n:w.observation.accounting.claimDeadline));
    intent={intentId:uuid(i.intentId),campaignId:uuid(i.campaignId),entitlementId:s.entitlementId,readinessReviewId:s.reviewId,uploadId:uuid(i.uploadId),
      recipientUserId:uuid(i.recipientUserId),recipientAddress:address(i.recipientAddress),nonce,issuedAt,expiresAt,preparedByUserId:s.userId,
      preparedSessionId:uuid(i.preparedSessionId),preparedAt:timestamp(i.preparedAt),idempotencyKey:key(i.idempotencyKey),chainWitness:w};
  }
  return{reviewContext,lifecycleContext,entitlement,intent};
}
export type RewardAthleteClaimContext=ReturnType<typeof decode>;
const safeErrors=new Set(["reward_account_session_required","reward_operator_permission_required","reward_claim_scope_required",
  "reward_claim_identity_mapping_required","reward_claim_campaign_not_ready","invalid_reward_claim_request","invalid_reward_claim_witness",
  "reward_claim_observation_regressed","reward_claim_observation_stale","reward_claim_nonce_exhausted","reward_claim_already_prepared",
  "reward_claim_readiness_required","reward_ledger_idempotency_conflict","reward_review_superseded","reward_review_source_changed",
  "reward_record_approval_withdrawn","reward_record_approval_superseded","reward_record_source_changed","reward_record_source_not_ready"]);
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let r:{data:unknown;error:unknown};try{r=await(rpc??((method,params)=>createAdminSupabaseClient().rpc(method,params)))(name,args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const message=typeof r.error==="object"?(r.error as Record<string,unknown>).message:null;
    throw new RewardLedgerStoreError(typeof message==="string"&&safeErrors.has(message)?message:"reward_ledger_store_failed");}return r.data;
}
const args=(s:ReturnType<typeof scope>)=>({p_actor_user_id:s.userId,p_actor_session_id:s.sessionId,p_review_id:s.reviewId,
  p_entitlement_id:s.entitlementId,p_idempotency_key:s.idempotencyKey});
export async function readRewardAthleteClaimContext(identity:RewardAccountIdentity,input:Input,rpc?:RewardLedgerRpc){
  const s=scope(identity,input);return decode(await call("service_read_reward_athlete_claim_context",args(s),rpc),s);
}
/** Called only after verified worker observation, never with a browser witness. */
export async function storeRewardAthleteClaimIntent(identity:RewardAccountIdentity,input:Input&{idempotencyKey:string;witness:unknown;observedAt:string},rpc?:RewardLedgerRpc){
  const s=scope(identity,input);const witness=copy(input.witness);decodeRewardClaimWitness(witness);const observedAt=timestamp(input.observedAt);
  const result=decode(await call("service_prepare_reward_athlete_claim",{...args(s),p_witness:witness,p_observed_at:observedAt},rpc),s);
  demand(result.intent!==null);return result;
}
