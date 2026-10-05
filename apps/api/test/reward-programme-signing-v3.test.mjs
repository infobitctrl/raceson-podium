import { fileURLToPath } from "node:url";
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgrammeSigningClientV3, rewardProgrammeSigningFetchV3, rewardProgrammeOperatorFetchV3 } from '../../../packages/db/dist/rewards/index.js';
import { inspectProgrammeSigningV3, signProgrammeV3 } from '../dist/features/rewards/programme-signing-v3.js';
import { programmeOperatorAuthFixtureV3 } from './fixtures/reward-programme-operator-v3.mjs';
import { normalizeProgrammeSigningConfigV3 as config, approvedProgrammeSigningPlanV3 as approve, programmeSigningChainFetchV3 } from '../../../demo/rewards/scripts/programme-signing-v3.mjs';
import { normalizeProgrammeOperatorConfigV3 } from '../../../demo/rewards/scripts/programme-operator-v3.mjs';
const id=n=>`8c000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={userId:id(1),sessionId:id(2)};
const raw=()=>({formatVersion:3,release:{},draftId:id(3),approvalId:id(4),uploadId:id(5),intentId:id(6),attemptId:id(7),operatorUserId:id(1),
  programmeAddress:'0x'+'a'.repeat(40),campaignAddress:'0x'+'b'.repeat(40),operatorAddress:'0x'+'c'.repeat(40),slot:6,action:'activate',
  packageHash:'a'.repeat(64),maxGasCostWei:'100000000000000000',durationSeconds:60});
test('programme signing SDK capability allows only read/record after Auth; delivery, queue, publication and reservation remain denied',async()=>{
  const seen=[], auth=programmeOperatorAuthFixtureV3(identity,async(name,args)=>{seen.push(name);return{data:null,error:null}},createProgrammeSigningClientV3);
  const c=new AbortController(),client=auth.clientFactory({target:auth.target,...auth.credentials,signal:c.signal});
  const args={p_actor_user_id:identity.userId,p_actor_session_id:identity.sessionId,p_chain_id:31337};
  await assert.rejects(client.rpc('service_read_reward_programme_lifecycle_v3',args));
  await client.authenticate(auth.credentials.accessToken,identity.userId);
  for(const name of ['service_read_reward_programme_lifecycle_v3','service_record_reward_programme_lifecycle_attempt_v3'])await client.rpc(name,args);
  for(const name of ['service_step_reward_programme_lifecycle_job_v3','service_queue_reward_programme_lifecycle_job_v3','service_reserve_reward_programme_activation_v3',
    'service_reward_final_publication_v3','service_change_reward_athlete_payment_v3'])await assert.rejects(client.rpc(name,args),/reward_operator_auth_required/);
  for(const patch of [{p_actor_user_id:id(9)},{p_actor_session_id:id(9)},{p_chain_id:143}])await assert.rejects(client.rpc('service_read_reward_programme_lifecycle_v3',{...args,...patch}));
  assert.equal(seen.length,2);c.abort();await assert.rejects(client.rpc('service_record_reward_programme_lifecycle_attempt_v3',args));
});
test('programme signing transports cannot broadcast or borrow delivery RPC capabilities',async()=>{
  const auth=programmeOperatorAuthFixtureV3(identity,()=>{}), signal=new AbortController().signal,never=()=>assert.fail('no network');
  const signing=rewardProgrammeSigningFetchV3(auth.target,signal,never),delivery=rewardProgrammeOperatorFetchV3(auth.target,signal,never);
  const prefix=auth.target.supabaseUrl+'/rest/v1/rpc/';
  await assert.rejects(signing(prefix+'service_step_reward_programme_lifecycle_job_v3',{method:'POST'}));
  await assert.rejects(delivery(prefix+'service_record_reward_programme_lifecycle_attempt_v3',{method:'POST'}));
  const transport=programmeSigningChainFetchV3(signal,never);
  await assert.rejects(transport('https://testnet-rpc.monad.xyz',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:['0x02']})}),/read_only/);
  for(const method of ['eth_sendTransaction','personal_sign','eth_signTransaction'])await assert.rejects(transport('https://testnet-rpc.monad.xyz',{
    method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})}));
});
test('programme signing refuses unsupported scope, malformed approval and cancellation before key or database access',async()=>{
  const s={chainId:31337,draftId:id(3),slot:6,approvalId:id(4),uploadId:id(5),intentId:id(6),attemptId:id(7)},never=()=>assert.fail('no private IO');
  for(const patch of [{chainId:143},{slot:7},{slot:0},{attemptId:'missing'}])await assert.rejects(inspectProgrammeSigningV3(identity,{...s,...patch},{rpc:never,reader:{}}));
  await assert.rejects(signProgrammeV3(identity,{...s,planHash:'bad'},{rpc:never,reader:{},signal:new AbortController().signal,loadSigner:never}));
  await assert.rejects(signProgrammeV3(identity,{...s,planHash:'0x'+'a'.repeat(64)},{rpc:never,reader:{},signal:AbortSignal.abort(),loadSigner:never}),/stopped/);
});
test('signing CLI config and approval bind the exact six-pot action, target, package and gas cap',()=>{
  const v=raw(),c=config(v,x=>({...x}));assert.deepEqual(c,v);
  for(const mutate of [v=>v.slot=7,v=>v.slot=0,v=>v.action='claim',v=>v.privateKey='never',v=>v.maxGasCostWei='0',v=>v.durationSeconds=1801,
    v=>v.operatorAddress=v.campaignAddress,v=>v.attemptId=null]){const x=raw();mutate(x);assert.throws(()=>config(x,x=>x));}
  const p={...c,chainId:10143,schema:'raceson-programme-signing-plan-v3',valueWei:'0',planHash:'0x'+'b'.repeat(64),fees:{maxGasCostWei:c.maxGasCostWei}};
  const approved=approve(c,'c'.repeat(64),{plan:p});assert.equal(approved.planDigest.length,64);
  for(const patch of [{slot:5},{action:'upload_awards'},{packageHash:'d'.repeat(64)},{operatorAddress:'0x'+'d'.repeat(40)},{valueWei:'1'},
    {chainId:143},{fees:{maxGasCostWei:'100000000000000001'}}])assert.throws(()=>approve(c,'c'.repeat(64),{plan:{...p,...patch}}));
  for(const slot of [5,6]){
    const job={slot,approvalId:id(4),uploadId:id(5),intentId:id(6),attemptId:id(7),jobId:id(8),transactionHash:'0x'+'a'.repeat(64)};
    const delivery={formatVersion:3,release:{},draftId:id(3),programmeAddress:c.programmeAddress,operatorAddress:c.operatorAddress,operatorUserId:id(1),durationSeconds:60,maxGasCostWei:c.maxGasCostWei,jobs:[job]};
    assert.equal(normalizeProgrammeOperatorConfigV3(delivery,x=>x).jobs[0].slot,slot);
  }
});
test('actual programme signing CLI help/invalid arguments use no credentials or Keychain',()=>{
  const cli=fileURLToPath(new URL('../../../demo/rewards/scripts/programme-signing-v3.mjs',import.meta.url));
  const opts={encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH,SUPABASE_URL:'https://icdtinbmtvzhswrrzjxq.supabase.co'}};
  const help=spawnSync(process.execPath,[cli,'--help'],opts);assert.equal(help.status,0);assert.match(help.stdout,/no broadcast/);assert.equal(help.stderr,'');
  const bad=spawnSync(process.execPath,[cli,'run','--private-key','synthetic'],opts);assert.equal(bad.status,1);assert.equal(bad.stdout,'');assert.equal(bad.stderr,'reward_programme_signing_command_failed\n');
});
test('actual programme signing CLI refuses an unreviewed source before consuming credential input',t=>{
  const directory=mkdtempSync(join(tmpdir(),'raceson-programme-signing-test-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'public-config.json');writeFileSync(path,JSON.stringify({...raw(),release:{sourceCommit:'a'.repeat(40)}}));
  const cli=fileURLToPath(new URL('../../../demo/rewards/scripts/programme-signing-v3.mjs',import.meta.url));
  for(const args of [['plan','--config',path],['run','--config',path,'--confirm-plan','b'.repeat(64)]]){
    const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:5000,input:'synthetic-private-input',
      env:{PATH:process.env.PATH,SUPABASE_URL:'https://icdtinbmtvzhswrrzjxq.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-private-input'}});
    assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,'reward_programme_signing_command_failed\n');
  }
});
