import { decodeProgrammeApprovalV3, decodeProgrammeFundingTermsV3 } from "@raceson/domain/rewards/programme-approval-v3";
import { decodeRewardProgrammeDraftV2 } from "@raceson/domain/rewards/programme-draft-v2";
import { createAdminSupabaseClient } from "../supabase.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
import { RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid, rewardDocumentInteger as integer } from "./stored-documents.js";

function check(v: unknown): asserts v { if (!v) throw new RewardLedgerStoreError("invalid_reward_programme_deployment"); }
const hash=(v:unknown)=>{check(typeof v==="string"&&/^[0-9a-f]{64}$/.test(v));return v};
const safe=new Set(["reward_account_session_required","reward_planning_not_found","reward_programme_approval_required",
  "reward_programme_deployment_conflict","invalid_reward_programme_deployment","reward_deployment_nonce_exhausted","reward_separate_relayer_required"]);
export function decodeProgrammeDeploymentV3(value:unknown) {
  const b=object(value,["schema","approvalView","intent"]);check(b.schema==="raceson-programme-deployment-v3");
  const approvalView=decodeProgrammeApprovalV3(b.approvalView);
  if(b.intent===null)return{approvalView,intent:null};
  const i=object(b.intent,["id","approvalId","contextHash","rules","terms","chainId","operatorAddress","nonce","maximumGasCostWei","creationCodeHash","createdByUserId","createdAt","current"]);
  const terms=decodeProgrammeFundingTermsV3(i.terms),rules=decodeRewardProgrammeDraftV2(i.rules);
  const nonce=integer(i.nonce),maximumGasCostWei=integer(i.maximumGasCostWei),approvalId=uuid(i.approvalId),contextHash=hash(i.contextHash);
  check(i.chainId===approvalView.record.chainId&&i.operatorAddress===terms.operatorAddress&&nonce<=BigInt(Number.MAX_SAFE_INTEGER)&&maximumGasCostWei>0n
    &&i.creationCodeHash==="0x224d0de436541933a7cd8c4967702e3ccde77bc3f01af5eb9f62f12269b066e4"
    &&typeof i.createdAt==="string"&&Number.isFinite(Date.parse(i.createdAt))&&typeof i.current==="boolean"
    &&i.current===(approvalView.approval?.id===approvalId&&approvalView.contextHash===contextHash));
  if(i.current)check(JSON.stringify(rules)===JSON.stringify(approvalView.record.rules)&&JSON.stringify(terms)===JSON.stringify(approvalView.approval!.terms));
  return{approvalView,intent:{id:uuid(i.id),approvalId,contextHash,rules,terms,nonce,maximumGasCostWei,
    creationCodeHash:i.creationCodeHash,createdByUserId:uuid(i.createdByUserId),createdAt:i.createdAt,current:i.current}};
}
export type ProgrammeDeploymentContextV3=ReturnType<typeof decodeProgrammeDeploymentV3>;
export type ProgrammeDeploymentReservationV3={requestId:string;approvalId:string;contextHash:string;pendingNonce:bigint;maximumGasCostWei:bigint};
/** Private operator preparation only, not an HTTP route or send capability. */
export async function rewardProgrammeDeploymentV3(identity:RewardAccountIdentity,chainId:31337|10143,draftId:string,
  reservation?:ProgrammeDeploymentReservationV3,rpc?:RewardLedgerRpc) {
  const actor=uuid(identity.userId),session=uuid(identity.sessionId),draft=uuid(draftId);
  check(chainId===31337||chainId===10143);
  const r=reservation?{requestId:uuid(reservation.requestId),approvalId:uuid(reservation.approvalId),contextHash:hash(reservation.contextHash),
    pendingNonce:reservation.pendingNonce,maximumGasCostWei:reservation.maximumGasCostWei}:null;
  if(r)check(typeof r.pendingNonce==="bigint"&&r.pendingNonce>=0n&&r.pendingNonce<=BigInt(Number.MAX_SAFE_INTEGER)
    &&typeof r.maximumGasCostWei==="bigint"&&r.maximumGasCostWei>0n&&r.maximumGasCostWei<(1n<<256n));
  const args={p_actor_user_id:actor,p_actor_session_id:session,p_chain_id:chainId,p_draft_id:draft,...(r?{
    p_request_id:r.requestId,p_approval_id:r.approvalId,p_context_hash:r.contextHash,p_pending_nonce:r.pendingNonce.toString(),p_maximum_gas_cost_wei:r.maximumGasCostWei.toString()}: {})};
  let response;try{response=await(rpc??((name,input)=>createAdminSupabaseClient().rpc(name,input)))(r?"service_reserve_reward_programme_deployment_v3":"service_read_reward_programme_deployment_v3",args)}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable")}
  if(response.error){const m=(response.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof m==="string"&&safe.has(m)?m:"reward_ledger_unavailable")}
  const result=decodeProgrammeDeploymentV3(response.data);
  check(result.approvalView.record.chainId===chainId&&result.approvalView.record.draftId===draft);
  if(r)check(result.intent?.id===r.requestId&&result.intent.approvalId===r.approvalId&&result.intent.contextHash===r.contextHash
    &&result.intent.createdByUserId===actor&&result.intent.maximumGasCostWei===r.maximumGasCostWei);
  return result;
}
