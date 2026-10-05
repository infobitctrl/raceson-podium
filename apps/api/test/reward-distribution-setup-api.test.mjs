import test from 'node:test';
import assert from 'node:assert/strict';
import {createRewardSetup} from '@raceson/domain/rewards/distribution-setup';
import {rewardDistributionSetups} from '@raceson/db/rewards';
import {deleteRewardDraft} from '@raceson/db/rewards';
import {dispatchDistributionSetups} from '../dist/routes/rewards/distribution-setups.js';
const id=n=>`72000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config=()=>createRewardSetup(id(11));
test('draft deletion requires identity and exact revision, and maps guarded failures',async()=>{
 let body={expectedRevision:3},result,calls=0,code=null;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),readJsonBody:async()=>body,
  rpc:async(name,args)=>{calls++;assert.equal(name,'service_delete_reward_draft');assert.equal(args.p_actor_user_id,id(1));assert.equal(args.p_actor_session_id,id(2));assert.equal(args.p_chain_id,10143);assert.equal(args.p_expected_revision,3);return code?{data:null,error:{message:code}}:{data:{id:id(3),deleted:true},error:null};},
  applyPrivateSessionHeaders(){},sendSuccess:(_r,data)=>{result={status:200,data};},sendError:(_r,status,code)=>{result={status,code};}};
 const url=new URL(`http://local/api/v1/rewards/distribution-setups/${id(3)}`),res={setHeader(){}};
 await dispatchDistributionSetups({method:'DELETE'},res,url,deps);assert.deepEqual(result,{status:200,data:{id:id(3),deleted:true}});
 for(const error of ['reward_setup_conflict','reward_setup_not_deletable','reward_setup_not_found','reward_account_session_required']){
  code=error;await dispatchDistributionSetups({method:'DELETE'},res,url,deps);assert.equal(result.status,error==='reward_setup_not_found'?404:error==='reward_account_session_required'?401:409);
 }
 const previous=calls;body={expectedRevision:3,ownerUserId:id(9)};await dispatchDistributionSetups({method:'DELETE'},res,url,deps);assert.equal(result.status,400);assert.equal(calls,previous);
 await dispatchDistributionSetups({method:'DELETE'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(result.status,401);assert.equal(calls,previous);
 await assert.rejects(()=>deleteRewardDraft({userId:id(1),sessionId:id(2)},10143,id(3),3,async()=>({data:{id:id(9),deleted:true},error:null})),/invalid_reward_setup/);
});
test('repository binds actor, session and chain and rejects wrong-scope replies',async()=>{
 const record={id:id(3),chainId:10143,revision:1,updatedAt:'2026-09-16T12:00:00.000Z',configuration:config()};let called;
 const rpc=async(name,args)=>{called={name,args};return{data:record,error:null};};
 assert.deepEqual(await rewardDistributionSetups({userId:id(1),sessionId:id(2)},10143,id(3),{requestId:id(4),expectedRevision:0,configuration:config()},rpc),record);
 assert.equal(called.name,'service_reward_distribution_setups');assert.equal(called.args.p_actor_user_id,id(1));assert.equal(called.args.p_actor_session_id,id(2));assert.equal(called.args.p_chain_id,10143);
 await assert.rejects(()=>rewardDistributionSetups({userId:id(1),sessionId:id(2)},10143,id(3),undefined,async()=>({data:{...record,id:id(5)},error:null})));
});
test('private test route derives identity and rejects unknown body fields before RPC',async()=>{
 let result,reads=0;const headers={};let body={requestId:id(4),expectedRevision:0,configuration:config()};
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),readJsonBody:async()=>body,
  rpc:async(_name,args)=>{reads++;assert.equal(args.p_actor_user_id,id(1));return{data:{id:id(3),chainId:10143,revision:1,updatedAt:'2026-09-16T12:00:00.000Z',configuration:config()},error:null};},
  applyPrivateSessionHeaders:()=>{headers.cache='private, no-store';},sendSuccess:(_r,data)=>{result={status:200,data};},sendError:(_r,status,code)=>{result={status,code};}};
 const url=new URL(`http://local/api/v1/rewards/distribution-setups/${id(3)}`),res={setHeader(){}};
 await dispatchDistributionSetups({method:'PATCH'},res,url,deps);assert.equal(result.status,200);assert.equal(headers.cache,'private, no-store');
 body={...body,ownerUserId:id(9)};await dispatchDistributionSetups({method:'PATCH'},res,url,deps);assert.equal(result.status,400);assert.equal(reads,1);
 await dispatchDistributionSetups({method:'GET'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(result.status,401);assert.equal(reads,1);
 await dispatchDistributionSetups({method:'POST'},res,url,deps);assert.equal(result.status,405);
});

test('archive route binds owner, session, revision and bool; protects funded and rejects malformed replies',async()=>{
 let result,calls=0,code=null;let body={expectedRevision:3,archived:true};
 const record={id:id(3),chainId:10143,revision:3,updatedAt:'2026-09-16T12:00:00.000Z',configuration:config(),lifecycle:{state:'deposit',canDelete:false,archived:true}};
 let reply=record;
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),readJsonBody:async()=>body,
  rpc:async(name,args)=>{calls++;assert.equal(name,'service_archive_reward_setup');assert.deepEqual(args,{p_actor_user_id:id(1),p_actor_session_id:id(2),p_chain_id:10143,p_setup_id:id(3),p_expected_revision:3,p_archived:body.archived});return code?{data:null,error:{message:code}}:{data:reply,error:null};},
  applyPrivateSessionHeaders:()=>{},sendSuccess:(_r,data)=>{result={status:200,data};},sendError:(_r,status,code)=>{result={status,code};}};
 const url=new URL(`http://local/api/v1/rewards/distribution-setups/${id(3)}/archive`),res={setHeader(){}};
 await dispatchDistributionSetups({method:'POST'},res,url,deps);assert.deepEqual(result,{status:200,data:record});
 body={expectedRevision:3,archived:false};reply={...record,lifecycle:{...record.lifecycle,archived:false}};
 await dispatchDistributionSetups({method:'POST'},res,url,deps);assert.equal(result.status,200);assert.equal(result.data.lifecycle.archived,false);
 for(const error of ['reward_setup_not_archivable','reward_setup_conflict','reward_setup_not_found','reward_account_session_required']){
  code=error;await dispatchDistributionSetups({method:'POST'},res,url,deps);assert.equal(result.status,error==='reward_setup_not_found'?404:error==='reward_account_session_required'?401:409);
 }
 code=null;
 for(const invalid of [{...record,id:id(9)},{...record,chainId:31337},{...record,revision:2},record]){
  reply=invalid;await dispatchDistributionSetups({method:'POST'},res,url,deps);assert.equal(result.status,400);
 }
 const previous=calls;
 for(const invalid of [{expectedRevision:3,archived:'true'},{expectedRevision:3,archived:true,ownerUserId:id(9)},{archived:true}]){
  body=invalid;await dispatchDistributionSetups({method:'POST'},res,url,deps);assert.equal(result.status,400);
 }
 await dispatchDistributionSetups({method:'POST'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(result.status,401);
 await dispatchDistributionSetups({method:'GET'},res,url,deps);assert.equal(result.status,405);
 assert.equal(calls,previous);
});
