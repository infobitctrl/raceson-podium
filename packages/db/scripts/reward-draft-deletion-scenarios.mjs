import assert from 'node:assert/strict';
import {deleteRewardDraft,archiveRewardSetup,rewardDistributionSetups,rewardSponsorLaunch,rewardSponsorExecution} from '../dist/rewards/index.js';
import {createGuidedSetup,addGuidedGroup} from '../../domain/dist/rewards/guided-setup-editor.js';
import {createSponsorExecutionPlan} from '../../domain/dist/rewards/sponsor-execution.js';
import {rewardId as id} from '../../../apps/api/test/fixtures/reward-calculation.mjs';
import {literal} from './reward-integration-fixture.mjs';

export async function draftDeletionScenarios({harness:h,scenario}){
 let seq=940000;const next=()=>id(seq++),owner={userId:id(4),sessionId:next()},other={userId:id(5),sessionId:next()};
 await h.query(`insert into auth.sessions(id,user_id,not_after) values(${literal(owner.sessionId)},${literal(owner.userId)},now()+interval '1 hour'),(${literal(other.sessionId)},${literal(other.userId)},now()+interval '1 hour');`);
 const read=setup=>rewardDistributionSetups(owner,31337,setup,undefined,h.rpc);
 const remove=(setup,revision=1)=>deleteRewardDraft(owner,31337,setup,revision,h.rpc);
 const archive=(setup,value,revision=1)=>archiveRewardSetup(owner,31337,setup,revision,value,h.rpc);
 async function fixture(prepare=false){
  const setup=next();let configuration=createGuidedSetup(next);
  if(prepare){
   configuration=addGuidedGroup(configuration,configuration.guided.pots[0].nodeId,'club_metres',next,null);
   configuration.root.children.forEach((p,i)=>p.shareBps=i===0?10000:0);configuration.root.children[0].children[0].shareBps=10000;
   configuration.context={draftId:next(),catalogueHash:'a'.repeat(64),roundId:null,editionId:null,programmeName:'Synthetic league',eventName:'All rounds'};
  }
  await rewardDistributionSetups(owner,31337,setup,{requestId:next(),expectedRevision:0,configuration},h.rpc);
  if(!prepare)return {setup,configuration};
  const {launch}=await rewardSponsorLaunch(owner,31337,setup,{requestId:next(),expectedRevision:1},h.rpc);
  const plan=createSponsorExecutionPlan(launch,'0x'+'33'.repeat(20),{operator:'0x'+'11'.repeat(20),treasury:'0x'+'22'.repeat(20),reviewPeriods:[0,86400,0,0,0,0]});
  return {setup,configuration,plan};
 }
 await scenario('draft and prepared campaign deletion preserve history, retries and owner boundaries',async()=>{
  const {setup,configuration}=await fixture();
  assert.deepEqual((await read(setup)).lifecycle,{state:'draft',canDelete:true,archived:false});
  await assert.rejects(()=>deleteRewardDraft(other,31337,setup,1,h.rpc),{code:'reward_setup_not_found'});
  await assert.rejects(()=>deleteRewardDraft(owner,10143,setup,1,h.rpc),{code:'reward_setup_not_found'});
  await assert.rejects(()=>remove(setup,2),{code:'reward_setup_conflict'});
  await assert.rejects(()=>deleteRewardDraft({...owner,sessionId:other.sessionId},31337,setup,1,h.rpc),{code:'reward_account_session_required'});
  assert.deepEqual(await remove(setup),{id:setup,deleted:true});
  assert.deepEqual(await remove(setup),{id:setup,deleted:true});
  assert.equal((await read(null)).some(r=>r.id===setup),false);
  await assert.rejects(()=>read(setup),{code:'reward_setup_not_found'});
  await assert.rejects(()=>rewardDistributionSetups(owner,31337,setup,{requestId:next(),expectedRevision:1,configuration},h.rpc),{code:'reward_setup_not_found'});
  assert.equal(await h.scalar(`select count(*) from app_private.reward_setup_revisions where setup_id=${literal(setup)}`),1);
  const prepared=await fixture(true);
  assert.deepEqual((await read(prepared.setup)).lifecycle,{state:'saved',canDelete:true,archived:false});
  await remove(prepared.setup);
  assert.equal(await h.scalar(`select count(*) from app_private.reward_sponsor_launches where setup_id=${literal(prepared.setup)}`),1);
  assert.equal(await h.scalar(`select count(*) from app_private.reward_setup_revisions where setup_id=${literal(prepared.setup)}`),1);
  await assert.rejects(()=>rewardSponsorLaunch(owner,31337,prepared.setup,{requestId:next(),expectedRevision:1},h.rpc),{code:'reward_setup_not_found'});
  await assert.rejects(()=>rewardSponsorExecution(owner,31337,prepared.setup,{plan:prepared.plan},h.rpc),{code:'reward_setup_not_found'});
  for(const role of ['anon','authenticated'])for(const fn of ['service_delete_reward_draft(uuid,uuid,integer,uuid,integer)','service_archive_reward_setup(uuid,uuid,integer,uuid,integer,boolean)'])
   assert.equal(await h.scalar(`select has_function_privilege('${role}','public.${fn}','execute')`),false);
 });
 await scenario('execution blocks deletion even without receipts; reversible archive retains access and funding recovery',async()=>{
  const {setup,plan}=await fixture(true),before=await read(setup);
  await rewardSponsorExecution(owner,31337,setup,{plan},h.rpc);
  assert.deepEqual((await read(setup)).lifecycle,{state:'saved',canDelete:false,archived:false});
  await assert.rejects(()=>remove(setup),{code:'reward_setup_not_deletable'});
  await assert.rejects(()=>archiveRewardSetup(other,31337,setup,1,true,h.rpc),{code:'reward_setup_not_found'});
  await assert.rejects(()=>archiveRewardSetup(owner,10143,setup,1,true,h.rpc),{code:'reward_setup_not_found'});
  await assert.rejects(()=>archive(setup,true,2),{code:'reward_setup_conflict'});
  await assert.rejects(()=>archiveRewardSetup({...owner,sessionId:other.sessionId},31337,setup,1,true,h.rpc),{code:'reward_account_session_required'});
  const archived=await archive(setup,true);
  assert.equal(archived.lifecycle.archived,true);assert.equal(archived.updatedAt,before.updatedAt);assert.deepEqual(archived.configuration,before.configuration);
  assert.deepEqual(await archive(setup,true),archived);
  assert.equal((await read(null)).find(r=>r.id===setup).lifecycle.archived,true);
  assert.equal((await rewardSponsorLaunch(owner,31337,setup,undefined,h.rpc)).setup.lifecycle.archived,true);
  await rewardSponsorExecution(owner,31337,setup,{deploymentHash:'0x'+'aa'.repeat(32)},h.rpc);
  await assert.rejects(()=>remove(setup),{code:'reward_setup_not_deletable'});
  assert.deepEqual((await read(setup)).lifecycle,{state:'deposit',canDelete:false,archived:true});
  assert.equal((await archive(setup,false)).lifecycle.archived,false);
  await archive(setup,true);
  await rewardSponsorExecution(owner,31337,setup,{fundingHash:'0x'+'bb'.repeat(32)},h.rpc);
  await assert.rejects(()=>remove(setup),{code:'reward_setup_not_deletable'});
  assert.deepEqual((await archive(setup,true)).lifecycle,{state:'funded',canDelete:false,archived:true});
  assert.equal((await archive(setup,false)).lifecycle.archived,false);
  await assert.rejects(()=>archive(setup,true),{code:'reward_setup_not_archivable'});
  assert.equal(await h.scalar(`select count(*) from app_private.reward_setup_revisions where setup_id=${literal(setup)}`),1);
  assert.equal(await h.scalar(`select archived_at is null from app_private.reward_distribution_setups where id=${literal(setup)}`),true);
 });
 await scenario('delete versus execution serializes both winners under the existing setup lock',async()=>{
  for(const executionFirst of [false,true]){
   const {setup,plan}=await fixture(true);
   const args={p_actor_user_id:owner.userId,p_actor_session_id:owner.sessionId,p_chain_id:31337,p_setup_id:setup};
   const sql=executionFirst?h.rpcSql('service_reward_sponsor_execution',{...args,p_plan:plan,p_deployment_hash:null,p_funding_hash:null})
    :h.rpcSql('service_delete_reward_draft',{...args,p_expected_revision:1});
   const release=await h.lock(sql);
   let pending;
   try{
    pending=assert.rejects(executionFirst?remove(setup):rewardSponsorExecution(owner,31337,setup,{plan},h.rpc),{code:executionFirst?'reward_setup_not_deletable':'reward_setup_not_found'});
    await h.waiting(1);
   }finally{await release();}
   await pending;
   assert.equal(await h.scalar(`select archived_at is not null from app_private.reward_distribution_setups where id=${literal(setup)}`),!executionFirst);
  }
 });
}
