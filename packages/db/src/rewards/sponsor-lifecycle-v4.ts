import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError,copyRewardLedgerDocument as copy,type RewardLedgerRpc} from "./programme-ledger.js";
import {rewardDocumentObject as object,rewardDocumentUuid as uuid,rewardDocumentArray as array} from "./stored-documents.js";
import {decodeSponsorUploadFactsV4,type SponsorUploadScopeV4} from "./sponsor-upload-v4.js";
import {sponsorAllocationDocumentHashV4 as digest} from "./sponsor-allocation-v4.js";
import {canonicalRewardProposalV2 as canonical} from "@raceson/domain/rewards/frozen-proposal-v2";
import type {RewardAccountIdentity} from "./athlete-wallets.js";
export async function sponsorLifecycleFactsV4(actor:RewardAccountIdentity,s:SponsorUploadScopeV4,
 write?:{requestId:string;kind:"publication"|"receipt";body:unknown},rpc?:RewardLedgerRpc) {
 const args={p_actor_user_id:uuid(actor.userId),p_actor_session_id:uuid(actor.sessionId),p_chain_id:s.chainId,p_setup_id:uuid(s.setupId),p_slot:s.slot,p_approval_id:uuid(s.approvalId),
  p_request_id:write?uuid(write.requestId):null,p_kind:write?.kind??null,p_body_text:write?canonical(copy(write.body)):null};
 const r=await(rpc??((name,args)=>createAdminSupabaseClient().rpc(name,args)))("service_reward_sponsor_lifecycle_v4",args);
 if(r.error){const m=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError(new Set(["reward_account_session_required","reward_planning_not_found","reward_setup_not_found","reward_sponsor_upload_required","reward_sponsor_source_not_ready","reward_planning_revision_changed","reward_sponsor_lifecycle_conflict","invalid_sponsor_lifecycle", "reward_demo_account_required", "reward_demo_reviewer_required"]).has(m)?m:"reward_ledger_unavailable");}
 return decodeSponsorLifecycleFactsV4(r.data,s);
}
export function decodeSponsorLifecycleFactsV4(value:unknown,s:SponsorUploadScopeV4) {
 const v=object(value,["upload","publication","receipts"]);
 const upload=decodeSponsorUploadFactsV4(v.upload,s);
 const publication=v.publication===null?null:(()=>{const p=object(v.publication,["id","body","bodyHash","current","createdAt"]);
  if(p.bodyHash!==digest(p.body)||typeof p.current!=="boolean"||typeof p.createdAt!=="string")throw new RewardLedgerStoreError("invalid_sponsor_lifecycle");
  return{id:uuid(p.id),body:object(p.body,["schema","approvalId","contextHash","packageHash","evidence","timing"]),bodyHash:p.bodyHash as string,current:p.current,createdAt:p.createdAt};})();
 const receipts=array(v.receipts,10000,row=>{const r=object(row,["id","body"]);return{id:uuid(r.id),body:object(r.body,["action","start","end","transactionHash","blockNumber","blockHash","blockTimestamp","allocationDigest","campaignAddress"])};});
 return{upload,publication,receipts};
}
