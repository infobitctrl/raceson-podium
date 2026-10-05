import assert from 'node:assert/strict';
import {rewardControllerTransaction,rewardSponsorCreation,rewardDistributionSetups} from '../dist/rewards/index.js';
import {createGuidedSetup} from '../../domain/dist/rewards/guided-setup-editor.js';
import {rewardId as id} from '../../../apps/api/test/fixtures/reward-calculation.mjs';
import {literal} from './reward-integration-fixture.mjs';
export async function sponsorCreationScenarios({harness:h,scenario}){
 await scenario('automatic sponsor creation reserves unique nonces, preserves attempts and denies foreign/stale leases',async()=>{
  let seq=950000;const next=()=>id(seq++),owner={userId:id(4),sessionId:next()},other={userId:id(5),sessionId:next()};
  await h.query(`insert into auth.sessions(id,user_id,not_after) values(${literal(owner.sessionId)},${literal(owner.userId)},now()+interval '1 hour'),(${literal(other.sessionId)},${literal(other.userId)},now()+interval '1 hour');`);
  const make=async()=>{const setup=next(),launch=next();await rewardDistributionSetups(owner,10143,setup,{requestId:next(),expectedRevision:0,configuration:createGuidedSetup(next)},h.rpc);
   const plan={operator:'0x'+'22'.repeat(20),funder:'0x'+'11'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:'0x'+'11'.repeat(20)};
   await h.query(`insert into app_private.reward_sponsor_launches(id,setup_id,setup_revision,configuration_hash) values(${literal(launch)},${literal(setup)},1,${literal('a'.repeat(64))});insert into app_private.reward_sponsor_executions(setup_id,launch_id,plan) values(${literal(setup)},${literal(launch)},${literal(JSON.stringify(plan))}::jsonb);`);return setup;};
  const setup=await make(),sender='0x'+'44'.repeat(20),leaseId=next(),transaction={chainId:10143,data:'0x6000',value:'0',nonce:'7',gas:'100',gasPrice:'1'};
  const reserve={action:'reserve',leaseId,sender,transaction};
  await assert.rejects(rewardSponsorCreation(other,setup,reserve,h.rpc),/reward_setup_not_found/);
  await assert.rejects(rewardSponsorCreation({...owner,sessionId:other.sessionId},setup,reserve,h.rpc),/reward_account_session_required/);
  const first=await rewardSponsorCreation(owner,setup,reserve,h.rpc);assert.equal(first.transaction.nonce,'7');
  assert.equal((await rewardSponsorCreation(owner,setup,{...reserve,leaseId:next()},h.rpc)).leaseId,leaseId);
  await assert.rejects(rewardSponsorCreation(owner,setup,{action:'signed',leaseId:next(),signedTransaction:'0xdead',hash:'0x'+'aa'.repeat(32)},h.rpc),/sponsor_creation_lease/);
  const signed=await rewardSponsorCreation(owner,setup,{action:'signed',leaseId,signedTransaction:'0xdead',hash:'0x'+'aa'.repeat(32)},h.rpc);assert.equal(signed.hash,'0x'+'aa'.repeat(32));
  await assert.rejects(rewardSponsorCreation(owner,setup,{action:'signed',leaseId,signedTransaction:'0xbeef',hash:'0x'+'bb'.repeat(32)},h.rpc),/invalid_sponsor_creation/);
  const second=await make();assert.equal((await rewardSponsorCreation(owner,second,{...reserve,leaseId:next()},h.rpc)).transaction.nonce,'8');
  const actor={subject:'did:privy:nonce-test',wallet:sender},pendingId=next();
  await assert.rejects(rewardControllerTransaction(actor,'reserve',{id:pendingId,context:{kind:'factory'},transaction},h.rpc),/controller_transaction_pending/);
  await h.query(`update app_private.reward_sponsor_auto_deployments set confirmed=true,signed_transaction='0xdead',transaction_hash=${literal('0x'+'aa'.repeat(32))} where sender=${literal(sender)};`);
  const cj=await rewardControllerTransaction(actor,'reserve',{id:pendingId,context:{kind:'factory'},transaction},h.rpc);assert.equal(cj.transaction.nonce,'9');
  const blockedSetup=await make();
  await assert.rejects(rewardSponsorCreation(owner,blockedSetup,{...reserve,leaseId:next()},h.rpc),/sponsor_creation_busy/);
  assert.equal(await rewardControllerTransaction({...actor,subject:'did:privy:foreign'},'read',{id:pendingId},h.rpc),null);
  await rewardControllerTransaction(actor,'signed',{id:pendingId,signed:'0xcafe',hash:'0x'+'bb'.repeat(32)},h.rpc);
  await assert.rejects(rewardControllerTransaction(actor,'signed',{id:pendingId,signed:'0xbabe',hash:'0x'+'cc'.repeat(32)},h.rpc),/controller_transaction_invalid/);
  await rewardControllerTransaction(actor,'confirm',{id:pendingId,hash:'0x'+'bb'.repeat(32)},h.rpc);
  for(const role of ['anon','authenticated'])assert.equal(await h.scalar(`select has_function_privilege('${role}','public.service_reward_controller_transaction(text,text,text,uuid,jsonb,jsonb,text,text)','execute')`),false);
  const third=await make();await assert.rejects(rewardSponsorCreation(owner,third,{...reserve,leaseId:next()},h.rpc),/sponsor_creation_capacity/);
  await h.query(`update app_private.reward_sponsor_auto_deployments set lease_until=now()-interval '1 second' where setup_id=${literal(setup)};`);
  const newLease=next();const resumed=await rewardSponsorCreation(owner,setup,{...reserve,leaseId:newLease,transaction:{...transaction,nonce:'999'}},h.rpc);assert.equal(resumed.transaction.nonce,'7');assert.equal(resumed.signedTransaction,'0xdead');
  for(const role of ['anon','authenticated'])assert.equal(await h.scalar(`select has_function_privilege('${role}','public.service_reward_sponsor_auto_deployment(uuid,uuid,uuid,text,uuid,text,jsonb,text,text)','execute')`),false);
 });
}
