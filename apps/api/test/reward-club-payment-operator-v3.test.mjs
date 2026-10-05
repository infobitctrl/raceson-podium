import { fileURLToPath } from "node:url";
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClubPaymentOperatorClientV3,rewardClubPaymentOperatorFetchV3,createPaymentOperatorClientV3,createPaymentSigningClientV3} from '../../../packages/db/dist/rewards/index.js';
import {captureClubPaymentOperatorJobsV3,runAuthenticatedClubPaymentOperatorV3} from '../dist/features/rewards/club-payment-operator-v3.js';
import {programmeOperatorAuthFixtureV3} from './fixtures/reward-programme-operator-v3.mjs';
import {normalizeClubPaymentOperatorConfigV3,clubPaymentOperatorExitCodeV3} from '../../../demo/rewards/scripts/club-payout-operator-v3.mjs';
import {DEMO_SUPABASE_ORGANIZATION,DEMO_VERCEL_TEAM,validateDemoReleaseManifest} from '../../../demo/rewards/scripts/release-manifest.mjs';
const id=n=>`8fc00000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=n=>'0x'+n.repeat(64),address=n=>'0x'+n.repeat(40);
const identity={userId:id(1),sessionId:id(2)};
const job=()=>({uploadId:id(3),requestId:id(4),entitlementId:hash('a'),claimId:id(5),paymentId:id(6),attemptId:id(7),jobId:id(8),
  transactionHash:hash('b'),recipientAddress:address('c'),amountWei:'1000000000000000001'});
const fixture=rpc=>programmeOperatorAuthFixtureV3(identity,rpc,createClubPaymentOperatorClientV3);
const input=auth=>({target:auth.target,...auth.credentials,draftId:id(9),programmeAddress:address('d'),operatorAddress:address('e'),relayerAddress:address('f'),
  operatorUserId:identity.userId,workerId:id(10),durationMs:60000,maxGasCostWei:100000000000000000n,maxPayoutWei:1000000000000000001n,jobs:[job()]});
const dependencies={reader:{},broadcast(){assert.fail('no unapproved send');}};
test('existing athlete capabilities cannot read or mutate the new club ledger',async()=>{
  for(const factory of [createPaymentOperatorClientV3,createPaymentSigningClientV3]){
    const auth=programmeOperatorAuthFixtureV3(identity,()=>assert.fail('no club SQL'),factory);
    const client=auth.clientFactory({target:auth.target,...auth.credentials,signal:new AbortController().signal});
    await client.authenticate(auth.credentials.accessToken,identity.userId);
    const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337};
    await assert.rejects(client.rpc('service_read_reward_club_payment_v3',args),/reward_operator_auth_required/);
    for(const p_action of ['attempt','lease','arm','submitted','confirm'])
      await assert.rejects(client.rpc('service_change_reward_club_payment_v3',{...args,p_action}),/reward_operator_auth_required/);
  }
});
test('club payment delivery client verifies real SDK Auth and permits only exact read/delivery methods, never creation',async()=>{
  const seen=[],auth=fixture(async(name,args)=>{seen.push({name,args});return{data:null,error:null};});
  const controller=new AbortController(),client=auth.clientFactory({target:auth.target,...auth.credentials,signal:controller.signal});
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337};
  await assert.rejects(client.rpc('service_read_reward_club_payment_v3',args),/reward_operator_auth_required/);
  assert.deepEqual((await client.authenticate(auth.credentials.accessToken,identity.userId)).identity,identity);
  await client.rpc('service_read_reward_club_payment_v3',args);
  for(const p_action of ['lease','arm','submitted','confirm'])await client.rpc('service_change_reward_club_payment_v3',{...args,p_action});
  for(const p_action of ['prepare','attempt','queue','anything',null])
    await assert.rejects(client.rpc('service_change_reward_club_payment_v3',{...args,p_action}),/reward_operator_auth_required/);
  for(const name of ['service_read_reward_athlete_payment_v3','service_change_reward_athlete_payment_v3','service_read_reward_programme_lifecycle_v3','service_reward_operator_session_call','service_prepare_reward_claim_v3'])
    await assert.rejects(client.rpc(name,args),/reward_operator_auth_required/);
  for(const patch of [{p_actor_user_id:id(99)},{p_actor_session_id:id(99)},{p_chain_id:143},{p_chain_id:10143}])
    await assert.rejects(client.rpc('service_read_reward_club_payment_v3',{...args,...patch}),/reward_operator_auth_required/);
  assert.equal(seen.length,5);controller.abort();
  await assert.rejects(client.rpc('service_read_reward_club_payment_v3',args),/reward_operator_auth_required/);
});
test('club payment transport also refuses create actions, unbounded request bodies, foreign RPCs and production destinations',async()=>{
  const auth=fixture(()=>assert.fail('no SQL')),fetch=rewardClubPaymentOperatorFetchV3(auth.target,new AbortController().signal,()=>assert.fail('no IO'));
  const prefix=auth.target.supabaseUrl+'/rest/v1/rpc/';
  for(const p_action of ['prepare','attempt','queue'])await assert.rejects(fetch(prefix+'service_change_reward_club_payment_v3',
    {method:'POST',body:JSON.stringify({p_action})}),/reward_operator_transport_unavailable/);
  await assert.rejects(fetch(prefix+'service_change_reward_club_payment_v3',{method:'POST',body:JSON.stringify({p_action:'arm',data:'x'.repeat(128*1024)})}),/reward_operator_transport_unavailable/);
  await assert.rejects(fetch(new Request(prefix+'service_change_reward_club_payment_v3',
    {method:'POST',body:new ReadableStream({start(){}}),duplex:'half'})),/reward_operator_transport_unavailable/);
  for(const url of [prefix+'service_reward_operator_session_call',prefix+'service_read_reward_club_payment_v3?secret=x',
    'https://icdtinbmtvzhswrrzjxq.supabase.co/rest/v1/rpc/service_read_reward_club_payment_v3'])
    await assert.rejects(fetch(url,{method:'POST'}),/reward_operator_transport_unavailable/);
});
test('club payout selections are immutable, exact-wei, unique, bounded and reject accessors without executing them',()=>{
  const row=job(),captured=captureClubPaymentOperatorJobsV3([row]);row.amountWei='1';assert.equal(captured[0].amountWei,1000000000000000001n);
  for(const list of [[],new Array(1),Array(101).fill(job()),[job(),job()],[{...job(),amountWei:1}],[{...job(),amountWei:'0'}],
    [{...job(),destinationId:id(4)}],[{...job(),signedTransaction:'private'}],[{...job(),transactionHash:hash('0')}]])assert.throws(()=>captureClubPaymentOperatorJobsV3(list));
  let invoked=false;const list=[job()],j=job(),get=()=>{invoked=true;return job();};
  Object.defineProperty(list,'0',{enumerable:true,get});Object.defineProperty(j,'jobId',{enumerable:true,get});
  assert.throws(()=>captureClubPaymentOperatorJobsV3(list));assert.throws(()=>captureClubPaymentOperatorJobsV3([j]));assert.equal(invoked,false);
});
test('club invalid target, authority, role keys and caps fail before Auth or private ledger access',async()=>{
  const raw=input(fixture(()=>assert.fail('no IO'))),never=()=>assert.fail('no Auth');
  for(const patch of [{maxGasCostWei:0n},{maxPayoutWei:0n},{maxPayoutWei:1n<<256n},{maxPayoutWei:'1'},{durationMs:0},{durationMs:1800001},
    {target:{...raw.target,chainId:143}},{target:{...raw.target,origin:'https://www.raceson.com'}},{relayerAddress:raw.operatorAddress},
    {operatorUserId:'bad'},{jobs:[]}])await assert.rejects(runAuthenticatedClubPaymentOperatorV3({...raw,...patch},dependencies,never));
});
test('club invalid or expired Auth cannot inspect jobs and failed reauthentication clears capability',async()=>{
  const auth=fixture(()=>assert.fail('invalid Auth cannot call SQL'));
  for(const patch of [{sub:id(99)},{session_id:null},{is_anonymous:true},{role:'service_role'},{exp:1},
    {iss:'https://icdtinbmtvzhswrrzjxq.supabase.co/auth/v1'}])
    await assert.rejects(runAuthenticatedClubPaymentOperatorV3({...input(auth),accessToken:auth.token(patch)},dependencies,auth.clientFactory));
  const client=auth.clientFactory({target:auth.target,...auth.credentials,signal:new AbortController().signal});
  await client.authenticate(auth.credentials.accessToken,identity.userId);
  await assert.rejects(client.authenticate(auth.token({sub:id(99)}),identity.userId));
  await assert.rejects(client.rpc('service_read_reward_club_payment_v3',{p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337}));
});
test('club delivery captures configuration before Auth and sanitizes unexpected preflight failures',async()=>{
  const raw=input(fixture(()=>{}));let signal,calls=0;
  const r=await runAuthenticatedClubPaymentOperatorV3(raw,dependencies,options=>{signal=options.signal;return{
    authenticate:async()=>{raw.jobs[0].paymentId=id(99);raw.maxPayoutWei=1n;raw.draftId=id(99);return{identity,expiresAtMs:Date.now()+60000};},
    rpc:async(name,args)=>{calls++;assert.equal(name,'service_read_reward_club_payment_v3');assert.equal(args.p_payment_id,id(6));throw Error('private-proof-sentinel');},
  };});
  assert.equal(r.stop,'unavailable');assert.equal(r.entries.length,0);assert.equal(r.maxPayoutWei,'1000000000000000001');
  assert.equal(calls,1);assert.equal(signal.aborted,true);assert.doesNotMatch(JSON.stringify(r),/private-proof|accessToken|serverKey|signedTransaction|sessionId/);
});
test('club session expiry aborts delayed IO without refreshing authority, and cancelled sessions do no IO',async()=>{
  const raw=input(fixture(()=>{}));let signal;
  const r=await runAuthenticatedClubPaymentOperatorV3(raw,dependencies,options=>{signal=options.signal;return{
    authenticate:async()=>({identity,expiresAtMs:Date.now()+5050}),rpc:async()=>{
      await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Error('private');},
  };});assert.equal(r.stop,'stopped');assert.equal(signal.aborted,true);
  const controller=new AbortController();controller.abort();
  assert.equal((await runAuthenticatedClubPaymentOperatorV3(raw,{...dependencies,signal:controller.signal},()=>assert.fail('no Auth'))).stop,'stopped');
});
const config=()=>({formatVersion:3,release:{formatVersion:1,kind:'raceson-rewards-testnet',repository:'infobitctrl/raceson-podium',sourceCommit:'a'.repeat(40),
  chainId:10143,origin:'https://rewards-demo.example.invalid',vercel:{teamId:DEMO_VERCEL_TEAM,projectId:'prj_DemoFixtureOnly',environment:'production',rootDirectory:'demo/rewards/web'},
  supabase:{organizationId:DEMO_SUPABASE_ORGANIZATION,projectRef:'abcdefghijklmnopqrst'}},draftId:id(9),programmeAddress:address('d'),operatorAddress:address('e'),
  relayerAddress:address('f'),operatorUserId:identity.userId,durationSeconds:60,maxGasCostWei:'100000000000000000',maxPayoutWei:'1000000000000000001',jobs:[job()]});
test('club payout CLI plan is exact, non-secret and refuses production, overspending and implicit signing',()=>{
  const normalize=v=>normalizeClubPaymentOperatorConfigV3(v,validateDemoReleaseManifest,captureClubPaymentOperatorJobsV3);
  const raw=config(),fixed=normalize(raw);assert.deepEqual(fixed,raw);raw.jobs[0].paymentId=id(99);assert.equal(fixed.jobs[0].paymentId,id(6));
  for(const change of [v=>v.privateKey='never',v=>v.formatVersion=1,v=>v.maxPayoutWei='1',v=>v.maxGasCostWei='1e18',v=>v.maxPayoutWei=(1n<<256n).toString(),
    v=>v.relayerAddress=v.operatorAddress,v=>v.release.chainId=143,v=>v.release.chainId=31337,v=>v.release.origin='https://www.raceson.com',
    v=>v.release.supabase.projectRef='icdtinbmtvzhswrrzjxq',v=>v.release.vercel.rootDirectory='apps/web',v=>v.jobs[0].signedTransaction='private']){
    const v=config();change(v);assert.throws(()=>normalize(v));}
});
test('club actual payout CLI help and invalid arguments do not read secrets or contact providers',()=>{
  const cli=fileURLToPath(new URL('../../../demo/rewards/scripts/club-payout-operator-v3.mjs',import.meta.url));
  const options={encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH}};
  const help=spawnSync(process.execPath,[cli,'--help'],options);assert.equal(help.status,0);assert.equal(help.stderr,'');assert.match(help.stdout,/already queued\/signed club payout/);
  const invalid=spawnSync(process.execPath,[cli,'run','--private-key','synthetic'],options);assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');
  assert.equal(invalid.stderr,'reward_payment_operator_command_failed\n');
  assert.equal(clubPaymentOperatorExitCodeV3({stop:'jobs_confirmed',requestedJobs:1,entries:[{outcome:'confirmed'}]}),0);
  assert.equal(clubPaymentOperatorExitCodeV3({stop:'deferred',requestedJobs:1,entries:[{outcome:'submitted'}]}),2);
});
test('club actual payout CLI rejects unreviewed source before credentials and cannot inherit production targets',t=>{
  const directory=mkdtempSync(join(tmpdir(),'raceson-v3-payout-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'non-secret-config.json');writeFileSync(path,JSON.stringify(config()));
  for(const args of [['plan','--config',path],['run','--config',path,'--confirm-plan','b'.repeat(64)]]){
    const r=spawnSync(process.execPath,[fileURLToPath(new URL('../../../demo/rewards/scripts/club-payout-operator-v3.mjs',import.meta.url)),...args],
      {encoding:'utf8',timeout:5000,input:'synthetic-secret-sentinel',env:{PATH:process.env.PATH,SUPABASE_URL:'https://icdtinbmtvzhswrrzjxq.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret-sentinel'}});
    assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,'reward_payment_operator_command_failed\n');}
});
