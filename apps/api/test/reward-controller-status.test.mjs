import test from 'node:test';
import assert from 'node:assert/strict';
import {controllerTransactionStatus} from '../dist/features/rewards/controller-transactions.js';
const actor={subject:'did:privy:syntheticcontroller',wallet:'0x'+'11'.repeat(20)};
const job={id:'73000000-0000-4000-8000-000000000003',subject:actor.subject,sender:actor.wallet,
 context:{kind:'distribution',setupId:'73000000-0000-4000-8000-000000000001',approvalId:'73000000-0000-4000-8000-000000000002',action:'upload',start:0,end:1,source:'synthetic'},
 transaction:{chainId:10143,to:'0x'+'44'.repeat(20),data:'0xaa',value:'0',nonce:'10',gas:'200000',gasPrice:'100000000000'},signedTransaction:null,hash:null,confirmed:false};
function setup({finalized=10,pending=10,chain=10143,empty=false,foreign=false,fail=false}={}){
 const calls=[];let activeChecks=0;
 const deps={actor,assertActive:async()=>{activeChecks++;},rpc:async(name,args)=>{assert.equal(name,'service_reward_controller_transaction');assert.equal(args.p_action,'read');calls.push('read');return {error:null,data:args.p_id||empty?null:{...job,sender:foreign?'0x'+'22'.repeat(20):actor.wallet}};},
 reader:{getChainId:async()=>chain,getTransactionCount:async({address,blockTag})=>{assert.equal(address,actor.wallet);calls.push(blockTag);if(fail)throw Error('provider down');return blockTag==='finalized'?finalized:pending;},sendRawTransaction:async()=>assert.fail('status must never broadcast')}};
 return {deps,calls,checks:()=>activeChecks};
}
test('nonce diagnosis is read-only, scoped and never presented as confirmation',async()=>{
 for(const [finalized,pending,state]of [[10,10,'unused'],[10,11,'pending'],[11,11,'consumed']]){
  const f=setup({finalized,pending}),s=await controllerTransactionStatus(f.deps);
  assert.equal(s.nonceStatus.state,state);assert.equal(s.nonceStatus.finalizedNonce,String(finalized));assert.equal(s.nonceStatus.pendingNonce,String(pending));assert.ok(Date.parse(s.nonceStatus.observedAt));
  assert.equal(s.pending.confirmed,false);assert.equal(s.pending.hash,null);assert.equal('signedTransaction' in s.pending,false);assert.equal(f.checks(),2);assert.deepEqual(f.calls,['read','read','finalized','pending']);
 }
});
test('wrong chain, failed provider and inconsistent counts preserve the request without invented observations',async()=>{
 for(const options of [{chain:1},{fail:true},{finalized:11,pending:10},{finalized:-1},{pending:NaN}]){
  const f=setup(options),s=await controllerTransactionStatus(f.deps);
  assert.deepEqual(s.nonceStatus,{state:'unavailable',finalizedNonce:null,pendingNonce:null,observedAt:null});assert.equal(s.pending.id,job.id);assert.equal(s.pending.confirmed,false);assert.equal(f.checks(),2);
  if(options.chain)assert.deepEqual(f.calls,['read','read']);
 }
});
test('empty queue avoids chain calls; foreign record and revoked session fail closed',async()=>{
 const f=setup({empty:true});assert.deepEqual(await controllerTransactionStatus(f.deps),{pending:null,factory:null,nonceStatus:null});assert.deepEqual(f.calls,['read','read']);
 await assert.rejects(()=>controllerTransactionStatus(setup({foreign:true}).deps),/controller_scope_required/);
 const revoked=setup();let checks=0;revoked.deps.assertActive=async()=>{if(++checks===2)throw Error('controller_auth_required');};
 await assert.rejects(()=>controllerTransactionStatus(revoked.deps),/controller_auth_required/);
});
