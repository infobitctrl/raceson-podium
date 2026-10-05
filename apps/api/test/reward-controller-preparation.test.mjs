import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceControllerTransaction,controllerTransactionRequest} from '../dist/features/rewards/controller-transactions.js';
const id=n=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor={subject:'did:privy:synthetic',wallet:'0x'+'11'.repeat(20)};
const documentHash='a'.repeat(64);
const request={action:'prepare',kind:'distribution',setupId:id(1),approvalId:id(2),expectedDocumentHash:documentHash};
function fixture(source=JSON.stringify({upload:{documentHash}})){
 const calls=[];
 const job={id:id(3),subject:actor.subject,sender:actor.wallet,
  context:{kind:'distribution',setupId:id(1),approvalId:id(2),action:'upload',start:0,end:58,source},
  // Deliberately over limit: matching review must still reach the existing safety check.
  transaction:{chainId:10143,to:'0x'+'44'.repeat(20),data:'0xaa',value:'0',nonce:'0',gas:'7326567',gasPrice:'102000000000'},signedTransaction:null,hash:null,confirmed:false};
 const deps={actor,assertActive:async()=>calls.push('auth'),reader:{getChainId:async()=>10143},rpc:async(name,args)=>{
  assert.equal(name,'service_reward_controller_transaction');calls.push(args.p_action);assert.equal(args.p_action,'read');return {data:job,error:null};
 }};
 return {calls,deps};
}
test('preparation accepts an exact reviewed digest and retains gas and authorization checks',async()=>{
 const f=fixture();assert.deepEqual(controllerTransactionRequest.parse(request),request);
 await assert.rejects(()=>advanceControllerTransaction(f.deps,request),/controller_gas_limit/);
 assert.deepEqual(f.calls,['auth','read']);
 const revoked=fixture();revoked.deps.assertActive=async()=>{throw Error('controller_auth_required');};
 await assert.rejects(()=>advanceControllerTransaction(revoked.deps,request),/controller_auth_required/);assert.deepEqual(revoked.calls,[]);
});
test('changed or unreadable reviewed source cannot return or reserve a prepared transaction',async()=>{
 for(const source of [JSON.stringify({upload:{documentHash:'b'.repeat(64)}}),'malformed','{}']){
  const f=fixture(source);await assert.rejects(()=>advanceControllerTransaction(f.deps,request),/controller_source_not_ready/);assert.deepEqual(f.calls,['auth','read']);
 }
 assert.throws(()=>controllerTransactionRequest.parse({...request,expectedDocumentHash:'invalid'}));
});
test('older clients without the optional digest retain existing preparation safeguards',async()=>{
 const f=fixture(),{expectedDocumentHash,...legacy}=request;
 await assert.rejects(()=>advanceControllerTransaction(f.deps,legacy),/controller_gas_limit/);
});
