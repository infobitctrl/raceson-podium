import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {decodeSponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {advanceSponsorCreation,sponsorCreationStatus} from '../dist/features/rewards/sponsor-creation-service.js';
import {sponsorCreationSignerFromEnv} from '../dist/features/rewards/sponsor-creation-privy.js';
const id=n=>`74000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={userId:id(1),sessionId:id(2)},setup=id(3);
const account=privateKeyToAccount('0x'+'00'.repeat(31)+'99'); // synthetic test signer only
const plan={version:4,launchId:id(4),setupRevision:1,configurationHash:'a'.repeat(64),chainId:10143,funder:'0x'+'11'.repeat(20),operator:'0x'+'22'.repeat(20),unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:'0x'+'11'.repeat(20),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['101','0','0','0','0','0'],budgetWei:'101'};
function fixture(){
 let job=null,signs=0,sends=[],deny=false;const record={plan,deploymentHash:null,fundingHash:null};
 const rpc=async(name,a)=>{
  assert.equal(a.p_actor_user_id,identity.userId);assert.equal(a.p_actor_session_id,identity.sessionId);
  if(deny)return{data:null,error:{message:'reward_account_session_required'}};
  if(name==='service_reward_sponsor_execution')return{data:record,error:null};
  assert.equal(name,'service_reward_sponsor_auto_deployment');
  if(a.p_action==='reserve'){
   if(!job)job={sender:a.p_sender,transaction:a.p_transaction,signedTransaction:null,hash:null,leaseId:a.p_lease_id,leaseUntil:new Date(Date.now()+60000).toISOString(),confirmed:false};
   else if(Date.parse(job.leaseUntil)<Date.now())job={...job,leaseId:a.p_lease_id,leaseUntil:new Date(Date.now()+60000).toISOString()};
  }
  if(a.p_action==='signed')job={...job,signedTransaction:a.p_signed_transaction,hash:a.p_transaction_hash};
  return{data:job,error:null};
 };
 const reader={getChainId:async()=>10143,estimateGas:async()=>15000000n,getGasPrice:async()=>100000000000n,getBalance:async()=>100n*10n**18n,getTransactionCount:async()=>7,getBlock:async()=>{throw Error('not finalized');},getTransactionReceipt:async()=>{throw Error('not found');},sendRawTransaction:async({serializedTransaction})=>{assert.equal(job.signedTransaction,serializedTransaction);sends.push(serializedTransaction);throw Error('lost response');}};
 const signer={address:account.address.toLowerCase(),sign:async tx=>{signs++;return account.signTransaction({type:'legacy',chainId:tx.chainId,nonce:Number(tx.nonce),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice),data:tx.data,value:BigInt(tx.value)});}};
 return{record,deps:{reader,signer,rpc},get job(){return job;},get signs(){return signs;},sends,expire(){job.leaseUntil=new Date(Date.now()-1000).toISOString();},revoke(){deny=true;}};
}

function revertedFixture(){
 const f=fixture(),rpc=f.deps.rpc;
 f.record.plan=decodeSponsorExecutionPlan({...plan,version:5,walletRegistry:'0x'+'55'.repeat(20),identityIssuer:'0x'+'66'.repeat(20)});
 let receipt=null;
 const blockHash='0x'+'ab'.repeat(32),finalizedHash='0x'+'cd'.repeat(32);
 f.deps.reader.getTransactionReceipt=async()=>{if(!receipt)throw Error('not found');return receipt;};
 f.deps.reader.getBlock=async({blockTag,blockNumber})=>blockTag==='finalized'||blockNumber===100n?{number:100n,hash:finalizedHash}:{number:90n,hash:blockHash};
 f.deps.reader.getTransactionCount=async()=>receipt?8:7;
 const failed=[];
 let replacement=null;
 f.deps.rpc=async(name,a)=>{
  if(a.p_action==='retry'){
   assert.equal(a.p_transaction_hash,f.job.hash);assert.equal(a.p_lease_id,f.job.leaseId);
   failed.push({...f.job});
   replacement={...f.job,transaction:a.p_transaction.replacement,hash:null,signedTransaction:null};
   return{data:replacement,error:null};
  }
  return rpc(name,a);
 };
 return {...f,original:f,failed,get replacement(){return replacement;},revert(){receipt={status:'reverted',transactionHash:f.job.hash,blockNumber:90n,blockHash};f.expire();},setReceipt(r){receipt=r;}};
}

test('finalized revert stays failed until explicit hash-bound retry; replacement is journaled unsigned with history',async()=>{
 const f=revertedFixture(),first=await advanceSponsorCreation(identity,setup,f.original.record,f.deps);
 f.revert();
 assert.equal((await advanceSponsorCreation(identity,setup,f.original.record,f.deps)).reason,'reverted');
 assert.equal(f.failed.length,0);f.original.expire();
 const retry=await advanceSponsorCreation(identity,setup,f.original.record,f.deps,first.hash);
 assert.equal(retry.status,'processing');assert.equal(retry.hash,null);
 assert.equal(f.failed.length,1);assert.equal(f.failed[0].hash,first.hash);
 assert.equal(f.replacement.signedTransaction,null);assert.equal(f.replacement.transaction.nonce,'8');
 assert.equal(f.original.signs,1);assert.equal(f.original.sends.length,1);
});

test('unfinalized, reorged, wrong-hash, unconsumed-nonce and wrong-chain receipts never authorize replacement',async()=>{
 for(const kind of ['unfinalized','reorg','hash','nonce','chain','unavailable']){
  const f=revertedFixture(),first=await advanceSponsorCreation(identity,setup,f.original.record,f.deps);f.revert();
  if(kind==='unfinalized')f.setReceipt({status:'reverted',transactionHash:first.hash,blockNumber:101n,blockHash:'0x'+'ab'.repeat(32)});
  if(kind==='reorg')f.deps.reader.getBlock=async()=>({number:100n,hash:'0x'+'ee'.repeat(32)});
  if(kind==='hash')f.setReceipt({status:'reverted',transactionHash:'0x'+'ef'.repeat(32),blockNumber:90n,blockHash:'0x'+'ab'.repeat(32)});
  if(kind==='nonce')f.deps.reader.getTransactionCount=async()=>Number(f.original.job.transaction.nonce);
  if(kind==='chain')f.deps.reader.getChainId=async()=>1;
  if(kind==='unavailable')f.deps.reader.getBlock=async()=>{throw Error('offline');};
  await advanceSponsorCreation(identity,setup,f.original.record,f.deps,first.hash);
  assert.equal(f.failed.length,0,kind);assert.equal(f.original.signs,1,kind);
 }
});

test('stale retry hash, successful receipt and missing receipt never create replacement transactions',async()=>{
 for(const kind of ['stale','success','missing']){
  const f=revertedFixture(),first=await advanceSponsorCreation(identity,setup,f.original.record,f.deps);f.revert();
  if(kind==='success')f.setReceipt({status:'success',transactionHash:first.hash,blockNumber:90n,blockHash:'0x'+'ab'.repeat(32)});
  if(kind==='missing')f.setReceipt(null);
  await advanceSponsorCreation(identity,setup,f.original.record,f.deps,kind==='stale'?'0x'+'ef'.repeat(32):first.hash);
  assert.equal(f.failed.length,0);assert.equal(f.original.signs,1);assert.equal(f.original.sends.length,1);
 }
});

test('automatic-job receipt polling exposes finalized failure without signing or broadcasting',async()=>{
 const {dispatchSponsorExecution}=await import('../dist/routes/rewards/sponsor-execution.js');
 const f=revertedFixture(),first=await advanceSponsorCreation(identity,setup,f.original.record,f.deps);
 f.revert();let output;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>identity,sponsorPolicy:()=>null,rpc:f.deps.rpc,
  creation:f.deps,sponsorReader:f.deps.reader,readJsonBody:async()=>({action:'deployment',hash:first.hash}),applyPrivateSessionHeaders(){},
  sendSuccess:(_r,data)=>output={status:200,data},sendError:(_r,status,code)=>output={status,code}};
 await dispatchSponsorExecution({method:'POST'},{setHeader(){}},new URL(`https://local.invalid/api/v1/rewards/distribution-setups/${setup}/execution`),deps);
 assert.equal(output.status,200);assert.equal(output.data.creation.reason,'reverted');assert.equal(output.data.record.deploymentHash,null);
 assert.equal(f.failed.length,0);assert.equal(f.original.signs,1);assert.equal(f.original.sends.length,1);
 f.setReceipt(null);f.original.expire();
 await dispatchSponsorExecution({method:'POST'},{setHeader(){}},new URL(`https://local.invalid/api/v1/rewards/distribution-setups/${setup}/execution`),deps);
 assert.equal(output.data.creation.status,'submitted');assert.equal(f.original.sends.length,1);
});

