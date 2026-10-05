import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchSponsorAllocationV4} from '../dist/routes/rewards/sponsor-allocation-v4.js';
import {sponsorAllocationFactsV4} from '@raceson/db/rewards';
const id=n=>`af000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('V4 review HTTP rejects browser source, recipients, amount, identity and signing authority',async()=>{
 let body,calls=0,response,privateHeaders=0;
 const deps={config:()=>({chainId:31337}),requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),rpc:async()=>{calls++;throw Error('unexpected');},
  readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>privateHeaders++,sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
 const url=new URL(`http://localhost/api/v1/organizer/rewards/sponsor-setups/${id(3)}/allocations/1`),res={setHeader(){}};
 const valid={requestId:id(4),expectedApprovalId:null,contextHash:'a'.repeat(64),documentHash:'b'.repeat(64),decision:'approved'};
 for(const extra of [{source:{}},{recipients:[]},{amountWei:'1'},{actorUserId:id(5)},{wallet:'0xabc'},{allocationVersion:3},{document:{}},{funding:true}]){
  body={...valid,...extra};await dispatchSponsorAllocationV4({method:'POST'},res,url,deps);assert.equal(response.status,400);
 }
 await dispatchSponsorAllocationV4({method:'GET'},res,new URL(url+'?actor='+id(5)),deps);assert.equal(response.status,400);
 await dispatchSponsorAllocationV4({method:'DELETE'},res,url,deps);assert.equal(response.status,405);
 await dispatchSponsorAllocationV4({method:'GET'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);
 assert.equal(calls,0);assert.equal(privateHeaders,11);
});
test('V4 review repository keeps account, source and chain authority errors private and scoped',async()=>{
 for(const code of ['reward_account_session_required','reward_planning_not_found','reward_setup_not_found','reward_sponsor_source_not_ready','reward_planning_revision_changed']){
  await assert.rejects(()=>sponsorAllocationFactsV4({userId:id(1),sessionId:id(2)},{chainId:31337,setupId:id(3),slot:0},undefined,async(name,args)=>{
   assert.equal(name,'service_read_reward_sponsor_allocation_v4');assert.equal(args.p_actor_user_id,id(1));assert.equal(args.p_actor_session_id,id(2));assert.equal(args.p_chain_id,31337);
   return{data:null,error:{message:code}};
  }),{code});
 }
 await assert.rejects(()=>sponsorAllocationFactsV4({userId:id(1),sessionId:id(2)},{chainId:31337,setupId:id(3),slot:1},undefined,async()=>({data:null,error:{message:'private DB details'}})),{code:'reward_ledger_unavailable'});
});

