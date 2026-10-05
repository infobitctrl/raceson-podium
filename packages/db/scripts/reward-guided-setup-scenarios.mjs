import assert from "node:assert/strict";
import {rewardDistributionSetups,deleteRewardDraft} from "../dist/rewards/index.js";
import {createGuidedSetup,bindGuidedSeason,addGuidedGroup} from "../../domain/dist/rewards/guided-setup-editor.js";
import {finishRewardSetup,decodeRewardSetup} from "../../domain/dist/rewards/distribution-setup.js";
import {publishedSnapshot,id} from "../../../apps/api/test/fixtures/published-reward-v2.mjs";
import {rewardId} from "../../../apps/api/test/fixtures/reward-calculation.mjs";
import {literal} from "./reward-integration-fixture.mjs";

export async function guidedSetupScenarios({harness,scenario}) {
 await scenario("guided setup V5 preserves semantic rules, private revisions and exact retries",async()=>{
  let seq=910000;const next=()=>id(seq++),owner={userId:rewardId(4),sessionId:next()};
  await harness.query(`insert into auth.sessions(id,user_id,not_after) values(${literal(owner.sessionId)},${literal(owner.userId)},now()+interval '1 hour');`);
  const catalogue=publishedSnapshot().catalogue;
  catalogue.rounds.push({...structuredClone(catalogue.rounds[0]),id:id(104),editionId:id(204),slot:5,name:"Synthetic upcoming finale",status:"upcoming",races:[{...catalogue.rounds[0].races[0],id:id(304),publicationId:null,publicationState:null,resultCount:0}]});
  const context={draftId:next(),roundId:null,editionId:null,catalogueHash:"a".repeat(64),programmeName:"Synthetic guided season",eventName:"Synthetic guided season"};
  let setup=bindGuidedSeason(createGuidedSetup(next),context,catalogue);
  const setupId=next(),first={requestId:next(),expectedRevision:0,configuration:setup};
  const draft=await rewardDistributionSetups(owner,31337,setupId,first,harness.rpc);
  assert.equal(draft.configuration.version,5);assert.deepEqual(draft.configuration,setup);
  assert.deepEqual(await rewardDistributionSetups(owner,31337,setupId,first,harness.rpc),draft);
  for(const p of setup.guided.pots)setup=addGuidedGroup(setup,p.nodeId,p.slot===0?"club_metres":"athlete_standings",next,p.slot===0?null:catalogue.categories[0]);
  setup.root.children.forEach(p=>p.children[0].shareBps=10000);setup.guided.groups.forEach(g=>g.eligibilityApproved=true);
  const ready=finishRewardSetup(setup);
  const saved=await rewardDistributionSetups(owner,31337,setupId,{requestId:next(),expectedRevision:1,configuration:ready},harness.rpc);
  // P28 permits deleting prepared rules until an execution plan exists.
  // A stale revision still cannot remove the latest saved configuration.
  await assert.rejects(()=>deleteRewardDraft(owner,31337,setupId,1,harness.rpc),{code:"reward_setup_conflict"});
  assert.equal(saved.configuration.stage,"ready");assert.deepEqual(saved.configuration,ready);
  assert.equal(await harness.scalar(`select configuration->>'stage' from app_private.reward_setup_revisions where setup_id=${literal(setupId)} and revision=1`),"draft");
  assert.equal(await harness.scalar(`select count(*) from app_private.reward_setup_revisions where setup_id=${literal(setupId)}`),2);
  for(const mutation of [s=>s.guided.pots[5].roundId=null,s=>s.guided.pots[1].slot=0,s=>s.guided.groups.pop(),s=>s.guided.groups[0].method="ranked",
   s=>s.root.children[0].children[0].rule.sharesBps=[10000],s=>s.guided.groups[0].eligibilityApproved=false,
   s=>s.root.children[1].children[0].rule.source.roundId=s.guided.pots[2].roundId,
   s=>s.guided.groups[0].type="athlete_standings",s=>s.guided.counting="every_result_row",s=>s.guided.pots[2].roundId=s.guided.pots[1].roundId]){
   const bad=structuredClone(ready);mutation(bad);assert.throws(()=>decodeRewardSetup(bad));
   await assert.rejects(()=>harness.query(`select app_private.validate_reward_setup_configuration(${literal(JSON.stringify(bad))}::jsonb);`),/invalid_reward_setup/);
  }
  await assert.rejects(()=>rewardDistributionSetups({...owner,userId:rewardId(5)},31337,setupId,undefined,harness.rpc));
  await assert.rejects(()=>rewardDistributionSetups(owner,31337,setupId,{requestId:next(),expectedRevision:1,configuration:setup},harness.rpc));
  assert.equal(await harness.scalar("select has_function_privilege('authenticated','app_private.validate_reward_setup_configuration_v4(jsonb)','execute')"),false);
  assert.deepEqual(await deleteRewardDraft(owner,31337,setupId,saved.revision,harness.rpc),{id:setupId,deleted:true});
  assert.equal(await harness.scalar(`select count(*) from app_private.reward_setup_revisions where setup_id=${literal(setupId)}`),2);
 });
}
