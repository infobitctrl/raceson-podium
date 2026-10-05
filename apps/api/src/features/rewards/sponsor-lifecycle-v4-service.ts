import {hostedCopyPublicationEvidence} from './hosted-copy-publication.js';
import {sponsorLifecycleFactsV4,sponsorAllocationFactsV4,composeHostedCopyAwardDocument,sponsorAllocationDocumentHashV4 as digest,decodeLeaguePublicationFactsV3,
 copyRewardLedgerDocument as copy,RewardLedgerStoreError,type RewardAccountIdentity,type RewardLedgerRpc,type SponsorUploadScopeV4} from "@raceson/db/rewards";
import {buildFinalPublicationEvidenceV3} from "@raceson/domain/rewards/final-publication-v3";
import {canonicalRewardJson as canonical} from "@raceson/rewards-chain";
import {sponsorLifecycleCommitmentV4,sponsorLifecycleDataV4,observeSponsorLifecycleV4,verifySponsorActionReceiptV4,
 type SponsorLifecycleInputV4,type SponsorLifecycleActionV4,type SponsorPublicationV4} from "@raceson/rewards-chain/sponsor-lifecycle-v4";
import type {SponsorChainReader} from "@raceson/rewards-chain/sponsor-v4";
import {sponsorAllocationDocumentV4} from "./sponsor-allocation-v4-service.js";
import {composeSponsorUploadV4} from "./sponsor-upload-v4-service.js";
import {finalAllocationSourceFromFactsV3} from "./final-allocation-v3-service.js";
import type {Hex} from "viem";
function check(v:unknown,code="reward_sponsor_lifecycle_not_ready"):asserts v{if(!v)throw new RewardLedgerStoreError(code);}
type Facts=Awaited<ReturnType<typeof sponsorLifecycleFactsV4>>;
export function sponsorLifecycleInputV4(f:Facts):SponsorLifecycleInputV4 {
 const u=f.upload,p=u.prepared?.package;check(p&&typeof p==="object"&&!Array.isArray(p)&&f.publication);
 const rebuilt=composeSponsorUploadV4(u,String(p.programmeAddress));check(canonical(rebuilt)===canonical(p));
 const body=f.publication.body,t=body.timing as SponsorPublicationV4;
 check(body.schema==="raceson-sponsor-publication-v4"&&body.approvalId===u.approvalId&&body.contextHash===u.contextHash&&body.packageHash===u.prepared!.packageHash
  &&t.publicationEvidenceHash===`0x${digest(body.evidence)}`);
 return{plan:u.execution.plan,slot:u.document.slot,deploymentHash:u.execution.deploymentHash as Hex,fundingHash:u.execution.fundingHash as Hex,
  campaignAddress:rebuilt.campaignAddress as Hex,snapshotDigest:rebuilt.snapshotDigest,awards:rebuilt.awards.map(a=>({...a,amount:BigInt(a.amount)})),publication:t};
}
export async function composeSponsorPublicationV4(actor:RewardAccountIdentity,scope:SponsorUploadScopeV4,f:Facts,rpc?:RewardLedgerRpc){
 check(f.upload.current&&f.upload.prepared);
 const state=await sponsorAllocationFactsV4(actor,scope,undefined,rpc),d=f.upload.document.schema==='podium-copy-allocation-document-v1'?composeHostedCopyAwardDocument(state,scope.slot):sponsorAllocationDocumentV4(actor,scope,state);
 check(state.approval?.id===scope.approvalId&&state.approval.current&&state.approval.decision==="approved"&&digest(d)===f.upload.documentHash);
 let evidence:unknown,timing:Omit<SponsorPublicationV4,"publicationEvidenceHash">;
 if(d.schema==='podium-copy-allocation-document-v1'){
  ({evidence,timing}=hostedCopyPublicationEvidence(d,scope.approvalId,f.upload.prepared.packageHash,f.upload.documentHash));
 }else if(scope.slot>=1&&scope.slot<=4){
  // Imported historical results have no platform review start. Only an explicitly
  // configured zero policy can bind those original official publication times.
  check(d.plan.reviewPeriods[scope.slot]===0,"reward_sponsor_historical_review_unavailable");
  const e=d.source.rounds.find(r=>r.slot===scope.slot)?.evidence;check(e&&!e.held);
  const published=String(Math.floor(Date.parse(e.publishedAt)/1000));
  evidence={schema:"raceson-sponsor-historical-publication-v4",approvalId:scope.approvalId,documentHash:f.upload.documentHash,packageHash:f.upload.prepared.packageHash,source:e};
  timing={reviewPeriod:"0",reviewStartedAt:published,officialPublishedAt:published};
 }else{
  const facts=decodeLeaguePublicationFactsV3(state.sourceFacts,actor,{chainId:scope.chainId,draftId:d.binding.draftId,requestId:null});
  const source=finalAllocationSourceFromFactsV3(facts,scope.slot===0?6:5),n=facts.policy.facts.native;
  const native=buildFinalPublicationEvidenceV3({chainId:scope.chainId,draftId:d.binding.draftId,slot:scope.slot===0?6:5,
   approvalId:scope.approvalId,uploadId:f.upload.prepared.id,contextHash:f.upload.contextHash,documentHash:f.upload.documentHash,packageHash:f.upload.prepared.packageHash,
   sourceReview:source.sourceReview,reviewPeriod:String(d.plan.reviewPeriods[scope.slot]),finalRoundReviewPeriod:String(d.plan.reviewPeriods[5]),
   nativeRaces:n.document.races.map(r=>({raceId:r.raceId,competitionId:r.competitionId,policyId:r.review.policyId,reviewSeconds:String(r.review.reviewSeconds),configuredAt:r.review.configuredAt,
    startedByPublicationId:r.review.startedByPublicationId,startedAt:r.review.startedAt,endsAt:r.review.endsAt,finalPublicationId:r.review.finalPublicationId,officialPublishedAt:r.review.officialPublishedAt}))});
  evidence={schema:"raceson-sponsor-native-publication-v4",evidence:native};
  timing={reviewPeriod:native.reviewPeriod,reviewStartedAt:native.reviewStartedAt,officialPublishedAt:native.officialPublishedAt};
 }
 return{schema:"raceson-sponsor-publication-v4",approvalId:scope.approvalId,contextHash:f.upload.contextHash,packageHash:f.upload.prepared.packageHash,evidence,
  timing:{...timing,publicationEvidenceHash:`0x${digest(evidence)}`}};
}
export type SponsorLifecycleChangeV4={action:"publication";requestId:string;documentHash:string}|{action:"receipt";requestId:string;transactionHash:Hex;operation:SponsorLifecycleActionV4;start:number;end:number};
export async function sponsorLifecycleV4(actor:RewardAccountIdentity,scope:SponsorUploadScopeV4,change:SponsorLifecycleChangeV4|undefined,
 deps:{rpc?:RewardLedgerRpc;reader?:SponsorChainReader;view?:"handoff"}){
 // The results workspace may read/bind the handoff, but cannot verify receipts or
 // produce signing calldata without the full chain observation.
 check(deps.view!=="handoff"||change?.action!=="receipt","invalid_sponsor_lifecycle");
 let f=await sponsorLifecycleFactsV4(actor,scope,undefined,deps.rpc);
 const publication=f.publication?.body??await composeSponsorPublicationV4(actor,scope,f,deps.rpc);
 if(change?.action==="publication"){
  check(digest(publication)===change.documentHash,"reward_planning_revision_changed");
  f=await sponsorLifecycleFactsV4(actor,scope,{requestId:change.requestId,kind:"publication",body:publication},deps.rpc);
 }
 let state=null,transaction=null;
 if(f.publication&&f.upload.current&&f.publication.current){
  // Re-derive official evidence, even after the binding was saved.
  check(canonical(await composeSponsorPublicationV4(actor,scope,f,deps.rpc))===canonical(f.publication.body),"reward_planning_revision_changed");
  const i=sponsorLifecycleInputV4(f);
  if(deps.view!=="handoff"){
  check(deps.reader);
  if(change?.action==="receipt"){
   const old=f.receipts.find(r=>r.id===change.requestId);
   const expected={action:change.operation,start:change.start,end:change.end};
   const body=old?.body??await verifySponsorActionReceiptV4(deps.reader,i,expected,change.transactionHash);
   check(body.transactionHash===change.transactionHash&&body.action===change.operation&&body.start===change.start&&body.end===change.end,"reward_sponsor_lifecycle_conflict");
   f=await sponsorLifecycleFactsV4(actor,scope,{requestId:change.requestId,kind:"receipt",body},deps.rpc);
  }
  state=await observeSponsorLifecycleV4(deps.reader,i);
  if(state.next)transaction={binding:i,chainId:i.plan.chainId,from:i.plan.operator,to:i.campaignAddress,value:"0",action:state.next,start:state.start,end:state.end,
   data:sponsorLifecycleDataV4(i,state.next,state.start,state.end),allocationDigest:sponsorLifecycleCommitmentV4(i).allocationDigest};
  }
 }
 const fresh=await sponsorLifecycleFactsV4(actor,scope,undefined,deps.rpc);
 check(fresh.upload.current===f.upload.current&&canonical(fresh.publication)===canonical(f.publication),"reward_planning_revision_changed");
 return copy({schema:"raceson-sponsor-lifecycle-view-v4",approvalId:scope.approvalId,slot:scope.slot,current:fresh.upload.current&&(!fresh.publication||fresh.publication.current),
  publicationHash:digest(publication),publication:fresh.publication?{id:fresh.publication.id,timing:publication.timing}:null,
  pot:state?.pot??null,block:state?{number:state.observation.blockNumber,hash:state.observation.blockHash}:null,transaction,receipts:fresh.receipts});
}
