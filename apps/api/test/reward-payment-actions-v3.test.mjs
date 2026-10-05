import { fileURLToPath } from "node:url";
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {paymentActionRequestV3} from '../dist/features/rewards/athlete-payment-actions-v3.js';
import {signPaymentV3} from '../dist/features/rewards/athlete-payment-signing-v3.js';
import {dispatchPaymentActionsV3} from '../dist/routes/rewards/athlete-payment-actions-v3.js';
import {createPaymentSigningClientV3,rewardPaymentSigningFetchV3} from '../../../packages/db/dist/rewards/index.js';
import {programmeOperatorAuthFixtureV3} from './fixtures/reward-programme-operator-v3.mjs';
import {normalizePaymentSigningConfigV3,approvedSigningPlanV3,paymentSigningChainFetchV3} from '../../../demo/rewards/scripts/payout-signing-v3.mjs';
import {DEMO_SUPABASE_ORGANIZATION,DEMO_VERCEL_TEAM,validateDemoReleaseManifest} from '../../../demo/rewards/scripts/release-manifest.mjs';
const id=n=>`8f700000-0000-4000-8000-${String(n).padStart(12,'0')}`,address=n=>'0x'+n.repeat(40),hash=n=>'0x'+n.repeat(64);
const identity={userId:id(1),sessionId:id(2)},scope={chainId:31337,uploadId:id(3),destinationId:id(4),entitlementId:hash('a'),claimId:id(5),paymentId:id(6)};
const fees={gasLimit:'500000',maxFeePerGas:'30000000000',maxPriorityFeePerGas:'0',maxGasCostWei:'15000000000000000'};
const prepare=()=>({kind:'prepare',recipientAddress:address('b'),amountWei:'123',relayerAddress:address('c'),fees});
test('payment HTTP accepts only strict prepare/queue requests, never signatures, broadcasts or private keys',()=>{
  assert.deepEqual(paymentActionRequestV3.parse(prepare()),prepare());
  assert.equal(paymentActionRequestV3.parse({kind:'queue',jobId:id(7),attemptId:id(8),transactionHash:hash('d')}).kind,'queue');
  for(const patch of [{kind:'sign'},{kind:'send'},{signedTransaction:'never'},{privateKey:'never'},{chainId:143},{amountWei:123},{recipientAddress:'bad'},
    {fees:{...fees,gasLimit:'0'}},{fees:{...fees,gasLimit:500000}},{fees:{...fees,secret:'never'}}])
    assert.throws(()=>paymentActionRequestV3.parse({...prepare(),...patch}));
});
test('payment actions route requires current identity and exact scope; it minimizes all failures',async()=>{
  const run=async({method='GET',role='organizer',query='',body,authError,rpcError,disabled=false}={})=>{
    const res={},calls=[];
    const handled=await dispatchPaymentActionsV3({method},res,new URL(`http://127.0.0.1:3101/api/v1/${role}/rewards/uploads/${scope.uploadId}/destinations/${scope.destinationId}/awards/${scope.entitlementId}/claims/${scope.claimId}/payment-actions/${scope.paymentId}${query}`),{
      config:()=>disabled?null:{chainId:31337,origin:'http://127.0.0.1:3101'},requireIdentity:async()=>{if(authError)throw Error(authError);return identity;},
      applyPrivateSessionHeaders:()=>res.private=true,readJsonBody:async()=>body,
      rpc:async(name,args)=>{calls.push({name,args});return{data:null,error:{message:rpcError??'private-credential-sentinel'}};},
      sendSuccess:(_,data)=>Object.assign(res,{status:200,data}),sendError:(_,status,code)=>Object.assign(res,{status,code}),
    });return{res,calls,handled};
  };
  for(const authError of ['Unauthorized','Missing bearer token','reward_account_session_required']){
    const r=await run({authError});assert.equal(r.res.status,401);assert.equal(r.calls.length,0);assert.equal(r.res.private,true);}
  assert.equal((await run({authError:'Untrusted browser origin'})).res.status,403);
  assert.equal((await run({query:'?chainId=143'})).res.status,400);
  for(const kind of ['sign','send','arm','submitted','pay']){const r=await run({method:'POST',body:{kind}});assert.equal(r.res.status,400);assert.equal(r.calls.length,0);}
  for(const method of ['PUT','PATCH','DELETE'])assert.equal((await run({method})).handled,false);
  assert.equal((await run({role:'athlete'})).handled,false);assert.equal((await run({disabled:true})).calls.length,0);
  for(const rpcError of ['reward_readiness_scope_required','reward_claim_scope_required','reward_payment_scope_required'])assert.equal((await run({rpcError})).res.status,404);
  const r=await run();assert.equal(r.res.status,503);assert.doesNotMatch(JSON.stringify(r.res),/private-credential/);
  assert.equal(r.calls[0].args.p_actor_session_id,identity.sessionId);assert.equal(r.calls[0].name,'service_read_reward_athlete_payment_v3');
});
test('cancelled signing cannot read the ledger, access a key or sign',async()=>{
  const c=new AbortController();c.abort();
  await assert.rejects(signPaymentV3(identity,{...scope,attemptId:id(8),planHash:hash('b')},
    {chainId:31337,origin:'http://127.0.0.1:3101',reader:{},signal:c.signal,rpc:()=>assert.fail('no ledger'),loadSigner:()=>assert.fail('no key')}),/reward_payment_signing_stopped/);
});
test('signing client verifies SDK Auth and can only read/store an attempt, never reserve, queue or deliver',async()=>{
  const seen=[],auth=programmeOperatorAuthFixtureV3(identity,async(name,args)=>{seen.push({name,args});return{data:null,error:null};},createPaymentSigningClientV3);
  const c=new AbortController(),client=auth.clientFactory({target:auth.target,...auth.credentials,signal:c.signal});
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337};
  await assert.rejects(client.rpc('service_read_reward_athlete_payment_v3',args),/reward_operator_auth_required/);
  await client.authenticate(auth.credentials.accessToken,identity.userId);
  await client.rpc('service_read_reward_athlete_payment_v3',args);
  await client.rpc('service_change_reward_athlete_payment_v3',{...args,p_action:'attempt'});
  for(const p_action of ['prepare','queue','lease','arm','submitted','confirm',null])
    await assert.rejects(client.rpc('service_change_reward_athlete_payment_v3',{...args,p_action}),/reward_operator_auth_required/);
  for(const patch of [{p_actor_user_id:id(99)},{p_actor_session_id:id(99)},{p_chain_id:10143},{p_chain_id:143}])
    await assert.rejects(client.rpc('service_read_reward_athlete_payment_v3',{...args,...patch}),/reward_operator_auth_required/);
  assert.equal(seen.length,2);c.abort();await assert.rejects(client.rpc('service_read_reward_athlete_payment_v3',args));
});
test('signing transport denies disallowed actions, streams, large requests, production and foreign RPCs before IO',async()=>{
  const auth=programmeOperatorAuthFixtureV3(identity,()=>assert.fail('no SQL'));
  const fetch=rewardPaymentSigningFetchV3(auth.target,new AbortController().signal,()=>assert.fail('no IO'));
  const url=auth.target.supabaseUrl+'/rest/v1/rpc/service_change_reward_athlete_payment_v3';
  for(const p_action of ['prepare','queue','arm','submitted','confirm'])await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({p_action})}));
  await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({p_action:'attempt',data:'x'.repeat(128*1024)})}));
  await assert.rejects(fetch(new Request(url,{method:'POST',body:new ReadableStream({start(){}}),duplex:'half'})));
  await assert.rejects(fetch('https://icdtinbmtvzhswrrzjxq.supabase.co/rest/v1/rpc/service_read_reward_athlete_payment_v3',{method:'POST'}));
  await assert.rejects(fetch(auth.target.supabaseUrl+'/rest/v1/rpc/service_reward_operator_session_call',{method:'POST'}));
});
test('signing chain transport refuses broadcasting independently of the signing service',async()=>{
  const fetch=paymentSigningChainFetchV3(new AbortController().signal,()=>assert.fail('no IO'));
  const url='https://testnet-rpc.monad.xyz';
  await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:['0x02']})}),/read_only/);
  await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendTransaction',params:[]})}),/chain_unavailable/);
});
const config=()=>({formatVersion:3,release:{formatVersion:1,kind:'raceson-rewards-testnet',repository:'infobitctrl/raceson-podium',sourceCommit:'a'.repeat(40),chainId:10143,
  origin:'https://rewards-demo.example.invalid',vercel:{teamId:DEMO_VERCEL_TEAM,projectId:'prj_DemoFixtureOnly',environment:'production',rootDirectory:'demo/rewards/web'},
  supabase:{organizationId:DEMO_SUPABASE_ORGANIZATION,projectRef:'abcdefghijklmnopqrst'}},...scope,chainId:undefined,
  draftId:id(9),attemptId:id(8),operatorUserId:identity.userId,programmeAddress:address('a'),operatorAddress:address('d'),relayerAddress:address('c'),recipientAddress:address('b'),
  amountWei:'123',maxGasCostWei:fees.maxGasCostWei,durationSeconds:60});
