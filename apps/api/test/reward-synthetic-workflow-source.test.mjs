import assert from 'node:assert/strict';
import test from 'node:test';
import {workflowFixture,workflowProfiles} from '../../../demo/rewards/scripts/synthetic-workflow-fixture.mjs';
import {decodeStoredRewardSnapshot,decodePublishedRewardSnapshotV2} from '../../../packages/domain/dist/rewards/published-preview-v2.js';
import {createPrivyTestnetPilotV3} from '../../../packages/domain/dist/rewards/privy-testnet-pilot-v3.js';
const time='2026-09-30T12:51:58.000Z';
test('new synthetic source is finite, labelled and does not alter the old source',()=>{
 const old=createPrivyTestnetPilotV3(time),before=JSON.stringify(old);const f=workflowFixture(time);
 assert.equal(f.snapshot.results.length,8);assert.equal(f.snapshot.clubs.length,0);
 assert.deepEqual([...new Set(f.snapshot.results.map(r=>r.athleteId))].sort(),workflowProfiles);
 assert.deepEqual(decodeStoredRewardSnapshot(f.snapshot),f.snapshot);assert.equal(JSON.stringify(old),before);
 assert.throws(()=>decodePublishedRewardSnapshotV2(f.snapshot));
});
test('synthetic snapshot rejects relabelled real source, foreign identity and duplicated recipients',()=>{
 const good=workflowFixture(time).snapshot;
 for(const change of [p=>{p.version=2;p.sourceOrigin='https://www.raceson.com';},p=>p.results[0].athleteId='40c6cfd6-5f3f-44c5-9d8f-68e273761a70',p=>p.results[1].athleteId=p.results[0].athleteId,p=>p.catalogue.rounds[0].editionId='8e240924-7918-4df0-9000-000000000004',p=>p.catalogue.categories[0].eligibility.demoOnly=false,p=>p.results[0].athleteName='Real athlete',p=>p.results[0].clubId='9a000000-0000-4000-8000-000000005000']){
  const bad=structuredClone(good);change(bad);assert.throws(()=>decodeStoredRewardSnapshot(bad));
 }
});

test('corrected revision preserves the first snapshot and carries empty course publications',async()=>{
 const {correctedWorkflowFixture}=await import('../../../demo/rewards/scripts/synthetic-workflow-fixture.mjs');
 const before=workflowFixture(time),revision=correctedWorkflowFixture(time);
 assert.equal(before.snapshot.sourceSeasonId,'9b000000-0000-4000-8000-000000000051');
 assert.equal(revision.snapshot.sourceSeasonId,'9b000000-0000-4000-8000-000000000151');
 assert.equal(revision.snapshot.sourceLeagueId,before.snapshot.sourceLeagueId);
 for(const round of revision.snapshot.catalogue.rounds){assert.equal(round.races.length,2);assert.deepEqual(round.races.map(r=>r.resultCount),[2,0]);assert.ok(round.races.every(r=>r.publicationId));}
 assert.deepEqual(revision.snapshot.results,before.snapshot.results);
 const wrong=structuredClone(revision.snapshot);wrong.sourceOrigin=before.snapshot.sourceOrigin;assert.throws(()=>decodeStoredRewardSnapshot(wrong));
});

test('empty-course synthetic evidence retains review holds and cannot be reused by the original fixture',async()=>{
 const {correctedWorkflowFixture,workflowId}=await import('../../../demo/rewards/scripts/synthetic-workflow-fixture.mjs');
 const {historicalAllocationSourceV3}=await import('../../../packages/domain/dist/rewards/historical-source-v3.js');
 const f=correctedWorkflowFixture(time),hash='a'.repeat(64),observed='2026-09-30T13:30:00.000Z';
 const reviews=[1,2,3,4].map(slot=>({id:workflowId(990000+slot),slot,contextHash:hash,decision:'confirmed_final',reviewedAt:observed,current:true}));
 const projected=historicalAllocationSourceV3(f.snapshot,f.mapping,hash,reviews,observed);
 assert.ok(projected.rounds.slice(0,4).every(r=>r.evidence?.kind==='synthetic'&&!r.evidence.held));
 assert.equal(projected.standings.filter(t=>t.categoryId===workflowId(6)&&t.complete&&t.rows.length===0).length,4);
 const held=historicalAllocationSourceV3(f.snapshot,f.mapping,hash,[],observed);assert.ok(held.rounds.slice(0,4).every(r=>r.evidence?.held));
 const old=structuredClone(f.snapshot);old.sourceOrigin='urn:raceson:synthetic:workflow-20260930:v1';old.sourceSeasonId=workflowId(51);
 const prior=historicalAllocationSourceV3(old,f.mapping,hash,reviews,observed);assert.ok(prior.rounds.slice(0,4).every(r=>r.evidence===null));
});
