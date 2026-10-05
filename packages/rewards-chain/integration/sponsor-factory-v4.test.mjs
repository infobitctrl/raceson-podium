import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {keccak256} from 'viem';
import {startOwnedRewardChain,fixtureSigner} from './owned-chain.mjs';
import {sponsorFactoryBuild,sponsorFactoryData,sponsorFactoryProgrammeAddress,sponsorFundingData,observeSponsorProgramme} from '../dist/sponsor-v4.js';
import {advanceControllerTransaction} from '../../../apps/api/dist/features/rewards/controller-transactions.js';
test('factory setup uses fixed-byte recovery; permissionless creation preserves sponsor and exact receipt checks',{timeout:120000},async()=>{
 const c=await startOwnedRewardChain({chainId:10143});
 try{
  const artifact=JSON.parse(readFileSync(new URL('../../../contracts/out/RacesOnSponsorFactoryV4.sol/RacesOnSponsorFactoryV4.json',import.meta.url)));
  assert.equal(keccak256(artifact.bytecode.object),sponsorFactoryBuild.creationCodeHash);assert.equal(keccak256(artifact.deployedBytecode.object),sponsorFactoryBuild.runtimeHash);
  const actor={subject:'did:privy:synthetic-test',wallet:c.operator.address.toLowerCase()};let stored=null,writes=0;
  const rpc=async(_name,a)=>{if(a.p_action==='reserve'){stored??={id:a.p_id,subject:actor.subject,sender:actor.wallet,context:a.p_context,transaction:a.p_transaction,signedTransaction:null,hash:null,confirmed:false};}
   if(a.p_action==='signed'){writes++;stored={...stored,signedTransaction:a.p_signed,hash:a.p_hash};}if(a.p_action==='confirm')stored={...stored,confirmed:true};return{data:stored,error:null};};
  const d={actor,reader:c.publicClient,rpc,assertActive:async()=>{}};
  const prepared=await advanceControllerTransaction(d,{action:'prepare',kind:'factory'});assert.equal(writes,0);
  const t=prepared.transaction,sign=patch=>c.operator.signTransaction({type:'legacy',chainId:10143,data:t.data,value:0n,nonce:Number(t.nonce),gas:BigInt(t.gas),gasPrice:BigInt(t.gasPrice),...patch});
  for(const patch of [{value:1n},{chainId:143},{to:c.relayer.address},{nonce:Number(t.nonce)+1},{data:'0x6000'}])await assert.rejects(advanceControllerTransaction(d,{action:'submit',id:prepared.id,signedTransaction:await sign(patch)}),/controller_transaction_invalid/);
  assert.equal(writes,0);
  const bytes=await sign({});let sends=0;
  const reader={...c.publicClient,sendRawTransaction:async args=>{sends++;assert.equal(stored.signedTransaction,args.serializedTransaction);const result=await c.publicClient.sendRawTransaction(args);throw Error('simulated lost broadcast response '+result);}};
  const sent=await advanceControllerTransaction({...d,reader},{action:'submit',id:prepared.id,signedTransaction:bytes});assert.equal(sent.hash,keccak256(bytes));assert.equal(sends,1);
  await c.publicClient.waitForTransactionReceipt({hash:sent.hash});await c.testClient.mine({blocks:96,interval:1});
  const confirmed=await advanceControllerTransaction({...d,reader},{action:'resume',id:sent.id});assert.equal(confirmed.confirmed,true);assert.equal(sends,1);assert.equal('signedTransaction' in confirmed,false);
  const p={version:4,launchId:'73000000-0000-4000-8000-000000000003',setupRevision:4,configurationHash:'a'.repeat(64),chainId:10143,
   funder:c.relayer.address.toLowerCase(),operator:c.operator.address.toLowerCase(),unallocatedTreasury:c.treasury.toLowerCase(),expiredTreasury:c.relayer.address.toLowerCase(),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['1000000000000000000','0','0','0','0','0'],budgetWei:'1000000000000000000'};
  const factory=confirmed.factory,before=await c.publicClient.getBalance({address:p.funder});
  const hash=await c.operatorClient.sendTransaction({to:factory,data:sponsorFactoryData(p),gas:15_000_000n});assert.equal((await c.publicClient.waitForTransactionReceipt({hash})).status,'success');await c.testClient.mine({blocks:96,interval:1});
  const observation=await observeSponsorProgramme(c.publicClient,p,hash);assert.equal(observation.address.toLowerCase(),sponsorFactoryProgrammeAddress(p,factory).toLowerCase());assert.equal(observation.funded,false);assert.equal(await c.publicClient.getBalance({address:p.funder}),before);
  await assert.rejects(observeSponsorProgramme(c.publicClient,{...p,configurationHash:'b'.repeat(64)},hash));
  await assert.rejects(observeSponsorProgramme({...c.publicClient,getCode:async a=>a.address.toLowerCase()===factory?'0x6000':c.publicClient.getCode(a)},p,hash));
  await assert.rejects(observeSponsorProgramme({...c.publicClient,getTransactionReceipt:async a=>({...await c.publicClient.getTransactionReceipt(a),logs:[]})},p,hash));
  const retry=await c.operatorClient.sendTransaction({to:factory,data:sponsorFactoryData(p),gas:15_000_000n});await c.publicClient.waitForTransactionReceipt({hash:retry});await c.testClient.mine({blocks:96,interval:1});assert.equal((await observeSponsorProgramme(c.publicClient,p,retry)).address,observation.address);
  const deposit=await c.relayerClient.sendTransaction({to:observation.address,data:sponsorFundingData(),value:BigInt(p.budgetWei),gas:2_000_000n});await c.publicClient.waitForTransactionReceipt({hash:deposit});await c.testClient.mine({blocks:96,interval:1});assert.equal((await observeSponsorProgramme(c.publicClient,p,hash,deposit)).funded,true);
 }finally{await c.stop();}
});
