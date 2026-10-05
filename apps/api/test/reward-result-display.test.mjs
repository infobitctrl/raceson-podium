import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedSnapshot,publishedMapping,id} from './fixtures/published-reward-v2.mjs';
import {historicalAllocationSourceV4} from '@raceson/domain/rewards/historical-source-v4';
import {createGuidedSetup,bindGuidedSeason,addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import {createSponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {rewardResultDisplay} from '../dist/features/rewards/result-review-display.js';
import {rewardControllerResultDisplay} from '@raceson/db/rewards';
function fixture(kind='athlete_standings',tied=false){
 const snapshot=publishedSnapshot();
 if(kind==='club_standings'){
  snapshot.results.forEach((r,i)=>{const club=snapshot.clubs[i%2];r.clubId=club.clubId;r.clubName=club.name;});
  if(tied)snapshot.clubs[1].rounds[0].points=snapshot.clubs[0].rounds[0].points;
 }
 const mapping=publishedMapping(),hash='a'.repeat(64),source=historicalAllocationSourceV4(snapshot,mapping,hash,[],'2026-09-10T03:00:00.000Z');
 const binding={draftId:id(900),catalogueHash:hash,sourceLeagueId:snapshot.sourceLeagueId,sourceSeasonId:snapshot.sourceSeasonId};let seq=1000;
 let c=bindGuidedSeason(createGuidedSetup(()=>id(seq++)),{draftId:binding.draftId,catalogueHash:hash,roundId:null,editionId:null,programmeName:'Synthetic',eventName:'Synthetic'},snapshot.catalogue);
 c.budgetMon='1';c=addGuidedGroup(c,c.guided.pots[1].nodeId,kind,()=>id(seq++),snapshot.catalogue.categories.find(c=>c.target===(kind==='club_standings'?'club':'individual')));
 c.root.children.forEach((p,i)=>p.shareBps=i===1?10000:0);c.root.children[1].children[0].shareBps=10000;c.root.children[1].children[0].rule.sharesBps=kind==='club_standings'?[10000]:[6000,3000,1000];
 const setup={id:id(903),chainId:31337,revision:1,configuration:c,updatedAt:'2026-09-10T03:00:00.000Z'},launch={id:id(904),setup,state:'prepared',configurationHash:'b'.repeat(64),createdAt:setup.updatedAt};
 const plan=createSponsorExecutionPlan(launch,'0x'+'11'.repeat(20),{operator:'0x'+'22'.repeat(20),treasury:'0x'+'33'.repeat(20),reviewPeriods:[0,0,0,0,0,0]});
 const calculation=previewSponsorAllocation(launch,plan,binding,source).pots[1];
 return {snapshot,document:{schema:'raceson-sponsor-allocation-document-v4',launch,plan,binding,source,slot:1,contextHash:hash,calculation}};
}
test('source estimates show exact sporting rows without mutating held approval facts',()=>{
 const {snapshot,document}=fixture(),before=structuredClone(document);
 const held=rewardResultDisplay(document,snapshot);assert.equal(held.blocked,true);assert.ok(held.rows.every(r=>r.amountWei===null));
 const display=rewardResultDisplay(document,snapshot,true);assert.equal(display.estimated,true);assert.equal(display.blocked,false);
 assert.equal(display.rows.length,snapshot.catalogue.rounds[0].races.reduce((n,r)=>n+r.resultCount,0));
 assert.equal(display.rows[0].name,snapshot.results[0].athleteName);assert.equal(display.rows[0].timeMs,snapshot.results[0].finishTimeMs);
 assert.ok(BigInt(display.allocatedWei)>0n);assert.equal(display.rows.reduce((sum,r)=>sum+BigInt(r.amountWei??'0'),0n),BigInt(display.allocatedWei));
 assert.deepEqual(document,before);assert.equal(document.calculation.proposedWei,0n);assert.equal(document.calculation.groups[0].hold,'source_held');
 assert.equal(display.distribution.reduce((n,g)=>n+BigInt(g.budgetWei),0n),document.calculation.budgetWei);
 assert.equal(display.distribution.reduce((n,g)=>n+BigInt(g.allocatedWei),0n).toString(),display.allocatedWei);
 assert.equal(display.distribution.reduce((n,g)=>n+BigInt(g.retainedWei),0n).toString(),display.retainedWei);
 assert.ok(display.distribution.every(g=>g.prizes.reduce((n,p)=>n+BigInt(p.amountWei),0n)===BigInt(g.allocatedWei)));
 assert.ok(held.distribution.every(g=>g.held&&g.prizes.length===0));
});
test('name enrichment rejects different source identity and does not erase incomplete-result holds',()=>{
 const {snapshot,document}=fixture();const wrong=structuredClone(snapshot);wrong.sourceSeasonId=id(999);assert.throws(()=>rewardResultDisplay(document,wrong),/invalid_result_display/);
 const other=structuredClone(snapshot);other.results[0].athleteId=id(998);assert.throws(()=>rewardResultDisplay(document,other),/invalid_result_display/);
 document.source.rounds[0].resultsComplete=false;const display=rewardResultDisplay(document,snapshot,true);assert.equal(display.blocked,true);assert.ok(display.rows.every(r=>r.amountWei===null));
});
test('controller display read is scoped and refuses store errors and malformed responses',async()=>{
 const actor={subject:'did:privy:synthetic',wallet:'0x'+'11'.repeat(20)},scope={setupId:id(903),approvalId:id(905)};
 await rewardControllerResultDisplay(actor,scope,async(name,args)=>{assert.equal(name,'service_reward_controller_result_display');assert.equal(args.p_setup_id,scope.setupId);assert.equal(args.p_approval_id,scope.approvalId);assert.equal(args.p_operator,actor.wallet);return {data:{documentHash:'a'.repeat(64),snapshot:null},error:null};});
 for(const result of [{data:null,error:{message:'foreign operator'}},{data:{documentHash:'bad'},error:null}])await assert.rejects(()=>rewardControllerResultDisplay(actor,scope,async()=>result));
});

test('club rows use exact official round points and standings, including unrewarded clubs',()=>{
 const {snapshot,document}=fixture('club_standings'),before=structuredClone(document);
 const clubRows=rewardResultDisplay(document,snapshot,true).rows.filter(r=>r.kind==='club');
 assert.equal(clubRows.length,2);assert.deepEqual(clubRows.map(r=>r.rank),[1,2]);assert.deepEqual(clubRows.map(r=>r.points),[100,80]);
 assert.equal(clubRows[0].name,snapshot.clubs[0].name);assert.equal(clubRows[0].amountWei,'1000000000000000000');assert.equal(clubRows[1].amountWei,'0');
 assert.ok(rewardResultDisplay(document,snapshot).rows.filter(r=>r.kind==='club').every(r=>r.amountWei===null));assert.deepEqual(document,before);
});
test('tied club ranks and category amounts do not become invented finish times or duplicate totals',()=>{
 const {snapshot,document}=fixture('club_standings',true),display=rewardResultDisplay(document,snapshot,true),clubs=display.rows.filter(r=>r.kind==='club');
 assert.deepEqual(clubs.map(r=>r.rank),[1,1]);assert.ok(clubs.every(r=>r.points===100&&r.timeMs===null));
 assert.equal(clubs.reduce((n,r)=>n+BigInt(r.amountWei),0n).toString(),display.allocatedWei);
 assert.deepEqual(display.distribution[0].prizes,[{rank:1,amountWei:display.allocatedWei}]);
 const missing=structuredClone(snapshot);missing.clubs.forEach(c=>{c.rounds=c.rounds.filter(r=>r.slot!==1);});
 assert.ok(rewardResultDisplay(document,missing,true).rows.filter(r=>r.kind==='club').every(r=>r.points===null));
});

test('recipient totals use allocation identities and exact amounts without merging matching names',()=>{
 const {snapshot,document}=fixture();
 snapshot.results.forEach(row=>{row.athleteName='Same displayed name';});
 const before=structuredClone(document),display=rewardResultDisplay(document,snapshot,true);
 assert.ok(display.recipientTotals.length>1);
 assert.equal(new Set(display.recipientTotals.map(row=>row.key)).size,display.recipientTotals.length);
 assert.equal(display.recipientTotals.reduce((sum,row)=>sum+BigInt(row.amountWei),0n).toString(),display.allocatedWei);
 assert.ok(display.recipientTotals.every(row=>row.name==='Same displayed name'&&row.categoryCount>0));
 assert.deepEqual(document,before);
 const held=rewardResultDisplay(document,snapshot);
 assert.ok(held.recipientTotals.every(row=>row.amountWei===null));
});
