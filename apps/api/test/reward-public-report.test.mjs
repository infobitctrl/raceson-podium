import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodePublicRewardReport,publicRewardTotals} from '@raceson/domain/rewards/public-report';
import {dispatchPublicRewardReport} from '../dist/routes/rewards/public-report.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../../../demo/rewards/reports/archived-20260921-public-report.json',import.meta.url),'utf8'));
test('public synthetic report conserves all six budgets without private identity fields',()=>{
 const report=decodePublicRewardReport(fixture()),p=report.programmes[0],t=publicRewardTotals(p.pots);
 assert.equal(p.pots.length,6);assert.equal(t.athletes,10);assert.equal(t.clubs,4);
 assert.equal(t.budget,100n*10n**18n);assert.equal(t.paid+t.unpaid+t.unallocated,t.budget);
 assert.equal(p.pots.reduce((n,p)=>n+p.rows.length,0),84);
 assert.doesNotMatch(JSON.stringify(report),/"(?:address|recipientAddress|profileId|userId|sessionId|proof|signature|sourceId|entitlementId|draftId)"/);
});
test('strict public decoder rejects private fields, invented paid states, duplicates and inconsistent totals',()=>{
 const changes=[
  p=>{p.pots[0].rows[0].recipientAddress='0x'+'a'.repeat(40);},
  p=>{p.pots[0].rows[1].payment='paid';p.pots[0].rows[1].transactionHash=null;},
  p=>{p.pots[0].rows.push(p.pots[0].rows[0]);},
  p=>{p.pots[0].budgetWei='1';},
  p=>{p.pots[1].rows[0].name='Different identity';},
  p=>{p.pots[0].approvedAt='2099-01-01T00:00:00.000Z';},
  p=>{p.source='minimized_source';},
  p=>{p.status='completed';Object.assign(p.pots[0].rows[0],{payment:'not_paid',transactionHash:null,paidAt:null});},
 ];
 for(const change of changes){const report=fixture();change(report.programmes[0]);assert.throws(()=>decodePublicRewardReport(report),/invalid_public_reward_report/);}
});
test('public report route reads only an explicit host report, without authentication or database scope',async()=>{
 const headers={};let status,data,reads=0;
 const res={setHeader:(k,v)=>headers[k]=v};
 const deps={config:()=>({chainId:10143}),sendSuccess:(_r,d)=>{status=200;data=d;},sendError:(_r,s,c)=>{status=s;data=c;}};
 const read=()=>{reads++;return fixture();};
 assert.equal(await dispatchPublicRewardReport({method:'GET'},res,new URL('http://local/api/v1/rewards/public-report'),deps,read),true);
 assert.equal(status,200);assert.equal(reads,1);assert.equal(headers['Cache-Control'],'no-store');assert.equal(data.programmes.length,1);
 await dispatchPublicRewardReport({method:'GET'},res,new URL('http://local/api/v1/rewards/public-report?draft=private'),deps,read);
 assert.equal(status,400);assert.equal(reads,1);
 await dispatchPublicRewardReport({method:'POST'},res,new URL('http://local/api/v1/rewards/public-report'),deps,read);
 assert.equal(status,405);assert.equal(reads,1);
 await dispatchPublicRewardReport({method:'GET'},res,new URL('http://local/api/v1/rewards/public-report'),deps);
 assert.equal(status,503);
 await dispatchPublicRewardReport({method:'GET'},res,new URL('http://local/api/v1/rewards/public-report'),{...deps,config:()=>({chainId:31337})},read);
 assert.equal(status,503);assert.equal(reads,1);
 await dispatchPublicRewardReport({method:'GET'},res,new URL('http://local/api/v1/rewards/public-report'),deps,()=>({privateKey:'must not return'}));
 assert.equal(status,503);assert.equal(data,'public_reward_report_unavailable');
});
test('split awards reconcile exactly with combined awards and retain combined settlement evidence',async()=>{
 const {publicRewardPool}=await import('@raceson/domain/rewards/public-report');
 const report=decodePublicRewardReport(fixture()),league=report.programmes[0].pots.find(p=>p.id==='league');
 assert.equal(report.schema,'raceson-public-reward-report-v3');
 const pools=league.pools.map(p=>publicRewardPool(league,p.key));
 assert.deepEqual(pools.map(p=>p.rows.length),[10,4,10]);
 for(const row of league.rows){
  assert.equal(pools.flatMap(p=>p.rows).filter(r=>r.recipientId===row.recipientId).reduce((n,r)=>n+BigInt(r.amountWei),0n),BigInt(row.amountWei));
  for(const component of pools.flatMap(p=>p.rows).filter(r=>r.recipientId===row.recipientId))assert.equal(component.transactionHash,row.transactionHash);
 }
 for(const mutate of [
  p=>p.pools[0].awards[0].amountWei='1',
  p=>p.pools[0].awards.push(p.pools[0].awards[0]),
  p=>p.pools[0].awards[0].recipientId='unknown',
  p=>p.pools[1].awards[0].recipientId='athlete-1',
  p=>p.pools[0].awards[0].privateId='private',
 ]){const bad=fixture();mutate(bad.programmes[0].pots.find(p=>p.id==='league'));assert.throws(()=>decodePublicRewardReport(bad));}
});
test('legacy reports remain readable without inventing split allocations',async()=>{
 const {publicRewardPool}=await import('@raceson/domain/rewards/public-report');
 const old=fixture();old.schema='raceson-public-reward-report-v1';
 for(const p of old.programmes[0].pots)for(const pool of p.pools){delete pool.awards;delete pool.categories;}
 const parsed=decodePublicRewardReport(old);
 assert.equal(publicRewardPool(parsed.programmes[0].pots[0],'athlete_standings'),undefined);
});

test('approved positions and prize slots are sourced and validated independently of actual tied awards',()=>{
 const report=decodePublicRewardReport(fixture()),round=report.programmes[0].pots[0];
 for(const pool of round.pools){
  assert.ok(pool.categories.length>0);
  for(const c of pool.categories){assert.equal(c.slots.length,10);assert.equal(c.slots.reduce((n,s)=>n+BigInt(s.amountWei),0n),BigInt(c.budgetWei));}
  for(const a of pool.awards){assert.ok(a.position>0);assert.ok(pool.categories.some(c=>c.id===a.categoryId));}
 }
 const participation=report.programmes[0].pots[5].pools.find(p=>p.key==='participation');
 assert.equal(participation.categories.length,0);assert.ok(participation.awards.every(a=>a.position===null&&a.categoryId===null));
 for(const mutate of [
  p=>p.categories[0].slots[0].amountWei='1',
  p=>p.categories[0].slots[0].position=2,
  p=>p.awards[0].position=99,
  p=>p.awards[0].categoryId='unknown',
  p=>p.categories[0].privateSourceId='hidden',
 ]){const bad=fixture();mutate(bad.programmes[0].pots[0].pools[0]);assert.throws(()=>decodePublicRewardReport(bad));}
});

test("empty public report is a valid fresh workspace",()=>{
 assert.deepEqual(decodePublicRewardReport({schema:"raceson-public-reward-report-v3",observedAt:"2026-09-21T00:00:00.000Z",programmes:[]}).programmes,[]);
});