const rawConfig=()=>{const v=config();delete v.chainId;return v;};
test('signing config binds exact recipient, amount, source and isolated target without inheriting credentials',()=>{
  const normalize=v=>normalizePaymentSigningConfigV3(v,validateDemoReleaseManifest);
  const raw=rawConfig(),fixed=normalize(raw);assert.deepEqual(fixed,raw);raw.recipientAddress=address('f');assert.equal(fixed.recipientAddress,address('b'));
  for(const edit of [v=>v.privateKey='never',v=>v.relayerAddress=v.recipientAddress,v=>v.amountWei='0',v=>v.maxGasCostWei=(1n<<256n).toString(),
    v=>v.release.chainId=143,v=>v.release.supabase.projectRef='icdtinbmtvzhswrrzjxq',v=>v.release.vercel.rootDirectory='apps/web',v=>v.durationSeconds=0]){
    const v=rawConfig();edit(v);assert.throws(()=>normalize(v));}
  let touched=false;const v=rawConfig();Object.defineProperty(v,'amountWei',{get(){touched=true;return'123';}});assert.throws(()=>normalize(v));assert.equal(touched,false);
});
test('approved signing plan binds all scope fields, caps and target, and remains stable on exact retries',()=>{
  const c=normalizePaymentSigningConfigV3(rawConfig(),validateDemoReleaseManifest);
  const plan={schema:'raceson-payment-signing-plan-v3',chainId:10143,...Object.fromEntries(['uploadId','destinationId','entitlementId','claimId','paymentId','attemptId','draftId',
    'programmeAddress','operatorAddress','relayerAddress','recipientAddress','amountWei'].map(k=>[k,c[k]])),planHash:hash('a'),maxGasCostWei:c.maxGasCostWei};
  const approved=approvedSigningPlanV3(c,'b'.repeat(64),{plan,recorded:false});assert.equal(approved.planDigest.length,64);
  assert.deepEqual(approvedSigningPlanV3(c,'b'.repeat(64),{plan,recorded:true}),approved);
  for(const k of ['chainId','uploadId','destinationId','entitlementId','claimId','paymentId','attemptId','draftId','programmeAddress','operatorAddress','relayerAddress','recipientAddress','amountWei'])
    assert.throws(()=>approvedSigningPlanV3(c,'b'.repeat(64),{plan:{...plan,[k]:'different'}}));
  assert.throws(()=>approvedSigningPlanV3(c,'b'.repeat(64),{plan:{...plan,maxGasCostWei:(BigInt(c.maxGasCostWei)+1n).toString()}}));
});
test('actual signing CLI help and dirty-source refusal do not access credentials, Keychain or providers',t=>{
  const cli=fileURLToPath(new URL('../../../demo/rewards/scripts/payout-signing-v3.mjs',import.meta.url));
  const options={encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH}};
  const help=spawnSync(process.execPath,[cli,'--help'],options);assert.equal(help.status,0);assert.match(help.stdout,/no broadcast/);assert.equal(help.stderr,'');
  const dir=mkdtempSync(join(tmpdir(),'raceson-v3-payout-signing-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'non-secret-config.json');writeFileSync(path,JSON.stringify(rawConfig()));
  for(const args of [['run','--private-key','never'],['plan','--config',path],['run','--config',path,'--confirm-plan','b'.repeat(64)]]){
    const r=spawnSync(process.execPath,[cli,...args],{...options,input:'synthetic-secret-sentinel'});
    assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,'reward_payment_signing_command_failed\n');}
});
