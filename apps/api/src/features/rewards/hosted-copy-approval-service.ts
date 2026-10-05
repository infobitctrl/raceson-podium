import {hostedCopyApprovalRpc,sponsorAllocationFactsV4,composeHostedCopyAwardDocument,hostedCopyDocumentPolicy,
 sponsorAllocationDocumentHashV4,copyRewardLedgerDocument as copy,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import type {SponsorAllocationDecisionV4} from './sponsor-allocation-v4-service.js';
function check(v:unknown,code='reward_planning_revision_changed'):asserts v {if(!v)throw Error(code);}
/** Server economics and pinned sporting facts determine awards, never browser amounts. */
export async function hostedCopyAwardReview(actor:RewardAccountIdentity,setupId:string,slot:number,rpc:RewardLedgerRpc,change?:SponsorAllocationDecisionV4,policy=hostedCopyDocumentPolicy){
 const transport=hostedCopyApprovalRpc(actor,rpc),scope={chainId:10143 as const,setupId,slot,requestId:change?.requestId};
 const state=await sponsorAllocationFactsV4(actor,scope,undefined,transport);
 const ack=(r:typeof state.approval)=>r&&{id:r.id,previousApprovalId:r.previousApprovalId,contextHash:r.contextHash,
  documentHash:r.documentHash,decision:r.decision,createdAt:r.createdAt,current:r.current};
 if(change&&state.recorded){
  const r=state.recorded;
  check(r.documentHash===change.documentHash&&r.contextHash===change.contextHash&&r.previousApprovalId===change.expectedApprovalId&&r.decision===change.decision,'reward_sponsor_approval_conflict');
  return copy({version:'podium-copy-award-review-v1',setupId,slot,approval:ack(state.approval),recorded:ack(r),
   historicalAcknowledgement:true,stageReady:false,payableWei:'0'});
 }
 const document=composeHostedCopyAwardDocument(state,slot,policy),{groups,budgetWei,proposedWei,recipients}=document.calculation;
 const documentHash=sponsorAllocationDocumentHashV4(document);
 const reasons=[...new Set(groups.flatMap(g=>g.hold?[g.hold]:[])),...(budgetWei===0n?['empty_pot']:[])];
 if(state.approval?.current)check(state.approval.documentHash===documentHash,'invalid_sponsor_allocation');
 let final=state;
 if(change){
  check(change.contextHash===state.contextHash&&change.documentHash===documentHash);
  check(change.expectedApprovalId===(state.approval?.id??null),'reward_sponsor_approval_conflict');
  check(change.decision==='held'||reasons.length===0,'reward_sponsor_source_not_ready');
  final=await sponsorAllocationFactsV4(actor,scope,{expectedApprovalId:change.expectedApprovalId,contextHash:state.contextHash,document,decision:change.decision},transport);
 }else{
  final=await sponsorAllocationFactsV4(actor,scope,undefined,transport);
  check(final.contextHash===state.contextHash&&final.approval?.id===state.approval?.id,'reward_sponsor_approval_conflict');
 }
 return copy({version:'podium-copy-award-review-v1',setupId,slot,contextHash:state.contextHash,documentHash,
  budgetWei,proposedWei,retainedWei:budgetWei-proposedWei,reasons,
  recipientCounts:{athletes:recipients.filter(r=>r.beneficiaryKind==='athlete').length,clubs:recipients.filter(r=>r.beneficiaryKind==='club').length},
  approval:ack(final.approval),recorded:ack(final.recorded),historicalAcknowledgement:false,stageReady:false,payableWei:'0'});
}
