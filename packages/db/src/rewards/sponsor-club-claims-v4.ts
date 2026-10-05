import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError,copyRewardLedgerDocument as copy,type RewardLedgerRpc} from "./programme-ledger.js";
import {rewardDocumentObject as object,rewardDocumentUuid as uuid} from "./stored-documents.js";
import {decodeSponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import {canonicalRewardProposalV2 as canonical} from "@raceson/domain/rewards/frozen-proposal-v2";
import {sponsorAllocationDocumentHashV4 as digest} from "./sponsor-allocation-v4.js";
import {type RewardAccountIdentity} from "./athlete-wallets.js";
import {decodeRewardClubTreasuryDocument} from "./club-treasuries.js";
export type SponsorClubClaimScopeV4={chainId:31337|10143;claimId:string;role:"recipient"|"operator"};
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
 const r=await(rpc??((n,a)=>createAdminSupabaseClient().rpc(n,a)))(name,args);
 if(r.error){const m=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError(new Set(["reward_account_session_required","reward_claim_scope_required","invalid_sponsor_claim","reward_sponsor_claim_conflict","reward_sponsor_claim_not_ready","reward_planning_revision_changed","reward_recipient_consent_required"]).has(m)?m:"reward_ledger_unavailable");}return copy(r.data);
}
export async function sponsorClubClaimFactsV4(actor:RewardAccountIdentity,s:SponsorClubClaimScopeV4,write?:{action:string;body:unknown},rpc?:RewardLedgerRpc){
 const v=object(await call("service_sponsor_club_claim_v4",{p_actor_user_id:uuid(actor.userId),p_actor_session_id:uuid(actor.sessionId),p_chain_id:s.chainId,p_claim_id:uuid(s.claimId),p_role:s.role,
  p_action:write?.action??null,p_body_text:write?canonical(copy(write.body)):null},rpc),["claimId","entitlementId","approvalId","setupId","slot","current","sourceStamp","profileFingerprint","nomination","package","packageHash","plan","publication","events"]);
 const d=v.nomination as {userId:string},nomination=decodeRewardClubTreasuryDocument(v.nomination,{userId:d.userId,chainId:s.chainId});
 if(v.claimId!==s.claimId||typeof v.current!=="boolean"||nomination.chainId!==s.chainId||s.role==="recipient"&&nomination.userId!==actor.userId
  ||v.packageHash!==digest(v.package)||![v.sourceStamp,v.profileFingerprint].every(h=>typeof h==="string"&&/^[0-9a-f]{64}$/.test(h)))throw new RewardLedgerStoreError("invalid_sponsor_claim");
 return{claimId:uuid(v.claimId),entitlementId:v.entitlementId as `0x${string}`,approvalId:uuid(v.approvalId),setupId:uuid(v.setupId),slot:Number(v.slot),current:v.current,sourceStamp:v.sourceStamp as string,profileFingerprint:v.profileFingerprint as string,
 nomination,package:v.package as Record<string,unknown>,packageHash:v.packageHash as string,plan:decodeSponsorExecutionPlan(v.plan),publication:v.publication as Record<string,unknown>,events:v.events as Record<string,unknown>};
}
export async function listSponsorClubClaimsV4(actor:RewardAccountIdentity,chainId:31337|10143,approvalId:string|null,rpc?:RewardLedgerRpc){
 const r=await call("service_list_sponsor_club_claims_v4",{p_actor_user_id:uuid(actor.userId),p_actor_session_id:uuid(actor.sessionId),p_chain_id:chainId,p_approval_id:approvalId?uuid(approvalId):null},rpc);
 if(!Array.isArray(r)||r.length>500)throw new RewardLedgerStoreError("invalid_sponsor_claim");return r;
}
