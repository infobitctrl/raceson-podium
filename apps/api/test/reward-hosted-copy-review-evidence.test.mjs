import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,id} from './fixtures/hosted-approval-fixture.mjs';
import {hostedCopyCategoryEvidence} from '../dist/features/rewards/hosted-copy-review-evidence.js';
test('category results preserve official race rank, ties, exact milliseconds and non-winning rows',()=>{
 const source=fixture(),rows=source.results.filter(r=>r.raceId===id(101));
 rows[0].rankOverall=7;rows[1].rankOverall=7;rows[0].finishTimeMs='3723123';rows[1].finishTimeMs='9007199254740993';
 rows[2].classificationIds=[id(30)];rows[2].status='dnf';rows[2].rankOverall=null;rows[2].finishTimeMs=null;
 const before=structuredClone(source),evidence=hostedCopyCategoryEvidence(source,1,id(30));
 assert.deepEqual(evidence.map(r=>[r.rankOverall,r.rankCategory,r.finishTimeMs,r.status]),[[7,1,'3723123','finished'],[7,1,'9007199254740993','finished'],[null,null,null,'dnf']]);
 assert.equal(evidence[0].club,'Races Club1');assert.equal(evidence[2].club,null);assert.deepEqual(source,before);
});
test('league categories show scoring points without inventing race ranks or aggregate times',()=>{
 const rows=hostedCopyCategoryEvidence(fixture(),0,id(30));assert.ok(rows.length>0);
 assert.ok(rows.every(r=>r.rankOverall===null&&r.finishTimeMs===null&&r.status==='standing'&&typeof r.points==='number'&&r.rankCategory>0));
 assert.throws(()=>hostedCopyCategoryEvidence(fixture(),1,id(999)),/invalid_copy_setup_binding/);
});
test('duplicate classified finishes retain raw evidence and never invent a category rank',()=>{
 const source=fixture();source.results[1].athleteId=source.results[0].athleteId;
 const rows=hostedCopyCategoryEvidence(source,1,id(30));assert.equal(rows.length,2);assert.ok(rows.every(r=>r.rankCategory===null));
});
