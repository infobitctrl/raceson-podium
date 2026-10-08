import assert from 'node:assert/strict';
import {rewardSponsorCreation,rewardDistributionSetups} from '../dist/rewards/index.js';
import {createGuidedSetup} from '../../domain/dist/rewards/guided-setup-editor.js';
import {integrationFixtureSql,literal as q} from './reward-integration-fixture.mjs';

export async function sponsorCreationRecoveryScenarios({harness:h,scenario}){
 assert.match(h.database,/^sitrail_validation_[0-9]+$/);
 await h.query(integrationFixtureSql().replaceAll('78000000-','be081008-'));
 const id=n=>`be081008-0000-4000-8000-${String(n).padStart(12,'0')}`;
 let seq=910000;const next=()=>id(seq++),owner={userId:id(4),sessionId:next()},foreign={userId:id(5),sessionId:next()};
 await h.query(`insert into auth.sessions(id,user_id,not_after) values(${q(owner.sessionId)},${q(owner.userId)},now()+interval '1 hour'),(${q(foreign.sessionId)},${q(foreign.userId)},now()+interval '1 hour')`);
 const make=async()=>{
  const setup=next(),launch=next();await rewardDistributionSetups(owner,10143,setup,{requestId:next(),expectedRevision:0,configuration:createGuidedSetup(next)},h.rpc);
  const plan={operator:'0x'+'22'.repeat(20),funder:'0x'+'11'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:'0x'+'11'.repeat(20)};
  await h.query(`insert into app_private.reward_sponsor_launches(id,setup_id,setup_revision,configuration_hash) values(${q(launch)},${q(setup)},1,repeat('a',64));insert into app_private.reward_sponsor_executions(setup_id,launch_id,plan) values(${q(setup)},${q(launch)},${q(JSON.stringify(plan))}::jsonb)`);
  return setup;
 };
 const setup=await make(),sender='0x'+'44'.repeat(20),transaction={chainId:10143,data:'0x6000',value:'0',nonce:'7',gas:'100',gasPrice:'1'},hash='0x'+'aa'.repeat(32);
 let leaseId=next();
 const reserve={action:'reserve',leaseId,sender,transaction};
 await rewardSponsorCreation(owner,setup,reserve,h.rpc);
 await rewardSponsorCreation(owner,setup,{action:'signed',leaseId,signedTransaction:'0xdead',hash},h.rpc);
 const failure={blockNumber:'90',blockHash:'0x'+'bc'.repeat(32),finalizedBlockNumber:'100',finalizedBlockHash:'0x'+'cd'.repeat(32),nonceAfter:'8'};
 await scenario('verified failure releases only its exact lease so explicit retry need not wait sixty seconds',async()=>{
  await assert.rejects(rewardSponsorCreation(owner,setup,{action:'release',leaseId,hash:'0x'+'ef'.repeat(32)},h.rpc),/invalid_sponsor_creation/);
  const released=await rewardSponsorCreation(owner,setup,{action:'release',leaseId,hash},h.rpc);
  assert.equal(released.hash,hash);assert.equal(released.signedTransaction,'0xdead');
  leaseId=next();const renewed=await rewardSponsorCreation(owner,setup,{...reserve,leaseId},h.rpc);
  assert.equal(renewed.leaseId,leaseId);assert.equal(renewed.hash,hash);
  reserve.leaseId=leaseId;
 });
 const retry={action:'retry',leaseId,sender,hash,transaction:{replacement:{...transaction,nonce:'8'},failure}};
 await scenario('creation retry rejects foreign sessions, stale hashes, lease loss and changed deployment bytes',async()=>{
  await assert.rejects(rewardSponsorCreation(foreign,setup,retry,h.rpc),/reward_setup_not_found/);
  await assert.rejects(rewardSponsorCreation({...owner,sessionId:foreign.sessionId},setup,retry,h.rpc),/reward_account_session_required/);
  for(const patch of [{hash:'0x'+'bb'.repeat(32)},{sender:'0x'+'55'.repeat(20)},
   {transaction:{...retry.transaction,replacement:{...transaction,data:'0x6001'}}},
   {transaction:{...retry.transaction,replacement:{...transaction,value:'1'}}},
   {transaction:{...retry.transaction,failure:{...failure,nonceAfter:'7'}}},
   {transaction:{...retry.transaction,failure:{...failure,finalizedBlockNumber:'89'}}},
   {transaction:{...retry.transaction,failure:{...failure,blockHash:null}}},
  ])await assert.rejects(rewardSponsorCreation(owner,setup,{...retry,...patch},h.rpc),/invalid_sponsor_creation/);
  await assert.rejects(rewardSponsorCreation(owner,setup,{...retry,leaseId:next()},h.rpc),/sponsor_creation_lease/);
  assert.equal(await h.scalar('select count(*) from app_private.reward_sponsor_failed_deployments'),0);
 });
 await scenario('creation retry preserves the exact old private journal and advances the nonce once',async()=>{
  const before=await h.scalar(`select to_jsonb(j) from app_private.reward_sponsor_auto_deployments j where setup_id=${q(setup)}`);
  const result=await rewardSponsorCreation(owner,setup,retry,h.rpc);
  assert.equal(result.transaction.nonce,'8');assert.equal(result.hash,null);assert.equal(result.signedTransaction,null);
  const saved=await h.scalar(`select to_jsonb(f) from app_private.reward_sponsor_failed_deployments f where setup_id=${q(setup)}`);
  assert.deepEqual(saved.job,before);assert.deepEqual(saved.failure,failure);assert.equal(saved.created_at,before.created_at);
  await assert.rejects(rewardSponsorCreation(owner,setup,retry,h.rpc),/invalid_sponsor_creation/);
  const resumed=await rewardSponsorCreation(owner,setup,{...reserve,transaction:{...transaction,nonce:'999'}},h.rpc);
  assert.equal(resumed.transaction.nonce,'8');
 });
 await scenario('creation retry history counts toward the unchanged ten-attempt limit',async()=>{
  for(let i=2;i<10;i++)await rewardSponsorCreation(owner,await make(),{...reserve,leaseId:next()},h.rpc);
  await assert.rejects(rewardSponsorCreation(owner,await make(),{...reserve,leaseId:next()},h.rpc),/sponsor_creation_capacity/);
  await rewardSponsorCreation(owner,setup,{action:'signed',leaseId,signedTransaction:'0xbeef',hash:'0x'+'bb'.repeat(32)},h.rpc);
  await assert.rejects(rewardSponsorCreation(owner,setup,{...retry,hash:'0x'+'bb'.repeat(32),transaction:{replacement:{...transaction,nonce:'20'},failure:{...failure,nonceAfter:'20'}}},h.rpc),/sponsor_creation_capacity/);
  assert.equal(await h.scalar('select count(*) from app_private.reward_sponsor_failed_deployments'),1);
 });
 await scenario('failed creation journals and raw retry function remain inaccessible to browser roles',async()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(await h.scalar(`select has_table_privilege('${role}','app_private.reward_sponsor_failed_deployments','SELECT')`),false);
  for(const role of ['anon','authenticated'])assert.equal(await h.scalar(`select has_function_privilege('${role}','public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)','EXECUTE')`),false);
 });
}
