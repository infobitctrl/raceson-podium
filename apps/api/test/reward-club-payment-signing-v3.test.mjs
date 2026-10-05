import { fileURLToPath } from "node:url";
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signClubPaymentV3} from '../dist/features/rewards/club-payment-signing-v3.js';
import {createClubPaymentSigningClientV3,rewardClubPaymentSigningFetchV3} from '../../../packages/db/dist/rewards/index.js';
import {programmeOperatorAuthFixtureV3} from './fixtures/reward-programme-operator-v3.mjs';
import {normalizeClubPaymentSigningConfigV3,approvedClubSigningPlanV3,clubPaymentSigningChainFetchV3} from '../../../demo/rewards/scripts/club-payout-signing-v3.mjs';
import {rewardOperatorChainFetch,rewardClubOperatorChainFetch,REWARD_OPERATOR_RPC_URL} from '../../../demo/rewards/scripts/operator-transport.mjs';
import {DEMO_SUPABASE_ORGANIZATION,DEMO_VERCEL_TEAM,validateDemoReleaseManifest} from '../../../demo/rewards/scripts/release-manifest.mjs';
const id=n=>`8fd00000-0000-4000-8000-${String(n).padStart(12,'0')}`,address=n=>'0x'+n.repeat(40),hash=n=>'0x'+n.repeat(64);
const identity={userId:id(1),sessionId:id(2)},scope={chainId:31337,uploadId:id(3),requestId:id(4),entitlementId:hash('a'),claimId:id(5),paymentId:id(6)};
const fees={gasLimit:'500000',maxFeePerGas:'30000000000',maxPriorityFeePerGas:'0',maxGasCostWei:'15000000000000000'};
const prepare=()=>({kind:'prepare',recipientAddress:address('b'),amountWei:'123',relayerAddress:address('c'),fees});
test('club cancelled signing cannot read the ledger, access a key or sign',async()=>{
  const c=new AbortController();c.abort();
  await assert.rejects(signClubPaymentV3(identity,{...scope,attemptId:id(8),planHash:hash('b')},
    {chainId:31337,origin:'http://127.0.0.1:3101',reader:{},signal:c.signal,rpc:()=>assert.fail('no ledger'),loadSigner:()=>assert.fail('no key')}),/reward_payment_signing_stopped/);
});
test('club signing client verifies SDK Auth and can only read/store an attempt, never reserve, queue or deliver',async()=>{
  const seen=[],auth=programmeOperatorAuthFixtureV3(identity,async(name,args)=>{seen.push({name,args});return{data:null,error:null};},createClubPaymentSigningClientV3);
  const c=new AbortController(),client=auth.clientFactory({target:auth.target,...auth.credentials,signal:c.signal});
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337};
  await assert.rejects(client.rpc('service_read_reward_club_payment_v3',args),/reward_operator_auth_required/);
  await client.authenticate(auth.credentials.accessToken,identity.userId);
  await client.rpc('service_read_reward_club_payment_v3',args);
  await client.rpc('service_change_reward_club_payment_v3',{...args,p_action:'attempt'});
  for(const p_action of ['prepare','queue','lease','arm','submitted','confirm',null])
    await assert.rejects(client.rpc('service_change_reward_club_payment_v3',{...args,p_action}),/reward_operator_auth_required/);
  for(const patch of [{p_actor_user_id:id(99)},{p_actor_session_id:id(99)},{p_chain_id:10143},{p_chain_id:143}])
    await assert.rejects(client.rpc('service_read_reward_club_payment_v3',{...args,...patch}),/reward_operator_auth_required/);
  for(const name of ['service_read_reward_athlete_payment_v3','service_change_reward_athlete_payment_v3'])await assert.rejects(client.rpc(name,{...args,p_action:'attempt'}),/reward_operator_auth_required/);
  assert.equal(seen.length,2);c.abort();await assert.rejects(client.rpc('service_read_reward_club_payment_v3',args));
});
test('club signing transport denies disallowed actions, streams, large requests, production and foreign RPCs before IO',async()=>{
  const auth=programmeOperatorAuthFixtureV3(identity,()=>assert.fail('no SQL'));
  const fetch=rewardClubPaymentSigningFetchV3(auth.target,new AbortController().signal,()=>assert.fail('no IO'));
  const url=auth.target.supabaseUrl+'/rest/v1/rpc/service_change_reward_club_payment_v3';
  for(const p_action of ['prepare','queue','arm','submitted','confirm'])await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({p_action})}));
  await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({p_action:'attempt',data:'x'.repeat(128*1024)})}));
  await assert.rejects(fetch(new Request(url,{method:'POST',body:new ReadableStream({start(){}}),duplex:'half'})));
  await assert.rejects(fetch('https://icdtinbmtvzhswrrzjxq.supabase.co/rest/v1/rpc/service_read_reward_club_payment_v3',{method:'POST'}));
  await assert.rejects(fetch(auth.target.supabaseUrl+'/rest/v1/rpc/service_reward_operator_session_call',{method:'POST'}));
});
test('club signing chain transport refuses broadcasting independently of the signing service',async()=>{
  const fetch=clubPaymentSigningChainFetchV3(new AbortController().signal,()=>assert.fail('no IO'));
  const url='https://testnet-rpc.monad.xyz';
  await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:['0x02']})}),/read_only/);
  await assert.rejects(fetch(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendTransaction',params:[]})}),/chain_unavailable/);
});
test('Safe storage reads are club-only; club transports still refuse wallet RPCs, credentials and foreign destinations',async()=>{
  const signal=new AbortController().signal,url=REWARD_OPERATOR_RPC_URL;
  const body=method=>({method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})});
  let calls=0;
  const io=async(req,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    const r=Response.json({jsonrpc:'2.0',id:1,result:'0x'});Object.defineProperty(r,'url',{value:req.url});return r;};
  await assert.rejects(rewardOperatorChainFetch(signal,()=>assert.fail('no athlete storage IO'))(url,body('eth_getStorageAt')));
  for(const fetch of [rewardClubOperatorChainFetch(signal,io),clubPaymentSigningChainFetchV3(signal,io)]){
    assert.equal((await (await fetch(url,body('eth_getStorageAt'))).json()).result,'0x');
    for(const method of ['eth_sendTransaction','eth_sign','personal_sign','eth_signTypedData_v4','wallet_switchEthereumChain'])
      await assert.rejects(fetch(url,body(method)));
    for(const header of ['authorization','apikey','cookie'])await assert.rejects(fetch(url,{...body('eth_getStorageAt'),headers:{[header]:'synthetic-secret'}}));
    for(const foreign of ['https://rpc.monad.xyz','http://127.0.0.1:18546',url+'?key=synthetic'])await assert.rejects(fetch(foreign,body('eth_getStorageAt')));
  }
  assert.equal(calls,2);
});
test('club chain transport bounds stalled and oversized response bodies and honors cancellation',async()=>{
  const signal=new AbortController().signal,url=REWARD_OPERATOR_RPC_URL,init={method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getStorageAt',params:[]})};
  let cancelled=false;
  const stalled=rewardClubOperatorChainFetch(signal,async req=>{const r=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});
    Object.defineProperty(r,'url',{value:req.url});return r;},25);
  await assert.rejects(stalled(url,init),/chain_unavailable/);assert.equal(cancelled,true);
  const huge=rewardClubOperatorChainFetch(signal,async req=>{const r=Response.json({}, {headers:{'content-length':String(8*1024*1024+1)}});
    Object.defineProperty(r,'url',{value:req.url});return r;});
  await assert.rejects(huge(url,init),/chain_unavailable/);
  const abort=new AbortController();abort.abort();await assert.rejects(rewardClubOperatorChainFetch(abort.signal,()=>assert.fail('no cancelled IO'))(url,init));
});
const config=()=>({formatVersion:3,release:{formatVersion:1,kind:'raceson-rewards-testnet',repository:'infobitctrl/raceson-podium',sourceCommit:'a'.repeat(40),chainId:10143,
  origin:'https://rewards-demo.example.invalid',vercel:{teamId:DEMO_VERCEL_TEAM,projectId:'prj_DemoFixtureOnly',environment:'production',rootDirectory:'demo/rewards/web'},
  supabase:{organizationId:DEMO_SUPABASE_ORGANIZATION,projectRef:'abcdefghijklmnopqrst'}},...scope,chainId:undefined,
  draftId:id(9),attemptId:id(8),operatorUserId:identity.userId,programmeAddress:address('a'),operatorAddress:address('d'),relayerAddress:address('c'),recipientAddress:address('b'),
  amountWei:'123',maxGasCostWei:fees.maxGasCostWei,durationSeconds:60});
