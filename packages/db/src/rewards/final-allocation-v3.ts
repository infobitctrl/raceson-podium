import { decodeFinalAllocationDocumentV3 } from "@raceson/domain/rewards/final-allocation-document-v3";
import { canonicalRewardProposalV2 as canonical } from "@raceson/domain/rewards/frozen-proposal-v2";
import { createAdminSupabaseClient } from "../supabase.js";
import { decodeLeaguePublicationFactsV3 } from "./league-publication-v3.js";
import { decodeProgrammeRegistryV3 } from "./programme-jobs-v3.js";
import { allocationDocumentHashV3 } from "./allocation-approvals-v3.js";
import { decodeAllocationUploadWithDocumentV3, type AllocationUploadChangeV3 } from "./allocation-upload-v3.js";
import { copyRewardLedgerDocument as copy, RewardLedgerStoreError, type RewardLedgerRpc } from "./programme-ledger.js";
import { rewardDocumentObject as object, rewardDocumentUuid as uuid } from "./stored-documents.js";
import type { RewardAccountIdentity } from "./athlete-wallets.js";
export type FinalAllocationStoreScopeV3 = { chainId:31337|10143;draftId:string;slot:5|6;requestId?:string };
export type FinalAllocationUploadScopeV3 = Omit<FinalAllocationStoreScopeV3,"requestId"> & {approvalId:string};
function check(v:unknown):asserts v {if(!v)throw new RewardLedgerStoreError("invalid_reward_final_allocation");}
const hash=(v:unknown)=>{check(typeof v==="string"&&/^[0-9a-f]{64}$/.test(v));return v;};
const safe=new Set(["reward_account_session_required","reward_planning_not_found","reward_planning_revision_changed","reward_historical_source_missing",
  "invalid_reward_final_allocation","reward_allocation_approval_conflict","reward_allocation_not_ready","reward_allocation_upload_not_found",
  "reward_allocation_upload_conflict","invalid_reward_allocation_upload"]);
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
  let r;try{r=await(rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))(name,args);}
  catch{throw new RewardLedgerStoreError("reward_ledger_unavailable");}
  if(r.error){const m=(r.error as {message?:unknown}).message;throw new RewardLedgerStoreError(typeof m==="string"&&safe.has(m)?m:"reward_ledger_unavailable");}
  return copy(r.data);
}
function base(identity:RewardAccountIdentity,scope:FinalAllocationStoreScopeV3){
  check([31337,10143].includes(scope.chainId)&&[5,6].includes(scope.slot));
  return{p_actor_user_id:uuid(identity.userId),p_actor_session_id:uuid(identity.sessionId),p_chain_id:scope.chainId,p_draft_id:uuid(scope.draftId),p_slot:scope.slot};
}
function approval(value:unknown,scope:FinalAllocationStoreScopeV3,contextHash:string,currentId:string|null){
  if(value===null)return null;
  const r=object(value,["id","previousApprovalId","contextHash","documentHash","document","approvedAt","approvedByUserId","current"]);
  const document=decodeFinalAllocationDocumentV3(r.document),documentHash=hash(r.documentHash);
  check(document.record.draftId===scope.draftId&&document.record.chainId===scope.chainId&&document.slot===scope.slot
    &&allocationDocumentHashV3(document)===documentHash&&r.current===(r.contextHash===contextHash&&r.id===currentId)
    &&typeof r.approvedAt==="string"&&Number.isFinite(Date.parse(r.approvedAt)));
  return{id:uuid(r.id),previousApprovalId:r.previousApprovalId===null?null:uuid(r.previousApprovalId),contextHash:hash(r.contextHash),documentHash,
    document,approvedAt:new Date(r.approvedAt).toISOString(),approvedByUserId:uuid(r.approvedByUserId),current:r.current as boolean};
}
async function invoke(identity:RewardAccountIdentity,scope:FinalAllocationStoreScopeV3,
  change?:{expectedApprovalId:string|null;contextHash:string;document:unknown;funding:unknown},rpc?:RewardLedgerRpc){
  const args={...base(identity,scope),p_request_id:scope.requestId?uuid(scope.requestId):null};
  if(change){check(args.p_request_id);decodeFinalAllocationDocumentV3(change.document);}
  const r=object(await call(change?"service_approve_reward_final_allocation_v3":"service_read_reward_final_allocation_v3",{
    ...args,...(change?{p_expected_approval_id:change.expectedApprovalId===null?null:uuid(change.expectedApprovalId),p_context_hash:hash(change.contextHash),
      p_document_text:canonical(copy(change.document)),p_funding:copy(change.funding)}:{})},rpc),["contextHash","source","registry","approval","recorded"]);
  const contextHash=hash(r.contextHash),source=decodeLeaguePublicationFactsV3(r.source,identity,{...scope,requestId:null});
  const currentId=r.approval===null?null:uuid((r.approval as Record<string,unknown>).id);
  const registry=decodeProgrammeRegistryV3(r.registry,scope),latest=approval(r.approval,scope,contextHash,currentId),recorded=approval(r.recorded,scope,contextHash,currentId);
  if(recorded)check(recorded.id===args.p_request_id&&recorded.approvedByUserId===args.p_actor_user_id);
  return{contextHash,source,registry,approval:latest,recorded};
}
export const readFinalAllocationApprovalV3=(identity:RewardAccountIdentity,scope:FinalAllocationStoreScopeV3,rpc?:RewardLedgerRpc)=>invoke(identity,scope,undefined,rpc);
export const storeFinalAllocationApprovalV3=(identity:RewardAccountIdentity,scope:FinalAllocationStoreScopeV3,
  change:{expectedApprovalId:string|null;contextHash:string;document:unknown;funding:unknown},rpc?:RewardLedgerRpc)=>invoke(identity,scope,change,rpc);

/** Stable private salts and recipient mappings; never expose this export via HTTP. */
async function upload(identity:RewardAccountIdentity,scope:FinalAllocationUploadScopeV3,change:(AllocationUploadChangeV3&{package:unknown})|undefined,rpc?:RewardLedgerRpc){
  const args={...base(identity,scope),p_approval_id:uuid(scope.approvalId)};
  const write=change?{p_request_id:uuid(change.requestId),p_context_hash:hash(change.contextHash),p_document_hash:hash(change.documentHash),
    p_package_text:canonical(copy(change.package))}:null;
  const raw=await call(write?"service_prepare_reward_final_allocation_upload_v3":"service_read_reward_final_allocation_upload_v3",{...args,...write},rpc);
  const d=decodeFinalAllocationUploadV3(raw,scope);
  if(write)check(d.prepared?.id===write.p_request_id&&d.prepared.preparedByUserId===args.p_actor_user_id
    &&d.prepared.contextHash===write.p_context_hash&&d.prepared.documentHash===write.p_document_hash&&canonical(d.prepared.package)===write.p_package_text);
  return d;
}
export function decodeFinalAllocationUploadV3(value:unknown,scope:FinalAllocationUploadScopeV3){
  return decodeAllocationUploadWithDocumentV3(value,scope,decodeFinalAllocationDocumentV3,[5,6]);
}
export const readFinalAllocationUploadV3=(identity:RewardAccountIdentity,scope:FinalAllocationUploadScopeV3,rpc?:RewardLedgerRpc)=>upload(identity,scope,undefined,rpc);
export const storeFinalAllocationUploadV3=(identity:RewardAccountIdentity,scope:FinalAllocationUploadScopeV3,change:AllocationUploadChangeV3&{package:unknown},rpc?:RewardLedgerRpc)=>upload(identity,scope,change,rpc);
