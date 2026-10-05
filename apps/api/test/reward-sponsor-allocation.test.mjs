import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSponsorAllocation} from '@raceson/domain/rewards/sponsor-allocation';
import {addGuidedGroup} from '@raceson/domain/rewards/guided-setup-editor';
import {sponsorAllocationFixture,sponsorFixtureId} from './fixtures/sponsor-allocation.mjs';
const preview=f=>previewSponsorAllocation(f.launch,f.plan,f.binding,f.source);
const group=(p,type)=>p.pots[0].groups.find(g=>g.type===type);
function conserved(p){
 assert.equal(p.payableWei,0n);assert.equal(p.proposedWei+p.retainedWei,p.budgetWei);
 assert.equal(p.pots.reduce((s,p)=>s+p.budgetWei,0n),p.budgetWei);
 for(const pot of p.pots){assert.equal(pot.proposedWei+pot.retainedWei,pot.budgetWei);
  assert.equal(pot.recipients.reduce((n,r)=>n+r.amountWei,0n),pot.proposedWei);
  assert.equal(new Set(pot.recipients.map(r=>r.beneficiaryKind+':'+r.beneficiaryId)).size,pot.recipients.length);
  for(const g of pot.groups){assert.equal(g.proposedWei+g.retainedWei,g.budgetWei);assert.equal(g.awards.reduce((n,r)=>n+r.amountWei,0n),g.proposedWei);if(g.hold)assert.equal(g.proposedWei,0n);}
 }
}
test('V4 preserves exact flexible wei pots and all category awards without wallet filtering',()=>{
 const f=sponsorAllocationFixture(),p=preview(f);conserved(p);
 assert.deepEqual(p.pots.map(p=>p.budgetWei.toString()),f.plan.caps);assert.equal(p.budgetWei,1003n);
 assert.equal(p.schema,'raceson-sponsor-allocation-preview-v4');assert.equal(p.state,'unapproved');
 assert.ok(p.pots.every(p=>p.groups.every(g=>g.hold===null)));
 const recipient=p.pots[0].recipients.find(r=>r.beneficiaryId===f.source.rounds[0].results[0].athleteId);
 assert.equal(recipient.groupIds.length,3);assert.ok(p.retainedWei>0n);assert.equal(group(p,'athlete_finishes').awards.length,20);
});
test('no source or changed league/season/catalogue never becomes approval',()=>{
 for(const mutate of [f=>f.source=null,f=>f.binding=null,f=>f.binding.sourceSeasonId=sponsorFixtureId(999),f=>f.binding.catalogueHash='c'.repeat(64)]){
  const f=sponsorAllocationFixture();mutate(f);const p=preview(f);conserved(p);assert.equal(p.proposedWei,0n);assert.equal(p.retainedWei,p.budgetWei);
 }
});
test('frozen launch and pot mismatches reject rather than silently recalculating deployed economics',()=>{
 for(const mutate of [f=>f.launch.setup.revision++,f=>f.launch.configurationHash='c'.repeat(64),f=>f.plan.caps.reverse(),f=>f.launch.id=sponsorFixtureId(998)]){
  const f=sponsorAllocationFixture();mutate(f);assert.throws(()=>preview(f));
 }
});
test('one missing/held/ambiguous round reserves that race and league while other rounds stay calculable',()=>{
 for(const mutate of [r=>r.evidence=null,r=>r.evidence.held=true,r=>r.resultsComplete=false,r=>r.expectedResultCount++,r=>r.results[0].status='unknown']){
  const f=sponsorAllocationFixture();mutate(f.source.rounds[4]);const p=preview(f);conserved(p);
  assert.equal(p.pots[0].proposedWei,0n);assert.equal(p.pots[5].proposedWei,0n);assert.ok(p.pots[1].proposedWei>0n);
 }
});
test('non-finish starts do not invalidate official finishes or change participation denominators',()=>{
 for(const status of ['dns','dnf','dsq']){
  const f=sponsorAllocationFixture(),before=preview(f),round=f.source.rounds[2];
  round.results.push({...round.results[0],id:sponsorFixtureId(990),status});
  // An athlete with only non-finish starts must not become eligible either.
  round.results.push({...round.results[0],id:sponsorFixtureId(991),athleteId:sponsorFixtureId(997),status});
  round.results.push({...round.results[0],id:sponsorFixtureId(992),athleteId:sponsorFixtureId(997),status});
  round.expectedResultCount=round.results.length;
  const after=preview(f);conserved(after);assert.deepEqual(after,before);
 }
});
test('duplicate finishes in one category hold that category and participation, not other official tables',()=>{
 const f=sponsorAllocationFixture(),round=f.source.rounds[2];
 round.results.push({...round.results[0],id:sponsorFixtureId(990)});round.expectedResultCount++;
 const p=preview(f);conserved(p);
 assert.equal(p.pots[3].groups[0].hold,'ambiguous_results');
 assert.equal(group(p,'athlete_standings').hold,'ambiguous_results');
 for(const type of ['athlete_finishes','athlete_metres','club_metres'])assert.equal(group(p,type).hold,'ambiguous_results');
 assert.equal(group(p,'club_standings').hold,null);assert.ok(p.pots[1].proposedWei>0n);
});
test('two classified official finishes permit multiple category awards but cannot count twice for participation',()=>{
 const f=sponsorAllocationFixture(),round=f.source.rounds[2],category=f.source.categories[1];
 const second=round.results.find(r=>r.categoryId===category.id),first=round.results[0];
 second.athleteId=first.athleteId;
 const table=f.source.standings.find(t=>t.slot===3&&t.categoryId===category.id);
 table.rows.find(r=>r.sourceRowId===second.id).beneficiaryId=first.athleteId;
 let c=f.launch.setup.configuration,pot=c.guided.pots.find(p=>p.slot===3);
 c=addGuidedGroup(c,pot.nodeId,'athlete_standings',()=>sponsorFixtureId(900),{...category,competitionName:'Synthetic',name:'Second category'});
 c.root.children.find(p=>p.id===pot.nodeId).children.forEach(g=>g.shareBps=5000);
 f.launch.setup.configuration=c;
 const p=preview(f);conserved(p);
 assert.ok(p.pots[3].groups.every(g=>g.hold===null));
 assert.equal(p.pots[3].recipients.find(r=>r.beneficiaryId===first.athleteId).groupIds.length,2);
 for(const type of ['athlete_finishes','athlete_metres','club_metres'])assert.equal(group(p,type).hold,'ambiguous_results');
 assert.equal(group(p,'athlete_standings').hold,null);
});
test('category completeness remains authoritative when other finishes have no classification',()=>{
 const f=sponsorAllocationFixture(),round=f.source.rounds[3];
 const unrelated=round.results.find(r=>r.categoryId!==f.source.categories[0].id&&r.status==='finished');
 unrelated.categoryId=null;
 let p=preview(f);conserved(p);assert.equal(p.pots[4].groups[0].hold,null);
 const table=f.source.standings.find(t=>t.slot===4&&t.categoryId===f.source.categories[0].id);
 table.complete=false;p=preview(f);conserved(p);assert.equal(p.pots[4].groups[0].hold,'incomplete_standings');
 // An attested table still cannot introduce a beneficiary without a matching
 // classified finish and exact source row.
 table.complete=true;table.rows[0].beneficiaryId=unrelated.athleteId;table.rows[0].sourceRowId=unrelated.id;
 p=preview(f);conserved(p);assert.equal(p.pots[4].groups[0].hold,'invalid_standings');
});
test('stale league digests and incomplete/invalid official tables hold exact category amounts',()=>{
 const f=sponsorAllocationFixture();f.source.league.roundDigests.reverse();assert.equal(preview(f).pots[0].proposedWei,0n);
 for(const mutate of [t=>t.rows.shift(),t=>t.complete=false,t=>t.evidence.held=true,t=>t.roundDigests=[],t=>t.rows[0].sourceRowId=sponsorFixtureId(999)]){
  const f=sponsorAllocationFixture();mutate(f.source.standings.find(t=>t.slot===1&&t.categoryId===f.source.categories[0].id));const p=preview(f);conserved(p);assert.equal(p.pots[1].proposedWei,0n);
 }
});
test('ties share occupied positions and fewer finishers retain unoccupied prize positions',()=>{
 const f=sponsorAllocationFixture(),table=f.source.standings.find(t=>t.slot===1&&t.categoryId===f.source.categories[0].id);
 table.rows.forEach(r=>r.rank=1);const p=preview(f),g=p.pots[1].groups[0];conserved(p);
 assert.equal(g.awards.length,2);assert.ok(g.retainedWei>0n);assert.ok(g.awards.every(a=>a.rank===1));
 assert.ok(g.awards[0].amountWei-g.awards[1].amountWei<=1n);
});
test('participation missing distance and missing club retain the relevant complete denominator only',()=>{
 const f=sponsorAllocationFixture();f.source.rounds[0].results[0].distanceMetres=null;
 let p=preview(f);conserved(p);assert.equal(group(p,'athlete_metres').hold,'missing_distance');assert.equal(group(p,'club_metres').hold,'missing_distance');assert.equal(group(p,'athlete_finishes').hold,null);
 const c=sponsorAllocationFixture();c.source.rounds[0].results[0].clubId=null;p=preview(c);conserved(p);assert.equal(group(p,'club_metres').hold,'club_attribution_unresolved');assert.equal(group(p,'athlete_metres').hold,null);
});
test('minimum finishes applies to athletes before represented-at-finish club aggregation',()=>{
 const f=sponsorAllocationFixture();f.launch.setup.configuration.guided.groups.filter(g=>g.type==='club_metres'||g.type==='athlete_finishes').forEach(g=>g.minimumFinishes=5);
 const p=preview(f);conserved(p);assert.equal(group(p,'athlete_finishes').awards.length,17);
 assert.ok(group(p,'club_metres').awards.every(r=>r.sourceRowIds.length%5===0));
});
test('source input order cannot change awarded wei or explanations',()=>{
 const f=sponsorAllocationFixture(),p=preview(f);f.source.standings.reverse();f.source.standings.forEach(t=>t.rows.reverse());f.source.rounds.forEach(r=>r.results.reverse());
 assert.deepEqual(preview(f),p);
});
test('ranked participation uses shared occupied-place ties instead of splitting by distance',()=>{
 const f=sponsorAllocationFixture(),c=f.launch.setup.configuration;
 const g=c.guided.groups.find(g=>g.type==='athlete_finishes');g.method='ranked';
 c.root.children[0].children.find(n=>n.id===g.nodeId).rule.sharesBps=[10000];
 const p=preview(f),r=group(p,'athlete_finishes');conserved(p);
 assert.equal(r.hold,null);assert.equal(r.proposedWei,r.budgetWei);
 assert.ok(r.awards.every(r=>r.weight===5n&&r.rank===1));
 assert.equal(r.awards.length,17);
 assert.ok(r.awards.every(a=>a.amountWei===3n||a.amountWei===4n));
});