import {decodeRewardMappingWorkspaceV2} from '@raceson/domain/rewards/source-mapping-v2';
import {nativeContinuityFixture} from './fixtures/native-finale-continuity-v3.mjs';
import {previewNativeFinaleContinuityV3} from '../dist/features/rewards/native-finale-continuity-service.js';
import {leaguePolicyContextV3,leaguePolicyCalculationV3} from '../dist/features/rewards/league-policy-v3-service.js';
import {buildLeaguePublicationDocumentV3} from '../dist/features/rewards/league-publication-v3-service.js';
import {sponsorAllocationDocumentV4} from '../dist/features/rewards/sponsor-allocation-v4-service.js';
import {allocationDocumentHashV3 as hash,decodeLeaguePublicationFactsV3} from '@raceson/db/rewards';
import {createGuidedSetup,bindGuidedSeason,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {createSponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
const json=v=>JSON.parse(JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x));
function finalFacts(slot){
 const f=nativeContinuityFixture();f.workspace=decodeRewardMappingWorkspaceV2(f.workspace);f.review={id:id(900),contextHash:previewNativeFinaleContinuityV3(f).contextHash,selection:f.selection,decision:'confirmed',reviewedAt:'2026-09-10T04:45:00.000Z'};
 const native=previewNativeFinaleContinuityV3(f),context=leaguePolicyContextV3(f);
 const policyReview={id:id(901),previousReviewId:null,contextHash:hash(context),decision:'selected',reviewedAt:'2026-09-10T04:50:00.000Z',
  policy:{schema:'raceson-league-scoring-policy-v3',categories:f.workspace.catalogue.categories.filter(c=>c.target==='individual')
   .map(c=>({categoryId:c.id,points:[100,80,60],participationPoints:1,bestN:4,minimumRounds:2,tieBreak:'best_finish'})),
   club:{categoryId:f.workspace.catalogue.categories.find(c=>c.target==='club').id,membersPerRound:3}}};
 const publicationDocument=buildLeaguePublicationDocumentV3(context,policyReview,native.source);
 const publication={id:id(902),draftId:f.record.draftId,previousPublicationId:null,sourceGuardHash:'c'.repeat(64),documentHash:hash(publicationDocument),
  document:publicationDocument,decision:'published',publishedAt:'2026-09-10T05:00:00.000Z',publishedByUserId:id(1),evidenceHash:'d'.repeat(64)};
 const sourceFacts=json({policy:{facts:{historical:{record:f.record,workspace:f.workspace,snapshot:f.snapshot,sourceHash:'a'.repeat(64),contextHash:f.historicalContextHash,
  decisions:f.historicalDecisions,observedAt:'2026-09-10T06:00:00.000Z',recordedDecision:null},native:f.native,guardHash:'a'.repeat(64),labels:{athletes:[],clubs:[]},review:{...f.review,previousReviewId:null},recordedReview:null},
  review:policyReview,recordedReview:null,guardHash:'b'.repeat(64)},guardHash:'c'.repeat(64),publication,recorded:null,observedAt:'2026-09-10T06:00:00.000Z'});
 const decoded=decodeLeaguePublicationFactsV3(sourceFacts,{userId:id(1),sessionId:id(2)},{chainId:31337,draftId:f.record.draftId,requestId:null});
 const prepared=leaguePolicyCalculationV3(decoded.policy);
 sourceFacts.publication.document=json(buildLeaguePublicationDocumentV3(prepared.context,decoded.policy.review,prepared.currentSource));
 sourceFacts.publication.documentHash=hash(sourceFacts.publication.document);
 let seq=1000;const next=()=>id(seq++);let c=bindGuidedSeason(createGuidedSetup(next),{draftId:f.record.draftId,catalogueHash:f.workspace.catalogueHash,roundId:null,editionId:null,programmeName:'Synthetic',eventName:'Synthetic'},f.workspace.catalogue);
 c.budgetMon='7';c=addGuidedGroup(c,c.guided.pots[slot].nodeId,slot===0?'athlete_finishes':'athlete_standings',next,slot===0?null:f.workspace.catalogue.categories[0]);
 c.root.children.forEach((p,i)=>p.shareBps=i===slot?10000:0);c.root.children[slot].children[0].shareBps=10000;
 if(slot===5)c.root.children[slot].children[0].rule.sharesBps=[6000,3000,1000];
 const setup={id:id(3),chainId:31337,revision:1,configuration:c,updatedAt:'2026-09-10T06:00:00.000Z'},launch={id:id(4),setup,configurationHash:'e'.repeat(64),createdAt:setup.updatedAt,state:'prepared'};
 const plan=createSponsorExecutionPlan(launch,'0x'+'11'.repeat(20),{operator:'0x'+'22'.repeat(20),treasury:'0x'+'33'.repeat(20),reviewPeriods:[0,0,0,0,0,0]});
 return {launch,execution:{plan,deploymentHash:null,fundingHash:null},sourceFacts,contextHash:'f'.repeat(64),approval:null,recorded:null};
}
test('V4 source adapters preserve slot 0 league / slot 5 finale and require current official source decisions',()=>{
 const actor={userId:id(1),sessionId:id(2)};
 for(const slot of [0,5]){
  const state=finalFacts(slot),scope={chainId:31337,setupId:id(3),slot};
  const d=sponsorAllocationDocumentV4(actor,scope,state);assert.equal(d.calculation.slot,slot);assert.equal(d.calculation.budgetWei,7n*10n**18n);
  assert.ok(d.calculation.recipients.length>0);assert.equal(d.calculation.groups[0].hold,null);
  const changedTime=structuredClone(state);changedTime.sourceFacts.observedAt='2026-09-23T08:00:00.000Z';
  assert.equal(hash(sponsorAllocationDocumentV4(actor,scope,changedTime)),hash(d));
  const held=structuredClone(state);if(slot===0)held.sourceFacts.publication.decision='held';else held.sourceFacts.policy.review.decision='held';
  assert.throws(()=>sponsorAllocationDocumentV4(actor,scope,held));
  const altered=structuredClone(state);altered.sourceFacts.policy.facts.historical.workspace.catalogueHash='9'.repeat(64);
  const blocked=sponsorAllocationDocumentV4(actor,scope,altered);assert.equal(blocked.calculation.proposedWei,0n);assert.equal(blocked.calculation.groups[0].hold,'not_connected');
 }
});

import {composeSponsorUploadV4} from '../dist/features/rewards/sponsor-upload-v4-service.js';
import {sponsorLifecycleV4} from '../dist/features/rewards/sponsor-lifecycle-v4-service.js';
test('results handoff retains source/session checks without chain IO or signing calldata',async()=>{
 const actor={userId:id(1),sessionId:id(2)},scope={chainId:31337,setupId:id(3),slot:5,approvalId:id(920)};
 const state=finalFacts(5);state.execution.deploymentHash='0x'+'1'.repeat(64);state.execution.fundingHash='0x'+'2'.repeat(64);
 const document=sponsorAllocationDocumentV4(actor,scope,state),documentHash=hash(document);
 state.approval={id:scope.approvalId,previousApprovalId:null,contextHash:state.contextHash,documentHash,decision:'approved',actorUserId:actor.userId,createdAt:'2026-09-10T06:00:00.000Z',current:true};
 const hex=n=>'0x'+n.toString(16).padStart(64,'0');
 const upload={approvalId:scope.approvalId,document,documentHash,contextHash:state.contextHash,current:true,execution:state.execution,snapshotSalt:hex(100),prepared:null,
  recipients:document.calculation.recipients.map((r,i)=>({...r,entitlementId:hex(200+i),opaqueBeneficiaryId:hex(300+i),explanationSalt:hex(400+i)}))};
 const pack=composeSponsorUploadV4(upload,'0x'+'55'.repeat(20));
 upload.prepared={id:id(921),packageHash:hash(pack),package:pack,preparedAt:'2026-09-10T06:00:00.000Z',actorUserId:actor.userId};
 let facts={upload,publication:null,receipts:[]},calls=0,deny=false,changed=false;
 const rpc=async(name,args)=>{
  calls++;assert.equal(args.p_actor_user_id,actor.userId);assert.equal(args.p_actor_session_id,actor.sessionId);
  if(deny)return {data:null,error:{message:'reward_account_session_required'}};
  if(name==='service_read_reward_sponsor_allocation_v4'){
   const current=json(state);if(changed)current.sourceFacts.policy.review.decision='held';
   return {data:current,error:null};
  }
  assert.equal(name,'service_reward_sponsor_lifecycle_v4');
  if(args.p_kind==='publication'){
   const body=JSON.parse(args.p_body_text);facts={...facts,publication:{id:args.p_request_id,body,bodyHash:hash(body),current:true,createdAt:'2026-09-10T06:00:00.000Z'}};
  }
  return {data:json({...facts,upload:{...facts.upload,recipients:facts.upload.recipients.map(({groupIds,...r})=>r)}}),error:null};
 };
 const reader=new Proxy({}, {get(){throw Error('handoff must not touch chain');}});
 const unbound=await sponsorLifecycleV4(actor,scope,undefined,{rpc,reader,view:'handoff'});
 assert.equal(unbound.publication,null);assert.equal(unbound.pot,null);assert.equal(unbound.transaction,null);
 const bound=await sponsorLifecycleV4(actor,scope,{action:'publication',requestId:id(922),documentHash:unbound.publicationHash},{rpc,reader,view:'handoff'});
 assert.equal(bound.publication.id,id(922));assert.equal(bound.current,true);assert.equal(bound.pot,null);assert.equal(bound.transaction,null);assert.ok(calls>3);
 const ready=await sponsorLifecycleV4(actor,scope,undefined,{rpc,reader,view:'handoff'});assert.equal(ready.publication.id,id(922));
 let httpResult;
 await dispatchSponsorAllocationV4({method:'GET'},{setHeader(){}},new URL(`http://local/api/v1/organizer/rewards/sponsor-setups/${scope.setupId}/allocations/${scope.slot}/${scope.approvalId}/handoff`),{
  config:()=>({chainId:31337}),requireIdentity:async()=>actor,rpc,sponsorReader:reader,applyPrivateSessionHeaders:()=>{},
  sendSuccess:(_r,data)=>{httpResult=data;},sendError:(_r,status,code)=>assert.fail(`${status}:${code}`)});
 assert.equal(httpResult.publication.id,id(922));assert.equal(httpResult.transaction,null);
 await assert.rejects(()=>sponsorLifecycleV4(actor,scope,{action:'receipt'},{rpc,reader,view:'handoff'}),{code:'invalid_sponsor_lifecycle'});
 // The normal controller lifecycle still requires its full chain observation.
 await assert.rejects(()=>sponsorLifecycleV4(actor,scope,undefined,{rpc,reader}),/handoff must not touch chain/);
 changed=true;await assert.rejects(()=>sponsorLifecycleV4(actor,scope,undefined,{rpc,reader,view:'handoff'}));changed=false;
 deny=true;await assert.rejects(()=>sponsorLifecycleV4(actor,scope,undefined,{rpc,reader,view:'handoff'}),{code:'reward_account_session_required'});
});
test('handoff HTTP rejects receipts before any repository or chain operation',async()=>{
 let response,calls=0;
 const deps={config:()=>({chainId:31337}),requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),rpc:async()=>{calls++;throw Error('unexpected');},
  readJsonBody:async()=>({action:'receipt',requestId:id(7),transactionHash:'0x'+'1'.repeat(64),operation:'upload',start:0,end:1}),
  applyPrivateSessionHeaders:()=>{},sendSuccess:()=>assert.fail(),sendError:(_r,status,code)=>response={status,code}};
 await dispatchSponsorAllocationV4({method:'POST'},{setHeader(){}},new URL(`http://local/api/v1/organizer/rewards/sponsor-setups/${id(3)}/allocations/1/${id(4)}/handoff`),deps);
 assert.equal(response.status,400);assert.equal(calls,0);
});
