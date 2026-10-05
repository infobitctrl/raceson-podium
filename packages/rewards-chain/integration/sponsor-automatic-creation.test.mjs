import test from 'node:test';
import assert from 'node:assert/strict';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {advanceSponsorCreation} from '../../../apps/api/dist/features/rewards/sponsor-creation-service.js';
import {dispatchSponsorExecution} from '../../../apps/api/dist/routes/rewards/sponsor-execution.js';
import {sponsorFundingData,observeSponsorProgramme} from '../dist/sponsor-v4.js';

test('automatic gas service creates and confirms without controller login, then sponsor funds exact pots',{timeout:120000},async()=>{
 const chain=await startOwnedRewardChain({chainId:10143});
 try{
  const id=n=>`75000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const identity={userId:id(1),sessionId:id(2)};
  const plan={version:4,launchId:id(3),setupRevision:1,configurationHash:'a'.repeat(64),chainId:10143,funder:chain.operator.address.toLowerCase(),operator:fixtureSigner(0x555).address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),expiredTreasury:chain.operator.address.toLowerCase(),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['100000000000000000','0','0','0','0','0'],budgetWei:'100000000000000000'};
  let record={plan,deploymentHash:null,fundingHash:null},job=null,signs=0;
  const rpc=async(name,a)=>{
   if(name==='service_reward_sponsor_execution')return{data:record,error:null};
   if(a.p_action==='reserve')job=job?{...job,leaseId:a.p_lease_id,leaseUntil:new Date(Date.now()+60000).toISOString()}:{sender:a.p_sender,transaction:a.p_transaction,signedTransaction:null,hash:null,leaseId:a.p_lease_id,leaseUntil:new Date(Date.now()+60000).toISOString(),confirmed:false};
   if(a.p_action==='signed')job={...job,signedTransaction:a.p_signed_transaction,hash:a.p_transaction_hash};
   if(a.p_action==='confirm'){job={...job,confirmed:true};record={...record,deploymentHash:a.p_transaction_hash};}
   return{data:job,error:null};
  };
  const signer={address:chain.relayer.address.toLowerCase(),sign:async tx=>{signs++;return chain.relayer.signTransaction({type:'legacy',chainId:10143,nonce:Number(tx.nonce),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice),value:0n,data:tx.data});}};
  const sponsorBefore=await chain.publicClient.getBalance({address:plan.funder});
  const first=await advanceSponsorCreation(identity,id(4),record,{reader:chain.publicClient,signer,rpc});assert.equal(first.status,'submitted');
  await chain.publicClient.waitForTransactionReceipt({hash:first.hash});await chain.testClient.mine({blocks:96,interval:1});
  let response;
  const deps={config:()=>({chainId:10143}),requireIdentity:async()=>identity,sponsorPolicy:()=>null,rpc,
   creation:{reader:chain.publicClient,signer},
   sponsorReader:{getChainId:async()=>{throw Error('duplicate observation');}},
   readJsonBody:async()=>({action:'launch'}),applyPrivateSessionHeaders:()=>{},
   sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
  await dispatchSponsorExecution({method:'POST'},{setHeader(){}},new URL(`http://local/api/v1/rewards/distribution-setups/${id(4)}/execution`),deps);
  assert.equal(response.status,200,'creation confirmation must reuse its verified observation');
  assert.equal(response.data.creation.status,'confirmed');
  assert.equal(response.data.observation.deploymentHash,first.hash);
  assert.equal(response.data.observation.funded,false);
  assert.deepEqual(Object.keys(response.data.creation).sort(),['hash','reason','status'],'internal evidence is not duplicated in the creation status');
  assert.equal(signs,1);assert.equal(await chain.publicClient.getBalance({address:plan.funder}),sponsorBefore);
  await dispatchSponsorExecution({method:'GET'},{setHeader(){}},new URL(`http://local/api/v1/rewards/distribution-setups/${id(4)}/execution`),deps);
  assert.equal(response.status,503,'a later request must verify chain state again, not reuse evidence across requests');
  const observed=await observeSponsorProgramme(chain.publicClient,plan,first.hash);assert.equal(observed.funded,false);
  const funding=await chain.operatorClient.sendTransaction({to:observed.address,data:sponsorFundingData(),value:BigInt(plan.budgetWei),gas:2000000n});await chain.publicClient.waitForTransactionReceipt({hash:funding});await chain.testClient.mine({blocks:96,interval:1});
  assert.equal((await observeSponsorProgramme(chain.publicClient,plan,first.hash,funding)).funded,true);
  assert.equal((await advanceSponsorCreation(identity,id(4),record,{reader:chain.publicClient,signer,rpc})).status,'confirmed');assert.equal(signs,1);
 }finally{await chain.stop();}
});
