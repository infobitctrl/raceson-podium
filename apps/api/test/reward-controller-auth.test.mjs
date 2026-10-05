import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportSPKI,SignJWT} from 'jose';
import {authenticateController,controllerPolicyFromEnv} from '../dist/features/rewards/controller-auth.js';
import {dispatchRewardController} from '../dist/routes/rewards/controller.js';
const pair=await generateKeyPair('ES256');
const config={appId:'cmtx921we00fu0cifaab7exez',verificationKey:await exportSPKI(pair.publicKey),subject:'did:privy:syntheticcontroller',wallet:'0x'+'11'.repeat(20)};
const token=async(overrides={})=>new SignJWT({sid:'session',...overrides}).setProtectedHeader({alg:'ES256'}).setIssuer('privy.io').setAudience(config.appId).setSubject(config.subject).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
const sign=async(payload,key=pair.privateKey)=>new SignJWT(payload).setProtectedHeader({alg:'ES256'}).sign(key);
const claims={sid:'session',sub:config.subject,iss:'privy.io',aud:config.appId,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
test('distribution access authenticates without waiting on optional deployment providers or balances',async()=>{
 let output,providerChecks=0,balanceChecks=0,policyChecks=0;
 const access=await token(),deps={config:()=>({chainId:10143,origin:'http://127.0.0.1:3102'}),controllerPolicy:()=>{policyChecks++;return config;},requireToken:async()=>access,
  creationSigner:{address:config.wallet,verifyReady:async()=>{providerChecks++;throw Error('provider unavailable');}},
  reader:{getChainId:async()=>10143,getBalance:async()=>{balanceChecks++;return 0n;}},
  applyPrivateSessionHeaders(){},sendSuccess:(_r,data)=>output={status:200,data},sendError:(_r,status,code)=>output={status,code}};
 const read=path=>dispatchRewardController({method:'GET',headers:{}},{setHeader(){}},new URL(`http://127.0.0.1:3102/api/v1/rewards/control/${path}`),deps);
 await read('access');assert.equal(output.status,200);assert.equal(output.data.wallet,config.wallet);assert.equal(output.data.creation,undefined);
 assert.equal(providerChecks,0);assert.equal(balanceChecks,0);assert.equal(policyChecks,2);
 await read('session');assert.equal(providerChecks,1);assert.equal(balanceChecks,1);assert.equal(output.data.creation.configured,false);
 deps.requireToken=async()=>'invalid';await read('access');assert.equal(output.status,401);
});
test('Privy controller token requires issuer, app, signature, expiry, session and designated subject',async()=>{
 assert.deepEqual(await authenticateController(await token(),config),{subject:config.subject,sessionId:'session',wallet:config.wallet});
 for(const change of [{iss:'supabase'},{aud:'another-app'},{sub:'did:privy:another'},{sid:null},{iat:claims.iat-7200,exp:claims.iat+3600},{exp:claims.iat-60}])await assert.rejects(()=>sign({...claims,...change}).then(t=>authenticateController(t,config)),/controller_auth_required/);
 const foreign=await generateKeyPair('ES256');await assert.rejects(()=>sign(claims,foreign.privateKey).then(t=>authenticateController(t,config)),/controller_auth_required/);
 await assert.rejects(()=>authenticateController('unsigned',config),/controller_auth_required/);
});
test('controller configuration fails closed and binds the same explicit isolated Privy app',()=>{
 assert.equal(controllerPolicyFromEnv({}),null);
 assert.deepEqual(controllerPolicyFromEnv({RACESON_REWARD_PRIVY_APP_ID:config.appId,RACESON_REWARD_CONTROLLER:JSON.stringify(config)}),config);
 assert.throws(()=>controllerPolicyFromEnv({RACESON_REWARD_PRIVY_APP_ID:'different',RACESON_REWARD_CONTROLLER:JSON.stringify(config)}));
 assert.throws(()=>controllerPolicyFromEnv({RACESON_REWARD_PRIVY_APP_ID:config.appId,RACESON_REWARD_CONTROLLER:JSON.stringify({...config,wallet:'0x'+'00'.repeat(20)})}));
});
test('pinned Privy rotation keys select the token key ID and reject unknown or ambiguous keys',async()=>{
 const second=await generateKeyPair('ES256');
 const {verificationKey,...identity}=config;
 const rotated={...identity,verificationKeys:[{kid:'first',key:verificationKey},{kid:'second',key:await exportSPKI(second.publicKey)}]};
 const env=value=>({RACESON_REWARD_PRIVY_APP_ID:config.appId,RACESON_REWARD_CONTROLLER:JSON.stringify(value)});
 assert.deepEqual(controllerPolicyFromEnv(env(rotated)),rotated);
 for(const [kid,key] of [['first',pair.privateKey],['second',second.privateKey]]){
  const jwt=await new SignJWT(claims).setProtectedHeader({alg:'ES256',kid}).sign(key);
  assert.equal((await authenticateController(jwt,rotated)).subject,config.subject);
 }
 for(const [kid,key] of [['unknown',pair.privateKey],['second',pair.privateKey]]){
  const jwt=await new SignJWT(claims).setProtectedHeader({alg:'ES256',kid}).sign(key);
  await assert.rejects(()=>authenticateController(jwt,rotated),/controller_auth_required/);
 }
 await assert.rejects(()=>token().then(jwt=>authenticateController(jwt,rotated)),/controller_auth_required/);
 assert.throws(()=>controllerPolicyFromEnv(env({...rotated,verificationKey})));
 assert.throws(()=>controllerPolicyFromEnv(env({...rotated,verificationKeys:[rotated.verificationKeys[0],rotated.verificationKeys[0]]})));
 assert.throws(()=>controllerPolicyFromEnv(env({...rotated,verificationKeys:[]})));
});
test('controller endpoints use only Privy identity and deny foreign tokens, origins, scopes and extra body authority',async()=>{
 let output,calls=0,body;const access=await token();
 const deps={config:()=>({chainId:10143,origin:'http://127.0.0.1:3102'}),controllerPolicy:()=>config,requireToken:async()=>access,
  requireIdentity:()=>{throw Error('Must never authenticate via Supabase');},rpc:async(name,args)=>{calls++;assert.equal(name,'service_reward_controller_v4');assert.equal(args.p_subject,config.subject);assert.equal(args.p_operator,config.wallet);assert.equal('p_actor_user_id' in args,false);return{data:[],error:null};},
  applyPrivateSessionHeaders(){},sendSuccess:(_r,data)=>output={status:200,data},sendError:(_r,status,code)=>output={status,code},readJsonBody:async()=>body};
 const request=async(path='/campaigns',extra={},method='GET')=>dispatchRewardController({method,headers:{}},{setHeader(){}},new URL(`http://127.0.0.1:3102/api/v1/rewards/control${path}`),{...deps,...extra});
 await request('/session');assert.equal(output.data.subject,config.subject);assert.equal(calls,0);
 await request();assert.equal(output.status,200);assert.equal(calls,1);
 await request('',{controllerPolicy:()=>null});assert.equal(output.status,503);
 await request('/campaigns',{requireToken:async()=>await sign({...claims,sub:'did:privy:other'})});assert.equal(output.status,401);
 await dispatchRewardController({method:'GET',headers:{origin:'https://evil.example'}},{},new URL('http://local/api/v1/rewards/control/session'),deps);assert.equal(output.status,403);
 body={requestId:'ad000000-0000-4000-8000-000000000001',transactionHash:'0x'+'aa'.repeat(32),operation:'deployment',start:0,end:0,operator:config.wallet};
 await request('/campaigns/ad000000-0000-4000-8000-000000000001',{},'POST');assert.equal(output.status,400);assert.equal(calls,1);
 await request('/campaigns?subject=fake');assert.equal(output.status,400);
 await request('/campaigns',{config:()=>({chainId:1})});assert.equal(output.status,503);
});

test('preparation returns an explicit gas-limit conflict before any journal or signing write',async()=>{
 let output;const access=await token();
 const deps={config:()=>({chainId:10143,origin:'http://127.0.0.1:3102'}),controllerPolicy:()=>config,requireToken:async()=>access,
  reader:{getChainId:async()=>10143},rpc:async(name,args)=>{assert.equal(name,'service_reward_controller_transaction');assert.equal(args.p_action,'read');return {error:null,data:{
   id:'73000000-0000-4000-8000-000000000003',subject:config.subject,sender:config.wallet,
   context:{kind:'distribution',setupId:'73000000-0000-4000-8000-000000000001',approvalId:'73000000-0000-4000-8000-000000000002',action:'upload',start:0,end:58,source:'fixture'},
   transaction:{chainId:10143,to:'0x'+'44'.repeat(20),data:'0xaa',value:'0',nonce:'0',gas:'7326567',gasPrice:'102000000000'},signedTransaction:null,hash:null,confirmed:false}};},
  applyPrivateSessionHeaders(){},sendSuccess:()=>assert.fail('over-limit transaction must not be offered'),sendError:(_r,status,code)=>output={status,code},
  readJsonBody:async()=>({action:'prepare',kind:'distribution',setupId:'73000000-0000-4000-8000-000000000001',approvalId:'73000000-0000-4000-8000-000000000002'})};
 await dispatchRewardController({method:'POST',headers:{}},{setHeader(){}},new URL('http://127.0.0.1:3102/api/v1/rewards/control/transactions'),deps);
 assert.deepEqual(output,{status:409,code:'controller_gas_limit'});
});
