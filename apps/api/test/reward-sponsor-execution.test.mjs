import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSponsorExecutionPlan} from '@raceson/domain/rewards/sponsor-execution';
import {SponsorReceiptError} from '@raceson/rewards-chain/sponsor-v4';
import {dispatchSponsorExecution,sponsorExecutionPolicyFromEnv} from '../dist/routes/rewards/sponsor-execution.js';
const id=n=>`73000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const plan={version:4,launchId:id(3),setupRevision:4,configurationHash:'a'.repeat(64),chainId:10143,funder:'0x'+'11'.repeat(20),operator:'0x'+'22'.repeat(20),
 unallocatedTreasury:'0x'+'33'.repeat(20),expiredTreasury:'0x'+'11'.repeat(20),claimLifetime:86400,reviewPeriods:[0,0,0,0,0,0],caps:['101','0','0','0','0','0'],budgetWei:'101'};
test('V4 economic manifest rejects loose identities, unsupported chains, unbalanced caps and invalid clocks',()=>{
 assert.deepEqual(decodeSponsorExecutionPlan(plan),plan);
 for(const patch of [{chainId:1},{funder:plan.operator},{caps:['100','0','0','0','0','0']},{claimLifetime:0},{claimLifetime:315360001},{reviewPeriods:[0,0,0,0,0,2592001]},{extra:true}])assert.throws(()=>decodeSponsorExecutionPlan({...plan,...patch}));
 assert.equal(sponsorExecutionPolicyFromEnv({}),null);
 assert.throws(()=>sponsorExecutionPolicyFromEnv({RACESON_SPONSOR_V4_POLICY:JSON.stringify({operator:plan.operator,treasury:plan.unallocatedTreasury})}));
});
test('sponsor execution route is account-scoped, fails closed without operator configuration, and never accepts browser receipt assertions',async()=>{
 let response,body,calls=0;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(4),sessionId:id(5)}),sponsorPolicy:()=>null,
  rpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_sponsor_execution');assert.equal(args.p_actor_user_id,id(4));assert.equal(args.p_chain_id,10143);return {data:null,error:null};},
  readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>{},sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
 const url=new URL(`http://local/api/v1/rewards/distribution-setups/${id(1)}/execution`),res={setHeader(){}};
 await dispatchSponsorExecution({method:'GET'},res,url,deps);assert.deepEqual(response,{status:200,data:{enabled:false,record:null,observation:null}});
 body={action:'prepare',launchId:id(3),funder:plan.funder};await dispatchSponsorExecution({method:'POST'},res,url,deps);assert.equal(response.status,409);
 for(const extra of [{operator:plan.operator},{funded:true},{receipt:{status:'success'}},{plan}]){body={action:'deployment',hash:'0x'+'aa'.repeat(32),...extra};await dispatchSponsorExecution({method:'POST'},res,url,deps);assert.equal(response.status,400);}
 assert.equal(calls,2);
 await dispatchSponsorExecution({method:'GET'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);assert.equal(calls,2);
});

test('new return terms bind both unused and expired funds while historical launches retain their destinations',async()=>{
 const {createGuidedSetup,addGuidedGroup}=await import('@raceson/domain/rewards/guided-setup-editor');
 const {decodeRewardSetup}=await import('@raceson/domain/rewards/distribution-setup');
 const {createSponsorExecutionPlan}=await import('@raceson/domain/rewards/sponsor-execution');
 let seq=200;const next=()=>id(seq++);let configuration=createGuidedSetup(next);
 configuration=addGuidedGroup(configuration,configuration.guided.pots[0].nodeId,'club_metres',next,null);
 configuration.root.children.forEach((p,i)=>p.shareBps=i===0?10000:0);configuration.root.children[0].children[0].shareBps=10000;
 const launch={id:id(3),setup:{id:id(1),chainId:10143,revision:1,updatedAt:'2026-09-24T08:00:00.000Z',configuration},configurationHash:'a'.repeat(64),createdAt:'2026-09-24T08:00:00.000Z',state:'prepared'};
 const policy={operator:plan.operator,treasury:plan.unallocatedTreasury,reviewPeriods:plan.reviewPeriods};
 configuration.policy.treasuryReturn='original_sender';
 const historical=createSponsorExecutionPlan(launch,plan.funder,policy);
 assert.equal(historical.unallocatedTreasury,policy.treasury);assert.equal(historical.expiredTreasury,plan.funder);
 configuration.policy={...configuration.policy,fewerFinishers:'selected_return',claimWindowDays:30};
 assert.equal(decodeRewardSetup(configuration).policy.fewerFinishers,'selected_return');
 const chosen=createSponsorExecutionPlan(launch,plan.funder,policy);
 assert.equal(chosen.unallocatedTreasury,plan.funder);assert.equal(chosen.expiredTreasury,plan.funder);assert.equal(chosen.claimLifetime,30*86400);
 configuration.policy.treasuryReturn='raceson_default';
 const treasury=createSponsorExecutionPlan(launch,plan.funder,policy);
 assert.equal(treasury.unallocatedTreasury,policy.treasury);assert.equal(treasury.expiredTreasury,policy.treasury);
 assert.equal(historical.unallocatedTreasury,policy.treasury,'earlier execution plan remains immutable');
 assert.throws(()=>decodeRewardSetup({...configuration,policy:{...configuration.policy,fewerFinishers:'any_wallet'}}));
});

