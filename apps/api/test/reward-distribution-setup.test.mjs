import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRewardSetup,decodeSavedRewardSetup,decodeRewardSetup,finishRewardSetup,setupReadiness,previewRewardSetup,presetSetupShares,balanceSetupChildren,setupNodes,updateSetupNode} from '../../../packages/domain/dist/rewards/distribution-setup.js';
import {previewSetupSource} from '../../../packages/domain/dist/rewards/distribution-setup-results.js';
const id=n=>`01000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const leaf=(n,share,count)=>({id:id(n),name:`Criteria ${n}`,shareBps:share,locked:false,children:[],rule:{basis:'race_position',sharesBps:presetSetupShares(count),source:null}});
const group=(n,share,children)=>({id:id(n),name:`Pot ${n}`,shareBps:share,locked:false,children,rule:null});
const draft=()=>({...createRewardSetup(id(1)),budgetMon:'100000',root:group(1,10000,[group(2,5000,[leaf(4,7000,25),leaf(5,3000,4)]),group(3,5000,[leaf(6,10000,10)])])});
test('independent branches have different criteria, winner counts and curves, conserving every unit',()=>{
 const d=draft();d.budgetMon='100000.000000000000000001';const p=previewRewardSetup(d);
 assert.equal(p.complete,true);assert.equal(p.rows.find(r=>r.id===id(4)).slots.length,25);assert.equal(p.rows.find(r=>r.id===id(6)).slots.length,10);
 assert.equal(p.rows.flatMap(r=>r.slots).reduce((a,b)=>a+b,0n),p.budgetWei);
 const changed=updateSetupNode(d.root,id(4),n=>({...n,rule:{...n.rule,sharesBps:presetSetupShares(7,'descending')}}));
 assert.deepEqual(changed.children[1],d.root.children[1]);assert.equal(previewRewardSetup({...d,root:changed}).rows.find(r=>r.id===id(6)).amountWei,p.rows.find(r=>r.id===id(6)).amountWei);
});
test('incomplete splits retain budget and overspending never creates calculated descendant amounts',()=>{
 const d=draft();d.root.children[0].shareBps=3000;const p=previewRewardSetup(d);assert.equal(p.retainedWei,20000n*10n**18n);assert.equal(p.complete,false);
 d.root.children[0].shareBps=7000;const over=previewRewardSetup(d);assert.equal(over.rows[0].issue,'overallocated');assert.equal(over.rows.find(r=>r.id===id(4)).amountWei,null);assert.deepEqual(over.rows.find(r=>r.id===id(4)).slots,[]);
});
test('locked branches do not change during explicit equal/proportional balancing',()=>{
 const children=[leaf(2,4000,1),leaf(3,1000,1),leaf(4,1000,1)];children[0].locked=true;
 assert.deepEqual(balanceSetupChildren(children,'equal').map(n=>n.shareBps),[4000,3000,3000]);
 children[1].shareBps=0;children[2].shareBps=0;assert.deepEqual(balanceSetupChildren(children,'proportional').map(n=>n.shareBps),[4000,3000,3000]);
 children[1].locked=true;children[1].shareBps=7000;assert.throws(()=>balanceSetupChildren(children,'equal'));
});
test('strict structure rejects duplicate IDs, excess depth, floating percentages, extra fields and mixed leaf/group nodes',()=>{
 const d=draft();d.root.children[1].id=d.root.children[0].id;assert.throws(()=>decodeRewardSetup(d));
 const fractional=draft();fractional.root.children[0].shareBps=0.5;assert.throws(()=>decodeRewardSetup(fractional));
 const mixed=draft();mixed.root.children[0].rule=leaf(99,1,1).rule;assert.throws(()=>decodeRewardSetup(mixed));
 assert.throws(()=>decodeRewardSetup({...draft(),approved:true}));assert.throws(()=>presetSetupShares(0));assert.throws(()=>presetSetupShares(101));
 let root=leaf(30,10000,1);for(let n=20;n>0;n--)root=group(n,10000,[root]);assert.throws(()=>decodeRewardSetup({...draft(),root}));
});
test('100, 50 and 1 winner schedules sum to 100% and keep tiny positive allocations exact',()=>{
 for(const count of [1,10,25,50,100])for(const curve of ['equal','descending'])assert.equal(presetSetupShares(count,curve).reduce((a,b)=>a+b),10000);
 const d={...createRewardSetup(id(1)),budgetMon:'0.000000000000000001',root:group(1,10000,[leaf(2,10000,100)])};const p=previewRewardSetup(d);assert.equal(p.rows.flatMap(r=>r.slots).reduce((a,b)=>a+b),1n);
});
test('result-bound proposal handles ties across the cutoff, retains missing places and blocks stale/ambiguous sources',()=>{
 const node=leaf(9,10000,3),category=id(20),round=id(30),race=id(40),competition=id(50);
 node.rule.source={draftId:id(60),roundId:round,categoryId:category,catalogueHash:'a'.repeat(64)};
 const workspace={draftId:id(60),catalogueHash:'a'.repeat(64)};
 const snapshot={catalogue:{rounds:[{id:round,races:[{id:race,competitionId:competition}]}],categories:[{id:category,competitionId:competition,target:'individual'}]},clubs:[],results:[1,2,3,4].map((n)=>({id:id(100+n),athleteId:id(200+n),athleteName:`Runner ${n}`,raceId:race,participationStatus:'finished',finishTimeMs:1000,classificationIds:[category],rankOverall:n===1?1:2}))};
 const p=previewSetupSource(node,[60n,30n,10n],workspace,snapshot);assert.equal(p.reason,null);assert.equal(p.awards.length,4);assert.equal(p.awards.reduce((n,a)=>n+a.amountWei,0n),100n);
 snapshot.results=snapshot.results.slice(0,1);assert.equal(previewSetupSource(node,[60n,30n,10n],workspace,snapshot).unusedWei,40n);
 assert.equal(previewSetupSource(node,[100n],{...workspace,catalogueHash:'b'.repeat(64)},snapshot).reason,'source_changed');
 snapshot.results[0].classificationIds=[];assert.equal(previewSetupSource(node,[100n],workspace,snapshot).reason,'ambiguous_results');
 node.rule.basis='league_position';assert.equal(previewSetupSource(node,[100n],workspace,snapshot).reason,'review_required');
});

test('versioned event context and finish state persist; invalid or mismatched setups cannot finish',()=>{
 const d=draft();assert.equal(decodeRewardSetup(d).version,1);assert.throws(()=>finishRewardSetup(d));
 d.version=2;d.stage='draft';d.context={draftId:id(60),roundId:id(30),editionId:id(31),catalogueHash:'a'.repeat(64),programmeName:'Season',eventName:'Race'};
 for(const n of setupNodes(d.root).filter(n=>n.rule))n.rule.source={draftId:id(60),roundId:id(30),categoryId:id(40),catalogueHash:'a'.repeat(64)};
 assert.deepEqual(setupReadiness(d),[]);const ready=finishRewardSetup(d);assert.equal(decodeRewardSetup(JSON.parse(JSON.stringify(ready))).stage,'ready');
 const mismatch=structuredClone(ready);mismatch.root.children[0].children[0].rule.source.roundId=id(99);assert.throws(()=>decodeRewardSetup(mismatch));
 const over=structuredClone(ready);over.root.children[0].shareBps=6000;assert.throws(()=>decodeRewardSetup(over));
 const stale=structuredClone(ready);stale.context.catalogueHash='b'.repeat(64);assert.throws(()=>decodeRewardSetup(stale));
 assert.throws(()=>decodeRewardSetup({...ready,stage:'published'}));assert.throws(()=>decodeRewardSetup({...ready,context:null}));
});

test('explicit expiry and treasury choice survive strict decoding without altering legacy documents',async()=>{
 const {defaultRewardSetupPolicy}=await import('../../../packages/domain/dist/rewards/distribution-setup.js');
 const legacy=draft();assert.equal(decodeRewardSetup(legacy).policy,undefined);
 const current={...legacy,version:3,context:null,stage:'draft',policy:defaultRewardSetupPolicy()};
 for(const treasuryReturn of ['original_sender','raceson_default'])for(const claimWindowDays of [1,365,3650]){
  current.policy={...current.policy,treasuryReturn,claimWindowDays};assert.deepEqual(decodeRewardSetup(JSON.parse(JSON.stringify(current))),current);
 }
 for(const policy of [null,{}, {...current.policy,claimWindowDays:0},{...current.policy,claimWindowDays:3651},{...current.policy,claimWindowDays:1.5},{...current.policy,claimWindowDays:'365'},{...current.policy,treasuryReturn:'connected_wallet'},{...current.policy,securityPausesExtendWindow:false},{...current.policy,approved:true}])assert.throws(()=>decodeRewardSetup({...current,policy}));
 assert.throws(()=>decodeRewardSetup({...current,version:2}));
});

test('saved setup lifecycle is strict, backwards compatible and cannot advertise deletion of a launched campaign',()=>{
 const r={id:id(100),chainId:10143,revision:1,configuration:draft(),updatedAt:'2026-09-23T00:00:00.000Z'};
 assert.deepEqual(decodeSavedRewardSetup(r),r);
 assert.deepEqual(decodeSavedRewardSetup({...r,lifecycle:{state:'saved',canDelete:false}}).lifecycle,{state:'saved',canDelete:false});
 for(const lifecycle of [{state:'deposit',canDelete:true},{state:'funded',canDelete:true},{state:'saved',canDelete:true,archived:'true'},{state:'unknown',canDelete:false},{state:'draft',canDelete:'true'},{state:'draft',canDelete:false,secret:'hidden'}])assert.throws(()=>decodeSavedRewardSetup({...r,lifecycle}));
 assert.equal(decodeSavedRewardSetup({...r,lifecycle:{state:'saved',canDelete:true,archived:false}}).lifecycle.canDelete,true);
 assert.equal(decodeSavedRewardSetup({...r,lifecycle:{state:'deposit',canDelete:false,archived:true}}).lifecycle.archived,true);
});
