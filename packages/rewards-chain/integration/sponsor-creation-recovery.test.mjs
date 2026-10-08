import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {advanceSponsorCreation} from '../../../apps/api/dist/features/rewards/sponsor-creation-service.js';

for(const viaFactory of [false,true])test(`finalized V5 ${viaFactory?'factory':'direct'} out-of-gas creation can explicitly retry and confirm on an owned chain`,{timeout:120000},async()=>{
 const chain=await startOwnedRewardChain({chainId:10143});
 try{
  const id=n=>`75081008-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const identity={userId:id(1),sessionId:id(2)},setup=id(3);
  const artifact=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnWalletRegistryV1.sol/RacesOnWalletRegistryV1.json',import.meta.url)));
  const identityIssuer=fixtureSigner(0x666).address.toLowerCase();
  const registryHash=await chain.operatorClient.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,args:[identityIssuer],gas:2000000n});
  const registryReceipt=await chain.publicClient.waitForTransactionReceipt({hash:registryHash});assert.equal(registryReceipt.status,'success');
  let factoryAddress;
  if(viaFactory){
   const factory=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnSponsorFactoryV5.sol/RacesOnSponsorFactoryV5.json',import.meta.url)));
   const receipt=await chain.publicClient.waitForTransactionReceipt({hash:await chain.operatorClient.deployContract({abi:factory.abi,bytecode:factory.bytecode.object,gas:8000000n})});
   assert.equal(receipt.status,'success');factoryAddress=receipt.contractAddress.toLowerCase();
  }
  await chain.testClient.mine({blocks:96,interval:1});
  const plan={version:5,walletRegistry:registryReceipt.contractAddress.toLowerCase(),identityIssuer,launchId:id(4),setupRevision:1,configurationHash:'a'.repeat(64),chainId:10143,funder:chain.operator.address.toLowerCase(),operator:fixtureSigner(0x555).address.toLowerCase(),unallocatedTreasury:chain.treasury.toLowerCase(),expiredTreasury:chain.operator.address.toLowerCase(),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['100000000000000000','0','0','0','0','0'],budgetWei:'100000000000000000'};
  let job=null,record={plan,deploymentHash:null,fundingHash:null},signs=0,lowGas=true;const history=[];
  const rpc=async(name,a)=>{
   if(name==='service_reward_sponsor_execution')return{data:record,error:null};
   if(a.p_action==='reserve')job=job?{...job,leaseId:a.p_lease_id,leaseUntil:new Date(Date.now()+60000).toISOString()}:{sender:a.p_sender,transaction:a.p_transaction,signedTransaction:null,hash:null,leaseId:a.p_lease_id,leaseUntil:new Date(Date.now()+60000).toISOString(),confirmed:false};
   if(a.p_action==='signed')job={...job,signedTransaction:a.p_signed_transaction,hash:a.p_transaction_hash};
   if(a.p_action==='retry'){
    assert.equal(a.p_transaction_hash,job.hash);assert.ok(BigInt(a.p_transaction.failure.nonceAfter)>BigInt(job.transaction.nonce));
    history.push({...job});job={...job,transaction:a.p_transaction.replacement,signedTransaction:null,hash:null};
   }
   if(a.p_action==='confirm'){job={...job,confirmed:true};record={...record,deploymentHash:a.p_transaction_hash};}
   return{data:job,error:null};
  };
  const signer={address:chain.relayer.address.toLowerCase(),...(factoryAddress?{factoryAddress}:{}),sign:async tx=>{signs++;return chain.relayer.signTransaction({type:'legacy',chainId:10143,to:tx.to,nonce:Number(tx.nonce),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice),value:0n,data:tx.data});}};
  const reader={...chain.publicClient,estimateGas:async args=>lowGas?2000000n:chain.publicClient.estimateGas(args)};
  const deps={reader,signer,rpc},before=await chain.publicClient.getBalance({address:plan.funder});
  const first=await advanceSponsorCreation(identity,setup,record,deps);assert.equal(first.status,'submitted');
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:first.hash})).status,'reverted');
  await chain.testClient.mine({blocks:96,interval:1});
  assert.equal((await advanceSponsorCreation(identity,setup,record,deps)).reason,'reverted');assert.equal(signs,1);
  lowGas=false;
  assert.equal((await advanceSponsorCreation(identity,setup,record,deps,first.hash)).status,'processing');assert.equal(history.length,1);
  const second=await advanceSponsorCreation(identity,setup,record,deps);assert.equal(second.status,'submitted');assert.notEqual(second.hash,first.hash);
  assert.equal((await chain.publicClient.waitForTransactionReceipt({hash:second.hash})).status,'success');
  await chain.testClient.mine({blocks:96,interval:1});
  assert.equal((await advanceSponsorCreation(identity,setup,record,deps)).status,'confirmed');assert.equal(signs,2);
  assert.equal(await chain.publicClient.getBalance({address:plan.funder}),before);
  assert.equal((await advanceSponsorCreation(identity,setup,record,deps,first.hash)).status,'confirmed');assert.equal(signs,2);
 }finally{await chain.stop();}
});