const deploymentHash='0x'+'aa'.repeat(32),fundingHash='0x'+'bb'.repeat(32);
async function rejectedReceipt({action='funding',error,chainId=10143,authError,storeError,method='POST'}){
 let response,readerCalls=0;
 const calls=[],record={plan,deploymentHash,fundingHash:null};
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>{
  if(authError)throw Error(authError);
  return {userId:id(4),sessionId:id(5)};
 },sponsorPolicy:()=>null,readJsonBody:async()=>({action,hash:action==='deployment'?deploymentHash:fundingHash}),
  rpc:async(name,args)=>{
   calls.push({name,args});
   assert.equal(name,'service_reward_sponsor_execution');
   assert.equal(args.p_actor_user_id,id(4));assert.equal(args.p_actor_session_id,id(5));
   assert.equal(args.p_chain_id,10143);assert.equal(args.p_setup_id,id(1));
   return storeError?{data:null,error:{message:storeError}}:{data:record,error:null};
  },
  sponsorReader:{getChainId:async()=>{readerCalls++;if(error)throw error;return chainId;}},
  applyPrivateSessionHeaders:()=>{},sendSuccess:(_r,data)=>response={status:200,data},
  sendError:(_r,status,code,message)=>response={status,code,message}};
 const url=new URL(`http://local/api/v1/rewards/distribution-setups/${id(1)}/execution`);
 assert.equal(await dispatchSponsorExecution({method},{setHeader(){}},url,deps),true);
 for(const {args} of calls){
  assert.equal(args.p_plan,null,'unverified receipt must not prepare or change economics');
  assert.equal(args.p_deployment_hash,null,'unverified receipt must not change deployment journal');
  assert.equal(args.p_funding_hash,null,'unverified receipt must not change funding journal');
 }
 assert.deepEqual(record,{plan,deploymentHash,fundingHash:null});
 return {response,readerCalls,calls};
}

for(const action of ['deployment','funding']){
 for(const [code,status] of [['sponsor_receipt_pending',425],['sponsor_receipt_reverted',422]]){
  test(`${action} receipt reports ${code} only for its submitted hash without journal mutation`,async()=>{
   const txHash=action==='deployment'?deploymentHash:fundingHash;
   const {response,calls,readerCalls}=await rejectedReceipt({action,error:new SponsorReceiptError(code,txHash)});
   assert.equal(response.status,status);assert.equal(response.code,code);
   assert.equal(calls.length,1);assert.equal(readerCalls,1);
   assert.match(response.message,code==='sponsor_receipt_pending'?/no finalized receipt yet/:/finalized receipt.*reverted/);
  });
 }
 test(`${action} explicit campaign verification mismatch differs from a failed transaction`,async()=>{
  const {response}=await rejectedReceipt({action,chainId:1});
  assert.equal(response.status,422);assert.equal(response.code,'sponsor_receipt_mismatch');
  assert.match(response.message,/saved campaign/);assert.doesNotMatch(response.message,/reverted|transaction failed/);
 });
}

