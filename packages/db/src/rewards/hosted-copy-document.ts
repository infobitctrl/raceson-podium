import {decodeSponsorLaunchView,type SponsorLaunch} from '@raceson/domain/rewards/sponsor-launch';
import {createSponsorExecutionPlan,decodeSponsorExecutionPlan,type SponsorExecutionRecord} from '@raceson/domain/rewards/sponsor-execution';
import {canonicalRewardProposalV2 as canonical} from '@raceson/domain/rewards/frozen-proposal-v2';
import {verifyFiveRoundCopyV1} from './five-round-copy-v1.js';
import {composeHostedCopyAllocation} from './hosted-copy-allocation.js';
import {hostedCopySourcePin,hostedCopySelections,hostedCopyUnaffiliatedReview,hostedCopyCombinedReview} from './hosted-copy-policy.js';
import {hostedCopyUnaffiliatedDecision} from './hosted-copy-unaffiliated-review.js';
import {rewardDocumentObject as object} from './stored-documents.js';
export const hostedCopyDocumentPolicy={pin:hostedCopySourcePin,selections:hostedCopySelections(hostedCopySourcePin),unaffiliatedReview:hostedCopyUnaffiliatedReview(hostedCopySourcePin),
 versions:{combined:hostedCopyCombinedReview.version,unaffiliated:hostedCopyUnaffiliatedDecision.version}};
function check(v:unknown):asserts v {if(!v)throw Error('invalid_sponsor_allocation');}
/** Reconstruct identical awards for approval, upload and controller handoffs. */
export function composeHostedCopyAwardDocument(facts:{launch:SponsorLaunch;execution:SponsorExecutionRecord;sourceFacts:unknown;contextHash:string},slot:number,policy=hostedCopyDocumentPolicy){
 const {launch,execution,contextHash}=facts,plan=execution.plan;
 check(plan.chainId===10143&&Number.isInteger(slot)&&slot>=0&&slot<=5&&/^[0-9a-f]{64}$/.test(contextHash));
 check(canonical(plan)===canonical(createSponsorExecutionPlan(launch,plan.funder,{operator:plan.operator,treasury:plan.unallocatedTreasury,reviewPeriods:plan.reviewPeriods})));
 const source=verifyFiveRoundCopyV1(policy.pin,facts.sourceFacts);
 const quote=composeHostedCopyAllocation(launch.setup,source,policy.pin,policy.selections,policy.unaffiliatedReview).allocation;
 const groups=quote.groups.filter(g=>g.slot===slot),budgetWei=BigInt(plan.caps[slot]!);
 const recipients=new Map<string,{beneficiaryId:string;beneficiaryKind:'athlete'|'club';amountWei:bigint;groupIds:string[]}>();
 for(const g of groups)for(const award of g.awards){
  const key=`${g.beneficiaryKind}:${award.beneficiaryId}`;
  const r=recipients.get(key)??{beneficiaryId:award.beneficiaryId,beneficiaryKind:g.beneficiaryKind,amountWei:0n,groupIds:[] as string[]};
  r.amountWei+=award.amountWei;r.groupIds.push(g.nodeId);recipients.set(key,r);
 }
 const proposedWei=groups.reduce((sum,g)=>sum+g.proposedWei,0n);
 check(groups.reduce((sum,g)=>sum+g.budgetWei,0n)===budgetWei);
 const calculation={slot,budgetWei,proposedWei,retainedWei:budgetWei-proposedWei,groups,
  recipients:[...recipients].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,r])=>({...r,groupIds:r.groupIds.sort()}))};
 return {schema:'podium-copy-allocation-document-v1' as const,launch,plan,binding:{...policy.pin,...policy.versions},source,slot,contextHash,calculation};
}
export function decodeHostedCopyAwardDocument(value:unknown,scope:{chainId:31337|10143;setupId:string;slot:number},policy=hostedCopyDocumentPolicy){
 const d=object(value,['schema','launch','plan','binding','source','slot','contextHash','calculation']);
 check(scope.chainId===10143&&d.schema==='podium-copy-allocation-document-v1'&&d.slot===scope.slot&&typeof d.contextHash==='string');
 const l=object(d.launch,['id','state','setup','configurationHash','createdAt']);
 const launch=decodeSponsorLaunchView({setup:l.setup,launch:l},10143,scope.setupId).launch;check(launch);
 const plan=decodeSponsorExecutionPlan(d.plan);
 const rebuilt=composeHostedCopyAwardDocument({launch,execution:{plan,deploymentHash:null,fundingHash:null},sourceFacts:d.source,contextHash:d.contextHash},scope.slot,policy);
 check(rebuilt.calculation.budgetWei>0n&&rebuilt.calculation.groups.every(g=>g.hold===null)&&canonical(rebuilt)===canonical(d));
 return rebuilt;
}
