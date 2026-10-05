import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultRewardProgrammeDraftV2 } from "../../../packages/domain/dist/rewards/programme-draft-v2.js";
import { emptyRewardSourceMappingV2, decodeRewardSourceMappingV2, decodeRewardSourceCatalogueV2,
  decodeRewardMappingWorkspaceV2, validateRewardSourceMappingV2, previewRewardSourceMappingV2 } from "../../../packages/domain/dist/rewards/source-mapping-v2.js";
import { dispatchRewardPlanningRoutes } from "../dist/routes/rewards/planning.js";

const id = n => `83000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const rules = createDefaultRewardProgrammeDraftV2();
const catalogue = () => ({rounds:[{id:id(1),editionId:id(2),slot:1,name:"Synthetic round",date:"2026-09-01",status:"draft",
  races:[{id:id(3),competitionId:id(4),name:"Synthetic long",distanceMetres:"15000",publicationId:null,publicationState:null,resultCount:0}]}],
  categories:[{id:id(5),competitionId:id(4),competitionName:"Synthetic long",name:"Female",target:"individual",eligibility:{demoOnly:true}},
    {id:id(6),competitionId:id(4),competitionName:"Synthetic long",name:"Male",target:"individual",eligibility:{demoOnly:true}},
    {id:id(7),competitionId:id(8),competitionName:"Synthetic clubs",name:"Clubs",target:"club",eligibility:{demoOnly:true}}]});
const workspace = () => ({draftId:id(10),revision:0,rulesRevision:11,catalogueHash:"a".repeat(64),boundCatalogueHash:null,mapping:emptyRewardSourceMappingV2(),catalogue:catalogue()});
const record = () => ({draftId:id(10),organizationId:id(11),seasonId:id(12),chainId:31337,organizationName:"Synthetic org",seasonName:"Synthetic season",
  revision:11,updatedAt:"2026-09-09T12:00:00Z",rules});
function mapping() { const m=emptyRewardSourceMappingV2(); m.rounds[0]={slot:1,roundId:id(1),categories:[{categoryId:id(5),shareBps:5000},{categoryId:id(6),shareBps:2500},{categoryId:id(7),shareBps:10000}]};
  m.leagueCategories=[{categoryId:id(5),shareBps:10000},{categoryId:id(7),shareBps:10000}]; return m; }

test("catalogue and workspace strictly decode minimal source IDs with a pending fifth round",()=>{
  assert.deepEqual(decodeRewardSourceCatalogueV2(catalogue()),catalogue());
  assert.deepEqual(decodeRewardMappingWorkspaceV2(workspace()),workspace());
  assert.equal(workspace().mapping.rounds[4].roundId,null);
  for(const bad of [{...workspace(),privateKey:"x"},{...workspace(),catalogueHash:"xyz"},{...workspace(),rulesRevision:0},
    {...workspace(),catalogue:{...catalogue(),categories:[...catalogue().categories,catalogue().categories[0]]}}])assert.throws(()=>decodeRewardMappingWorkspaceV2(bad));
});
test("fractional published age bounds use decimal text without weakening integer reward serialization",()=>{
  const c=catalogue();c.categories[0].eligibility={gender:'F',maximumAge:15.99,minimumAge:1};
  assert.deepEqual(decodeRewardSourceCatalogueV2(c).categories[0].eligibility,{gender:'F',maximumAge:'15.99',minimumAge:1});
  c.categories[0].eligibility.maximumAge=Infinity;assert.throws(()=>decodeRewardSourceCatalogueV2(c));
});
test("mapping refuses duplicate/foreign sources, wrong slots, cancelled sources and v1 coercion",()=>{
  assert.doesNotThrow(()=>validateRewardSourceMappingV2(mapping(),catalogue()));
  const cases=[m=>m.version=1,m=>m.rounds.pop(),m=>m.rounds[1].roundId=id(1),m=>m.rounds[0].roundId=id(99),
    m=>m.rounds[0].categories.push(m.rounds[0].categories[0]),m=>m.rounds[0].categories[0].shareBps=-1,
    m=>m.rounds[0].categories[0].shareBps=1.5,m=>m.rounds[0].categories[0].categoryId=id(99),
    m=>m.rounds[0].categories[0].shareBps=8000,m=>m.walletAddress=id(99)];
  for(const change of cases){const m=mapping();change(m);assert.throws(()=>validateRewardSourceMappingV2(m,catalogue()));}
  const c=catalogue();c.rounds[0].status="cancelled";assert.throws(()=>validateRewardSourceMappingV2(mapping(),c));
  const moved=catalogue();moved.rounds[0].slot=2;assert.throws(()=>validateRewardSourceMappingV2(mapping(),moved));
});
test("separate athlete and club shares preserve unused budgets; ten/twenty-five prize slots conserve exact wei",()=>{
  const pots=previewRewardSourceMappingV2(rules,mapping(),catalogue());
  const first=pots[0].families;
  assert.equal(first[0].amountWei,8000n*10n**18n);assert.equal(first[0].unassignedWei,2000n*10n**18n);
  assert.equal(first[0].categories[0].amountWei,4000n*10n**18n);assert.equal(first[1].unassignedWei,0n);
  assert.equal(first[1].categories[0].amountWei,2000n*10n**18n);
  for(const[potIndex,pot]of pots.entries())for(const family of pot.families){
    assert.equal(family.categories.reduce((n,c)=>n+c.amountWei,family.unassignedWei),family.amountWei);
    for(const c of family.categories){assert.equal(c.slots.length,potIndex===5?25:10);assert.equal(c.slots.reduce((n,s)=>n+s.amountWei,0n),c.amountWei);}
  }
  assert.equal(pots[5].families.find(f=>f.key==='participation_metres').unassignedWei,15000n*10n**18n);
  assert.equal(pots.reduce((n,p)=>n+p.families.reduce((n,f)=>n+f.amountWei,0n),0n),100000n*10n**18n);
});
test("empty categories and tiny wei remain accounted for without wallet or result-dependent normalization",()=>{
  const tiny={...rules,budgetMon:"0.000000000000000011"};
  for(const m of [mapping(),emptyRewardSourceMappingV2()]){
    const pots=previewRewardSourceMappingV2(tiny,m,catalogue());
    assert.equal(pots.reduce((n,p)=>n+p.families.reduce((n,f)=>n+f.unassignedWei+f.categories.reduce((n,c)=>n+c.amountWei,0n),0n),0n),11n);
  }
  const ordered=mapping();ordered.rounds[0].categories.reverse();assert.deepEqual(decodeRewardSourceMappingV2(ordered),decodeRewardSourceMappingV2(mapping()));
});
async function request({method="GET",body,error,state=workspace(),authError,path=`/${id(10)}/mapping`}={}){
  const calls=[],res={};const deps={config:()=>({chainId:31337}),requireIdentity:async()=>{if(authError)throw new Error(authError);return{userId:id(20),sessionId:id(21)}},
    readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>res.private=true,sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),
    sendError:(_,status,code)=>Object.assign(res,{status,code}),rpc:async(name,args)=>{calls.push({name,args});return{data:name==="service_read_reward_planning_draft"?record():state,error:error?{message:error}:null}}};
  await dispatchRewardPlanningRoutes({method},res,new URL("http://127.0.0.1:3101/api/v1/organizer/rewards/drafts"+path),deps);return{res,calls};
}
const body = () => ({expectedRevision:0,expectedRulesRevision:11,catalogueHash:"a".repeat(64),mapping:mapping()});
test("private mapping API derives category preview from persisted rules and authoritative source catalogue",async()=>{
  const {res,calls}=await request({state:{...workspace(),mapping:mapping()}});assert.equal(res.status,200);assert.equal(res.private,true);
  assert.equal(res.data.preview[0].families[0].categories[0].amountWei,"4000000000000000000000");
  assert.deepEqual(calls[0].args,{p_actor_user_id:id(20),p_actor_session_id:id(21),p_chain_id:31337,p_draft_id:id(10)});
});
test("mapping save forwards exact CAS and never accepts beneficiary/amount/approval injection",async()=>{
  const {res,calls}=await request({method:"PATCH",body:body()});assert.equal(res.status,200);
  const saved=calls.find(c=>c.name==="service_save_reward_mapping_v2");assert.equal(saved.args.p_expected_rules_revision,11);assert.equal(saved.args.p_expected_revision,0);
  for(const patch of [{athleteId:id(99)},{amountWei:"100"},{approved:true},{mapping:{...mapping(),wallet:id(99)}}]){
    const r=await request({method:"PATCH",body:{...body(),...patch}});assert.equal(r.res.status,400);assert.ok(!r.calls.some(c=>c.name==="service_save_reward_mapping_v2"));
  }
});
test("stale source/rules/revision and SQL race conflicts are 409 with no silently updated CAS",async()=>{
  for(const patch of [{expectedRevision:1},{expectedRulesRevision:10},{catalogueHash:"b".repeat(64)}]){
    const {res,calls}=await request({method:"PATCH",body:{...body(),...patch}});assert.equal(res.status,409);assert.equal(calls.length,2);
  }
  assert.equal((await request({error:"reward_planning_revision_changed"})).res.status,409);
});
test("revoked/foreign-account mapping reads fail safely and missing IDs stay inspectable without a preview",async()=>{
  for(const[error,status]of[["reward_account_session_required",401],["reward_planning_not_found",404],["secret database details",503]])assert.equal((await request({error})).res.status,status);
  assert.equal((await request({authError:"Untrusted browser origin"})).res.status,403);
  const removed=mapping();removed.rounds[0].roundId=id(99);
  const {res}=await request({state:{...workspace(),mapping:removed}});assert.equal(res.status,200);assert.equal(res.data.preview,null);assert.equal(res.data.workspace.mapping.rounds[0].roundId,id(99));
});
