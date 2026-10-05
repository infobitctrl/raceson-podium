import assert from "node:assert/strict";
import test from "node:test";
import {createGuidedSetup,bindGuidedSeason,addGuidedGroup,connectGuidedGroup,copyGuidedRound,changeGuidedMethod} from "../../../packages/domain/dist/rewards/guided-setup-editor.js";
import {decodeRewardSetup,finishRewardSetup,setupReadiness,previewRewardSetup} from "../../../packages/domain/dist/rewards/distribution-setup.js";
import {id,publishedSnapshot} from "./fixtures/published-reward-v2.mjs";
const hash="a".repeat(64),context={draftId:id(90),roundId:null,editionId:null,catalogueHash:hash,programmeName:"Synthetic season",eventName:"Synthetic season"};
function fixture(){let seq=1000;const next=()=>id(seq++),catalogue=publishedSnapshot().catalogue;
 catalogue.rounds.push({...structuredClone(catalogue.rounds[0]),id:id(104),editionId:id(204),slot:5,name:"Synthetic upcoming finale",status:"upcoming",races:[{...catalogue.rounds[0].races[0],id:id(304),publicationId:null,publicationState:null,resultCount:0}]});
 return {next,catalogue,setup:bindGuidedSeason(createGuidedSetup(next),context,catalogue)};
}
test("new guided drafts explicitly identify six pots and preserve exact initial planning amounts",()=>{
 const {setup}=fixture(),p=previewRewardSetup(setup);
 assert.deepEqual(setup.guided.pots.map(p=>p.slot),[0,1,2,3,4,5]);
 assert.deepEqual(setup.root.children.map(n=>p.rows.find(r=>r.id===n.id).amountWei),[50000n,10000n,10000n,10000n,10000n,10000n].map(n=>n*10n**18n));
 assert.deepEqual(decodeRewardSetup(JSON.parse(JSON.stringify(setup))),setup);
 assert.deepEqual(setupReadiness(setup),["distribution","sources"]);
});
test("proportional participation has no fictitious winners, and ranked mode is independently explicit",()=>{
 let {setup,next}=fixture();const league=setup.guided.pots[0];
 setup=addGuidedGroup(setup,league.nodeId,"club_metres",next,null);
 setup.root.children[0].children[0].shareBps=10000;
 const node=setup.root.children[0].children[0],row=previewRewardSetup(setup).rows.find(r=>r.id===node.id);
 assert.deepEqual(node.rule.sharesBps,[]);assert.equal(node.rule.source,null);assert.deepEqual(row.slots,[]);assert.equal(row.issue,null);
 setup=changeGuidedMethod(setup,node.id,"ranked");
 assert.equal(setup.guided.groups[0].type,"club_metres");assert.equal(setup.root.children[0].children[0].rule.sharesBps.length,5);
 assert.throws(()=>addGuidedGroup(setup,league.nodeId,"club_metres",next,null));
 assert.throws(()=>addGuidedGroup(setup,setup.guided.pots[1].nodeId,"athlete_finishes",next,null));
});
test("only selected round settings are copied; budgets and independent exceptions survive",()=>{
 let {setup,next,catalogue}=fixture();
 setup=addGuidedGroup(setup,setup.guided.pots[1].nodeId,"athlete_standings",next,catalogue.categories[0]);
 setup.root.children[1].children[0].shareBps=10000;
 const untouched=structuredClone(setup.root.children[3]),league=structuredClone(setup.root.children[0]);
 setup=copyGuidedRound(setup,setup.guided.pots[1].nodeId,[setup.guided.pots[2].nodeId],catalogue,next);
 assert.deepEqual(setup.root.children[3],untouched);assert.deepEqual(setup.root.children[0],league);
 assert.equal(setup.root.children[2].shareBps,1000);
 assert.notEqual(setup.root.children[1].children[0].id,setup.root.children[2].children[0].id);
 assert.equal(setup.root.children[2].children[0].rule.source.roundId,catalogue.rounds[1].id);
 assert.equal(setup.guided.groups.at(-1).eligibilityApproved,false);
 const missing=structuredClone(catalogue);missing.rounds[2].races=[];
 assert.throws(()=>copyGuidedRound(setup,setup.guided.pots[1].nodeId,[setup.guided.pots[3].nodeId],missing,next));
});
test("finish requires complete budgets, exact group roles, five bindings and reviewed eligibility, not future results",()=>{
 let {setup,next,catalogue}=fixture();
 for(const p of setup.guided.pots){setup=addGuidedGroup(setup,p.nodeId,p.slot===0?"athlete_finishes":"athlete_standings",next,p.slot===0?null:catalogue.categories[0]);}
 setup.root.children.forEach(p=>p.children[0].shareBps=10000);setup.guided.groups.forEach(g=>g.eligibilityApproved=true);
 assert.deepEqual(setupReadiness(setup),[]);const ready=finishRewardSetup(setup);assert.equal(ready.version,5);assert.equal(ready.stage,"ready");
 for(const change of [s=>s.guided.pots[5].roundId=null,s=>s.guided.groups[0].eligibilityApproved=false,s=>s.root.children[0].children[0].shareBps=9000]){
  const bad=structuredClone(ready);change(bad);assert.throws(()=>decodeRewardSetup(bad));
 }
 const stale=bindGuidedSeason(setup,{...context,catalogueHash:"b".repeat(64)},catalogue);
 assert.equal(stale.stage,"draft");assert.ok(stale.guided.groups.every(g=>!g.eligibilityApproved));
 assert.equal(stale.root.children[1].children[0].rule.source.catalogueHash,"b".repeat(64));
});
test("semantic tampering, duplicated scopes, hidden groups and cross-pot sources are rejected",()=>{
 let {setup,next,catalogue}=fixture();setup=addGuidedGroup(setup,setup.guided.pots[1].nodeId,"athlete_standings",next,catalogue.categories[0]);
 for(const change of [s=>s.guided.pots[2].slot=1,s=>s.guided.pots[2].roundId=s.guided.pots[1].roundId,s=>s.guided.groups=[],s=>s.guided.groups[0].type="club_metres",
  s=>s.guided.groups[0].method="proportional",s=>s.root.children[1].children[0].rule.source.roundId=null,s=>s.guided.groups[0].approved=true]){
  const bad=structuredClone(setup);change(bad);assert.throws(()=>decodeRewardSetup(bad));
 }
});
test("existing groups reconnect to an official category without changing money and must be reviewed again",()=>{
 let {setup,next,catalogue}=fixture();const pot=setup.guided.pots[1];
 setup=addGuidedGroup(setup,pot.nodeId,"athlete_standings",next,null);
 const group=setup.root.children[1].children[0];group.shareBps=7000;group.name="Preserved custom name";setup.guided.groups[0].eligibilityApproved=true;
 const connected=connectGuidedGroup(setup,group.id,catalogue.categories[0].id,catalogue),actual=connected.root.children[1].children[0];
 assert.equal(actual.name,group.name);assert.equal(actual.shareBps,7000);assert.deepEqual(actual.rule.sharesBps,group.rule.sharesBps);
 assert.equal(actual.rule.source.roundId,pot.roundId);assert.equal(connected.guided.groups[0].eligibilityApproved,false);
 assert.equal(connectGuidedGroup(connected,group.id,null,catalogue).root.children[1].children[0].rule.source,null);
 assert.throws(()=>connectGuidedGroup(setup,group.id,id(999),catalogue));
});

