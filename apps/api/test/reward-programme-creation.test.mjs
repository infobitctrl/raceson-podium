import assert from 'node:assert/strict';
import test from 'node:test';
import {dispatchProgrammeCreation} from '../dist/routes/rewards/programme-creation.js';
import {createDefaultRewardProgrammeDraftV2} from '../../../packages/domain/dist/rewards/programme-draft-v2.js';
const id=n=>`82000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const change={seasonId:id(1),draftId:id(2),budgetMon:'100'};
const record={draftId:id(2),seasonId:id(1),organizationId:id(3),organizationName:'Demo organizer',seasonName:'Demo league',chainId:10143,revision:1,updatedAt:'2026-09-16T12:00:00Z',rules:{...createDefaultRewardProgrammeDraftV2(),budgetMon:'100'}};
async function request({method='POST',body=change,error,identityError,raw=record}={}){
 const res={},calls=[];
 const deps={config:()=>({chainId:10143}),requireIdentity:async()=>{if(identityError)throw new Error(identityError);return{userId:id(4),sessionId:id(5)};},
 readJsonBody:async()=>body,applyPrivateSessionHeaders:()=>{res.private=true;},sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code}),
 rpc:async(name,args)=>{calls.push({name,args});return{data:raw,error:error?{message:error}:null};}};
 await dispatchProgrammeCreation({method},{...res,setHeader(){}},new URL('http://127.0.0.1:3102/api/v1/organizer/rewards/programme-creation'),{...deps,sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code})});return{res,calls};
}
test('creation derives actor, session and network and sends only bounded settings',async()=>{
 const {res,calls}=await request();assert.equal(res.status,200);assert.equal(res.private,true);assert.equal(res.data.record.draftId,id(2));
 assert.deepEqual(calls,[{name:'service_reward_programme_creation',args:{p_actor_user_id:id(4),p_actor_session_id:id(5),p_chain_id:10143,p_season_id:id(1),p_draft_id:id(2),p_budget_mon:'100'}}]);
});
test('creation rejects role, network, result injection and invalid budgets before storage',async()=>{
 for(const body of [{...change,chainId:31337},{...change,organizationId:id(3)},{...change,approved:true},{...change,budgetMon:'0'},{...change,budgetMon:'1000001'},{...change,budgetMon:'0.1'}]){
 const {res,calls}=await request({body});assert.equal(res.status,400);assert.equal(calls.length,0);}
});
test('private list validates scope and create never accepts a substituted saved record',async()=>{
 const item={seasonId:id(1),organizationId:id(3),organizationName:'Demo',seasonName:'Demo league',draftId:null};
 assert.equal((await request({method:'GET',raw:[item]})).res.data.items[0].seasonId,id(1));
 assert.equal((await request({raw:{...record,seasonId:id(9)}})).res.status,503);
 assert.equal((await request({raw:{...record,chainId:31337}})).res.status,503);
 assert.equal((await request({error:'reward_planning_not_found'})).res.status,404);
 assert.equal((await request({error:'reward_programme_exists'})).res.status,409);
 assert.equal((await request({identityError:'Unauthorized'})).res.status,401);
 assert.equal((await request({method:'DELETE'})).res.status,405);
});
