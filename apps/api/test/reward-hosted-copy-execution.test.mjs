import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCopySponsorExecutionRpc,hostedCopyWalletRpc,hostedCopySupportRpc} from '../../../packages/db/dist/rewards/hosted-copy-execution.js';
import {hostedCopyRequestAllowed,hostedCopyOperationsEnabled} from '../dist/features/rewards/hosted-copy-preview.js';
import {decodeCopySponsorLaunchBinding} from '@raceson/domain/rewards/copy-sponsor-launch';
const id=n=>`7c000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={userId:id(1),sessionId:id(2)},args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_setup_id:id(3)};
test('hosted execution requires explicit operations flag and pinned hosted testnet target',()=>{
 const env={RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1'};
 const target={supabaseUrl:'https://niklhlmljiikwbkrmapw.supabase.co'};
 assert.equal(hostedCopyOperationsEnabled(env,target),true);assert.equal(hostedCopyOperationsEnabled({...env,RACESON_REWARD_HOSTED_OPERATIONS:undefined},target),false);
 for(const patch of [{RACESON_REWARD_PORTAL_MODE:'local-testnet'},{RACESON_REWARD_HOSTED_COPY_MODE:'preview-v1'},{RACESON_REWARD_HOSTED_OPERATIONS:'true'}])assert.throws(()=>hostedCopyOperationsEnabled({...env,...patch},target));
 assert.throws(()=>hostedCopyOperationsEnabled(env,{supabaseUrl:'https://foreign.supabase.co'}));
 const allow=(method,path,operations=true)=>hostedCopyRequestAllowed(method,new URL(path,'https://podium.invalid'),'sponsor-drafts-v1',operations);
 for(const path of [`/api/v1/rewards/demo-copy/sponsor-setups/${id(3)}/launch`,`/api/v1/rewards/distribution-setups/${id(3)}/execution`,'/api/v1/rewards/admin/wallets','/api/v1/rewards/admin/support']){
  for(const method of ['GET','POST'])assert.equal(allow(method,path),true);
  assert.equal(allow('GET',path,false),false);assert.equal(allow('POST',path+'?scope=foreign'),false);assert.equal(allow('PATCH',path),false);
 }
 for(const path of ['/api/v1/rewards/control','/api/v1/rewards/distribution-setups/'+id(3)+'/launch','/api/v1/rewards/admin/wallets/other'])assert.equal(allow('POST',path),false);
});
test('hosted support cannot substitute identity or forward wallet and signing commands',async()=>{
 const calls=[],rpc=hostedCopySupportRpc(identity,async(name,args)=>{calls.push({name,args});return {data:null,error:null};});
 const scoped={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_change:null};
 await rpc('service_reward_support_settings',scoped);
 assert.deepEqual(calls,[{name:'service_reward_demo_copy_support_settings',args:scoped}]);
 for(const patch of [{p_actor_user_id:id(9)},{p_actor_session_id:id(9)},{p_setup_id:id(3)},{signedTransaction:'0x1234'}])assert.throws(()=>rpc('service_reward_support_settings',{...scoped,...patch}));
 for(const method of ['service_reward_wallet_settings','service_reward_wallet_runtime','service_reward_sponsor_execution'])assert.throws(()=>rpc(method,scoped));
 assert.equal(calls.length,1);
});
test('private sponsor adapter binds verified identity, setup and chain and exposes no arbitrary RPC',async()=>{
 const calls=[],rpc=async(name,args)=>{calls.push({name,args});return {data:null,error:null};};
 const bound=hostedCopySponsorExecutionRpc(identity,id(3),rpc,'a'.repeat(64));
 await bound('service_reward_sponsor_launch',{...args,p_chain_id:10143,p_request_id:id(4),p_expected_revision:2});
 assert.deepEqual(calls[0],{name:'service_reward_demo_copy_sponsor_operation',args:{...args,p_operation:'launch',p_payload:{requestId:id(4),expectedRevision:2,sourceFingerprint:'a'.repeat(64)}}});
 await bound('service_reward_sponsor_execution',{...args,p_chain_id:10143,p_plan:null,p_deployment_hash:null,p_funding_hash:null});
 assert.equal(calls[1].args.p_operation,'execution');
 for(const bad of [{...args,p_actor_user_id:id(9)},{...args,p_actor_session_id:id(9)},{...args,p_setup_id:id(9)},{...args,p_chain_id:1}])await assert.rejects(()=>bound('service_reward_sponsor_execution',bad));
 await assert.rejects(()=>bound('service_reward_wallet_settings',args));
 await assert.rejects(()=>hostedCopySponsorExecutionRpc(identity,id(3),rpc)('service_reward_sponsor_launch',args),/sources_required/);
 assert.equal(calls.length,2);
});
test('wallet transport is limited to server runtime and existing master settings boundary',async()=>{
 const calls=[],rpc=hostedCopyWalletRpc(async(name,args)=>{calls.push({name,args});return {data:null,error:null};});
 await rpc('service_reward_wallet_runtime',{});assert.deepEqual(calls[0].args,{p_operation:'runtime',p_actor_user_id:null,p_actor_session_id:null,p_payload:{}});
 assert.throws(()=>rpc('service_reward_wallet_runtime',{p_actor_user_id:identity.userId}));assert.throws(()=>rpc('service_reward_sponsor_execution',args));
 await rpc('service_reward_wallet_settings',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_expected_revision:null,p_settings:null,p_reason:null,p_previous_settings:null});
 assert.equal(calls[1].name,'service_reward_demo_copy_wallet_operation');assert.equal(calls[1].args.p_operation,'settings');
});
test('display source proof cannot be reused across launch, revision, configuration or chain',()=>{
 const launch={id:id(4),setup:{id:id(3),chainId:10143,revision:2},configurationHash:'b'.repeat(64)};
 const b={version:'copy-launch-v1',setupId:id(3),launchId:id(4),revision:2,configurationHash:'b'.repeat(64),sourceFingerprint:'a'.repeat(64)};
 assert.deepEqual(decodeCopySponsorLaunchBinding(b,launch),b);
 for(const patch of [{setupId:id(9)},{launchId:id(9)},{revision:1},{configurationHash:'c'.repeat(64)},{sourceFingerprint:'fake'},{funded:true}])assert.throws(()=>decodeCopySponsorLaunchBinding({...b,...patch},launch));
 assert.throws(()=>decodeCopySponsorLaunchBinding(b,{...launch,setup:{...launch.setup,chainId:1}}));
});

test('execution resolves copy scope after Auth and cannot fall back to generic grants on denial',async()=>{
 const {dispatchSponsorExecution}=await import('../dist/routes/rewards/sponsor-execution.js');
 let output,resolutions=0,genericCalls=0;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>identity,readJsonBody:async()=>({action:'prepare',launchId:id(4),funder:'0x'+'1'.repeat(40)}),
  applyPrivateSessionHeaders(){},sendSuccess(){assert.fail('unexpected success');},sendError:(_r,status,code)=>output={status,code},
  rpc:async()=>{genericCalls++;return {data:null,error:null};},resolveRpc:async(actor,setup)=>{resolutions++;assert.deepEqual(actor,identity);assert.equal(setup,id(3));throw Error('reward_demo_sponsor_required');}};
 const url=new URL(`/api/v1/rewards/distribution-setups/${id(3)}/execution`,'https://podium.invalid');
 await dispatchSponsorExecution({method:'POST'},{setHeader(){}},url,deps);assert.deepEqual(output,{status:403,code:'reward_demo_sponsor_required'});
 await dispatchSponsorExecution({method:'GET'},{setHeader(){}},url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});
 assert.equal(output.status,401);assert.equal(resolutions,1);assert.equal(genericCalls,0);
});