const rawConfig=()=>{const v=config();delete v.chainId;return v;};
test('club signing config binds exact recipient, amount, source and isolated target without inheriting credentials',()=>{
  const normalize=v=>normalizeClubPaymentSigningConfigV3(v,validateDemoReleaseManifest);
  const raw=rawConfig(),fixed=normalize(raw);assert.deepEqual(fixed,raw);raw.recipientAddress=address('f');assert.equal(fixed.recipientAddress,address('b'));
  for(const edit of [v=>v.destinationId=id(4),v=>v.privateKey='never',v=>v.relayerAddress=v.recipientAddress,v=>v.amountWei='0',v=>v.maxGasCostWei=(1n<<256n).toString(),
    v=>v.release.chainId=143,v=>v.release.supabase.projectRef='icdtinbmtvzhswrrzjxq',v=>v.release.vercel.rootDirectory='apps/web',v=>v.durationSeconds=0]){
    const v=rawConfig();edit(v);assert.throws(()=>normalize(v));}
  let touched=false;const v=rawConfig();Object.defineProperty(v,'amountWei',{get(){touched=true;return'123';}});assert.throws(()=>normalize(v));assert.equal(touched,false);
});
test('club approved signing plan binds all scope fields, caps and target, and remains stable on exact retries',()=>{
  const c=normalizeClubPaymentSigningConfigV3(rawConfig(),validateDemoReleaseManifest);
  const plan={schema:'raceson-club-payment-signing-plan-v3',chainId:10143,...Object.fromEntries(['uploadId','requestId','entitlementId','claimId','paymentId','attemptId','draftId',
    'programmeAddress','operatorAddress','relayerAddress','recipientAddress','amountWei'].map(k=>[k,c[k]])),planHash:hash('a'),maxGasCostWei:c.maxGasCostWei,
    treasuryReviewId:id(20),safeExecutionNonce:'0',wrappedRecipientDigest:hash('e'),consentCheckpoint:{number:'100',hash:hash('f'),timestamp:'200'}};
  const approved=approvedClubSigningPlanV3(c,'b'.repeat(64),{plan,recorded:false});assert.equal(approved.planDigest.length,64);
  assert.deepEqual(approvedClubSigningPlanV3(c,'b'.repeat(64),{plan,recorded:true}),approved);
  for(const k of ['chainId','uploadId','requestId','entitlementId','claimId','paymentId','attemptId','draftId','programmeAddress','operatorAddress','relayerAddress','recipientAddress','amountWei'])
    assert.throws(()=>approvedClubSigningPlanV3(c,'b'.repeat(64),{plan:{...plan,[k]:'different'}}));
  assert.throws(()=>approvedClubSigningPlanV3(c,'b'.repeat(64),{plan:{...plan,maxGasCostWei:(BigInt(c.maxGasCostWei)+1n).toString()}}));
  for(const patch of [{treasuryReviewId:id(21)},{safeExecutionNonce:'1'},{wrappedRecipientDigest:hash('d')},
    {consentCheckpoint:{...plan.consentCheckpoint,hash:hash('d')}}])
    assert.notEqual(approvedClubSigningPlanV3(c,'b'.repeat(64),{plan:{...plan,...patch}}).planDigest,approved.planDigest);
});
test('club actual signing CLI help and dirty-source refusal do not access credentials, Keychain or providers',t=>{
  const cli=fileURLToPath(new URL('../../../demo/rewards/scripts/club-payout-signing-v3.mjs',import.meta.url));
  const options={encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH}};
  const help=spawnSync(process.execPath,[cli,'--help'],options);assert.equal(help.status,0);assert.match(help.stdout,/no broadcast/);assert.equal(help.stderr,'');
  const dir=mkdtempSync(join(tmpdir(),'raceson-v3-payout-signing-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'non-secret-config.json');writeFileSync(path,JSON.stringify(rawConfig()));
  for(const args of [['run','--private-key','never'],['plan','--config',path],['run','--config',path,'--confirm-plan','b'.repeat(64)]]){
    const r=spawnSync(process.execPath,[cli,...args],{...options,input:'synthetic-secret-sentinel'});
    assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,'reward_payment_signing_command_failed\n');}
});
