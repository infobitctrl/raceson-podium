import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hostedCopyClubCreationStore,decodeHostedClubCreation} from '../../../packages/db/dist/rewards/index.js';
import {hostedClubCreation} from '../dist/features/rewards/hosted-club-creation-service.js';
import {rewardClubSafeTestnetDependencies as deps,rewardClubSafeCreationPlan} from '../../../packages/rewards-chain/dist/index.js';
import {originalSafeArtifacts,originalSafeFactoryArtifact} from '../../../packages/rewards-chain/test/safe-artifacts.mjs';
import {dispatchHostedCopyClubCreation} from '../dist/routes/rewards/hosted-copy-club-creation.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const id=n=>`7d100000-0000-4000-8000-${String(n).padStart(12,'0')}`,a=n=>'0x'+n.repeat(40),hash='0x'+'d'.repeat(64);
const identity={userId:id(1),sessionId:id(101)};
function record(){return{requestId:id(301),clubId:id(201),chainId:10143,sender:a('a'),owners:['1','2','3'].map(a),saltNonce:'2',createdAt:'2026-10-06T01:00:00.000Z',current:true,transactions:[],verified:null};}
function fixture(){let value=record();const calls=[];const artifacts=originalSafeArtifacts(),factory=originalSafeFactoryArtifact();
 const store={async read(){calls.push('read');return structuredClone(value);},async request(input){calls.push('request');assert.equal(input.requestId,value.requestId);return structuredClone(value);},async authorize(){calls.push('authorize');return structuredClone(value);},async submitted(_,transactionHash){calls.push('submitted');value.transactions=[{transactionHash}];return structuredClone(value);},async verified(){calls.push('verified');throw Error('receipt_not_mocked');}};
 const reader={async getChainId(){return 10143;},async getBlock(p){return{number:100n,hash:'0x'+'b'.repeat(64),timestamp:1000n};},async getCode(p){return new Map([[deps.factoryAddress,factory.deployedBytecode],[deps.singletonAddress,artifacts.singleton.deployedBytecode],[deps.fallbackHandlerAddress,artifacts.handler.deployedBytecode]]).get(p.address);},async readContract(){return artifacts.proxy.bytecode;},async estimateGas(){calls.push('estimate');return 100000n;},async getGasPrice(){return 100n;},async getBalance(){return 12000000n;}};
 const plan=rewardClubSafeCreationPlan({environment:'monad-testnet',chainId:10143,sender:value.sender,owners:value.owners,saltNonce:2n,dependencies:deps},artifacts.proxy.bytecode);
 reader.getTransaction=async()=>({chainId:10143,hash,from:value.sender,to:deps.factoryAddress,input:plan.transaction.data,value:0n});
 return{store,reader,calls,value,plan};}