test("binding a saved 100 MON campaign preserves every pot and group economy while clearing source approvals",()=>{
 const {next,catalogue}=fixture();
 let setup=createGuidedSetup(next);setup.budgetMon="100";
 for(const pot of setup.guided.pots){
  setup=addGuidedGroup(setup,pot.nodeId,"athlete_standings",next,null);
  setup=addGuidedGroup(setup,pot.nodeId,"club_standings",next,null);
 }
 for(const type of ["athlete_finishes","athlete_metres","club_metres"])
  setup=addGuidedGroup(setup,setup.guided.pots[0].nodeId,type,next,null);
 setup.root.children.forEach((pot,index)=>{
  pot.shareBps=[4300,1100,1200,900,1300,1200][index];
  pot.children.forEach((group,j)=>{
   group.shareBps=index===0?[2100,1900,2300,1700,2000][j]:[3700,6300][j];
   group.name=`Saved reward ${index}/${j}`;
   if(group.rule.basis!=="participation")group.rule.sharesBps=j===0?[5100,3100,1800]:[6000,3000,1000];
  });
 });
 setup.guided.groups.forEach(group=>group.eligibilityApproved=true);
 // Keep an independent economic snapshot: source IDs and round display names may change.
 const economics=value=>structuredClone({budgetMon:value.budgetMon,policy:value.policy,
  pots:value.root.children.map(pot=>({id:pot.id,shareBps:pot.shareBps,locked:pot.locked,
   groups:pot.children.map(group=>({id:group.id,name:group.name,shareBps:group.shareBps,locked:group.locked,
    basis:group.rule.basis,sharesBps:group.rule.sharesBps}))})),
  groupRules:value.guided.groups.map(({eligibilityApproved,...group})=>group),
  amounts:previewRewardSetup(value).rows.map(row=>({id:row.id,amountWei:row.amountWei,slots:row.slots}))});
 const before=economics(setup),original=JSON.stringify(setup),unbound=setup;
 setup=bindGuidedSeason(setup,context,catalogue);
 assert.equal(JSON.stringify(unbound),original);
 assert.deepEqual(economics(setup),before);
 assert.ok(setup.guided.groups.every(group=>group.eligibilityApproved===false));
 assert.ok(setup.root.children.every(pot=>pot.children.every(group=>group.rule.source===null)));
 for(const group of setup.guided.groups){
  if(!["athlete_standings","club_standings"].includes(group.type))continue;
  const category=catalogue.categories.find(category=>category.target===(group.type==="club_standings"?"club":"individual"));
  setup.guided.groups.find(saved=>saved.nodeId===group.nodeId).eligibilityApproved=true;
  setup=connectGuidedGroup(setup,group.nodeId,category.id,catalogue);
  assert.deepEqual(economics(setup),before);
  assert.equal(setup.guided.groups.find(saved=>saved.nodeId===group.nodeId).eligibilityApproved,false);
  const pot=setup.root.children.find(pot=>pot.children.some(saved=>saved.id===group.nodeId));
  assert.deepEqual(pot.children.find(saved=>saved.id===group.nodeId).rule.source,
   {draftId:context.draftId,catalogueHash:context.catalogueHash,roundId:setup.guided.pots.find(saved=>saved.nodeId===pot.id).roundId,categoryId:category.id});
 }
 for(const group of setup.guided.groups.filter(group=>["athlete_finishes","athlete_metres","club_metres"].includes(group.type))){
  assert.equal(setup.root.children[0].children.find(saved=>saved.id===group.nodeId).rule.source,null);
  assert.throws(()=>connectGuidedGroup(setup,group.nodeId,catalogue.categories[0].id,catalogue));
 }
 assert.equal(previewRewardSetup(setup).budgetWei,100n*10n**18n);
 assert.ok(setup.guided.groups.every(group=>group.eligibilityApproved===false));
 assert.deepEqual(economics(decodeRewardSetup(JSON.parse(JSON.stringify(setup)))),before);
});

