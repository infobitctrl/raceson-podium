import {composeHostedCopyAllocation,readFiveRoundCopyV1,hostedCopyApprovalRpc,sponsorAllocationFactsV4,
 sponsorAllocationDocumentHashV4,copyRewardLedgerDocument as copy,type RewardAccountIdentity,type RewardLedgerRpc} from '@raceson/db/rewards';
import {hostedCopyPin} from './hosted-copy-preview.js';
import {hostedCopySelections,hostedCopyUnaffiliatedReview,hostedCopyCombinedReview} from './hosted-copy-review.js';
import {hostedCopyUnaffiliatedDecision} from './hosted-copy-unaffiliated-review.js';
import type {SponsorAllocationDecisionV4} from './sponsor-allocation-v4-service.js';
import {createSponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {canonicalRewardProposalV2 as canonical} from '@raceson/domain/rewards/frozen-proposal-v2';
const hostedPolicy={pin:hostedCopyPin,selections:hostedCopySelections(hostedCopyPin),unaffiliatedReview:hostedCopyUnaffiliatedReview(hostedCopyPin),
 versions:{combined:hostedCopyCombinedReview.version,unaffiliated:hostedCopyUnaffiliatedDecision.version}};
function check(v:unknown,code='reward_planning_revision_changed'):asserts v {if(!v)throw Error(code);}
/** Server economics and pinned sporting facts determine awards, never browser amounts. */
export async function hostedCopyAwardReview(actor:RewardAccountIdentity,setupId:string,slot:number,rpc:RewardLedgerRpc,change?:SponsorAllocationDecisionV4,policy=hostedPolicy){
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
 const plan=state.execution.plan;
 check(canonical(plan)===canonical(createSponsorExecutionPlan(state.launch,plan.funder,{operator:plan.operator,treasury:plan.unallocatedTreasury,reviewPeriods:plan.reviewPeriods})),'invalid_sponsor_allocation');
 const source=await readFiveRoundCopyV1(policy.pin,async()=>state.sourceFacts);
 const quote=composeHostedCopyAllocation(state.launch.setup,source,policy.pin,policy.selections,policy.unaffiliatedReview).allocation;
 const groups=quote.groups.filter(g=>g.slot===slot),budgetWei=BigInt(state.execution.plan.caps[slot]!);
 const recipients=new Map<string,{beneficiaryId:string;beneficiaryKind:'athlete'|'club';amountWei:bigint;groupIds:string[]}>();
 for(const g of groups)for(const award of g.awards){
  const key=`${g.beneficiaryKind}:${award.beneficiaryId}`,r:{beneficiaryId:string;beneficiaryKind:'athlete'|'club';amountWei:bigint;groupIds:string[]}=recipients.get(key)??{beneficiaryId:award.beneficiaryId,beneficiaryKind:g.beneficiaryKind,amountWei:0n,groupIds:[]};
  r.amountWei+=award.amountWei;r.groupIds.push(g.nodeId);recipients.set(key,r);
 }
 const proposedWei=groups.reduce((sum,g)=>sum+g.proposedWei,0n);
 check(groups.reduce((sum,g)=>sum+g.budgetWei,0n)===budgetWei,'invalid_sponsor_allocation');
 const calculation={slot,budgetWei,proposedWei,retainedWei:budgetWei-proposedWei,groups,
  recipients:[...recipients].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,r])=>({...r,groupIds:r.groupIds.sort()}))};
 const document={schema:'podium-copy-allocation-document-v1',launch:state.launch,plan:state.execution.plan,
  binding:{...policy.pin,...policy.versions},
  source:state.sourceFacts,slot,contextHash:state.contextHash,calculation};
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
  recipientCounts:{athletes:calculation.recipients.filter(r=>r.beneficiaryKind==='athlete').length,clubs:calculation.recipients.filter(r=>r.beneficiaryKind==='club').length},
  approval:ack(final.approval),recorded:ack(final.recorded),historicalAcknowledgement:false,stageReady:false,payableWei:'0'});
}