test('transport and unclassified receipt failures remain unavailable, not pending or reverted',async()=>{
 for(const error of [Error('RPC timeout'),Error('sponsor_receipt_pending'),{code:'sponsor_receipt_reverted',transactionHash:fundingHash}]){
  const {response}=await rejectedReceipt({error});
  assert.equal(response.status,503);assert.equal(response.code,'sponsor_observation_unavailable');
  assert.match(response.message,/outcome is unknown/);assert.doesNotMatch(response.message,/not yet|pending|reverted/);
 }
});

test('an error on a previously saved hash cannot classify the newly submitted receipt',async()=>{
 for(const code of ['sponsor_receipt_pending','sponsor_receipt_reverted']){
  const {response}=await rejectedReceipt({error:new SponsorReceiptError(code,deploymentHash)});
  assert.equal(response.status,503);assert.equal(response.code,'sponsor_observation_unavailable');
 }
});

test('GET observations preserve unavailable response for receipt and mismatch errors',async()=>{
 for(const error of [new SponsorReceiptError('sponsor_receipt_reverted',deploymentHash),Error('sponsor_chain_verification_failed')]){
  const {response}=await rejectedReceipt({method:'GET',error});
  assert.equal(response.status,503);assert.equal(response.code,'sponsor_observation_unavailable');
 }
});

test('receipt classification does not bypass account authentication or campaign ownership',async()=>{
 const pending=new SponsorReceiptError('sponsor_receipt_pending',fundingHash);
 const unauthenticated=await rejectedReceipt({error:pending,authError:'Unauthorized'});
 assert.equal(unauthenticated.response.status,401);assert.equal(unauthenticated.calls.length,0);assert.equal(unauthenticated.readerCalls,0);
 const notOwner=await rejectedReceipt({error:pending,storeError:'reward_setup_not_found'});
 assert.equal(notOwner.response.status,404);assert.equal(notOwner.calls.length,1);assert.equal(notOwner.readerCalls,0);
 const expiredSession=await rejectedReceipt({error:pending,storeError:'reward_account_session_required'});
 assert.equal(expiredSession.response.status,401);assert.equal(expiredSession.calls.length,1);assert.equal(expiredSession.readerCalls,0);
});

test('confirmed campaign reads and receipt checks do not depend on creation-provider availability',async()=>{
 for(const action of [undefined,{action:'funding',hash:fundingHash},{action:'launch'}]){
  let response,resolutions=0,grants=0,chainReads=0;
  const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(4),sessionId:id(5)}),sponsorPolicy:()=>null,
   resolveCreation:async()=>{resolutions++;throw Error('creation provider unavailable');},
   creation:{signer:{verifyReady:async()=>{grants++;throw Error('grant unavailable');}}},
   rpc:async(name,args)=>{assert.equal(name,'service_reward_sponsor_execution');assert.equal(args.p_actor_user_id,id(4));return {data:{plan,deploymentHash,fundingHash:null},error:null};},
   sponsorReader:{getChainId:async()=>{chainReads++;throw Error('chain observation unavailable');}},
   readJsonBody:async()=>action,applyPrivateSessionHeaders:()=>{},sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
  await dispatchSponsorExecution({method:action?'POST':'GET'},{setHeader(){}},new URL(`http://local/api/v1/rewards/distribution-setups/${id(1)}/execution`),deps);
  assert.equal(resolutions,0);assert.equal(grants,0);assert.equal(chainReads,1,'confirmed accounts still require fresh chain verification');
  assert.equal(response.status,503,'chain errors remain fail-closed');
 }
});
test('an uncreated campaign still requires creation-provider verification',async()=>{
 let response,resolutions=0;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(4),sessionId:id(5)}),sponsorPolicy:()=>null,
  resolveCreation:async()=>{resolutions++;throw Error('creation provider unavailable');},
  rpc:async()=>({data:{plan,deploymentHash:null,fundingHash:null},error:null}),
  applyPrivateSessionHeaders:()=>{},sendSuccess:(_r,data)=>response={status:200,data},sendError:(_r,status,code)=>response={status,code}};
 await dispatchSponsorExecution({method:'GET'},{setHeader(){}},new URL(`http://local/api/v1/rewards/distribution-setups/${id(1)}/execution`),deps);
 assert.equal(resolutions,1);assert.equal(response.status,503);
});