test("optional sponsor selection round-trips without changing legacy documents or granting readiness",()=>{
 const {setup}=fixture(),before=JSON.stringify(setup);
 assert.equal(JSON.stringify(decodeRewardSetup(setup)),before);
 const selection={sourceLeagueId:id(100),sourceSeasonId:id(101),eventEditionId:id(204)};
 const selected={...setup,sponsorSelection:selection};
 assert.deepEqual(decodeRewardSetup(JSON.parse(JSON.stringify(selected))),selected);
 assert.deepEqual(setupReadiness(selected),setupReadiness(setup));
 const track={...selected,sponsorSelection:{...selection,raceId:id(304)}};
 assert.deepEqual(decodeRewardSetup(JSON.parse(JSON.stringify(track))),track);
 assert.deepEqual(setupReadiness(track),setupReadiness(setup));
 assert.equal(Object.hasOwn(decodeRewardSetup(selected).sponsorSelection,"raceId"),false);
 for(const invalid of [null,{}, {...selection,sourceLeagueId:"bad"},{...selection,eventEditionId:undefined},{...selection,sourceSeasonId:"00000000-0000-0000-0000-000000000000"},{...selection,approved:true},
  {...selection,raceId:null},{...selection,raceId:"bad"},{...selection,raceId:"00000000-0000-0000-0000-000000000000"},{...selection,eventEditionId:null,raceId:id(304)}]){
  assert.throws(()=>decodeRewardSetup({...setup,sponsorSelection:invalid}),/invalid_reward_setup/);
 }
});