test('hosted retry stays inside the existing identity/setup-bound private creation transport',async()=>{
 const {hostedCopySponsorExecutionRpc}=await import('../../../packages/db/dist/rewards/hosted-copy-execution.js');
 const calls=[],rpc=hostedCopySponsorExecutionRpc(identity,setup,async(name,args)=>{calls.push({name,args});return{data:null,error:null};});
 const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:setup,p_action:'retry',p_lease_id:id(9),p_sender:account.address,
  p_transaction:{replacement:{chainId:10143},failure:{blockNumber:'90'}},p_signed_transaction:null,p_transaction_hash:'0x'+'aa'.repeat(32)};
 await rpc('service_reward_sponsor_auto_deployment',args);
 assert.equal(calls[0].name,'service_reward_demo_copy_sponsor_operation');
 assert.equal(calls[0].args.p_operation,'creation');assert.equal(calls[0].args.p_payload.action,'retry');
 assert.deepEqual(calls[0].args.p_payload.transaction,args.p_transaction);
 for(const patch of [{p_actor_user_id:id(8)},{p_actor_session_id:id(8)},{p_setup_id:id(8)}])await assert.rejects(rpc('service_reward_sponsor_auto_deployment',{...args,...patch}),/invalid_sponsor_execution/);
 assert.equal(calls.length,1);
});

