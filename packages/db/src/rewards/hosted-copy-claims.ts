import type {RewardAccountIdentity} from './athlete-wallets.js';
import type {RewardLedgerRpc} from './programme-ledger.js';
import {RewardLedgerStoreError,copyRewardLedgerDocument as copy} from './programme-ledger.js';
import {canonicalRewardProposalV2 as canonical} from '@raceson/domain/rewards/frozen-proposal-v2';
import {rewardDocumentUuid as uuid,rewardDocumentObject as object} from './stored-documents.js';
import {decodeSponsorClaimFactsV4} from './sponsor-claims-v4.js';
type Write={action:string;body:unknown};
async function call(rpc:RewardLedgerRpc,name:Parameters<RewardLedgerRpc>[0],args:Record<string,unknown>){
 const r=await rpc(name,args);
 if(r.error){const code=String((r.error as {message?:unknown}).message);throw new RewardLedgerStoreError([
  'reward_account_session_required','reward_demo_account_required','reward_demo_reviewer_required','reward_claim_scope_required',
  'invalid_sponsor_claim','reward_sponsor_claim_conflict','reward_sponsor_claim_not_ready','reward_planning_revision_changed',
  'reward_recipient_consent_required','controller_scope_required',
 ].includes(code)?code:'reward_ledger_unavailable');}return copy(r.data);
}
const rehearsalPolicy='podium-demo-alias-rehearsal-v1' as const;
/** Only the hosted SQL boundary can expose the provisioned-alias policy. */
function decodeHostedClaimFacts(value:unknown,scope:Parameters<typeof decodeSponsorClaimFactsV4>[1],userId?:string){
 const {rehearsalPolicy:policy,...facts}=copy(value) as Record<string,unknown>;
 if(policy!==undefined&&policy!==null&&policy!==rehearsalPolicy)throw Error('invalid_sponsor_claim');
 const decoded=decodeSponsorClaimFactsV4(facts,scope,userId);
 if(policy&&(decoded.plan.chainId!==10143||decoded.challenge.origin!=='https://podium.raceson.com'))throw Error('invalid_sponsor_claim');
 return {...decoded,rehearsalPolicy:policy===rehearsalPolicy?rehearsalPolicy:null};
}
export function hostedCopyClaimFacts(identity:RewardAccountIdentity,claimId:string,role:'recipient'|'reviewer',rpc:RewardLedgerRpc){
 const userId=uuid(identity.userId),sessionId=uuid(identity.sessionId),id=uuid(claimId);
 if(!['recipient','reviewer'].includes(role))throw Error('reward_claim_scope_required');
 return async(write?:Write)=>{
  if(write&&!(role==='recipient'?['request','recipient']:['intent','revoked']).includes(write.action))throw Error('reward_claim_scope_required');
  return decodeHostedClaimFacts(await call(rpc,'service_reward_demo_copy_claim',{
   p_actor_user_id:userId,p_actor_session_id:sessionId,p_claim_id:id,p_role:role,
   p_action:write?.action??null,p_body_text:write?canonical(copy(write.body)):null,
  }),{chainId:10143,claimId:id,role:role==='recipient'?'recipient':'operator'},userId);
 };
}
export function hostedCopyNativeClaimFacts(actor:{subject:string;wallet:string},claimId:string,rpc:RewardLedgerRpc){
 const subject=actor.subject,wallet=actor.wallet,id=uuid(claimId);
 if(!/^did:privy:[a-zA-Z0-9_-]{1,100}$/.test(subject)||!/^0x[0-9a-f]{40}$/.test(wallet))throw Error('controller_scope_required');
 return async(write?:Write)=>{
  if(write&&!['operator','receipt'].includes(write.action))throw Error('reward_claim_scope_required');
  const f=decodeHostedClaimFacts(await call(rpc,'service_reward_demo_copy_native_claim',{
   p_subject:subject,p_operator:wallet,p_claim_id:id,p_action:write?.action??null,p_body_text:write?canonical(copy(write.body)):null,
  }),{chainId:10143,claimId:id,role:'operator'});
  if(f.plan.operator!==wallet||f.plan.chainId!==10143)throw Error('controller_scope_required');
  return f;
 };
}
export async function hostedCopyAthleteAwards(identity:RewardAccountIdentity,after:string|null,rpc:RewardLedgerRpc){
 const userId=uuid(identity.userId),sessionId=uuid(identity.sessionId);
 if(after!==null&&!/^0x[0-9a-f]{64}$/.test(after))throw Error('invalid_sponsor_claim');
 const v=object(await call(rpc,'service_reward_demo_copy_athlete_awards',{p_user_id:userId,p_session_id:sessionId,p_after:after}),['items','nextCursor']);
 if(!Array.isArray(v.items)||v.items.length>50||v.nextCursor!==null&&(typeof v.nextCursor!=='string'||!/^0x[0-9a-f]{64}$/.test(v.nextCursor)))throw Error('invalid_sponsor_claim');
 let previous=after;
 for(const row of v.items){const a=object(row,['approvalId','slot','entitlementId','amountWei','athleteProfileId','claims']);
  uuid(a.approvalId);uuid(a.athleteProfileId);
  if(!Number.isInteger(a.slot)||Number(a.slot)<0||Number(a.slot)>5||typeof a.entitlementId!=='string'||!/^0x[0-9a-f]{64}$/.test(a.entitlementId)
   ||previous!==null&&a.entitlementId<=previous||typeof a.amountWei!=='string'||! /^(0|[1-9][0-9]*)$/.test(a.amountWei)||!Array.isArray(a.claims))throw Error('invalid_sponsor_claim');
  previous=a.entitlementId;
  for(const claim of a.claims){const c=object(claim,['id','prepared','consented','approved','paid']);uuid(c.id);
   if(!['prepared','consented','approved','paid'].every(k=>typeof c[k]==='boolean')||c.approved&&!c.consented||c.paid&&!c.approved||c.consented&&!c.prepared)throw Error('invalid_sponsor_claim');}
 }
 if(v.nextCursor!==null&&(v.items.length!==50||v.nextCursor!==previous))throw Error('invalid_sponsor_claim');
 return v;
}
function decodeClaimQueue(value:unknown,approvalId:string,after:string|null){
 const page=object(value,['items','nextCursor']);
 if(!Array.isArray(page.items)||page.items.length>50||page.nextCursor!==null&&typeof page.nextCursor!=='string')throw Error('invalid_sponsor_claim');
 let previous=after;
 for(const row of page.items){const v=object(row,['id','approvalId','slot','entitlementId','amountWei','address','prepared','consented','approved','paid']);
  const id=uuid(v.id);uuid(v.approvalId);
  if(v.approvalId!==approvalId||previous!==null&&id<=previous||!Number.isInteger(v.slot)||Number(v.slot)<0||Number(v.slot)>5
   ||typeof v.entitlementId!=='string'||!/^0x[0-9a-f]{64}$/.test(v.entitlementId)||typeof v.amountWei!=='string'||!/^[1-9][0-9]*$/.test(v.amountWei)
   ||typeof v.address!=='string'||!/^0x[0-9a-f]{40}$/.test(v.address)
   ||!['prepared','consented','approved','paid'].every(k=>typeof v[k]==='boolean')||v.consented&&!v.prepared||v.approved&&!v.consented||v.paid&&!v.approved)throw Error('invalid_sponsor_claim');
  previous=id;
 }
 if(page.nextCursor!==null&&(page.items.length!==50||page.nextCursor!==previous))throw Error('invalid_sponsor_claim');
 return page;
}
export async function hostedCopyClaimReviews(identity:RewardAccountIdentity,approvalId:string,after:string|null,rpc:RewardLedgerRpc){
 const id=uuid(approvalId),cursor=after===null?null:uuid(after);
 return decodeClaimQueue(await call(rpc,'service_reward_demo_copy_claim_reviews',{
  p_user_id:uuid(identity.userId),p_session_id:uuid(identity.sessionId),p_approval_id:id,p_after:cursor,
 }),id,cursor);
}
export async function hostedCopyNativeClaimQueue(actor:{subject:string;wallet:string},approvalId:string,after:string|null,rpc:RewardLedgerRpc){
 const id=uuid(approvalId),cursor=after===null?null:uuid(after),subject=actor.subject,wallet=actor.wallet;
 if(!/^did:privy:[a-zA-Z0-9_-]{1,100}$/.test(subject)||!/^0x[0-9a-f]{40}$/.test(wallet))throw Error('controller_scope_required');
 return decodeClaimQueue(await call(rpc,'service_reward_demo_copy_native_claims',{
  p_subject:subject,p_operator:wallet,p_approval_id:id,p_after:cursor,
 }),id,cursor);
}
