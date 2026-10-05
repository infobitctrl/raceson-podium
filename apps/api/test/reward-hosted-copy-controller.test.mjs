import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {hostedCopyControllerRpc} from '../../../packages/db/dist/rewards/hosted-copy-controller.js';
import {dispatchRewardController} from '../dist/routes/rewards/controller.js';
import {hostedCopyRequestAllowed} from '../dist/features/rewards/hosted-copy-preview.js';
import {resolveControllerPolicy} from '../dist/features/rewards/wallet-administration.js';
const wallet=n=>'0x'+String(n).repeat(40),id=n=>`7c000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pair=await generateKeyPair('ES256'),policy={appId:'cmtx921we00fu0cifaab7exez',verificationKey:await exportSPKI(pair.publicKey),subject:'did:privy:synthetic_native_controller',wallet:wallet(2)};
const token=()=>new SignJWT({sid:'disposable'}).setProtectedHeader({alg:'ES256'}).setIssuer('privy.io').setAudience(policy.appId).setSubject(policy.subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
test('native copied-controller transport binds the verified DID/operator and fixed methods/chain',async()=>{
 const actor={subject:policy.subject,wallet:policy.wallet},calls=[],rpc=hostedCopyControllerRpc(actor,async(n,a)=>{calls.push([n,a]);return{data:[],error:null};});
 const args={p_operator:actor.wallet,p_subject:actor.subject,p_chain_id:10143,p_setup_id:null,p_approval_id:null,p_request_id:null,p_receipt:null};
 await rpc('service_reward_controller_v4',args);assert.equal(calls[0][0],'service_reward_demo_copy_controller');assert.equal('p_chain_id' in calls[0][1],false);
 for(const patch of [{p_operator:wallet(3)},{p_subject:'did:privy:foreign'},{p_chain_id:1},{p_actor_user_id:id(1)},{p_factory:'arbitrary'}])await assert.rejects(()=>rpc('service_reward_controller_v4',{...args,...patch}),/scope_required/);
 const j={p_subject:actor.subject,p_sender:actor.wallet,p_action:'read',p_id:null,p_context:null,p_transaction:null,p_signed:null,p_hash:null};
 await rpc('service_reward_controller_transaction',j);assert.equal(calls[1][0],'service_reward_demo_copy_controller_transaction');
 for(const patch of [{p_sender:wallet(3)},{p_subject:'did:privy:foreign'},{p_private_key:'forbidden'},{p_chain_id:1}])await assert.rejects(()=>rpc('service_reward_controller_transaction',{...j,...patch}),/scope_required/);
 await assert.rejects(()=>rpc('service_reward_controller_result_display',args));assert.equal(calls.length,2);
});
test('controller route resolves a copied transport only after native JWT verification and never falls back',async()=>{
 const access=await token();let calls=0,resolved=0,response;
 const deps={config:()=>({chainId:10143,origin:'https://podium.raceson.com'}),requireToken:async()=>access,controllerPolicy:()=>policy,applyPrivateSessionHeaders(){},sendSuccess(_r,data){response={status:200,data};},sendError(_r,status,code){response={status,code};},rpc:async()=>{assert.fail('Generic RPC fallback');},
  resolveRpc:actor=>{resolved++;assert.deepEqual(actor,{subject:policy.subject,sessionId:'disposable',wallet:policy.wallet});return hostedCopyControllerRpc(actor,async(n,a)=>{calls++;assert.equal(n,'service_reward_demo_copy_controller');assert.equal(a.p_subject,policy.subject);return {data:[],error:null};});}};
 const request=d=>dispatchRewardController({method:'GET',headers:{}},{setHeader(){}},new URL('https://podium.raceson.com/api/v1/rewards/control/campaigns'),d);
 await request({...deps,requireToken:async()=>'ordinary-auth-or-forged'});assert.equal(response.status,401);assert.equal(resolved,0);
 await request(deps);assert.equal(response.status,200);assert.equal(calls,1);assert.equal(resolved,1);
 await request({...deps,resolveRpc:()=>{throw Error('controller_scope_required');}});assert.notEqual(response.status,200);assert.equal(calls,1);
});
test('hosted gate opens only exact native-controller paths and supported methods without URL authority',()=>{
 const root='https://podium.raceson.com/api/v1/rewards/control';
 for(const [path,methods]of [['/access',['GET']],['/session',['GET']],['/transactions',['GET','POST']],['/campaigns',['GET']],[`/campaigns/${id(1)}`,['GET','POST']],[`/campaigns/${id(1)}/allocations/${id(2)}`,['GET','POST']]]){
  const url=new URL(root+path);for(const method of ['GET','POST','DELETE','PATCH'])assert.equal(hostedCopyRequestAllowed(method,url,'sponsor-drafts-v1',true),methods.includes(method));
  assert.equal(hostedCopyRequestAllowed('GET',url,'sponsor-drafts-v1',false),false);url.search='?operator=browser';assert.equal(hostedCopyRequestAllowed('GET',url,'sponsor-drafts-v1',true),false);
 }
 for(const path of ['/factory','/campaigns/all','/transactions/'+id(1),'/session/'+id(1)])assert.equal(hostedCopyRequestAllowed('GET',new URL(root+path),'sponsor-drafts-v1',true),false);
});
test('hosted policy excludes revision zero and local baseline but retains reviewed contract operators',async()=>{
 const baseline={...policy,wallet:wallet(1)},deployment={version:1,appId:policy.appId,walletId:'gas-baseline',address:wallet(1),ownerId:'owner',signerId:'signer',policyId:'policy',factory:wallet(4)};
 const env={RACESON_REWARD_PRIVY_APP_ID:policy.appId,RACESON_REWARD_CONTROLLER:JSON.stringify(baseline),RACESON_CONTROLLER_DEPLOYMENT:JSON.stringify(deployment),RACESON_REWARD_PORTAL_MODE:'testnet',SUPABASE_URL:'https://niklhlmljiikwbkrmapw.supabase.co',RACESON_REWARD_HOSTED_COPY_MODE:'sponsor-drafts-v1',RACESON_REWARD_HOSTED_OPERATIONS:'testnet-v1'};
 let revision=0,settings=null,controllers=[];const rpc=async(n,a)=>{assert.equal(n,'service_reward_demo_copy_wallet_operation');assert.equal(a.p_operation,'runtime');return{data:{revision,settings,controllers,deployments:[]},error:null};};
 const jwt=await token();assert.equal(await resolveControllerPolicy(env,jwt,undefined,rpc),null);
 revision=1;settings={deployment:{...deployment,address:wallet(4),walletId:'gas-dedicated'},controller:{subject:policy.subject,wallet:wallet(2)}};
 assert.equal((await resolveControllerPolicy(env,jwt,wallet(2),rpc)).wallet,wallet(2));
 await assert.rejects(()=>resolveControllerPolicy(env,jwt,wallet(1),rpc),/auth_required/);
 controllers=[{subject:policy.subject,wallet:wallet(3)}];assert.equal((await resolveControllerPolicy(env,jwt,wallet(3),rpc)).wallet,wallet(3));
 await assert.rejects(()=>resolveControllerPolicy(env,jwt,wallet(9),rpc),/auth_required/);await assert.rejects(()=>resolveControllerPolicy(env,'forged',wallet(2),rpc),/auth_required/);
});