test('receipt-only polls and stale retries cannot sign an attempt replaced during reservation',async()=>{
 for(const observeOnly of [true,false]){
  const f=fixture(),first=await advanceSponsorCreation(identity,setup,f.record,f.deps);f.expire();
  const rpc=f.deps.rpc;
  f.deps.rpc=async(name,args)=>{
   const result=await rpc(name,args);
   return args.p_action==='reserve'?{data:{...result.data,transaction:{...result.data.transaction,nonce:'8'},hash:null,signedTransaction:null},error:null}:result;
  };
  const result=await advanceSponsorCreation(identity,setup,f.record,f.deps,observeOnly?undefined:first.hash,observeOnly);
  assert.equal(result.status,'processing');assert.equal(result.hash,null);assert.equal(f.signs,1);assert.equal(f.sends.length,1);
 }
});
test('automatic creation journals before broadcast and resumes the identical transaction after a lost response',async()=>{
 const f=fixture();const first=await advanceSponsorCreation(identity,setup,f.record,f.deps);
 assert.equal(first.status,'submitted');assert.equal(f.signs,1);assert.equal(f.sends.length,1);assert.equal(f.job.transaction.value,'0');
 const concurrent=await advanceSponsorCreation(identity,setup,f.record,f.deps);assert.equal(concurrent.hash,first.hash);assert.equal(f.sends.length,1);
 f.expire();const retry=await advanceSponsorCreation(identity,setup,f.record,f.deps);assert.equal(retry.hash,first.hash);assert.equal(f.signs,1);assert.equal(f.sends.length,2);assert.equal(f.sends[0],f.sends[1]);
 const view=await sponsorCreationStatus(identity,setup,f.record,true,f.deps.rpc);assert.deepEqual(Object.keys(view).sort(),['hash','reason','status']);assert.equal(view.status,'submitted');
});
test('wrong chain, controller/sponsor signer, gas cap and low balance cannot sign or broadcast',async()=>{
 for(const kind of ['chain','controller','sponsor','gas','balance']){
  const f=fixture();if(kind==='chain')f.deps.reader.getChainId=async()=>1;
  if(kind==='controller')f.deps.signer.address=plan.operator;if(kind==='sponsor')f.deps.signer.address=plan.funder;
  if(kind==='gas')f.deps.reader.getGasPrice=async()=>10n**18n;if(kind==='balance')f.deps.reader.getBalance=async()=>0n;
  assert.notEqual((await advanceSponsorCreation(identity,setup,f.record,f.deps)).status,'submitted');assert.equal(f.signs,0);assert.equal(f.sends.length,0);
 }
});
test('rejects signer substitution of recipient, value, gas or nonce before recording any signed bytes',async()=>{
 for(const patch of [{to:plan.funder},{value:1n},{nonce:8},{gas:30000001n}]){
  const f=fixture();f.deps.signer.sign=async tx=>account.signTransaction({type:'legacy',chainId:10143,nonce:Number(tx.nonce),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice),data:tx.data,value:0n,...patch});
  assert.equal((await advanceSponsorCreation(identity,setup,f.record,f.deps)).status,'failed');assert.equal(f.job.signedTransaction,null);assert.equal(f.sends.length,0);
 }
});
test('revoked platform session cannot invoke signer; confirmed campaigns never redeploy',async()=>{
 const f=fixture();f.revoke();await assert.rejects(advanceSponsorCreation(identity,setup,f.record,f.deps),/reward_account_session_required/);assert.equal(f.signs,0);
 f.record.deploymentHash='0x'+'ab'.repeat(32);assert.equal((await advanceSponsorCreation(identity,setup,f.record,f.deps)).status,'confirmed');assert.equal(f.signs,0);
});
test('missing isolated Privy server credentials fail closed with explicit configuration status',async()=>{
 assert.equal(sponsorCreationSignerFromEnv({}),null);assert.equal(sponsorCreationSignerFromEnv({RACESON_REWARD_PORTAL_MODE:'production'}),null);
 const f=fixture();f.deps.signer=null;assert.deepEqual(await advanceSponsorCreation(identity,setup,f.record,f.deps),{status:'unavailable',reason:'configuration',hash:null});
});

