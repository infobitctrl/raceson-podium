import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFiveRoundCopyV1, previewFiveRoundCopyV1, quoteFiveRoundCopyPrizesV1 } from '../../../packages/domain/dist/rewards/five-round-copy-v1.js';
import { readFiveRoundCopyV1, fiveRoundCopyProjectionHashV1 } from '../../../packages/db/dist/rewards/five-round-copy-v1.js';

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
const table=(p,slot,category=id(30))=>p.tables.find(t=>t.slot===slot&&t.classificationId===category);
const prize=[{rank:1,amountWei:101n},{rank:2,amountWei:50n}];
function extra(source,status,classified=false){
 source.results.push({...source.results[0],id:id(999),registrationId:id(998),status,classificationIds:classified?[id(30)]:[],finishTimeMs:status==='finished'?'999':null,rankOverall:status==='finished'?5:null});source.races[0].resultCount++;
}
test('five completed rounds contribute to both final season standings and final-round prizes',()=>{
 const s=fixture(),p=previewFiveRoundCopyV1(s);
 assert.equal(table(p,5).candidates[0].beneficiaryId,id(11));
 assert.deepEqual(table(p,null).candidates.map(r=>[r.beneficiaryId,r.evidenceValue]),[[id(12),460],[id(11),340]]);
 const q=quoteFiveRoundCopyPrizesV1(s,{slot:5,classificationId:id(30)},prize);
 assert.equal(q.awards[0].beneficiaryId,id(11));assert.equal(q.awards[0].amountWei,101n);assert.equal(q.payableWei,0n);assert.equal(q.state,'unapproved');
 assert.equal(decodeFiveRoundCopyV1(s).results[0].finishTimeMs,'9007199254740993');
});
test('known unclassified finishes retain participation and exact integer distance, not classification awards',()=>{
 const p=previewFiveRoundCopyV1(fixture());assert.equal(p.counts.unclassifiedFinishes,5);
 assert.equal(table(p,null).candidates.some(c=>c.beneficiaryId===id(13)),false);
 const r=p.participation.find(p=>p.slot===null).rows.find(r=>r.athleteId===id(13));
 assert.equal(r.finishes,5);assert.equal(r.distanceMetres,'27160');
});
test('sporting ties share occupied slots; athlete aliases do not decide prizes',()=>{
 const s=fixture();for(const r of s.results)if(r.classificationIds.length)r.rankOverall=1;
 const q=quoteFiveRoundCopyPrizesV1(s,{slot:null,classificationId:id(30)},prize);
 assert.deepEqual(q.awards.map(a=>a.place),[1,1]);assert.deepEqual(q.awards.map(a=>a.amountWei),[76n,75n]);assert.equal(q.unusedWei,0n);
 const clubs=table(previewFiveRoundCopyV1(s),null,null);assert.deepEqual(clubs.candidates.map(c=>c.order),[1,1]);
});
test('extra nonfinished registration does not duplicate an award, but duplicate finishes hold affected combined scopes',()=>{
 const s=fixture();extra(s,'dns');let p=previewFiveRoundCopyV1(s);assert.deepEqual(p.duplicateFinishSlots,[]);assert.equal(table(p,1).heldReason,null);
 s.results.at(-1).status='finished';s.results.at(-1).finishTimeMs='999';s.results.at(-1).rankOverall=5;
 p=previewFiveRoundCopyV1(s);assert.deepEqual(p.duplicateFinishSlots,[1]);assert.equal(table(p,1).heldReason,null);
 assert.equal(table(p,1,null).candidates.length,0);assert.equal(p.participation.find(r=>r.slot===null).rows.length,0);
 const q=quoteFiveRoundCopyPrizesV1(s,{slot:1,classificationId:null},prize);assert.equal(q.awards.length,0);assert.equal(q.unusedWei,151n);
});
test('duplicate classified finishes hold category round and season while other rounds remain calculable',()=>{
 const s=fixture();extra(s,'finished',true);const p=previewFiveRoundCopyV1(s);
 assert.equal(table(p,1).heldReason,'duplicate_classified_finish');assert.equal(table(p,null).candidates.length,0);assert.equal(table(p,5).candidates.length,2);
});
test('incomplete rounds, foreign publication, missing/overlapping membership and unsafe values fail closed',()=>{
 const mutations=[s=>s.races.pop(),s=>s.results.pop(),s=>{delete s.results[0].classificationIds;},s=>s.results[0].classificationIds.push(id(30)),s=>s.results[0].publicationId=id(999),s=>s.results[0].classificationIds=[id(999)],s=>s.results[0].finishTimeMs=9007199254740992,s=>s.results[0].finishTimeMs='9223372036854775808',s=>s.athletes[0].name='Original Person',s=>s.results.push(s.results[0]),s=>s.policies[0].participationPoints=1.5];
 for(const mutate of mutations){const s=fixture();mutate(s);assert.throws(()=>decodeFiveRoundCopyV1(s),/invalid_five_round_copy_v1/);}
});
test('missing distance holds distance metrics without dropping participation finishes',()=>{
 const s=fixture();s.races[0].distanceMetres=null;const p=previewFiveRoundCopyV1(s).participation.find(r=>r.slot===1);
 assert.equal(p.rows.length,3);assert.equal(p.rows[0].distanceMetres,null);assert.equal(p.distanceHeldReason,'missing_distance');
});
test('independently pinned repository read rejects changed live data even with original batch hashes',async()=>{
 const s=fixture(),pin={batchSha256:s.batchSha256,projectionSha256:fiveRoundCopyProjectionHashV1(s),leagueId:s.leagueId,seasonId:s.seasonId};
 assert.deepEqual(await readFiveRoundCopyV1(pin,async()=>s),s);
 for(const mutate of [s=>s.results[0].finishTimeMs='1',s=>s.results[0].classificationIds=[],s=>s.policies[0].points[0]++,s=>s.results.pop()]){
  const changed=structuredClone(s);mutate(changed);await assert.rejects(readFiveRoundCopyV1(pin,async()=>changed),/copy_projection_changed/);
 }
 await assert.rejects(readFiveRoundCopyV1({...pin,seasonId:id(999)},async()=>s),/copy_scope_changed/);
 assert.equal(fiveRoundCopyProjectionHashV1({b:1,a:2}),fiveRoundCopyProjectionHashV1({a:2,b:1}));
});
test('invalid prize order and unknown selectors are rejected',()=>{
 assert.throws(()=>quoteFiveRoundCopyPrizesV1(fixture(),{slot:6,classificationId:id(30)},prize));
 assert.throws(()=>quoteFiveRoundCopyPrizesV1(fixture(),{slot:1,classificationId:id(30)},[{rank:2,amountWei:1n}]));
});
