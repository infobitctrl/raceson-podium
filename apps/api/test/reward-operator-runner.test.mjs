import assert from "node:assert/strict";
import test from "node:test";
import { nextRewardOperatorJob } from "../../../packages/db/dist/rewards/index.js";
import { drainRewardOperatorQueue } from "../dist/features/rewards/operator-runner.js";
import { calculationFixture,rewardId as id } from "./fixtures/reward-calculation.mjs";

const identity={userId:id(4),sessionId:id(99201)};const session=calculationFixture().session;
const programmeId=id(99800);const signer=n=>`0x${String(n).repeat(40)}`;
const job=(n=1,kind="deployment",signerAddress=signer(1))=>({kind,jobId:id(99800+n),campaignId:id(99900+n),intentId:id(99000+n),attemptId:id(99100+n),
  transactionHash:`0x${"ab".repeat(32)}`,signerAddress,nonce:String(n-1),state:"queued"});
const packet=value=>({schemaVersion:1,programmeId,chainId:31337,job:value});
const policy={maxGasLimit:500000n,maxFeePerGas:30000000000n,maxTotalFeeWei:15000000000000000n,minimumRemainingBalanceWei:1000000n};
const config={chainId:31337,origin:"http://127.0.0.1:5173",gasPolicy:policy};
const input=()=>({programmeId,workerId:id(99899),maxJobs:20,deadlineMs:Date.now()+60000});
const reply=data=>async()=>({data:structuredClone(data),error:null});

