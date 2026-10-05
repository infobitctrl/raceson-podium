import test from 'node:test';
import assert from 'node:assert/strict';
import {changeSupportSettings,readSupportSettings,supportFingerprint} from '../dist/features/rewards/operations.js';
import {dispatchRewardOperations} from '../dist/routes/rewards/operations.js';
import {decodeSupportSettings,decodeIssueChange,decodeReviewIssues} from '../../../packages/domain/dist/rewards/operations.js';
const id=n=>`aa000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={userId:id(1),sessionId:id(2)};
const settings={gasAlertWei:'2000000000000000000',supportWallet:'0x'+'12'.repeat(20),supportLimitWei:'5000000000000000000'};
function fixture(){let revision=0,allowed=true,writes=0,current={gasAlertWei:null,supportWallet:null,supportLimitWei:'0'},history=[];return {
 rpc:async(name,args)=>{assert.equal(name,'service_reward_support_settings');assert.equal(args.p_actor_user_id,identity.userId);assert.equal(args.p_actor_session_id,identity.sessionId);if(!allowed)return {data:null,error:{message:'reward_master_admin_required'}};const c=args.p_change;if(c){if(c.expectedRevision!==revision)return {data:null,error:{message:'reward_support_settings_conflict'}};revision++;writes++;current=c.settings;history.unshift({revision,settings:current,reason:c.reason,changedBy:identity.userId,changedAt:new Date().toISOString()});}return {error:null,data:{revision,settings:current,history}};},revoke:()=>allowed=false,get writes(){return writes;}};}
test('support review is read-only and save binds exact candidate/revision with independent audit',async()=>{
 const f=fixture(),review=await changeSupportSettings(identity,{action:'review',expectedRevision:0,settings},f.rpc);assert.equal(f.writes,0);
 const save={action:'save',expectedRevision:0,settings,requestId:id(3),reviewFingerprint:review.fingerprint,reason:'A deliberate support policy change'};
 await assert.rejects(()=>changeSupportSettings(identity,{...save,settings:{...settings,supportLimitWei:'1'}},f.rpc),/review_required/);
 assert.equal(f.writes,0);const result=await changeSupportSettings(identity,save,f.rpc);assert.equal(result.revision,1);assert.equal(f.writes,1);
 await assert.rejects(()=>changeSupportSettings(identity,{action:'review',expectedRevision:0,settings},f.rpc),/conflict/);
});
test('gas warnings use integer balances and recheck authority after chain I/O',async()=>{
 const f=fixture();await changeSupportSettings(identity,{action:'save',expectedRevision:0,settings,requestId:id(4),reviewFingerprint:supportFingerprint(0,settings),reason:'Synthetic threshold check'},f.rpc);
 const gas=balanceWei=>async()=>({address:settings.supportWallet,balanceWei});
 assert.equal((await readSupportSettings(identity,f.rpc,gas('1999999999999999999'))).gas.low,true);
 assert.equal((await readSupportSettings(identity,f.rpc,gas('2000000000000000000'))).gas.low,false);
 assert.equal((await readSupportSettings(identity,f.rpc,async()=>{throw Error('offline');})).gas,null);
 await assert.rejects(()=>readSupportSettings(identity,f.rpc,async()=>{f.revoke();return null;}),/master_admin_required/);
});
test('invalid money, null wallet with budget, injected keys and malformed issue commands fail closed',()=>{
 for(const patch of [{gasAlertWei:'1.1'},{supportLimitWei:'-1'},{supportWallet:null},{supportWallet:'0x'+'0'.repeat(40)},{extra:true}])assert.throws(()=>decodeSupportSettings({...settings,...patch}));
 const report={action:'report',requestId:id(5),expectedRevision:0,contextHash:'a'.repeat(64),description:'Synthetic issue details'};
 assert.equal(decodeIssueChange(report).description,report.description);
 for(const patch of [{description:'short'},{contextHash:'bad'},{expectedRevision:-1},{extra:true},{requestId:'00000000-0000-0000-0000-000000000000'}])assert.throws(()=>decodeIssueChange({...report,...patch}));
 assert.throws(()=>decodeReviewIssues({revision:0,contextHash:'a'.repeat(64),canReport:true,issues:[{id:id(5),createdBy:id(1),description:'Synthetic',createdAt:new Date().toISOString(),withdrawnAt:new Date().toISOString(),canWithdraw:true}]}));
});
test('private endpoints reject foreign origin, anonymous, unauthorized and wrong-chain admin calls',async()=>{
 const f=fixture();let result,reads=0;
 const deps={config:()=>({chainId:10143,origin:'http://127.0.0.1:3102'}),rpc:f.rpc,requireIdentity:async()=>identity,readJsonBody:async()=>({action:'review',expectedRevision:0,settings}),readGas:async()=>{reads++;return null;},applyPrivateSessionHeaders(){},sendSuccess:(_r,data)=>result={status:200,data},sendError:(_r,status,code)=>result={status,code}};
 const url=new URL('http://127.0.0.1:3102/api/v1/rewards/admin/support'),res={setHeader(){}};
 await dispatchRewardOperations({method:'POST',headers:{origin:'https://foreign.invalid'}},res,url,deps);assert.equal(result.status,403);
 await dispatchRewardOperations({method:'GET',headers:{}},res,url,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(result.status,401);
 f.revoke();await dispatchRewardOperations({method:'GET',headers:{}},res,url,deps);assert.equal(result.status,403);assert.equal(reads,0);
 await dispatchRewardOperations({method:'GET',headers:{}},res,url,{...deps,config:()=>({chainId:31337,origin:'http://127.0.0.1:3101'})});assert.equal(result.status,503);assert.equal(f.writes,0);
});
test('hosted support route uses the bounded transport and rechecks master access after gas reads',async()=>{
 const patch={SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1'};
 const previous=Object.fromEntries(Object.keys(patch).map(k=>[k,process.env[k]]));Object.assign(process.env,patch);
 try{
  let allowed=true,calls=0,gasReads=0,output;
  const rpc=async(name,args)=>{calls++;assert.equal(name,'service_reward_demo_copy_support_settings');assert.equal(args.p_actor_user_id,identity.userId);assert.equal(args.p_actor_session_id,identity.sessionId);
   return allowed?{data:{revision:0,settings:{gasAlertWei:null,supportWallet:null,supportLimitWei:'0'},history:[]},error:null}:{data:null,error:{message:'reward_master_admin_required'}};};
  const deps={config:()=>({chainId:10143,origin:'https://podium.raceson.com'}),rpc,requireIdentity:async()=>identity,
   readGas:async()=>{gasReads++;allowed=false;return {address:settings.supportWallet,balanceWei:'0'};},
   applyPrivateSessionHeaders(){},sendSuccess:(_r,data)=>output={status:200,data},sendError:(_r,status,code)=>output={status,code}};
  const req={method:'GET',headers:{}},res={setHeader(){}},url=new URL('https://podium.raceson.com/api/v1/rewards/admin/support');
  await dispatchRewardOperations(req,res,url,deps);assert.equal(output.status,403);assert.equal(calls,2);assert.equal(gasReads,1);
  calls=0;gasReads=0;await dispatchRewardOperations(req,res,url,deps);assert.equal(output.status,403);assert.equal(calls,1);assert.equal(gasReads,0);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
