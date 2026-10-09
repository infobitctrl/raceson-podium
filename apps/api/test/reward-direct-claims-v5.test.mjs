import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchDirectClaimsV5} from '../dist/routes/rewards/direct-claims-v5.js';
import {directIdentityIssuerFromEnv} from '../dist/features/rewards/direct-claims-privy.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
const origin='https://podium.raceson.com',id='72000000-0000-4000-8000-000000000001',hash='0x'+'ab'.repeat(32);
const path=`/api/v1/athlete/rewards/direct-claims/${id}/${hash}`;
const env={APP_BASE_URL:origin,API_CORS_ORIGIN:origin,SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',RACESON_REWARD_PORTAL_MODE:'testnet',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1',RACESON_REWARD_DEMO_ORIGIN:origin,RACESON_REWARD_DEMO_SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co'};
test('hosted filter allows only exact bounded direct claim paths in the operations mode',()=>{
 const allowed=(method,p=path,operations=true,mode='sponsor-drafts-v1')=>hostedCopyRequestAllowed(method,new URL(p,origin),mode,operations);
 assert(allowed('GET'));assert(allowed('POST'));
 for(const p of [path+'?actor=foreign',path+'/extra',path.replace(hash,'wrong'),'/api/v1/athlete/rewards/direct-claims'])assert(!allowed('GET',p));
 for(const method of ['PATCH','PUT','DELETE'])assert(!allowed(method));
 assert(!allowed('POST',path,false));assert(!allowed('POST',path,true,'preview-v1'));
});
test('direct claim endpoint captures authenticated identity and rejects extra authority or value before chain/provider work',async()=>{
 const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 try{
  let body,response,calls=0,signs=0;
  const deps={config:()=>({chainId:10143,origin}),sponsorReader:{},identityIssuer:{address:'0x'+'12'.repeat(20),sign(){signs++;throw Error('unexpected');}},
   applyPrivateSessionHeaders(){},requireIdentity:async()=>({userId:id,sessionId:id}),readJsonBody:async()=>body,
   rpc:async(_name,args)=>{calls++;assert.equal(args.p_user_id,id);return{data:null,error:{message:'reward_claim_scope_required'}};},
   sendSuccess(_r,data){response={status:200,data};},sendError(_r,status,code){response={status,code};}};
  for(const patch of [{action:'request'},{action:'prepare',proofId:id,amountWei:'100'},{action:'prepare',proofId:id,userId:id},{action:'receipt',hash,reviewer:true}]){
   body=patch;await dispatchDirectClaimsV5({method:'POST'},{},new URL(path,origin),deps);assert.equal(response.status,400);
  }
  assert.equal(calls,0);
  await dispatchDirectClaimsV5({method:'GET'},{},new URL(path,origin),{...deps,requireIdentity:async()=>{throw Error('Unauthorized');}});assert.equal(response.status,401);assert.equal(calls,0);
  await dispatchDirectClaimsV5({method:'POST'},{},new URL(path,origin),{...deps,requireIdentity:async()=>{throw Error('Untrusted browser origin');}});assert.equal(response.status,403);assert.equal(calls,0);
  for(const command of [undefined,{action:'prepare',proofId:id},{action:'receipt',hash}]){
   body=command;await dispatchDirectClaimsV5({method:command?'POST':'GET'},{},new URL(path,origin),deps);assert.equal(response.status,404);
  }
  assert.equal(calls,3);assert.equal(signs,0);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('platform binding issuer is absent unless separately and exactly configured',()=>{
 assert.equal(directIdentityIssuerFromEnv({}),null);
 assert.equal(directIdentityIssuerFromEnv({RACESON_REWARD_IDENTITY_ISSUER_V1:'{}',RACESON_REWARD_IDENTITY_APP_SECRET:'synthetic'}),null);
 const c={version:1,appId:'synthetic-app',walletId:'synthetic-wallet',address:'0x'+'12'.repeat(20),registry:'0x'+'34'.repeat(20)};
 const e={RACESON_REWARD_IDENTITY_ISSUER_V1:JSON.stringify(c),RACESON_REWARD_IDENTITY_APP_SECRET:'synthetic',RACESON_REWARD_PRIVY_APP_ID:c.appId};
 assert(directIdentityIssuerFromEnv(e));
 assert.equal(directIdentityIssuerFromEnv({...e,RACESON_REWARD_PRIVY_APP_ID:'other'}),null);
 assert.equal(directIdentityIssuerFromEnv({...e,RACESON_REWARD_IDENTITY_ISSUER_V1:JSON.stringify({...c,extra:true})}),null);
});

test('club direct route is bounded to an owned creation and rejects unscoped signatures or authority fields',async()=>{
 const p=`/api/v1/club/rewards/direct-claims/${id}/${hash}/${id}`;
 for(const method of ['GET','POST'])assert(hostedCopyRequestAllowed(method,new URL(p,origin),'sponsor-drafts-v1',true));
 for(const path of [p+'?user=other',p+'/extra',p.replace(hash,'bad')])assert(!hostedCopyRequestAllowed('GET',new URL(path,origin),'sponsor-drafts-v1',true));
 const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 try{
  let response,calls=0;const deps={config:()=>({chainId:10143,origin}),sponsorReader:{getStorageAt:async()=>{}},identityIssuer:null,applyPrivateSessionHeaders(){},
   requireIdentity:async()=>({userId:id,sessionId:id}),readJsonBody:async()=>({action:'prepare',proofId:id,owners:['forged']}),
   rpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_demo_copy_club_direct_claim_v5');assert.equal(args.p_creation_id,id);return{data:null,error:{message:'reward_club_owner_required'}};},
   sendSuccess(){assert.fail('foreign club claim');},sendError(_r,status,code){response={status,code};}};
  await dispatchDirectClaimsV5({method:'POST'},{},new URL(p,origin),deps);assert.equal(response.status,400);assert.equal(calls,0);
  await dispatchDirectClaimsV5({method:'GET'},{},new URL(p,origin),deps);assert.equal(response.status,404);assert.equal(calls,2);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('owner discovery is a bounded private GET and signature bodies cannot supply treasury authority',async()=>{
 const list='/api/v1/club/rewards/owner-awards';
 assert(hostedCopyRequestAllowed('GET',new URL(list,origin),'sponsor-drafts-v1',true));
 for(const suffix of ['?userId=foreign','?after=a&after=b'])assert(!hostedCopyRequestAllowed('GET',new URL(list+suffix,origin),'sponsor-drafts-v1',true));
 assert(!hostedCopyRequestAllowed('POST',new URL(list,origin),'sponsor-drafts-v1',true));
 const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 try{
  let response,calls=0,body;
  const deps={config:()=>({chainId:10143,origin}),sponsorReader:{getStorageAt(){}},identityIssuer:null,applyPrivateSessionHeaders(){},requireIdentity:async()=>({userId:id,sessionId:id}),readJsonBody:async()=>body,
   rpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_club_owner_awards');assert.equal(args.p_user_id,id);return{data:{items:[],nextCursor:null},error:null};},sendSuccess(_res,data){response={status:200,data};},sendError(_res,status,code){response={status,code};}};
  await dispatchDirectClaimsV5({method:'GET'},{},new URL(list,origin),deps);assert.equal(response.status,200);assert.equal(calls,1);
  for(const extra of [{owners:['0x'+'12'.repeat(20)]},{address:'0x'+'12'.repeat(20)},{body:{amountWei:'1'}},{userId:id}]){
   body={action:'sign',requestId:id,signature:'0x'+'12'.repeat(65),...extra};
   await dispatchDirectClaimsV5({method:'POST'},{},new URL(`/api/v1/club/rewards/direct-claims/${id}/${hash}/${id}`,origin),deps);assert.equal(response.status,400);assert.equal(calls,1);
  }
 }finally{for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