test("operator queue freezes current account and chain/programme/signer selection before IO",async()=>{
  const a={...identity};const request={programmeId,chainId:31337,excludedSigners:[signer(2)]};let seen;
  const pending=nextRewardOperatorJob(a,request,async(name,args)=>{assert.equal(name,"service_next_reward_operator_job");seen=args;
    await Promise.resolve();return{data:packet(job()),error:null};});
  a.userId=id(9);request.programmeId=id(9);request.chainId=10143;request.excludedSigners.push(signer(1));
  assert.equal((await pending).nonce,0n);assert.deepEqual(seen,{p_programme_id:programmeId,p_actor_user_id:identity.userId,
    p_actor_session_id:identity.sessionId,p_chain_id:31337,p_excluded_signers:[signer(2)]});
});
test("operator queue rejects malformed input and secret/cross-scope responses",async()=>{
  let calls=0;const noCall=async()=>{calls++;throw new Error("must not run");};
  for(const extra of [{chainId:143},{excludedSigners:[signer(1),signer(1)]},{excludedSigners:["0x"]},{excludedSigners:[signer(0)]},{programmeId:"bad"}]){
    await assert.rejects(nextRewardOperatorJob(identity,{programmeId,chainId:31337,excludedSigners:[],...extra},noCall));
  }assert.equal(calls,0);
  for(const extra of [{programmeId:id(9)},{chainId:10143},{secret:"sensitive"},{job:{...job(),kind:"sign"}},
    {job:{...job(),state:"confirmed"}},{job:{...job(),nonce:"9007199254740992"}},{job:{...job(),rawTransaction:"sensitive"}},
    {job:{...job(),signerAddress:signer(2)}}]){
    await assert.rejects(nextRewardOperatorJob(identity,{programmeId,chainId:31337,excludedSigners:[signer(2)]},reply({...packet(job()),...extra})));
  }
  assert.equal(await nextRewardOperatorJob(identity,{programmeId,chainId:31337,excludedSigners:[]},reply(packet(null))),null);
});
test("operator queue preserves bounded permission errors without provider details",async()=>{
  const request={programmeId,chainId:31337,excludedSigners:[]};
  for(const message of ["reward_account_session_required","reward_operator_permission_required","invalid_reward_operator_queue","private credential"]){
    await assert.rejects(nextRewardOperatorJob(identity,request,async()=>({data:null,error:{message}})),
      {code:message==="private credential"?"reward_ledger_store_failed":message});
  }
});
test("bounded runner dispatches every stored kind and removes only confirmed heads",async()=>{
  const jobs=["deployment","funding","lifecycle","athlete_payment","club_payment"].map((kind,n)=>job(n+1,kind));const ran=[];
  const rpc=async()=>({data:packet(jobs[0]??null),error:null});
  const result=await drainRewardOperatorQueue(session,identity,input(),{...config,rpc},async j=>{
    ran.push(j.kind);assert.equal(j.nonce,BigInt(ran.length-1));jobs.shift();return{jobId:j.jobId,outcome:"confirmed",secret:"never return"};});
  assert.equal(result.stop,"queue_empty");assert.deepEqual(ran,["deployment","funding","lifecycle","athlete_payment","club_payment"]);
  assert.equal(result.entries.length,5);assert.ok(!JSON.stringify(result).includes("secret"));
});
test("pending/held signer is excluded while an independent signer still progresses",async()=>{
  for(const status of ["pending","submitted","busy","awaiting_nonce","broadcast_unknown","not_ready","nonce_conflict","gas_guard","evidence_changed","prestate_changed","review_not_finished","requires_attention"]){
    const jobs=[job(),job(2,"athlete_payment",signer(2))];const ran=[];
    const rpc=async(_name,args)=>({data:packet(jobs.find(j=>!args.p_excluded_signers.includes(j.signerAddress))??null),error:null});
    const result=await drainRewardOperatorQueue(session,identity,input(),{...config,rpc},async j=>{
      ran.push(j.jobId);if(j.signerAddress===signer(2))jobs.splice(1,1);return{jobId:j.jobId,outcome:j.signerAddress===signer(1)?status:"confirmed"};});
    assert.deepEqual(ran,[id(99801),id(99802)]);assert.ok(["signers_deferred","attention_required"].includes(result.stop));
  }
});
test("unknown transport/auth outcomes stop the entire pass without leaking error bodies",async()=>{
  for(const fail of [async()=>{throw new Error("sensitive credential");},async j=>({jobId:j.jobId,outcome:"unavailable"}),
    async()=>null,async()=>({jobId:id(5),outcome:"confirmed"}),async j=>({jobId:j.jobId,outcome:"invented"})]){
    let reads=0;const result=await drainRewardOperatorQueue(session,identity,input(),{...config,rpc:async()=>{reads++;return{data:packet(job()),error:null};}},fail);
    assert.equal(result.stop,"unavailable");assert.equal(reads,1);assert.ok(!JSON.stringify(result).includes("sensitive"));
  }
});
test("stale repeated confirmed head cannot hot-loop or execute a second time",async()=>{
  let runs=0;const result=await drainRewardOperatorQueue(session,identity,input(),{...config,rpc:reply(packet(job()))},async j=>{
    runs++;return{jobId:j.jobId,outcome:"confirmed"};});
  assert.equal(result.stop,"unavailable");assert.equal(runs,1);
});
test("runner respects job cap and restart reads durable queue rather than a local paid flag",async()=>{
  const jobs=[job(),job(2)];const run=async j=>{jobs.shift();return{jobId:j.jobId,outcome:"confirmed"};};
  const deps={...config,rpc:async()=>({data:packet(jobs[0]??null),error:null})};
  const first=await drainRewardOperatorQueue(session,identity,{...input(),maxJobs:1},deps,run);
  assert.equal(first.stop,"limit_reached");assert.equal(first.entries.length,1);
  const resumed=await drainRewardOperatorQueue(session,identity,input(),deps,run);
  assert.equal(resumed.stop,"queue_empty");assert.deepEqual(resumed.entries.map(e=>e.jobId),[id(99802)]);
});
test("cancellation/deadline before or during queue lookup starts no worker",async()=>{
  for(const during of [false,true]){
    const controller=new AbortController();if(!during)controller.abort();let calls=0;let runs=0;
    const result=await drainRewardOperatorQueue(session,identity,input(),{...config,signal:controller.signal,rpc:async()=>{
      calls++;controller.abort();return{data:packet(job()),error:null};}},async()=>{runs++;throw new Error("must not run");});
    assert.equal(result.stop,"stopped");assert.equal(runs,0);assert.equal(calls,during?1:0);
  }
  const result=await drainRewardOperatorQueue(session,identity,{...input(),deadlineMs:Date.now()-1},{...config,rpc:async()=>{throw new Error("must not run");}});
  assert.equal(result.stop,"stopped");
});
test("invalid runner identity, limits, deadline and gas policy fail before queue IO",async()=>{
  let calls=0;const deps={...config,rpc:async()=>{calls++;throw new Error("must not run");}};
  for(const extra of [{maxJobs:0},{maxJobs:101},{maxJobs:1.5},{deadlineMs:Infinity},{deadlineMs:Date.now()+31*60000},{programmeId:"bad"}]){
    await assert.rejects(drainRewardOperatorQueue(session,identity,{...input(),...extra},deps));
  }
  await assert.rejects(drainRewardOperatorQueue(session,{...identity,userId:id(9)},input(),deps));
  await assert.rejects(drainRewardOperatorQueue(session,identity,input(),{...deps,gasPolicy:{...policy,maxGasLimit:0n}}));
  assert.equal(calls,0);
});