test('fixed Safe intent store captures the verified actor and never accepts receipt/signing fields in a client request',async()=>{
 const calls=[],v=record(),rpc=async(name,args)=>{calls.push({name,args});return{data:v,error:null};};
 const store=hostedCopyClubCreationStore(identity,rpc);identity.userId=id(999);
 await store.request({requestId:v.requestId,clubId:v.clubId,proofId:id(401),owners:v.owners,approved:true,privateKey:'synthetic-not-a-key'});
 identity.userId=id(1);assert.equal(calls[0].name,'service_reward_demo_copy_club_creation');assert.equal(calls[0].args.p_user_id,id(1));assert.equal(calls[0].args.p_session_id,id(101));
 assert.deepEqual(Object.keys(calls[0].args.p_input).sort(),['clubId','owners','proofId','requestId']);
 await assert.rejects(store.read(id(999)),/invalid_reward_club_creation/);
});
test('Safe intent decoding rejects foreign scope, unsorted owners, fabricated receipts and oversized/invalid history pages',async()=>{
 const v=record();assert.deepEqual(decodeHostedClubCreation(v,v.requestId),v);
 for(const patch of [{chainId:143},{owners:[...v.owners].reverse()},{owners:[v.owners[0],v.owners[0],v.owners[2]]},{saltNonce:'0'},{current:'true'},{privateProof:'hidden'},
  {verified:{transactionHash:hash,safeAddress:a('e'),blockNumber:'100',blockHash:hash,initializerHash:hash}}])assert.throws(()=>decodeHostedClubCreation({...v,...patch}));
 const store=hostedCopyClubCreationStore(identity,async()=>({data:{items:[v],nextCursor:v.requestId},error:null}));await assert.rejects(store.history(null));
});
test('explicit preparation rechecks fresh proof and current ownership around the fee quote and never signs/sends',async()=>{
 const f=fixture(),v=await hostedClubCreation(f.value.requestId,{action:'prepare',proofId:id(401)},f);
 assert.equal(v.schema,'podium-club-safe-creation-v1');assert.equal(v.prepared.maximumFee,'12000000');assert.equal(v.prepared.plan.transaction.value,'0');
 assert.deepEqual(f.calls,['read','authorize','estimate','authorize']);assert.equal(f.calls.includes('submitted'),false);
 const changed=fixture();let calls=0;changed.store.authorize=async()=>({...changed.value,current:++calls===1});
 await assert.rejects(hostedClubCreation(changed.value.requestId,{action:'prepare',proofId:id(401)},changed),/reward_club_owner_required/);
 const pending=fixture();pending.value.transactions=[{transactionHash:hash}];await assert.rejects(hostedClubCreation(pending.value.requestId,{action:'prepare',proofId:id(401)},pending),/reward_club_creation_recovery_required/);assert.equal(pending.calls.includes('estimate'),false);
});
test('request identity mismatch is rejected before writing; observed hash is not a verified creation',async()=>{
 const f=fixture();await assert.rejects(hostedClubCreation(id(999),{action:'request',requestId:f.value.requestId,clubId:f.value.clubId,proofId:id(401),owners:f.value.owners},f),/invalid_reward_club_creation/);assert.deepEqual(f.calls,[]);
 const view=await hostedClubCreation(f.value.requestId,{action:'submitted',transactionHash:hash},f);assert.deepEqual(view.record.transactions,[{transactionHash:hash}]);assert.equal(view.record.verified,null);assert.equal(view.prepared,null);assert.equal(f.calls.includes('verified'),false);
});
test('wrong observed sender/value/data/chain/hash cannot record submission or reach receipt writer',async()=>{
 for(const patch of [{from:a('f')},{value:1n},{input:'0x1234'},{chainId:143},{hash:'0x'+'f'.repeat(64)}]){
  const f=fixture(),original=f.reader.getTransaction;f.reader.getTransaction=async()=>({...await original(),...patch});
  await assert.rejects(hostedClubCreation(f.value.requestId,{action:'verify',transactionHash:hash},f),/reward_club_creation_intent_mismatch/);assert.equal(f.calls.includes('submitted'),false);assert.equal(f.calls.includes('verified'),false);
 }
});
test('creation HTTP authenticates private history and refuses client authority, fee, receipt and identity fields',async()=>{
 const origin='https://podium.raceson.com',values={APP_BASE_URL:origin,API_CORS_ORIGIN:origin,SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon-key',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:origin,RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{let body,response,calls=0;const f=fixture(),deps={config:()=>({chainId:10143,origin}),applyPrivateSessionHeaders(){},requireIdentity:async()=>identity,readJsonBody:async()=>body,creationReader:f.reader,rpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_demo_copy_club_creation');assert.equal(args.p_user_id,identity.userId);return{data:{items:[],nextCursor:null},error:null};},sendSuccess(_r,data){response={status:200,data};},sendError(_r,status,code){response={status,code};}};
  const root=new URL('/api/v1/rewards/demo-copy/club-creations',origin),item=new URL(root.pathname+'/'+f.value.requestId,origin);
  await dispatchHostedCopyClubCreation({method:'GET'},{},root,{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);assert.equal(calls,0);
  const request={action:'request',requestId:f.value.requestId,clubId:f.value.clubId,proofId:id(401),owners:f.value.owners};
  for(const patch of [{userId:id(9)},{sender:a('f')},{chainId:143},{approved:true},{gas:'100'},{saltNonce:'1'},{verified:true},{privateKey:'synthetic-not-a-key'}]){body={...request,...patch};await dispatchHostedCopyClubCreation({method:'POST'},{},item,deps);assert.equal(response.status,400);}
  for(const action of ['sign','deploy','nominate','receipt']){body={action};await dispatchHostedCopyClubCreation({method:'POST'},{},item,deps);assert.equal(response.status,400);}assert.equal(calls,0);
  for(const query of ['?after=bad','?userId='+id(9),'?after='+id(1)+'&after='+id(2)]){await dispatchHostedCopyClubCreation({method:'GET'},{},new URL(root+query),deps);assert.equal(response.status,400);}assert.equal(calls,0);
  await dispatchHostedCopyClubCreation({method:'GET'},{},root,deps);assert.equal(response.status,200);assert.equal(calls,1);
  await dispatchHostedCopyClubCreation({method:'GET'},{},root,{...deps,rpc:async()=>({data:null,error:{message:'reward_club_owner_required'}})});assert.equal(response.status,403);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('creation gate exposes only bounded ordinary-session intent/read/verification routes',()=>{
 const root='/api/v1/rewards/demo-copy/club-creations',allow=(method,path,operations=true)=>hostedCopyRequestAllowed(method,new URL(path,'https://podium.raceson.com'),'sponsor-drafts-v1',operations);
 assert(allow('GET',root));assert(allow('GET',root+'?after='+id(301)));assert(!allow('POST',root));assert(!allow('GET',root,false));
 assert(allow('GET',root+'/'+id(301)));assert(allow('POST',root+'/'+id(301)));assert(!allow('DELETE',root+'/'+id(301)));
 for(const path of [root+'?userId='+id(1),root+'?after='+id(1)+'&after='+id(2),root+'/'+id(301)+'?approved=true',root+'/'+id(301)+'/deploy'])assert(!allow('GET',path));
});
