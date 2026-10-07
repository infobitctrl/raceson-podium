import {createAdminSupabaseClient} from "../supabase.js";
import {RewardLedgerStoreError,copyRewardLedgerDocument as copy,type RewardLedgerRpc} from "./programme-ledger.js";
import {rewardDocumentObject as object,rewardDocumentUuid as uuid} from "./stored-documents.js";
import {decodeSponsorExecutionPlan} from "@raceson/domain/rewards/sponsor-execution";
import {canonicalRewardProposalV2 as canonical} from "@raceson/domain/rewards/frozen-proposal-v2";
import {sponsorAllocationDocumentHashV4 as digest} from "./sponsor-allocation-v4.js";
import {decodeRewardWalletChallenge,type RewardAccountIdentity} from "./athlete-wallets.js";
import {decodeRewardAthleteDestination} from "./athlete-destinations.js";
export type SponsorClaimScopeV4={chainId:31337|10143;claimId:string;role:"recipient"|"operator"};
async function call(name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>,rpc?:RewardLedgerRpc){
 const r=await(rpc??((n,a)=>createAdminSupabaseClient().rpc(n,a)))(name,args);
 if(r.error){const m=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError(new Set(["reward_account_session_required","reward_claim_scope_required","invalid_sponsor_claim","reward_sponsor_claim_conflict","reward_sponsor_claim_not_ready","reward_planning_revision_changed","reward_recipient_consent_required"]).has(m)?m:"reward_ledger_unavailable");}return copy(r.data);
}
export async function sponsorClaimFactsV4(actor:RewardAccountIdentity,s:SponsorClaimScopeV4,write?:{action:string;body:unknown},rpc?:RewardLedgerRpc){
 return decodeSponsorClaimFactsV4(await call("service_sponsor_claim_v4",{p_actor_user_id:uuid(actor.userId),p_actor_session_id:uuid(actor.sessionId),p_chain_id:s.chainId,p_claim_id:uuid(s.claimId),p_role:s.role,
  p_action:write?.action??null,p_body_text:write?canonical(copy(write.body)):null},rpc),s,actor.userId);
}
/** Pure facts decoder: native actors never need an invented account UUID. */
export function decodeSponsorClaimFactsV4(value:unknown,s:SponsorClaimScopeV4,recipientUserId?:string){
 const v=object(copy(value),["claimId","entitlementId","approvalId","setupId","slot","current","sourceStamp","profileFingerprint","destination","challenge","package","packageHash","plan","publication","events"]);
 const plan=decodeSponsorExecutionPlan(v.plan);
 const d=v.destination as {userId:string},destination=decodeRewardAthleteDestination(v.destination,d.userId);
 const challenge=decodeRewardWalletChallenge(v.challenge,{userId:destination.userId,sessionId:destination.sessionId});
 if(plan.version!==4||plan.chainId!==s.chainId||!Number.isInteger(v.slot)||Number(v.slot)<0||Number(v.slot)>5||typeof v.entitlementId!=='string'||!/^0x[0-9a-f]{64}$/.test(v.entitlementId)||v.claimId!==s.claimId||typeof v.current!=="boolean"||destination.chainId!==s.chainId||s.role==="recipient"&&destination.userId!==recipientUserId
  ||v.packageHash!==digest(v.package)||![v.sourceStamp,v.profileFingerprint].every(h=>typeof h==="string"&&/^[0-9a-f]{64}$/.test(h)))throw new RewardLedgerStoreError("invalid_sponsor_claim");
 return{claimId:uuid(v.claimId),entitlementId:v.entitlementId as `0x${string}`,approvalId:uuid(v.approvalId),setupId:uuid(v.setupId),slot:Number(v.slot),current:v.current,sourceStamp:v.sourceStamp as string,profileFingerprint:v.profileFingerprint as string,
 destination,challenge,package:v.package as Record<string,unknown>,packageHash:v.packageHash as string,plan,publication:v.publication as Record<string,unknown>,events:v.events as Record<string,unknown>};
}
export async function listSponsorClaimsV4(actor:RewardAccountIdentity,chainId:31337|10143,approvalId:string|null,rpc?:RewardLedgerRpc){
 const r=await call("service_list_sponsor_claims_v4",{p_actor_user_id:uuid(actor.userId),p_actor_session_id:uuid(actor.sessionId),p_chain_id:chainId,p_approval_id:approvalId?uuid(approvalId):null},rpc);
 if(!Array.isArray(r)||r.length>500)throw new RewardLedgerStoreError("invalid_sponsor_claim");return r;
}
