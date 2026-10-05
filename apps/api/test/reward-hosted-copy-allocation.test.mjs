import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuidedSetup,addGuidedGroup} from '../../../packages/domain/dist/rewards/guided-setup-editor.js';
import {quoteFiveRoundCopySetupV1} from '../../../packages/domain/dist/rewards/five-round-copy-setup-v1.js';
import {previewFiveRoundCopyV1} from '../../../packages/domain/dist/rewards/five-round-copy-v1.js';
import {readHostedCopyAllocation,readHostedCopyAllocationHandoff,hostedCopySetupNodeId as nodeId} from '../../../packages/db/dist/rewards/hosted-copy-allocation.js';
import {verifyHandoff} from '../../../demo/rewards/hosted-copy/verify-handoff.mjs';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
import {fiveRoundCopyProjectionHashV1} from '../../../packages/db/dist/rewards/five-round-copy-v1.js';
import {hostedCopyUnaffiliatedReview,hostedCopyReviewNote} from '../dist/features/rewards/hosted-copy-review.js';
const id=n=>`7c000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const source={version:'raceson-five-round-copy-v1',batchSha256:'a'.repeat(64),sportingSha256:'b'.repeat(64),leagueId:id(1),seasonId:id(2),capturedAt:'2026-10-05T00:00:00.000Z',closedAfterRound:5,clubScoringScope:'combined',
  athletes:[1,2,3].map(n=>({id:id(10+n),ordinal:n,name:`Races Mon${n}`,username:`racesmon${n}`})),
  clubs:[{id:id(21),name:'Races Club1'},{id:id(22),name:'Races Club2'}],classifications:[{id:id(30),competitionId:id(31),name:'Open'}],
  policies:[{id:id(31),points:[100,60,40],participationPoints:5,bestN:5,minimumRounds:1,tieBreak:'best_finish',clubMode:'best_three'}],races:[],results:[]};
 for(let slot=1;slot<=5;slot++){
  source.races.push({id:id(100+slot),roundId:id(200+slot),slot,competitionId:id(31),publicationId:id(300+slot),runId:id(400+slot),publicationState:'official',publishedAt:'2026-10-04T12:00:00.000Z',distanceMetres:'5432',resultCount:3});
  for(let n=1;n<=3;n++)source.results.push({id:id(500+slot*10+n),registrationId:id(600+slot*10+n),raceId:id(100+slot),athleteId:id(10+n),clubId:n<3?id(20+n):null,publicationId:id(300+slot),runId:id(400+slot),status:'finished',finishTimeMs:'9007199254740993',rankOverall:n===3?3:slot===5?n:3-n,classificationIds:n<3?[id(30)]:[]});
 }return source;
}

const setupId=id(9000);
function saved(source){
 let seq=10000,c=createGuidedSetup(()=>id(seq++));c.name='Synthetic allocation';c.budgetMon='0.000000000000000101';c.sponsorSelection={sourceLeagueId:source.leagueId,sourceSeasonId:source.seasonId,eventEditionId:null};c.root.id=nodeId(setupId,'root');
 c.root.children=c.root.children.map((n,slot)=>({...n,id:nodeId(setupId,`pot:${slot}`),shareBps:slot===0?10000:0}));
 c.guided.pots=c.root.children.map((n,slot)=>({nodeId:n.id,slot,roundId:slot?source.races.find(r=>r.slot===slot).roundId:null}));
 for(const [slot,pot]of c.guided.pots.entries()){
  for(const cat of source.classifications)c=addGuidedGroup(c,pot.nodeId,'athlete_standings',()=>nodeId(setupId,`group:${slot}:${cat.id}`),{id:cat.id,name:cat.name,competitionName:'Synthetic course',target:'individual'});
  c=addGuidedGroup(c,pot.nodeId,'club_standings',()=>nodeId(setupId,`group:${slot}:club_standings`),null);
  if(!slot)for(const type of ['athlete_finishes','athlete_metres','club_metres'])c=addGuidedGroup(c,pot.nodeId,type,()=>nodeId(setupId,`group:${slot}:${type}`),null);
 }
 for(const pot of c.root.children)for(const n of pot.children)if(n.rule.basis!=='participation')n.rule.sharesBps=[10000];
 c.root.children[0].children[0].shareBps=10000;
 return{id:setupId,chainId:10143,revision:1,updatedAt:'2026-10-05T12:00:00.000Z',configuration:c};
}
const bindings=s=>Array.from({length:6},(_,slot)=>s.classifications.map(c=>({nodeId:nodeId(setupId,`group:${slot}:${c.id}`),classificationId:c.id}))).flat();
const quote=(s,r=saved(s),decisions=[])=>quoteFiveRoundCopySetupV1(r,s,bindings(s),fiveRoundCopyProjectionHashV1(s),decisions);
function selectGroup(record,type){for(const n of record.configuration.root.children[0].children)n.shareBps=record.configuration.guided.groups.find(g=>g.nodeId===n.id).type===type?10000:0;}
function duplicate(s){const original=s.results[0];const extra={...original,id:id(8888),registrationId:id(8889),clubId:id(22)};s.results.push(extra);s.races[0].resultCount++;return[{slot:1,athleteId:original.athleteId,resultIds:[original.id,extra.id],keepResultId:original.id}];}
function conserved(q){assert.equal(q.budgetWei,q.proposedWei+q.heldWei+q.unallocatedWei+q.unusedWei);assert.equal(q.payableWei,0n);}
test('exact budget produces unapproved walletless awards and is conserved',()=>{
 const s=fixture(),q=quote(s);conserved(q);assert.equal(q.budgetWei,101n);assert.equal(q.proposedWei,101n);assert.equal(q.groups[0].awards[0].name,'Races Mon2');assert.equal(q.state,'unapproved');assert.equal(JSON.stringify(q,(_,v)=>typeof v==='bigint'?v.toString():v).includes('wallet'),false);
});
test('unassigned hierarchy shares and unused prize slots are distinct',()=>{
 const s=fixture(),r=saved(s);r.configuration.root.children[0].shareBps=5000;r.configuration.root.children[0].children[0].shareBps=5000;r.configuration.root.children[0].children[0].rule.sharesBps=[0,0,10000];const q=quote(s,r);conserved(q);assert.equal(q.proposedWei,0n);assert.ok(q.unallocatedWei>0n);assert.ok(q.unusedWei>0n);
});
test('sporting ties consume occupied slots and preserve single-wei remainders',()=>{
 const s=fixture();for(const r of s.results)if(r.classificationIds.length)r.rankOverall=1;
 const q=quote(s);conserved(q);assert.deepEqual(q.groups[0].awards.map(a=>a.amountWei).sort(),[50n,51n]);
});
test('duplicate decisions release combined scope only and preserve every source/classification record',()=>{
 const s=fixture(),decision=duplicate(s),r=saved(s);selectGroup(r,'club_standings');const before=structuredClone(s),held=quote(s,r);assert.equal(held.heldWei,101n);conserved(held);
 const reviewed=quote(s,r,decision);conserved(reviewed);assert.equal(reviewed.heldWei,0n);assert.equal(reviewed.sourceCounts.countedCombinedFinishes,15);assert.equal(reviewed.sourceCounts.finished,16);assert.deepEqual(s,before);
 const p=previewFiveRoundCopyV1(s,decision);assert.equal(p.tables.find(t=>t.slot===1&&t.classificationId===id(30)).heldReason,'duplicate_classified_finish');assert.equal(p.tables.find(t=>t.slot===1&&t.classificationId===null).heldReason,null);
 for(const mutate of [d=>d[0].resultIds.pop(),d=>d[0].keepResultId=id(7777),d=>d.push(d[0]),d=>d[0].athleteId=id(22)]){const d=structuredClone(decision);mutate(d);assert.throws(()=>quote(s,r,d),/invalid_five_round_copy_v1/);}
});
test('participation includes unclassified finishes and reuses proportional integer allocation',()=>{
 const s=fixture(),r=saved(s);selectGroup(r,'athlete_finishes');const q=quote(s,r);conserved(q);const g=q.groups.find(g=>g.type==='athlete_finishes');assert.equal(g.awards.length,3);assert.ok(g.awards.some(a=>a.name==='Races Mon3'));assert.equal(g.awards.reduce((n,a)=>n+a.amountWei,0n),101n);
});
test('missing distance and unknown club attribution hold only affected metrics',()=>{
 const s=fixture(),r=saved(s);selectGroup(r,'club_metres');let q=quote(s,r);assert.equal(q.heldWei,101n);assert.match(q.groups.find(g=>g.type==='club_metres').hold,/unattributed_club/);conserved(q);
 s.races[0].distanceMetres=null;selectGroup(r,'athlete_metres');q=quote(s,r);assert.equal(q.heldWei,101n);conserved(q);
 selectGroup(r,'athlete_finishes');q=quote(s,r);assert.equal(q.heldWei,0n);conserved(q);
});
test('reviewed unaffiliated entries retain athlete awards and never inherit a club from another round',()=>{
 const s=fixture();s.results.find(r=>r.raceId===id(102)&&r.athleteId===id(13)).clubId=id(21);
 const original=structuredClone(s),hash=fiveRoundCopyProjectionHashV1(s),review={sourceHash:hash,resultIds:s.results.filter(r=>r.clubId===null).map(r=>r.id)};
 const r=saved(s);selectGroup(r,'club_metres');
 const held=quote(s,r),q=quoteFiveRoundCopySetupV1(r,s,bindings(s),hash,[],review);conserved(q);
 assert.equal(held.heldWei,101n);assert.equal(q.heldWei,0n);assert.equal(q.confirmedUnaffiliatedFinishes,4);
 const club=q.groups.find(g=>g.type==='club_metres');assert.equal(club.awards.find(a=>a.name==='Races Club1').value,String(6*5432));
 assert.equal(club.awards.find(a=>a.name==='Races Club2').value,String(5*5432));
 for(const type of ['athlete_finishes','athlete_metres','athlete_standings']){
  selectGroup(r,type);const before=quote(s,r),after=quoteFiveRoundCopySetupV1(r,s,bindings(s),hash,[],review);
  assert.deepEqual(after.groups,before.groups);conserved(after);
 }
 assert.deepEqual(s,original);
});
test('unaffiliated review rejects changed sources and invalid IDs; a partial review keeps the remaining hold',()=>{
 const s=fixture(),r=saved(s);selectGroup(r,'club_metres');const hash=fiveRoundCopyProjectionHashV1(s),ids=s.results.filter(r=>r.clubId===null).map(r=>r.id);
 const calculate=review=>quoteFiveRoundCopySetupV1(r,s,bindings(s),hash,[],review);
 for(const review of [{sourceHash:'f'.repeat(64),resultIds:ids},{sourceHash:hash,resultIds:[...ids,ids[0]]},{sourceHash:hash,resultIds:[id(7777)]},{sourceHash:hash,resultIds:[s.results[0].id]}])assert.throws(()=>calculate(review),/invalid_copy_setup_binding/);
 const partial=calculate({sourceHash:hash,resultIds:ids.slice(1)});assert.equal(partial.heldWei,101n);assert.equal(partial.groups.find(g=>g.type==='club_metres').hold,'unattributed_club');conserved(partial);
});
test('hosted owner policy is an immutable explicit result set bound to one copied projection',()=>{
 const pin={projectionSha256:'7043cf919edd4dc3bdf40d022c60d0fc40036f2e4093b33b57dfc040bda3975d'},review=hostedCopyUnaffiliatedReview(pin);
 assert.equal(review.resultIds.length,196);assert.equal(new Set(review.resultIds).size,196);assert.ok(Object.isFrozen(review)&&Object.isFrozen(review.resultIds));
 assert.match(hostedCopyReviewNote(pin),/196 finishes are confirmed unaffiliated/);assert.match(hostedCopyReviewNote(pin),/Long result.*Races Club29/);
 assert.equal(hostedCopyUnaffiliatedReview({projectionSha256:'f'.repeat(64)}),undefined);assert.equal(hostedCopyReviewNote({projectionSha256:'f'.repeat(64)}),'');
});
test('zero-funded groups do not hold or receive money, and overallocations fail closed',()=>{
 const s=fixture(),r=saved(s);const q=quote(s,r);assert.ok(q.groups.filter(g=>g.budgetWei===0n).every(g=>!g.hold&&!g.awards.length));
 r.configuration.root.children[0].children[1].shareBps=1;assert.throws(()=>quote(s,r),/reward_setup_overallocated/);
});
test('binding tampering cannot substitute categories or rounds',()=>{
 const s=fixture(),r=saved(s);const b=bindings(s);b[0].classificationId=id(7777);assert.throws(()=>quoteFiveRoundCopySetupV1(r,s,b,fiveRoundCopyProjectionHashV1(s)),/invalid_copy_setup_binding/);
 r.configuration.guided.pots[1].roundId=id(7777);assert.throws(()=>quote(s,r),/invalid_copy_setup_binding/);
});
test('copied event and track previews conserve only their selected round budget',()=>{
 const s=fixture(),r=saved(s),c=r.configuration;
 c.sponsorSelection.eventEditionId=id(9900);c.sponsorSelection.raceId=s.races[1].id;
 c.root.children[0].shareBps=0;c.root.children[2].shareBps=10000;c.root.children[2].children[0].shareBps=10000;
 const q=quote(s,r);conserved(q);assert.equal(q.proposedWei,101n);assert.ok(q.groups.filter(g=>g.budgetWei>0n).every(g=>g.slot===2));
 for(const change of [x=>x.sponsorSelection.eventEditionId=null,x=>x.sponsorSelection.raceId=id(7777),x=>x.sponsorSelection.raceId=s.races[0].id,
  x=>{x.root.children[2].shareBps=5000;x.root.children[3].shareBps=5000;},
  x=>{x.root.children[2].children[0].shareBps=0;x.root.children[2].children[1].shareBps=10000;}]){
  const tampered=structuredClone(r);change(tampered.configuration);assert.throws(()=>quote(s,tampered),/invalid_copy_setup_binding|invalid_reward_setup/);
 }
});
test('repository reads only the owned source-pinned revision and rejects stale or changed records',async()=>{
 const s=fixture(),record=saved(s),identity={userId:id(9991),sessionId:id(9992)},pin={batchSha256:s.batchSha256,leagueId:s.leagueId,seasonId:s.seasonId,projectionSha256:fiveRoundCopyProjectionHashV1(s)};let calls=0;
 const rpc=async(name,args)=>{calls++;assert.equal(name,'service_reward_demo_copy_sponsor');assert.equal(args.p_action,'read');assert.equal(args.p_actor_user_id,identity.userId);assert.equal(args.p_request_id,null);return{error:null,data:{result:record,source:s,sourceFingerprint:'f'.repeat(64)}};};
 const q=await readHostedCopyAllocation(identity,record.id,1,pin,rpc);conserved(q);assert.equal(calls,1);await assert.rejects(readHostedCopyAllocation(identity,record.id,2,pin,rpc),/reward_setup_conflict/);
 record.configuration.root.children[0].children[0].id=id(3333);record.configuration.guided.groups[0].nodeId=id(3333);await assert.rejects(readHostedCopyAllocation(identity,record.id,1,pin,rpc),/invalid_copy_setup_binding/);
 record.configuration=saved(s).configuration;s.results[0].finishTimeMs='999';await assert.rejects(readHostedCopyAllocation(identity,record.id,1,pin,rpc),/copy_projection_changed/);
});
test('review handoff binds one saved revision, source, both decisions and exact integer awards without writes',async()=>{
 const s=fixture(),selections=duplicate(s),record=saved(s),identity={userId:id(9991),sessionId:id(9992)};selectGroup(record,'club_metres');
 const pin={batchSha256:s.batchSha256,leagueId:s.leagueId,seasonId:s.seasonId,projectionSha256:fiveRoundCopyProjectionHashV1(s)},review={sourceHash:pin.projectionSha256,resultIds:s.results.filter(r=>r.clubId===null).map(r=>r.id)},versions={combined:'synthetic-combined-v1',unaffiliated:'synthetic-unaffiliated-v1'};
 let reads=0;const rpc=async(name,args)=>{reads++;assert.equal(name,'service_reward_demo_copy_sponsor');assert.equal(args.p_action,'read');assert.equal(args.p_actor_session_id,identity.sessionId);return{error:null,data:{result:record,source:s,sourceFingerprint:'f'.repeat(64)}};};
 const get=(v=versions)=>readHostedCopyAllocationHandoff(identity,record.id,1,pin,rpc,selections,review,v);
 const first=await get(),second=await get();assert.equal(reads,2);assert.deepEqual(first,second);
 assert.equal(first.documentHash,fiveRoundCopyProjectionHashV1(first.document));assert.equal(first.document.allocation.budgetWei,'101');
 assert.equal(first.document.reviews.unaffiliated.resultIds.length,5);assert.deepEqual(first.document.reviews.combined.selections,selections);
 assert.deepEqual(verifyHandoff(first,first.documentHash),{documentHash:first.documentHash,setupId:record.id,revision:1,chainId:10143,state:'unapproved',payableWei:'0',budgetWei:'101',proposedWei:'101'});
 assert.notEqual((await get({...versions,combined:'synthetic-combined-v2'})).documentHash,first.documentHash);
 const serialized=JSON.stringify(first);for(const secret of [identity.userId,identity.sessionId,'accessToken','email','password','privateKey','signedTransaction'])assert.equal(serialized.includes(secret),false);
 for(const mutate of [d=>d.setup.revision++,d=>d.allocation.groups.find(g=>g.awards.length).awards[0].amountWei='999',d=>d.reviews.unaffiliated.resultIds.pop(),d=>d.reviews.combined.selections[0].keepResultId=id(999)]) {
  const changed=structuredClone(first);mutate(changed.document);assert.throws(()=>verifyHandoff(changed,first.documentHash),/checksum mismatch/);
  changed.documentHash=fiveRoundCopyProjectionHashV1(changed.document);assert.throws(()=>verifyHandoff(changed,first.documentHash),/checksum mismatch/);
 }
 await assert.rejects(readHostedCopyAllocationHandoff(identity,record.id,2,pin,rpc,selections,review,versions),/reward_setup_conflict/);
 await assert.rejects(get({...versions,unaffiliated:null}),/invalid_copy_setup_binding/);
});
test('handoff opens only the bounded read route in sponsor mode',()=>{
 const path=`https://podium.raceson.com/api/v1/rewards/demo-copy/sponsor-setups/${setupId}/allocation/1/handoff`;
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path),'sponsor-drafts-v1'),true);
 assert.equal(hostedCopyRequestAllowed('GET',new URL(path),'preview-v1'),false);
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(hostedCopyRequestAllowed(method,new URL(path),'sponsor-drafts-v1'),false);
 for(const suffix of ['?approve=true','/approve','/receipt'])assert.equal(hostedCopyRequestAllowed('GET',new URL(path+suffix),'sponsor-drafts-v1'),false);
});