test('retired third-wallet and unverified controller credentials cannot enable the live signer',()=>{
 const env={RACESON_REWARD_PORTAL_MODE:'local-testnet',RACESON_REWARD_PRIVY_APP_ID:'cmtx921we00fu0cifaab7exez',RACESON_SPONSOR_DEPLOYMENT_APP_SECRET:'synthetic-secret',RACESON_SPONSOR_DEPLOYMENT_AUTH_KEY:'synthetic-auth-key'};
 for(const address of ['0x02e9f9739f9fa6e7a85ed38bae491b425ef3175f','0x361ffea5d7c76b2db3d5573a241c94ed05e787ba']){
  assert.equal(sponsorCreationSignerFromEnv({...env,RACESON_SPONSOR_DEPLOYMENT_PRIVY:JSON.stringify({appId:env.RACESON_REWARD_PRIVY_APP_ID,walletId:'synthetic-id',address})}),null);
 }
});

test('an earlier controller reservation queues creation without implying a broadcast',async()=>{
 const f=fixture(),rpc=f.deps.rpc;
 f.deps.rpc=async(name,args)=>name==='service_reward_sponsor_auto_deployment'&&args.p_action==='reserve'
  ?{data:null,error:{message:'sponsor_creation_busy'}}:rpc(name,args);
 const result=await advanceSponsorCreation(identity,setup,f.record,f.deps);
 assert.deepEqual(result,{status:'processing',reason:'controller_busy',hash:null});
 assert.equal(f.job,null);assert.equal(f.signs,0);assert.equal(f.sends.length,0);
});

test('reload checks availability without reserving or automatically starting a job',async()=>{
 const f=fixture(),calls=[];let available=false;
 const rpc=async(name,args)=>{calls.push([name,args]);return name==='service_reward_sponsor_creation_available'?{data:available,error:null}:f.deps.rpc(name,args);};
 assert.deepEqual(await sponsorCreationStatus(identity,setup,f.record,true,rpc,account.address),{status:'unavailable',reason:'controller_busy',hash:null});
 available=true;
 assert.deepEqual(await sponsorCreationStatus(identity,setup,f.record,true,rpc,account.address),{status:'ready',reason:null,hash:null});
 assert.equal(calls.filter(([n])=>n==='service_reward_sponsor_creation_available').length,2);
 assert.ok(calls.every(([n,a])=>n==='service_reward_sponsor_creation_available'||a.p_action==='read'));
 assert.equal(f.signs,0);assert.equal(f.sends.length,0);assert.equal(f.job,null);
});
test('existing signed jobs take precedence over another pending controller request',async()=>{
 const f=fixture();await advanceSponsorCreation(identity,setup,f.record,f.deps);
 const rpc=async(name,args)=>{assert.notEqual(name,'service_reward_sponsor_creation_available');return f.deps.rpc(name,args);};
 assert.equal((await sponsorCreationStatus(identity,setup,f.record,true,rpc,account.address)).status,'submitted');
});
test('availability errors and malformed reads never become ready',async()=>{
 for(const response of [{data:null,error:{message:'reward_account_session_required'}},{data:'true',error:null},{data:null,error:{message:'unavailable'}}]){
  const f=fixture(),rpc=async(name,args)=>name==='service_reward_sponsor_creation_available'?response:f.deps.rpc(name,args);
  await assert.rejects(sponsorCreationStatus(identity,setup,f.record,true,rpc,account.address),/reward_account_session_required|sponsor_creation_storage_unavailable/);
  assert.equal(f.signs,0);assert.equal(f.job,null);
 }
});

test('factory creation preserves the distribution operator while a different wallet signs deployment',async()=>{
 const {sponsorFactoryBuild,sponsorFactoryData}=await import('@raceson/rewards-chain/sponsor-v4');
 const {keccak256,parseTransaction}=await import('viem');
 const f=fixture(),factory='0x'+'44'.repeat(20),runtime='0x'+sponsorFactoryBuild.bytecode.slice(-sponsorFactoryBuild.runtimeBytes*2);
 assert.equal(keccak256(runtime),sponsorFactoryBuild.runtimeHash);
 f.deps.signer.factoryAddress=factory;
 f.deps.signer.sign=async tx=>account.signTransaction({type:'legacy',chainId:tx.chainId,to:tx.to,nonce:Number(tx.nonce),gas:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice),data:tx.data,value:BigInt(tx.value)});
 f.deps.reader.getCode=async()=>runtime;
 assert.equal((await advanceSponsorCreation(identity,setup,f.record,f.deps)).status,'submitted');
 assert.equal(f.job.sender,account.address.toLowerCase());assert.notEqual(f.job.sender,plan.operator);
 assert.equal(f.job.transaction.data,sponsorFactoryData(plan));assert.equal(parseTransaction(f.sends[0]).to,factory);
 assert.equal(f.record.plan.operator,plan.operator);
});
