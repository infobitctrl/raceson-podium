import assert from "node:assert/strict";
import test from "node:test";
import {historicalAllocationSourceV4} from "../../../packages/domain/dist/rewards/historical-source-v4.js";
import {historicalAllocationSourceV3} from "../../../packages/domain/dist/rewards/historical-source-v3.js";
import {publishedSnapshot,publishedMapping,id} from "./fixtures/published-reward-v2.mjs";
const now="2026-09-10T03:00:00.000Z", hash="a".repeat(64);
const decisions=[{id:id(901),slot:1,contextHash:hash,decision:"confirmed_final",reviewedAt:now,current:true}];
function fixture(){const s=publishedSnapshot();for(const c of s.catalogue.categories)if(c.target==="individual")c.eligibility.classificationSource="public_current_results_explicit";return s;}
const adapt=(s,review=decisions)=>historicalAllocationSourceV4(s,publishedMapping(),hash,review,now);
test("explicit unclassified finisher remains in results and does not invalidate official category membership",()=>{
 const s=fixture();s.results[0].classificationIds=[];const result=adapt(s), round=result.rounds[0];
 assert.equal(round.results.length,s.results.filter(r=>s.catalogue.rounds[0].races.some(c=>c.id===r.raceId)).length);
 assert.equal(round.results.find(r=>r.id===s.results[0].id).status,"finished");
 assert.equal(round.results.find(r=>r.id===s.results[0].id).categoryId,null);
 const tables=result.standings.filter(t=>t.slot===1&&s.catalogue.categories.find(c=>c.id===t.categoryId).target==="individual");
 assert.ok(tables.every(t=>t.complete));assert.ok(tables.every(t=>!t.rows.some(r=>r.sourceRowId===s.results[0].id)));
 assert.equal(historicalAllocationSourceV3(s,publishedMapping(),hash,decisions,now).standings.find(t=>t.categoryId===tables[0].categoryId&&t.slot===1).complete,false);
});
test("older imports without explicit-membership provenance keep their original hold",()=>{
 const s=publishedSnapshot();s.results[0].classificationIds=[];
 assert.ok(adapt(s).standings.some(t=>t.slot===1&&!t.complete));
});
test("membership provenance does not override missing rank, duplicate finisher, source validation or final review",()=>{
 const missing=fixture();missing.results[0].rankOverall=null;assert.ok(adapt(missing).standings.some(t=>t.slot===1&&!t.complete));
 const duplicate=fixture();duplicate.results[1].athleteId=duplicate.results[0].athleteId;
 assert.ok(adapt(duplicate).standings.some(t=>t.slot===1&&!t.complete));
 const foreign=fixture();foreign.results[0].classificationIds=[id(999)];assert.throws(()=>adapt(foreign));
 const overlapping=fixture();overlapping.catalogue.categories.push({...overlapping.catalogue.categories[0],id:id(7),name:"Overlapping category"});
 overlapping.results[0].classificationIds.push(id(7));assert.ok(adapt(overlapping).standings.filter(t=>t.slot===1&&[id(2),id(7)].includes(t.categoryId)).every(t=>!t.complete));
 const absent=fixture();delete absent.results[0].classificationIds;assert.throws(()=>adapt(absent));
 assert.ok(adapt(fixture(),[]).standings.every(t=>t.evidence.held));
});
