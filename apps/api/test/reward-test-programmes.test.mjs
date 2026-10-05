import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTestProgrammeConfiguration,createTestProgramme,calculateTestProgramme} from '@raceson/domain/rewards/test-programme';
import {rewardTestProgrammes} from '@raceson/db/rewards';
import {dispatchTestProgrammes} from '../dist/routes/rewards/test-programmes.js';
const id=n=>`72000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config=()=>({name:'Two rounds',budgetMon:100,order:createTestProgramme(2,10),rule:'rank',approved:false,claims:{}});
test('saved simulation validates permutations, bounds, simulated states and conserved calculations',()=>{
 const c=decodeTestProgrammeConfiguration(config());assert.equal(c.order.length,2);
 const result=calculateTestProgramme(c.budgetMon,c.order,c.rule);assert.equal(result.totals.reduce((a,b)=>a+b,0n),100n*10n**18n);
 for(const change of [c=>c.order[0][1]=0,c=>c.budgetMon=0,c=>c.budgetMon=1.5,c=>c.claims={'0:0':'paid'},c=>{c.approved=true;c.claims={'4:0':'paid'};},c=>c.wallet='private',c=>c.name=' x ',c=>c.rule='other']){
  const c=config();change(c);assert.throws(()=>decodeTestProgrammeConfiguration(c));
 }
});
test('repository binds actor, session and chain and rejects wrong-scope replies',async()=>{
 const record={id:id(3),chainId:10143,revision:1,updatedAt:'2026-09-16T12:00:00.000Z',configuration:config()};let called;
 const rpc=async(name,args)=>{called={name,args};return{data:record,error:null};};
 assert.deepEqual(await rewardTestProgrammes({userId:id(1),sessionId:id(2)},10143,id(3),{requestId:id(4),expectedRevision:0,configuration:config()},rpc),record);
 assert.equal(called.name,'service_reward_test_programmes');assert.equal(called.args.p_actor_user_id,id(1));assert.equal(called.args.p_actor_session_id,id(2));assert.equal(called.args.p_chain_id,10143);
 await assert.rejects(()=>rewardTestProgrammes({userId:id(1),sessionId:id(2)},10143,id(3),undefined,async()=>({data:{...record,id:id(5)},error:null})));
});
test('private test route derives identity and rejects unknown body fields before RPC',async()=>{
 let result,reads=0;const headers={};let body={requestId:id(4),expectedRevision:0,configuration:config()};
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>({userId:id(1),sessionId:id(2)}),readJsonBody:async()=>body,
  rpc:async(_name,args)=>{reads++;assert.equal(args.p_actor_user_id,id(1));return{data:{id:id(3),chainId:10143,revision:1,updatedAt:'2026-09-16T12:00:00.000Z',configuration:config()},error:null};},
  applyPrivateSessionHeaders:()=>{headers.cache='private, no-store';},sendSuccess:(_r,data)=>{result={status:200,data};},sendError:(_r,status,code)=>{result={status,code};}};
 const url=new URL(`http://local/api/v1/rewards/test-programmes/${id(3)}`),res={setHeader(){}};
 await dispatchTestProgrammes({method:'PATCH'},res,url,deps);assert.equal(result.status,200);assert.equal(headers.cache,'private, no-store');
 body={...body,ownerUserId:id(9)};await dispatchTestProgrammes({method:'PATCH'},res,url,deps);assert.equal(result.status,400);assert.equal(reads,1);
 await dispatchTestProgrammes({method:'GET'},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(result.status,401);assert.equal(reads,1);
 await dispatchTestProgrammes({method:'DELETE'},res,url,deps);assert.equal(result.status,405);
});
